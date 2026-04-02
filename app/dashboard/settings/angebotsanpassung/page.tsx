'use client'

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Save, Loader2, CheckCircle2, AlertCircle, Upload } from 'lucide-react'
import { apiFetch, supabase } from '../../../lib/supabaseClient'
import SimplePdfViewer from '../../../components/SimplePdfViewer'
import { normalizeDisplayCurrency } from '../../../../lib/displayCurrency'

type VatPreset = 'DE' | 'AT' | 'CH' | 'custom'

type CompanyInfo = {
  companyName: string
  companyAddress: string
  email: string
  phone: string
  fax: string
  website: string
  logoUrl: string
  offerPrefix: string
  handlerName: string
  footerLeft: string
  footerMid: string
  footerRight: string
  section1Title: string
  section1Content: string
  section2Title: string
  section2Content: string
  displayCurrency: 'EUR' | 'CHF'
  vatPreset: VatPreset
  vatCustomPercent: number
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function OfferPdfPreview({
  pdfUrl,
  loading,
  error,
}: {
  pdfUrl: string | null
  loading: boolean
  error: string | null
}) {
  return (
    <div className="flex flex-col gap-0">
      {error ? (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {error}
        </div>
      ) : pdfUrl ? (
        <SimplePdfViewer src={pdfUrl} maxHeight="none" className="pretty-scroll min-h-[56vh]" singlePageMode pixelRatio={2} />
      ) : (
        <div className="py-24 text-center text-sm text-white/70">
          {loading ? 'PDF wird generiert…' : 'Noch keine Vorschau verfügbar.'}
        </div>
      )}
    </div>
  )
}

export default function OfferCustomizationPage() {
  const router = useRouter()
  const currentOfferIdRef = useRef<string | null>(null)
  const [ready, setReady] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo>({
    companyName: '',
    companyAddress: '',
    email: '',
    phone: '',
    fax: '',
    website: '',
    logoUrl: '',
    offerPrefix: '',
    handlerName: '',
    footerLeft: '',
    footerMid: '',
    footerRight: '',
    section1Title: '',
    section1Content: '',
    section2Title: '',
    section2Content: '',
    displayCurrency: 'EUR',
    vatPreset: 'DE',
    vatCustomPercent: 19,
  })
  const [currencyModalOpen, setCurrencyModalOpen] = useState(false)
  const [pendingCurrency, setPendingCurrency] = useState<'EUR' | 'CHF' | null>(null)
  const [companyInfoSaving, setCompanyInfoSaving] = useState(false)
  const [companyInfoMessage, setCompanyInfoMessage] = useState<'success' | 'error' | null>(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const me = await apiFetch('/me') as { user?: { role?: string; can_manage_org?: boolean } }
        const role = me?.user?.role
        const canManageOrg = me?.user?.can_manage_org === true
        const canSeeOrgSettings = role === 'org_leader' || canManageOrg
        if (!cancelled) {
          setIsAdmin(canSeeOrgSettings)
          if (!canSeeOrgSettings) {
            router.replace('/dashboard')
            return
          }
        }

        const config = await apiFetch('/tenant-config').catch(() => null)
        if (!cancelled && config && typeof config === 'object') {
          const c = config as CompanyInfo & { vatPreset?: string; vatCustomPercent?: number }
          const vp =
            c.vatPreset === 'CH' || c.vatPreset === 'AT' || c.vatPreset === 'custom' ? c.vatPreset : 'DE'
          setCompanyInfo({
            companyName: c.companyName ?? '',
            companyAddress: c.companyAddress ?? '',
            email: c.email ?? '',
            phone: c.phone ?? '',
            fax: c.fax ?? '',
            website: c.website ?? '',
            logoUrl: c.logoUrl ?? '',
            offerPrefix: c.offerPrefix ?? '',
            handlerName: c.handlerName ?? '',
            footerLeft: c.footerLeft ?? '',
            footerMid: c.footerMid ?? '',
            footerRight: c.footerRight ?? '',
            section1Title: c.section1Title ?? '',
            section1Content: c.section1Content ?? '',
            section2Title: c.section2Title ?? '',
            section2Content: c.section2Content ?? '',
            displayCurrency: normalizeDisplayCurrency(c.displayCurrency),
            vatPreset: vp,
            vatCustomPercent:
              typeof c.vatCustomPercent === 'number' && Number.isFinite(c.vatCustomPercent)
                ? c.vatCustomPercent
                : vp === 'CH'
                  ? 8.1
                  : vp === 'AT'
                    ? 20
                    : 19,
          })
        }
      } catch {
        if (!cancelled) router.replace('/dashboard')
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => { cancelled = true }
  }, [router])

  const handleSaveCompanyInfo = async () => {
    setCompanyInfoSaving(true)
    setCompanyInfoMessage(null)
    try {
      await apiFetch('/tenant-config', {
        method: 'PATCH',
        body: JSON.stringify({
          companyName: companyInfo.companyName.trim(),
          companyAddress: companyInfo.companyAddress.trim(),
          email: companyInfo.email.trim(),
          phone: companyInfo.phone.trim(),
          fax: companyInfo.fax.trim(),
          website: companyInfo.website.trim(),
          offerPrefix: companyInfo.offerPrefix.trim(),
          handlerName: companyInfo.handlerName.trim(),
          section1Title: companyInfo.section1Title.trim(),
          section1Content: companyInfo.section1Content,
          footerLeft: companyInfo.footerLeft,
          footerMid: companyInfo.footerMid,
          footerRight: companyInfo.footerRight,
          section2Title: companyInfo.section2Title.trim(),
          section2Content: companyInfo.section2Content,
          displayCurrency: companyInfo.displayCurrency,
          vatPreset: companyInfo.vatPreset,
          vatCustomPercent: companyInfo.vatCustomPercent,
        }),
      })
      setCompanyInfoMessage('success')
      setTimeout(() => setCompanyInfoMessage(null), 3000)
      window.dispatchEvent(new CustomEvent('tenant-config:saved'))
    } catch {
      setCompanyInfoMessage('error')
    } finally {
      setCompanyInfoSaving(false)
    }
  }

  const handleLogoChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    setLogoUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = (await apiFetch('/tenant-config/logo', {
        method: 'POST',
        body: form,
        headers: {},
      })) as { logoUrl?: string }
      if (res?.logoUrl) {
        setCompanyInfo((prev) => ({ ...prev, logoUrl: res.logoUrl! }))
        setCompanyInfoMessage('success')
        setTimeout(() => setCompanyInfoMessage(null), 3000)
        window.dispatchEvent(new CustomEvent('tenant-config:saved'))
      }
    } catch {
      setCompanyInfoMessage('error')
    } finally {
      setLogoUploading(false)
      e.target.value = ''
      if (logoInputRef.current) logoInputRef.current.value = ''
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = sessionStorage.getItem('holzbot_dashboard_offer')
      if (!raw) return
      const data = JSON.parse(raw) as { offerId?: string | null }
      currentOfferIdRef.current = data?.offerId ? String(data.offerId) : null
    } catch {
      currentOfferIdRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!ready || !isAdmin) return
    const controller = new AbortController()
    const timeoutId = window.setTimeout(async () => {
      setPreviewLoading(true)
      setPreviewError(null)
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token
        const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'
        const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base
        const path = '/tenant-config/pdf-preview'
        const finalPath = cleanBase.includes('api.holzbot.com') ? `/api${path}` : path

        const response = await fetch(`${cleanBase}${finalPath}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: 'include',
          body: JSON.stringify({
            ...companyInfo,
            offerId: currentOfferIdRef.current,
          }),
          signal: controller.signal,
        })

        if (!response.ok) throw new Error(await response.text())

        const blob = await response.blob()
        const nextUrl = URL.createObjectURL(blob)
        setPreviewPdfUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev)
          return nextUrl
        })
      } catch (error: unknown) {
        if (controller.signal.aborted) return
        const message = getErrorMessage(error, 'Preview konnte nicht generiert werden.')
        setPreviewError(
          message.includes('cel putin o oferta')
            ? 'Pentru acest cont nu exista inca nicio oferta. Genereaza mai intai o oferta, apoi preview-ul va folosi ultima oferta ca baza.'
            : message,
        )
        setPreviewPdfUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev)
          return null
        })
      } finally {
        if (!controller.signal.aborted) setPreviewLoading(false)
      }
    }, 700)

    return () => {
      controller.abort()
      window.clearTimeout(timeoutId)
    }
  }, [companyInfo, isAdmin, ready])

  useEffect(() => {
    return () => {
      if (previewPdfUrl) URL.revokeObjectURL(previewPdfUrl)
    }
  }, [previewPdfUrl])

  if (!ready || !isAdmin) return null

  return (
    <>
      {currencyModalOpen && pendingCurrency ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="currency-modal-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-[#E5B800]/40 bg-[#1e1812] p-6 shadow-xl">
            <h3 id="currency-modal-title" className="text-lg font-bold text-[#E5B800] mb-2">
              Währung wechseln?
            </h3>
            <p className="text-white/85 text-sm leading-relaxed mb-6">
              Sie sind dabei, die Anzeigewährung auf{' '}
              <strong className="text-white">{pendingCurrency === 'CHF' ? 'CHF' : 'EUR'}</strong> zu ändern. Preisangaben
              in der Anwendung und in PDF-Angeboten werden mit der neuen Währung gekennzeichnet; es findet{' '}
              <strong className="text-white">keine automatische Umrechnung</strong> der Zahlenwerte statt. Möchten Sie
              fortfahren?
            </p>
            <div className="flex flex-wrap gap-3 justify-end">
              <button
                type="button"
                className="px-4 py-2 rounded-xl border border-white/20 text-white/90 text-sm hover:bg-white/10"
                onClick={() => {
                  setCurrencyModalOpen(false)
                  setPendingCurrency(null)
                }}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-xl font-semibold bg-[#E5B800] hover:bg-[#cda500] text-white text-sm"
                onClick={() => {
                  setCompanyInfo((p) => ({ ...p, displayCurrency: pendingCurrency }))
                  setCurrencyModalOpen(false)
                  setPendingCurrency(null)
                }}
              >
                Ja, Währung ändern
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <style
        dangerouslySetInnerHTML={{
          __html: `
.preisdatenbank-scroll {
  overflow-y: scroll !important;
  overflow-x: auto !important;
  scrollbar-width: thin !important;
  scrollbar-color: #E5B800 transparent !important;
}
.preisdatenbank-scroll::-webkit-scrollbar {
  width: 10px !important;
  height: 10px !important;
}
.preisdatenbank-scroll::-webkit-scrollbar-track {
  background: transparent !important;
}
.preisdatenbank-scroll::-webkit-scrollbar-thumb {
  background: #E5B800 !important;
  border-radius: 9999px !important;
  border: 2px solid transparent !important;
  background-clip: padding-box !important;
  min-height: 40px !important;
}
`,
        }}
      />
      <div className="h-full flex flex-col min-h-0">
        <div className="preisdatenbank-scroll px-4 py-4 md:px-5 md:py-5 w-full flex-1 min-h-0 overflow-y-auto">
          <div className="w-full max-w-[1600px] mx-auto">
            <h1 className="text-2xl md:text-3xl font-bold text-white mb-2 text-center">Angebotsanpassung</h1>
            <p className="text-sand/80 text-base mb-6 text-center">PDF-Inhalte und Vorschau der Offer verwalten.</p>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.06fr)_minmax(560px,1.34fr)] gap-6 items-start w-full">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 md:p-6">
                <h2 className="text-xl font-bold text-[#E5B800] mb-1">Angebotsdaten</h2>
                <p className="text-white/80 text-sm mb-4">Diese Angaben erscheinen im PDF-Angebot.</p>
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-sun/90">Logo Upload</label>
                      <div className="flex items-center gap-4 mt-1">
                        <div className="w-20 h-20 rounded-lg border border-white/20 bg-white/5 flex items-center justify-center overflow-hidden shrink-0">
                          {companyInfo.logoUrl ? (
                            <img src={companyInfo.logoUrl} alt="Logo" className="w-full h-full object-contain" />
                          ) : (
                            <Upload className="w-8 h-8 text-sand/50" />
                          )}
                        </div>
                        <div>
                          <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
                          <button type="button" disabled={logoUploading} onClick={() => logoInputRef.current?.click()} className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm">
                            {logoUploading ? 'Wird hochgeladen…' : 'Logo auswählen'}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-sun/90">Firmenname</label>
                      <input type="text" value={companyInfo.companyName} onChange={(e) => setCompanyInfo((p) => ({ ...p, companyName: e.target.value }))} className="sun-input w-full mt-1" />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-sun/90">Firmenadresse</label>
                    <textarea value={companyInfo.companyAddress} onChange={(e) => setCompanyInfo((p) => ({ ...p, companyAddress: e.target.value }))} className="sun-input w-full min-h-[80px] mt-1" rows={2} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="text-sm font-medium text-sun/90">E-Mail</label>
                      <input type="email" value={companyInfo.email} onChange={(e) => setCompanyInfo((p) => ({ ...p, email: e.target.value }))} className="sun-input w-full mt-1" />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-sun/90">Telefon</label>
                      <input type="tel" value={companyInfo.phone} onChange={(e) => setCompanyInfo((p) => ({ ...p, phone: e.target.value }))} className="sun-input w-full mt-1" />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-sun/90">Fax</label>
                      <input type="tel" value={companyInfo.fax} onChange={(e) => setCompanyInfo((p) => ({ ...p, fax: e.target.value }))} className="sun-input w-full mt-1" />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-sun/90">Website</label>
                    <input type="url" value={companyInfo.website} onChange={(e) => setCompanyInfo((p) => ({ ...p, website: e.target.value }))} className="sun-input w-full mt-1" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-sun/90">Währung</label>
                      <select
                        className="sun-input w-full mt-1"
                        value={companyInfo.displayCurrency}
                        onChange={(e) => {
                          const next = e.target.value === 'CHF' ? 'CHF' : 'EUR'
                          if (next === companyInfo.displayCurrency) return
                          setPendingCurrency(next)
                          setCurrencyModalOpen(true)
                        }}
                      >
                        <option value="EUR">EUR (€)</option>
                        <option value="CHF">CHF</option>
                      </select>
                      <p className="text-xs text-white/55 mt-1">Anzeige für Beträge (ohne Wechselkurs-Umrechnung).</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-sun/90">MwSt.-Satz</label>
                      <select
                        className="sun-input w-full mt-1"
                        value={companyInfo.vatPreset}
                        onChange={(e) => {
                          const v = e.target.value
                          const preset: VatPreset =
                            v === 'CH' || v === 'AT' || v === 'custom' ? v : 'DE'
                          setCompanyInfo((p) => ({
                            ...p,
                            vatPreset: preset,
                            vatCustomPercent:
                              preset === 'CH' ? 8.1 : preset === 'DE' ? 19 : preset === 'AT' ? 20 : p.vatCustomPercent,
                          }))
                        }}
                      >
                        <option value="DE">Deutschland (19 %)</option>
                        <option value="AT">Österreich (20 %)</option>
                        <option value="CH">Schweiz (8,1 %)</option>
                        <option value="custom">Benutzerdefiniert</option>
                      </select>
                    </div>
                  </div>
                  {companyInfo.vatPreset === 'custom' ? (
                    <div>
                      <label className="text-sm font-medium text-sun/90">Eigener MwSt.-Satz (%)</label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        value={companyInfo.vatCustomPercent}
                        onChange={(e) =>
                          setCompanyInfo((p) => ({ ...p, vatCustomPercent: parseFloat(e.target.value) || 0 }))
                        }
                        className="sun-input w-full max-w-[200px] mt-1"
                      />
                    </div>
                  ) : null}
                  <p className="text-xs text-white/55 -mt-2">
                    Mehrwertsteuer wird auf die Nettosumme im Angebot angewendet und im PDF mit dem gewählten Satz
                    ausgewiesen (Österreich: „20% USt.“).
                  </p>
                  <div>
                    <label className="text-sm font-medium text-sun/90">Angebotskürzel</label>
                    <input
                      type="text"
                      value={companyInfo.offerPrefix}
                      onChange={(e) => setCompanyInfo((p) => ({ ...p, offerPrefix: e.target.value.toUpperCase() }))}
                      className="sun-input w-full mt-1"
                      placeholder="z. B. EDER"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-sun/90">Bearbeiter</label>
                    <input type="text" value={companyInfo.handlerName} onChange={(e) => setCompanyInfo((p) => ({ ...p, handlerName: e.target.value }))} className="sun-input w-full mt-1" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-sun/90">Spalte 1</label>
                    <textarea value={companyInfo.footerLeft} onChange={(e) => setCompanyInfo((p) => ({ ...p, footerLeft: e.target.value }))} className="sun-input w-full min-h-[96px] mt-1" rows={4} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-sun/90">Spalte 2</label>
                      <textarea value={companyInfo.footerMid} onChange={(e) => setCompanyInfo((p) => ({ ...p, footerMid: e.target.value }))} className="sun-input w-full min-h-[96px] mt-1" rows={4} />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-sun/90">Spalte 3</label>
                      <textarea value={companyInfo.footerRight} onChange={(e) => setCompanyInfo((p) => ({ ...p, footerRight: e.target.value }))} className="sun-input w-full min-h-[96px] mt-1" rows={4} />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-sun/90">Abschnitt 1 Titel</label>
                    <input type="text" value={companyInfo.section1Title} onChange={(e) => setCompanyInfo((p) => ({ ...p, section1Title: e.target.value }))} className="sun-input w-full mt-1" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-sun/90">Abschnitt 1 Inhalt</label>
                    <textarea value={companyInfo.section1Content} onChange={(e) => setCompanyInfo((p) => ({ ...p, section1Content: e.target.value }))} className="sun-input w-full min-h-[180px] mt-1" rows={7} />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-sun/90">Abschnitt 2 Titel</label>
                    <input type="text" value={companyInfo.section2Title} onChange={(e) => setCompanyInfo((p) => ({ ...p, section2Title: e.target.value }))} className="sun-input w-full mt-1" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-sun/90">Abschnitt 2 Inhalt</label>
                    <textarea value={companyInfo.section2Content} onChange={(e) => setCompanyInfo((p) => ({ ...p, section2Content: e.target.value }))} className="sun-input w-full min-h-[260px] mt-1" rows={10} />
                  </div>
                  <div className="flex items-center gap-3 pt-2">
                    <button type="button" disabled={companyInfoSaving} onClick={handleSaveCompanyInfo} className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold bg-[#E5B800] hover:bg-[#cda500] text-white disabled:opacity-60">
                      {companyInfoSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                      Angaben speichern
                    </button>
                    {companyInfoMessage === 'success' && <span className="flex items-center gap-1.5 text-orange-400 text-sm"><CheckCircle2 size={18} /> Gespeichert</span>}
                    {companyInfoMessage === 'error' && <span className="flex items-center gap-1.5 text-amber-400 text-sm"><AlertCircle size={18} /> Fehler</span>}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <OfferPdfPreview pdfUrl={previewPdfUrl} loading={previewLoading} error={previewError} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
