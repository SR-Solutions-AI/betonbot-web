'use client'
/**
 * Editor verificare detecții: camere (poligoane + etichete) și uși/geamuri.
 * Datele vin din API compute/detections-review-data (baseline KI + detections_edited îmbinate):
 * - Etichete camere = room_scales.json (pipeline per-crop Gemini, OCR exact).
 * - Tipuri uși/geamuri = doors_types.json (Gemini) + euristică aspect – aceeași clasificare ca în LiveFeed.
 */

import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo, type SetStateAction } from 'react'
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
  Loader2,
  ChevronLeft,
} from 'lucide-react'
import {
  DetectionsPolygonCanvas,
  type Point,
  type RoomPolygon,
  type DoorRect,
  type RoofDemolitionPoly,
} from './DetectionsPolygonCanvas'
import {
  RoofReviewEditor,
  type RoofReviewEditorHandle,
  type RoofSurfaceTab,
} from './RoofReviewEditor'
import { apiFetch } from '../lib/supabaseClient'
import { displayFloorTabLabelDe } from '@/lib/displayFloorTabLabelDe'
import { type DisplayCurrency } from '@/lib/displayCurrency'
import { SelectSun } from './SunSelect'
/** Unire vârfuri consecutive foarte apropiate (în px imagine) – la randarea poligoanelor prima dată. */
const MERGE_VERTEX_DIST_PX = 14

/** roof-review-data poate folosi alte imageWidth/Height decât detections-review; același PNG, coordonate scalate. */
function scaleRoofRectsToDetectionsSpace(
  rects: RoomPolygon[],
  fromW: number,
  fromH: number,
  toW: number,
  toH: number,
): RoomPolygon[] {
  if (fromW <= 0 || fromH <= 0 || toW <= 0 || toH <= 0 || (fromW === toW && fromH === toH)) return rects
  const sx = toW / fromW
  const sy = toH / fromH
  return rects.map((r) => ({
    ...r,
    points: r.points.map((pt) => [pt[0] * sx, pt[1] * sy] as Point),
  }))
}

function roofOverlayMaxExtent(rects: RoomPolygon[]): { maxX: number; maxY: number } {
  let maxX = 0
  let maxY = 0
  for (const r of rects) {
    for (const p of r.points) {
      maxX = Math.max(maxX, p[0])
      maxY = Math.max(maxY, p[1])
    }
  }
  return { maxX, maxY }
}

/**
 * Rândul i din GET roof-review-data corespunde rasterului i din manifest, dar poligoanele sunt în
 * `p.imageWidth`×`p.imageHeight` (același fișier ca detections pentru acel etaj). Seed-ul la același
 * index poate fi alt etaj dacă ordinea diferă — potrivim după dimensiuni, apoi scalăm către seed-ul găsit.
 */
function matchRoofRowToSeedIndex(
  p: { imageWidth?: number; imageHeight?: number },
  seeds: Array<{ imageWidth: number; imageHeight: number }> | undefined,
  rowIndex: number,
): number {
  if (!seeds?.length) return rowIndex
  const fromW = Number(p.imageWidth) || 0
  const fromH = Number(p.imageHeight) || 0
  if (fromW <= 0 || fromH <= 0) return rowIndex
  const exact = seeds.findIndex(
    (s) => Number(s.imageWidth) === fromW && Number(s.imageHeight) === fromH,
  )
  if (exact >= 0) return exact
  let best = rowIndex
  let bestD = Infinity
  for (let j = 0; j < seeds.length; j++) {
    const sw = Number(seeds[j].imageWidth) || 0
    const sh = Number(seeds[j].imageHeight) || 0
    if (sw <= 0 || sh <= 0) continue
    const d = Math.abs(sw - fromW) + Math.abs(sh - fromH)
    if (d < bestD) {
      bestD = d
      best = j
    }
  }
  return best
}

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

/** Restricții din formular (API: detections-review-data). */
type EditorConstraints = {
  allowInsulatedRooms: boolean
  allowGarageDoor: boolean
  allowWintergartenRoomType: boolean
  allowBalkonRoomType: boolean
  allowRoofWindows: boolean
}

function mergeEditorConstraints(raw: Partial<EditorConstraints> | undefined | null): EditorConstraints {
  return {
    allowInsulatedRooms: raw?.allowInsulatedRooms !== false,
    allowGarageDoor: raw?.allowGarageDoor !== false,
    allowWintergartenRoomType: raw?.allowWintergartenRoomType !== false,
    allowBalkonRoomType: raw?.allowBalkonRoomType !== false,
    allowRoofWindows: raw?.allowRoofWindows !== false,
  }
}

const STATIK_MODE_VALUES = ['none', 'stahlbetonverbunddecke', 'sonderkonstruktion'] as const

function statikModeSelectLabel(v: string): string {
  switch (v) {
    case 'none':
      return 'Keine Ertüchtigung notwendig'
    case 'stahlbetonverbunddecke':
      return 'Stahlbetonverbunddecke'
    case 'sonderkonstruktion':
      return 'Sonderkonstruktion'
    default:
      return v
  }
}

const ALL_ROOM_TYPE_OPTIONS = ['Garage', 'Balkon', 'Wintergarten', 'Raum gedämmt', 'Raum ungedämmt'] as const
type RoomTypeOption = (typeof ALL_ROOM_TYPE_OPTIONS)[number]
const FALLBACK_ROOM_TYPE = 'Raum ungedämmt'

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

export type ReviewTab =
  | 'rooms'
  | 'doors'
  | 'roof'
  | 'roof_windows'
  | 'phase1_demolition'
  | 'phase1_stair'

export type ReviewImage = { url: string; caption?: string }

type Tool = 'select' | 'add' | 'remove' | 'edit'

type StatikChoice = {
  mode: 'none' | 'stahlbetonverbunddecke' | 'sonderkonstruktion'
  customPiecePrice?: number
}

type PlanData = {
  imageWidth: number
  imageHeight: number
  metersPerPixel?: number | null
  rooms: RoomPolygon[]
  doors: DoorRect[]
  roofDemolitions?: RoofDemolitionPoly[]
  stairOpenings?: Array<DoorRect & { price_key?: string; quantity?: number; area_m2?: number }>
  customDemolitionPrice?: number | null
  statikChoice?: StatikChoice
}

type DoorType = 'door' | 'window' | 'sliding_door' | 'garage_door' | 'stairs'
const DOOR_TYPE_LABELS_DE: Record<DoorType, string> = {
  door: 'Tür',
  window: 'Fenster',
  sliding_door: 'Schiebetür',
  garage_door: 'Garagentor',
  stairs: 'Treppe',
}
const DOOR_TOOLBAR_ACTIVE: Record<DoorType, string> = {
  door: 'bg-[#22c55e]/30 text-green-300 border border-green-400/50',
  window: 'bg-blue-500/30 text-blue-200 border border-blue-400/50',
  sliding_door: 'bg-cyan-500/30 text-cyan-200 border border-cyan-400/50',
  garage_door: 'bg-purple-500/30 text-purple-200 border border-purple-400/50',
  stairs: 'bg-orange-600/30 text-orange-200 border border-orange-500/50',
}
const ALL_DOOR_TYPES: DoorType[] = ['door', 'window', 'sliding_door', 'garage_door', 'stairs']

function sanitizeRoomsAndDoorsAgainstConstraints(
  rooms: RoomPolygon[],
  doors: DoorRect[],
  c: EditorConstraints,
): { rooms: RoomPolygon[]; doors: DoorRect[] } {
  const roomsOut = rooms.map((r) => {
    const rt = (r.roomType ?? '').trim() || FALLBACK_ROOM_TYPE
    if (!c.allowInsulatedRooms && (rt === 'Raum gedämmt' || r.roomInsulated === true)) {
      const typeStr = FALLBACK_ROOM_TYPE
      return {
        ...r,
        roomType: typeStr,
        roomName: migrateRoomLabelDe(typeStr),
        roomInsulated: false,
      }
    }
    if (!c.allowWintergartenRoomType && rt === 'Wintergarten') {
      const typeStr = FALLBACK_ROOM_TYPE
      return {
        ...r,
        roomType: typeStr,
        roomName: migrateRoomLabelDe(typeStr),
        roomInsulated: roomInsulatedFromRoomPolygon({ ...r, roomType: typeStr }, typeStr),
      }
    }
    if (!c.allowBalkonRoomType && rt === 'Balkon') {
      const typeStr = FALLBACK_ROOM_TYPE
      return {
        ...r,
        roomType: typeStr,
        roomName: migrateRoomLabelDe(typeStr),
        roomInsulated: roomInsulatedFromRoomPolygon({ ...r, roomType: typeStr }, typeStr),
      }
    }
    return r
  })
  const doorsOut = doors.map((d) => {
    if (!c.allowGarageDoor && normalizeDoorType(d.type) === 'garage_door') {
      return { ...d, type: 'door' as DoorType }
    }
    return d
  })
  return { rooms: roomsOut, doors: doorsOut }
}

const round2 = (v: number) => Math.round(v * 100) / 100
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const DEMOLITION_PRICE_OPTIONS: { key: string; label: string }[] = [
  { key: 'aufstockung_demolition_roof_basic_m2', label: 'Standard / Flach' },
  { key: 'aufstockung_demolition_roof_complex_m2', label: 'Komplex / steile Form' },
  { key: 'aufstockung_demolition_roof_special_m2', label: 'Sonderlage' },
]

function polygonAreaM2FromPx(points: Point[], metersPerPixel: number | null | undefined): number {
  if (points.length < 3) return 0
  let a = 0
  for (let i = 0, n = points.length; i < n; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % n]
    a += x1 * y2 - x2 * y1
  }
  const pxArea = Math.abs(a) / 2
  if (!metersPerPixel || metersPerPixel <= 0) return 0
  return round2(pxArea * metersPerPixel * metersPerPixel)
}

function withDemolitionAreas(
  polys: RoofDemolitionPoly[],
  metersPerPixel: number | null | undefined,
): RoofDemolitionPoly[] {
  return polys.map((d) => ({
    ...d,
    area_m2: polygonAreaM2FromPx(d.points, metersPerPixel),
  }))
}

/** Prima scară validă din listă (fallback între etaje). */
function firstValidMppFromPlansList(plans: Array<{ metersPerPixel?: number | null }>): number | null {
  for (const pl of plans) {
    const m = pl?.metersPerPixel
    if (typeof m === 'number' && m > 0) return m
  }
  return null
}

/**
 * Dacă API-ul nu are încă metersPerPixel pentru acest raster: m/px din înălțimea ușilor/ferestrelor
 * (același plan ca „camerele” — cerință Aufstockung când există și acoperiș pe etaj).
 */
function inferMppFromDoorHeights(plan: { doors?: DoorRect[] } | null | undefined): number | null {
  const doors = plan?.doors
  if (!Array.isArray(doors) || doors.length === 0) return null
  for (const d of doors) {
    const h = typeof d.height_m === 'number' && d.height_m > 0 ? d.height_m : null
    if (!h || !d.bbox || d.bbox.length < 4) continue
    const [, y1, , y2] = d.bbox
    const pxH = Math.abs(y2 - y1)
    if (pxH > 1) return h / pxH
  }
  return null
}

/** m/px pentru un plan din snapshot (încărcare API sau prev state): etaj propriu → uși → orice etaj cu scară. */
function resolveMppForPlanIdxInSnapshot(
  planIdx: number,
  plans: Array<{ metersPerPixel?: number | null; doors?: DoorRect[] }>,
): number | null {
  const plan = plans[planIdx]
  if (!plan) return firstValidMppFromPlansList(plans)
  const own = plan.metersPerPixel
  if (typeof own === 'number' && own > 0) return own
  const inferred = inferMppFromDoorHeights(plan)
  if (typeof inferred === 'number' && inferred > 0) return inferred
  return firstValidMppFromPlansList(plans)
}

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

function normalizeFloorKindForAufstockung(k: unknown): 'new' | 'existing' {
  return String(k ?? '').toLowerCase() === 'new' ? 'new' : 'existing'
}

function padFloorKindsToN(kinds: Array<string | 'new' | 'existing' | undefined>, n: number): ('new' | 'existing')[] {
  return Array.from({ length: n }, (_, i) => normalizeFloorKindForAufstockung(kinds[i]))
}

function isFixedExistingFloorLabel(labelRaw: unknown): boolean {
  const label = String(labelRaw ?? '').toLowerCase()
  return (
    label.includes('keller') ||
    label.includes('kellergeschoss') ||
    label.includes('untergeschoss') ||
    label.includes('basement') ||
    label.includes('grundriss kg') ||
    label.includes('erdgeschoss') ||
    label.includes('ground floor') ||
    label.includes('grundriss eg')
  )
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
  forceAufstockungFlow?: boolean
  displayCurrency?: DisplayCurrency
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export function DetectionsReviewEditor({
  offerId,
  images,
  roofImages,
  roofOnlyOffer = false,
  forceAufstockungFlow = false,
  displayCurrency = 'EUR',
  onConfirm,
  onCancel,
}: DetectionsReviewEditorProps) {
  const [tool, setTool] = useState<Tool>('select')
  const [planIndex, setPlanIndex] = useState(0)
  const [tabPerPlan, setTabPerPlan] = useState<Record<number, ReviewTab>>({})
  const [plansData, setPlansData] = useState<PlanData[]>([])
  const [floorLabels, setFloorLabels] = useState<string[]>([])
  const [floorKinds, setFloorKinds] = useState<string[]>([])
  /** Din `GET .../detections-review-data` (`offers.meta.wizard_package`); dacă StepWizard pierde fluxul, tot deschidem Aufstockung. */
  const [wizardPackageFromApi, setWizardPackageFromApi] = useState('')
  /** Permutation: index from bottom (0 = lowest floor) → raster/plan index. PDF & tabs use this order (top tab = lowest floor). */
  const [floorPlanOrder, setFloorPlanOrder] = useState<number[]>([])
  const [floorOrderDraft, setFloorOrderDraft] = useState<number[]>([])
  /** În modul reordonare (Aufstockung): Bestand / Zubau per planIdx, ca în formularul Gebäudestruktur. */
  const [floorKindsDraft, setFloorKindsDraft] = useState<('new' | 'existing')[]>([])
  const [reorderKindsError, setReorderKindsError] = useState<string | null>(null)
  const [reorderFloorsMode, setReorderFloorsMode] = useState(false)
  const [dragFromDisplayIdx, setDragFromDisplayIdx] = useState<number | null>(null)
  const floorPlanOrderRef = useRef<number[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPolygonIndex, setSelectedPolygonIndex] = useState<number | null>(null)
  const [newPolygonPoints, setNewPolygonPoints] = useState<Point[] | null>(null)
  const [newDoorType, setNewDoorType] = useState<DoorType>('door')
  const [editorConstraints, setEditorConstraints] = useState<EditorConstraints>(() => mergeEditorConstraints(undefined))
  const [pendingNewRoomPoints, setPendingNewRoomPoints] = useState<Point[] | null>(null)
  const [pendingDemolitionPoints, setPendingDemolitionPoints] = useState<Point[] | null>(null)
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
  /** Preview Dach din roof-review-data pentru strat comun Aufstockung (Aufstandsfläche + Treppenöffnung + Dach). */
  const [roofPreviewByPlan, setRoofPreviewByPlan] = useState<RoomPolygon[][]>([])
  /** Dreptunghiuri Dach sincronizate live din RoofReviewEditor (evită overlay învechit față de poll-ul API). */
  const [roofLiveOverlayByPlan, setRoofLiveOverlayByPlan] = useState<Record<number, RoomPolygon[]>>({})
  /** Zoom/pan partajat între canvas-ul de fază 1 și RoofReviewEditor (Aufstockung Dach-Stack). */
  const [roofStackView, setRoofStackView] = useState({ zoom: 1, pan: { x: 0, y: 0 } })
  const statikCustomPriceRef = useRef<HTMLInputElement>(null)
  const [statikPriceDraft, setStatikPriceDraft] = useState('')
  const lastStatikModeRef = useRef<StatikChoice['mode']>('none')
  const demolitionPriceInputRef = useRef<HTMLInputElement>(null)
  const [demolitionPriceDraft, setDemolitionPriceDraft] = useState('')

  const currentPlanStatikChoice: StatikChoice = useMemo(() => {
    const raw = plansData[planIndex]?.statikChoice
    if (!raw?.mode) return { mode: 'none' }
    return {
      mode: raw.mode,
      customPiecePrice:
        typeof raw.customPiecePrice === 'number' && Number.isFinite(raw.customPiecePrice)
          ? raw.customPiecePrice
          : undefined,
    }
  }, [plansData, planIndex])

  useEffect(() => {
    const prev = lastStatikModeRef.current
    const enteredSonder =
      currentPlanStatikChoice.mode === 'sonderkonstruktion' && prev !== 'sonderkonstruktion'
    if (enteredSonder) {
      const p = currentPlanStatikChoice.customPiecePrice
      setStatikPriceDraft(p !== undefined && Number.isFinite(p) ? String(p) : '')
      queueMicrotask(() => statikCustomPriceRef.current?.focus())
    }
    if (currentPlanStatikChoice.mode !== 'sonderkonstruktion') {
      setStatikPriceDraft('')
    }
    lastStatikModeRef.current = currentPlanStatikChoice.mode
  }, [currentPlanStatikChoice.mode, currentPlanStatikChoice.customPiecePrice])

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

  const roomTypeOptions = useMemo((): RoomTypeOption[] => {
    const c = editorConstraints
    return ALL_ROOM_TYPE_OPTIONS.filter((opt) => {
      if (opt === 'Raum gedämmt' && !c.allowInsulatedRooms) return false
      if (opt === 'Wintergarten' && !roofOnlyOffer && !c.allowWintergartenRoomType) return false
      if (opt === 'Balkon' && !roofOnlyOffer && !c.allowBalkonRoomType) return false
      return true
    })
  }, [editorConstraints, roofOnlyOffer])

  const allowedDoorTypes = useMemo(
    () => ALL_DOOR_TYPES.filter((t) => t !== 'garage_door' || editorConstraints.allowGarageDoor),
    [editorConstraints.allowGarageDoor],
  )

  useEffect(() => {
    if (!editorConstraints.allowGarageDoor && newDoorType === 'garage_door') {
      setNewDoorType('door')
    }
  }, [editorConstraints.allowGarageDoor, newDoorType])

  useEffect(() => {
    if (editorConstraints.allowRoofWindows) return
    setTabPerPlan((prev) => {
      let changed = false
      const next: Record<number, ReviewTab> = { ...prev }
      for (const key of Object.keys(next)) {
        const idx = Number(key)
        if (!Number.isFinite(idx)) continue
        if (next[idx] === 'roof_windows') {
          next[idx] = 'roof'
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [editorConstraints.allowRoofWindows])

  /**
   * LiveFeed trimite câte un batch cu base+rooms+doors per plan; lista `images` este intercalată
   * ([base₁, rooms₁, doors₁, base₂, …]). Tab-urile trebuie să folosească doar `detections_review_base.png`
   * per etaj, altfel planIdx 1 ar lua rooms₁ (sau toate cad pe fallback la images[0]).
   */
  const blueprintBaseImages = useMemo(() => {
    const isBase = (f: { url?: string; caption?: string }) => {
      const c = String(f.caption ?? '').toLowerCase()
      const u = String(f.url ?? '').toLowerCase()
      return (
        c.endsWith('detections_review_base.png') ||
        u.includes('/detections_review_base.png') ||
        u.endsWith('detections_review_base.png')
      )
    }
    const bases = images.filter(isBase)
    if (bases.length > 0) return bases
    return images
  }, [images])

  const n = plansData.length > 0 ? plansData.length : Math.max(1, blueprintBaseImages.length)
  const planIndexClamped = n > 0 ? Math.max(0, Math.min(planIndex, n - 1)) : 0
  const currentPlan = plansData[planIndexClamped]

  // Sync the demolition price draft text when navigating between plans.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const price = plansData[planIndexClamped]?.customDemolitionPrice
    setDemolitionPriceDraft(typeof price === 'number' && Number.isFinite(price) ? String(price) : '')
  }, [planIndexClamped])

  // O imagine de bază per plan (fără poligoane); canvas-ul desenează rooms/doors din API
  const getBaseImageUrl = (planIdx: number) =>
    blueprintBaseImages[planIdx]?.url ?? blueprintBaseImages[0]?.url ?? images[0]?.url
  // Același blueprint ca Räume / Fenster; roofImages poate veni mai târziu sau cu alt URL → încărcare lentă / refresh.
  const roofImgs = roofOnlyOffer && roofImages?.length ? roofImages : blueprintBaseImages
  const roofEditorBasemapImages = blueprintBaseImages.length > 0 ? blueprintBaseImages : roofImgs

  const plansDimKey =
    plansData.length === 0
      ? ''
      : `${plansData.length}|${plansData.map((p) => `${Number(p.imageWidth) || 0}x${Number(p.imageHeight) || 0}`).join('|')}`
  const roofEmbeddedSeeds = useMemo((): Array<{ imageWidth: number; imageHeight: number }> | undefined => {
    if (plansData.length === 0) return undefined
    return plansData.map((p) => ({
      imageWidth: Number(p.imageWidth) || 0,
      imageHeight: Number(p.imageHeight) || 0,
    }))
  }, [plansDimKey])
  const effectiveForceAufstockung =
    forceAufstockungFlow || String(wizardPackageFromApi).toLowerCase().trim() === 'aufstockung'
  const effectiveFloorKinds = useMemo(() => {
    const normalizedRaw = floorKinds.map((k) => (String(k).toLowerCase() === 'new' ? 'new' : 'existing')) as ('new' | 'existing')[]
    const hintN = plansData.length > 0 ? plansData.length : Math.max(1, blueprintBaseImages.length)
    const forceExistingByLabel = (kinds: ('new' | 'existing')[]) =>
      kinds.map((kind, idx) =>
        isFixedExistingFloorLabel(displayFloorTabLabelDe(floorLabels[idx] ?? `Plan ${idx + 1}`)) ? 'existing' : kind,
      ) as ('new' | 'existing')[]

    if (normalizedRaw.length > 0) {
      // Right-align: prepend 'existing' for implicit EG when listaEtaje starts above ground.
      if (normalizedRaw.length < hintN) {
        const pad = hintN - normalizedRaw.length
        return forceExistingByLabel([...Array<'existing'>(pad).fill('existing'), ...normalizedRaw])
      }
      return forceExistingByLabel(normalizedRaw.slice(0, hintN))
    }
    if (!effectiveForceAufstockung) return normalizedRaw
    // Fallback when no floor-kinds saved yet: all floors default to 'existing'.
    // User can mark specific floors as Aufstockung in the reorder panel.
    return forceExistingByLabel(Array.from({ length: hintN }, (): 'existing' => 'existing'))
  }, [floorKinds, effectiveForceAufstockung, plansData.length, blueprintBaseImages.length, floorLabels])

  /** Aufstockung: m/px per etaj; dacă lipsește, din uși/ferestre pe același plan, apoi orice etaj cu scară. */
  const resolveMppForPlanIndex = useCallback(
    (planIdx: number, preferred?: number | null) => {
      if (typeof preferred === 'number' && preferred > 0) return preferred
      return resolveMppForPlanIdxInSnapshot(planIdx, plansData)
    },
    [plansData],
  )

  const getTabForPlan = useCallback(
    (planIdx: number): ReviewTab => {
      const raw = tabPerPlan[planIdx] ?? 'rooms'
      if (roofOnlyOffer && raw === 'doors') return 'rooms'
      if (!editorConstraints.allowRoofWindows && raw === 'roof_windows') return 'roof'
      const auf = effectiveFloorKinds.length > 0
      const fk = String(effectiveFloorKinds[planIdx] ?? 'new').toLowerCase() === 'new' ? 'new' : 'existing'
      if (auf && fk === 'existing') {
        if (raw === 'phase1_demolition' || raw === 'phase1_stair' || raw === 'roof' || raw === 'roof_windows') return raw
        return 'phase1_demolition'
      }
      if (raw === 'phase1_demolition' || raw === 'phase1_stair') return 'rooms'
      return raw
    },
    [roofOnlyOffer, tabPerPlan, editorConstraints.allowRoofWindows, effectiveFloorKinds],
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
      setWizardPackageFromApi('')
      setEditorConstraints(mergeEditorConstraints(undefined))
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
            floorKinds?: string[]
            wizardPackage?: string
            statikChoice?: { mode?: 'none' | 'stahlbetonverbunddecke' | 'sonderkonstruktion'; customPiecePrice?: number }
            editorConstraints?: Partial<EditorConstraints>
          }
          const constraints = mergeEditorConstraints(res.editorConstraints)
          const plans = Array.isArray(res?.plans) ? res.plans : []
          const normalized = plans.map((p, planIdx) => {
            const mppThisPlan = resolveMppForPlanIdxInSnapshot(planIdx, plans)
            const rawDemo = Array.isArray(p.roofDemolitions) ? p.roofDemolitions : []
            const roofDemolitions: RoofDemolitionPoly[] = rawDemo
              .map((d: { points?: Point[]; price_key?: string; priceKey?: string; area_m2?: number; area?: number }) => ({
                points: Array.isArray(d.points) ? mergeClosePolygonPoints(d.points, MERGE_VERTEX_DIST_PX) : [],
                price_key:
                  typeof d.price_key === 'string'
                    ? d.price_key
                    : typeof d.priceKey === 'string'
                      ? d.priceKey
                      : 'aufstockung_demolition_roof_basic_m2',
                area_m2: typeof d.area_m2 === 'number' ? d.area_m2 : typeof d.area === 'number' ? d.area : undefined,
              }))
              .filter((d) => d.points.length >= 3)
            const rawStairs = Array.isArray(p.stairOpenings) ? p.stairOpenings : []
            const stairOpenings = rawStairs
              .map((s: { bbox?: DoorRect['bbox']; price_key?: string; quantity?: number; area_m2?: number }) => {
                const b = s.bbox
                if (!Array.isArray(b) || b.length < 4) return null
                  let price_key =
                    typeof s.price_key === 'string' ? s.price_key : 'aufstockung_stair_opening_piece'
                if (price_key === 'aufstockung_stair_opening_m2') {
                  price_key = 'aufstockung_stair_opening_piece'
                }
                let area_m2: number | undefined =
                  typeof s.area_m2 === 'number' && Number.isFinite(s.area_m2) ? s.area_m2 : undefined
                if ((area_m2 === undefined || area_m2 <= 0) && mppThisPlan != null && mppThisPlan > 0) {
                  const wPx = Math.max(0, (b[2] as number) - (b[0] as number))
                  const hPx = Math.max(0, (b[3] as number) - (b[1] as number))
                  area_m2 = round2(wPx * hPx * mppThisPlan * mppThisPlan)
                }
                return {
                  bbox: b as DoorRect['bbox'],
                  type: 'stair_opening',
                  price_key,
                  quantity: typeof s.quantity === 'number' ? s.quantity : 1,
                  area_m2,
                }
              })
              .filter(Boolean) as Array<DoorRect & { price_key?: string; quantity?: number; area_m2?: number }>
            return {
            ...p,
            metersPerPixel: typeof p.metersPerPixel === 'number' ? p.metersPerPixel : null,
            roofDemolitions,
            stairOpenings,
            customDemolitionPrice: typeof (p as { customDemolitionPrice?: unknown }).customDemolitionPrice === 'number' ? (p as { customDemolitionPrice?: unknown }).customDemolitionPrice as number : null,
            statikChoice: (() => {
              const planStatik = (p as { statikChoice?: StatikChoice }).statikChoice
              const raw = planStatik?.mode
                ? planStatik
                : res?.statikChoice?.mode
                  ? (res.statikChoice as StatikChoice)
                  : null
              if (!raw) return { mode: 'none' } as StatikChoice
              return {
                mode: raw.mode,
                customPiecePrice:
                  typeof raw.customPiecePrice === 'number' && Number.isFinite(raw.customPiecePrice)
                    ? raw.customPiecePrice
                    : undefined,
              } as StatikChoice
            })(),
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
          }
          })
          const sanitizeConstraints: EditorConstraints = roofOnlyOffer
            ? { ...constraints, allowWintergartenRoomType: true, allowBalkonRoomType: true }
            : constraints
          const sanitized = normalized.map((p) => {
            const { rooms, doors } = sanitizeRoomsAndDoorsAgainstConstraints(p.rooms, p.doors, sanitizeConstraints)
            return { ...p, rooms, doors }
          })
          lastPlans = sanitized
          if (cancelled) return
          setEditorConstraints(constraints)
          setWizardPackageFromApi(typeof res?.wizardPackage === 'string' ? res.wizardPackage : '')
          setFloorLabels(Array.isArray(res?.floorLabels) ? res.floorLabels : [])
          setFloorKinds(Array.isArray(res?.floorKinds) ? res.floorKinds.map((k) => (String(k).toLowerCase() === 'new' ? 'new' : 'existing')) : [])
          const nl = sanitized.length
          const apiPerm = nl > 0 && isValidFloorPlanPerm(res?.floorPlanOrder, nl) ? (res!.floorPlanOrder as number[]) : null
          const initialOrder = nl > 0 ? (apiPerm ?? Array.from({ length: nl }, (_, i) => i)) : []
          setFloorPlanOrder(initialOrder)
          setFloorOrderDraft(initialOrder)
          floorPlanOrderRef.current = initialOrder
          if (sanitized.length > 0 || attempt === 11) {
            setPlansData(sanitized)
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
  }, [offerId, images.length, roofOnlyOffer])

  const detSaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveInFlightRef = useRef<Promise<boolean> | null>(null)
  const pendingAutosaveRef = useRef(false)
  const lastSavedPayloadRef = useRef<string>('')
  const buildDetectionsPayload = useCallback((snapshot: PlanData[]) => {
    const ord = floorPlanOrderRef.current
    const n = snapshot.length
    const body: {
      plans: { rooms: RoomPolygon[]; doors: DoorRect[]; roofDemolitions?: unknown[]; stairOpenings?: unknown[]; customDemolitionPrice?: number | null; statikChoice?: StatikChoice }[]
      floorPlanOrder?: number[]
      floorKinds?: string[]
      statikChoice?: StatikChoice
    } = {
      plans: snapshot.map((p) => ({
        rooms: p.rooms,
        doors: p.doors,
        roofDemolitions: Array.isArray(p.roofDemolitions) ? p.roofDemolitions : [],
        stairOpenings: Array.isArray(p.stairOpenings) ? p.stairOpenings : [],
        customDemolitionPrice: typeof p.customDemolitionPrice === 'number' ? p.customDemolitionPrice : null,
        statikChoice: p.statikChoice && p.statikChoice.mode ? p.statikChoice : { mode: 'none' },
      })),
    }
    if (n > 0 && ord.length === n && isValidFloorPlanPerm(ord, n)) {
      body.floorPlanOrder = ord
    }
    const floorKindsNormalized = floorKinds.map((k) => (String(k).toLowerCase() === 'new' ? 'new' : 'existing'))
    const floorKindsAligned = floorLabels.length > 0 && floorKindsNormalized.length > 0 && floorKindsNormalized.length < floorLabels.length
      ? [...new Array(floorLabels.length - floorKindsNormalized.length).fill('existing'), ...floorKindsNormalized]
      : floorKindsNormalized
    const floorKindsSanitized = floorKindsAligned.map((kind, idx) =>
      isFixedExistingFloorLabel(displayFloorTabLabelDe(floorLabels[idx] ?? `Plan ${idx + 1}`)) ? 'existing' : kind,
    )
    if (floorKindsSanitized.length > 0) {
      body.floorKinds = floorKindsSanitized
    }
    const firstExistingIdx = floorKindsSanitized.findIndex((k) => String(k).toLowerCase() !== 'new')
    if (firstExistingIdx >= 0 && firstExistingIdx < snapshot.length) {
      body.statikChoice = snapshot[firstExistingIdx]?.statikChoice ?? { mode: 'none' }
    } else {
      body.statikChoice = { mode: 'none' }
    }
    return JSON.stringify(body)
  }, [floorKinds, floorLabels])

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

  const setRoofDemolitions = useCallback((planIdx: number, polys: RoofDemolitionPoly[], mppOverride?: number | null) => {
    setPlansData((prev) => {
      const next = [...prev]
      if (planIdx >= next.length) return next
      const mpp =
        typeof mppOverride === 'number' && mppOverride > 0
          ? mppOverride
          : resolveMppForPlanIdxInSnapshot(planIdx, next)
      next[planIdx] = { ...next[planIdx], roofDemolitions: withDemolitionAreas(polys, mpp) }
      return next
    })
  }, [])

  const setCustomDemolitionPrice = useCallback((planIdx: number, price: number | null) => {
    setPlansData((prev) => {
      const next = [...prev]
      if (planIdx >= next.length) return next
      next[planIdx] = { ...next[planIdx], customDemolitionPrice: price }
      return next
    })
  }, [])

  const setPlanStatikChoice = useCallback((planIdx: number, choice: StatikChoice) => {
    setPlansData((prev) => {
      const next = [...prev]
      if (planIdx >= next.length) return next
      next[planIdx] = { ...next[planIdx], statikChoice: choice }
      return next
    })
  }, [])

  const setStairOpenings = useCallback((planIdx: number, rects: DoorRect[]) => {
    setPlansData((prev) => {
      const next = [...prev]
      if (planIdx >= next.length) return next
      const old =
        (next[planIdx].stairOpenings as Array<DoorRect & { price_key?: string; quantity?: number; area_m2?: number }>) ?? []
      const mpp = resolveMppForPlanIdxInSnapshot(planIdx, prev)
      const out = rects.map((r, i) => {
        const prevPk = old[i]?.price_key
        const pk =
          prevPk === 'aufstockung_stair_opening_m2'
            ? 'aufstockung_stair_opening_piece'
            : prevPk ?? 'aufstockung_stair_opening_piece'
        let area_m2: number | undefined
        if (Array.isArray(r.bbox) && r.bbox.length >= 4 && mpp != null && mpp > 0) {
          const [x1, y1, x2, y2] = r.bbox
          const wPx = Math.max(0, x2 - x1)
          const hPx = Math.max(0, y2 - y1)
          area_m2 = round2(wPx * hPx * mpp * mpp)
        }
        return {
          ...r,
          type: 'stair_opening' as const,
          price_key: pk,
          quantity: old[i]?.quantity ?? 1,
          ...(typeof area_m2 === 'number' && area_m2 > 0 ? { area_m2 } : {}),
        }
      })
      next[planIdx] = { ...next[planIdx], stairOpenings: out }
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
    const tabNow = getTabForPlan(pi)
    if (tabNow === 'roof' || tabNow === 'roof_windows') return
    setPlansData((prev) => {
      if (pi >= prev.length) return prev
      const plan = prev[pi]
      if (!plan) return prev
      const out = [...prev]
      if (tabNow === 'rooms') {
        if (idx >= plan.rooms.length) return prev
        out[pi] = { ...plan, rooms: plan.rooms.filter((_, i) => i !== idx) }
        return out
      }
      if (tabNow === 'phase1_demolition') {
        const list = plan.roofDemolitions ?? []
        if (idx >= list.length) return prev
        const next = list.filter((_, i) => i !== idx)
        const mpp = resolveMppForPlanIdxInSnapshot(pi, prev)
        out[pi] = { ...plan, roofDemolitions: withDemolitionAreas(next, mpp) }
        return out
      }
      if (tabNow === 'phase1_stair') {
        const list = plan.stairOpenings ?? []
        if (idx >= list.length) return prev
        out[pi] = { ...plan, stairOpenings: list.filter((_, i) => i !== idx) as typeof list }
        return out
      }
      if (tabNow === 'doors') {
        if (idx >= plan.doors.length) return prev
        out[pi] = { ...plan, doors: plan.doors.filter((_, i) => i !== idx) }
        return out
      }
      return prev
    })
    setSelectedPolygonIndex(null)
  }, [getTabForPlan, selectedPolygonIndex, planIndexClamped, pushHistory])

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
    const t = getTabForPlan(planIndexClamped)
    if (t === 'phase1_demolition') {
      pushHistory()
      const mpp = resolveMppForPlanIndex(planIndexClamped, currentPlan.metersPerPixel)
      const area_m2 = polygonAreaM2FromPx(newPolygonPoints, mpp)
      const prev = currentPlan.roofDemolitions ?? []
      const fallbackKey = DEMOLITION_PRICE_OPTIONS[0]?.key ?? 'aufstockung_roof_demolition_m2'
      // Aufstandsfläche is a single-step action: save polygon immediately, no price-choice popup.
      setRoofDemolitions(planIndexClamped, [...prev, { points: [...newPolygonPoints], price_key: fallbackKey, area_m2 }], mpp)
      setNewPolygonPoints(null)
      return
    }
    setPendingNewRoomPoints([...newPolygonPoints])
    setNewPolygonPoints(null)
  }, [newPolygonPoints, currentPlan, getTabForPlan, planIndexClamped, pushHistory, resolveMppForPlanIndex, setRoofDemolitions])

  const handlePickDemolitionPriceKey = useCallback(
    (price_key: string) => {
      if (!pendingDemolitionPoints || pendingDemolitionPoints.length < 3 || !currentPlan) return
      pushHistory()
      const mpp = resolveMppForPlanIndex(planIndexClamped, currentPlan.metersPerPixel)
      const area_m2 = polygonAreaM2FromPx(pendingDemolitionPoints, mpp)
      const prev = currentPlan.roofDemolitions ?? []
      setRoofDemolitions(planIndexClamped, [...prev, { points: pendingDemolitionPoints, price_key, area_m2 }], mpp)
      setPendingDemolitionPoints(null)
    },
    [pendingDemolitionPoints, currentPlan, pushHistory, setRoofDemolitions, planIndexClamped, resolveMppForPlanIndex],
  )

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
    if (doorType === 'garage_door' && !editorConstraints.allowGarageDoor) return
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
  }, [selectedPolygonIndex, planIndexClamped, plansData, setDoors, pushHistory, getTabForPlan, editorConstraints.allowGarageDoor])

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
    setPendingDemolitionPoints(null)
  }, [planIndex])

  useEffect(() => {
    if (newPolygonPoints?.length !== 2) return
    const t = getTabForPlan(planIndexClamped)
    if (t !== 'doors' && t !== 'phase1_stair') return
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

    if (t === 'phase1_stair') {
      pushHistory()
      const mpp = resolveMppForPlanIndex(planIndexClamped, plan.metersPerPixel)
      const wPx = Math.max(0, bbox[2] - bbox[0])
      const hPx = Math.max(0, bbox[3] - bbox[1])
      const area_m2 =
        typeof mpp === 'number' && mpp > 0 ? round2(wPx * hPx * mpp * mpp) : 0
      setStairOpenings(planIndexClamped, [
        ...(plan.stairOpenings ?? []),
        {
          bbox,
          type: 'stair_opening',
          price_key: 'aufstockung_stair_opening_piece',
          area_m2,
        },
      ])
      return
    }

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
  }, [
    newPolygonPoints,
    planIndexClamped,
    getTabForPlan,
    plansData,
    newDoorType,
    pushHistory,
    setDoors,
    setStairOpenings,
    resolveMppForPlanIndex,
  ])

  const activeTab = getTabForPlan(planIndexClamped)
  const isAufstockungFlow = effectiveFloorKinds.length > 0
  const currentFloorKind = String(effectiveFloorKinds[planIndexClamped] ?? 'new').toLowerCase() === 'new' ? 'new' : 'existing'
  /** Bestand etaj în Aufstockung: Dach-Rückbau + Treppenöffnung; Zubau: Räume / Türen / Dach wie Neubau. */
  const existingFloorEditing = isAufstockungFlow && currentFloorKind === 'existing'

  const handleRoofRectanglesOverlaySync = useCallback(
    (
      planIdx: number,
      rectangles: RoomPolygon[],
      sourceImageDims?: { imageWidth: number; imageHeight: number },
    ) => {
      const plan = plansDataRef.current[planIdx]
      const toW = Number(plan?.imageWidth) || 0
      const toH = Number(plan?.imageHeight) || 0
      const fromW = Number(sourceImageDims?.imageWidth) || 0
      const fromH = Number(sourceImageDims?.imageHeight) || 0
      const scaled =
        fromW > 0 && fromH > 0 && toW > 0 && toH > 0
          ? scaleRoofRectsToDetectionsSpace(rectangles, fromW, fromH, toW, toH)
          : rectangles
      if (scaled.length > 0 && toW > 0 && toH > 0) {
        const { maxX, maxY } = roofOverlayMaxExtent(scaled)
        /** Același spațiu ca Aufstandsfläche: dacă sync-ul ar depăși clar planul, ignorăm live (rămâne roofPreview scalat). */
        const OUT = 1.08
        if (maxX > toW * OUT || maxY > toH * OUT) {
          setRoofLiveOverlayByPlan((prev) => {
            const next = { ...prev }
            delete next[planIdx]
            return next
          })
          return
        }
      }
      setRoofLiveOverlayByPlan((prev) => ({ ...prev, [planIdx]: scaled }))
    },
    [],
  )

  useEffect(() => {
    setRoofLiveOverlayByPlan({})
  }, [offerId])

  useEffect(() => {
    if (!offerId || !existingFloorEditing) {
      setRoofPreviewByPlan([])
      setRoofLiveOverlayByPlan({})
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const res = (await apiFetch(`/offers/${offerId}/compute/roof-review-data?ts=${Date.now()}`)) as {
          plans?: Array<{ imageWidth?: number; imageHeight?: number; rectangles?: RoomPolygon[] }>
        }
        if (cancelled) return
        const rawPlans = res.plans ?? []
        const seeds = roofEmbeddedSeeds
        const nSlots = Math.max(rawPlans.length, seeds?.length ?? 0)
        const next: RoomPolygon[][] = Array.from({ length: nSlots }, () => [])
        for (let i = 0; i < rawPlans.length; i++) {
          const p = rawPlans[i]
          const rects = Array.isArray(p.rectangles) ? p.rectangles : []
          const fromW = Number(p.imageWidth) || 0
          const fromH = Number(p.imageHeight) || 0
          const seedIdx = matchRoofRowToSeedIndex(p, seeds, i)
          const seed = seeds?.[seedIdx]
          const toW = Number(seed?.imageWidth) || 0
          const toH = Number(seed?.imageHeight) || 0
          const scaled =
            seed && toW > 0 && toH > 0 && fromW > 0 && fromH > 0
              ? scaleRoofRectsToDetectionsSpace(rects, fromW, fromH, toW, toH)
              : rects
          next[seedIdx] = scaled
        }
        setRoofPreviewByPlan(next)
      } catch {
        if (!cancelled) setRoofPreviewByPlan([])
      }
    }
    void load()
    const t = window.setInterval(load, 4000)
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [offerId, existingFloorEditing, plansDimKey, roofEmbeddedSeeds])

  const roofSurfaceTabForChild: RoofSurfaceTab =
    activeTab === 'roof_windows' ? 'windows' : 'surfaces'

  const setRoofSurfaceTabForEditor = useCallback(
    (tabOrUpdater: SetStateAction<RoofSurfaceTab>) => {
      setTabPerPlan((prev) => {
        const planIdx = planIndexClamped
        const raw = prev[planIdx]
        const curMain: ReviewTab = raw ?? 'rooms'
        if (curMain !== 'roof' && curMain !== 'roof_windows') {
          return prev
        }
        const curSurface: RoofSurfaceTab = curMain === 'roof_windows' ? 'windows' : 'surfaces'
        const next =
          typeof tabOrUpdater === 'function' ? tabOrUpdater(curSurface) : tabOrUpdater
        if (!editorConstraints.allowRoofWindows && next === 'windows') {
          return { ...prev, [planIdx]: 'roof' }
        }
        const nextReview: ReviewTab = next === 'windows' ? 'roof_windows' : 'roof'
        return { ...prev, [planIdx]: nextReview }
      })
    },
    [planIndexClamped, editorConstraints.allowRoofWindows],
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
      : activeTab === 'phase1_demolition'
        ? tool === 'select'
          ? 'Fläche wählen und verschieben'
          : tool === 'add'
            ? 'Polygon für Aufstockungs-Basis – ersten Punkt erneut klicken zum Schließen, dann Rückbautyp wählen'
            : tool === 'remove'
              ? 'Fläche zum Entfernen anklicken'
              : tool === 'edit'
                ? 'Punkte und Kanten ziehen'
                : ''
        : activeTab === 'phase1_stair'
          ? tool === 'select'
            ? 'Rechteck wählen und verschieben'
            : tool === 'add'
              ? 'Zwei Ecken für Treppenöffnung (Rechteck)'
              : tool === 'remove'
                ? 'Öffnung zum Entfernen anklicken'
                : tool === 'edit'
                  ? 'Ecken ziehen'
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

  const handleInsertDemolitionVertex = useCallback(
    (planIdx: number, polyIndex: number, afterVertexIndex: number, x: number, y: number) => {
      const plan = plansData[planIdx]
      const list = plan?.roofDemolitions ?? []
      if (!plan || polyIndex >= list.length || afterVertexIndex < 0) return
      pushHistory()
      const pts = list[polyIndex].points
      const newPts = [...pts.slice(0, afterVertexIndex + 1), [x, y] as Point, ...pts.slice(afterVertexIndex + 1)]
      const next = list.map((d, i) => (i !== polyIndex ? d : { ...d, points: newPts }))
      setRoofDemolitions(planIdx, next)
    },
    [plansData, setRoofDemolitions, pushHistory],
  )

  const showRoofWorkspace = activeTab === 'roof' || activeTab === 'roof_windows'
  /** Dach: bei Aufstockung Bestand Plan + Phase-1-Overlays unter dem Roof-Vector-Layer; sonst nur RoofReviewEditor. */
  const showRoomsCanvas =
    plansData.length > 0 &&
    (activeTab !== 'roof' && activeTab !== 'roof_windows' || existingFloorEditing)

  const stackRoofOverPhase1 =
    existingFloorEditing && showRoofWorkspace && Boolean(offerId) && roofEditorBasemapImages.length > 0

  const stackBlueprintImageUrl = blueprintBaseImages[planIndexClamped]?.url ?? blueprintBaseImages[0]?.url ?? ''
  useEffect(() => {
    if (!stackRoofOverPhase1) return
    setRoofStackView({ zoom: 1, pan: { x: 0, y: 0 } })
  }, [stackRoofOverPhase1, planIndexClamped, stackBlueprintImageUrl])

  const [phase1LayoutRevealKey, setPhase1LayoutRevealKey] = useState(0)
  useLayoutEffect(() => {
    if (!existingFloorEditing) return
    setPhase1LayoutRevealKey((k) => k + 1)
  }, [existingFloorEditing, planIndexClamped, activeTab, stackRoofOverPhase1])

  const roofOverlayRoomsForPhase1 = useMemo(() => {
    if (!existingFloorEditing) return []
    const idx = planIndexClamped
    if (stackRoofOverPhase1 && (activeTab === 'roof' || activeTab === 'roof_windows')) return []
    return roofLiveOverlayByPlan[idx] !== undefined
      ? roofLiveOverlayByPlan[idx]!
      : (roofPreviewByPlan[idx] ?? [])
  }, [
    existingFloorEditing,
    planIndexClamped,
    activeTab,
    stackRoofOverPhase1,
    roofLiveOverlayByPlan,
    roofPreviewByPlan,
  ])

  const showWerkzeuge = !loading && plansData.length > 0

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
        className="flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-semibold text-[#ffffff] shadow-md transition-all duration-200 ease-out bg-gradient-to-b from-[#e08414] to-[#f79116] hover:brightness-110 hover:-translate-y-[0.5px] active:translate-y-0"
      >
        <Check size={16} strokeWidth={2.25} />
        {isConfirming ? 'Speichern…' : 'Erkennung bestätigen – weiter'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-sand/90 border border-white/30 hover:bg-white/10 transition-all"
      >
        <X size={16} strokeWidth={2.25} />
        Abbrechen
      </button>
    </div>
  )

  return (
    <div className="relative w-full flex flex-col items-stretch gap-3 flex-1 min-h-0">
      {isConfirming && (
        <div
          className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-3 rounded-xl bg-black/65 backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-12 w-12 animate-spin text-[#E5B800]" aria-hidden />
          <span className="text-sand text-sm font-medium px-4 text-center">Berechnung wird gestartet…</span>
        </div>
      )}
      {/*
        1fr | auto | 1fr: etaje stânga, titlu + Werkzeuge centru, Statik dreapta (Aufstockung Bestand).
      */}
      <div className="grid w-full shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-x-3 px-2 pt-1 pb-1 min-w-0">
        <div className="flex min-h-0 min-w-0 flex-col items-start justify-center gap-1 self-stretch">
          {!loading && plansData.length > 0 && n > 1 && (
            <div className="flex w-fit max-w-full flex-col items-stretch gap-2">
              <div
                className="flex w-fit max-w-full flex-col-reverse items-stretch gap-1"
                role="tablist"
                aria-label="Etage wählen"
              >
                {(reorderFloorsMode ? floorOrderDraft : floorPlanOrder).map((planIdx, displayPos) => {
                  const label = displayFloorTabLabelDe(floorLabels[planIdx] ?? `Plan ${planIdx + 1}`)
                  const isActive = planIndexClamped === planIdx
                  const floorKindLabel =
                    String(effectiveFloorKinds[planIdx] ?? 'new').toLowerCase() === 'new' ? 'new' : 'existing'
                  const bottomPlanIdx = reorderFloorsMode ? (floorOrderDraft[0] ?? -1) : (floorPlanOrder[0] ?? -1)
                  const normalizedLabel = String(label ?? '').toLowerCase()
                  const isBasementFloor =
                    normalizedLabel.includes('keller') ||
                    normalizedLabel.includes('kellergeschoss') ||
                    normalizedLabel.includes('untergeschoss') ||
                    normalizedLabel.includes('basement') ||
                    normalizedLabel.includes('grundriss kg')
                  const isGroundFloorLabel =
                    normalizedLabel.includes('erdgeschoss') ||
                    normalizedLabel.includes('ground floor') ||
                    normalizedLabel.includes('grundriss eg')
                  const isBottomPhysicalFloor = reorderFloorsMode && isAufstockungFlow && planIdx === bottomPlanIdx
                  const isFixedExistingFloor =
                    reorderFloorsMode &&
                    isAufstockungFlow &&
                    (isGroundFloorLabel || isBasementFloor || isBottomPhysicalFloor)
                  const draftKind = normalizeFloorKindForAufstockung(floorKindsDraft[planIdx])
                  return (
                    <div
                      key={`floor-tab-wrap-${planIdx}-${displayPos}`}
                      className="flex flex-col gap-0 min-w-0"
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
                      <div className="flex items-stretch gap-1 min-w-0">
                        {reorderFloorsMode && (
                          <span
                            role="button"
                            tabIndex={0}
                            draggable
                            onDragStart={() => setDragFromDisplayIdx(displayPos)}
                            onDragEnd={() => setDragFromDisplayIdx(null)}
                            className="shrink-0 flex items-center justify-center px-0.5 text-sand/55 cursor-grab active:cursor-grabbing hover:text-sand/80"
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
                          title={label}
                          onClick={() => {
                            setPlanIndex(planIdx)
                            setSelectedPolygonIndex(null)
                            setNewPolygonPoints(null)
                            if (tool === 'add') setTool('select')
                          }}
                          className={`flex-1 min-w-0 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium text-left transition-colors ${
                            isActive
                              ? 'bg-[#E5B800]/25 text-[#E5B800] border border-[#E5B800]/50'
                              : 'text-sand/80 border border-white/10 hover:bg-white/5'
                          }`}
                        >
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="whitespace-nowrap">{label}</span>
                            {isAufstockungFlow && !reorderFloorsMode && (
                              <span
                                className={`text-[9px] font-semibold px-1.5 py-0 rounded border shrink-0 ${
                                  floorKindLabel === 'new'
                                    ? 'border-[#E5B800]/50 text-[#E5B800] bg-[#E5B800]/10'
                                    : 'border-white/25 text-sand/90 bg-white/5'
                                }`}
                              >
                                {floorKindLabel === 'new' ? 'Aufstockung' : 'Bestand'}
                              </span>
                            )}
                          </span>
                        </button>
                      </div>
                      {reorderFloorsMode && isAufstockungFlow && (
                        <div
                          className="flex flex-col gap-1 pt-1.5 pl-1 border-l border-white/10 ml-1.5 mt-0.5 max-w-[260px]"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          {isFixedExistingFloor ? (
                            <span className="text-xs text-sand/90">
                              {isBasementFloor ? 'Keller (immer Bestand)' : 'Erdgeschoss (immer Bestand)'}
                            </span>
                          ) : (
                            <>
                              <span className="text-[10px] text-sand/50">Bestand oder Aufstockung</span>
                              <div className="flex flex-wrap items-center gap-1">
                                <button
                                  type="button"
                                  className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                                    draftKind === 'existing'
                                      ? 'border-[#E5B800]/60 bg-[#E5B800]/15 text-[#E5B800]'
                                      : 'border-white/15 text-sand/70 hover:bg-white/5'
                                  }`}
                                  onClick={() =>
                                    setFloorKindsDraft((d) => {
                                      const next = padFloorKindsToN(d, n)
                                      next[planIdx] = 'existing'
                                      return next
                                    })
                                  }
                                >
                                  Bestand
                                </button>
                                <button
                                  type="button"
                                  className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                                    draftKind === 'new'
                                      ? 'border-[#E5B800]/60 bg-[#E5B800]/15 text-[#E5B800]'
                                      : 'border-white/15 text-sand/70 hover:bg-white/5'
                                  }`}
                                  onClick={() =>
                                    setFloorKindsDraft((d) => {
                                      const next = padFloorKindsToN(d, n)
                                      next[planIdx] = 'new'
                                      return next
                                    })
                                  }
                                >
                                  Aufstockung
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="mt-1.5 flex w-full max-w-[240px] flex-col gap-1">
                {reorderFloorsMode ? (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={async () => {
                        const nextOrder = [...floorOrderDraft]
                        if (!isValidFloorPlanPerm(nextOrder, n)) return
                        setReorderKindsError(null)
                        if (isAufstockungFlow) {
                          let nextKinds = padFloorKindsToN(floorKindsDraft, n)
                          const fixedExistingByLabel = new Set<number>()
                          for (let i = 0; i < n; i++) {
                            const rawLabel = displayFloorTabLabelDe(floorLabels[i] ?? `Plan ${i + 1}`).toLowerCase()
                            const isBasement =
                              rawLabel.includes('keller') ||
                              rawLabel.includes('kellergeschoss') ||
                              rawLabel.includes('untergeschoss') ||
                              rawLabel.includes('basement') ||
                              rawLabel.includes('grundriss kg')
                            const isGround =
                              rawLabel.includes('erdgeschoss') ||
                              rawLabel.includes('ground floor') ||
                              rawLabel.includes('grundriss eg')
                            if (isBasement || isGround) fixedExistingByLabel.add(i)
                          }
                          const bottom = nextOrder[0]
                          if (bottom >= 0 && bottom < n) fixedExistingByLabel.add(bottom)
                          fixedExistingByLabel.forEach((idx) => {
                            if (idx >= 0 && idx < n) nextKinds[idx] = 'existing'
                          })
                          if (!nextKinds.some((k) => k === 'new')) {
                            setReorderKindsError('Bitte markieren Sie mindestens ein neues Geschoss.')
                            return
                          }
                          setFloorKinds(nextKinds.map((k) => k))
                        }
                        floorPlanOrderRef.current = nextOrder
                        setFloorPlanOrder(nextOrder)
                        setFloorKindsDraft([])
                        setReorderFloorsMode(false)
                        setDragFromDisplayIdx(null)
                        await saveDetectionsToServer(true)
                      }}
                      className="min-w-0 flex-1 rounded-lg border border-[#E5B800]/40 bg-[#E5B800] px-2 py-1.5 text-xs font-semibold text-white hover:brightness-110"
                    >
                      Speichern
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFloorOrderDraft([...floorPlanOrder])
                        setFloorKindsDraft([])
                        setReorderKindsError(null)
                        setReorderFloorsMode(false)
                        setDragFromDisplayIdx(null)
                      }}
                      className="min-w-0 flex-1 rounded-lg border border-white/15 px-2 py-1.5 text-xs font-medium text-sand/85 hover:bg-white/5"
                    >
                      Abbrechen
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    title="Etagen neu anordnen (Griffe ziehen)"
                    onClick={() => {
                      setFloorOrderDraft([...floorPlanOrder])
                      setReorderKindsError(null)
                      if (isAufstockungFlow) {
                        setFloorKindsDraft(padFloorKindsToN(effectiveFloorKinds, n))
                      } else {
                        setFloorKindsDraft([])
                      }
                      setReorderFloorsMode(true)
                    }}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#E5B800] px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:brightness-110"
                  >
                    <GripVertical size={14} strokeWidth={2.25} className="shrink-0 opacity-90" aria-hidden />
                    Reihenfolge
                  </button>
                )}
                {reorderFloorsMode && (
                  <p className="text-[10px] leading-snug text-sand/55">
                    Griffe ziehen
                    {isAufstockungFlow ? ' · Bestand/Aufstockung' : ''}.
                  </p>
                )}
                {reorderKindsError && (
                  <p className="text-[10px] leading-snug text-orange-400/90">{reorderKindsError}</p>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex min-w-0 max-w-full flex-col items-center gap-3">
          <h2 className="text-white font-semibold text-base text-center max-w-2xl leading-snug mx-auto w-full">
            {roofOnlyOffer ? 'Grundriss (Räume), Dach und Öffnungen markieren' : 'Flächen und Elemente auswählen'}
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
              activeTab === 'phase1_demolition'
                ? 'Aufstockungs-Basis (Polygon) hinzufügen'
                : activeTab === 'phase1_stair'
                  ? 'Treppenöffnung (Rechteck) hinzufügen'
                  : activeTab === 'rooms'
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
          {allowedDoorTypes.map((dt) => (
            <button
              key={dt}
              type="button"
              onClick={() => setNewDoorType(dt)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${newDoorType === dt ? DOOR_TOOLBAR_ACTIVE[dt] : 'text-sand/70 border border-white/10 hover:bg-white/5'}`}
            >
              {DOOR_TYPE_LABELS_DE[dt]}
            </button>
          ))}
        </div>
      )}
      {tool === 'select' && activeTab === 'doors' && selectedPolygonIndex !== null && plansData[planIndexClamped]?.doors[selectedPolygonIndex] && (
        <div className="shrink-0 flex items-center justify-center gap-2 px-2 py-1.5 flex-wrap">
          <span className="text-sand/70 text-xs">Typ:</span>
          {allowedDoorTypes.map((doorType) => {
            const current = plansData[planIndexClamped]?.doors[selectedPolygonIndex]?.type ?? 'door'
            const isActive = normalizeDoorType(current) === doorType
            return (
              <button
                key={doorType}
                type="button"
                onClick={() => handlePickDoorType(doorType)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${isActive ? DOOR_TOOLBAR_ACTIVE[doorType] : 'text-sand/70 border border-white/10 hover:bg-white/5'}`}
              >
                {DOOR_TYPE_LABELS_DE[doorType]}
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
        <div className="flex min-h-0 min-w-0 flex-col self-start pt-0.5 w-full">
          {existingFloorEditing && (
            <div
              className="ml-auto flex w-full max-w-56 flex-col gap-2"
              title="Nur auf Bestandsgeschossen sichtbar."
            >
              <div
                className="flex flex-col gap-1"
                title={`Stahlbetonverbunddecke: Preis ${displayCurrency}/m² in der Preisdatenbank (aufstockung_statik_stahlbetonverbunddecke_m2)`}
              >
                <span className="text-sand/72 text-xs text-right font-medium tracking-tight">
                  Statik / Verstärkung
                </span>
                {currentPlanStatikChoice.mode !== 'sonderkonstruktion' ? (
                  <SelectSun
                    variant="editor"
                    editorTheme="beton"
                    editorSize="sm"
                    value={currentPlanStatikChoice.mode}
                    onChange={(v) => {
                      if (v === 'stahlbetonverbunddecke') {
                        setPlanStatikChoice(planIndexClamped, { mode: 'stahlbetonverbunddecke' })
                      } else if (v === 'sonderkonstruktion') {
                        setPlanStatikChoice(planIndexClamped, {
                          mode: 'sonderkonstruktion',
                          customPiecePrice: currentPlanStatikChoice.customPiecePrice,
                        })
                      } else {
                        setPlanStatikChoice(planIndexClamped, { mode: 'none' })
                      }
                    }}
                    options={[...STATIK_MODE_VALUES]}
                    placeholder="Typ wählen"
                    displayFor={statikModeSelectLabel}
                  />
                ) : (
                  <div className="flex w-full items-stretch gap-1">
                    <button
                      type="button"
                      title="Ertüchtigungsart wählen"
                      onClick={() => setPlanStatikChoice(planIndexClamped, { mode: 'none' })}
                      className="shrink-0 self-stretch rounded-md border border-white/12 bg-black/34 px-2 text-sand/78 shadow-[inset_0_1px_0_rgba(255,255,255,0.09)] transition-colors [-webkit-tap-highlight-color:transparent] hover:border-white/18 hover:bg-black/40 hover:text-sand/92 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5B800]/40 focus-visible:ring-offset-0"
                    >
                      <ChevronLeft size={15} strokeWidth={2} className="block" aria-hidden />
                    </button>
                    <input
                      ref={statikCustomPriceRef}
                      type="text"
                      inputMode="decimal"
                      placeholder={`Preis in ${displayCurrency}`}
                      autoComplete="off"
                      className="editor-statik-eur-beton min-w-0 flex-1 rounded-md border border-white/12 bg-black/34 px-2.5 py-2 text-xs text-sand/95 placeholder:text-sand/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.09)] backdrop-blur-[2px] outline-none transition-[border-color,box-shadow] selection:bg-[#E5B800]/28 selection:text-sand/95 [-webkit-tap-highlight-color:transparent]"
                      value={statikPriceDraft}
                      onChange={(e) => {
                        const t = e.target.value
                        setStatikPriceDraft(t)
                        const normalized = t.replace(/\s/g, '').replace(',', '.')
                        if (normalized === '' || normalized === '-') {
                          setPlanStatikChoice(planIndexClamped, { mode: 'sonderkonstruktion', customPiecePrice: undefined })
                          return
                        }
                        const n = Number(normalized)
                        if (Number.isFinite(n)) {
                          setPlanStatikChoice(planIndexClamped, { mode: 'sonderkonstruktion', customPiecePrice: n })
                        }
                      }}
                    />
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sand/72 text-xs text-right font-medium tracking-tight">
                  Abbruchkosten (Dach und evtl. Wände)
                </span>
                <input
                  ref={demolitionPriceInputRef}
                  type="text"
                  inputMode="decimal"
                  placeholder={`Gesamt in ${displayCurrency}`}
                  title={`Gesamtpauschale in ${displayCurrency} für alle Aufstandsflächen-Polygone dieses Plans`}
                  autoComplete="off"
                  className="editor-statik-eur-beton min-w-0 w-full rounded-md border border-white/12 bg-black/34 px-2.5 py-2 text-xs text-sand/95 placeholder:text-sand/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.09)] backdrop-blur-[2px] outline-none transition-[border-color,box-shadow] selection:bg-[#E5B800]/28 selection:text-sand/95 [-webkit-tap-highlight-color:transparent]"
                  value={demolitionPriceDraft}
                  onChange={(e) => {
                    const t = e.target.value
                    setDemolitionPriceDraft(t)
                    const normalized = t.replace(/\s/g, '').replace(',', '.')
                    if (normalized === '' || normalized === '-') {
                      setCustomDemolitionPrice(planIndexClamped, null)
                      return
                    }
                    const n = Number(normalized)
                    if (Number.isFinite(n)) {
                      setCustomDemolitionPrice(planIndexClamped, n)
                    }
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col px-2 pb-2 min-w-0 overflow-hidden">
        {loading && plansData.length === 0 ? (
          <div className="w-full flex-1 min-h-0 flex flex-col gap-2">
            <div className="relative w-full flex-1 min-h-[200px] rounded-lg overflow-hidden border border-[#E5B800]/50 bg-black/30 flex items-center justify-center">
              {blueprintBaseImages[0]?.url && (
                <img src={blueprintBaseImages[0].url} alt="" className="absolute inset-0 w-full h-full object-contain opacity-40" />
              )}
              <div className="relative z-10 flex flex-col items-center gap-2 text-sand/80">
                <div className="w-8 h-8 border-2 border-[#E5B800]/60 border-t-[#E5B800] rounded-full animate-spin" />
                <p className="text-sm font-medium">Lade Vektordaten…</p>
              </div>
            </div>
            <div className="shrink-0">{reviewFooterActions}</div>
          </div>
        ) : plansData.length === 0 && !loading ? (
          <div className="flex-1 min-h-0 flex flex-col w-full gap-2 overflow-y-auto overflow-x-hidden preisdatenbank-scroll">
            <div className="shrink-0 flex flex-col gap-2 w-full flex-1 min-h-0">
              <div className="flex flex-wrap gap-4 justify-center pb-1">
                {blueprintBaseImages.slice(0, n).map((img, i) => (
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
            const canvasTab =
              planTab === 'doors'
                ? 'doors'
                : planTab === 'phase1_demolition'
                  ? 'demolition'
                  : planTab === 'phase1_stair'
                    ? 'stair_opening'
                    : 'rooms'
            if (!plan || !imageUrlForPlan) return null
            return (
              <div className="w-full flex flex-col flex-1 min-h-0 min-w-0 gap-1.5">
                {plan && imageUrlForPlan && existingFloorEditing && (
                <div className="relative z-30 shrink-0 flex items-center justify-end gap-2 flex-wrap w-full min-w-0 pb-0.5">
                  <div className="flex gap-1 flex-wrap justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setTabForPlan(i, 'phase1_demolition')
                        setSelectedPolygonIndex(null)
                        setNewPolygonPoints(null)
                        if (tool === 'add') setTool('select')
                      }}
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-medium transition-colors ${planTab === 'phase1_demolition' ? 'bg-[#E5B800]/25 text-[#E5B800] border border-[#E5B800]/50' : 'text-sand/80 border border-white/10 hover:bg-white/5'}`}
                    >
                      <LayoutGrid size={14} strokeWidth={2} />
                      <span>Aufstandsfläche</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTabForPlan(i, 'phase1_stair')
                        setSelectedPolygonIndex(null)
                        setNewPolygonPoints(null)
                        if (tool === 'add') setTool('select')
                      }}
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-medium transition-colors ${planTab === 'phase1_stair' ? 'bg-[#E5B800]/25 text-[#E5B800] border border-[#E5B800]/50' : 'text-sand/80 border border-white/10 hover:bg-white/5'}`}
                    >
                      <DoorOpen size={14} strokeWidth={2} />
                      <span>Treppenöffnung</span>
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
                    {editorConstraints.allowRoofWindows && (
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
                    )}
                  </div>
                </div>
                )}
                {plan && imageUrlForPlan && !existingFloorEditing && (
                <div className="relative z-30 shrink-0 flex items-center justify-end gap-2 flex-wrap w-full min-w-0 pb-0.5">
                  <div className="flex gap-1 flex-wrap justify-end">
                    <button
                      type="button"
                      onClick={() => { setTabForPlan(i, 'rooms'); setSelectedPolygonIndex(null); setNewPolygonPoints(null); if (tool === 'add') setTool('select') }}
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-medium transition-colors ${planTab === 'rooms' ? 'bg-[#E5B800]/25 text-[#E5B800] border border-[#E5B800]/50' : 'text-sand/80 border border-white/10 hover:bg-white/5'}`}
                    >
                      <LayoutGrid size={14} strokeWidth={2} />
                      <span>Räume</span>
                    </button>
                    {!roofOnlyOffer && (
                    <button
                      type="button"
                      onClick={() => { setTabForPlan(i, 'doors'); setSelectedPolygonIndex(null); setNewPolygonPoints(null); if (tool === 'add') setTool('select') }}
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-medium transition-colors ${planTab === 'doors' ? 'bg-[#E5B800]/25 text-[#E5B800] border border-[#E5B800]/50' : 'text-sand/80 border border-white/10 hover:bg-white/5'}`}
                    >
                      <DoorOpen size={14} strokeWidth={2} />
                      <span>Fenster / Türen</span>
                    </button>
                    )}
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
                    {editorConstraints.allowRoofWindows && (
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
                    )}
                  </div>
                </div>
                )}
                <div className="flex-1 min-h-0 min-w-0 flex flex-col gap-2">
                  <div
                    className={
                      stackRoofOverPhase1
                        ? 'relative flex w-full flex-1 min-h-0 overflow-hidden rounded-lg border border-[#E5B800]/50 bg-black/30 ring-1 ring-[#E5B800]/30'
                        : 'contents'
                    }
                  >
                  {showRoomsCanvas && plan && imageUrlForPlan && (
                <div
                  className={
                    stackRoofOverPhase1
                      ? 'pointer-events-none absolute inset-0 z-0 min-h-0 overflow-hidden'
                      : 'relative w-full flex-1 min-h-0 rounded-lg overflow-hidden border border-[#E5B800]/50 ring-1 ring-[#E5B800]/30 bg-black/30'
                  }
                >
                  {(pendingNewRoomPoints ||
                    pendingNewDoorBbox ||
                    (roomTypePopoverIndex !== null && plansData[planIndexClamped]?.rooms[roomTypePopoverIndex])) && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 rounded-lg">
                      <div className="flex flex-wrap items-center justify-center gap-2 p-4 bg-[#1a1a1a] rounded-xl border-2 border-[#E5B800]/60 shadow-xl max-w-md">
                        {pendingNewRoomPoints ? (
                          <>
                            <span className="text-white text-sm font-medium w-full text-center">Raumart:</span>
                            {roomTypeOptions.map((opt) => (
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
                            {roomTypeOptions.map((opt) => (
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
                    demolitionPolys={plan.roofDemolitions ?? []}
                    onDemolitionPolysChange={(polys) => setRoofDemolitions(i, polys)}
                    stairOpeningRects={(plan.stairOpenings ?? []) as DoorRect[]}
                    onStairOpeningRectsChange={(rects) => setStairOpenings(i, rects)}
                    tab={canvasTab}
                    tool={tool}
                    selectedIndex={selectedPolygonIndex}
                    newPoints={tool === 'add' ? newPolygonPoints : null}
                    newDoorType={newDoorType}
                    onInsertVertex={
                      planTab === 'rooms'
                        ? (polyIndex: number, afterVertexIndex: number, x: number, y: number) =>
                            handleInsertVertex(i, polyIndex, afterVertexIndex, x, y)
                        : planTab === 'phase1_demolition'
                          ? (polyIndex: number, afterVertexIndex: number, x: number, y: number) =>
                              handleInsertDemolitionVertex(i, polyIndex, afterVertexIndex, x, y)
                          : undefined
                    }
                    onSelect={setSelectedPolygonIndex}
                    onAddPoint={(x: number, y: number) => setNewPolygonPoints((prev) => prev ? [...prev, [x, y]] : [[x, y]])}
                    onCloseNewPolygon={handleRequestCloseNewPolygon}
                    onRoomTypeLabelClick={planTab === 'rooms' ? handleRoomTypeLabelClick : undefined}
                    onMoveVertex={(polyIndex: number, vertexIndex: number, x: number, y: number) => {
                      if (planTab === 'rooms') {
                        const next = plan.rooms.map((r, ri) =>
                          ri !== polyIndex ? r : { ...r, points: r.points.map((p: Point, vi: number) => vi === vertexIndex ? [x, y] as Point : p) }
                        )
                        setRooms(i, next)
                      } else if (planTab === 'phase1_demolition') {
                        const list = plan.roofDemolitions ?? []
                        const next = list.map((d, ri) =>
                          ri !== polyIndex
                            ? d
                            : { ...d, points: d.points.map((p: Point, vi: number) => vi === vertexIndex ? [x, y] as Point : p) },
                        )
                        setRoofDemolitions(i, next)
                      } else if (planTab === 'doors') {
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
                      } else if (planTab === 'phase1_stair') {
                        const stairs = (plan.stairOpenings ?? []) as DoorRect[]
                        const d = stairs[polyIndex]
                        if (!d) return
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
                        const next = stairs.map((dr, ri) => ri !== polyIndex ? dr : { ...dr, bbox: [nx1, ny1, nx2, ny2] as [number, number, number, number] })
                        setStairOpenings(i, next)
                      }
                    }}
                    onRemoveSelected={(index?: number) => handleRemoveSelected(index)}
                    onEditStart={pushHistory}
                    onRoomsChange={(rooms: RoomPolygon[]) => setRooms(i, rooms)}
                    onDoorsChange={(doors: DoorRect[]) => setDoors(i, doors)}
                    onDoorHover={undefined}
                    onDoorActivate={undefined}
                    blendAufstockungPhase1Overlays={
                      existingFloorEditing &&
                      (planTab === 'phase1_demolition' ||
                        planTab === 'phase1_stair' ||
                        planTab === 'roof' ||
                        planTab === 'roof_windows')
                    }
                    useAufstockungsBasisDemolitionLabels={existingFloorEditing}
                    roofOverlayRooms={roofOverlayRoomsForPhase1}
                    layoutRevealKey={existingFloorEditing ? phase1LayoutRevealKey : 0}
                    stackedView={stackRoofOverPhase1 ? roofStackView : null}
                  />
                </div>
                )}
                {offerId && roofEditorBasemapImages.length > 0 && (
                  <div
                    className={`${
                      stackRoofOverPhase1
                        ? 'absolute inset-0 z-10 flex flex-col min-h-0 overflow-hidden'
                        : 'w-full flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden'
                    } ${showRoofWorkspace ? '' : 'hidden'}`}
                  >
                    <RoofReviewEditor
                      key={offerId ? `roof-embed-${offerId}` : 'roof-embed'}
                      ref={roofEditorRef}
                      embedded
                      chromeInParent
                      vectorOverlayOnly={stackRoofOverPhase1}
                      stackedView={stackRoofOverPhase1 ? roofStackView : null}
                      onStackedViewChange={stackRoofOverPhase1 ? setRoofStackView : undefined}
                      onRoofRectanglesOverlaySync={
                        existingFloorEditing && offerId ? handleRoofRectanglesOverlaySync : undefined
                      }
                      dimsToolbarPortalTarget={roofDimsToolbarSlotEl}
                      tool={tool}
                      setTool={setTool}
                      roofSurfaceTab={roofSurfaceTabForChild}
                      setRoofSurfaceTab={setRoofSurfaceTabForEditor}
                      embedPlanIndex={planIndexClamped}
                      offerId={offerId}
                      images={roofEditorBasemapImages}
                      embeddedPlanSeeds={roofEmbeddedSeeds}
                      layoutActive={showRoofWorkspace}
                      onConfirm={() => {}}
                      onCancel={() => {}}
                    />
                  </div>
                )}
                  </div>
                {planTab === 'doors' && (
                  <div className="shrink-0 rounded-xl border border-[#E5B800]/40 bg-black/25 p-2">
                    <p className="text-sand/80 text-xs font-normal leading-snug text-center">
                      Maße aus Planmaßstab. Fenster: Höhe beim Anlegen eingeben. Schiebetüren: Höhe fix 2,00 m, Breite aus der langen Seite.
                    </p>
                  </div>
                )}
                {planTab === 'phase1_stair' && (
                  <div className="shrink-0 rounded-xl border border-[#E5B800]/40 bg-black/25 p-2">
                    <p className="text-sand/80 text-xs font-normal leading-snug text-center">
                      Treppenöffnung als Rechteck auf dem Bestandsgrundriss. Pro Öffnung wird der Stückpreis aus der Preisdatenbank angesetzt.
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
