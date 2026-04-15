'use client'

import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '../lib/supabaseClient'
import { inferOfferFlow } from '../lib/offerFlow'
import { Plus, Loader2, Search, Filter, Trash2, ChevronDown, Check, X } from 'lucide-react'
import { DatePickerPopover } from './DatePickerPopover'

type OfferListItem = {
  id: string
  title?: string | null
  status?: string | null
  meta?: { referinta?: string | null; roof_only_offer?: boolean | null; wizard_package?: string | null; measurements_only_offer?: boolean | null } | null
  created_at: string
  created_by?: string | null
  offer_type_slug?: string | null
  offer_type_name?: string | null
}

type OfferType = { id: string; slug: string; name?: string | null }
type OrgMember = { id: string; email: string | null; full_name: string | null; role: string | null }

const DE = {
  fallbackProject: 'Projekt',
  locale: 'de-DE',
  translations: { 'Ofertă nouă': 'Neues Angebot' },
} as const

const STORAGE_KEY_OFFER = 'holzbot_dashboard_offer'
const STORAGE_KEY_RUNNING = 'holzbot_dashboard_running'

function translateText(text?: string | null): string {
  if (!text) return ''
  const t = text.trim()
  return (DE.translations as Record<string, string>)[t] || t
}

/** Same wizard package types as Step Wizard package picker. */
const WIZARD_OFFER_SLUGS = ['mengenermittlung', 'mengen', 'dachstuhl', 'neubau', 'aufstockung', 'full_house'] as const
const SLUG_TO_LABEL: Record<string, string> = {
  mengenermittlung: 'Mengenermittlung',
  mengen: 'Mengenermittlung',
  dachstuhl: 'Dachstuhl Angebot',
  neubau: 'Neubau Angebot',
  aufstockung: 'Aufstockung Angebot',
  full_house: 'Neubau Angebot',
}

function offerTypeLabel(slug: string | null | undefined): string {
  if (!slug) return ''
  return SLUG_TO_LABEL[slug] ?? slug
}

function getOfferTypeBadgeLabel(item: OfferListItem): string {
  const wizardPkg = (item.meta?.wizard_package || '').toString().toLowerCase()
  const isRoofOffer = item.meta?.roof_only_offer === true || wizardPkg === 'dachstuhl'
  const isMeasurementsOnly = item.meta?.measurements_only_offer === true

  if (isMeasurementsOnly) {
    if (isRoofOffer) return 'Dachstuhl Mengenübersicht'
    if (wizardPkg === 'aufstockung') return 'Aufstockung Mengenübersicht'
    return 'Neubau Mengenübersicht'
  }
  if (isRoofOffer) return 'Dachstuhl Angebot'
  if (wizardPkg === 'aufstockung') return 'Aufstockung Angebot'
  return offerTypeLabel(item.offer_type_slug)
}

function statusLabelAndColor(status?: string | null): { label: string; className: string } | null {
  const s = (status || '').toLowerCase()
  if (!s) return null
  if (s === 'draft' || s === 'entwurf') {
    return {
      label: 'Entwurf',
      className: 'bg-sand/10 text-sand border border-sand/30',
    }
  }
  if (s === 'processing' || s === 'running' || s === 'laufend') {
    return {
      label: 'Läuft',
      className: 'bg-yellow-400/15 text-yellow-300 border border-yellow-400/40',
    }
  }
  if (s === 'done' || s === 'finished' || s === 'fertig') {
    return {
      label: 'Fertig',
      className: 'bg-[#E5B800]/15 text-[#E5B800] border border-[#E5B800]/60',
    }
  }
  if (s === 'cancelled') {
    return {
      label: 'Abgebrochen',
      className: 'bg-red-500/10 text-red-300 border border-red-500/40',
    }
  }
  return null
}

export default function HistoryList({ variant = 'wood' }: { variant?: 'wood' | 'default' }) {
  const [items, setItems] = useState<OfferListItem[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [offerTypeId, setOfferTypeId] = useState<string>('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [draftOfferTypeId, setDraftOfferTypeId] = useState<string>('')
  const [draftDateFrom, setDraftDateFrom] = useState('')
  const [draftDateTo, setDraftDateTo] = useState('')
  const [draftSelectedUserIds, setDraftSelectedUserIds] = useState<string[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [offerTypes, setOfferTypes] = useState<OfferType[]>([])
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const filterWrapRef = useRef<HTMLDivElement>(null)
  const [offerTypeDropdownOpen, setOfferTypeDropdownOpen] = useState(false)
  const offerTypeTriggerRef = useRef<HTMLDivElement>(null)
  const offerTypeMenuRef = useRef<HTMLDivElement>(null)
  const [offerTypeMenuPosition, setOfferTypeMenuPosition] = useState({ top: 0, left: 0, width: 200 })
  const loadGenerationRef = useRef(0)

  const wizardOfferTypes = offerTypes.filter((ot) =>
    WIZARD_OFFER_SLUGS.includes(ot.slug as (typeof WIZARD_OFFER_SLUGS)[number])
  )
  // Betonbot: fără oferta doar acoperiș (Dachstuhl)
  const orderedWizardTypes = [
    wizardOfferTypes.find((o) => o.slug === 'mengenermittlung' || o.slug === 'mengen'),
    wizardOfferTypes.find((o) => o.slug === 'neubau' || o.slug === 'full_house'),
  ].filter(Boolean) as OfferType[]

  async function load() {
    const gen = ++loadGenerationRef.current
    setApiError(null)
    try {
      const params = new URLSearchParams()
      params.set('limit', '50')
      if (search.trim()) params.set('search', search.trim())
      if (offerTypeId) params.set('offer_type_id', offerTypeId)
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      if (selectedUserIds.length) selectedUserIds.forEach((id) => params.append('created_by', id))
      const data = await apiFetch(`/offers?${params.toString()}`)
      if (gen !== loadGenerationRef.current) return
      setItems((data.items || []) as OfferListItem[])
    } catch (e: any) {
      if (gen !== loadGenerationRef.current) return
      const isNetwork = e?.message === 'Failed to fetch' || e?.name === 'TypeError'
      setItems([])
      setApiError(
        isNetwork
          ? 'API nicht erreichbar. Bitte Backend starten: cd holzbot-api && npm run start:dev'
          : (e?.message || 'Fehler beim Laden')
      )
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const me = await apiFetch('/me')
        const u = (me as any)?.user?.id
        const role = (me as any)?.user?.role
        const canManageOrg = (me as any)?.user?.can_manage_org === true
        if (!cancelled) {
          setUserId(u ?? null)
          setIsAdmin(role === 'org_leader' || role === 'admin' || canManageOrg)
        }
        const [typesRes, membersRes] = await Promise.all([
          apiFetch('/offers/types').catch(() => ({ items: [] })),
          apiFetch('/organisation/members').catch(() => ({ items: [] })),
        ])
        if (!cancelled) {
          setOfferTypes((typesRes as any)?.items ?? [])
          setOrgMembers((membersRes as any)?.items ?? [])
        }
      } catch (_) {}
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    load()
  }, [search, offerTypeId, dateFrom, dateTo, selectedUserIds.join(',')])

  // Preselect running offer for this user based on sessionStorage state (kept in sync by LiveFeed / StepWizard)
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (selected) return
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY_RUNNING)
      if (!raw) return
      const parsed = JSON.parse(raw) as { offerId?: string | null; runId?: string | null }
      const runningOfferId = parsed?.offerId
      if (!runningOfferId) return
      const exists = items.some((it) => it.id === runningOfferId)
      if (exists) {
        setSelected(runningOfferId)
      }
    } catch {
      // ignore parsing errors
    }
  }, [items, selected])

  useEffect(() => {
    const h = () => {
      if (loadDebounceRef.current) clearTimeout(loadDebounceRef.current)
      loadDebounceRef.current = setTimeout(load, 300)
    }
    window.addEventListener('offers:refresh', h)
    return () => {
      window.removeEventListener('offers:refresh', h)
      if (loadDebounceRef.current) clearTimeout(loadDebounceRef.current)
    }
  }, [])

  const applyFilters = () => {
    setOfferTypeId(draftOfferTypeId)
    setDateFrom(draftDateFrom)
    setDateTo(draftDateTo)
    setSelectedUserIds(draftSelectedUserIds)
    setFilterOpen(false)
  }

  const resetDraftFilters = () => {
    setDraftOfferTypeId('')
    setDraftDateFrom('')
    setDraftDateTo('')
    setDraftSelectedUserIds([])
    setFilterOpen(false)
  }

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      // Filter panel should stay open while interacting with portal-based dropdown
      if (offerTypeTriggerRef.current?.contains(target)) return
      if (offerTypeMenuRef.current?.contains(target)) return
      if (filterWrapRef.current && !filterWrapRef.current.contains(target)) setFilterOpen(false)
    }
    if (filterOpen) document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [filterOpen])

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
      ) return
      setOfferTypeDropdownOpen(false)
    }
    if (offerTypeDropdownOpen) document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [offerTypeDropdownOpen])

  const loadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleNewProject = () => {
    if (isCreating) return
    setIsCreating(true)
    setSelected(null)
    window.dispatchEvent(new CustomEvent('offer:new', { detail: { creationId: Date.now() } }))
    setTimeout(() => setIsCreating(false), 300)
  }

  const handleDelete = async (offerId: string) => {
    const it = items.find((i) => i.id === offerId)
    if (!it) return
    const canDelete = isAdmin || it.created_by === userId
    if (!canDelete) return
    setDeletingId(offerId)
    try {
      await apiFetch(`/offers/${offerId}`, { method: 'DELETE' })
      setItems((prev) => prev.filter((i) => i.id !== offerId))
      if (selected === offerId) {
        setSelected(null)
        window.dispatchEvent(new CustomEvent('offer:selected', { detail: { offerId: null } }))
      }
      window.dispatchEvent(new CustomEvent('offers:refresh'))
    } catch (_) {}
    finally {
      setDeletingId(null)
      setPendingDeleteId(null)
    }
  }

  const toggleUserFilter = (id: string) => {
    setDraftSelectedUserIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const hasActiveFilters = offerTypeId || dateFrom || dateTo || selectedUserIds.length > 0

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Row 1: Projekt (left) + Search & Filter icons (right) */}
      <div className="flex items-center justify-between gap-2 shrink-0 mb-3">
        <h2 className="text-sand font-semibold text-base truncate">Projekt</h2>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => { setSearchOpen((o) => !o); if (!searchOpen) setFilterOpen(false) }}
            className={`p-1.5 rounded-lg transition-colors ${searchOpen ? 'bg-[#E5B800]/20 text-[#E5B800]' : 'text-sand/70 hover:bg-white/10 hover:text-sand'}`}
            title="Suchen"
            aria-label="Suchen"
          >
            <Search size={18} />
          </button>
          <div className="relative" ref={filterWrapRef}>
            <button
              type="button"
              onClick={() => {
                setFilterOpen((o) => {
                  const next = !o
                  if (next) {
                    // open: seed draft with applied filters
                    setDraftOfferTypeId(offerTypeId)
                    setDraftDateFrom(dateFrom)
                    setDraftDateTo(dateTo)
                    setDraftSelectedUserIds(selectedUserIds)
                    setSearchOpen(false)
                  }
                  return next
                })
              }}
              className={`p-1.5 rounded-lg transition-colors ${filterOpen ? 'bg-[#E5B800]/20 text-[#E5B800]' : 'text-sand/70 hover:bg-white/10 hover:text-sand'} ${hasActiveFilters ? 'text-[#E5B800]' : ''}`}
              title="Filter"
              aria-label="Filter"
            >
              <Filter size={18} />
              {hasActiveFilters && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#E5B800]" aria-hidden />
              )}
            </button>
            <AnimatePresence>
            {filterOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -8 }}
                transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
                className="absolute right-0 top-full mt-2 z-30 w-[280px] rounded-2xl bg-coffee-850/95 border border-white/20 shadow-2xl shadow-black/30 backdrop-blur-sm overflow-hidden"
              >
                <div className="p-4 space-y-5">
                  <div>
                    <label className="block text-xs font-medium text-sand/70 uppercase tracking-wider mb-2">Angebot</label>
                    <div ref={offerTypeTriggerRef} className="relative">
                      <button
                        type="button"
                        onClick={() => setOfferTypeDropdownOpen((o) => !o)}
                        className="w-full flex items-center justify-between gap-2 sun-input text-sm py-2.5 px-3 rounded-xl bg-white/5 border border-white/15 text-left text-white hover:border-white/25 focus:border-[#E5B800]/50 focus:ring-2 focus:ring-[#E5B800]/20"
                      >
                        <span>
                          {(() => {
                            if (!draftOfferTypeId) return 'Alle'
                            const selectedType = orderedWizardTypes.find((ot) => ot.id === draftOfferTypeId)
                            return offerTypeLabel(selectedType?.slug) || 'Alle'
                          })()}
                        </span>
                        <ChevronDown size={16} className={`text-sand/50 shrink-0 transition-transform ${offerTypeDropdownOpen ? 'rotate-180' : ''}`} />
                      </button>
                      {typeof document !== 'undefined' &&
                        offerTypeDropdownOpen &&
                        createPortal(
                          <div
                            ref={offerTypeMenuRef}
                            onClick={(e) => e.stopPropagation()}
                            className="fixed z-[9998] rounded-xl bg-coffee-850 border border-white/20 shadow-xl shadow-black/40 overflow-hidden py-1.5"
                            style={{
                              top: offerTypeMenuPosition.top,
                              left: offerTypeMenuPosition.left,
                              width: offerTypeMenuPosition.width,
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => { setDraftOfferTypeId(''); setOfferTypeDropdownOpen(false) }}
                              className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors ${!draftOfferTypeId ? 'bg-[#E5B800]/20 text-[#E5B800]' : 'text-sand/90 hover:bg-white/10 hover:text-white'}`}
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
                                  onClick={() => { setDraftOfferTypeId(ot.id); setOfferTypeDropdownOpen(false) }}
                                  className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors ${isSelected ? 'bg-[#E5B800]/20 text-[#E5B800]' : 'text-sand/90 hover:bg-white/10 hover:text-white'}`}
                                >
                                  {isSelected ? <Check size={16} className="shrink-0" /> : <span className="w-5" />}
                                  {offerTypeLabel(ot.slug)}
                                </button>
                              )
                            })}
                          </div>,
                          document.body
                        )}
                    </div>
                  </div>
                  <div className="border-t border-white/10 pt-4">
                    <label className="block text-xs font-medium text-sand/70 uppercase tracking-wider mb-2">Zeitraum</label>
                    <div className="grid grid-cols-2 gap-3">
                      <DatePickerPopover
                        value={draftDateFrom}
                        onChange={setDraftDateFrom}
                        placeholder="Von"
                        label="Von"
                      />
                      <DatePickerPopover
                        value={draftDateTo}
                        onChange={setDraftDateTo}
                        placeholder="Bis"
                        label="Bis"
                      />
                    </div>
                  </div>
                  <div className="border-t border-white/10 pt-4">
                    <label className="block text-xs font-medium text-sand/70 uppercase tracking-wider mb-2">Benutzer</label>
                    <div className="max-h-36 overflow-y-auto rounded-xl bg-white/5 border border-white/10 p-2 space-y-1.5">
                      {orgMembers.map((m) => (
                        <label key={m.id} className="flex items-center gap-3 cursor-pointer py-1.5 px-2 rounded-lg hover:bg-white/5 text-sm text-sand/90 hover:text-white transition-colors">
                          <input
                            type="checkbox"
                            checked={draftSelectedUserIds.includes(m.id)}
                            onChange={() => toggleUserFilter(m.id)}
                            className="rounded border-white/30 text-[#E5B800] focus:ring-2 focus:ring-[#E5B800]/40 size-4 shrink-0"
                          />
                          <span className="truncate">{m.full_name || m.email || m.id}</span>
                        </label>
                      ))}
                    </div>
                    {draftSelectedUserIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setDraftSelectedUserIds([])}
                        className="mt-2 text-xs text-[#E5B800] hover:text-[#F5D030] font-medium transition-colors"
                      >
                        Zurücksetzen
                      </button>
                    )}
                  </div>
                </div>
                <div className="px-4 pb-4 pt-0 space-y-2">
                  <button
                    type="button"
                    onClick={applyFilters}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#E5B800] hover:bg-[#F5D030] border border-black/20 text-white text-sm font-semibold transition-colors"
                  >
                    Filter anwenden
                  </button>
                  <button
                    type="button"
                    onClick={resetDraftFilters}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-sand/90 hover:text-white text-sm font-medium transition-colors"
                  >
                    Zurücksetzen
                  </button>
                </div>
              </motion.div>
            )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Search bar (when search icon active) */}
      <AnimatePresence>
      {searchOpen && (
        <motion.div
          initial={{ opacity: 0, height: 0, marginBottom: 0 }}
          animate={{ opacity: 1, height: 'auto', marginBottom: 12 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="shrink-0 overflow-hidden"
        >
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sand/50" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Suchen…"
              className="w-full pl-8 pr-8 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-sand/50 text-sm focus:border-[#E5B800]/50 focus:outline-none focus:ring-1 focus:ring-[#E5B800]/30"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setSearchOpen(false)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-sand/50 hover:text-sand"
              aria-label="Suche schließen"
            >
              <X size={14} />
            </button>
          </div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Neues Projekt button */}
      <div className="shrink-0 mb-3">
        <button
          onClick={handleNewProject}
          disabled={isCreating}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-white shadow-md transition-all duration-200 bg-gradient-to-b from-[#CC9900] to-[#E5B800] hover:brightness-110 hover:shadow-lg hover:shadow-[#E5B800]/20 disabled:opacity-70 disabled:cursor-wait disabled:transform-none"
        >
          {isCreating ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
          {isCreating ? 'Wird erstellt...' : 'Neues Projekt'}
        </button>
      </div>

      {apiError && (
        <div className="shrink-0 mb-3 px-3 py-2 rounded-lg bg-amber-950/40 border border-amber-500/40 text-amber-200 text-sm">
          {apiError}
        </div>
      )}

      {/* Offer list */}
      <div className="flex-1 overflow-y-auto hide-scroll min-h-0 space-y-2 pr-0.5">
        {items.length === 0 && !apiError && (
          <div className="py-6 text-center text-sand/60 text-sm">
            Keine Angebote. Klicken Sie auf „Neues Projekt“ und wählen Sie einen Typ.
          </div>
        )}
        {items.map((it) => {
          const rawDisplay = it?.meta?.referinta?.trim() || it?.title || DE.fallbackProject
          const display = translateText(rawDisplay)
          const canDelete = isAdmin || it.created_by === userId
          const isSelected = selected === it.id
          const statusLower = (it.status || '').toLowerCase()
          const isDraftStatus = statusLower === 'draft' || statusLower === 'entwurf'

          return (
            <div
              key={it.id}
              className={`group relative rounded-xl border overflow-hidden transition-all duration-150 ${isSelected ? 'border-[#E5B800] bg-[#E5B800]/10 shadow-[0_0_0_1px_rgba(229,184,0,0.35)]' : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/15'}`}
            >
              <button
                type="button"
                disabled={isCreating}
                onClick={() => {
                  if (isCreating) return
                  setSelected(it.id)
                  // Actualizare instantă: resetează panoul și încarcă oferta; apoi, în background, verificăm dacă rulează
                  window.dispatchEvent(new CustomEvent('offer:selected', { detail: { offerId: it.id } }))
                  if (!isDraftStatus) {
                    apiFetch(`/calc-events/history?offer_id=${encodeURIComponent(it.id)}`)
                      .then((hist: any) => {
                        if (hist?.run_id && hist?.run_status === 'running') {
                          window.dispatchEvent(
                            new CustomEvent('offer:compute-started', {
                              detail: { offerId: it.id, runId: hist.run_id },
                            })
                          )
                        }
                      })
                      .catch(() => {})
                  }
                }}
                className="w-full text-left px-3 py-2.5 pr-9"
              >
                <div className="font-medium truncate text-white text-sm">{display}</div>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span className="text-xs text-sand/60">
                    {new Date(it.created_at).toLocaleString(DE.locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {(it.offer_type_slug || it.meta?.roof_only_offer === true || it.meta?.wizard_package) && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-white/10 text-sand/80">
                      {getOfferTypeBadgeLabel(it)}
                    </span>
                  )}
                  {(() => {
                    const info = statusLabelAndColor(it.status)
                    if (!info) return null
                    return (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full border ${info.className}`}>
                        {info.label}
                      </span>
                    )
                  })()}
                </div>
              </button>
              {canDelete && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setPendingDeleteId(it.id)
                  }}
                  disabled={deletingId === it.id}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-sand/50 hover:text-[#E5B800] hover:bg-[#E5B800]/15 transition-colors disabled:opacity-50"
                  title="Angebot löschen"
                >
                  {deletingId === it.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Delete offer confirm modal – styled like StepWizard cancel popup */}
      {pendingDeleteId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-panel rounded-xl p-6 max-w-md w-full mx-4 shadow-soft border border-white/10 animate-fade-in">
            <h3 className="text-lg font-bold text-sand mb-4">Angebot löschen?</h3>
            <p className="text-sand/80 mb-6">
              Möchten Sie dieses Angebot wirklich löschen? Dieser Vorgang kann nicht rückgängig gemacht werden.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setPendingDeleteId(null)}
                className="px-4 py-2.5 rounded-xl font-medium text-sand/80 hover:text-sand bg-black/10 hover:bg-black/20 border border-white/10 transition-colors"
              >
                Nein
              </button>
              <button
                type="button"
                onClick={() => {
                  if (pendingDeleteId) {
                    void handleDelete(pendingDeleteId)
                  }
                }}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-white shadow-lg transition-all duration-200 ease-out bg-gradient-to-b from-[#CC9900] to-[#E5B800] hover:brightness-110 hover:-translate-y-[1px] hover:shadow-[0_4px_14px_rgba(229,184,0,0.35)] active:translate-y-[1px] active:scale-95 disabled:opacity-60"
                disabled={!!deletingId}
              >
                Ja
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
