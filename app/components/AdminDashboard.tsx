'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { apiFetch } from '../lib/supabaseClient'
import { ADMIN_FIELD_LABELS_DE, ADMIN_STEP_LABELS_DE, toDeOption } from '../lib/adminDe'
import PdfThumbnail from './PdfThumbnail'

// Dynamic import pentru SimplePdfViewer - doar pe client pentru a evita problemele cu Turbopack
// Folosim .client.tsx wrapper pentru a forța încărcarea doar pe client
const SimplePdfViewer = dynamic(() => import('./SimplePdfViewer.client'), {
  ssr: false,
  loading: () => <div className="py-10 text-center text-neutral-200">PDF wird generiert…</div>
})

type AdminUser = {
  id: string
  email: string
  role: string | null
  full_name: string | null
  tenant_id: string
  created_at: string | null
  tenants?: { id: string; slug: string; name: string; config?: any } | null
}

type AdminOffer = {
  id: string
  title?: string | null
  status?: string | null
  meta?: { referinta?: string | null } | null
  created_at: string
  tenant_id: string
  created_by: string | null
  settings_summary?: string[] | null
  settings_raw?: Record<string, any> | null
  total_price?: number | null
}

function fmtDate(ts?: string | null) {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleString('de-DE')
  } catch {
    return ts
  }
}

function formatPriceEUR(v?: number | null) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v)
}

type SettingRow = { stepKey: string; fieldKey: string; label: string; value: string }
function parseSettingRow(s: string): { label: string; value: string } | null {
  // Current API format: "Label: Value"
  const idx = s.indexOf(':')
  if (idx <= 0) return null
  return { label: s.slice(0, idx).trim(), value: s.slice(idx + 1).trim() }
}

export default function AdminDashboard() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [offers, setOffers] = useState<AdminOffer[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null)
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [loadingOffers, setLoadingOffers] = useState(false)
  const [assetsByOffer, setAssetsByOffer] = useState<Record<string, { planUrl?: string | null; planMime?: string | null; pdfUrl?: string | null; adminPdfUrl?: string | null; calculationMethodPdfUrl?: string | null; loading?: boolean }>>({})
  const [lightbox, setLightbox] = useState<{ kind: 'plan' | 'pdf'; url: string; mime?: string | null } | null>(null)
  const [processingImages, setProcessingImages] = useState<Record<string, Record<string, Array<{ id: string; url: string; filename: string; plan_id?: string }>>>>({})
  const [processingModal, setProcessingModal] = useState<string | null>(null)

  const selectedUser = useMemo(
    () => users.find(u => u.id === selectedUserId) ?? null,
    [users, selectedUserId],
  )

  async function loadUsers() {
    setLoadingUsers(true)
    try {
      const res = await apiFetch('/admin/users')
      setUsers((res?.items ?? []) as AdminUser[])
      // Auto-select first user if none selected
      const first = (res?.items ?? [])[0]?.id
      if (!selectedUserId && first) setSelectedUserId(first)
    } finally {
      setLoadingUsers(false)
    }
  }

  async function loadOffersForUser(userId: string) {
    setLoadingOffers(true)
    try {
      const res = await apiFetch(`/admin/users/${encodeURIComponent(userId)}/offers?limit=200`)
      setOffers((res?.items ?? []) as AdminOffer[])
      setSelectedOfferId(null)
      setAssetsByOffer({})
    } finally {
      setLoadingOffers(false)
    }
  }

  useEffect(() => {
    loadUsers().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedUserId) return
    loadOffersForUser(selectedUserId).catch(() => {})
  }, [selectedUserId])

  // Lazy-load plan + PDF previews for the first N offers.
  useEffect(() => {
    const list = offers.slice(0, 20)
    if (!list.length) return
    let cancelled = false
    
    ;(async () => {
      const updates: Record<string, any> = {}
      
      // First, mark all as loading
      const loadingUpdates: Record<string, any> = {}
      list.forEach(o => {
        if (!assetsByOffer[o.id] || assetsByOffer[o.id].loading === undefined) {
          loadingUpdates[o.id] = { ...assetsByOffer[o.id], loading: true }
        }
      })
      if (Object.keys(loadingUpdates).length > 0) {
        setAssetsByOffer(prev => ({ ...prev, ...loadingUpdates }))
      }
      
      // Then load assets
      await Promise.all(
        list.map(async (o) => {
          const existing = assetsByOffer[o.id]
          // Only skip if we have both URLs and they're not null
          if (existing && existing.planUrl !== undefined && existing.pdfUrl !== undefined && existing.loading === false) {
            // But reload if URLs are null (might have failed before)
            if (existing.planUrl !== null || existing.pdfUrl !== null) {
              return // Already loaded successfully
            }
          }
          try {
            const exp = await apiFetch(`/offers/${o.id}/export`)
            if (cancelled) return
            const plan = exp?.files?.plan
            const pdf = exp?.files?.pdf
            const adminPdf = exp?.files?.adminPdf
            const calculationMethodPdf = exp?.files?.calculationMethodPdf
            updates[o.id] = {
              planUrl: plan?.download_url ?? null,
              planMime: plan?.meta?.mime ?? null,
              pdfUrl: pdf?.download_url ?? exp?.pdf ?? exp?.download_url ?? null,
              adminPdfUrl: adminPdf?.download_url ?? null,
              calculationMethodPdfUrl: calculationMethodPdf?.download_url ?? null,
              loading: false,
            }
          } catch (err) {
            if (cancelled) return
            console.warn(`Failed to load assets for offer ${o.id}:`, err)
            updates[o.id] = { planUrl: null, planMime: null, pdfUrl: null, loading: false }
          }
        }),
      )
      if (cancelled) return
      setAssetsByOffer(prev => {
        const merged = { ...prev }
        Object.keys(updates).forEach(id => {
          merged[id] = { ...merged[id], ...updates[id] }
        })
        return merged
      })
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offers])

  return (
    <>
    <div className="grid grid-cols-[minmax(200px,280px)_1fr] gap-4 h-full min-h-0">
      {/* Left: users */}
      <aside className="bg-panel/80 border border-black/40 rounded-xl2 p-3 shadow-soft flex flex-col min-w-0 h-full min-h-0">
        <div className="text-sand font-semibold mb-3 shrink-0 flex items-center justify-between gap-2">
          <span>Accounts</span>
          <button
            className="px-3 py-1.5 rounded-lg border border-white/10 bg-[#E5B800]/10 hover:bg-[#E5B800]/20 text-xs text-[#E5B800] font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
            onClick={() => loadUsers()}
            disabled={loadingUsers}
            title="Refresh"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {loadingUsers ? 'Lädt...' : 'Aktualisieren'}
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto hide-scroll space-y-2 pr-1">
          {loadingUsers && users.length === 0 ? (
            <div className="text-sm text-sand/70">Loading…</div>
          ) : null}
          {users.map(u => {
            const active = u.id === selectedUserId
            const companyName = (u.tenants as any)?.name || (u.tenants as any)?.slug || 'Company'
            const rep =
              (u.tenants as any)?.config?.pdf?.handler_name ||
              (u.tenants as any)?.config?.pdf?.handlerName ||
              null
            return (
              <button
                key={u.id}
                onClick={() => setSelectedUserId(u.id)}
                className={`list-btn ${active ? 'list-btn--active' : ''}`}
                title={u.id}
              >
                <div className="text-sm font-bold tracking-wide text-sand truncate">
                  {companyName}
                </div>
                <div className="text-xs text-neutral-200/70 truncate">
                  {u.email}{rep ? ` — ${rep}` : ''}
                </div>
              </button>
            )
          })}
        </div>
      </aside>

      {/* Middle: offers for selected user */}
      <main className="bg-panel/80 border border-black/40 rounded-xl2 p-3 shadow-soft min-w-0 h-full min-h-0 overflow-hidden flex flex-col">
        <div className="text-sand font-semibold mb-3 shrink-0 flex items-center justify-between gap-2">
          <div className="min-w-0 truncate">
            Offers {selectedUser ? <span className="text-sand/60 font-normal">— {selectedUser.email}</span> : null}
          </div>
          <button
            className="px-3 py-1.5 rounded-lg border border-white/10 bg-[#E5B800]/10 hover:bg-[#E5B800]/20 text-xs text-[#E5B800] font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
            onClick={() => (selectedUserId ? loadOffersForUser(selectedUserId) : null)}
            disabled={loadingOffers || !selectedUserId}
            title="Refresh"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {loadingOffers ? 'Lädt...' : 'Aktualisieren'}
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto hide-scroll pr-1">
          {loadingOffers && offers.length === 0 ? (
            <div className="text-sm text-sand/70">Loading…</div>
          ) : null}
          {!loadingOffers && offers.length === 0 ? (
            <div className="text-sm text-sand/70">
              No offers found for this account.
            </div>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {offers.map(o => {
            const display = (o?.meta as any)?.referinta || o?.title || 'Offer'
            const active = o.id === selectedOfferId
            const summary = (o.settings_summary ?? []).filter(Boolean)
            // Convert to grouped-by-step rows (Bausystem / Materialien / Energie / Logistik)
            const rows: SettingRow[] = summary
              .map(parseSettingRow)
              .filter(Boolean)
              .map(({ label, value }: any) => {
                // map our known labels to step+field buckets
                const map: Record<string, { stepKey: string; fieldKey: string }> = {
                  'System': { stepKey: 'sistemConstructiv', fieldKey: 'tipSistem' },
                  'Baustellenzufahrt': { stepKey: 'sistemConstructiv', fieldKey: 'accesSantier' },
                  'Fundament': { stepKey: 'sistemConstructiv', fieldKey: 'tipFundatie' },
                  'Dachtyp': { stepKey: 'sistemConstructiv', fieldKey: 'tipAcoperis' },
                  'Dachdeckung': { stepKey: 'daemmungDachdeckung', fieldKey: 'dachdeckung' },
                  'Dachstuhl': { stepKey: 'daemmungDachdeckung', fieldKey: 'dachstuhlTyp' },
                  'Angebotsumfang': { stepKey: 'materialeFinisaj', fieldKey: 'nivelOferta' },
                  'Fassade': { stepKey: 'materialeFinisaj', fieldKey: 'fatada' },
                  'Fenster': { stepKey: 'materialeFinisaj', fieldKey: 'tamplarie' },
                  'Innenausbau': { stepKey: 'materialeFinisaj', fieldKey: 'finisajInterior' },
                  'Dachmaterial': { stepKey: 'materialeFinisaj', fieldKey: 'materialAcoperis' },
                  'Heizung': { stepKey: 'performanta', fieldKey: 'tipIncalzire' },
                  'Energie': { stepKey: 'performanta', fieldKey: 'nivelEnergetic' },
                  'Gelände': { stepKey: 'logistica', fieldKey: 'teren' },
                  'Zufahrt': { stepKey: 'logistica', fieldKey: 'accesSantier' },
                }
                const m = map[label] ?? { stepKey: 'other', fieldKey: label }
                const fieldLabel = ADMIN_FIELD_LABELS_DE[m.fieldKey] ?? label
                return { stepKey: m.stepKey, fieldKey: m.fieldKey, label: fieldLabel, value: toDeOption(value) }
              })

            // Build ALL steps from raw steps (preferred), falling back to derived rows.
            const settingsRaw = (o.settings_raw ?? null) as Record<string, any> | null
            const allStepKeys = settingsRaw ? Object.keys(settingsRaw) : []
            const FORM_ORDER = ['dateGenerale','client','sistemConstructiv','structuraCladirii','daemmungDachdeckung','ferestreUsi','materialeFinisaj','performanta','performantaEnergetica','logistica','conditiiSantier','upload']
            const stepKeys = (allStepKeys.length ? allStepKeys : FORM_ORDER)
              .slice()
              .sort((a, b) => {
                const ia = FORM_ORDER.indexOf(a); const ib = FORM_ORDER.indexOf(b)
                if (ia === -1 && ib === -1) return a.localeCompare(b)
                if (ia === -1) return 1
                if (ib === -1) return -1
                return ia - ib
              })

            const price = formatPriceEUR(o.total_price)
            const assets = assetsByOffer[o.id]
            return (
              <div
                key={o.id}
                onClick={() => {
                  setSelectedOfferId(o.id)
                  window.dispatchEvent(new CustomEvent('offer:selected', { detail: { offerId: o.id } }))
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setSelectedOfferId(o.id)
                    window.dispatchEvent(new CustomEvent('offer:selected', { detail: { offerId: o.id } }))
                  }
                }}
                className={[
                  'w-full text-left rounded-xl border border-black/40',
                  'bg-coffee-700 backdrop-blur-sm',
                  'p-4 shadow-soft transition h-full flex flex-col',
                  'hover:bg-coffee-600 hover:border-[#E5B800]/25 cursor-pointer',
                  active ? 'ring-2 ring-[#E5B800]/40 bg-coffee-600' : '',
                ].join(' ')}
                title={o.id}
              >
                {/* Header: title + price */}
                <div className="flex items-start justify-between gap-2 mb-3 pb-2 border-b border-white/15">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-[14px] text-white/85 truncate leading-tight">{display}</div>
                    <div className="mt-0.5 text-[11px] text-white/65 leading-tight">{fmtDate(o.created_at)}</div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {price ? (
                      <div className="text-[13px] font-bold text-[#F5D030]">
                        {price}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        if (!processingImages[o.id]) {
                          try {
                            const res = await apiFetch(`/admin/offers/${o.id}/processing-images`)
                            setProcessingImages(prev => ({ ...prev, [o.id]: res }))
                          } catch (err) {
                            console.error('Failed to load processing images:', err)
                          }
                        }
                        setProcessingModal(o.id)
                      }}
                      className="px-2 py-1 text-[10px] rounded border border-[#E5B800]/25 bg-[#E5B800]/12 hover:bg-[#E5B800]/18 text-[#F5D030] font-medium transition-colors"
                      title="Verarbeitungsdetails anzeigen"
                    >
                      Details
                    </button>
                  </div>
                </div>

                {/* Content: steps/chips on left, previews on right */}
                <div className="flex-1 flex gap-2 min-h-0">
                  {/* Left: Steps with chips */}
                  <div className="flex-1 min-w-0">
                    {stepKeys.length ? (
                      <div className="space-y-1">
                        {stepKeys.map((stepKey) => {
                          const stepData = settingsRaw ? (settingsRaw[stepKey] ?? {}) : {}
                          const entries = stepData && typeof stepData === 'object' ? Object.entries(stepData) : []
                          const chips = entries
                            .filter(([_, v]) => v !== null && v !== undefined && String(v).trim?.() !== '')
                            .slice(0, 4)
                            .map(([k, v]) => ({
                              label: ADMIN_FIELD_LABELS_DE[k] ?? k,
                              value: toDeOption(v),
                            }))
                          if (!chips.length && !entries.length) return null
                          return (
                            <div key={stepKey} className="p-1">
                              <div className="text-[9px] font-semibold text-white/75 truncate leading-tight mb-1">
                                {ADMIN_STEP_LABELS_DE[stepKey] ?? stepKey}
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {chips.map((c, i) => (
                                  <span
                                    key={i}
                                    className="max-w-full truncate px-1.5 py-0.5 rounded text-[8px] border border-[#E5B800]/25 bg-[#E5B800]/12 text-[#F5D030] leading-tight"
                                    title={`${c.label}: ${c.value}`}
                                  >
                                    {c.value}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>

                  {/* Right: Portrait previews stacked */}
                  <div className="shrink-0 flex flex-col gap-2.5">
                    {assets?.loading ? (
                      <div className="w-[120px] h-[160px] rounded-lg border border-white/15 bg-[#1A1A1A] flex items-center justify-center">
                        <span className="text-[9px] text-white/50">Lädt...</span>
                      </div>
                    ) : assets?.planUrl ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setLightbox({ kind: 'plan', url: assets.planUrl!, mime: assets.planMime ?? null })
                        }}
                        className="w-[120px] h-[160px] rounded-lg overflow-hidden border border-white/15 bg-[#1A1A1A] shadow-sm hover:border-[#E5B800]/25 transition relative group"
                        title="Plan"
                      >
                        {String(assets.planMime || '').includes('pdf') ? (
                          <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-white/70">
                            <svg className="w-10 h-10 text-caramel/80" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                            </svg>
                            <div className="text-[9px] font-medium">Plan PDF</div>
                          </div>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img 
                            src={assets.planUrl} 
                            alt="Plan" 
                            className="w-full h-full object-contain bg-white/5" 
                            loading="lazy"
                            decoding="async"
                            onError={(e) => {
                              const target = e.currentTarget
                              target.style.display = 'none'
                              const parent = target.parentElement
                              if (parent && !parent.querySelector('.error-placeholder')) {
                                const placeholder = document.createElement('div')
                                placeholder.className = 'error-placeholder w-full h-full flex items-center justify-center text-[9px] text-white/30'
                                placeholder.textContent = 'Fehler'
                                parent.appendChild(placeholder)
                              }
                            }} 
                          />
                        )}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />
                      </button>
                      ) : (
                      <div className="w-[120px] h-[160px] rounded-lg border border-white/15 bg-[#1A1A1A] flex items-center justify-center">
                        <span className="text-[9px] text-white/50">Kein Plan</span>
                      </div>
                    )}

                    {assets?.pdfUrl ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setLightbox({ kind: 'pdf', url: assets.pdfUrl! })
                        }}
                        className="w-[120px] h-[160px] rounded-lg overflow-hidden border border-white/15 bg-white shadow-sm hover:border-[#E5B800]/25 transition relative group"
                        title="PDF (User)"
                      >
                        <PdfThumbnail src={assets.pdfUrl} width={120} height={160} className="w-full h-full" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors pointer-events-none" />
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-[8px] px-1 py-0.5 text-white/90">User PDF</div>
                      </button>
                    ) : assets?.loading ? (
                      <div className="w-[120px] h-[160px] rounded-lg border border-white/15 bg-[#1A1A1A] flex items-center justify-center">
                        <span className="text-[9px] text-white/50">Lädt...</span>
                      </div>
                    ) : (
                      <div className="w-[120px] h-[160px] rounded-lg border border-white/15 bg-[#1A1A1A] flex items-center justify-center">
                        <span className="text-[9px] text-white/50">Kein PDF</span>
                      </div>
                    )}
                    {assets?.adminPdfUrl ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setLightbox({ kind: 'pdf', url: assets.adminPdfUrl! })
                        }}
                        className="w-[120px] h-[160px] rounded-lg overflow-hidden border border-caramel/50 hover:border-caramel/80 transition relative group bg-white shadow-sm"
                        title="Admin PDF (Raw Data)"
                      >
                        <PdfThumbnail src={assets.adminPdfUrl} width={120} height={160} className="w-full h-full" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors pointer-events-none" />
                        <div className="absolute bottom-0 left-0 right-0 bg-caramel/90 text-[8px] px-1 py-0.5 text-white font-semibold">Admin PDF</div>
                      </button>
                    ) : null}
                    {assets?.calculationMethodPdfUrl ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setLightbox({ kind: 'pdf', url: assets.calculationMethodPdfUrl! })
                        }}
                        className="w-[120px] h-[160px] rounded-lg overflow-hidden border border-coffee-500/50 hover:border-coffee-500/80 transition relative group bg-white shadow-sm"
                        title="Calculation Method PDF (English)"
                      >
                        <PdfThumbnail src={assets.calculationMethodPdfUrl} width={120} height={160} className="w-full h-full" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors pointer-events-none" />
                        <div className="absolute bottom-0 left-0 right-0 bg-coffee-600/90 text-[8px] px-1 py-0.5 text-white font-semibold">Calc Method</div>
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })}
          </div>
        </div>
      </main>
    </div>

      {/* Processing Images Modal */}
      {processingModal ? (
        <div
          className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setProcessingModal(null)}
        >
          <div
            className="w-full max-w-5xl max-h-[90vh] bg-[#1A1A1A]/95 backdrop-blur-sm rounded-2xl overflow-hidden border border-white/15 shadow-soft flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-12 px-4 flex items-center justify-between bg-[#1A1A1A]/60 border-b border-white/15 shrink-0">
              <div className="text-sm font-semibold text-white/85">Verarbeitungsdetails</div>
              <button
                className="text-white/80 text-lg px-3 py-1 rounded hover:bg-white/10"
                onClick={() => setProcessingModal(null)}
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-8 processing-modal-scroll">
              {processingImages[processingModal] ? (
                (() => {
                  // Organizează pozele în secțiuni structurate
                  const organized: Record<string, {
                    title: string;
                    description?: string;
                    images: Array<{ id: string; url: string; filename: string; plan_id?: string }>;
                    order: number;
                  }> = {};

                  // Procesează fiecare tip de imagine
                  Object.entries(processingImages[processingModal]).forEach(([kind, images]) => {
                    if (!images || images.length === 0) return;

                    if (kind === 'cubicasa_step') {
                      // Organizează cubicasa steps în categorii
                      images.forEach((img) => {
                        const filename = img.filename.toLowerCase();
                        let category = 'other';
                        let title = 'Alte Pași CubiCasa';
                        let description = '';
                        let order = 999;

                        // Detectare pereți
                        if (filename.includes('01_ai_walls') || filename.includes('walls_raw')) {
                          category = 'walls_raw';
                          title = '1. Detectare Pereți (AI)';
                          description = 'Detectare inițială a pereților';
                          order = 1;
                        } else if (filename.includes('01a_walls_filtered') || filename.includes('walls_filtered')) {
                          category = 'walls_filtered';
                          title = '1a. Filtrare Pereți';
                          description = 'Pereți filtrați';
                          order = 2;
                        } else if (filename.includes('01b_walls_closed') || filename.includes('walls_closed')) {
                          category = 'walls_closed';
                          title = '1b. Închidere Pereți';
                          description = 'Pereți cu goluri închise';
                          order = 3;
                        } else if (filename.includes('01c_ai_walls_thinned') || filename.includes('walls_thinned')) {
                          category = 'walls_thinned';
                          title = '1c. Subțiere Pereți';
                          description = 'Pereți subțiați';
                          order = 4;
                        } else if (filename.includes('02_ai_walls_closed') || filename.includes('walls_closed_final')) {
                          category = 'walls_closed_final';
                          title = '2. Pereți Închiși Finali';
                          description = 'Pereți după procesare completă';
                          order = 5;
                        } else if (filename.includes('02c_wall_closures') || filename.includes('wall_closures')) {
                          category = 'wall_closures';
                          title = '2c. Vizualizare Închideri';
                          description = 'Vizualizare camere detectate';
                          order = 6;
                        } else if (filename.includes('02d_walls_closed_overlay') || filename.includes('overlay')) {
                          category = 'overlay';
                          title = '2d. Overlay Pereți';
                          description = 'Overlay pereți pe plan original';
                          order = 7;
                        }
                        // Detectare terasa
                        else if (filename.includes('02g') || filename.includes('terrace') || filename.includes('terasa')) {
                          if (filename.includes('00_preprocessed')) {
                            category = 'terrace_preprocessed';
                            title = '3a. Terasa - Preprocesare';
                            description = 'Imagine preprocesată pentru OCR';
                            order = 10;
                          } else if (filename.includes('01_ocr_result') || filename.includes('ocr_result')) {
                            category = 'terrace_ocr';
                            title = '3b. Terasa - Rezultate OCR';
                            description = 'Toate detecțiile OCR';
                            order = 11;
                          } else if (filename.includes('01b_accepted_detections') || filename.includes('accepted')) {
                            category = 'terrace_accepted';
                            title = '3c. Terasa - Detecții Acceptate';
                            description = 'Detecții acceptate pentru terasa';
                            order = 12;
                          } else if (filename.includes('01c_best_detection_with_fill')) {
                            category = 'terrace_best';
                            title = '3d. Terasa - Cea Mai Bună Detecție + Flood Fill';
                            description = 'Detecția cu cel mai mare procent + flood fill';
                            order = 13;
                          } else if (filename.includes('02c_flood_fill_attempt')) {
                            category = 'terrace_flood_fill';
                            title = '3e. Terasa - Tentative Flood Fill';
                            description = 'Toate tentativele de flood fill';
                            order = 14;
                          } else if (filename.includes('02_terrace_fill') || filename.includes('terrace_fill')) {
                            category = 'terrace_fill_result';
                            title = '3f. Terasa - Rezultat Final';
                            description = 'Rezultat final după flood fill';
                            order = 15;
                          } else if (filename.includes('03_final_result')) {
                            category = 'terrace_final';
                            title = '3g. Terasa - Rezultat Final';
                            description = 'Pereți noi adăugați pentru terasa';
                            order = 16;
                          } else {
                            category = 'terrace_other';
                            title = '3h. Terasa - Alte Pași';
                            description = 'Alți pași pentru terasa';
                            order = 17;
                          }
                        }
                        // Detectare garaje
                        else if (filename.includes('02h') || filename.includes('garage') || filename.includes('carport')) {
                          if (filename.includes('00_preprocessed')) {
                            category = 'garage_preprocessed';
                            title = '4a. Garaje - Preprocesare';
                            description = 'Imagine preprocesată pentru OCR';
                            order = 20;
                          } else if (filename.includes('01_ocr_result') || filename.includes('ocr_result')) {
                            category = 'garage_ocr';
                            title = '4b. Garaje - Rezultate OCR';
                            description = 'Toate detecțiile OCR';
                            order = 21;
                          } else if (filename.includes('01b_accepted_detections') || filename.includes('accepted')) {
                            category = 'garage_accepted';
                            title = '4c. Garaje - Detecții Acceptate';
                            description = 'Detecții acceptate pentru garaje';
                            order = 22;
                          } else if (filename.includes('01c_best_detection_with_fill')) {
                            category = 'garage_best';
                            title = '4d. Garaje - Cea Mai Bună Detecție + Flood Fill';
                            description = 'Detecția cu cel mai mare procent + flood fill';
                            order = 23;
                          } else if (filename.includes('02c_flood_fill_attempt')) {
                            category = 'garage_flood_fill';
                            title = '4e. Garaje - Tentative Flood Fill';
                            description = 'Toate tentativele de flood fill';
                            order = 24;
                          } else if (filename.includes('02_garage_fill') || filename.includes('garage_fill')) {
                            category = 'garage_fill_result';
                            title = '4f. Garaje - Rezultat Final';
                            description = 'Rezultat final după flood fill';
                            order = 25;
                          } else if (filename.includes('03_final_result')) {
                            category = 'garage_final';
                            title = '4g. Garaje - Rezultat Final';
                            description = 'Pereți noi adăugați pentru garaje';
                            order = 26;
                          } else {
                            category = 'garage_other';
                            title = '4h. Garaje - Alte Pași';
                            description = 'Alți pași pentru garaje';
                            order = 27;
                          }
                        }
                        // Detectare scări
                        else if (filename.includes('02i') || filename.includes('stairs') || filename.includes('scara')) {
                          if (filename.includes('02_stairs_reconstruction') || filename.includes('reconstruction')) {
                            category = 'stairs_reconstruction';
                            title = '5a. Scări - Reconstruire Pereți';
                            description = 'Reconstruire pereți în jurul scărilor';
                            order = 30;
                          } else if (filename.includes('02c_flood_fill_attempt')) {
                            category = 'stairs_flood_fill';
                            title = '5b. Scări - Tentative Flood Fill';
                            description = 'Toate tentativele de flood fill';
                            order = 31;
                          } else if (filename.includes('03_final_result')) {
                            category = 'stairs_final';
                            title = '5c. Scări - Rezultat Final';
                            description = 'Pereți noi adăugați pentru scări';
                            order = 32;
                          } else {
                            category = 'stairs_other';
                            title = '5d. Scări - Alte Pași';
                            description = 'Alți pași pentru scări';
                            order = 33;
                          }
                        }
                        // Alte pași
                        else {
                          category = 'other';
                          title = 'Alte Pași CubiCasa';
                          description = 'Pași de procesare suplimentari';
                          order = 999;
                        }

                        if (!organized[category]) {
                          organized[category] = {
                            title,
                            description,
                            images: [],
                            order,
                          };
                        }
                        organized[category].images.push(img);
                      });
                    } else {
                      // Pentru alte tipuri de imagini (cluster, visualization, etc.)
                      const kindLabels: Record<string, { title: string; description: string; order: number }> = {
                        cluster: {
                          title: 'Cluster Images',
                          description: 'Imagini de cluster',
                          order: 100,
                        },
                        cluster_preview: {
                          title: 'Cluster Preview',
                          description: 'Preview-uri de cluster',
                          order: 101,
                        },
                        visualization: {
                          title: 'Visualizări',
                          description: 'Visualizări 3D și overlay-uri',
                          order: 102,
                        },
                        roof: {
                          title: 'Acoperiș',
                          description: 'Vizualizare 3D a acoperișului casei',
                          order: 103,
                        },
                      };

                      const config = kindLabels[kind] || {
                        title: kind,
                        description: '',
                        order: 999,
                      };

                      if (!organized[kind]) {
                        organized[kind] = {
                          title: config.title,
                          description: config.description,
                          images: [],
                          order: config.order,
                        };
                      }
                      organized[kind].images.push(...images);
                    }
                  });

                  // Sortează secțiunile după order
                  const sortedSections = Object.entries(organized)
                    .sort(([, a], [, b]) => a.order - b.order)
                    .filter(([, section]) => section.images.length > 0);

                  if (sortedSections.length === 0) {
                    return <div className="text-sm text-white/60 text-center py-8">Keine Bilder gefunden</div>;
                  }

                  return sortedSections.map(([key, section]) => (
                    <div key={key} className="space-y-3">
                      <div className="space-y-1">
                        <div className="text-sm font-semibold text-white/90">
                          {section.title}
                        </div>
                        {section.description && (
                          <div className="text-xs text-white/60">
                            {section.description}
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {section.images.map((img) => (
                          <div
                            key={img.id}
                            className="relative rounded-lg overflow-hidden border border-white/15 bg-[#1A1A1A] hover:border-[#E5B800]/25 transition cursor-pointer group"
                            onClick={() => {
                              setLightbox({ kind: 'plan', url: img.url, mime: null });
                            }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={img.url}
                              alt={img.filename}
                              className="w-full h-auto object-contain bg-white/5 group-hover:opacity-90 transition"
                              loading="lazy"
                              decoding="async"
                            />
                            {img.plan_id ? (
                              <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[9px] bg-black/60 text-white/80">
                                {img.plan_id}
                              </div>
                            ) : null}
                            <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-black/70 text-[9px] text-white/80 truncate">
                              {img.filename}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ));
                })()
              ) : (
                <div className="text-sm text-white/60 text-center py-8">Lädt...</div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Lightbox */}
      {lightbox ? (
        <div
          className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div
            className="w-full max-w-6xl h-[85vh] bg-black/20 rounded-2xl overflow-hidden border border-white/10 shadow-soft"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-10 px-3 flex items-center justify-between bg-black/30 border-b border-white/10">
              <div className="text-xs text-white/80 uppercase tracking-wide">{lightbox.kind}</div>
              <button
                className="text-white/80 text-sm px-2 py-1 rounded hover:bg-white/10"
                onClick={() => setLightbox(null)}
              >
                Close
              </button>
            </div>
            <div className="w-full h-[calc(85vh-2.5rem)] bg-black/10">
              {lightbox.kind === 'plan' && !String(lightbox.mime || '').includes('pdf') ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={lightbox.url} alt="Plan" className="w-full h-full object-contain bg-black/10" />
              ) : (
                <div className="w-full h-full bg-black/5">
                  <SimplePdfViewer src={lightbox.url} maxHeight="calc(85vh - 2.5rem)" className="w-full h-full" />
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <style jsx global>{`
        .processing-modal-scroll {
          scrollbar-width: thin;
          scrollbar-color: #E5B800 #141414;
        }
        .processing-modal-scroll::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        .processing-modal-scroll::-webkit-scrollbar-track {
          background: #141414;
          border-radius: 8px;
        }
        .processing-modal-scroll::-webkit-scrollbar-thumb {
          background: #E5B800;
          border-radius: 8px;
          border: 2px solid #141414;
        }
        .processing-modal-scroll::-webkit-scrollbar-thumb:hover {
          background: #F5D030;
        }
      `}</style>
    </>
  )
}


