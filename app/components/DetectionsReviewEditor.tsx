'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  LayoutGrid,
  DoorOpen,
  MousePointer2,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Undo2,
} from 'lucide-react'
import { DetectionsPolygonCanvas, type Point, type RoomPolygon, type DoorRect } from './DetectionsPolygonCanvas'
import { apiFetch } from '../lib/supabaseClient'

const ACCENT = '#E5B800'

/** Unire vârfuri consecutive foarte apropiate (px imagine) – la randarea poligoanelor prima dată. */
const MERGE_VERTEX_DIST_PX = 14

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

export type ReviewTab = 'rooms' | 'doors'

export type ReviewImage = { url: string; caption?: string }

type Tool = 'select' | 'add' | 'remove' | 'edit'

type PlanData = {
  imageWidth: number
  imageHeight: number
  rooms: RoomPolygon[]
  doors: DoorRect[]
}

type DetectionsReviewEditorProps = {
  offerId?: string
  images: ReviewImage[]
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export function DetectionsReviewEditor({
  offerId,
  images,
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
  const [newDoorType, setNewDoorType] = useState<'door' | 'window'>('door')
  const [pendingNewRoomPoints, setPendingNewRoomPoints] = useState<Point[] | null>(null)
  const [roomTypePopoverIndex, setRoomTypePopoverIndex] = useState<number | null>(null)
  const [history, setHistory] = useState<PlanData[][]>([])
  const historyLimit = 50
  const skipNextPushRef = useRef(false)
  const plansDataRef = useRef<PlanData[]>(plansData)
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

  const ROOM_TYPE_OPTIONS = ['Garage', 'Balkon', 'Wintergarten', 'Sonstige'] as const
  type RoomTypeOption = typeof ROOM_TYPE_OPTIONS[number]

  const n = plansData.length > 0 ? plansData.length : Math.max(1, images.length)
  const planIndexClamped = n > 0 ? Math.max(0, Math.min(planIndex, n - 1)) : 0
  const currentPlan = plansData[planIndexClamped]
  const getBaseImageUrl = (planIdx: number) => images[planIdx]?.url ?? images[0]?.url
  const getTabForPlan = (planIdx: number) => tabPerPlan[planIdx] ?? 'rooms'
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
    apiFetch(`/offers/${offerId}/compute/detections-review-data`)
      .then((res: { plans?: PlanData[]; floorLabels?: string[] }) => {
        if (cancelled) return
        const plans = Array.isArray(res?.plans) ? res.plans : []
        const normalized = plans.map((p) => ({
          ...p,
          rooms: (p.rooms || []).map((r: RoomPolygon) => ({
            ...r,
            roomType: r.roomType ?? 'Raum',
            points: mergeClosePolygonPoints(r.points || [], MERGE_VERTEX_DIST_PX),
          })),
        }))
        setPlansData(normalized)
        setFloorLabels(Array.isArray(res?.floorLabels) ? res.floorLabels : [])
      })
      .catch(() => { if (!cancelled) setPlansData([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [offerId, images.length])

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
      next[planIdx] = { ...next[planIdx], doors }
      return next
    })
  }, [])

  const handleConfirm = useCallback(async () => {
    if (offerId && plansData.length > 0) {
      try {
        await apiFetch(`/offers/${offerId}/compute/detections-review-data`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plans: plansData.map((p) => ({ rooms: p.rooms, doors: p.doors })),
          }),
        })
      } catch (_) {}
    }
    await onConfirm()
  }, [offerId, plansData, onConfirm])

  const handleRemoveSelected = useCallback((index?: number) => {
    const idx = index ?? selectedPolygonIndex
    if (idx === null || typeof idx !== 'number' || idx < 0) return
    pushHistory()
    const pi = planIndexClamped
    const activeTab = getTabForPlan(pi)
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

  const handleRequestCloseNewPolygon = useCallback(() => {
    if (!newPolygonPoints || newPolygonPoints.length < 3 || !currentPlan) return
    setPendingNewRoomPoints([...newPolygonPoints])
    setNewPolygonPoints(null)
  }, [newPolygonPoints, currentPlan])

  const handlePickNewRoomType = useCallback((roomType: RoomTypeOption) => {
    if (!pendingNewRoomPoints || pendingNewRoomPoints.length < 3 || !currentPlan) return
    pushHistory()
    const next = [...currentPlan.rooms, { points: pendingNewRoomPoints, roomType }]
    setRooms(planIndexClamped, next)
    setPendingNewRoomPoints(null)
  }, [pendingNewRoomPoints, currentPlan, planIndexClamped, setRooms, pushHistory])

  const handleRoomTypeLabelClick = useCallback((roomIndex: number) => {
    setRoomTypePopoverIndex(roomIndex)
  }, [])

  const handlePickEditRoomType = useCallback((roomType: RoomTypeOption) => {
    if (roomTypePopoverIndex === null || planIndexClamped >= plansData.length) return
    const plan = plansData[planIndexClamped]
    if (!plan || roomTypePopoverIndex >= plan.rooms.length) return
    pushHistory()
    const next = plan.rooms.map((r, i) => i !== roomTypePopoverIndex ? r : { ...r, roomType: roomType as string })
    setRooms(planIndexClamped, next)
    setRoomTypePopoverIndex(null)
  }, [roomTypePopoverIndex, planIndexClamped, plansData, setRooms, pushHistory])

  useEffect(() => {
    setSelectedPolygonIndex(null)
    setNewPolygonPoints(null)
  }, [planIndex])

  useEffect(() => {
    if (newPolygonPoints?.length !== 2 || getTabForPlan(planIndexClamped) !== 'doors') return
    const plan = plansData[planIndexClamped]
    if (!plan) return
    pushHistory()
    const [a, b] = newPolygonPoints
    const bbox: [number, number, number, number] = [
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[0], b[0]),
      Math.max(a[1], b[1]),
    ]
    setDoors(planIndexClamped, [...plan.doors, { bbox, type: newDoorType }])
    setNewPolygonPoints(null)
  }, [newPolygonPoints, planIndexClamped, newDoorType, getTabForPlan, setDoors, plansData, pushHistory])

  const handleInsertVertex = useCallback((planIdx: number, polyIndex: number, afterVertexIndex: number, x: number, y: number) => {
    const plan = plansData[planIdx]
    if (!plan || polyIndex >= plan.rooms.length || afterVertexIndex < 0) return
    pushHistory()
    const pts = plan.rooms[polyIndex].points
    const newPts = [...pts.slice(0, afterVertexIndex + 1), [x, y] as Point, ...pts.slice(afterVertexIndex + 1)]
    setRooms(planIdx, plan.rooms.map((r, i) => i !== polyIndex ? r : { ...r, points: newPts }))
  }, [plansData, setRooms, pushHistory])

  const activeTab = getTabForPlan(planIndexClamped)
  const toolHint =
    tool === 'select'
      ? 'Auf Element klicken und ziehen zum Verschieben'
      : tool === 'add' && activeTab === 'rooms'
        ? 'Klicken Sie um Punkte zu setzen – ersten Punkt erneut klicken zum Schließen'
        : tool === 'add' && activeTab === 'doors'
          ? 'Hinzufügen ist für Türen/Fenster nicht verfügbar'
          : tool === 'remove'
            ? 'Klicken Sie auf ein Element, um es zu entfernen'
            : tool === 'edit'
              ? 'Eckpunkte ziehen; auf Kante klicken = neuer Punkt; Kante ziehen = Segment verschieben'
              : ''

  return (
    <div className="relative w-full flex flex-col items-stretch gap-3 flex-1 min-h-0">
      <div className="shrink-0 px-2 pt-1 pb-1">
        <h2 className="text-white font-semibold text-base text-center">
          Erkennung prüfen – Räume und Fenster/Türen
        </h2>
        <p className="text-sand/80 text-xs max-w-xl text-center mx-auto mt-0.5">
          Etagen als Tabs. Rad zum Zoomen, Ziehen zum Schwenken.
        </p>
      </div>

      {/* Tab-uri etaj: Beci, Parter, Etaj 1, etc. */}
      {!loading && plansData.length > 0 && n > 1 && (
        <div className="shrink-0 flex flex-wrap items-center justify-center gap-1 px-2 py-2 border-b border-white/10">
          {Array.from({ length: n }).map((_, i) => {
            const label = floorLabels[i] ?? `Plan ${i + 1}`
            const isActive = planIndexClamped === i
            return (
              <button
                key={`floor-tab-${i}`}
                type="button"
                onClick={() => { setPlanIndex(i); setSelectedPolygonIndex(null); setNewPolygonPoints(null); if (tool === 'add') setTool('select') }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-[#E5B800]/25 text-[#E5B800] border border-[#E5B800]/50' : 'text-sand/80 border border-white/10 hover:bg-white/5'}`}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}

      {/* Tools */}
      <div className="shrink-0 flex flex-wrap items-center justify-center gap-3 px-4 py-2">
        <span className="text-sand/60 text-xs">Werkzeuge:</span>
        <div className="flex flex-col items-center gap-0.5">
          <button
            type="button"
            onClick={() => { setTool('select'); setNewPolygonPoints(null) }}
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
            onClick={() => { setTool('add'); setSelectedPolygonIndex(null); setNewPolygonPoints([]) }}
            title={activeTab === 'rooms' ? 'Polygon (Zimmer) hinzufügen' : 'Tür oder Fenster hinzufügen'}
            className={`p-2 rounded-lg transition-colors cursor-pointer ${tool === 'add' ? 'bg-[#E5B800]/20 text-[#E5B800]' : 'text-sand/70 hover:bg-white/5'}`}
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
            className={`p-2 rounded-lg transition-colors cursor-pointer ${tool === 'remove' ? 'bg-[#E5B800]/20 text-[#E5B800]' : 'text-sand/70 hover:bg-white/5'}`}
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
            disabled={history.length === 0}
            title="Rückgängig"
            className="p-2 rounded-lg transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed text-sand/70 hover:bg-white/5"
          >
            <Undo2 size={18} />
          </button>
          <span className="text-[10px] text-sand/60">Rückgängig</span>
        </div>
      </div>

      {tool === 'add' && activeTab === 'doors' && (
        <div className="shrink-0 flex items-center justify-center gap-2 px-2 py-1.5">
          <span className="text-sand/70 text-xs">Tür oder Fenster:</span>
          <button type="button" onClick={() => setNewDoorType('door')} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${newDoorType === 'door' ? 'bg-[#22c55e]/30 text-green-300 border border-green-400/50' : 'text-sand/70 border border-white/10 hover:bg-white/5'}`}>Tür</button>
          <button type="button" onClick={() => setNewDoorType('window')} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${newDoorType === 'window' ? 'bg-blue-500/30 text-blue-200 border border-blue-400/50' : 'text-sand/70 border border-white/10 hover:bg-white/5'}`}>Fenster</button>
        </div>
      )}

      {toolHint && (
        <p className="shrink-0 text-xs text-sand/60 text-center px-4">
          {toolHint}
        </p>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden preisdatenbank-scroll px-2 py-2 flex flex-col items-center gap-4">
        {loading ? (
          <p className="text-sand/70 text-sm">Lade Vektordaten…</p>
        ) : plansData.length === 0 ? (
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
            if (!plan || !imageUrlForPlan) return null
            return (
              <div key={`plan-${i}`} className="w-full flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="text-white font-medium text-sm">
                    {floorLabels[i] ?? `Plan ${i + 1}`}
                  </h3>
                  <div className="flex gap-1">
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
                  </div>
                </div>
                <div className="relative w-full min-h-[38vh] max-h-[50vh] rounded-lg overflow-hidden border border-[#E5B800]/50 ring-1 ring-[#E5B800]/30 bg-black/30">
                  {(pendingNewRoomPoints || (roomTypePopoverIndex !== null && plansData[planIndexClamped]?.rooms[roomTypePopoverIndex])) && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 rounded-lg">
                      <div className="flex flex-wrap items-center justify-center gap-2 p-4 bg-[#1a1a1a] rounded-xl border-2 border-[#E5B800]/60 shadow-xl max-w-md">
                        {pendingNewRoomPoints ? (
                          <>
                            <span className="text-white text-sm font-medium w-full text-center">Raumart:</span>
                            {ROOM_TYPE_OPTIONS.map((opt) => (
                              <button key={opt} type="button" onClick={() => handlePickNewRoomType(opt)} className="px-4 py-2 rounded-lg text-sm font-medium bg-[#E5B800]/25 text-[#E5B800] border border-[#E5B800]/60 hover:bg-[#E5B800]/35">{opt}</button>
                            ))}
                            <button type="button" onClick={() => setPendingNewRoomPoints(null)} className="text-sand/60 text-sm hover:underline mt-1">Abbrechen</button>
                          </>
                        ) : roomTypePopoverIndex !== null ? (
                          <>
                            <span className="text-white text-sm font-medium w-full text-center">Raumtyp ändern:</span>
                            {ROOM_TYPE_OPTIONS.map((opt) => (
                              <button key={opt} type="button" onClick={() => handlePickEditRoomType(opt)} className="px-4 py-2 rounded-lg text-sm font-medium bg-[#E5B800]/25 text-[#E5B800] border border-[#E5B800]/60 hover:bg-[#E5B800]/35">{opt}</button>
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
                    tab={planTab}
                    tool={tool}
                    selectedIndex={selectedPolygonIndex}
                    newPoints={tool === 'add' ? newPolygonPoints : null}
                    newDoorType={newDoorType}
                    onInsertVertex={planTab === 'rooms' ? (polyIndex: number, afterVertexIndex: number, x: number, y: number) => handleInsertVertex(i, polyIndex, afterVertexIndex, x, y) : undefined}
                    onSelect={setSelectedPolygonIndex}
                    onAddPoint={(x, y) => setNewPolygonPoints((prev) => prev ? [...prev, [x, y]] : [[x, y]])}
                    onCloseNewPolygon={handleRequestCloseNewPolygon}
                    onRoomTypeLabelClick={handleRoomTypeLabelClick}
                    onMoveVertex={(polyIndex, vertexIndex, x, y) => {
                      if (planTab === 'rooms') {
                        const next = plan.rooms.map((r, ri) =>
                          ri !== polyIndex ? r : { ...r, points: r.points.map((p, vi) => vi === vertexIndex ? [x, y] as Point : p) }
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
                    onRemoveSelected={(index) => handleRemoveSelected(index)}
                    onEditStart={pushHistory}
                    onRoomsChange={(rooms) => setRooms(i, rooms)}
                    onDoorsChange={(doors) => setDoors(i, doors)}
                  />
                </div>
              </div>
            )
          })()
        )}
      </div>

      <div className="shrink-0 flex flex-wrap items-center justify-center gap-2 px-2 py-2">
        <button
          type="button"
          onClick={handleConfirm}
          className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-[#ffffff] shadow-lg transition-all duration-200 ease-out bg-gradient-to-b from-[#CC9900] to-[#E5B800] hover:brightness-110 hover:-translate-y-[0.5px] active:translate-y-0"
        >
          <Check size={18} />
          Erkennung bestätigen – weiter
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
