'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react'
import { motion } from 'framer-motion'

const WEEKDAYS_DE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

function toYMD(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseYMD(s: string): Date | null {
  if (!s || s.length !== 10) return null
  const [y, m, day] = s.split('-').map(Number)
  if (!y || !m || !day) return null
  const d = new Date(y, m - 1, day)
  return isNaN(d.getTime()) ? null : d
}

function formatDisplay(ymd: string): string {
  const d = parseYMD(ymd)
  if (!d) return ''
  const day = String(d.getDate()).padStart(2, '0')
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const y = d.getFullYear()
  return `${day}.${m}.${y}`
}

type DatePickerPopoverProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  label?: string
  id?: string
}

export function DatePickerPopover({ value, onChange, placeholder = 'Datum', label, id }: DatePickerPopoverProps) {
  const [open, setOpen] = useState(false)
  const [viewDate, setViewDate] = useState(() => parseYMD(value) || new Date())
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })

  const valueDate = parseYMD(value)
  const today = new Date()
  const todayStr = toYMD(today)

  useEffect(() => {
    if (valueDate) setViewDate(valueDate)
  }, [value])

  useEffect(() => {
    // outside click handled by backdrop in the portal
    return
  }, [open])

  const updatePosition = () => {
    const anchor = triggerRef.current || wrapRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const POPOVER_W = 320
    const POPOVER_H = 410
    const GAP = 8

    const vw = window.innerWidth
    const vh = window.innerHeight
    const left = Math.max(GAP, Math.min(rect.left, vw - POPOVER_W - GAP))
    const wouldOverflowBottom = rect.bottom + GAP + POPOVER_H > vh
    const top = wouldOverflowBottom ? Math.max(GAP, rect.top - GAP - POPOVER_H) : rect.bottom + GAP
    setPosition({ top, left })
  }

  useEffect(() => {
    if (!open) return
    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open])

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startPad = (firstDay.getDay() + 6) % 7
  const daysInMonth = lastDay.getDate()
  const totalCells = startPad + daysInMonth
  const rows = Math.ceil(totalCells / 7)

  const days: (number | null)[] = []
  for (let i = 0; i < startPad; i++) days.push(null)
  for (let d = 1; d <= daysInMonth; d++) days.push(d)
  while (days.length < rows * 7) days.push(null)

  const handleSelect = (d: number) => {
    const s = toYMD(new Date(year, month, d))
    onChange(s)
    setOpen(false)
  }

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1))
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1))

  const monthYearLabel = viewDate.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })

  return (
    <div ref={wrapRef} className="relative">
      {label && (
        <span className="block text-xs text-sand/60 mb-1.5">{label}</span>
      )}
      <button
        type="button"
        id={id}
        ref={triggerRef}
        onClick={() => {
          const next = !open
          if (next) updatePosition()
          setOpen(next)
        }}
        className="w-full min-w-0 overflow-hidden flex items-center gap-2 sun-input text-sm py-2.5 px-3 rounded-xl bg-white/90 border border-white/20 text-left text-coffee-900 hover:bg-white focus:border-[#E5B800]/50 focus:ring-2 focus:ring-[#E5B800]/20"
      >
        <CalendarIcon size={16} className="text-coffee-700/70 shrink-0" />
        <span className={`flex-1 min-w-0 truncate ${value ? 'text-coffee-900' : 'text-coffee-700/60'}`}>
          {value ? formatDisplay(value) : placeholder}
        </span>
      </button>

      {open && typeof document !== 'undefined' &&
        createPortal(
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-[9998] bg-black/0"
              onPointerDown={() => setOpen(false)}
              aria-hidden
            />
            <motion.div
              ref={popoverRef}
              initial={{ opacity: 0, scale: 0.96, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="fixed z-[9999] w-[320px] rounded-2xl bg-coffee-850 border border-white/20 shadow-2xl shadow-black/40 overflow-hidden"
              style={{ top: position.top, left: position.left }}
              onPointerDown={(e) => e.stopPropagation()}
            >
            <div className="p-5">
              {/* Month/Year header */}
              <div className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-3 mb-4">
                <button
                  type="button"
                  onClick={prevMonth}
                  className="p-2 -m-2 rounded-lg text-sand/70 hover:bg-white/10 hover:text-white transition-colors"
                  aria-label="Vorheriger Monat"
                >
                  <ChevronLeft size={22} />
                </button>
                <span className="text-base font-semibold text-white capitalize tracking-tight">{monthYearLabel}</span>
                <button
                  type="button"
                  onClick={nextMonth}
                  className="p-2 -m-2 rounded-lg text-sand/70 hover:bg-white/10 hover:text-white transition-colors"
                  aria-label="Nächster Monat"
                >
                  <ChevronRight size={22} />
                </button>
              </div>

              {/* Weekday labels */}
              <div className="grid grid-cols-7 gap-2 mb-2 px-0.5">
                {WEEKDAYS_DE.map((wd) => (
                  <div key={wd} className="text-center text-[11px] font-semibold text-sand/50 uppercase tracking-wider py-2">
                    {wd}
                  </div>
                ))}
              </div>

              {/* Date grid – fiecare zi într-o celulă clar definită */}
              <div className="grid grid-cols-7 gap-2">
                {days.map((d, i) => {
                  if (d === null) {
                    return <div key={`empty-${i}`} className="w-10 h-10 rounded-xl bg-white/[0.03]" aria-hidden />
                  }
                  const dateStr = toYMD(new Date(year, month, d))
                  const isSelected = value === dateStr
                  const isToday = dateStr === todayStr
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => handleSelect(d)}
                      className={`
                        w-10 h-10 flex items-center justify-center rounded-xl text-sm font-medium transition-all duration-150
                        ${isSelected
                          ? 'bg-[#E5B800] text-white shadow-lg shadow-[#E5B800]/30 scale-105'
                          : isToday
                            ? 'bg-white/10 text-white ring-2 ring-[#E5B800]/60'
                            : 'bg-white/5 text-sand/90 hover:bg-white/15 hover:text-white'
                        }
                      `}
                    >
                      {d}
                    </button>
                  )
                })}
              </div>

              {/* Footer actions */}
              <div className="flex items-center justify-between gap-4 pt-5 mt-4 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => { onChange(''); setOpen(false) }}
                  className="text-sm font-medium text-sand/60 hover:text-[#E5B800] transition-colors py-2 px-1"
                >
                  Löschen
                </button>
                <button
                  type="button"
                  onClick={() => { onChange(todayStr); setOpen(false) }}
                  className="text-sm font-medium text-[#E5B800] hover:text-[#F5D030] transition-colors py-2 px-1"
                >
                  Heute
                </button>
              </div>
            </div>
          </motion.div>
          </>,
          document.body
        )}
    </div>
  )
}
