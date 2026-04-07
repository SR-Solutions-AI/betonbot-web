'use client'

import { useRef, useEffect, useCallback, useState } from 'react'

export type Point = [number, number]

export type RoomPolygon = {
  points: Point[]
  roomType?: string
  roomName?: string
  /** Abweichung von der zuletzt gespeicherten KI-Erkennung (Server: detections_review vs. detections_edited). */
  editedInRun?: boolean
  /** true doar pentru „Raum gedämmt“ (zonă izolată sub acoperiș); lipsă/false = tratată ca neizolată la gedämmt */
  roomInsulated?: boolean
  /** Roof editor: pitch in degrees (0–60). */
  roofAngleDeg?: number
  /** Roof editor: e.g. 0_w, 1_w, 2_w, 4_w, 4.5_w */
  roofType?: string
  /** Roof editor: overhang in metres (shown as Dachüberstand in cm in UI). */
  roofOverhangM?: number
}
export type DoorRect = {
  bbox: [number, number, number, number]
  type?: string
  width_m?: number
  height_m?: number
  dimensionsEdited?: boolean
  /** Abweichung von der KI-Erkennung (gespeicherte Bearbeitung). */
  editedInRun?: boolean
}

type PolygonCanvasProps = {
  imageUrl: string
  imageWidth: number
  imageHeight: number
  rooms: RoomPolygon[]
  doors: DoorRect[]
  tab: 'rooms' | 'doors'
  tool: 'select' | 'add' | 'remove' | 'edit'
  selectedIndex: number | null
  newPoints: Point[] | null
  newDoorType?: 'door' | 'window' | 'sliding_door' | 'garage_door' | 'stairs'
  onSelect: (index: number | null) => void
  onAddPoint: (x: number, y: number) => void
  onCloseNewPolygon: () => void
  onMoveVertex: (polyIndex: number, vertexIndex: number, x: number, y: number) => void
  onInsertVertex?: (polyIndex: number, afterVertexIndex: number, x: number, y: number) => void
  onRemoveSelected: (index?: number) => void
  onRoomsChange: (rooms: RoomPolygon[]) => void
  onDoorsChange: (doors: DoorRect[]) => void
  onDoorHover?: (payload: { index: number; x: number; y: number } | null) => void
  /** Apelat la tap scurt (fără drag) pe o ușă/fereastră în modul Select — ex. ciclare tip. */
  onDoorActivate?: (index: number) => void
  onRoomTypeLabelClick?: (roomIndex: number) => void
  onEditStart?: () => void
  /** Când e true și există selecție, poligoanele nealese sunt estompate (ex. roof editor). */
  dimUnselectedRoomPolygons?: boolean
  /** tab=doors: desenează mai întâi poligoanele din `rooms` ca fundal (ex. Dachflächen + Dachfenster). */
  showRoomPolygonsUnderDoors?: boolean
  /**
   * Cu `showRoomPolygonsUnderDoors`: pe tab Dachfenster evidențiază mai clar suprafețele de acoperiș (contur + etichetă).
   */
  highlightRoofSurfaceUnderlay?: boolean
  className?: string
  /**
   * Când devine true după ce containerul era ascuns (ex. tab Dach cu display:none), forțează recalcul fit.
   * Altfel getBoundingClientRect() rămâne 0×0 și planul pare negru până la resize/refresh.
   */
  layoutActive?: boolean
}

const HANDLE_R = 6
/** Raza pentru vârfuri (Edit) – ușor de selectat (buline). */
const HIT_R = 28
/** Raza pentru muchiile poligoanelor (linii) – ușor de selectat pentru mutare perete/segment. */
const EDGE_HIT_R = 36
/** Raza mai mare pentru colțurile ușilor/geamurilor ca să poți redimensiona ușor (nu doar muta). */
const DOOR_VERTEX_HIT_R = 24
/** Padding în px (în coordonate imagine) pentru hit-test pe uși/ferestre – ușor de apucat și mutat cu Select. */
const DOOR_HIT_PADDING = 16
/** Raza (în px canvas) la care click închide poligonul la prima apăsare */
const CLOSE_POLYGON_HIT_PX = 22
/** Mișcare maximă în px ecran pentru a considera tap (vs. drag) pe uși în Select. */
const DOOR_TAP_MAX_MOVE_PX = 8
/**
 * Zoom la wheel: trackpad-ul trimite multe evenimente cu deltaY mic — evităm factori fixi 0.9/1.1 per eveniment.
 * deltaMode LINE/PAGE e scalat la „pixeli efectivi”; exp(-dy·k) + clamp limitează salturile la rotița mouse.
 */
const WHEEL_ZOOM_SENSITIVITY = 0.00145
const WHEEL_ZOOM_FACTOR_MIN = 0.93
const WHEEL_ZOOM_FACTOR_MAX = 1.07

function wheelEventToZoomFactor(e: WheelEvent): number {
  let dy = e.deltaY
  if (e.deltaMode === 1) dy *= 16
  else if (e.deltaMode === 2) dy *= 120
  let factor = Math.exp(-dy * WHEEL_ZOOM_SENSITIVITY)
  if (factor < WHEEL_ZOOM_FACTOR_MIN) factor = WHEEL_ZOOM_FACTOR_MIN
  if (factor > WHEEL_ZOOM_FACTOR_MAX) factor = WHEEL_ZOOM_FACTOR_MAX
  return factor
}

function pointInPolygon(px: number, py: number, points: Point[]): boolean {
  if (points.length < 3) return false
  let inside = false
  const n = points.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}

function pointInRect(px: number, py: number, bbox: [number, number, number, number]): boolean {
  const [x1, y1, x2, y2] = bbox
  const minX = Math.min(x1, x2)
  const maxX = Math.max(x1, x2)
  const minY = Math.min(y1, y2)
  const maxY = Math.max(y1, y2)
  return px >= minX && px <= maxX && py >= minY && py <= maxY
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

/** Distance from point (px,py) to segment a-b (in image coords). */
function distToSegment(px: number, py: number, a: Point, b: Point): number {
  const [ax, ay] = a
  const [bx, by] = b
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy)
  if (len === 0) return dist(a, [px, py])
  let t = ((px - ax) * dx + (py - ay) * dy) / (len * len)
  t = Math.max(0, Math.min(1, t))
  const qx = ax + t * dx
  const qy = ay + t * dy
  return Math.hypot(px - qx, py - qy)
}

export function DetectionsPolygonCanvas({
  imageUrl,
  imageWidth,
  imageHeight,
  rooms,
  doors,
  tab,
  tool,
  selectedIndex,
  newPoints,
  onSelect,
  onAddPoint,
  onCloseNewPolygon,
  onMoveVertex,
  onInsertVertex,
  onRemoveSelected,
  onRoomsChange,
  onDoorsChange,
  onDoorHover,
  onDoorActivate,
  onRoomTypeLabelClick,
  onEditStart,
  dimUnselectedRoomPolygons = false,
  showRoomPolygonsUnderDoors = false,
  highlightRoofSurfaceUnderlay = false,
  newDoorType = 'door',
  className = '',
  layoutActive = true,
}: PolygonCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [fit, setFit] = useState<{ scale: number; offX: number; offY: number; cw: number; ch: number } | null>(null)
  const [userZoom, setUserZoom] = useState(1)
  const [userPan, setUserPan] = useState({ x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null)
  type DragState =
    | { kind: 'vertex'; polyIndex: number; vertexIndex: number }
    | { kind: 'edge'; polyIndex: number; edgeIndex: number; initV0: Point; initV1: Point; startImage: Point }
    | { kind: 'poly'; polyIndex: number; startImage: Point; initPoints?: Point[]; initBbox?: [number, number, number, number] }
  const [dragging, setDragging] = useState<DragState | null>(null)
  const [imageLoaded, setImageLoaded] = useState(false)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const lastEdgeClickRef = useRef<{ time: number; polyIndex: number; edgeIndex: number } | null>(null)
  const edgeDragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingEdgeDragRef = useRef<{ polyIndex: number; edgeIndex: number; initV0: Point; initV1: Point; startImage: Point } | null>(null)
  const doorTapPendingRef = useRef<{ index: number; clientX: number; clientY: number; pt: Point } | null>(null)
  const [previewEndPoint, setPreviewEndPoint] = useState<Point | null>(null)
  const doorsRef = useRef(doors)
  const roomsRef = useRef(rooms)
  doorsRef.current = doors
  roomsRef.current = rooms

  const effective = fit ? {
    scale: fit.scale * userZoom,
    offX: fit.offX + userPan.x,
    offY: fit.offY + userPan.y,
  } : null

  const toImage = useCallback((cx: number, cy: number): Point | null => {
    if (!effective) return null
    const x = (cx - effective.offX) / effective.scale
    const y = (cy - effective.offY) / effective.scale
    if (x < 0 || x > imageWidth || y < 0 || y > imageHeight) return null
    return [x, y]
  }, [effective, imageWidth, imageHeight])

  /**
   * Coordonate pentru plasare (Add ușă/fereastră, poligon camere): acceptă doar click pe aria imaginii
   * (nu pe marginile letterbox) și clamp la [0,w]×[0,h] ca marginea vizuală să nu dea null din cauza float-ului.
   */
  const toImageForPlacement = useCallback((cx: number, cy: number): Point | null => {
    if (!effective) return null
    const { offX, offY, scale } = effective
    const drawW = imageWidth * scale
    const drawH = imageHeight * scale
    if (cx < offX || cx > offX + drawW || cy < offY || cy > offY + drawH) return null
    const x = Math.min(Math.max((cx - offX) / scale, 0), imageWidth)
    const y = Math.min(Math.max((cy - offY) / scale, 0), imageHeight)
    return [x, y]
  }, [effective, imageWidth, imageHeight])

  useEffect(() => {
    setImageLoaded(false)
    let cancelled = false

    const attachLoaded = (img: HTMLImageElement) => {
      img.onload = () => {
        if (cancelled) return
        imgRef.current = img
        setImageLoaded(true)
      }
    }

    // First attempt: CORS-friendly load (useful for signed/public storage URLs).
    const primary = new Image()
    primary.crossOrigin = 'anonymous'
    attachLoaded(primary)
    primary.onerror = () => {
      if (cancelled) return
      // Fallback: retry without crossOrigin; some storage/CDN responses reject anonymous CORS
      // but still allow normal image rendering.
      const fallback = new Image()
      attachLoaded(fallback)
      fallback.onerror = () => {
        if (cancelled) return
        imgRef.current = null
        setImageLoaded(false)
      }
      fallback.src = imageUrl
    }
    primary.src = imageUrl

    return () => {
      cancelled = true
      imgRef.current = null
    }
  }, [imageUrl])

  const recomputeFit = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !imageWidth || !imageHeight) return
    const rect = canvas.getBoundingClientRect()
    const cw = rect.width
    const ch = rect.height
    if (cw <= 0 || ch <= 0) return
    const scale = Math.min(cw / imageWidth, ch / imageHeight)
    const offX = (cw - imageWidth * scale) / 2
    const offY = (ch - imageHeight * scale) / 2
    setFit({ scale, offX, offY, cw, ch })
  }, [imageWidth, imageHeight])

  /** Zoom/pan nur bei neuem Plan/Bild zurücksetzen — nicht bei Canvas-Resize (Werkzeug-Zeilen ändern die Höhe). */
  useEffect(() => {
    setUserZoom(1)
    setUserPan({ x: 0, y: 0 })
  }, [imageUrl, imageWidth, imageHeight])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !imageWidth || !imageHeight || !layoutActive) return
    const handleResize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      const cw = rect.width
      const ch = rect.height
      if (cw <= 0 || ch <= 0) return
      canvas.width = cw * dpr
      canvas.height = ch * dpr
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      recomputeFit()
    }
    requestAnimationFrame(handleResize)
    window.addEventListener('resize', handleResize)
    /** Flex-Layout (z. B. Footer unter dem Canvas bei Fenster/Türen) ändert die Canvas-Höhe ohne window-resize. */
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => requestAnimationFrame(handleResize)) : null
    if (ro) ro.observe(canvas)
    return () => {
      window.removeEventListener('resize', handleResize)
      ro?.disconnect()
    }
  }, [imageWidth, imageHeight, recomputeFit, layoutActive])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const img = imgRef.current
    if (!ctx || !effective || !img || !canvas) return

    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.restore()

    ctx.drawImage(img, effective.offX, effective.offY, imageWidth * effective.scale, imageHeight * effective.scale)

    const roomColors = ['#3b82f6', '#22c55e', '#eab308', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316']
    // Clasificare identică cu LiveFeed (detections_review_doors.png): doors_types.json (Gemini) + euristică aspect în backend.
    // Culori: ușă = verde, geam = albastru, schiebetür = turcoaz, garaj = mov, scări = portocaliu.
    const doorColors: Record<string, string> = { door: '#22c55e', window: '#3b82f6', sliding_door: '#14b8a6', garage_door: '#9333ea', stairs: '#ea580c' }
    const doorStrokeColors: Record<string, string> = { door: '#16a34a', window: '#2563eb', sliding_door: '#0f766e', garage_door: '#7e22ce', stairs: '#c2410c' }
    const getDoorStyle = (type: string | undefined) => {
      const t = (type || 'door').toLowerCase().trim()
      if (t === 'window' || t === 'fenster' || t === 'geam') return { fill: doorColors.window, stroke: doorStrokeColors.window }
      if (t === 'sliding_door' || t === 'schiebetur' || t === 'schiebetür') return { fill: doorColors.sliding_door, stroke: doorStrokeColors.sliding_door }
      if (t === 'garage_door' || t === 'garagentor') return { fill: doorColors.garage_door, stroke: doorStrokeColors.garage_door }
      if (t === 'stairs' || t === 'treppe') return { fill: doorColors.stairs, stroke: doorStrokeColors.stairs }
      return { fill: doorColors.door, stroke: doorStrokeColors.door }
    }

    const s = effective.scale
    const ox = effective.offX
    const oy = effective.offY
    const useDimOthers = dimUnselectedRoomPolygons && selectedIndex !== null && rooms.length > 0
    if (tab === 'rooms') {
      rooms.forEach((room, i) => {
        const pts = room.points
        if (pts.length < 2) return
        const selected = selectedIndex === i
        ctx.fillStyle = roomColors[i % roomColors.length]
        let fillA = selected ? 0.5 : 0.35
        if (useDimOthers) {
          fillA = selected ? 0.52 : 0.12
        }
        ctx.globalAlpha = fillA
        ctx.beginPath()
        ctx.moveTo(ox + pts[0][0] * s, oy + pts[0][1] * s)
        for (let k = 1; k < pts.length; k++) {
          ctx.lineTo(ox + pts[k][0] * s, oy + pts[k][1] * s)
        }
        ctx.closePath()
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.strokeStyle = selected ? '#E5B800' : useDimOthers ? 'rgba(255,255,255,0.35)' : ctx.fillStyle
        ctx.lineWidth = selected ? 3 : useDimOthers ? 1.5 : 2
        ctx.stroke()
        const label = (room.roomName ?? (room as { room_name?: string }).room_name ?? room.roomType ?? `R${i}`).trim() || `R${i}`
        if (pts.length > 0 && label) {
          let cx = 0, cy = 0
          pts.forEach((p) => { cx += p[0]; cy += p[1] })
          cx /= pts.length
          cy /= pts.length
          ctx.font = 'bold 14px sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          const textW = ctx.measureText(label).width
          const pad = 6
          const boxW = textW + pad * 2
          const boxH = 20
          const lx = ox + cx * s - boxW / 2
          const ly = oy + cy * s - boxH / 2
          ctx.fillStyle = 'rgba(0,0,0,0.82)'
          ctx.strokeStyle = 'rgba(255,255,255,0.5)'
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.rect(lx, ly, boxW, boxH)
          ctx.fill()
          ctx.stroke()
          ctx.fillStyle = '#fff'
          ctx.fillText(label, ox + cx * s, oy + cy * s)
        }
        if (tool === 'edit' && selected && pts.length > 0) {
          pts.forEach((p) => {
            ctx.fillStyle = '#E5B800'
            ctx.beginPath()
            ctx.arc(ox + p[0] * s, oy + p[1] * s, HANDLE_R, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = '#fff'
            ctx.lineWidth = 1
            ctx.stroke()
          })
        }
      })
      if (newPoints && newPoints.length > 0) {
        ctx.strokeStyle = '#E5B800'
        ctx.lineWidth = 2
        ctx.setLineDash([6, 4])
        ctx.beginPath()
        ctx.moveTo(ox + newPoints[0][0] * s, oy + newPoints[0][1] * s)
        for (let k = 1; k < newPoints.length; k++) {
          ctx.lineTo(ox + newPoints[k][0] * s, oy + newPoints[k][1] * s)
        }
        if (newPoints.length >= 3) ctx.closePath()
        ctx.stroke()
        ctx.setLineDash([])
        newPoints.forEach((p, vi) => {
          ctx.fillStyle = vi === 0 ? '#22c55e' : '#E5B800'
          ctx.beginPath()
          ctx.arc(ox + p[0] * s, oy + p[1] * s, HANDLE_R, 0, Math.PI * 2)
          ctx.fill()
        })
      }
    } else {
      if (showRoomPolygonsUnderDoors) {
        const underlayColors = ['#3b82f6', '#22c55e', '#eab308', '#8b5cf6', '#06b6d4']
        rooms.forEach((room, i) => {
          const pts = room.points
          if (pts.length < 2) return
          ctx.fillStyle = underlayColors[i % underlayColors.length]
          ctx.globalAlpha = highlightRoofSurfaceUnderlay ? 0.28 : 0.14
          ctx.beginPath()
          ctx.moveTo(ox + pts[0][0] * s, oy + pts[0][1] * s)
          for (let k = 1; k < pts.length; k++) {
            ctx.lineTo(ox + pts[k][0] * s, oy + pts[k][1] * s)
          }
          ctx.closePath()
          ctx.fill()
          ctx.globalAlpha = 1
          ctx.strokeStyle = highlightRoofSurfaceUnderlay ? 'rgba(229,184,0,0.85)' : 'rgba(255,255,255,0.28)'
          ctx.lineWidth = highlightRoofSurfaceUnderlay ? 2.25 : 1.25
          ctx.stroke()
          if (highlightRoofSurfaceUnderlay && pts.length >= 3) {
            let cx = 0
            let cy = 0
            pts.forEach((p) => {
              cx += p[0]
              cy += p[1]
            })
            cx /= pts.length
            cy /= pts.length
            const label =
              (room.roomName ?? (room as { room_name?: string }).room_name ?? room.roomType ?? `S${i + 1}`).trim() ||
              `S${i + 1}`
            ctx.font = 'bold 12px sans-serif'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            const textW = ctx.measureText(label).width
            const pad = 5
            const boxW = textW + pad * 2
            const boxH = 18
            const lx = ox + cx * s - boxW / 2
            const ly = oy + cy * s - boxH / 2
            ctx.fillStyle = 'rgba(0,0,0,0.82)'
            ctx.strokeStyle = 'rgba(229,184,0,0.65)'
            ctx.lineWidth = 1.25
            ctx.beginPath()
            ctx.rect(lx, ly, boxW, boxH)
            ctx.fill()
            ctx.stroke()
            ctx.fillStyle = '#E5B800'
            ctx.fillText(label, ox + cx * s, oy + cy * s)
          }
        })
      }
      doors.forEach((door, i) => {
        const [x1, y1, x2, y2] = door.bbox
        const selected = selectedIndex === i
        const style = getDoorStyle(door.type)
        ctx.fillStyle = style.fill
        ctx.globalAlpha = selected ? 0.5 : 0.35
        ctx.fillRect(ox + Math.min(x1, x2) * s, oy + Math.min(y1, y2) * s, Math.abs(x2 - x1) * s, Math.abs(y2 - y1) * s)
        ctx.globalAlpha = 1
        ctx.strokeStyle = selected ? '#E5B800' : style.stroke
        ctx.lineWidth = selected ? 3 : 2
        ctx.strokeRect(ox + Math.min(x1, x2) * s, oy + Math.min(y1, y2) * s, Math.abs(x2 - x1) * s, Math.abs(y2 - y1) * s)
        if (tool === 'edit' && selected) {
          const corners: Point[] = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
          corners.forEach((p) => {
            ctx.fillStyle = '#E5B800'
            ctx.beginPath()
            ctx.arc(ox + p[0] * s, oy + p[1] * s, HANDLE_R, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = '#fff'
            ctx.lineWidth = 1
            ctx.stroke()
          })
        }
      })
      if (newPoints && newPoints.length >= 1) {
        const newStyle = getDoorStyle(newDoorType)
        const endPt = newPoints.length === 2 ? newPoints[1] : previewEndPoint
        const x1 = endPt != null ? Math.min(newPoints[0][0], endPt[0]) : newPoints[0][0]
        const y1 = endPt != null ? Math.min(newPoints[0][1], endPt[1]) : newPoints[0][1]
        const x2 = endPt != null ? Math.max(newPoints[0][0], endPt[0]) : newPoints[0][0]
        const y2 = endPt != null ? Math.max(newPoints[0][1], endPt[1]) : newPoints[0][1]
        if (endPt != null && (x2 - x1) > 0 && (y2 - y1) > 0) {
          ctx.fillStyle = newStyle.fill
          ctx.globalAlpha = 0.35
          ctx.fillRect(ox + x1 * s, oy + y1 * s, (x2 - x1) * s, (y2 - y1) * s)
          ctx.globalAlpha = 1
          ctx.strokeStyle = newStyle.stroke
          ctx.setLineDash([4, 4])
          ctx.strokeRect(ox + x1 * s, oy + y1 * s, (x2 - x1) * s, (y2 - y1) * s)
          ctx.setLineDash([])
        }
        newPoints.forEach((p) => {
          ctx.fillStyle = '#E5B800'
          ctx.beginPath()
          ctx.arc(ox + p[0] * s, oy + p[1] * s, HANDLE_R, 0, Math.PI * 2)
          ctx.fill()
        })
      }
    }
  }, [
    tab,
    rooms,
    doors,
    selectedIndex,
    tool,
    newPoints,
    newDoorType,
    previewEndPoint,
    effective,
    imageWidth,
    imageHeight,
    imageLoaded,
    dimUnselectedRoomPolygons,
    showRoomPolygonsUnderDoors,
    highlightRoofSurfaceUnderlay,
  ])

  useEffect(() => { draw() }, [draw])

  const hitTest = useCallback((cx: number, cy: number): { kind: 'poly' | 'vertex' | 'edge'; index: number; vertexIndex?: number; edgeIndex?: number } | null => {
    if (!effective) return null
    const pt = toImage(cx, cy)
    if (!pt) return null
    const [px, py] = pt
    const hitR = HIT_R / effective.scale
    const edgeR = EDGE_HIT_R / effective.scale
    const doorVertexR = DOOR_VERTEX_HIT_R / effective.scale

    if (tab === 'rooms') {
      if (tool === 'edit') {
        // Mai întâi vârfuri/muchii ale camerei selectate, ca să nu „fure” click-ul camerele vecine
        // (cercurile de hit se suprapun când poligoanele sunt apropiate).
        const hitRoomVerticesAndEdges = (i: number) => {
          const pts = rooms[i]?.points
          if (!pts?.length) return null
          for (let vi = 0; vi < pts.length; vi++) {
            if (dist(pts[vi], [px, py]) <= hitR) return { kind: 'vertex' as const, index: i, vertexIndex: vi }
          }
          for (let ei = 0; ei < pts.length; ei++) {
            const a = pts[ei]
            const b = pts[(ei + 1) % pts.length]
            if (distToSegment(px, py, a, b) <= edgeR) return { kind: 'edge' as const, index: i, edgeIndex: ei }
          }
          return null
        }
        if (selectedIndex != null && selectedIndex >= 0 && selectedIndex < rooms.length) {
          const sel = hitRoomVerticesAndEdges(selectedIndex)
          if (sel) return sel
        }
        for (let i = rooms.length - 1; i >= 0; i--) {
          if (selectedIndex != null && i === selectedIndex) continue
          const h = hitRoomVerticesAndEdges(i)
          if (h) return h
        }
      }
      for (let i = rooms.length - 1; i >= 0; i--) {
        if (!pointInPolygon(px, py, rooms[i].points)) continue
        return { kind: 'poly', index: i }
      }
    } else {
      for (let i = doors.length - 1; i >= 0; i--) {
        const [x1, y1, x2, y2] = doors[i].bbox
        const minX = Math.min(x1, x2) - DOOR_HIT_PADDING
        const maxX = Math.max(x1, x2) + DOOR_HIT_PADDING
        const minY = Math.min(y1, y2) - DOOR_HIT_PADDING
        const maxY = Math.max(y1, y2) + DOOR_HIT_PADDING
        const expandedBbox: [number, number, number, number] = [minX, minY, maxX, maxY]
        if (!pointInRect(px, py, expandedBbox)) continue
        if (tool === 'edit') {
          const [x1, y1, x2, y2] = doors[i].bbox
          const corners: Point[] = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
          for (let vi = 0; vi < corners.length; vi++) {
            if (dist(corners[vi], [px, py]) <= doorVertexR) return { kind: 'vertex', index: i, vertexIndex: vi }
          }
        }
        return { kind: 'poly', index: i }
      }
    }
    return null
  }, [effective, tab, rooms, doors, tool, toImage, selectedIndex])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current
    if (!canvas || !effective) return
    const rect = canvas.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const hit = hitTest(cx, cy)
    const pt = toImage(cx, cy)

    if (e.button !== 0) return

    const placePt = tool === 'add' ? toImageForPlacement(cx, cy) : pt

    if (tool === 'add' && tab === 'rooms') {
      if (!placePt) return
      if (newPoints && newPoints.length >= 3 && dist(newPoints[0], placePt) * effective.scale <= CLOSE_POLYGON_HIT_PX) {
        onCloseNewPolygon()
      } else {
        onAddPoint(placePt[0], placePt[1])
      }
      return
    }

    if (tool === 'add' && tab === 'doors') {
      if (placePt) onAddPoint(placePt[0], placePt[1])
      return
    }

    if (hit?.kind === 'vertex' && hit.vertexIndex !== undefined) {
      onSelect(hit.index)
      onEditStart?.()
      ;(e.target as Element).setPointerCapture(e.pointerId)
      setDragging({ kind: 'vertex', polyIndex: hit.index, vertexIndex: hit.vertexIndex })
      return
    }

    if (hit?.kind === 'edge' && hit.edgeIndex !== undefined && pt) {
      onSelect(hit.index)
      if (onInsertVertex) {
        const last = lastEdgeClickRef.current
        const now = Date.now()
        if (last && now - last.time < 300 && last.polyIndex === hit.index && last.edgeIndex === hit.edgeIndex) {
          lastEdgeClickRef.current = null
          if (edgeDragTimeoutRef.current) {
            clearTimeout(edgeDragTimeoutRef.current)
            edgeDragTimeoutRef.current = null
          }
          onInsertVertex(hit.index, hit.edgeIndex, pt[0], pt[1])
        } else {
          lastEdgeClickRef.current = { time: now, polyIndex: hit.index, edgeIndex: hit.edgeIndex }
          if (edgeDragTimeoutRef.current) clearTimeout(edgeDragTimeoutRef.current)
          onEditStart?.()
          ;(e.target as Element).setPointerCapture(e.pointerId)
          const pts = rooms[hit.index].points
          const i = hit.edgeIndex
          const j = (i + 1) % pts.length
          setDragging({
            kind: 'edge',
            polyIndex: hit.index,
            edgeIndex: hit.edgeIndex,
            initV0: [...pts[i]],
            initV1: [...pts[j]],
            startImage: [pt[0], pt[1]],
          })
        }
      } else {
        onEditStart?.()
        ;(e.target as Element).setPointerCapture(e.pointerId)
        const pts = rooms[hit.index].points
        const i = hit.edgeIndex
        const j = (i + 1) % pts.length
        setDragging({
          kind: 'edge',
          polyIndex: hit.index,
          edgeIndex: hit.edgeIndex,
          initV0: [...pts[i]],
          initV1: [...pts[j]],
          startImage: [pt[0], pt[1]],
        })
      }
      return
    }

    if (hit?.kind === 'poly') {
      if (tab === 'doors' && tool === 'remove') {
        onRemoveSelected(hit.index)
        return
      }
      // Select: tap = schimbare tip (callback); drag după prag = mutare dreptunghi
      if (tab === 'doors' && tool === 'select' && pt) {
        onSelect(hit.index)
        doorTapPendingRef.current = { index: hit.index, clientX: e.clientX, clientY: e.clientY, pt: [pt[0], pt[1]] }
        ;(e.target as Element).setPointerCapture(e.pointerId)
        return
      }
      if (tab === 'rooms' && pt && onRoomTypeLabelClick) {
        const r = rooms[hit.index]
        if (r?.points?.length) {
          let cx = 0, cy = 0
          r.points.forEach((p: Point) => { cx += p[0]; cy += p[1] })
          cx /= r.points.length
          cy /= r.points.length
          if (dist(pt, [cx, cy]) <= 25) {
            onRoomTypeLabelClick(hit.index)
            return
          }
        }
      }
      if (tool === 'remove') {
        onRemoveSelected(hit.index)
        return
      }
      if ((tool === 'select' || tool === 'edit') && pt) {
        onSelect(hit.index)
        onEditStart?.()
        ;(e.target as Element).setPointerCapture(e.pointerId)
        if (tab === 'rooms' && hit.index < rooms.length)
          setDragging({ kind: 'poly', polyIndex: hit.index, startImage: [pt[0], pt[1]], initPoints: rooms[hit.index].points.map((p) => [...p]) })
        else if (tab === 'doors' && hit.index < doors.length)
          setDragging({ kind: 'poly', polyIndex: hit.index, startImage: [pt[0], pt[1]], initBbox: [...doors[hit.index].bbox] })
        return
      }
      onSelect(hit.index)
      return
    }

    if (tool === 'select' && pt) {
      ;(e.target as Element).setPointerCapture(e.pointerId)
      setPanning(true)
      setPanStart({ x: e.clientX - userPan.x, y: e.clientY - userPan.y })
    } else {
      onSelect(null)
    }
  }, [effective, tool, tab, newPoints, userPan, hitTest, toImage, toImageForPlacement, onSelect, onAddPoint, onCloseNewPolygon, onRemoveSelected, onInsertVertex, onRoomTypeLabelClick, onEditStart, rooms, doors])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current
    if (!canvas || !effective) return
    const rect = canvas.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const pt = toImage(cx, cy)
    const pendingTap = doorTapPendingRef.current
    if (pendingTap && !dragging) {
      const d = Math.hypot(e.clientX - pendingTap.clientX, e.clientY - pendingTap.clientY)
      if (d > DOOR_TAP_MAX_MOVE_PX) {
        const idx = pendingTap.index
        const dr = doorsRef.current[idx]
        if (dr) {
          onEditStart?.()
          doorTapPendingRef.current = null
          setDragging({
            kind: 'poly',
            polyIndex: idx,
            startImage: pendingTap.pt,
            initBbox: [...dr.bbox] as [number, number, number, number],
          })
        }
      }
    }
    const hoverHit = hitTest(cx, cy)
    if (tab === 'doors' && hoverHit?.kind === 'poly') {
      onDoorHover?.({ index: hoverHit.index, x: cx, y: cy })
    } else {
      onDoorHover?.(null)
    }

    if (panning && panStart) {
      setUserPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y })
      return
    }

    if (tool === 'add' && tab === 'doors' && newPoints?.length === 1) {
      const preview = toImageForPlacement(cx, cy)
      setPreviewEndPoint(preview)
    } else {
      setPreviewEndPoint(null)
    }

    const pending = pendingEdgeDragRef.current
    if (pending && pt && !dragging) {
      if (edgeDragTimeoutRef.current) {
        clearTimeout(edgeDragTimeoutRef.current)
        edgeDragTimeoutRef.current = null
      }
      pendingEdgeDragRef.current = null
      setDragging({ kind: 'edge', ...pending })
    }

    if (dragging && pt) {
      if (dragging.kind === 'vertex') {
        const { polyIndex, vertexIndex } = dragging
        if (tab === 'rooms' && polyIndex < roomsRef.current.length) {
          const next = roomsRef.current.map((r, i) => {
            if (i !== polyIndex) return r
            const pts = r.points.map((p, vi) =>
              vi === vertexIndex
                ? [Math.max(0, Math.min(imageWidth, pt[0])), Math.max(0, Math.min(imageHeight, pt[1]))] as Point
                : p
            )
            return { ...r, points: pts }
          })
          onRoomsChange(next)
        } else if (tab === 'doors' && polyIndex < doorsRef.current.length) {
          const d = doorsRef.current[polyIndex]
          const [x1, y1, x2, y2] = d.bbox
          const left = Math.min(x1, x2)
          const right = Math.max(x1, x2)
          const top = Math.min(y1, y2)
          const bottom = Math.max(y1, y2)
          const corners: Point[] = [[left, top], [right, top], [right, bottom], [left, bottom]]
          const opposite = (vertexIndex + 2) % 4
          const fixed = corners[opposite]
          const cx = Math.max(0, Math.min(imageWidth, pt[0]))
          const cy = Math.max(0, Math.min(imageHeight, pt[1]))
          let nx1 = Math.min(cx, fixed[0])
          let nx2 = Math.max(cx, fixed[0])
          let ny1 = Math.min(cy, fixed[1])
          let ny2 = Math.max(cy, fixed[1])
          const minPx = 1
          if (nx2 - nx1 < minPx) nx2 = nx1 + minPx
          if (ny2 - ny1 < minPx) ny2 = ny1 + minPx
          const next = doorsRef.current.map((dr, i) =>
            i !== polyIndex ? dr : { ...dr, bbox: [nx1, ny1, nx2, ny2] as [number, number, number, number] }
          )
          onDoorsChange(next)
        }
      } else if (dragging.kind === 'edge') {
        const { polyIndex, edgeIndex, initV0, initV1, startImage } = dragging
        const dx = pt[0] - startImage[0]
        const dy = pt[1] - startImage[1]
        const newV0: Point = [Math.max(0, Math.min(imageWidth, initV0[0] + dx)), Math.max(0, Math.min(imageHeight, initV0[1] + dy))]
        const newV1: Point = [Math.max(0, Math.min(imageWidth, initV1[0] + dx)), Math.max(0, Math.min(imageHeight, initV1[1] + dy))]
        const room = roomsRef.current[polyIndex]
        const pts = room.points
        const j = (edgeIndex + 1) % pts.length
        const nextPts = pts.map((p, vi) => {
          if (vi === edgeIndex) return newV0
          if (vi === j) return newV1
          return p
        })
        onRoomsChange(roomsRef.current.map((r, i) => i !== polyIndex ? r : { ...r, points: nextPts }))
      } else if (dragging.kind === 'poly') {
        const { polyIndex, startImage, initPoints, initBbox } = dragging
        const dx = pt[0] - startImage[0]
        const dy = pt[1] - startImage[1]
        if (tab === 'rooms' && initPoints && polyIndex < roomsRef.current.length) {
          const nextPts = initPoints.map((p) => [Math.max(0, Math.min(imageWidth, p[0] + dx)), Math.max(0, Math.min(imageHeight, p[1] + dy))] as Point)
          const next = roomsRef.current.map((r, i) => i !== polyIndex ? r : { ...r, points: nextPts })
          onRoomsChange(next)
        } else if (tab === 'doors' && initBbox && polyIndex < doorsRef.current.length) {
          const [a, b, c, d] = initBbox
          const nx1 = Math.max(0, Math.min(imageWidth, a + dx))
          const ny1 = Math.max(0, Math.min(imageHeight, b + dy))
          const nx2 = Math.max(0, Math.min(imageWidth, c + dx))
          const ny2 = Math.max(0, Math.min(imageHeight, d + dy))
          let ax1 = Math.min(nx1, nx2)
          let ax2 = Math.max(nx1, nx2)
          let ay1 = Math.min(ny1, ny2)
          let ay2 = Math.max(ny1, ny2)
          const minPx = 1
          if (ax2 - ax1 < minPx) ax2 = ax1 + minPx
          if (ay2 - ay1 < minPx) ay2 = ay1 + minPx
          const next = doorsRef.current.map((dr, i) =>
            i !== polyIndex ? dr : { ...dr, bbox: [ax1, ay1, ax2, ay2] as [number, number, number, number] }
          )
          onDoorsChange(next)
        }
      }
    }
  }, [panning, panStart, dragging, effective, tool, tab, newPoints, imageWidth, imageHeight, toImage, toImageForPlacement, hitTest, onDoorHover, onRoomsChange, onDoorsChange, onEditStart])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const pendingTap = doorTapPendingRef.current
    if (pendingTap) {
      const d = Math.hypot(e.clientX - pendingTap.clientX, e.clientY - pendingTap.clientY)
      doorTapPendingRef.current = null
      if (d <= DOOR_TAP_MAX_MOVE_PX) {
        onDoorActivate?.(pendingTap.index)
      }
    }
    try { (e.target as Element).releasePointerCapture(e.pointerId) } catch (_) {}
    setDragging(null)
    setPanning(false)
    setPanStart(null)
    if (edgeDragTimeoutRef.current) {
      clearTimeout(edgeDragTimeoutRef.current)
      edgeDragTimeoutRef.current = null
    }
    pendingEdgeDragRef.current = null
  }, [onDoorActivate])
  const handlePointerLeave = useCallback((e: React.PointerEvent) => {
    try { (e.target as Element).releasePointerCapture(e.pointerId) } catch (_) {}
    setDragging(null)
    setPanning(false)
    setPanStart(null)
    setPreviewEndPoint(null)
    if (edgeDragTimeoutRef.current) {
      clearTimeout(edgeDragTimeoutRef.current)
      edgeDragTimeoutRef.current = null
    }
    pendingEdgeDragRef.current = null
    doorTapPendingRef.current = null
    onDoorHover?.(null)
  }, [onDoorHover])

  const handleWheel = useCallback((e: WheelEvent) => {
    if (!effective || !fit) return
    e.preventDefault()
    e.stopPropagation()
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const imgX = (cx - effective.offX) / effective.scale
    const imgY = (cy - effective.offY) / effective.scale
    const factor = wheelEventToZoomFactor(e)
    const newZoom = Math.max(0.3, Math.min(5, userZoom * factor))
    const newOffX = cx - imgX * fit.scale * newZoom
    const newOffY = cy - imgY * fit.scale * newZoom
    setUserZoom(newZoom)
    setUserPan({ x: newOffX - fit.offX, y: newOffY - fit.offY })
  }, [effective, fit, userZoom])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  const canvasCursor = (() => {
    if (panning) return 'grabbing'
    if (dragging?.kind === 'vertex' || dragging?.kind === 'edge' || dragging?.kind === 'poly') return 'move'
    if (tool === 'add') return 'crosshair'
    if (tool === 'remove') return 'default'
    if (tool === 'edit') return 'default'
    if (tool === 'select') return 'grab'
    return 'default'
  })()

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%', cursor: canvasCursor }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    />
  )
}

