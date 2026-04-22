'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { DatePickerPopover } from './DatePickerPopover'

export type OfferHistoryOfferTypeOption = { id: string; slug: string }
export type OfferHistoryOrgMember = { id: string; email: string | null; full_name: string | null }

/** Same wizard package types as Step Wizard package picker. */
export const WIZARD_OFFER_SLUGS = [
  'mengenermittlung',
  'mengen',
  'neubau',
  'aufstockung',
  'zubau',
  'zubau_aufstockung',
  'full_house',
] as const

const SLUG_TO_LABEL: Record<string, string> = {
  mengenermittlung: 'Mengenermittlung',
  mengen: 'Mengenermittlung',
  neubau: 'Neubau Angebot',
  aufstockung: 'Aufstockung Angebot',
  zubau: 'Zubau Angebot',
  zubau_aufstockung: 'Zubau / Aufstockung Angebot',
  full_house: 'Neubau Angebot',
}

export function offerTypeLabel(slug: string | null | undefined): string {
  if (!slug) return ''
  return SLUG_TO_LABEL[slug] ?? slug
}

type Props = {
  offerTypeOptions: OfferHistoryOfferTypeOption[]
  orgMembers: OfferHistoryOrgMember[]
  draftOfferTypeId: string
  setDraftOfferTypeId: (v: string) => void
  draftDateFrom: string
  setDraftDateFrom: (v: string) => void
  draftDateTo: string
  setDraftDateTo: (v: string) => void
  draftSelectedUserIds: string[]
  toggleUserFilter: (id: string) => void
  onClearUserSelection: () => void
  onApply: () => void
  onReset: () => void
}

export function OfferHistoryFilterForm({
  offerTypeOptions,
  orgMembers,
  draftOfferTypeId,
  setDraftOfferTypeId,
  draftDateFrom,
  setDraftDateFrom,
  draftDateTo,
  setDraftDateTo,
  draftSelectedUserIds,
  toggleUserFilter,
  onClearUserSelection,
  onApply,
  onReset,
}: Props) {
  const offerTypeTriggerRef = useRef<HTMLDivElement>(null)
  const offerTypeMenuRef = useRef<HTMLDivElement>(null)
  const [offerTypeDropdownOpen, setOfferTypeDropdownOpen] = useState(false)
  const [offerTypeMenuPosition, setOfferTypeMenuPosition] = useState({ top: 0, left: 0, width: 200 })

  // Betonbot: fără oferta doar acoperiș (Dachstuhl)
  const orderedWizardTypes = [
    offerTypeOptions.find((o) => o.slug === 'mengenermittlung' || o.slug === 'mengen'),
    offerTypeOptions.find((o) => o.slug === 'neubau' || o.slug === 'full_house'),
    offerTypeOptions.find((o) => o.slug === 'aufstockung'),
    offerTypeOptions.find((o) => o.slug === 'zubau'),
    offerTypeOptions.find((o) => o.slug === 'zubau_aufstockung'),
  ].filter(Boolean) as OfferHistoryOfferTypeOption[]

  useEffect(() => {
    if (!offerTypeDropdownOpen || !offerTypeTriggerRef.current) return
    const MIN_W = 200
    const MENU_H = 220
    const GAP = 6
    const update = () => {
      if (!offerTypeTriggerRef.current) return
      const rect = offerTypeTriggerRef.current.getBoundingClientRect()
      const width = Math.max(rect.width, MIN_W)
      const vw = window.innerWidth
      const vh = window.innerHeight
      const left = Math.max(GAP, Math.min(rect.left, vw - width - GAP))
      const wouldOverflowBottom = rect.bottom + GAP + MENU_H > vh
      const top = wouldOverflowBottom ? Math.max(GAP, rect.top - GAP - MENU_H) : rect.bottom + GAP
      setOfferTypeMenuPosition({ top, left, width })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [offerTypeDropdownOpen])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        offerTypeTriggerRef.current?.contains(e.target as Node) ||
        offerTypeMenuRef.current?.contains(e.target as Node)
      )
        return
      setOfferTypeDropdownOpen(false)
    }
    if (offerTypeDropdownOpen) document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [offerTypeDropdownOpen])

  return (
    <>
      <div className="p-4 space-y-5">
        <div>
          <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-sand/70">Angebot</label>
          <div ref={offerTypeTriggerRef} className="relative">
            <button
              type="button"
              onClick={() => setOfferTypeDropdownOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-left text-sm text-white sun-input hover:border-white/25 focus:border-[#E5B800]/50 focus:ring-2 focus:ring-[#E5B800]/20"
            >
              <span>
                {(() => {
                  if (!draftOfferTypeId) return 'Alle'
                  const selectedType = orderedWizardTypes.find((ot) => ot.id === draftOfferTypeId)
                  return offerTypeLabel(selectedType?.slug) || 'Alle'
                })()}
              </span>
              <ChevronDown
                size={16}
                className={`shrink-0 text-sand/50 transition-transform ${offerTypeDropdownOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {typeof document !== 'undefined' &&
              offerTypeDropdownOpen &&
              createPortal(
                <div
                  ref={offerTypeMenuRef}
                  data-offer-history-offer-type-menu
                  onClick={(e) => e.stopPropagation()}
                  className="fixed z-[9998] overflow-hidden rounded-xl border border-white/20 bg-coffee-850 py-1.5 shadow-xl shadow-black/40"
                  style={{
                    top: offerTypeMenuPosition.top,
                    left: offerTypeMenuPosition.left,
                    width: offerTypeMenuPosition.width,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setDraftOfferTypeId('')
                      setOfferTypeDropdownOpen(false)
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors ${!draftOfferTypeId ? 'bg-[#E5B800]/20 text-[#E5B800]' : 'text-sand/90 hover:bg-white/10 hover:text-white'}`}
                  >
                    {draftOfferTypeId ? <span className="w-5" /> : <Check size={16} className="shrink-0" />}
                    Alle
                  </button>
                  {orderedWizardTypes.map((ot) => {
                    const isSelected = draftOfferTypeId === ot.id
                    return (
                      <button
                        key={ot.id}
                        type="button"
                        onClick={() => {
                          setDraftOfferTypeId(ot.id)
                          setOfferTypeDropdownOpen(false)
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors ${isSelected ? 'bg-[#E5B800]/20 text-[#E5B800]' : 'text-sand/90 hover:bg-white/10 hover:text-white'}`}
                      >
                        {isSelected ? <Check size={16} className="shrink-0" /> : <span className="w-5" />}
                        {offerTypeLabel(ot.slug)}
                      </button>
                    )
                  })}
                </div>,
                document.body,
              )}
          </div>
        </div>
        <div className="border-t border-white/10 pt-4">
          <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-sand/70">Zeitraum</label>
          <div className="grid grid-cols-2 gap-3">
            <DatePickerPopover value={draftDateFrom} onChange={setDraftDateFrom} placeholder="Von" label="Von" />
            <DatePickerPopover value={draftDateTo} onChange={setDraftDateTo} placeholder="Bis" label="Bis" />
          </div>
        </div>
        <div className="border-t border-white/10 pt-4">
          <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-sand/70">Benutzer</label>
          <div className="max-h-36 space-y-1.5 overflow-y-auto rounded-xl border border-white/10 bg-white/5 p-2">
            {orgMembers.map((m) => (
              <label
                key={m.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm text-sand/90 transition-colors hover:bg-white/5 hover:text-white"
              >
                <input
                  type="checkbox"
                  checked={draftSelectedUserIds.includes(m.id)}
                  onChange={() => toggleUserFilter(m.id)}
                  className="size-4 shrink-0 rounded border-white/30 text-[#E5B800] focus:ring-2 focus:ring-[#E5B800]/40"
                />
                <span className="truncate">{m.full_name || m.email || m.id}</span>
              </label>
            ))}
          </div>
          {draftSelectedUserIds.length > 0 && (
            <button
              type="button"
              onClick={onClearUserSelection}
              className="mt-2 text-xs font-medium text-[#E5B800] transition-colors hover:text-[#FFCF33]"
            >
              Zurücksetzen
            </button>
          )}
        </div>
      </div>
      <div className="space-y-2 px-4 pb-4 pt-0">
        <button
          type="button"
          onClick={onApply}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-black/20 bg-[#E5B800] py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#FFCF33]"
        >
          Filter anwenden
        </button>
        <button
          type="button"
          onClick={onReset}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 py-2.5 text-sm font-medium text-sand/90 transition-colors hover:bg-white/10 hover:text-white"
        >
          Zurücksetzen
        </button>
      </div>
    </>
  )
}
