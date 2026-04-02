'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, MousePointer2, Pencil, Plus, Trash2, Undo2, X } from 'lucide-react'
import { DetectionsPolygonCanvas, type Point, type RoomPolygon, type DoorRect } from './DetectionsPolygonCanvas'
import { apiFetch } from '../lib/supabaseClient'
import { displayFloorTabLabelDe } from '@/lib/displayFloorTabLabelDe'
import {
  DEFAULT_ROOF_ANGLE,
  DEFAULT_ROOF_OVERHANG_M,
  DEFAULT_ROOF_TYPE,
  ROOF_TYPE_OPTIONS,
  roofTypeLabelDe,
  type RoofTypeId,
} from '../lib/roofTypeOptions'

type ReviewImage = { url: string; caption?: string }

type PlanData = {
  imageWidth: number
  imageHeight: number
  rectangles: RoomPolygon[]
  /** Dachfenster (Rechtecke), strikt innerhalb der Dachflächen-Polylines. */
  doors: DoorRect[]
}

export type RoofSurfaceTab = 'surfaces' | 'windows'

type Tool = 'select' | 'add' | 'remove' | 'edit'

function nextRoofLabel(rects: RoomPolygon[]): string {
  let max = -1
  for (const r of rects) {
    const m = /^S(\d+)$/.exec((r.roomName || '').trim())
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `S${max + 1}`
}

function clampRoofOverhangM(v: number): number {
  return Math.max(0, Math.min(5, v))
}

/** UI: centimetri; `roofOverhangM` rămâne în metri (0–5 m → 0–500 cm). */
const ROOF_OVERHANG_CM_MAX = 500

function normalizeRect(r: {
  points: Point[]
  roomName?: string
  roomType?: string
  roofAngleDeg?: number
  roofType?: string
  roofOverhangM?: number
}): RoomPolygon {
  let ang = typeof r.roofAngleDeg === 'number' && Number.isFinite(r.roofAngleDeg) ? r.roofAngleDeg : DEFAULT_ROOF_ANGLE
  ang = Math.max(0, Math.min(60, ang))
  const allowed = new Set(['0_w', '1_w', '2_w', '4_w', '4.5_w'])
  const rt = typeof r.roofType === 'string' && allowed.has(r.roofType) ? (r.roofType as RoofTypeId) : DEFAULT_ROOF_TYPE
  let oh =
    typeof r.roofOverhangM === 'number' && Number.isFinite(r.roofOverhangM) ? r.roofOverhangM : DEFAULT_ROOF_OVERHANG_M
  oh = clampRoofOverhangM(oh)
  return {
    points: r.points || [],
    roomName: r.roomName,
    roomType: r.roomType,
    roofAngleDeg: ang,
    roofType: rt,
    roofOverhangM: oh,
  }
}

function parseDecimalField(s: string, min: number, max: number): number | null {
  const t = s.replace(',', '.').trim()
  if (t === '' || t === '-' || t === '.' || t === '-.') return null
  const v = parseFloat(t)
  if (!Number.isFinite(v)) return null
  return Math.max(min, Math.min(max, v))
}

function overhangMetersToCmStr(meters: number): string {
  const cm = Math.round(meters * 1000) / 10
  if (Math.abs(cm - Math.round(cm)) < 1e-9) return String(Math.round(cm))
  return String(cm)
}

function parseOverhangCmToMeters(s: string): number | null {
  const cm = parseDecimalField(s, 0, ROOF_OVERHANG_CM_MAX)
  if (cm == null) return null
  return clampRoofOverhangM(cm / 100)
}

function fallbackFloorLabelDe(index: number): string {
  if (index <= 0) return 'Erdgeschoss'
  return 'Obergeschoss'
}

function pointInRoofPoly(px: number, py: number, points: Point[]): boolean {
  if (points.length < 3) return false
  let inside = false
  const n = points.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Alle vier Ecken des BBOX liegen in demselben Dach-Rechteck-Polygon. */
function bboxFullyInsideSomeRoofRect(bbox: [number, number, number, number], rects: RoomPolygon[]): boolean {
  const [x1, y1, x2, y2] = bbox
  const corners: Point[] = [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ]
  for (const r of rects) {
    const pts = r.points
    if (pts.length < 3) continue
    if (corners.every((c) => pointInRoofPoly(c[0], c[1], pts))) return true
  }
  return false
}

/** Skaliert Rechteck vom Mittelpunkt, bis es in eine Dachfläche passt (oder null). */
function clipBboxToRoofRects(bbox: [number, number, number, number], rects: RoomPolygon[]): [number, number, number, number] | null {
  if (bboxFullyInsideSomeRoofRect(bbox, rects)) return bbox
  const [x1, y1, x2, y2] = bbox
  const cx = (x1 + x2) / 2
  const cy = (y1 + y2) / 2
  let w = Math.abs(x2 - x1)
  let h = Math.abs(y2 - y1)
  if (w < 1 || h < 1) return null
  for (let s = 0.99; s >= 0.05; s -= 0.02) {
    const hw = (w * s) / 2
    const hh = (h * s) / 2
    const bb: [number, number, number, number] = [cx - hw, cy - hh, cx + hw, cy + hh]
    if (bboxFullyInsideSomeRoofRect(bb, rects)) return bb
  }
  return null
}

function filterDoorsToRoofRects(doors: DoorRect[], rects: RoomPolygon[]): DoorRect[] {
  return doors.filter((d) => bboxFullyInsideSomeRoofRect(d.bbox, rects))
}

function normalizeRoofDoor(d: { bbox?: number[]; width_m?: number; height_m?: number }): DoorRect | null {
  const raw = Array.isArray(d?.bbox) ? d.bbox : null
  if (!raw || raw.length < 4) return null
  const bbox = [raw[0], raw[1], raw[2], raw[3]] as [number, number, number, number]
  const out: DoorRect = { bbox, type: 'window' }
  if (typeof d.width_m === 'number' && Number.isFinite(d.width_m) && d.width_m > 0) out.width_m = d.width_m
  if (typeof d.height_m === 'number' && Number.isFinite(d.height_m) && d.height_m > 0) out.height_m = d.height_m
  return out
}

function roofPlanLabelDe(labels: string[], index: number): string {
  const raw = labels[index]
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    // Ignore generic placeholders and show a localized fallback instead.
    if (trimmed && !/^plan\s+\d+$/i.test(trimmed)) return displayFloorTabLabelDe(trimmed)
  }
  return fallbackFloorLabelDe(index)
}

export type RoofReviewEditorHandle = {
  flushSave: () => Promise<boolean>
  roofUndo: () => void
  /** Sincronizare gesturi (puncte, dialog add) după ce părintele a schimbat Werkzeug-ul. */
  roofApplyToolFromParent: (t: Tool) => void
}

type RoofReviewEditorProps = {
  offerId?: string
  images: ReviewImage[]
  onConfirm: () => void | Promise<void>
  onCancel: () => void
  /** betonbot: shift roof preview thumbnails from orange toward yellow */
  roofUiVariant?: 'holzbot' | 'betonbot'
  /**
   * În editorul unificat: fără titlu/footer proprii; etajul urmește tab-urile părinte.
   */
  embedded?: boolean
  /** Când e setat (și embedded), folosim acest index în loc de tab-urile interne de etaj. */
  embedPlanIndex?: number
  /**
   * Editor unificat: dimensiuni imagine din tab Räume (înainte de roof-review-data), ca blueprint-ul să apară la fel.
   */
  embeddedPlanSeeds?: Array<{ imageWidth: number; imageHeight: number }>
  /** False când tab-ul Dach e ascuns (display:none) — recalculează canvas la activare. */
  layoutActive?: boolean
  /**
   * Editor unificat: Werkzeuge + Ansicht + Hinweis sunt în DetectionsReviewEditor (aceeași ordine ca Räume).
   * Cere `tool` / `setTool` / `roofSurfaceTab` / `setRoofSurfaceTab` din părinte.
   */
  chromeInParent?: boolean
  /** Când e setat (editor unificat), Maße Dachfenster se randă aici (sub Hinweis), nu sub rândul Räume. */
  dimsToolbarPortalTarget?: HTMLElement | null
  tool?: Tool
  setTool?: Dispatch<SetStateAction<Tool>>
  roofSurfaceTab?: RoofSurfaceTab
  setRoofSurfaceTab?: Dispatch<SetStateAction<RoofSurfaceTab>>
}

export const RoofReviewEditor = forwardRef<RoofReviewEditorHandle, RoofReviewEditorProps>(function RoofReviewEditor(
  {
    offerId,
    images,
    onConfirm,
    onCancel,
    roofUiVariant = 'betonbot',
    embedded = false,
    embedPlanIndex,
    embeddedPlanSeeds,
    layoutActive = true,
    chromeInParent = false,
    dimsToolbarPortalTarget,
    tool: toolProp,
    setTool: setToolProp,
    roofSurfaceTab: roofSurfaceTabProp,
    setRoofSurfaceTab: setRoofSurfaceTabProp,
  },
  ref,
) {
  const [toolInternal, setToolInternal] = useState<Tool>('select')
  const chromeParent = Boolean(
    chromeInParent &&
      embedded &&
      setToolProp &&
      setRoofSurfaceTabProp &&
      toolProp !== undefined &&
      roofSurfaceTabProp !== undefined,
  )
  const tool = chromeParent ? toolProp! : toolInternal
  const setTool = chromeParent ? setToolProp! : setToolInternal
  /** Einheitlicher Editor mit Parent-Chrome: weniger Abstand, kompaktere Fläche unter dem Plan. */
  const compactUi = chromeParent

  const [planIndexInternal, setPlanIndexInternal] = useState(0)
  const planIndex =
    embedded && typeof embedPlanIndex === 'number' && embedPlanIndex >= 0 ? embedPlanIndex : planIndexInternal
  const [plansData, setPlansData] = useState<PlanData[]>([])
  const [floorLabels, setFloorLabels] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPolygonIndex, setSelectedPolygonIndex] = useState<number | null>(null)
  const [newPolygonPoints, setNewPolygonPoints] = useState<Point[] | null>(null)
  const [history, setHistory] = useState<PlanData[][]>([])
  const historyLimit = 50
  const skipNextPushRef = useRef(false)
  const plansDataRef = useRef<PlanData[]>(plansData)

  const [roofSurfaceTabInternal, setRoofSurfaceTabInternal] = useState<RoofSurfaceTab>('surfaces')
  const roofSurfaceTab = chromeParent ? roofSurfaceTabProp! : roofSurfaceTabInternal
  const setRoofSurfaceTab = chromeParent ? setRoofSurfaceTabProp! : setRoofSurfaceTabInternal
  const [newRoofDialogOpen, setNewRoofDialogOpen] = useState(false)
  const [pendingNewPoints, setPendingNewPoints] = useState<Point[] | null>(null)
  const [dialogAngle, setDialogAngle] = useState(DEFAULT_ROOF_ANGLE)
  const [dialogAngleStr, setDialogAngleStr] = useState(String(DEFAULT_ROOF_ANGLE))
  const [dialogType, setDialogType] = useState<RoofTypeId>(DEFAULT_ROOF_TYPE)
  const [dialogOverhangStr, setDialogOverhangStr] = useState(overhangMetersToCmStr(DEFAULT_ROOF_OVERHANG_M))
  const [sidebarAngleStr, setSidebarAngleStr] = useState('')
  const [sidebarOverhangStr, setSidebarOverhangStr] = useState('')
  const [pendingNewRoofWindowBbox, setPendingNewRoofWindowBbox] = useState<[number, number, number, number] | null>(null)
  const [newRoofWindowDims, setNewRoofWindowDims] = useState({ width: '', height: '' })
  const roofWindowWidthInputRef = useRef<HTMLInputElement>(null)
  const roofWindowHeightInputRef = useRef<HTMLInputElement>(null)

  const thumbFilter =
    roofUiVariant === 'betonbot' ? 'hue-rotate(-18deg) saturate(0.85) brightness(1.08)' : undefined
  // Ensure the longest roof type label fits with a bit of extra room.
  const longestRoofTypeLabelLen = Math.max(...ROOF_TYPE_OPTIONS.map((o) => o.labelDe.length))
  // mic buffer pentru padding lateral pe etichetă (px-1 …)
  const roofTypeTileWidthRem = `${Math.max(6.8, longestRoofTypeLabelLen * 0.48 + 2.0 + 0.55).toFixed(2)}rem`

  useEffect(() => {
    plansDataRef.current = plansData
  }, [plansData])

  useEffect(() => {
    setSelectedPolygonIndex(null)
    setNewPolygonPoints(null)
    setPendingNewRoofWindowBbox(null)
  }, [roofSurfaceTab])

  useEffect(() => {
    if (roofSurfaceTab !== 'windows') return
    if (newPolygonPoints?.length !== 2) return
    const len = plansDataRef.current.length
    if (len === 0) return
    const planIdx = Math.max(0, Math.min(planIndex, len - 1))
    const plan = plansDataRef.current[planIdx]
    if (!plan || plan.rectangles.length === 0) {
      setNewPolygonPoints(null)
      return
    }
    const [a, b] = newPolygonPoints
    const bbox: [number, number, number, number] = [
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[0], b[0]),
      Math.max(a[1], b[1]),
    ]
    const clipped = clipBboxToRoofRects(bbox, plan.rectangles)
    if (!clipped) {
      setNewPolygonPoints(null)
      return
    }
    setPendingNewRoofWindowBbox(clipped)
    setNewRoofWindowDims({ width: '90', height: '90' })
    setNewPolygonPoints(null)
  }, [newPolygonPoints, roofSurfaceTab, planIndex])

  const saveRoofEditsToServer = useCallback(async (): Promise<boolean> => {
    if (!offerId) return false
    const snapshot = plansDataRef.current
    if (snapshot.length === 0) return false
    try {
      const res = (await apiFetch(`/offers/${offerId}/compute/roof-review-data`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plans: snapshot.map((p) => ({ rectangles: p.rectangles, doors: p.doors })),
        }),
      })) as { ok?: boolean }
      return res?.ok === true
    } catch (e) {
      console.error('[RoofReviewEditor] PATCH roof-review-data failed', e)
      return false
    }
  }, [offerId])

  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!offerId || loading || plansData.length === 0) return
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current)
    saveDebounceRef.current = setTimeout(() => {
      void saveRoofEditsToServer()
    }, 700)
    return () => {
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current)
    }
  }, [plansData, offerId, loading, saveRoofEditsToServer])

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

  const roofApplyToolFromParent = useCallback(
    (t: Tool) => {
      if (t === 'select') {
        setNewPolygonPoints(null)
        return
      }
      if (t === 'add') {
        setSelectedPolygonIndex(null)
        setNewPolygonPoints([])
        if (roofSurfaceTab === 'surfaces') {
          setDialogAngle(DEFAULT_ROOF_ANGLE)
          setDialogAngleStr(String(DEFAULT_ROOF_ANGLE))
          setDialogType(DEFAULT_ROOF_TYPE)
          setDialogOverhangStr(overhangMetersToCmStr(DEFAULT_ROOF_OVERHANG_M))
        }
      }
    },
    [roofSurfaceTab],
  )

  useImperativeHandle(
    ref,
    () => ({
      flushSave: () => saveRoofEditsToServer(),
      roofUndo: () => {
        handleUndo()
      },
      roofApplyToolFromParent,
    }),
    [saveRoofEditsToServer, handleUndo, roofApplyToolFromParent],
  )

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

  /** Refetch doar la offerId / număr etaje — nu la schimbarea URL-urilor (ex. roofImages vs blueprint), ca să nu ștergem poligoanele la schimbarea tab-ului. */
  useEffect(() => {
    if (!offerId || images.length === 0) {
      setLoading(false)
      setPlansData([])
      return
    }
    let cancelled = false
    const canSeedEmbedded =
      embedded &&
      Array.isArray(embeddedPlanSeeds) &&
      embeddedPlanSeeds.length > 0 &&
      embeddedPlanSeeds.every((s) => Number(s.imageWidth) > 0 && Number(s.imageHeight) > 0)
    if (canSeedEmbedded) {
      setPlansData((prev) => {
        if (prev.length > 0) return prev
        return embeddedPlanSeeds!.map((s) => ({
          imageWidth: s.imageWidth,
          imageHeight: s.imageHeight,
          rectangles: [],
          doors: [],
        }))
      })
      setLoading(false)
    } else {
      setLoading(true)
    }
    const fetchWithRetry = async () => {
      let lastPlans: PlanData[] = []
      for (let attempt = 0; attempt < 14 && !cancelled; attempt++) {
        try {
          const res = (await apiFetch(`/offers/${offerId}/compute/roof-review-data?ts=${Date.now()}`)) as {
            plans?: Array<{
              imageWidth: number
              imageHeight: number
              doors?: Array<{ bbox?: number[]; width_m?: number; height_m?: number }>
              rectangles: Array<{
                points: Point[]
                roomName?: string
                roomType?: string
                roofAngleDeg?: number
                roofType?: string
                roofOverhangM?: number
              }>
            }>
            floorLabels?: string[]
          }
          const plans = Array.isArray(res?.plans) ? res.plans : []
          const normalized: PlanData[] = plans.map((p) => {
            const rectangles = (p.rectangles || []).map((r) => normalizeRect(r))
            const rawDoors = Array.isArray(p.doors) ? p.doors : []
            const doors = rawDoors.map((d) => normalizeRoofDoor(d)).filter((x): x is DoorRect => x != null)
            const doorsFiltered = filterDoorsToRoofRects(doors, rectangles)
            return {
              imageWidth: p.imageWidth,
              imageHeight: p.imageHeight,
              rectangles,
              doors: doorsFiltered,
            }
          })
          lastPlans = normalized
          if (cancelled) return
          setFloorLabels(Array.isArray(res?.floorLabels) ? res.floorLabels : [])
          if (normalized.length > 0 || attempt === 13) {
            let toSet = normalized
            if (toSet.length === 0 && canSeedEmbedded) {
              toSet = embeddedPlanSeeds!.map((s) => ({
                imageWidth: s.imageWidth,
                imageHeight: s.imageHeight,
                rectangles: [],
                doors: [],
              }))
            }
            setPlansData(toSet)
            setLoading(false)
            return
          }
        } catch (_) {
          if (attempt === 13 && !cancelled) {
            if (lastPlans.length === 0 && canSeedEmbedded) {
              setPlansData(
                embeddedPlanSeeds!.map((s) => ({
                  imageWidth: s.imageWidth,
                  imageHeight: s.imageHeight,
                  rectangles: [],
                  doors: [],
                })),
              )
            } else {
              setPlansData(lastPlans)
            }
            setLoading(false)
            return
          }
        }
        await new Promise((r) => setTimeout(r, 400))
      }
      if (!cancelled) setLoading(false)
    }
    void fetchWithRetry()
    return () => {
      cancelled = true
    }
  }, [offerId, images.length, embedded, embeddedPlanSeeds])

  /**
   * Editorul unificat (embedded): tab-urile de etaj urmează `images.length`, dar API-ul roof poate întoarce
   * mai puține rânduri în `plans` sau dimensiuni 0 — fără `currentPlan` și fără imageWidth/imageHeight > 0
   * canvas-ul rămâne negru (DetectionsPolygonCanvas nu desenează).
   */
  useEffect(() => {
    if (loading || images.length === 0) return
    setPlansData((prev) => {
      const refPlan = prev.find((p) => Number(p.imageWidth) > 0 && Number(p.imageHeight) > 0)
      let out = [...prev]
      let changed = false
      if (refPlan) {
        out = out.map((p) => {
          const iw = Number(p.imageWidth) || 0
          const ih = Number(p.imageHeight) || 0
          if (iw > 0 && ih > 0) return p
          changed = true
          return { ...p, imageWidth: refPlan.imageWidth, imageHeight: refPlan.imageHeight }
        })
      }
      const targetFloors = Math.max(images.length, out.length)
      if (refPlan && out.length < targetFloors) {
        while (out.length < targetFloors) {
          out.push({
            imageWidth: refPlan.imageWidth,
            imageHeight: refPlan.imageHeight,
            rectangles: [],
            doors: [],
          })
          changed = true
        }
      }
      return changed ? out : prev
    })
  }, [loading, images.length])

  /** Dacă niciun plan nu are dimensiuni valide, le luăm din dimensiunea naturală a blueprint-ului. */
  useEffect(() => {
    if (loading) return
    const url = images.map((i) => i.url).find((u) => typeof u === 'string' && u.length > 0)
    if (!url) return
    if (plansDataRef.current.some((p) => Number(p.imageWidth) > 0 && Number(p.imageHeight) > 0)) return

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const w = img.naturalWidth
      const h = img.naturalHeight
      if (w <= 0 || h <= 0) return
      if (plansDataRef.current.some((p) => Number(p.imageWidth) > 0 && Number(p.imageHeight) > 0)) return
      setPlansData((prev) => {
        if (prev.length === 0) {
          return [{ imageWidth: w, imageHeight: h, rectangles: [], doors: [] }]
        }
        return prev.map((p) => ({
          ...p,
          imageWidth: Number(p.imageWidth) > 0 ? p.imageWidth : w,
          imageHeight: Number(p.imageHeight) > 0 ? p.imageHeight : h,
        }))
      })
    }
    img.src = url
  }, [loading, images.length])

  const n = plansData.length > 0 ? plansData.length : Math.max(1, images.length)
  const planIndexClamped = n > 0 ? Math.max(0, Math.min(planIndex, n - 1)) : 0
  const currentPlan = plansData[planIndexClamped]
  const getBaseImageUrl = (planIdx: number) => images[planIdx]?.url ?? images[0]?.url

  const setRectangles = useCallback((planIdx: number, rectangles: RoomPolygon[]) => {
    setPlansData((prev) => {
      const next = [...prev]
      if (planIdx >= next.length) return next
      const prevPlan = next[planIdx]
      const doors = filterDoorsToRoofRects(prevPlan.doors, rectangles)
      next[planIdx] = { ...prevPlan, rectangles, doors }
      return next
    })
  }, [])

  const setPlanDoors = useCallback((planIdx: number, incoming: DoorRect[]) => {
    setPlansData((prev) => {
      const next = [...prev]
      if (planIdx >= next.length) return next
      const rects = next[planIdx].rectangles
      const prevDoors = next[planIdx].doors
      const merged = incoming
        .map((d, i) => {
          const c = clipBboxToRoofRects(d.bbox, rects)
          if (c) return { ...d, bbox: c }
          const fallback = prevDoors[i]
          if (fallback && bboxFullyInsideSomeRoofRect(fallback.bbox, rects)) return fallback
          return d
        })
        .filter((d) => bboxFullyInsideSomeRoofRect(d.bbox, rects))
      next[planIdx] = { ...next[planIdx], doors: merged }
      return next
    })
  }, [])

  const roofAngleUndoPushedRef = useRef(false)
  useEffect(() => {
    roofAngleUndoPushedRef.current = false
  }, [selectedPolygonIndex])

  /** Actualizare funcțională – evită stale state când schimbi tipul de acoperiș de mai multe ori la rând. */
  const updateSelectedRoofMeta = useCallback(
    (patch: Partial<{ roofAngleDeg: number; roofType: RoofTypeId; roofOverhangM: number }>) => {
      if (selectedPolygonIndex == null) return
      const polyIdx = selectedPolygonIndex
      const pIdx = planIndexClamped
      setPlansData((prev) => {
        if (pIdx >= prev.length) return prev
        const plan = prev[pIdx]
        const rectangles = plan.rectangles.map((r, ri) =>
          ri !== polyIdx ? r : normalizeRect({ ...r, ...patch, points: r.points }),
        )
        const next = [...prev]
        next[pIdx] = { ...plan, rectangles }
        return next
      })
    },
    [selectedPolygonIndex, planIndexClamped],
  )

  const handleConfirm = useCallback(async () => {
    const withTimeout = <T,>(p: Promise<T>, ms: number) =>
      Promise.race<T | null>([
        p,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
      ])

    // Nu blocăm închiderea editorului pe API lent.
    const okMaybe = await withTimeout(saveRoofEditsToServer(), 2500)
    if (offerId && okMaybe !== true) {
      // Retry best-effort în background.
      setTimeout(() => { void saveRoofEditsToServer() }, 150)
    }
    await onConfirm()
  }, [offerId, onConfirm, saveRoofEditsToServer])

  const confirmNewRoofDialog = useCallback(() => {
    if (!pendingNewPoints || pendingNewPoints.length < 3 || !currentPlan) return
    pushHistory()
    const label = nextRoofLabel(currentPlan.rectangles)
    const angleDeg = parseDecimalField(dialogAngleStr, 0, 60) ?? dialogAngle
    const overhangM = parseOverhangCmToMeters(dialogOverhangStr) ?? DEFAULT_ROOF_OVERHANG_M
    setRectangles(planIndexClamped, [
      ...currentPlan.rectangles,
      normalizeRect({
        points: [...pendingNewPoints],
        roomName: label,
        roofAngleDeg: angleDeg,
        roofType: dialogType,
        roofOverhangM: overhangM,
      }),
    ])
    setPendingNewPoints(null)
    setNewRoofDialogOpen(false)
    setDialogAngle(DEFAULT_ROOF_ANGLE)
    setDialogAngleStr(String(DEFAULT_ROOF_ANGLE))
    setDialogType(DEFAULT_ROOF_TYPE)
    setDialogOverhangStr(overhangMetersToCmStr(DEFAULT_ROOF_OVERHANG_M))
    setTool('select')
  }, [
    pendingNewPoints,
    currentPlan,
    pushHistory,
    setRectangles,
    planIndexClamped,
    dialogAngle,
    dialogAngleStr,
    dialogOverhangStr,
    dialogType,
  ])

  const cancelNewRoofDialog = useCallback(() => {
    setPendingNewPoints(null)
    setNewRoofDialogOpen(false)
    setDialogAngle(DEFAULT_ROOF_ANGLE)
    setDialogAngleStr(String(DEFAULT_ROOF_ANGLE))
    setDialogType(DEFAULT_ROOF_TYPE)
    setDialogOverhangStr(overhangMetersToCmStr(DEFAULT_ROOF_OVERHANG_M))
    setTool('select')
  }, [])

  const handleCreateRoofWindow = useCallback(() => {
    if (!pendingNewRoofWindowBbox || !currentPlan) return
    const wCm = Number(String(newRoofWindowDims.width).replace(',', '.'))
    const hCm = Number(String(newRoofWindowDims.height).replace(',', '.'))
    const width = Math.round((wCm / 100) * 1000) / 1000
    const height = Math.round((hCm / 100) * 1000) / 1000
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
    if (!bboxFullyInsideSomeRoofRect(pendingNewRoofWindowBbox, currentPlan.rectangles)) return
    pushHistory()
    setPlanDoors(planIndexClamped, [
      ...currentPlan.doors,
      {
        bbox: pendingNewRoofWindowBbox,
        type: 'window',
        width_m: width,
        height_m: height,
        dimensionsEdited: true,
      },
    ])
    setPendingNewRoofWindowBbox(null)
    setNewRoofWindowDims({ width: '', height: '' })
  }, [
    pendingNewRoofWindowBbox,
    currentPlan,
    newRoofWindowDims,
    planIndexClamped,
    pushHistory,
    setPlanDoors,
  ])

  useEffect(() => {
    if (!pendingNewRoofWindowBbox) return
    const id = window.requestAnimationFrame(() => {
      const el = roofWindowWidthInputRef.current
      el?.focus()
      el?.select()
    })
    return () => window.cancelAnimationFrame(id)
  }, [pendingNewRoofWindowBbox])

  const selectedRect =
    roofSurfaceTab === 'surfaces' && selectedPolygonIndex != null && currentPlan
      ? currentPlan.rectangles[selectedPolygonIndex]
      : null

  useEffect(() => {
    if (!selectedRect) {
      setSidebarAngleStr('')
      setSidebarOverhangStr('')
      return
    }
    setSidebarAngleStr(String(selectedRect.roofAngleDeg ?? DEFAULT_ROOF_ANGLE))
    setSidebarOverhangStr(overhangMetersToCmStr(selectedRect.roofOverhangM ?? DEFAULT_ROOF_OVERHANG_M))
  }, [
    roofSurfaceTab,
    selectedPolygonIndex,
    selectedRect?.roofAngleDeg,
    selectedRect?.roofOverhangM,
  ])

  const selectedRoofWindow =
    roofSurfaceTab === 'windows' && selectedPolygonIndex != null && currentPlan
      ? currentPlan.doors[selectedPolygonIndex]
      : null

  const updateSelectedRoofWindowCm = useCallback(
    (axis: 'width_m' | 'height_m', raw: string) => {
      if (selectedPolygonIndex === null || !currentPlan || selectedPolygonIndex >= currentPlan.doors.length) return
      const v = Number(String(raw).replace(',', '.'))
      if (!Number.isFinite(v) || v <= 0) return
      const m = Math.round((v / 100) * 1000) / 1000
      pushHistory()
      setPlanDoors(
        planIndexClamped,
        currentPlan.doors.map((d, i) =>
          i !== selectedPolygonIndex ? d : { ...d, [axis]: m, dimensionsEdited: true },
        ),
      )
    },
    [selectedPolygonIndex, currentPlan, planIndexClamped, pushHistory, setPlanDoors],
  )

  const roofToolHint =
    roofSurfaceTab === 'windows'
      ? tool === 'select'
        ? 'Element wählen und ziehen zum Verschieben'
        : tool === 'add'
          ? 'Zwei Ecken für Dachfenster setzen (Rechteck)'
          : tool === 'remove'
            ? 'Klicken Sie auf ein Element, um es zu entfernen'
            : tool === 'edit'
              ? 'Eckpunkte ziehen; auf Kante klicken = neuer Punkt; Kante ziehen = Segment verschieben'
              : ''
      : tool === 'select'
        ? 'Auf Element klicken und ziehen zum Verschieben'
        : tool === 'add'
          ? 'Klicken Sie um Punkte zu setzen – ersten Punkt erneut klicken zum Schließen'
          : tool === 'remove'
            ? 'Klicken Sie auf ein Element, um es zu entfernen'
            : tool === 'edit'
              ? 'Eckpunkte ziehen; auf Kante klicken = neuer Punkt; Kante ziehen = Segment verschieben'
              : ''

  /** Wie Fenster/Türen: Maße oben in der Leiste, sobald Dachfenster gewählt + Werkzeug „Verschieben“. */
  const roofWindowDimsToolbar =
    roofSurfaceTab === 'windows' && tool === 'select' && selectedRoofWindow ? (
      <div className="shrink-0 flex items-center justify-center gap-2 px-2 py-1.5 flex-wrap">
        <span className="text-sand/70 text-xs">Maße (cm):</span>
        <span className="text-sand/70 text-xs">B:</span>
        <input
          type="number"
          min={1}
          step={1}
          value={
            typeof selectedRoofWindow.width_m === 'number' && Number.isFinite(selectedRoofWindow.width_m)
              ? Math.round(selectedRoofWindow.width_m * 100)
              : ''
          }
          onChange={(e) => updateSelectedRoofWindowCm('width_m', e.target.value)}
          className="w-[84px] rounded bg-black/40 border border-white/20 px-2 py-1 text-xs text-white"
        />
        <span className="text-sand/70 text-xs">L:</span>
        <input
          type="number"
          min={1}
          step={1}
          value={
            typeof selectedRoofWindow.height_m === 'number' && Number.isFinite(selectedRoofWindow.height_m)
              ? Math.round(selectedRoofWindow.height_m * 100)
              : ''
          }
          onChange={(e) => updateSelectedRoofWindowCm('height_m', e.target.value)}
          className="w-[84px] rounded bg-black/40 border border-white/20 px-2 py-1 text-xs text-white"
        />
      </div>
    ) : null

  return (
    <div
      className={`relative w-full flex flex-col flex-1 min-h-0 h-full max-h-full overflow-hidden ${
        compactUi ? 'gap-1.5' : 'gap-3'
      }`}
    >
      {!embedded && (
        <div className="shrink-0 px-2 pt-1 pb-0">
          <h2 className="text-white font-semibold text-base text-center">Dach konfigurieren</h2>
        </div>
      )}

      {!chromeParent && (
        <>
      {/* Aceeași ordine ca în DetectionsReviewEditor: Werkzeuge → rând secundar (ca „Element:“) → Hinweis → Etage */}
      <div className="shrink-0 flex flex-wrap items-center justify-center gap-3 px-2 py-1">
        <span className="text-sand/60 text-xs">Werkzeuge:</span>
        <div className="flex flex-col items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              setTool('select')
              setNewPolygonPoints(null)
            }}
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
            disabled={roofSurfaceTab === 'windows' && (!currentPlan || currentPlan.rectangles.length === 0)}
            title={
              roofSurfaceTab === 'windows' && (!currentPlan || currentPlan.rectangles.length === 0)
                ? 'Zuerst Dachflächen anlegen'
                : roofSurfaceTab === 'surfaces'
                  ? 'Polygon (Dachfläche) hinzufügen'
                  : 'Dachfenster hinzufügen'
            }
            onClick={() => {
              setTool('add')
              setSelectedPolygonIndex(null)
              setNewPolygonPoints([])
              if (roofSurfaceTab === 'surfaces') {
                setDialogAngle(DEFAULT_ROOF_ANGLE)
                setDialogAngleStr(String(DEFAULT_ROOF_ANGLE))
                setDialogType(DEFAULT_ROOF_TYPE)
                setDialogOverhangStr(overhangMetersToCmStr(DEFAULT_ROOF_OVERHANG_M))
              }
            }}
            className={`p-2 rounded-lg transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${tool === 'add' ? 'bg-[#FF9F0F]/20 text-[#FF9F0F]' : 'text-sand/70 hover:bg-white/5'}`}
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

      <div className="shrink-0 flex items-center justify-center gap-2 px-2 py-1.5 flex-wrap">
        <span className="text-sand/70 text-xs w-full text-center sm:w-auto">Ansicht:</span>
        <button
          type="button"
          onClick={() => {
            setRoofSurfaceTab('surfaces')
            setSelectedPolygonIndex(null)
            setNewPolygonPoints(null)
            if (tool === 'add') setTool('select')
          }}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${roofSurfaceTab === 'surfaces' ? 'bg-[#FF9F0F]/25 text-[#FF9F0F] border border-[#FF9F0F]/50' : 'text-sand/70 border border-white/10 hover:bg-white/5'}`}
        >
          Dachflächen
        </button>
        <button
          type="button"
          onClick={() => {
            setRoofSurfaceTab('windows')
            setSelectedPolygonIndex(null)
            setNewPolygonPoints(null)
            if (tool === 'add') setTool('select')
          }}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${roofSurfaceTab === 'windows' ? 'bg-[#FF9F0F]/25 text-[#FF9F0F] border border-[#FF9F0F]/50' : 'text-sand/70 border border-white/10 hover:bg-white/5'}`}
        >
          Dachfenster
        </button>
      </div>

      {roofWindowDimsToolbar}

      {roofToolHint && (
        <p className="shrink-0 text-xs text-sand/60 text-center px-4">{roofToolHint}</p>
      )}
        </>
      )}

      {chromeParent &&
        roofWindowDimsToolbar &&
        (dimsToolbarPortalTarget
          ? createPortal(roofWindowDimsToolbar, dimsToolbarPortalTarget)
          : roofWindowDimsToolbar)}

      {!loading && n > 1 && !embedded && (
        <div className="shrink-0 flex flex-wrap items-center justify-center gap-1 px-2 py-2 border-b border-white/10">
          {Array.from({ length: n }).map((_, i) => (
            <button
              key={`roof-floor-tab-${i}`}
              type="button"
              onClick={() => {
                setPlanIndexInternal(i)
                setSelectedPolygonIndex(null)
                setNewPolygonPoints(null)
                setRoofSurfaceTab('surfaces')
                if (tool === 'add') setTool('select')
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${planIndexClamped === i ? 'bg-[#FF9F0F]/25 text-[#FF9F0F] border border-[#FF9F0F]/50' : 'text-sand/80 border border-white/10 hover:bg-white/5'}`}
            >
              {roofPlanLabelDe(floorLabels, i)}
            </button>
          ))}
        </div>
      )}

      {/* Blueprint: ocupă tot spațiul rămas (flex-basis 0) ca imaginea să fie cât mai mare, fără scroll */}
      <div className="flex-[1_1_0%] min-h-0 flex flex-col gap-1.5 min-w-0 overflow-hidden px-2">
        <div className="flex-[1_1_0%] min-h-0 flex flex-col overflow-hidden gap-1">
          {currentPlan && getBaseImageUrl(planIndexClamped) && (
              <div className="relative w-full flex-[1_1_0%] min-h-[96px] rounded-lg overflow-hidden border border-[#FF9F0F]/50 ring-1 ring-[#FF9F0F]/30 bg-black/30">
                {pendingNewRoofWindowBbox && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 rounded-lg">
                    <div className="w-[300px] rounded-xl border border-[#FF9F0F]/60 bg-[#1a1a1a] p-3 space-y-2">
                      <div className="text-white text-sm font-medium text-center">Dachfenster – Maße (cm)</div>
                      <div className="flex flex-col gap-2">
                        <label className="text-sand/70 text-xs">
                          Breite (cm)
                          <input
                            ref={roofWindowWidthInputRef}
                            type="number"
                            min={1}
                            step={1}
                            placeholder="z. B. 90"
                            value={newRoofWindowDims.width}
                            onChange={(e) => setNewRoofWindowDims((p) => ({ ...p, width: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key !== 'Enter') return
                              e.preventDefault()
                              roofWindowHeightInputRef.current?.focus()
                              roofWindowHeightInputRef.current?.select()
                            }}
                            className="mt-0.5 w-full rounded-md bg-black/40 border border-white/20 text-white px-2 py-1 text-sm"
                          />
                        </label>
                        <label className="text-sand/70 text-xs">
                          Länge (cm)
                          <input
                            ref={roofWindowHeightInputRef}
                            type="number"
                            min={1}
                            step={1}
                            placeholder="z. B. 120"
                            value={newRoofWindowDims.height}
                            onChange={(e) => setNewRoofWindowDims((p) => ({ ...p, height: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key !== 'Enter') return
                              e.preventDefault()
                              handleCreateRoofWindow()
                            }}
                            className="mt-0.5 w-full rounded-md bg-black/40 border border-white/20 text-white px-2 py-1 text-sm"
                          />
                        </label>
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setPendingNewRoofWindowBbox(null)
                            setNewRoofWindowDims({ width: '', height: '' })
                          }}
                          className="text-sand/60 text-xs hover:underline"
                        >
                          Abbrechen
                        </button>
                        <button
                          type="button"
                          onClick={handleCreateRoofWindow}
                          className="rounded bg-[#FF9F0F]/25 border border-[#FF9F0F]/60 px-3 py-1 text-xs text-[#FF9F0F]"
                        >
                          Speichern
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {roofSurfaceTab === 'surfaces' ? (
                  <DetectionsPolygonCanvas
                    key={`roof-plan-${planIndexClamped}-surf`}
                    className="block h-full w-full min-h-0"
                    layoutActive={layoutActive}
                    imageUrl={getBaseImageUrl(planIndexClamped)!}
                    imageWidth={currentPlan.imageWidth}
                    imageHeight={currentPlan.imageHeight}
                    rooms={currentPlan.rectangles}
                    doors={[]}
                    tab="rooms"
                    tool={tool}
                    dimUnselectedRoomPolygons
                    selectedIndex={selectedPolygonIndex}
                    newPoints={tool === 'add' ? newPolygonPoints : null}
                    onSelect={setSelectedPolygonIndex}
                    onAddPoint={(x, y) => setNewPolygonPoints((prev) => (prev ? [...prev, [x, y]] : [[x, y]]))}
                    onCloseNewPolygon={() => {
                      if (!newPolygonPoints || newPolygonPoints.length < 3) return
                      setPendingNewPoints([...newPolygonPoints])
                      setNewPolygonPoints(null)
                      setDialogAngle(DEFAULT_ROOF_ANGLE)
                      setDialogAngleStr(String(DEFAULT_ROOF_ANGLE))
                      setDialogType(DEFAULT_ROOF_TYPE)
                      setDialogOverhangStr(overhangMetersToCmStr(DEFAULT_ROOF_OVERHANG_M))
                      setNewRoofDialogOpen(true)
                    }}
                    onMoveVertex={(polyIndex, vertexIndex, x, y) => {
                      setRectangles(
                        planIndexClamped,
                        currentPlan.rectangles.map((r, ri) =>
                          ri !== polyIndex ? r : { ...r, points: r.points.map((p, vi) => (vi === vertexIndex ? [x, y] : p)) },
                        ),
                      )
                    }}
                    onRemoveSelected={(index?: number) => {
                      const idx = index ?? selectedPolygonIndex
                      if (idx == null || idx < 0) return
                      pushHistory()
                      setRectangles(planIndexClamped, currentPlan.rectangles.filter((_, i) => i !== idx))
                      setSelectedPolygonIndex(null)
                    }}
                    onRoomsChange={(rooms) => setRectangles(planIndexClamped, rooms.map((r) => normalizeRect(r)))}
                    onDoorsChange={() => {}}
                    onEditStart={pushHistory}
                  />
                ) : (
                  <DetectionsPolygonCanvas
                    key={`roof-plan-${planIndexClamped}-win`}
                    className="block h-full w-full min-h-0"
                    layoutActive={layoutActive}
                    imageUrl={getBaseImageUrl(planIndexClamped)!}
                    imageWidth={currentPlan.imageWidth}
                    imageHeight={currentPlan.imageHeight}
                    rooms={currentPlan.rectangles}
                    doors={currentPlan.doors}
                    tab="doors"
                    tool={tool}
                    newDoorType="window"
                    showRoomPolygonsUnderDoors
                    highlightRoofSurfaceUnderlay
                    selectedIndex={selectedPolygonIndex}
                    newPoints={tool === 'add' ? newPolygonPoints : null}
                    onSelect={setSelectedPolygonIndex}
                    onAddPoint={(x, y) => setNewPolygonPoints((prev) => (prev ? [...prev, [x, y]] : [[x, y]]))}
                    onCloseNewPolygon={() => {}}
                    onMoveVertex={(polyIndex, vertexIndex, x, y) => {
                      const d = currentPlan.doors[polyIndex]
                      if (!d) return
                      const [x1, y1, x2, y2] = d.bbox
                      const corners: Point[] = [
                        [x1, y1],
                        [x2, y1],
                        [x2, y2],
                        [x1, y2],
                      ]
                      corners[vertexIndex] = [x, y]
                      let nx1 = Math.min(...corners.map((c) => c[0]))
                      let nx2 = Math.max(...corners.map((c) => c[0]))
                      let ny1 = Math.min(...corners.map((c) => c[1]))
                      let ny2 = Math.max(...corners.map((c) => c[1]))
                      const minPx = 1
                      if (nx2 - nx1 < minPx) nx2 = nx1 + minPx
                      if (ny2 - ny1 < minPx) ny2 = ny1 + minPx
                      const nextBbox: [number, number, number, number] = [nx1, ny1, nx2, ny2]
                      const clipped = clipBboxToRoofRects(nextBbox, currentPlan.rectangles)
                      if (!clipped) return
                      setPlanDoors(
                        planIndexClamped,
                        currentPlan.doors.map((dr, ri) => (ri !== polyIndex ? dr : { ...dr, bbox: clipped })),
                      )
                    }}
                    onRemoveSelected={(index?: number) => {
                      const idx = index ?? selectedPolygonIndex
                      if (idx == null || idx < 0) return
                      pushHistory()
                      setPlanDoors(
                        planIndexClamped,
                        currentPlan.doors.filter((_, i) => i !== idx),
                      )
                      setSelectedPolygonIndex(null)
                    }}
                    onRoomsChange={() => {}}
                    onDoorsChange={(doors) => setPlanDoors(planIndexClamped, doors)}
                    onEditStart={pushHistory}
                  />
                )}
              </div>
          )}
        </div>

        {/* Unter dem Plan: Dachflächen (Neigung/Typ) oder Dachfenster-Hinweis */}
        <div
          className={`shrink-0 rounded-xl border border-[#FF9F0F]/40 bg-black/25 space-y-2 ${
            compactUi ? 'p-1.5 max-h-[min(30vh,260px)] overflow-y-auto overflow-x-hidden' : 'p-2'
          }`}
        >
          {roofSurfaceTab === 'windows' ? (
            <div className="text-sm text-white space-y-1">
              <p className="text-sand/80 text-xs font-normal leading-snug">
                Öffnungen im Plan markieren; nach dem Aufziehen Breite und Länge in cm eingeben. Gewählt: Maße oben
                (cm) bearbeiten.
              </p>
            </div>
          ) : (
            <>
          <div className="text-sm text-white font-medium">
            {selectedRect ? (
              <div className="space-y-0.5">
                <div>Dachfläche {selectedRect.roomName ?? `S${selectedPolygonIndex}`}</div>
                <div className="text-sand/80 text-xs font-normal">
                  {roofTypeLabelDe((selectedRect.roofType ?? DEFAULT_ROOF_TYPE) as RoofTypeId)}
                </div>
              </div>
            ) : (
              <span className="text-sand/70 font-normal">
                Dachfläche im Plan anklicken – dann Neigung und Typ bearbeiten
              </span>
            )}
          </div>
          <div className={`flex items-start ${compactUi ? 'gap-2' : 'gap-3'}`}>
            <div className="shrink-0 flex items-center gap-2 pt-1">
              <span className="text-sand/50 text-xs">Typ</span>
            </div>
            <div className={`grid grid-cols-5 justify-items-center w-fit min-w-max ${compactUi ? 'gap-1' : 'gap-2'}`}>
              {ROOF_TYPE_OPTIONS.map((opt) => {
                const hasSelection = selectedRect != null
                const active = hasSelection && (selectedRect!.roofType ?? DEFAULT_ROOF_TYPE) === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    style={{ width: roofTypeTileWidthRem }}
                    disabled={!hasSelection}
                    onClick={() => {
                      if (!selectedRect) return
                      pushHistory()
                      if (opt.id === '0_w') {
                        updateSelectedRoofMeta({ roofType: opt.id, roofAngleDeg: 0 })
                      } else {
                        updateSelectedRoofMeta({ roofType: opt.id, roofAngleDeg: DEFAULT_ROOF_ANGLE })
                      }
                    }}
                    className={`flex flex-col items-center gap-1 rounded-lg px-1 py-1.5 border transition disabled:opacity-50 disabled:cursor-not-allowed ${
                      hasSelection ? 'cursor-pointer' : ''
                    } ${
                      active
                        ? 'border-[#FF9F0F] ring-1 ring-[#FF9F0F]/50 bg-[#FF9F0F]/10'
                        : 'border-white/15 hover:bg-white/5'
                    }`}
                  >
                    <img
                      src={opt.image}
                      alt={opt.labelDe}
                      className={
                        compactUi
                          ? 'w-full h-9 sm:h-10 object-contain rounded-md bg-white ring-1 ring-black/10 pointer-events-none'
                          : 'w-full h-14 sm:h-16 object-contain rounded-md bg-white ring-1 ring-black/10 pointer-events-none'
                      }
                      style={thumbFilter ? { filter: thumbFilter } : undefined}
                    />
                    <span className="block w-full box-border text-[11px] sm:text-xs leading-tight text-center text-sand/90 px-1 sm:px-1.5 py-0.5 whitespace-nowrap">
                      {opt.labelDe}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="shrink-0 flex flex-col gap-2 pt-1 min-w-[7.5rem]">
              <div className="flex items-center gap-2">
                <span className="text-sand/70 text-xs whitespace-nowrap">Neigung (°)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  disabled={!selectedRect}
                  className="min-w-[4.5rem] w-28 px-2 py-1 rounded bg-black/40 border border-white/20 text-white text-sm tabular-nums disabled:opacity-45 disabled:cursor-not-allowed"
                  value={selectedRect ? sidebarAngleStr : ''}
                  placeholder="—"
                  onFocus={() => {
                    if (!selectedRect) return
                    if (!roofAngleUndoPushedRef.current) {
                      pushHistory()
                      roofAngleUndoPushedRef.current = true
                    }
                  }}
                  onBlur={() => {
                    roofAngleUndoPushedRef.current = false
                    if (!selectedRect) return
                    const v = parseDecimalField(sidebarAngleStr, 0, 60)
                    if (v != null) updateSelectedRoofMeta({ roofAngleDeg: v })
                    else setSidebarAngleStr(String(selectedRect.roofAngleDeg ?? DEFAULT_ROOF_ANGLE))
                  }}
                  onChange={(e) => {
                    if (!selectedRect) return
                    const raw = e.target.value.replace(',', '.')
                    setSidebarAngleStr(raw)
                    const v = parseDecimalField(raw, 0, 60)
                    if (v != null) updateSelectedRoofMeta({ roofAngleDeg: v })
                  }}
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sand/70 text-xs whitespace-nowrap">Dachüberstand (cm)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  disabled={!selectedRect}
                  className="min-w-[4.5rem] w-28 px-2 py-1 rounded bg-black/40 border border-white/20 text-white text-sm tabular-nums disabled:opacity-45 disabled:cursor-not-allowed"
                  value={selectedRect ? sidebarOverhangStr : ''}
                  placeholder="—"
                  onFocus={() => {
                    if (!selectedRect) return
                    if (!roofAngleUndoPushedRef.current) {
                      pushHistory()
                      roofAngleUndoPushedRef.current = true
                    }
                  }}
                  onBlur={() => {
                    roofAngleUndoPushedRef.current = false
                    if (!selectedRect) return
                    const m = parseOverhangCmToMeters(sidebarOverhangStr)
                    if (m != null) updateSelectedRoofMeta({ roofOverhangM: m })
                    else setSidebarOverhangStr(overhangMetersToCmStr(selectedRect.roofOverhangM ?? DEFAULT_ROOF_OVERHANG_M))
                  }}
                  onChange={(e) => {
                    if (!selectedRect) return
                    const raw = e.target.value.replace(',', '.')
                    setSidebarOverhangStr(raw)
                    const m = parseOverhangCmToMeters(raw)
                    if (m != null) updateSelectedRoofMeta({ roofOverhangM: m })
                  }}
                />
              </div>
            </div>
          </div>
            </>
          )}
        </div>
      </div>

      {newRoofDialogOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3 sm:p-4">
          <div
            lang="de"
            className="w-fit max-w-[calc(100vw-1.5rem)] rounded-2xl border border-[#FF9F0F]/40 bg-coffee-800/95 p-3 sm:p-4 shadow-xl space-y-3"
          >
            <h3 className="text-white font-semibold text-center text-sm sm:text-base leading-snug">
              Neues Dach – Neigung, Dachüberstand &amp; Typ
            </h3>
            <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-center gap-3 sm:gap-x-6 sm:gap-y-2">
              <label className="flex items-center gap-2 text-sand/80 text-sm">
                <span className="shrink-0">Neigung (°)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  className="min-w-[5rem] w-32 px-3 py-1.5 rounded-lg bg-black/40 border border-white/20 text-white text-sm tabular-nums"
                  value={dialogAngleStr}
                  onChange={(e) => {
                    const raw = e.target.value.replace(',', '.')
                    setDialogAngleStr(raw)
                    const v = parseDecimalField(raw, 0, 60)
                    if (v != null) setDialogAngle(v)
                  }}
                />
              </label>
              <label className="flex items-center gap-2 text-sand/80 text-sm">
                <span className="shrink-0">Dachüberstand (cm)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  className="min-w-[5rem] w-32 px-3 py-1.5 rounded-lg bg-black/40 border border-white/20 text-white text-sm tabular-nums"
                  value={dialogOverhangStr}
                  onChange={(e) => {
                    const raw = e.target.value.replace(',', '.')
                    setDialogOverhangStr(raw)
                  }}
                />
              </label>
            </div>
            {/* Aceleași carduri ca la „Typ” sub blueprint */}
            <div className="flex justify-center">
              <div className="grid grid-cols-5 gap-2 justify-items-center w-fit min-w-max">
                {ROOF_TYPE_OPTIONS.map((opt) => {
                  const active = dialogType === opt.id
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      style={{ width: roofTypeTileWidthRem }}
                      onClick={() => {
                        setDialogType(opt.id)
                        if (opt.id === '0_w') {
                          setDialogAngle(0)
                          setDialogAngleStr('0')
                        } else {
                          setDialogAngle(DEFAULT_ROOF_ANGLE)
                          setDialogAngleStr(String(DEFAULT_ROOF_ANGLE))
                        }
                      }}
                      className={`flex flex-col items-center gap-1 rounded-lg px-1 py-1.5 border cursor-pointer transition ${
                        active
                          ? 'border-[#FF9F0F] ring-1 ring-[#FF9F0F]/50 bg-[#FF9F0F]/10'
                          : 'border-white/15 hover:bg-white/5'
                      }`}
                    >
                      <img
                        src={opt.image}
                        alt={opt.labelDe}
                        className="w-full h-14 sm:h-16 object-contain rounded-md bg-white ring-1 ring-black/10 pointer-events-none"
                        style={thumbFilter ? { filter: thumbFilter } : undefined}
                      />
                      <span className="block w-full box-border text-[11px] sm:text-xs leading-tight text-center text-sand/90 px-1 sm:px-1.5 py-0.5 whitespace-nowrap">
                        {opt.labelDe}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={cancelNewRoofDialog}
                className="px-4 py-2 rounded-lg border border-white/30 text-sand hover:bg-white/10"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={confirmNewRoofDialog}
                className="px-4 py-2 rounded-lg font-semibold text-black bg-[#FF9F0F] hover:bg-[#ffb03d]"
              >
                Übernehmen
              </button>
            </div>
          </div>
        </div>
      )}

      {!embedded && (
        <div className="shrink-0 flex flex-wrap items-center justify-center gap-2 px-2 pt-1 pb-2">
          <button
            type="button"
            onClick={handleConfirm}
            className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-[#ffffff] shadow-lg bg-gradient-to-b from-[#e08414] to-[#f79116]"
          >
            <Check size={18} />
            Dach bestätigen – weiter
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sand/90 border border-white/30 hover:bg-white/10"
          >
            <X size={18} />
            Abbrechen
          </button>
        </div>
      )}
    </div>
  )
})
