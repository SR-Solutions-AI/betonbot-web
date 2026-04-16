import type { DoorRect, Point, RoomPolygon } from '../components/DetectionsPolygonCanvas'
import {
  DEFAULT_ROOF_ANGLE,
  DEFAULT_ROOF_OVERHANG_M,
  DEFAULT_ROOF_TYPE,
  type RoofTypeId,
} from './roofTypeOptions'

/** Legacy `S0`… or `Dach-Basis #1` → display sequence number (1-based). */
function roofBasisDisplayNumberFromLabel(name: string): number | null {
  const t = (name || '').trim()
  const s = /^S(\d+)$/i.exec(t)
  if (s) return parseInt(s[1], 10) + 1
  const d = /^Dach-Basis\s*#\s*(\d+)$/i.exec(t)
  if (d) return parseInt(d[1], 10)
  return null
}

export function nextRoofLabel(rects: RoomPolygon[]): string {
  let maxNum = 0
  for (const r of rects) {
    const n = roofBasisDisplayNumberFromLabel(r.roomName || '')
    if (n != null) maxNum = Math.max(maxNum, n)
  }
  return `Dach-Basis #${maxNum + 1}`
}

export function normalizeRect(r: {
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
  oh = Math.max(0, Math.min(5, oh))
  return {
    points: r.points || [],
    roomName: r.roomName,
    roomType: r.roomType,
    roofAngleDeg: ang,
    roofType: rt,
    roofOverhangM: oh,
  }
}

export function pointInRoofPoly(px: number, py: number, points: Point[]): boolean {
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

export function bboxFullyInsideSomeRoofRect(bbox: [number, number, number, number], rects: RoomPolygon[]): boolean {
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

export function clipBboxToRoofRects(bbox: [number, number, number, number], rects: RoomPolygon[]): [number, number, number, number] | null {
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

export function filterDoorsToRoofRects(doors: DoorRect[], rects: RoomPolygon[]): DoorRect[] {
  return doors.filter((d) => bboxFullyInsideSomeRoofRect(d.bbox, rects))
}

export function normalizeRoofDoor(d: { bbox?: number[]; width_m?: number; height_m?: number }): DoorRect | null {
  const raw = Array.isArray(d?.bbox) ? d.bbox : null
  if (!raw || raw.length < 4) return null
  const bbox = [raw[0], raw[1], raw[2], raw[3]] as [number, number, number, number]
  const out: DoorRect = { bbox, type: 'window' }
  if (typeof d.width_m === 'number' && Number.isFinite(d.width_m) && d.width_m > 0) out.width_m = d.width_m
  if (typeof d.height_m === 'number' && Number.isFinite(d.height_m) && d.height_m > 0) out.height_m = d.height_m
  return out
}
