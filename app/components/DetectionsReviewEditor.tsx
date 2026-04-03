'use client'
/**
 * Editor verificare detecții: camere (poligoane + etichete) și uși/geamuri.
 * Datele vin din detections_review_data.json (API compute/detections-review-data):
 * - Etichete camere = room_scales.json (pipeline per-crop Gemini, OCR exact).
 * - Tipuri uși/geamuri = doors_types.json (Gemini) + euristică aspect – aceeași clasificare ca în LiveFeed.
 */

import { useState, useEffect, useCallback, useRef, useMemo, type SetStateAction } from 'react'
import {
  LayoutGrid,
  DoorOpen,
  Home,
  AppWindow,
  MousePointer2,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Undo2,
  GripVertical,
} from 'lucide-react'
import { DetectionsPolygonCanvas, type Point, type RoomPolygon, type DoorRect } from './DetectionsPolygonCanvas'
import {
  RoofReviewEditor,
  type RoofReviewEditorHandle,
  type RoofSurfaceTab,
} from './RoofReviewEditor'
import { apiFetch } from '../lib/supabaseClient'
import { displayFloorTabLabelDe } from '@/lib/displayFloorTabLabelDe'

/** Unire vârfuri consecutive foarte apropiate (în px imagine) – la randarea poligoanelor prima dată. */
const MERGE_VERTEX_DIST_PX = 14

/** Tip canonic pentru uși/ferestre: door | window | sliding_door | garage_door | stairs. */
function normalizeDoorType(type: string | undefined): string {
  const t = (type || 'door').toLowerCase().trim()
  if (t === 'window' || t === 'fenster' || t === 'geam') return 'window'
  if (t === 'sliding_door' || t === 'schiebetur' || t === 'schiebetür') return 'sliding_door'
  if (t === 'garage_door' || t === 'garagentor') return 'garage_door'
  if (t === 'stairs' || t === 'treppe') return 'stairs'
  return 'door'
}

/** Migrează eticheta veche „Raum” → „Raum ungedämmt“ (pentru calcul Dachfläche gedämmt). */
function migrateRoomLabelDe(raw: string | undefined): string {
  const t = (raw ?? '').trim()
  if (!t || t === 'Raum') return 'Raum ungedämmt'
  return t
}

function roomInsulatedFromRoomPolygon(
  r: Pick<RoomPolygon, 'roomInsulated' | 'roomType' | 'roomName'>,
  resolvedType: string,
): boolean {
  if (r.roomInsulated === true) return true
  return resolvedType === 'Raum gedämmt'
}

function mergeClosePolygonPoints(points: Point[], minDistPx: number): Point[] {
  if (!points?.length || points.length < 3) return points ?? []
  const out: Point[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const p = points[i]
    const last = out[out.length - 1]
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= minDistPx) out.push(p)
  }
  return out.length >= 3 ? out : points
}

export type ReviewTab = 'rooms' | 'doors' | 'roof' | 'roof_windows'

export type ReviewImage = { url: string; caption?: string }

type Tool = 'select' | 'add' | 'remove' | 'edit'

type PlanData = {
  imageWidth: number
  imageHeight: number
  metersPerPixel?: number | null
  rooms: RoomPolygon[]
  doors: DoorRect[]
}

type DoorType = 'door' | 'window' | 'sliding_door' | 'garage_door' | 'stairs'
const round2 = (v: number) => Math.round(v * 100) / 100
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function isValidFloorPlanPerm(perm: unknown, n: number): perm is number[] {
  if (!Array.isArray(perm) || perm.length !== n || n === 0) return false
  const ints = perm.map((x) => Math.round(Number(x)))
  if (ints.some((x) => !Number.isFinite(x))) return false
  if (new Set(ints).size !== n) return false
  const sorted = [...ints].sort((a, b) => a - b)
  for (let i = 0; i < n; i++) {
    if (sorted[i] !== i) return false
  }
  return true
}
const isTooManyRequestsError = (err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /too many requests|throttle/i.test(msg)
}

/** PATCH detections-review-data: retries when server is busy or returns transient ok:false */
const DETECTIONS_PATCH_MAX_ATTEMPTS = 10
function detectionsPatchBackoffMs(attempt: number): number {
  return Math.min(5000, 400 * 2 ** attempt)
}

function computeOpeningWidthMeters(door: DoorRect, metersPerPixel: number | null | undefined): number | null {
  const [x1, y1, x2, y2] = door.bbox
  const widthPx = Math.abs(x2 - x1)
  const heightPx = Math.abs(y2 - y1)
  const normalizedType = normalizeDoorType(door.type) as DoorType
  const pxValue =
    normalizedType === 'window' || normalizedType === 'sliding_door'
      ? Math.max(widthPx, heightPx)
      : Math.min(widthPx, heightPx)
  if (!metersPerPixel || metersPerPixel <= 0) return null
  return round2(pxValue * metersPerPixel)
}

/** Kurze Seite im Fenstersymbol ≈ Wanddicke im Grundriss – erlaubt Breite ohne globales metersPerPixel. */
const ASSUMED_WALL_THICKNESS_PLAN_M = 0.36

/**
 * Fenster-Öffnungsbreite (m): zuerst metersPerPixel; sonst Heuristik aus BBox (kurz= Wand) oder Bildgröße.
 * Ohne API-Maßstab kann die Pipeline später noch korrigieren – der Editor bleibt nutzbar.
 */
function computeWindowOpeningWidthMetersFromBbox(
  bbox: [number, number, number, number],
  metersPerPixel: number | null | undefined,
  imageWidth: number,
  imageHeight: number,
): number {
  const fromMpp = computeOpeningWidthMeters({ bbox, type: 'window' }, metersPerPixel)
  if (fromMpp != null && fromMpp > 0) return fromMpp

  const [x1, y1, x2, y2] = bbox
  const wPx = Math.abs(x2 - x1)
  const hPx = Math.abs(y2 - y1)
  const minPx = Math.min(wPx, hPx)
  const maxPx = Math.max(wPx, hPx)
  const pxOpening = Math.max(wPx, hPx)

  if (minPx >= 2 && maxPx / minPx >= 1.12) {
    const impliedMpp = ASSUMED_WALL_THICKNESS_PLAN_M / minPx
    const width_m = round2(maxPx * impliedMpp)
    if (width_m > 0.05 && width_m < 25) return width_m
  }

  const iw = Math.max(1, imageWidth || 4000)
  const ih = Math.max(1, imageHeight || 4000)
  const assumedSpanM = 22
  const mppFallback = assumedSpanM / Math.max(iw, ih)
  return Math.max(0.05, round2(pxOpening * mppFallback))
}

function computeWindowHeightMeters(widthMeters: number): number {
  if (widthMeters <= 1) return 0.8
  if (widthMeters <= 2) return 1.5
  return 2.0
}

function computeOpeningHeightMeters(door: DoorRect, widthMeters: number | null): number | null {
  if (widthMeters == null) return null
  const normalizedType = normalizeDoorType(door.type) as DoorType
  return round2(
    normalizedType === 'window' || normalizedType === 'sliding_door'
      ? computeWindowHeightMeters(widthMeters)
      : 2.0,
  )
}

/** Typische Geschoss-/Wandhöhe für Garagentor, wenn der Plan keinen eigenen Wert liefert. */
const DEFAULT_WALL_HEIGHT_M = 2.5

/**
 * Neue Öffnung ohne Dialog: Maße aus Bounding-Box × metersPerPixel (Tür/Treppe/Garage).
 * Tür/Treppe: schmalere Kantenlänge → Breite, längere → Höhe (Grundriss-Rechteck).
 */
function computeAutoOpeningMetersFromBbox(
  bbox: [number, number, number, number],
  type: DoorType,
  metersPerPixel: number | null | undefined,
): { width_m: number; height_m: number } {
  const [x1, y1, x2, y2] = bbox
  const wPx = Math.abs(x2 - x1)
  const hPx = Math.abs(y2 - y1)
  const minPx = Math.min(wPx, hPx)
  const maxPx = Math.max(wPx, hPx)
  const stub = (t: DoorType): DoorRect => ({ bbox, type: t })

  if (type === 'garage_door') {
    let width_m = 2.5
    if (metersPerPixel && metersPerPixel > 0) {
      const w = computeOpeningWidthMeters(stub('garage_door'), metersPerPixel)
      width_m = w != null ? Math.max(0.01, w) : Math.max(0.01, round2(minPx * metersPerPixel))
    }
    return { width_m, height_m: DEFAULT_WALL_HEIGHT_M }
  }

  if (type === 'sliding_door') {
    const width_m =
      metersPerPixel && metersPerPixel > 0
        ? Math.max(0.01, round2(maxPx * metersPerPixel))
        : 2.4
    return { width_m, height_m: 2.0 }
  }

  if (!metersPerPixel || metersPerPixel <= 0) {
    if (type === 'door') return { width_m: 0.9, height_m: 2.0 }
    if (type === 'stairs') return { width_m: 1.0, height_m: 3.0 }
    return { width_m: 0.9, height_m: 2.0 }
  }

  if (type === 'door' || type === 'stairs') {
    return {
      width_m: Math.max(0.01, round2(minPx * metersPerPixel)),
      height_m: Math.max(0.01, round2(maxPx * metersPerPixel)),
    }
  }

  return { width_m: 0.9, height_m: 2.0 }
}

function withAutoDoorDimensions(
  doors: DoorRect[],
  metersPerPixel: number | null | undefined
): DoorRect[] {
  return doors.map((door) => {
    if (door.dimensionsEdited && typeof door.width_m === 'number' && typeof door.height_m === 'number') {
      return door
    }
    const width_m = computeOpeningWidthMeters(door, metersPerPixel)
    const height_m = computeOpeningHeightMeters(door, width_m)
    return {
      ...door,
      ...(typeof width_m === 'number' ? { width_m } : {}),
      ...(typeof height_m === 'number' ? { height_m } : {}),
      dimensionsEdited: Boolean(door.dimensionsEdited),
    }
  })
}

type DetectionsReviewEditorProps = {
  offerId?: string
  images: ReviewImage[]
  /** Pentru tab-ul Dach: dacă lipsesc, se folosesc `images`. */
  roofImages?: ReviewImage[]
  roofOnlyOffer?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export function DetectionsReviewEditor({
  offerId,
  images,
  roofImages,
  roofOnlyOffer = false,
  onConfirm,
  onCancel,
}: DetectionsReviewEditorProps) {
  const [tool, setTool] = useState<Tool>('select')
  const [planIndex, setPlanIndex] = useState(0)
  const [tabPerPlan, setTabPerPlan] = useState<Record<number, ReviewTab>>({})
  const [plansData, setPlansData] = useState<PlanData[]>([])
  const [floorLabels, setFloorLabels] = useState<string[]>([])
  /** Permutation: index from bottom (0 = lowest floor) → raster/plan index. PDF & tabs use this order (top tab = lowest floor). */
  const [floorPlanOrder, setFloorPlanOrder] = useState<number[]>([])
  const [floorOrderDraft, setFloorOrderDraft] = useState<number[]>([])
  const [reorderFloorsMode, setReorderFloorsMode] = useState(false)
  const [dragFromDisplayIdx, setDragFromDisplayIdx] = useState<number | null>(null)
  const floorPlanOrderRef = useRef<number[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPolygonIndex, setSelectedPolygonIndex] = useState<number | null>(null)
  const [newPolygonPoints, setNewPolygonPoints] = useState<Point[] | null>(null)
  const [newDoorType, setNewDoorType] = useState<DoorType>('door')
  const [pendingNewRoomPoints, setPendingNewRoomPoints] = useState<Point[] | null>(null)
  const [pendingNewDoorBbox, setPendingNewDoorBbox] = useState<[number, number, number, number] | null>(null)
  const [pendingNewDoorType, setPendingNewDoorType] = useState<'window' | 'sliding_door' | null>(null)
  const [roomTypePopoverIndex, setRoomTypePopoverIndex] = useState<number | null>(null)
  const [newDoorDims, setNewDoorDims] = useState<{ width: string; height: string }>({ width: '', height: '' })
  const [isConfirming, setIsConfirming] = useState(false)
  const [history, setHistory] = useState<PlanData[][]>([])
  const historyLimit = 50
  const skipNextPushRef = useRef(false)
  const plansDataRef = useRef<PlanData[]>(plansData)
  const roofEditorRef = useRef<RoofReviewEditorHandle>(null)
  /** Popup „Neues Fenster – Höhe“: focus + Enter = Speichern */
  const newWindowHeightInputRef = useRef<HTMLInputElement>(null)
  const [roofDimsToolbarSlotEl, setRoofDimsToolbarSlotEl] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    plansDataRef.current = plansData
  }, [plansData])

  useEffect(() => {
    floorPlanOrderRef.current = floorPlanOrder
  }, [floorPlanOrder])

  const pushHistory = useCallback(() => {
    if (skipNextPushRef.current) {
      skipNextPushRef.current = false
      return
    }
    const snap = JSON.parse(JSON.stringify(plansDataRef.current)) as PlanData[]
    if (snap.length === 0) return
    setHistory((h) => [...h.slice(-(historyLimit - 1)), snap])
  }, [])

  const ROOM_TYPE_OPTIONS = ['Garage', 'Balkon', 'Wintergarten', 'Raum gedämmt', 'Raum ungedämmt'] as const
  type RoomTypeOption = typeof ROOM_TYPE_OPTIONS[number]

  const n = plansData.length > 0 ? plansData.length : Math.max(1, images.length)
  const planIndexClamped = n > 0 ? Math.max(0, Math.min(planIndex, n - 1)) : 0
  const currentPlan = plansData[planIndexClamped]
  // O imagine de bază per plan (fără poligoane); canvas-ul desenează rooms/doors din API
  const getBaseImageUrl = (planIdx: number) => images[planIdx]?.url ?? images[0]?.url
  // Același blueprint ca Räume / Fenster; roofImages poate veni mai târziu sau cu alt URL → încărcare lentă / refresh.
  const roofImgs = roofOnlyOffer && roofImages?.length ? roofImages : images

  const plansDimKey =
    plansData.length === 0
      ? ''
      : `${plansData.length}|${plansData.map((p) => `${Number(p.imageWidth) || 0}x${Number(p.imageHeight) || 0}`).join('|')}`
  const roofEmbeddedSeeds = useMemo((): Array<{ imageWidth: number; imageHeight: number }> | undefined => {
    if (roofOnlyOffer || plansData.length === 0) return undefined
    return plansData.map((p) => ({
      imageWidth: Number(p.imageWidth) || 0,
      imageHeight: Number(p.imageHeight) || 0,
    }))
  }, [roofOnlyOffer, plansDimKey])
  const getTabForPlan = useCallback(
    (planIdx: number): ReviewTab => {
      if (roofOnlyOffer) {
        return tabPerPlan[planIdx] === 'roof_windows' ? 'roof_windows' : 'roof'
      }
      return tabPerPlan[planIdx] ?? 'rooms'
    },
    [roofOnlyOffer, tabPerPlan],
  )
  const setTabForPlan = useCallback((planIdx: number, t: ReviewTab) => {
    setTabPerPlan((prev) => ({ ...prev, [planIdx]: t }))
  }, [])
  useEffect(() => {
    if (n > 0 && planIndex >= n) setPlanIndex(n - 1)
  }, [n, planIndex])

  useEffect(() => {
    if (!offerId || images.length === 0) {
      setLoading(false)
      setPlansData([])
      return
    }
    let cancelled = false
    setLoading(true)
    const fetchWithRetry = async () => {
      let lastPlans: PlanData[] = []
      for (let attempt = 0; attempt < 8 && !cancelled; attempt++) {
        try {
          const res = (await apiFetch(`/offers/${offerId}/compute/detections-review-data?ts=${Date.now()}`)) as {
            plans?: PlanData[]
            floorLabels?: string[]
            floorPlanOrder?: number[]
          }
          const plans = Array.isArray(res?.plans) ? res.plans : []
          const normalized = plans.map((p) => ({
            ...p,
            metersPerPixel: typeof p.metersPerPixel === 'number' ? p.metersPerPixel : null,
            rooms: (p.rooms || []).map((r: RoomPolygon & { room_name?: string }) => {
              const rt = migrateRoomLabelDe(r.roomType ?? 'Raum')
              const rn = migrateRoomLabelDe(
                (r.roomName ?? r.room_name ?? r.roomType ?? 'Raum').trim() || 'Raum',
              )
              return {
                ...r,
                roomType: rt,
                roomName: rn,
                roomInsulated: roomInsulatedFromRoomPolygon(r, rt),
                points: mergeClosePolygonPoints(r.points || [], MERGE_VERTEX_DIST_PX),
              }
            }),
            // Tipuri uși/geamuri = aceeași clasificare ca LiveFeed (detections_review_doors.png): backend doors_types.json + euristică
            doors: withAutoDoorDimensions((p.doors || []).map((d: DoorRect) => ({
              ...d,
              type: normalizeDoorType(d.type),
            })), typeof p.metersPerPixel === 'number' ? p.metersPerPixel : null),
          }))
          lastPlans = normalized
          if (cancelled) return
          setFloorLabels(Array.isArray(res?.floorLabels) ? res.floorLabels : [])
          const nl = normalized.length
          const apiPerm = nl > 0 && isValidFloorPlanPerm(res?.floorPlanOrder, nl) ? (res!.floorPlanOrder as number[]) : null
          const initialOrder = nl > 0 ? (apiPerm ?? Array.from({ length: nl }, (_, i) => i)) : []
          setFloorPlanOrder(initialOrder)
          setFloorOrderDraft(initialOrder)
          floorPlanOrderRef.current = initialOrder
          if (normalized.length > 0 || attempt === 11) {
            setPlansData(normalized)
            setLoading(false)
            return
          }
        } catch (e) {
          if (isTooManyRequestsError(e)) {
            await sleep(1200 + attempt * 600)
          }
          if (attempt === 7 && !cancelled) {
            setPlansData(lastPlans)
            setLoading(false)
            return
          }
        }
        await sleep(Math.min(3000, 500 + attempt * 250))
      }
      if (!cancelled) setLoading(false)
    }
    void fetchWithRetry()
    return () => { cancelled = true }
  }, [offerId, images.length])

  const detSaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveInFlightRef = useRef<Promise<boolean> | null>(null)
  const pendingAutosaveRef = useRef(false)
  const lastSavedPayloadRef = useRef<string>('')
  const buildDetectionsPayload = useCallback((snapshot: PlanData[]) => {
    const ord = floorPlanOrderRef.current
    const n = snapshot.length
    const body: { plans: { rooms: RoomPolygon[]; doors: DoorRect[] }[]; floorPlanOrder?: number[] } = {
      plans: snapshot.map((p) => ({ rooms: p.rooms, doors: p.doors })),
    }
    if (n > 0 && ord.length === n && isValidFloorPlanPerm(ord, n)) {
      body.floorPlanOrder = ord
    }
    return JSON.stringify(body)
  }, [])
  const persistDetectionsPayload = useCallback(async (payload: string): Promise<boolean> => {
    if (!offerId) return false
    for (let attempt = 0; attempt < DETECTIONS_PATCH_MAX_ATTEMPTS; attempt++) {
      try {
        const res = (await apiFetch(`/offers/${offerId}/compute/detections-review-data`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          timeoutMs: 25_000,
        })) as { ok?: boolean }
        if (res?.ok === true) return true
      } catch (e) {
        if (isTooManyRequestsError(e)) {
          await sleep(1200 + attempt * 400)
        }
      }
      if (attempt < DETECTIONS_PATCH_MAX_ATTEMPTS - 1) {
        await sleep(detectionsPatchBackoffMs(attempt))
      }
    }
    return false
  }, [offerId])
  const saveDetectionsToServer = useCallback(async (force = false): Promise<boolean> => {
    if (!offerId) return false
    const snapshot = plansDataRef.current
    if (snapshot.length === 0) return false
    const payload = buildDetectionsPayload(snapshot)
    if (!force && payload === lastSavedPayloadRef.current) return true

    if (saveInFlightRef.current) {
      if (!force) {
        pendingAutosaveRef.current = true
        return true
      }
      await saveInFlightRef.current
    }

    const requestPromise = persistDetectionsPayload(payload)
    saveInFlightRef.current = requestPromise
    const ok = await requestPromise
    if (saveInFlightRef.current === requestPromise) saveInFlightRef.current = null

    if (ok) {
      lastSavedPayloadRef.current = payload
    } else {
      console.error('[DetectionsReviewEditor] PATCH detections-review-data failed')
    }

    if (!force && pendingAutosaveRef.current && !saveInFlightRef.current) {
      pendingAutosaveRef.current = false
      const latestPayload = buildDetectionsPayload(plansDataRef.current)
      if (latestPayload !== lastSavedPayloadRef.current) {
        void saveDetectionsToServer(false)
      }
    }
    return ok
  }, [offerId, buildDetectionsPayload, persistDetectionsPayload])
  useEffect(() => {
    if (!offerId || loading || plansData.length === 0) return
    if (detSaveDebounceRef.current) clearTimeout(detSaveDebounceRef.current)
    detSaveDebounceRef.current = setTimeout(() => {
      void saveDetectionsToServer()
    }, 700)
    return () => {
      if (detSaveDebounceRef.current) clearTimeout(detSaveDebounceRef.current)
    }
  }, [plansData, floorPlanOrder, offerId, loading, saveDetectionsToServer])

  const setRooms = useCallback((planIdx: number, rooms: RoomPolygon[]) => {
    setPlansData((prev) => {
      const next = [...prev]
      if (planIdx >= next.length) return next
      next[planIdx] = { ...next[planIdx], rooms }
      return next
    })
  }, [])

  const setDoors = useCallback((planIdx: number, doors: DoorRect[]) => {
    setPlansData((prev) => {
      const next = [...prev]
      if (planIdx >= next.length) return next
      const plan = next[planIdx]
      next[planIdx] = { ...plan, doors: withAutoDoorDimensions(doors, plan?.metersPerPixel) }
      return next
    })
  }, [])

  const handleConfirm = useCallback(async () => {
    if (!offerId) {
      await onConfirm()
      return
    }
    await roofEditorRef.current?.flushSave()
    let saved = true
    if (plansData.length > 0) {
      if (reorderFloorsMode && isValidFloorPlanPerm(floorOrderDraft, plansData.length)) {
        const next = [...floorOrderDraft]
        floorPlanOrderRef.current = next
        setFloorPlanOrder(next)
        setFloorOrderDraft(next)
        setReorderFloorsMode(false)
        setDragFromDisplayIdx(null)
      }
      saved = await saveDetectionsToServer(true)
      if (!saved) {
        await sleep(900)
        saved = await saveDetectionsToServer(true)
      }
    }
    if (!saved) {
      alert('Speichern der Räume/Türen ist fehlgeschlagen. Bitte erneut versuchen.')
      return
    }
    let detRes: { ok?: boolean; error?: string } = { ok: false }
    const APPROVE_POST_ATTEMPTS = 8
    for (let a = 0; a < APPROVE_POST_ATTEMPTS; a++) {
      try {
        detRes = (await apiFetch(`/offers/${offerId}/compute/detections-review-approved`, {
          method: 'POST',
          timeoutMs: 25_000,
        })) as { ok?: boolean; error?: string }
        if (detRes?.ok === true) break
      } catch {
        /* retry */
      }
      if (a < APPROVE_POST_ATTEMPTS - 1) await sleep(detectionsPatchBackoffMs(a))
    }
    if (detRes?.ok !== true) {
      alert(typeof detRes?.error === 'string' && detRes.error ? detRes.error : 'Validierung fehlgeschlagen.')
      return
    }
    try {
      await apiFetch(`/offers/${offerId}/compute/roof-review-approved`, { method: 'POST', timeoutMs: 15_000 })
    } catch {
      // roof flag best-effort
    }
    await onConfirm()
  }, [offerId, plansData, onConfirm, saveDetectionsToServer, reorderFloorsMode, floorOrderDraft])

  const handleRemoveSelected = useCallback((index?: number) => {
    const idx = index ?? selectedPolygonIndex
    if (idx === null || typeof idx !== 'number' || idx < 0) return
    pushHistory()
    const pi = planIndexClamped
    const activeTab = getTabForPlan(pi)
    if (activeTab === 'roof' || activeTab === 'roof_windows') return
    setPlansData((prev) => {
      if (pi >= prev.length) return prev
      const plan = prev[pi]
      if (!plan) return prev
      if (activeTab === 'rooms') {
        if (idx >= plan.rooms.length) return prev
        const next = plan.rooms.filter((_, i) => i !== idx)
        const nextPlan = { ...plan, rooms: next }
        const out = [...prev]
        out[pi] = nextPlan
        return out
      } else {
        if (idx >= plan.doors.length) return prev
        const next = plan.doors.filter((_, i) => i !== idx)
        const nextPlan = { ...plan, doors: next }
        const out = [...prev]
        out[pi] = nextPlan
        return out
      }
    })
    setSelectedPolygonIndex(null)
  }, [tabPerPlan, selectedPolygonIndex, planIndexClamped])

  useEffect(() => {
    const onDeleteKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isTypingTarget =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      if (isTypingTarget) return
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (selectedPolygonIndex == null) return
      e.preventDefault()
      handleRemoveSelected()
    }
    window.addEventListener('keydown', onDeleteKey)
    return () => window.removeEventListener('keydown', onDeleteKey)
  }, [selectedPolygonIndex, handleRemoveSelected])

  const handleRequestCloseNewPolygon = useCallback(() => {
    if (!newPolygonPoints || newPolygonPoints.length < 3 || !currentPlan) return
    setPendingNewRoomPoints([...newPolygonPoints])
    setNewPolygonPoints(null)
  }, [newPolygonPoints, currentPlan])

  const handlePickNewRoomType = useCallback((roomType: RoomTypeOption) => {
    if (!pendingNewRoomPoints || pendingNewRoomPoints.length < 3 || !currentPlan) return
    pushHistory()
    const typeStr = roomType as string
    const insulated = typeStr === 'Raum gedämmt'
    const next = [
      ...currentPlan.rooms,
      { points: pendingNewRoomPoints, roomType: typeStr, roomName: typeStr, roomInsulated: insulated },
    ]
    setRooms(planIndexClamped, next)
    setPendingNewRoomPoints(null)
  }, [pendingNewRoomPoints, currentPlan, planIndexClamped, setRooms, pushHistory])

  const handleRoomTypeLabelClick = useCallback((roomIndex: number) => {
    setRoomTypePopoverIndex(roomIndex)
  }, [])

  const handlePickDoorType = useCallback((doorType: DoorType) => {
    if (selectedPolygonIndex === null || planIndexClamped >= plansData.length) return
    const plan = plansData[planIndexClamped]
    if (!plan || getTabForPlan(planIndexClamped) !== 'doors' || selectedPolygonIndex >= plan.doors.length) return
    pushHistory()
    const idx = selectedPolygonIndex
    const prevType = normalizeDoorType(plan.doors[idx]?.type)
    const next = plan.doors.map((d, i) => {
      if (i !== idx) return d
      let out: DoorRect = { ...d, type: doorType }
      if ((doorType === 'window' || doorType === 'sliding_door') && prevType !== doorType) {
        out = { ...out, height_m: doorType === 'sliding_door' ? 2.0 : 1, dimensionsEdited: true }
      }
      return out
    })
    setDoors(planIndexClamped, next)
  }, [selectedPolygonIndex, planIndexClamped, plansData, setDoors, pushHistory, getTabForPlan])

  /** Nur Fenster: Höhe in cm bearbeiten (Speicherung als m). */
  const handleSetSelectedWindowHeightCm = useCallback(
    (raw: string) => {
      if (selectedPolygonIndex === null || planIndexClamped >= plansData.length) return
      const cm = round2(Number(raw))
      if (!Number.isFinite(cm) || cm <= 0) return
      const height_m = round2(cm / 100)
      const plan = plansData[planIndexClamped]
      if (!plan || selectedPolygonIndex < 0 || selectedPolygonIndex >= plan.doors.length) return
      const next = plan.doors.map((d, i) =>
        i !== selectedPolygonIndex ? d : { ...d, height_m, dimensionsEdited: true },
      )
      setDoors(planIndexClamped, next)
    },
    [selectedPolygonIndex, planIndexClamped, plansData, setDoors],
  )

  const handlePickEditRoomType = useCallback((roomType: RoomTypeOption) => {
    if (roomTypePopoverIndex === null || planIndexClamped >= plansData.length) return
    const plan = plansData[planIndexClamped]
    if (!plan || roomTypePopoverIndex >= plan.rooms.length) return
    pushHistory()
    const typeStr = roomType as string
    const insulated = typeStr === 'Raum gedämmt'
    const next = plan.rooms.map((r, i) =>
      i !== roomTypePopoverIndex ? r : { ...r, roomType: typeStr, roomName: typeStr, roomInsulated: insulated },
    )
    setRooms(planIndexClamped, next)
    setRoomTypePopoverIndex(null)
  }, [roomTypePopoverIndex, planIndexClamped, plansData, setRooms, pushHistory])

  useEffect(() => {
    setSelectedPolygonIndex(null)
    setNewPolygonPoints(null)
    setPendingNewDoorBbox(null)
  }, [planIndex])

  useEffect(() => {
    if (newPolygonPoints?.length !== 2 || getTabForPlan(planIndexClamped) !== 'doors') return
    const [a, b] = newPolygonPoints
    const bbox: [number, number, number, number] = [
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[0], b[0]),
      Math.max(a[1], b[1]),
    ]
    setNewPolygonPoints(null)

    const plan = plansData[planIndexClamped]
    if (!plan) return

    if (newDoorType === 'window') {
      setPendingNewDoorBbox(bbox)
      setPendingNewDoorType(newDoorType)
      setNewDoorDims({ width: '', height: '' })
      return
    }

    const mpp = plan.metersPerPixel
    const { width_m, height_m } = computeAutoOpeningMetersFromBbox(bbox, newDoorType, mpp)
    pushHistory()
    setDoors(planIndexClamped, [
      ...plan.doors,
      {
        bbox,
        type: newDoorType,
        width_m,
        height_m,
        dimensionsEdited: true,
      },
    ])
  }, [newPolygonPoints, planIndexClamped, getTabForPlan, plansData, newDoorType, pushHistory, setDoors])

  const activeTab = getTabForPlan(planIndexClamped)

  const roofSurfaceTabForChild: RoofSurfaceTab =
    activeTab === 'roof_windows' ? 'windows' : 'surfaces'

  const setRoofSurfaceTabForEditor = useCallback(
    (tabOrUpdater: SetStateAction<RoofSurfaceTab>) => {
      setTabPerPlan((prev) => {
        const planIdx = planIndexClamped
        const raw = prev[planIdx]
        const curMain: ReviewTab = roofOnlyOffer
          ? raw === 'roof_windows'
            ? 'roof_windows'
            : 'roof'
          : (raw ?? 'rooms')
        if (curMain !== 'roof' && curMain !== 'roof_windows') {
          return prev
        }
        const curSurface: RoofSurfaceTab = curMain === 'roof_windows' ? 'windows' : 'surfaces'
        const next =
          typeof tabOrUpdater === 'function' ? tabOrUpdater(curSurface) : tabOrUpdater
        const nextReview: ReviewTab = next === 'windows' ? 'roof_windows' : 'roof'
        return { ...prev, [planIdx]: nextReview }
      })
    },
    [planIndexClamped, roofOnlyOffer],
  )

  const handleUndo = useCallback(() => {
    if (activeTab === 'roof' || activeTab === 'roof_windows') {
      roofEditorRef.current?.roofUndo?.()
      return
    }
    setHistory((h) => {
      if (h.length === 0) return h
      const prev = h[h.length - 1]
      skipNextPushRef.current = true
      setPlansData(JSON.parse(JSON.stringify(prev)))
      return h.slice(0, -1)
    })
  }, [activeTab])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isUndo = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey
      if (!isUndo) return
      e.preventDefault()
      handleUndo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleUndo])

  useEffect(() => {
    if (!pendingNewDoorBbox) return
    const id = window.requestAnimationFrame(() => {
      const el = newWindowHeightInputRef.current
      el?.focus()
      el?.select()
    })
    return () => window.cancelAnimationFrame(id)
  }, [pendingNewDoorBbox])

  const handleConfirmNewWindowHeight = useCallback(() => {
    if (!pendingNewDoorBbox || planIndexClamped >= plansData.length) return
    const heightCm = round2(Number(newDoorDims.height))
    if (!Number.isFinite(heightCm) || heightCm <= 0) return
    const height = round2(heightCm / 100)
    const plan = plansData[planIndexClamped]
    if (!plan) return
    const width_m = computeWindowOpeningWidthMetersFromBbox(
      pendingNewDoorBbox,
      plan.metersPerPixel,
      plan.imageWidth,
      plan.imageHeight,
    )
    pushHistory()
    setDoors(planIndexClamped, [
      ...plan.doors,
      {
        bbox: pendingNewDoorBbox,
        type: pendingNewDoorType ?? 'window',
        width_m,
        height_m: height,
        dimensionsEdited: true,
      },
    ])
    setPendingNewDoorBbox(null)
    setPendingNewDoorType(null)
    setNewDoorDims({ width: '', height: '' })
  }, [pendingNewDoorBbox, pendingNewDoorType, planIndexClamped, plansData, newDoorDims, pushHistory, setDoors])

  /** Kurze Hinweise; bei Türen/Fenstern kein langer Edit-Text. */
  const toolHint =
    activeTab === 'roof_windows'
      ? tool === 'select'
        ? 'Element wählen und ziehen zum Verschieben'
        : tool === 'add'
          ? 'Zwei Ecken für Dachfenster setzen (Rechteck)'
          : tool === 'remove'
            ? 'Element zum Entfernen anklicken'
            : tool === 'edit'
              ? 'Punkte und Kanten ziehen'
              : ''
      : activeTab === 'roof'
        ? tool === 'select'
          ? 'Auf Element klicken und ziehen zum Verschieben'
          : tool === 'add'
            ? 'Klicken Sie um Punkte zu setzen – ersten Punkt erneut klicken zum Schließen'
            : tool === 'remove'
              ? 'Element zum Entfernen anklicken'
              : tool === 'edit'
                ? 'Punkte und Kanten ziehen'
                : ''
        : tool === 'select' && activeTab === 'doors'
          ? 'Element wählen und ziehen zum Verschieben'
          : tool === 'select'
            ? 'Auf Element klicken und ziehen zum Verschieben'
            : tool === 'add' && activeTab === 'rooms'
              ? 'Klicken Sie um Punkte zu setzen – ersten Punkt erneut klicken zum Schließen'
              : tool === 'add' && activeTab === 'doors'
                ? 'Zwei Ecken für Öffnung ziehen (Rechteck)'
                : tool === 'remove'
                  ? 'Element zum Entfernen anklicken'
                  : tool === 'edit'
                    ? 'Punkte und Kanten ziehen'
                    : ''

  const handleInsertVertex = useCallback((planIdx: number, polyIndex: number, afterVertexIndex: number, x: number, y: number) => {
    const plan = plansData[planIdx]
    if (!plan || polyIndex >= plan.rooms.length || afterVertexIndex < 0) return
    pushHistory()
    const pts = plan.rooms[polyIndex].points
    const newPts = [...pts.slice(0, afterVertexIndex + 1), [x, y] as Point, ...pts.slice(afterVertexIndex + 1)]
    setRooms(planIdx, plan.rooms.map((r, i) => i !== polyIndex ? r : { points: newPts }))
  }, [plansData, setRooms, pushHistory])

  const showRoofWorkspace =
    roofOnlyOffer || activeTab === 'roof' || activeTab === 'roof_windows'
  const showRoomsCanvas =
    !roofOnlyOffer &&
    activeTab !== 'roof' &&
    activeTab !== 'roof_windows' &&
    plansData.length > 0

  const showWerkzeuge =
    !roofOnlyOffer || (!!offerId && roofImgs.length > 0 && !loading)

  const reviewFooterActions = (
    <div className="shrink-0 flex flex-wrap items-center justify-center gap-2 px-2 pt-1 w-full">
      <button
        type="button"
        onClick={async () => {
          if (isConfirming) return
          setIsConfirming(true)
          try {
            await handleConfirm()
          } finally {
            setIsConfirming(false)
          }
        }}
        disabled={isConfirming}
        className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-[#1a0f0a] shadow-lg transition-all duration-200 ease-out bg-gradient-to-b from-[#c9a800] to-[#E5B800] hover:brightness-110 hover:-translate-y-[0.5px] active:translate-y-0"
      >
        <Check size={18} />
        {isConfirming ? 'Speichern…' : 'Erkennung bestätigen – weiter'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sand/90 border border-white/30 hover:bg-white/10 transition-all"
      >
        <X size={18} />
        Abbrechen
      </button>
    </div>
  )

  return (
    <div className="relative w-full flex flex-col items-stretch gap-3 flex-1 min-h-0">
      {/*
        1fr | auto | 1fr: titlu + Werkzeuge rămân centrate pe lățimea completă; etajele sunt doar în coloana stângă.
      */}
      <div className="grid w-full shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-x-3 px-2 pt-1 pb-1 min-w-0">
        <div className="flex min-h-0 min-w-0 flex-col items-start justify-center gap-1 self-stretch">
          {!loading && n > 1 && (plansData.length > 0 || roofOnlyOffer) && !roofOnlyOffer && (
            <div className="flex w-fit max-w-full flex-col items-stretch gap-2">
              <div
                className="flex w-fit max-w-full flex-col-reverse items-stretch gap-1"
                role="tablist"
                aria-label="Etage wählen"
              >
                {(reorderFloorsMode ? floorOrderDraft : floorPlanOrder).map((planIdx, displayPos) => {
                  const label = displayFloorTabLabelDe(floorLabels[planIdx] ?? `Plan ${planIdx + 1}`)
                  const isActive = planIndexClamped === planIdx
                  return (
                    <div
                      key={`floor-tab-wrap-${planIdx}-${displayPos}`}
                      className="flex items-stretch gap-1 min-w-0"
                      onDragOver={reorderFloorsMode ? (e) => e.preventDefault() : undefined}
                      onDrop={
                        reorderFloorsMode
                          ? (e) => {
                              e.preventDefault()
                              const from = dragFromDisplayIdx
                              setDragFromDisplayIdx(null)
                              if (from === null || from === displayPos) return
                              setFloorOrderDraft((prev) => {
                                const next = [...prev]
                                const [removed] = next.splice(from, 1)
                                next.splice(displayPos, 0, removed)
                                return next
                              })
                            }
                          : undefined
                      }
                    >
                      {reorderFloorsMode && (
                        <span
                          role="button"
                          tabIndex={0}
                          draggable
                          onDragStart={() => setDragFromDisplayIdx(displayPos)}
                          onDragEnd={() => setDragFromDisplayIdx(null)}
                          className="shrink-0 flex items-center justify-center px-1 rounded-md border border-white/15 text-sand/60 cursor-grab active:cursor-grabbing hover:bg-white/10"
                          title="Ziehen zum Sortieren"
                          aria-label="Stockwerk verschieben"
                        >
                          <GripVertical size={16} />
                        </span>
                      )}
                      <button
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => {
                          setPlanIndex(planIdx)
                          setSelectedPolygonIndex(null)
                          setNewPolygonPoints(null)
                          if (tool === 'add') setTool('select')
                        }}
                        className={`flex-1 min-w-0 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium text-left whitespace-nowrap transition-colors ${
                          isActive
                            ? 'bg-[#E5B800]/25 text-[#E5B800] border border-[#E5B800]/50'
                            : 'text-sand/80 border border-white/10 hover:bg-white/5'
                        }`}
                      >
                        {label}
                      </button>
                    </div>
                  )
                })}
              </div>
              <label className="flex items-start gap-2 text-sand/80 text-xs cursor-pointer select-none max-w-[220px]">
                <input
                  type="checkbox"
                  className="mt-0.5 rounded border-white/30"
                  checked={reorderFloorsMode}
                  onChange={(e) => {
                    const on = e.target.checked
                    if (on) {
                      setFloorOrderDraft([...floorPlanOrder])
                      setReorderFloorsMode(true)
                    } else {
                      setFloorOrderDraft([...floorPlanOrder])
                      setReorderFloorsMode(false)
                      setDragFromDisplayIdx(null)
                    }
                  }}
                />
                <span>Reihenfolge der Stockwerke ändern</span>
              </label>
              {reorderFloorsMode && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={async () => {
                      const next = [...floorOrderDraft]
                      if (!isValidFloorPlanPerm(next, n)) return
                      floorPlanOrderRef.current = next
                      setFloorPlanOrder(next)
                      setReorderFloorsMode(false)
                      setDragFromDisplayIdx(null)
                      await saveDetectionsToServer(true)
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#E5B800] text-white hover:brightness-110"
                  >
                    Speichern
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFloorOrderDraft([...floorPlanOrder])
                      setReorderFloorsMode(false)
                      setDragFromDisplayIdx(null)
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border border-white/25 text-sand/90 hover:bg-white/10"
                  >
                    Abbrechen
                  </button>
                </div>
              )}
            </div>
          )}
          {!loading && n > 1 && roofOnlyOffer && (
            <div
              className="flex w-fit max-w-full flex-col-reverse items-stretch gap-1"
              role="tablist"
              aria-label="Etage wählen"
            >
              {Array.from({ length: n }).map((_, i) => {
                const label = displayFloorTabLabelDe(floorLabels[i] ?? `Plan ${i + 1}`)
                const isActive = planIndexClamped === i
                return (
                  <button
                    key={`floor-tab-roof-${i}`}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => {
                      setPlanIndex(i)
                      setSelectedPolygonIndex(null)
                      setNewPolygonPoints(null)
                      if (tool === 'add') setTool('select')
                    }}
                    className={`px-3 py-2 rounded-lg text-xs sm:text-sm font-medium text-left whitespace-nowrap transition-colors ${
                      isActive
                        ? 'bg-[#E5B800]/25 text-[#E5B800] border border-[#E5B800]/50'
                        : 'text-sand/80 border border-white/10 hover:bg-white/5'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <div className="flex min-w-0 max-w-full flex-col items-center gap-3">
          <h2 className="text-white font-semibold text-base text-center max-w-2xl leading-snug mx-auto w-full">
            {roofOnlyOffer
              ? 'Dach konfigurieren'
              : 'Flächen und Elemente auswählen'}
          </h2>

      {showWerkzeuge && (
      <div className="shrink-0 flex flex-wrap items-center justify-center gap-3 px-2 py-1">
        <span className="text-sand/60 text-xs">Werkzeuge:</span>
        <div className="flex flex-col items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              if (activeTab === 'roof' || activeTab === 'roof_windows') {
                setTool('select')
                roofEditorRef.current?.roofApplyToolFromParent?.('select')
                return
              }
              setTool('select')
              setNewPolygonPoints(null)
            }}
            title="Auswählen & Verschieben"
            className={`p-2 rounded-lg transition-colors cursor-pointer ${tool === 'select' ? 'bg-[#E5B800]/20 text-[#E5B800]' : 'text-sand/70 hover:bg-white/5'}`}
          >
            <MousePointer2 size={18} />
          </button>
          <span className="text-[10px] text-sand/60">Verschieben</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              if (activeTab === 'roof' || activeTab === 'roof_windows') {
                setTool('add')
                roofEditorRef.current?.roofApplyToolFromParent?.('add')
                return
              }
              setTool('add')
              setSelectedPolygonIndex(null)
              setNewPolygonPoints([])
            }}
            title={
              activeTab === 'rooms'
                ? 'Polygon (Zimmer) hinzufügen'
                : activeTab === 'doors'
                  ? 'Tür oder Fenster hinzufügen'
                  : activeTab === 'roof'
                    ? 'Polygon (Dachfläche) hinzufügen'
                    : 'Dachfenster hinzufügen'
            }
            className={`p-2 rounded-lg transition-colors cursor-pointer ${tool === 'add' ? 'bg-[#E5B800]/20 text-[#E5B800]' : 'text-sand/70 hover:bg-white/5'}`}
          >
            <Plus size={18} />
          </button>
          <span className="text-[10px] text-sand/60">Hinzufügen</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              if (activeTab === 'roof' || activeTab === 'roof_windows') {
                setTool('remove')
                return
              }
              setTool('remove')
            }}
            title="Klicken Sie auf ein Element zum Entfernen"
            className={`p-2 rounded-lg transition-colors cursor-pointer ${tool === 'remove' ? 'bg-[#E5B800]/20 text-[#E5B800]' : 'text-sand/70 hover:bg-white/5'}`}
          >
            <Trash2 size={18} />
          </button>
          <span className="text-[10px] text-sand/60">Löschen</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              if (activeTab === 'roof' || activeTab === 'roof_windows') {
                setTool('edit')
                return
              }
              setTool('edit')
            }}
            title="Bearbeiten: auf Element klicken, Ecken/Kanten ziehen"
            className={`p-2 rounded-lg transition-colors cursor-pointer ${tool === 'edit' ? 'bg-[#E5B800]/20 text-[#E5B800]' : 'text-sand/70 hover:bg-white/5'}`}
          >
            <Pencil size={18} />
          </button>
          <span className="text-[10px] text-sand/60">Bearbeiten</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <button
            type="button"
            onClick={handleUndo}
            disabled={
              activeTab === 'roof' || activeTab === 'roof_windows' ? false : history.length === 0
            }
            title="Rückgängig"
            className="p-2 rounded-lg transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed text-sand/70 hover:bg-white/5"
          >
            <Undo2 size={18} />
          </button>
          <span className="text-[10px] text-sand/60">Rückgängig</span>
        </div>
      </div>
      )}

      {(tool === 'add' && activeTab === 'doors') && (
        <div className="shrink-0 flex items-center justify-center gap-2 px-2 py-1.5 flex-wrap">
          <span className="text-sand/70 text-xs w-full text-center sm:w-auto">Element:</span>
          <button
            type="button"
            onClick={() => setNewDoorType('door')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${newDoorType === 'door' ? 'bg-[#22c55e]/30 text-green-300 border border-green-400/50' : 'text-sand/70 border border-white/10 hover:bg-white/5'}`}
          >
            Tür
          </button>
          <button
            type="button"
            onClick={() => setNewDoorType('window')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${newDoorType === 'window' ? 'bg-blue-500/30 text-blue-200 border border-blue-400/50' : 'text-sand/70 border border-white/10 hover:bg-white/5'}`}
          >
            Fenster
          </button>
          <button
            type="button"
            onClick={() => setNewDoorType('sliding_door')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${newDoorType === 'sliding_door' ? 'bg-cyan-500/30 text-cyan-200 border border-cyan-400/50' : 'text-sand/70 border border-white/10 hover:bg-white/5'}`}
          >
            Schiebetür
          </button>
          <button
            type="button"
            onClick={() => setNewDoorType('garage_door')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${newDoorType === 'garage_door' ? 'bg-purple-500/30 text-purple-200 border border-purple-400/50' : 'text-sand/70 border border-white/10 hover:bg-white/5'}`}
          >
            Garagentor
          </button>
          <button
            type="button"
            onClick={() => setNewDoorType('stairs')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${newDoorType === 'stairs' ? 'bg-orange-600/30 text-orange-200 border border-orange-500/50' : 'text-sand/70 border border-white/10 hover:bg-white/5'}`}
          >
            Treppe
          </button>
        </div>
      )}
      {tool === 'select' && activeTab === 'doors' && selectedPolygonIndex !== null && plansData[planIndexClamped]?.doors[selectedPolygonIndex] && (
        <div className="shrink-0 flex items-center justify-center gap-2 px-2 py-1.5 flex-wrap">
          <span className="text-sand/70 text-xs">Typ:</span>
          {(['door', 'window', 'sliding_door', 'garage_door', 'stairs'] as const).map((doorType) => {
            const labels = { door: 'Tür', window: 'Fenster', sliding_door: 'Schiebetür', garage_door: 'Garagentor', stairs: 'Treppe' }
            const current = plansData[planIndexClamped]?.doors[selectedPolygonIndex]?.type ?? 'door'
            const isActive = normalizeDoorType(current) === doorType
            const activeClasses: Record<string, string> = {
              door: 'bg-[#22c55e]/30 text-green-300 border border-green-400/50',
              window: 'bg-blue-500/30 text-blue-200 border border-blue-400/50',
              sliding_door: 'bg-cyan-500/30 text-cyan-200 border border-cyan-400/50',
              garage_door: 'bg-purple-500/30 text-purple-200 border border-purple-400/50',
              stairs: 'bg-orange-600/30 text-orange-200 border border-orange-500/50',
            }
            return (
              <button
                key={doorType}
                type="button"
                onClick={() => handlePickDoorType(doorType)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${isActive ? activeClasses[doorType] : 'text-sand/70 border border-white/10 hover:bg-white/5'}`}
              >
                {labels[doorType]}
              </button>
            )
          })}
          {normalizeDoorType(plansData[planIndexClamped]?.doors[selectedPolygonIndex]?.type) === 'window' && (
            <>
              <span className="text-sand/70 text-xs ml-2">H (cm):</span>
              <input
                type="number"
                min={1}
                step={1}
                value={(() => {
                  const h = plansData[planIndexClamped]?.doors[selectedPolygonIndex]?.height_m
                  return typeof h === 'number' ? Math.round(h * 100) : 100
                })()}
                onChange={(e) => handleSetSelectedWindowHeightCm(e.target.value)}
                className="w-[84px] rounded bg-black/40 border border-white/20 px-2 py-1 text-xs text-white"
              />
            </>
          )}
        </div>
      )}

      {toolHint && (
        <p className="shrink-0 text-xs text-sand/60 text-center px-4">
          {toolHint}
        </p>
      )}
      {showWerkzeuge && showRoofWorkspace && (
        <div ref={setRoofDimsToolbarSlotEl} className="w-full flex min-h-0 shrink-0 justify-center" />
      )}
        </div>
        <div className="min-w-0" aria-hidden="true" />
      </div>

      <div className="flex-1 min-h-0 flex flex-col px-2 pb-2 min-w-0 overflow-hidden">
        {loading && plansData.length === 0 ? (
          <div className="w-full flex-1 min-h-0 flex flex-col gap-2">
            <div className="relative w-full flex-1 min-h-[200px] rounded-lg overflow-hidden border border-[#E5B800]/50 bg-black/30 flex items-center justify-center">
              {images[0]?.url && (
                <img src={images[0].url} alt="" className="absolute inset-0 w-full h-full object-contain opacity-40" />
              )}
              <div className="relative z-10 flex flex-col items-center gap-2 text-sand/80">
                <div className="w-8 h-8 border-2 border-[#E5B800]/60 border-t-[#E5B800] rounded-full animate-spin" />
                <p className="text-sm font-medium">Lade Vektordaten…</p>
              </div>
            </div>
            <div className="shrink-0">{reviewFooterActions}</div>
          </div>
        ) : roofOnlyOffer && offerId && roofImgs.length > 0 && !loading ? (
          <div className="w-full flex-1 min-h-0 flex flex-col min-w-0 gap-2">
            {showWerkzeuge && (
              <div className="shrink-0 flex items-center justify-end gap-2 flex-wrap w-full min-w-0">
                <div className="flex gap-1 flex-wrap justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setTabForPlan(planIndexClamped, 'roof')
                      setSelectedPolygonIndex(null)
                      setNewPolygonPoints(null)
                      if (tool === 'add') setTool('select')
                      roofEditorRef.current?.roofApplyToolFromParent?.('select')
                    }}
                    className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-medium transition-colors ${activeTab === 'roof' ? 'bg-[#E5B800]/25 text-[#E5B800] border border-[#E5B800]/50' : 'text-sand/80 border border-white/10 hover:bg-white/5'}`}
                  >
                    <Home size={14} strokeWidth={2} />
                    <span>Dach</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTabForPlan(planIndexClamped, 'roof_windows')
                      setSelectedPolygonIndex(null)
                      setNewPolygonPoints(null)
                      if (tool === 'add') setTool('select')
                      roofEditorRef.current?.roofApplyToolFromParent?.('select')
                    }}
                    className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-medium transition-colors ${activeTab === 'roof_windows' ? 'bg-[#E5B800]/25 text-[#E5B800] border border-[#E5B800]/50' : 'text-sand/80 border border-white/10 hover:bg-white/5'}`}
                  >
                    <AppWindow size={14} strokeWidth={2} />
                    <span>Dachfenster</span>
                  </button>
                </div>
              </div>
            )}
            <div className="w-full flex-1 min-h-0 min-w-0 flex flex-col">
                <RoofReviewEditor
                  key={offerId ? `roof-embed-${offerId}` : 'roof-embed'}
                  ref={roofEditorRef}
                  embedded
                  chromeInParent
                  dimsToolbarPortalTarget={roofDimsToolbarSlotEl}
                  tool={tool}
                  setTool={setTool}
                  roofSurfaceTab={roofSurfaceTabForChild}
                  setRoofSurfaceTab={setRoofSurfaceTabForEditor}
                  embedPlanIndex={planIndexClamped}
                  offerId={offerId}
                  images={roofImgs}
                  embeddedPlanSeeds={roofEmbeddedSeeds}
                  layoutActive
                  onConfirm={() => {}}
                  onCancel={() => {}}
                />
            </div>
            <div className="shrink-0">{reviewFooterActions}</div>
          </div>
        ) : plansData.length === 0 && !roofOnlyOffer ? (
          <div className="flex-1 min-h-0 flex flex-col w-full gap-2 overflow-y-auto overflow-x-hidden preisdatenbank-scroll">
            <div className="shrink-0 flex flex-col gap-2 w-full flex-1 min-h-0">
              <div className="flex flex-wrap gap-4 justify-center pb-1">
                {images.slice(0, n).map((img, i) => (
                  <div key={`img-${i}`} className="flex flex-col items-center gap-1">
                    <img
                      src={img.url}
                      alt={img.caption ?? `Plan ${i + 1}`}
                      className="max-w-full max-h-[50vh] object-contain rounded-md shadow-lg"
                    />
                    {n > 1 && <span className="text-sand/70 text-xs">Plan {i + 1}</span>}
                  </div>
                ))}
              </div>
              {reviewFooterActions}
            </div>
          </div>
        ) : (
          (() => {
            const i = planIndexClamped
            const plan = plansData[i]
            const imageUrlForPlan = getBaseImageUrl(i)
            const planTab = getTabForPlan(i)
            if (!roofOnlyOffer && (!plan || !imageUrlForPlan)) return null
            return (
              <div className="w-full flex flex-col flex-1 min-h-0 min-w-0 gap-1.5">
                {!roofOnlyOffer && plan && imageUrlForPlan && (
                <div className="shrink-0 flex items-center justify-end gap-2 flex-wrap w-full min-w-0">
                  <div className="flex gap-1 flex-wrap justify-end">
                    <button
                      type="button"
                      onClick={() => { setTabForPlan(i, 'rooms'); setSelectedPolygonIndex(null); setNewPolygonPoints(null); if (tool === 'add') setTool('select') }}
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-medium transition-colors ${planTab === 'rooms' ? 'bg-[#E5B800]/25 text-[#E5B800] border border-[#E5B800]/50' : 'text-sand/80 border border-white/10 hover:bg-white/5'}`}
                    >
                      <LayoutGrid size={14} strokeWidth={2} />
                      <span>Räume</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setTabForPlan(i, 'doors'); setSelectedPolygonIndex(null); setNewPolygonPoints(null); if (tool === 'add') setTool('select') }}
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-medium transition-colors ${planTab === 'doors' ? 'bg-[#E5B800]/25 text-[#E5B800] border border-[#E5B800]/50' : 'text-sand/80 border border-white/10 hover:bg-white/5'}`}
                    >
                      <DoorOpen size={14} strokeWidth={2} />
                      <span>Fenster / Türen</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTabForPlan(i, 'roof')
                        setSelectedPolygonIndex(null)
                        setNewPolygonPoints(null)
                        if (tool === 'add') setTool('select')
                        roofEditorRef.current?.roofApplyToolFromParent?.('select')
                      }}
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-medium transition-colors ${planTab === 'roof' ? 'bg-[#E5B800]/25 text-[#E5B800] border border-[#E5B800]/50' : 'text-sand/80 border border-white/10 hover:bg-white/5'}`}
                    >
                      <Home size={14} strokeWidth={2} />
                      <span>Dach</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTabForPlan(i, 'roof_windows')
                        setSelectedPolygonIndex(null)
                        setNewPolygonPoints(null)
                        if (tool === 'add') setTool('select')
                        roofEditorRef.current?.roofApplyToolFromParent?.('select')
                      }}
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-medium transition-colors ${planTab === 'roof_windows' ? 'bg-[#E5B800]/25 text-[#E5B800] border border-[#E5B800]/50' : 'text-sand/80 border border-white/10 hover:bg-white/5'}`}
                    >
                      <AppWindow size={14} strokeWidth={2} />
                      <span>Dachfenster</span>
                    </button>
                  </div>
                </div>
                )}
                <div className="flex-1 min-h-0 min-w-0 flex flex-col gap-2">
                  {showRoomsCanvas && plan && imageUrlForPlan && (
                <div className="relative w-full flex-1 min-h-0 rounded-lg overflow-hidden border border-[#E5B800]/50 ring-1 ring-[#E5B800]/30 bg-black/30">
                  {(pendingNewRoomPoints || pendingNewDoorBbox || (roomTypePopoverIndex !== null && plansData[planIndexClamped]?.rooms[roomTypePopoverIndex])) && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 rounded-lg">
                      <div className="flex flex-wrap items-center justify-center gap-2 p-4 bg-[#1a1a1a] rounded-xl border-2 border-[#E5B800]/60 shadow-xl max-w-md">
                        {pendingNewRoomPoints ? (
                          <>
                            <span className="text-white text-sm font-medium w-full text-center">Raumart:</span>
                            {ROOM_TYPE_OPTIONS.map((opt) => (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => handlePickNewRoomType(opt)}
                                className="px-4 py-2 rounded-lg text-sm font-medium bg-[#E5B800]/25 text-[#E5B800] border border-[#E5B800]/60 hover:bg-[#E5B800]/35"
                              >
                                {opt}
                              </button>
                            ))}
                            <button type="button" onClick={() => setPendingNewRoomPoints(null)} className="text-sand/60 text-sm hover:underline mt-1">Abbrechen</button>
                          </>
                        ) : pendingNewDoorBbox ? (
                          <>
                            <span className="text-white text-sm font-medium w-full text-center">
                              {pendingNewDoorType === 'sliding_door' ? 'Neue Schiebetür – Höhe (cm)' : 'Neues Fenster – Höhe (cm)'}
                            </span>
                            <input
                              ref={newWindowHeightInputRef}
                              type="number"
                              min={1}
                              step={1}
                              placeholder="Höhe (cm)"
                              value={newDoorDims.height}
                              onChange={(e) => setNewDoorDims((prev) => ({ ...prev, height: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key !== 'Enter') return
                                e.preventDefault()
                                handleConfirmNewWindowHeight()
                              }}
                              className="w-full max-w-[200px] rounded-md bg-black/40 border border-white/20 text-white px-2 py-1 text-sm"
                            />
                            <button
                              type="button"
                              onClick={handleConfirmNewWindowHeight}
                              className="px-4 py-2 rounded-lg text-sm font-medium bg-[#E5B800]/25 text-[#E5B800] border border-[#E5B800]/60 hover:bg-[#E5B800]/35"
                            >
                              Speichern
                            </button>
                            <button
                              type="button"
                              onClick={() => { setPendingNewDoorBbox(null); setNewDoorDims({ width: '', height: '' }) }}
                              className="text-sand/60 text-sm hover:underline mt-1"
                            >
                              Abbrechen
                            </button>
                          </>
                        ) : roomTypePopoverIndex !== null ? (
                          <>
                            <span className="text-white text-sm font-medium w-full text-center">Raumtyp ändern:</span>
                            {ROOM_TYPE_OPTIONS.map((opt) => (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => handlePickEditRoomType(opt)}
                                className="px-4 py-2 rounded-lg text-sm font-medium bg-[#E5B800]/25 text-[#E5B800] border border-[#E5B800]/60 hover:bg-[#E5B800]/35"
                              >
                                {opt}
                              </button>
                            ))}
                            <button type="button" onClick={() => setRoomTypePopoverIndex(null)} className="text-sand/60 text-sm hover:underline mt-1">Schließen</button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  )}
                  <DetectionsPolygonCanvas
                    key={`plan-${i}`}
                    imageUrl={imageUrlForPlan}
                    imageWidth={plan.imageWidth}
                    imageHeight={plan.imageHeight}
                    rooms={plan.rooms}
                    doors={plan.doors}
                    tab={planTab === 'doors' ? 'doors' : 'rooms'}
                    tool={tool}
                    selectedIndex={selectedPolygonIndex}
                    newPoints={tool === 'add' ? newPolygonPoints : null}
                    newDoorType={newDoorType}
                    onInsertVertex={planTab === 'rooms' ? (polyIndex: number, afterVertexIndex: number, x: number, y: number) => handleInsertVertex(i, polyIndex, afterVertexIndex, x, y) : undefined}
                    onSelect={setSelectedPolygonIndex}
                    onAddPoint={(x: number, y: number) => setNewPolygonPoints((prev) => prev ? [...prev, [x, y]] : [[x, y]])}
                    onCloseNewPolygon={handleRequestCloseNewPolygon}
                    onRoomTypeLabelClick={handleRoomTypeLabelClick}
                    onMoveVertex={(polyIndex: number, vertexIndex: number, x: number, y: number) => {
                      if (planTab === 'rooms') {
                        const next = plan.rooms.map((r, ri) =>
                          ri !== polyIndex ? r : { ...r, points: r.points.map((p: Point, vi: number) => vi === vertexIndex ? [x, y] as Point : p) }
                        )
                        setRooms(i, next)
                      } else {
                        const d = plan.doors[polyIndex]
                        const [x1, y1, x2, y2] = d.bbox
                        const corners: Point[] = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
                        corners[vertexIndex] = [x, y]
                        const nx1 = Math.min(...corners.map((c) => c[0]))
                        let nx2 = Math.max(...corners.map((c) => c[0]))
                        const ny1 = Math.min(...corners.map((c) => c[1]))
                        let ny2 = Math.max(...corners.map((c) => c[1]))
                        const minPx = 1
                        if (nx2 - nx1 < minPx) nx2 = nx1 + minPx
                        if (ny2 - ny1 < minPx) ny2 = ny1 + minPx
                        const next = plan.doors.map((dr, ri) => ri !== polyIndex ? dr : { ...dr, bbox: [nx1, ny1, nx2, ny2] as [number, number, number, number] })
                        setDoors(i, next)
                      }
                    }}
                    onRemoveSelected={(index?: number) => handleRemoveSelected(index)}
                    onEditStart={pushHistory}
                    onRoomsChange={(rooms: RoomPolygon[]) => setRooms(i, rooms)}
                    onDoorsChange={(doors: DoorRect[]) => setDoors(i, doors)}
                    onDoorHover={undefined}
                    onDoorActivate={undefined}
                  />
                </div>
                )}
                {offerId && roofImgs.length > 0 && (
                  <div
                    className={`w-full flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden ${showRoofWorkspace ? '' : 'hidden'}`}
                  >
                    <RoofReviewEditor
                      key={offerId ? `roof-embed-${offerId}` : 'roof-embed'}
                      ref={roofEditorRef}
                      embedded
                      chromeInParent
                      dimsToolbarPortalTarget={roofDimsToolbarSlotEl}
                      tool={tool}
                      setTool={setTool}
                      roofSurfaceTab={roofSurfaceTabForChild}
                      setRoofSurfaceTab={setRoofSurfaceTabForEditor}
                      embedPlanIndex={planIndexClamped}
                      offerId={offerId}
                      images={roofImgs}
                      embeddedPlanSeeds={roofEmbeddedSeeds}
                      layoutActive={showRoofWorkspace}
                      onConfirm={() => {}}
                      onCancel={() => {}}
                    />
                  </div>
                )}
                {!roofOnlyOffer && planTab === 'doors' && (
                  <div className="shrink-0 rounded-xl border border-[#E5B800]/40 bg-black/25 p-2">
                    <p className="text-sand/80 text-xs font-normal leading-snug text-center">
                      Maße aus Planmaßstab. Fenster: Höhe beim Anlegen eingeben. Schiebetüren: Höhe fix 2,00 m, Breite aus der langen Seite.
                    </p>
                  </div>
                )}
                  <div className="shrink-0">{reviewFooterActions}</div>
                </div>
              </div>
            )
          })()
        )}
      </div>
    </div>
  )
}
