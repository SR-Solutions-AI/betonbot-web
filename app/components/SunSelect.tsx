'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, CheckCircle2, ChevronDown } from 'lucide-react'

function optValue(opt: string | { value?: string; label?: string }): string {
  if (opt == null) return ''
  if (typeof opt === 'object' && 'value' in opt) return String((opt as { value?: string }).value ?? '')
  return String(opt)
}

const EDITOR_SELECT_THEMES = {
  holz: {
    open: 'border-[#FF9F0F]/45 shadow-[0_0_0_2px_rgba(255,159,15,0.16)]',
    menuRing:
      'border-[#FF9F0F]/22 shadow-[0_10px_28px_rgba(55,32,18,0.35),inset_0_1px_0_rgba(255,190,130,0.14)]',
    itemActive: 'bg-[#FF9F0F]/22 text-[#FFECD6]',
    check: 'text-[#FFB347]',
    selection: 'selection:bg-[#FF9F0F]/30 selection:text-[#FFF5E8]',
    focusRing: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF9F0F]/40 focus-visible:ring-offset-0',
    editorTriggerBg:
      'bg-[rgba(58,36,22,0.78)] shadow-[inset_0_1px_0_rgba(255,170,110,0.16)] backdrop-blur-[2px]',
    editorTriggerBorder: 'border-[#FF9F0F]/18',
    editorTriggerHover: 'hover:border-[#FF9F0F]/28 hover:bg-[rgba(72,44,26,0.85)]',
    editorMenuBg: 'bg-[rgba(48,28,16,0.98)] backdrop-blur-md',
    editorRowHover: 'hover:bg-[#FF9F0F]/11',
    chevron: 'text-[#E8A56E]',
    labelFilled: 'text-[#FFF2E6]',
    labelMuted: 'text-[#D4A88A]',
    rowLabel: 'text-[#ECD4C0]',
  },
  beton: {
    open: 'border-[#E5B800]/45 shadow-[0_0_0_2px_rgba(229,184,0,0.16)]',
    menuRing:
      'border-[#E5B800]/22 shadow-[0_10px_28px_rgba(40,28,20,0.28),inset_0_1px_0_rgba(240,220,140,0.10)]',
    itemActive: 'bg-[#E5B800]/22 text-[#FCF4D0]',
    check: 'text-[#EDD447]',
    selection: 'selection:bg-[#E5B800]/28 selection:text-sand/95',
    focusRing: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5B800]/40 focus-visible:ring-offset-0',
    editorTriggerBg: 'bg-black/34 shadow-[inset_0_1px_0_rgba(255,255,255,0.09)] backdrop-blur-[2px]',
    editorTriggerBorder: 'border-white/12',
    editorTriggerHover: 'hover:border-white/18 hover:bg-black/40',
    editorMenuBg: 'bg-[rgba(44,38,34,0.96)] backdrop-blur-md',
    editorRowHover: 'hover:bg-white/[0.08]',
    chevron: 'text-sand/65',
    labelFilled: 'text-sand/95',
    labelMuted: 'text-sand/55',
    rowLabel: 'text-sand/92',
  },
} as const

export function SelectSun({
  value,
  onChange,
  options,
  placeholder = '— auswählen —',
  displayFor,
  variant = 'sun',
  editorTheme = 'holz',
  editorSize = 'md',
}: {
  value?: string
  onChange: (v: string) => void
  options: (string | { value?: string; label?: string })[]
  placeholder?: string
  displayFor?: (raw: string) => string
  /** `editor`: dark chrome for embedded tools (e.g. DetectionsReviewEditor). */
  variant?: 'sun' | 'editor'
  editorTheme?: keyof typeof EDITOR_SELECT_THEMES
  /** `md` slightly larger control + menu rows */
  editorSize?: 'sm' | 'md'
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number; width: number }>({ left: 0, top: 0, width: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)

  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect()
    if (!b) return
    setPos({ left: Math.round(b.left), top: Math.round(b.bottom + 6), width: Math.round(b.width) })
  }, [])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onScroll = () => place()
    const onResize = () => place()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, place])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!open) return
      const t = e.target as Node
      if (btnRef.current?.contains(t)) return
      setOpen(false)
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const show = (raw?: string) => (raw ? (displayFor ? displayFor(raw) : raw) : placeholder)

  const accent = EDITOR_SELECT_THEMES[editorTheme]
  const editorTriggerPad = editorSize === 'md' ? 'px-3.5 py-2.5' : 'px-2.5 py-1.5'
  const editorText = editorSize === 'md' ? 'text-sm' : 'text-xs'
  const editorItemPad = editorSize === 'md' ? 'px-3.5 py-2.5' : 'px-2.5 py-1.5'
  const chevronSz = editorSize === 'md' ? 17 : 14
  const checkSz = editorSize === 'md' ? 16 : 14
  const editorRadius = editorSize === 'md' ? 'rounded-lg' : 'rounded-md'

  const triggerClass =
    variant === 'editor'
      ? [
          'w-full flex items-center justify-between gap-2 border text-left [-webkit-tap-highlight-color:transparent]',
          editorRadius,
          accent.editorTriggerBg,
          'transition-[border-color,box-shadow,background-color]',
          accent.editorTriggerBorder,
          accent.editorTriggerHover,
          'outline-none',
          accent.focusRing,
          accent.selection,
          editorTriggerPad,
          editorText,
          open ? accent.open : '',
        ].join(' ')
      : `sun-select ${open ? 'sun-select--open' : ''}`

  const menuClass =
    variant === 'editor'
      ? [
          'themed-scroll overflow-y-auto overflow-x-hidden border py-0.5',
          editorRadius,
          accent.editorMenuBg,
          accent.menuRing,
          accent.selection,
          editorSize === 'md' ? 'max-h-[min(280px,50vh)]' : 'max-h-52',
        ].join(' ')
      : 'sun-menu themed-scroll'

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        className={triggerClass}
        onClick={() => setOpen((o) => !o)}
      >
        <span
          className={
            variant === 'editor'
              ? `min-w-0 flex-1 truncate ${value ? accent.labelFilled : accent.labelMuted}`
              : `truncate ${value ? 'text-ink' : 'text-neutral-500'}`
          }
        >
          {show(value)}
        </span>
        <ChevronDown
          size={chevronSz}
          className={`shrink-0 transition-transform ${variant === 'editor' ? accent.chevron : 'opacity-80'} ${open && variant === 'editor' ? 'rotate-180' : ''}`}
        />
      </button>

      {open &&
        typeof window !== 'undefined' &&
        createPortal(
          <div
            className={menuClass}
            role="listbox"
            style={{ position: 'fixed', left: pos.left, top: pos.top, width: pos.width, zIndex: 9999 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {(options ?? []).map((opt, i) => {
              const val = optValue(opt)
              const active = val === value
              const label = displayFor
                ? displayFor(val)
                : typeof opt === 'object' && opt !== null && 'label' in opt
                  ? String((opt as { label?: string }).label ?? val)
                  : val
              const itemClass =
                variant === 'editor'
                  ? [
                      'w-full flex items-center justify-between gap-2 rounded-md border-0 text-left [-webkit-tap-highlight-color:transparent]',
                      editorItemPad,
                      editorText,
                      'transition-colors outline-none',
                      accent.focusRing,
                      accent.selection,
                      active ? accent.itemActive : [accent.rowLabel, 'bg-transparent', accent.editorRowHover].join(' '),
                    ].join(' ')
                  : `sun-menu-item ${active ? 'is-active' : ''}`
              return (
                <button
                  key={val != null && val !== '' ? `opt-${String(val)}-${i}` : `opt-${i}`}
                  type="button"
                  className={itemClass}
                  onClick={() => {
                    onChange(val)
                    setOpen(false)
                  }}
                >
                  <span className="min-w-0 flex-1 leading-snug">{label}</span>
                  {active &&
                    (variant === 'editor' ? (
                      <Check size={checkSz} strokeWidth={2.5} className={`shrink-0 ${accent.check}`} aria-hidden />
                    ) : (
                      <CheckCircle2 size={checkSz} className="shrink-0" />
                    ))}
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}
