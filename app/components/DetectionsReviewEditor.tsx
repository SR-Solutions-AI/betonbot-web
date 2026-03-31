'use client'
/**
 * Editor verificare detecții: camere (poligoane + etichete) și uși/geamuri.
 * Datele vin din detections_review_data.json (API compute/detections-review-data):
 * - Etichete camere = room_scales.json (pipeline per-crop Gemini, OCR exact).
 * - Tipuri uși/geamuri = doors_types.json (Gemini) + euristică aspect – aceeași clasificare ca în LiveFeed.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  LayoutGrid,
  DoorOpen,
  Home,
  MousePointer2,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Undo2,
} from 'lucide-react'
import { DetectionsPolygonCanvas, type Point, type RoomPolygon, type DoorRect } from './DetectionsPolygonCanvas'
import { RoofReviewEditor, type RoofReviewEditorHandle } from './RoofReviewEditor'
import { apiFetch } from '../lib/supabaseClient'

/** Unire vârfuri consecutive foarte apropiate (în px imagine) – la randarea poligoanelor prima dată. */
const MERGE_VERTEX_DIST_PX = 14

/** Tip canonic pentru uși/ferestre: door | window | garage_door | stairs (pentru culori distincte în editor). */
function normalizeDoorType(type: string | undefined): string {
  const t = (type || 'door').toLowerCase().trim()
  if (t === 'window' || t === 'fenster' || t === 'geam') return 'window'
  if (t === 'garage_door' || t === 'garagentor') return 'garage_door'
  if (t === 'stairs' || t === 'treppe') return 'stairs'
  return 'door'
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

export type ReviewTab = 'rooms' | 'doors' | 'roof'

export type ReviewImage = { url: string; caption?: string }

type Tool = 'select' | 'add' | 'remove' | 'edit'

type PlanData = {
  imageWidth: number
  imageHeight: number
  metersPerPixel?: number | null
  rooms: RoomPolygon[]
  doors: DoorRect[]
}

type DoorType = 'door' | 'window' | 'garage_door' | 'stairs'
const isEditableOpeningType = (t?: string) => {
  const nt = normalizeDoorType(t)
  return nt === 'door' || nt === 'window' || nt === 'garage_door'
}
const round2 = (v: number) => Math.round(v * 100) / 100
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const isTooManyRequestsError = (err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /too many requests|throttle/i.test(msg)
}

const DETECTIONS_PATCH_MAX_ATTEMPTS = 10
function detectionsPatchBackoffMs(attempt: number): number {
  return Math.min(5000, 400 * 2 ** attempt)
}

function computeOpeningWidthMeters(door: DoorRect, metersPerPixel: number | null | undefined): number | null {
  const [x1, y1, x2, y2] = door.bbox
  const widthPx = Math.abs(x2 - x1)
  const heightPx = Math.abs(y2 - y1)
  const normalizedType = normalizeDoorType(door.type) as DoorType
  const pxValue = normalizedType === 'window' ? Math.max(widthPx, heightPx) : Math.min(widthPx, heightPx)
  if (!metersPerPixel || metersPerPixel <= 0) return null
  return round2(pxValue * metersPerPixel)
}

function computeWindowHeightMeters(widthMeters: number): number {
  if (widthMeters <= 1) return 0.8
  if (widthMeters <= 2) return 1.5
  return 2.0
}

function computeOpeningHeightMeters(door: DoorRect, widthMeters: number | null): number | null {
  if (widthMeters == null) return null
  const normalizedType = normalizeDoorType(door.type) as DoorType
  return round2(normalizedType === 'window' ? computeWindowHeightMeters(widthMeters) : 2.0)
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
  const [loading, setLoading] = useState(true)
  const [selectedPolygonIndex, setSelectedPolygonIndex] = useState<number | null>(null)
  const [newPolygonPoints, setNewPolygonPoints] = useState<Point[] | null>(null)
  const [newDoorType, setNewDoorType] = useState<DoorType>('door')
  const [pendingNewRoomPoints, setPendingNewRoomPoints] = useState<Point[] | null>(null)
  const [pendingNewDoorBbox, setPendingNewDoorBbox] = useState<[number, number, number, number] | null>(null)
  const [roomTypePopoverIndex, setRoomTypePopoverIndex] = useState<number | null>(null)
  const [hoverDoorInfo, setHoverDoorInfo] = useState<{ index: number; x: number; y: number } | null>(null)
  const [newDoorDims, setNewDoorDims] = useState<{ width: string; height: string }>({ width: '', height: '' })
  const newDoorWidthInputRef = useRef<HTMLInputElement>(null)
  const newDoorHeightInputRef = useRef<HTMLInputElement>(null)
  const [isConfirming, setIsConfirming] = useState(false)
  const [history, setHistory] = useState<PlanData[][]>([])
  const historyLimit = 50
  const skipNextPushRef = useRef(false)
  const plansDataRef = useRef<PlanData[]>(plansData)
  const roofEditorRef = useRef<RoofReviewEditorHandle>(null)
  useEffect(() => {
    plansDataRef.current = plansData
  }, [plansData])

  const pushHistory = useCallback(() => {
    if (skipNextPushRef.current) {
      skipNextPushRef.current = false
      return
    }
    const snap = JSON.parse(JSON.stringify(plansDataRef.current)) as PlanData[]
    if (snap.length === 0) return
    setHistory((h) => [...h.slice(-(historyLimit - 1)), snap])
  }, [])

  const handleUndo = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h
      const prev = h[h.length - 1]
      skipNextPushRef.current = true
      setPlansData(JSON.parse(JSON.stringify(prev)))
      return h.slice(0, -1)
    })
  }, [])

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

  const ROOM_TYPE_OPTIONS = ['Garage', 'Balkon', 'Wintergarten', 'Raum'] as const
  type RoomTypeOption = typeof ROOM_TYPE_OPTIONS[number]

  const n = plansData.length > 0 ? plansData.length : Math.max(1, images.length)
  const planIndexClamped = n > 0 ? Math.max(0, Math.min(planIndex, n - 1)) : 0
  const currentPlan = plansData[planIndexClamped]
  // O imagine de bază per plan (fără poligoane); canvas-ul desenează rooms/doors din API
  const getBaseImageUrl = (planIdx: number) => images[planIdx]?.url ?? images[0]?.url
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
      if (roofOnlyOffer) return 'roof'
      return tabPerPlan[planIdx] ?? 'rooms'
    },
    [roofOnlyOffer, tabPerPlan],
  )
  const setTabForPlan = (planIdx: number, t: ReviewTab) =>
    setTabPerPlan((prev) => ({ ...prev, [planIdx]: t }))
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
          }
          const plans = Array.isArray(res?.plans) ? res.plans : []
          const normalized = plans.map((p) => ({
            ...p,
            metersPerPixel: typeof p.metersPerPixel === 'number' ? p.metersPerPixel : null,
            rooms: (p.rooms || []).map((r: RoomPolygon & { room_name?: string }) => ({
              ...r,
              roomType: r.roomType ?? 'Raum',
              roomName: (r.roomName ?? r.room_name ?? r.roomType ?? 'Raum').trim() || 'Raum',
              points: mergeClosePolygonPoints(r.points || [], MERGE_VERTEX_DIST_PX),
            })),
            // Tipuri uși/geamuri = aceeași clasificare ca LiveFeed (detections_review_doors.png): backend doors_types.json + euristică
            doors: withAutoDoorDimensions((p.doors || []).map((d: DoorRect) => ({
              ...d,
              type: normalizeDoorType(d.type),
            })), typeof p.metersPerPixel === 'number' ? p.metersPerPixel : null),
          }))
          lastPlans = normalized
          if (cancelled) return
          setFloorLabels(Array.isArray(res?.floorLabels) ? res.floorLabels : [])
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
    return JSON.stringify({
      plans: snapshot.map((p) => ({ rooms: p.rooms, doors: p.doors })),
    })
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
  }, [plansData, offerId, loading, saveDetectionsToServer])

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
      // roof flag best-effort; engine poate depinde doar de detections flag
    }
    await onConfirm()
  }, [offerId, plansData, onConfirm, saveDetectionsToServer])

  const handleRemoveSelected = useCallback((index?: number) => {
    const idx = index ?? selectedPolygonIndex
    if (idx === null || typeof idx !== 'number' || idx < 0) return
    pushHistory()
    const pi = planIndexClamped
    const activeTab = getTabForPlan(pi)
    if (activeTab === 'roof') return
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
    const next = [...currentPlan.rooms, { points: pendingNewRoomPoints, roomType: typeStr, roomName: typeStr }]
    setRooms(planIndexClamped, next)
    setPendingNewRoomPoints(null)
  }, [pendingNewRoomPoints, currentPlan, planIndexClamped, setRooms, pushHistory])

  const handleRoomTypeLabelClick = useCallback((roomIndex: number) => {
    setRoomTypePopoverIndex(roomIndex)
  }, [])

  const handlePickDoorType = useCallback((doorType: 'door' | 'window' | 'garage_door' | 'stairs') => {
    if (selectedPolygonIndex === null || planIndexClamped >= plansData.length) return
    const plan = plansData[planIndexClamped]
    if (!plan || getTabForPlan(planIndexClamped) !== 'doors' || selectedPolygonIndex >= plan.doors.length) return
    pushHistory()
    const next = plan.doors.map((d, i) => (i !== selectedPolygonIndex ? d : { ...d, type: doorType }))
    setDoors(planIndexClamped, next)
  }, [selectedPolygonIndex, planIndexClamped, plansData, setDoors, pushHistory])

  const handleSetSelectedDoorDimension = useCallback((axis: 'width_m' | 'height_m', raw: string) => {
    if (selectedPolygonIndex === null || planIndexClamped >= plansData.length) return
    const val = round2(Number(raw))
    if (!Number.isFinite(val) || val <= 0) return
    const plan = plansData[planIndexClamped]
    if (!plan || selectedPolygonIndex < 0 || selectedPolygonIndex >= plan.doors.length) return
    const next = plan.doors.map((d, i) =>
      i !== selectedPolygonIndex ? d : { ...d, [axis]: val, dimensionsEdited: true }
    )
    setDoors(planIndexClamped, next)
  }, [selectedPolygonIndex, planIndexClamped, plansData, setDoors])

  const handlePickEditRoomType = useCallback((roomType: RoomTypeOption) => {
    if (roomTypePopoverIndex === null || planIndexClamped >= plansData.length) return
    const plan = plansData[planIndexClamped]
    if (!plan || roomTypePopoverIndex >= plan.rooms.length) return
    pushHistory()
    const typeStr = roomType as string
    const next = plan.rooms.map((r, i) => i !== roomTypePopoverIndex ? r : { ...r, roomType: typeStr, roomName: typeStr })
    setRooms(planIndexClamped, next)
    setRoomTypePopoverIndex(null)
  }, [roomTypePopoverIndex, planIndexClamped, plansData, setRooms, pushHistory])

  useEffect(() => {
    setSelectedPolygonIndex(null)
    setNewPolygonPoints(null)
    setHoverDoorInfo(null)
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
    setPendingNewDoorBbox(bbox)
    setNewDoorDims({ width: '', height: '' })
    setNewPolygonPoints(null)
  }, [newPolygonPoints, planIndexClamped, getTabForPlan])

  useEffect(() => {
    if (!pendingNewDoorBbox) return
    const id = window.requestAnimationFrame(() => {
      const el = newDoorWidthInputRef.current
      el?.focus()
      el?.select()
    })
    return () => window.cancelAnimationFrame(id)
  }, [pendingNewDoorBbox])

  const activeTab = getTabForPlan(planIndexClamped)
  const handleCreateNewDoorWithDimensions = useCallback(() => {
    if (!pendingNewDoorBbox || planIndexClamped >= plansData.length) return
    const width = round2(Number(newDoorDims.width))
    const height = round2(Number(newDoorDims.height))
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
    const plan = plansData[planIndexClamped]
    if (!plan) return
    pushHistory()
    setDoors(planIndexClamped, [
      ...plan.doors,
      {
        bbox: pendingNewDoorBbox,
        type: newDoorType,
        width_m: width,
        height_m: height,
        dimensionsEdited: true,
      },
    ])
    setPendingNewDoorBbox(null)
    setNewDoorDims({ width: '', height: '' })
  }, [pendingNewDoorBbox, planIndexClamped, plansData, newDoorDims, newDoorType, pushHistory, setDoors])

  const toolHint =
    activeTab === 'roof'
      ? ''
      : tool === 'select' && activeTab === 'doors'
      ? 'Element wählen und ziehen zum Verschieben'
      : tool === 'select'
      ? 'Auf Element klicken und ziehen zum Verschieben'
      : tool === 'add' && activeTab === 'rooms'
        ? 'Klicken Sie um Punkte zu setzen – ersten Punkt erneut klicken zum Schließen'
        : tool === 'add' && activeTab === 'doors'
          ? 'Zwei Ecken für Tür/Fenster setzen (Rechteck)'
          : tool === 'remove'
            ? 'Klicken Sie auf ein Element, um es zu entfernen'
            : tool === 'edit'
              ? 'Eckpunkte ziehen; auf Kante klicken = neuer Punkt; Kante ziehen = Segment verschieben'
              : ''

  const handleInsertVertex = useCallback((planIdx: number, polyIndex: number, afterVertexIndex: number, x: number, y: number) => {
    const plan = plansData[planIdx]
    if (!plan || polyIndex >= plan.rooms.length || afterVertexIndex < 0) return
    pushHistory()
    const pts = plan.rooms[polyIndex].points
    const newPts = [...pts.slice(0, afterVertexIndex + 1), [x, y] as Point, ...pts.slice(afterVertexIndex + 1)]
    setRooms(planIdx, plan.rooms.map((r, i) => i !== polyIndex ? r : { points: newPts }))
  }, [plansData, setRooms, pushHistory])

  const showRoofWorkspace = roofOnlyOffer || activeTab === 'roof'
  const showRoomsCanvas = !roofOnlyOffer && activeTab !== 'roof' && plansData.length > 0

  return (
    <div className="relative w-full flex flex-col items-stretch gap-3 flex-1 min-h-0">
      <div className="shrink-0 px-2 pt-1 pb-1">
        <h2 className="text-white font-semibold text-base text-center">
          {roofOnlyOffer ? 'Dach konfigurieren' : 'Erkennung prüfen – Räume, Fenster/Türen und Dach'}
        </h2>
      </div>

      {!roofOnlyOffer && activeTab !== 'roof' && (
      <div className="shrink-0 flex flex-wrap items-center justify-center gap-3 px-2 py-1">
        <span className="text-sand/60 text-xs">Werkzeuge:</span>
        <div className="flex flex-col items-center gap-0.5">
          <button
            type="button"
            onClick={() => { setTool('select'); setNewPolygonPoints(null) }}
            title="Auswählen & Verschieben"
            className={`p-2 rounded-lg transition-colors cursor-pointer ${tool === 'select' ? 'bg-[#FF9F0F]/20 text-[#FF9F0F]' : 'text-sand/70 hover:bg-white/5'}`}
          >
            <MousePointer2 size={18} />
          </button>
          <span className="text-[10px] text-sand/60">Verschieben</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <button
            type="button"
            onClick={() => { setTool('add'); setSelectedPolygonIndex(null); setNewPolygonPoints([]) }}
            title={activeTab === 'rooms' ? 'Polygon (Zimmer) hinzufügen' : 'Tür oder Fenster hinzufügen'}
            className={`p-2 rounded-lg transition-colors cursor-pointer ${tool === 'add' ? 'bg-[#FF9F0F]/20 text-[#FF9F0F]' : 'text-sand/70 hover:bg-white/5'}`}
          >
            <Plus size={18} />
          </button>
          <span className="text-[10px] text-sand/60">Hinzufügen</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <button
            type="button"
            onClick={() => setTool('remove')}
            title="Klicken Sie auf ein Element zum Entfernen"
            className={`p-2 rounded-lg transition-colors cursor-pointer ${tool === 'remove' ? 'bg-[#FF9F0F]/20 text-[#FF9F0F]' : 'text-sand/70 hover:bg-white/5'}`}
          >
            <Trash2 size={18} />
          </button>
          <span className="text-[10px] text-sand/60">Löschen</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <button
            type="button"
            onClick={() => setTool('edit')}
            title="Bearbeiten: auf Element klicken, Ecken/Kanten ziehen"
            className={`p-2 rounded-lg transition-colors cursor-pointer ${tool === 'edit' ? 'bg-[#FF9F0F]/20 text-[#FF9F0F]' : 'text-sand/70 hover:bg-white/5'}`}
          >
            <Pencil size={18} />
          </button>
          <span className="text-[10px] text-sand/60">Bearbeiten</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <button
            type="button"
            onClick={handleUndo}
            disabled={history.length === 0}
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
          {(['door', 'window', 'garage_door', 'stairs'] as const).map((doorType) => {
            const labels = { door: 'Tür', window: 'Fenster', garage_door: 'Garagentor', stairs: 'Treppe' }
            const current = plansData[planIndexClamped]?.doors[selectedPolygonIndex]?.type ?? 'door'
            const isActive = normalizeDoorType(current) === doorType
            const activeClasses: Record<string, string> = {
              door: 'bg-[#22c55e]/30 text-green-300 border border-green-400/50',
              window: 'bg-blue-500/30 text-blue-200 border border-blue-400/50',
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
          {normalizeDoorType(plansData[planIndexClamped]?.doors[selectedPolygonIndex]?.type) !== 'stairs' && (
            <>
              <span className="text-sand/70 text-xs ml-2">B (m):</span>
              <input
                type="number"
                min={0.01}
                step={0.01}
                value={typeof plansData[planIndexClamped]?.doors[selectedPolygonIndex]?.width_m === 'number' ? plansData[planIndexClamped].doors[selectedPolygonIndex].width_m!.toFixed(2) : ''}
                onChange={(e) => handleSetSelectedDoorDimension('width_m', e.target.value)}
                className="w-[84px] rounded bg-black/40 border border-white/20 px-2 py-1 text-xs text-white"
              />
              <span className="text-sand/70 text-xs">H (m):</span>
              <input
                type="number"
                min={0.01}
                step={0.01}
                value={typeof plansData[planIndexClamped]?.doors[selectedPolygonIndex]?.height_m === 'number' ? plansData[planIndexClamped].doors[selectedPolygonIndex].height_m!.toFixed(2) : ''}
                onChange={(e) => handleSetSelectedDoorDimension('height_m', e.target.value)}
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

      {/* Tab-uri etaj: Beci, Parter, Etaj 1, etc. */}
      {!loading && n > 1 && (plansData.length > 0 || roofOnlyOffer) && (
        <div className="shrink-0 flex flex-wrap items-center justify-center gap-1 px-2 py-2 border-b border-white/10">
          {Array.from({ length: n }).map((_, i) => {
            const label = floorLabels[i] ?? `Plan ${i + 1}`
            const isActive = planIndexClamped === i
            return (
              <button
                key={`floor-tab-${i}`}
                type="button"
                onClick={() => { setPlanIndex(i); setSelectedPolygonIndex(null); setNewPolygonPoints(null); if (tool === 'add') setTool('select') }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-[#FF9F0F]/25 text-[#FF9F0F] border border-[#FF9F0F]/50' : 'text-sand/80 border border-white/10 hover:bg-white/5'}`}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden preisdatenbank-scroll px-2 py-2 flex flex-col items-center gap-4">
        {loading && plansData.length === 0 ? (
          <div className="w-full flex flex-col items-center gap-2">
            <div className="relative w-full min-h-[38vh] max-h-[50vh] rounded-lg overflow-hidden border border-[#FF9F0F]/50 bg-black/30 flex items-center justify-center">
              {images[0]?.url && (
                <img src={images[0].url} alt="" className="absolute inset-0 w-full h-full object-contain opacity-40" />
              )}
              <div className="relative z-10 flex flex-col items-center gap-2 text-sand/80">
                <div className="w-8 h-8 border-2 border-[#FF9F0F]/60 border-t-[#FF9F0F] rounded-full animate-spin" />
                <p className="text-sm font-medium">Lade Vektordaten…</p>
              </div>
            </div>
          </div>
        ) : roofOnlyOffer && offerId && roofImgs.length > 0 && !loading ? (
          <div className="w-full flex flex-col flex-1 min-h-[42vh] min-w-0">
            <RoofReviewEditor
              key={offerId ? `roof-embed-${offerId}` : 'roof-embed'}
              ref={roofEditorRef}
              embedded
              embedPlanIndex={planIndexClamped}
              offerId={offerId}
              images={roofImgs}
              embeddedPlanSeeds={roofEmbeddedSeeds}
              layoutActive
              onConfirm={() => {}}
              onCancel={() => {}}
            />
          </div>
        ) : plansData.length === 0 && !roofOnlyOffer ? (
          <div className="flex flex-wrap gap-4 justify-center">
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
        ) : (
          (() => {
            const i = planIndexClamped
            const plan = plansData[i]
            const imageUrlForPlan = getBaseImageUrl(i)
            const planTab = getTabForPlan(i)
            if (!roofOnlyOffer && (!plan || !imageUrlForPlan)) return null
            return (
              <div key={`plan-${i}`} className="w-full flex flex-col gap-1.5 flex-1 min-h-0 min-w-0">
                {!roofOnlyOffer && plan && imageUrlForPlan && (
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="text-white font-medium text-sm">
                    {floorLabels[i] ?? `Plan ${i + 1}`}
                  </h3>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => { setTabForPlan(i, 'rooms'); setSelectedPolygonIndex(null); setNewPolygonPoints(null); if (tool === 'add') setTool('select') }}
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-medium transition-colors ${planTab === 'rooms' ? 'bg-[#FF9F0F]/25 text-[#FF9F0F] border border-[#FF9F0F]/50' : 'text-sand/80 border border-white/10 hover:bg-white/5'}`}
                    >
                      <LayoutGrid size={14} strokeWidth={2} />
                      <span>Räume</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setTabForPlan(i, 'doors'); setSelectedPolygonIndex(null); setNewPolygonPoints(null); if (tool === 'add') setTool('select') }}
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-medium transition-colors ${planTab === 'doors' ? 'bg-[#FF9F0F]/25 text-[#FF9F0F] border border-[#FF9F0F]/50' : 'text-sand/80 border border-white/10 hover:bg-white/5'}`}
                    >
                      <DoorOpen size={14} strokeWidth={2} />
                      <span>Fenster / Türen</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setTabForPlan(i, 'roof'); setSelectedPolygonIndex(null); setNewPolygonPoints(null); if (tool === 'add') setTool('select') }}
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-medium transition-colors ${planTab === 'roof' ? 'bg-[#FF9F0F]/25 text-[#FF9F0F] border border-[#FF9F0F]/50' : 'text-sand/80 border border-white/10 hover:bg-white/5'}`}
                    >
                      <Home size={14} strokeWidth={2} />
                      <span>Dach</span>
                    </button>
                  </div>
                </div>
                )}
                {offerId && roofImgs.length > 0 && (
                  <div className={showRoofWorkspace ? 'w-full flex flex-col flex-1 min-h-[42vh] min-w-0' : 'hidden'}>
                    <RoofReviewEditor
                      key={offerId ? `roof-embed-${offerId}` : 'roof-embed'}
                      ref={roofEditorRef}
                      embedded
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
                {showRoomsCanvas && plan && imageUrlForPlan && (
                <div className="relative w-full min-h-[38vh] max-h-[50vh] rounded-lg overflow-hidden border border-[#FF9F0F]/50 ring-1 ring-[#FF9F0F]/30 bg-black/30">
                  {(pendingNewRoomPoints || pendingNewDoorBbox || (roomTypePopoverIndex !== null && plansData[planIndexClamped]?.rooms[roomTypePopoverIndex])) && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 rounded-lg">
                      <div className="flex flex-wrap items-center justify-center gap-2 p-4 bg-[#1a1a1a] rounded-xl border-2 border-[#FF9F0F]/60 shadow-xl max-w-md">
                        {pendingNewRoomPoints ? (
                          <>
                            <span className="text-white text-sm font-medium w-full text-center">Raumart:</span>
                            {ROOM_TYPE_OPTIONS.map((opt) => (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => handlePickNewRoomType(opt)}
                                className="px-4 py-2 rounded-lg text-sm font-medium bg-[#FF9F0F]/25 text-[#FF9F0F] border border-[#FF9F0F]/60 hover:bg-[#FF9F0F]/35"
                              >
                                {opt}
                              </button>
                            ))}
                            <button type="button" onClick={() => setPendingNewRoomPoints(null)} className="text-sand/60 text-sm hover:underline mt-1">Abbrechen</button>
                          </>
                        ) : pendingNewDoorBbox ? (
                          <>
                            <span className="text-white text-sm font-medium w-full text-center">Maße für neues Element (m):</span>
                            <div className="w-full flex items-center gap-2">
                              <input
                                ref={newDoorWidthInputRef}
                                type="number"
                                min={0.01}
                                step={0.01}
                                placeholder="Breite (m)"
                                value={newDoorDims.width}
                                onChange={(e) => setNewDoorDims((prev) => ({ ...prev, width: e.target.value }))}
                                onKeyDown={(e) => {
                                  if (e.key !== 'Enter') return
                                  e.preventDefault()
                                  newDoorHeightInputRef.current?.focus()
                                  newDoorHeightInputRef.current?.select()
                                }}
                                className="w-full rounded-md bg-black/40 border border-white/20 text-white px-2 py-1 text-sm"
                              />
                              <input
                                ref={newDoorHeightInputRef}
                                type="number"
                                min={0.01}
                                step={0.01}
                                placeholder="Höhe (m)"
                                value={newDoorDims.height}
                                onChange={(e) => setNewDoorDims((prev) => ({ ...prev, height: e.target.value }))}
                                onKeyDown={(e) => {
                                  if (e.key !== 'Enter') return
                                  e.preventDefault()
                                  handleCreateNewDoorWithDimensions()
                                }}
                                className="w-full rounded-md bg-black/40 border border-white/20 text-white px-2 py-1 text-sm"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={handleCreateNewDoorWithDimensions}
                              className="px-4 py-2 rounded-lg text-sm font-medium bg-[#FF9F0F]/25 text-[#FF9F0F] border border-[#FF9F0F]/60 hover:bg-[#FF9F0F]/35"
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
                                className="px-4 py-2 rounded-lg text-sm font-medium bg-[#FF9F0F]/25 text-[#FF9F0F] border border-[#FF9F0F]/60 hover:bg-[#FF9F0F]/35"
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
                        let nx1 = Math.min(...corners.map((c) => c[0]))
                        let nx2 = Math.max(...corners.map((c) => c[0]))
                        let ny1 = Math.min(...corners.map((c) => c[1]))
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
                    onDoorHover={(payload) => {
                      if (!payload) {
                        setHoverDoorInfo(null)
                        return
                      }
                      const d = plan.doors[payload.index]
                      if (!d || !isEditableOpeningType(d.type)) {
                        setHoverDoorInfo(null)
                        return
                      }
                      setHoverDoorInfo(payload)
                    }}
                    onDoorActivate={undefined}
                  />
                  {activeTab === 'doors' && hoverDoorInfo && (
                    <div
                      className="absolute z-20 rounded-md border border-white/20 bg-black/85 px-2 py-1 text-[11px] text-white min-w-[130px]"
                      style={{
                        left: `${Math.max(8, hoverDoorInfo.x + 8)}px`,
                        top: `${Math.max(8, hoverDoorInfo.y + 8)}px`,
                      }}
                    >
                      {(() => {
                        const d = plan.doors[hoverDoorInfo.index]
                        return (
                          <>
                            <div>B: {typeof d?.width_m === 'number' ? `${d.width_m.toFixed(2)} m` : '-'}</div>
                            <div>H: {typeof d?.height_m === 'number' ? `${d.height_m.toFixed(2)} m` : '-'}</div>
                          </>
                        )
                      })()}
                    </div>
                  )}
                </div>
                )}
              </div>
            )
          })()
        )}
      </div>

      <div className="shrink-0 flex flex-wrap items-center justify-center gap-2 px-2 py-2">
        <button
          type="button"
          onClick={async () => {
            if (isConfirming) return
            setIsConfirming(true)
            try { await handleConfirm() } finally { setIsConfirming(false) }
          }}
          disabled={isConfirming}
          className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-[#ffffff] shadow-lg transition-all duration-200 ease-out bg-gradient-to-b from-[#e08414] to-[#f79116] hover:brightness-110 hover:-translate-y-[0.5px] active:translate-y-0"
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
    </div>
  )
}
