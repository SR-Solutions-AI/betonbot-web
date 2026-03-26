'use client'

import { useEffect, useState, useRef } from 'react'
import { Save, Loader2, CheckCircle2, AlertCircle, Trash2, Plus, Pencil } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { apiFetch } from '../../lib/supabaseClient'
import { buildPriceSectionsFromFormStepsJson } from '../../../lib/buildFormFromJson'
import type { PreisdatenbankSection } from '../formConfig'

/** Schema-ul se încarcă după tenant: /api/form-schema?tenant=<slug> (betonbau → Beton/Mauerwerk, holzbau → default). */

const MIN_COL_WIDTH = 260
const GAP_PX = 24
const CONTAINER_PADDING_PX = 48
const CARD_MAX_PX = 300
/** Carduri cu 2 coloane (multe variabile) – lățime mărită. */
const CARD_WIDE_PX = 500

function getStep(unit: string): number {
  if (unit === '€/m²' || unit === '€/m') return 1
  if (unit === '%') return 0.5
  if (unit === 'm') return 0.1
  return 10
}

function isSafariBrowser() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return ua.includes('Safari') && !ua.includes('Chrome')
}

function slugFromLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .slice(0, 40) || 'option'
}

/** Elimină unitatea de măsură de la sfârșitul etichetei (ex. " (€/m²)", " (Faktor)") – afișăm doar numele variabilei. */
function labelWithoutUnit(label: string): string {
  if (!label || typeof label !== 'string') return label
  return label.replace(/\s*\((?:€\/m²|€\/m|€|Faktor!?|Stufe)\)\s*$/i, '').trim() || label
}

function canAddOptionsForFieldTag(fieldTag?: string): boolean {
  return !!fieldTag && fieldTag !== 'foundation_type' && fieldTag !== 'visible_roof_structure_fixed' && fieldTag !== 'haustechnik_basis'
}

function isValueOnlyFieldTag(fieldTag?: string): boolean {
  return fieldTag === 'haustechnik_basis'
}

function isProtectedVariable(id: string): boolean {
  return id === 'tinichigerie_percent' || id === 'roofonly_tinichigerie_percent'
}

function isBlockedOption(variable: { id: string; label: string }): boolean {
  const id = String(variable.id || '').toLowerCase()
  const label = String(variable.label || '').trim().toLowerCase()
  return id.includes('testr') || label === 'testr'
}

/**
 * Subtitluri unice per card (titlul secțiunii).
 * Preisdatenbank = baza de prețuri pentru oferte: utilizatorul setează €/m², factori, pauschal etc. pentru fiecare variantă din formular.
 */
const CARD_SUBTITLES: Record<string, string> = {
  'Systemtyp': 'Blockbau, Holzrahmen, Massivholz – €/m² Innen und Außen',
  'Baustellenzufahrt': 'Leicht, Mittel, Schwierig',
  'Gelände': 'Eben, Leichte oder Starke Hanglage',
  'Strom-/Wasseranschluss': 'Pauschalpreis für Anschlusskosten',
  'Untergeschoss / Fundament': 'Bodenplatte, Keller Nutzkeller oder Ausbau – €/m²',
  'Pfahlgründung': 'Preis €/m² bei Pfahlgründung',
  'Fläche & Treppe': 'Preis pro Stück',
  'Treppe': 'Preis pro Stück',
  'Geschosshöhe': 'Geschosshöhen die Ihr Unternehmen anbietet.',
  'Dämmung': 'Welche Dämmungsarten bieten Sie an?',
  'Unterdach': 'Welche Arten Unterdach bieten Sie an?',
  'Dachstuhl-Typ': 'Welche Dachstuhl-Konstruktionen bieten Sie an?',
  'Sichtdachstuhl': 'Aufschlag €/m² bei Sichtdachstuhl',
  'Dachdeckung': 'Welche Dachdeckungen bieten Sie an?',
  'Fensterart': '3-fach verglast oder Passiv – €/m² Glasfläche',
  'Türhöhe': 'Standard 2 m oder Erhöht 2,2+ m – €/m²',
  'Innenausbau': 'Putz, Holz, Faserzement, Mix – €/m²',
  'Fassade': 'Putz, Holz, Faserzement, Mix – €/m²',
  'Energieniveau': 'Preisaufschläge je nach gewähltem Energiestandard.',
  'Heizungssystem': 'Preisaufschläge je nach ausgewähltem Heizungssystem.',
  'Lüftung / Wärmerückgewinnung': 'Zusatzkosten, wenn eine Lüftungsanlage mit Wärmerückgewinnung gewünscht ist.',
  'Kamin / Ofen': 'Pauschalpreise je nach gewünschter Kamin- oder Ofenlösung.',
  'Kaminabzug': 'Aufpreis für Schornstein je zusätzlichem Stockwerk.',
  'Haustechnik (Basis)': 'Nur Werte anpassen (fixe Positionen: Strom, Abwasser).',
  'Wintergarten': 'Wandpreise anpassen',
  'Balkone': 'Allgemeiner Quadratmeterpreis, Balkonboden + Geländer',
  'Klempnerarbeiten': 'Aufschlag der Klempnerarbeiten zum Dachpreis anpassen',
}

function cardSubtitle(cardTitle: string, _rawSubtitle?: string | null): string {
  return CARD_SUBTITLES[cardTitle] ?? 'Preise anpassen'
}

/** Subtitlu alb pentru fiecare pas de formular (stepKey). */
const STEP_SUBTITLES: Record<string, string> = {
  sistemConstructiv: 'Baustellenzufahrt, Gelände und Anschlüsse',
  structuraCladirii: 'Fundament, Geschosshöhe, Flächen und Treppen',
  daemmungDachdeckung: 'Dämmung, Unterdach, Dachstuhl und Dachdeckung',
  ferestreUsi: 'Fenster, Türen und Glasflächen',
  materialeFinisaj: 'Innenausbau und Fassade',
  performantaEnergetica: 'Preisaufschläge für Energiestandard, Heizung und Haustechnik.',
  projektdaten: 'Parameter für Dachstuhl-Angebote (roof-only)',
}

export default function PreisdatenbankPage() {
  const [activeCatalog, setActiveCatalog] = useState<'neubau' | 'dachstuhl'>('neubau')
  const [ready, setReady] = useState(false)
  const [sections, setSections] = useState<PreisdatenbankSection[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [isSafari, setIsSafari] = useState(false)
  const [scrollThumb, setScrollThumb] = useState({ height: 20, top: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<'success' | 'error' | null>(null)
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null)
  const [deletedKeys, setDeletedKeys] = useState<string[]>([])
  const [addingAt, setAddingAt] = useState<{ sectionIndex: number; subsectionIndex: number } | null>(null)
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null)
  /** Opțiuni noi adăugate aici, trimise la Save ca newOptions (se leagă de field_tag și apar în formular). */
  const [pendingNewOptions, setPendingNewOptions] = useState<
    Array<{ field_tag: string; option_label: string; price: number }>
  >([])
  /** Redenumiri de etichete pentru opțiuni custom (price_key -> option_label), trimise la Save. */
  const [pendingLabelUpdates, setPendingLabelUpdates] = useState<Record<string, string>>({})
  /** Are modificări nesalvate (butonul Save devine galben și activ). */
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragStartY = useRef(0)
  const dragStartScrollTop = useRef(0)
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSaveRef = useRef<Record<string, number>>({})
  /** Doar chei prezente în holzbau-form-steps.json (priceSections.variables[].key) – nimic în plus. */
  const allowedPricingKeysRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(async ({ data, error }) => {
      if (error || !data.session) {
        window.location.href = '/login'
        return
      }
      setReady(true)
      setLoadError(null)
      try {
        const me = (await apiFetch('/me').catch(() => null)) as { tenant?: { slug?: string } } | null
        const tenantSlug = me?.tenant?.slug && typeof me.tenant.slug === 'string' ? me.tenant.slug : 'holzbau'
        let schemaRes = await fetch(`/api/form-schema?tenant=${encodeURIComponent(tenantSlug)}`)
        if (!schemaRes.ok && tenantSlug !== 'holzbau') {
          schemaRes = await fetch('/api/form-schema?tenant=holzbau')
        }
        if (!schemaRes.ok) {
          if (!cancelled) setLoadError('Schema nicht gefunden.')
          return
        }
        const formStepsJson = (await schemaRes.json()) as unknown
        const baseSectionsFromJson = buildPriceSectionsFromFormStepsJson(formStepsJson)
        const allowedKeys = new Set<string>()
        for (const sec of baseSectionsFromJson) {
          for (const sub of sec.subsections) {
            for (const v of sub.variables) allowedKeys.add(v.id)
          }
        }
        if (!cancelled) allowedPricingKeysRef.current = allowedKeys

        const apiRes = (await apiFetch('/pricing-parameters').catch(() => ({}))) as
          | {
              params?: Record<string, number>
              customOptions?: Record<string, Array<{ label: string; value: string; price_key: string }>>
              paramLabelOverrides?: Record<string, string>
              hiddenKeys?: string[]
            }
          | Record<string, unknown>
        const rawParams =
          apiRes && typeof apiRes === 'object' && 'params' in apiRes ? apiRes.params : undefined
        const pricesMap: Record<string, number> =
          rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams)
            ? (rawParams as Record<string, number>)
            : (apiRes && typeof apiRes === 'object' ? (apiRes as Record<string, number>) : {})
        const rawCustom =
          apiRes && typeof apiRes === 'object' && 'customOptions' in apiRes ? apiRes.customOptions : undefined
        const customOptions: Record<string, Array<{ label: string; value: string; price_key: string }>> =
          rawCustom && typeof rawCustom === 'object' && !Array.isArray(rawCustom)
            ? (rawCustom as Record<string, Array<{ label: string; value: string; price_key: string }>>)
            : {}
        const rawOverrides =
          apiRes && typeof apiRes === 'object' && 'paramLabelOverrides' in apiRes ? apiRes.paramLabelOverrides : undefined
        const paramLabelOverrides: Record<string, string> =
          rawOverrides && typeof rawOverrides === 'object' && !Array.isArray(rawOverrides)
            ? (rawOverrides as Record<string, string>)
            : {}
        const rawHidden =
          apiRes && typeof apiRes === 'object' && 'hiddenKeys' in apiRes ? apiRes.hiddenKeys : undefined
        const hiddenKeysSet = new Set<string>(
          Array.isArray(rawHidden) ? rawHidden.filter((k): k is string => typeof k === 'string') : []
        )
        for (const sec of baseSectionsFromJson) {
          for (const sub of sec.subsections) {
            const tag = sub.fieldTag
            if (tag && customOptions[tag]) {
              for (const o of customOptions[tag]) {
                if (!hiddenKeysSet.has(o.price_key)) allowedKeys.add(o.price_key)
              }
            }
          }
        }
        if (!cancelled) allowedPricingKeysRef.current = allowedKeys
        const merged: PreisdatenbankSection[] = baseSectionsFromJson.map((sec) => ({
          ...sec,
          subsections: sec.subsections.map((sub) => {
            const baseVars = sub.variables
              .filter((v) => !hiddenKeysSet.has(v.id))
              .map((v) => ({
                ...v,
                value: typeof pricesMap[v.id] === 'number' ? pricesMap[v.id] : v.value,
                label: paramLabelOverrides[v.id] ?? v.label,
              }))
              .filter((v) => !isBlockedOption(v))
            const tag = sub.fieldTag
            const customVars =
              tag && customOptions[tag]
                ? customOptions[tag]
                    .filter((o) => !hiddenKeysSet.has(o.price_key))
                  .map((o) => ({
                      id: o.price_key,
                      label: o.label,
                      unit: sub.variables[0]?.unit ?? '€',
                      value: typeof pricesMap[o.price_key] === 'number' ? pricesMap[o.price_key] : 0,
                      isCustomOption: true,
                    }))
                    .filter((v) => !isBlockedOption(v))
                : []
            return {
              ...sub,
              variables: [...baseVars, ...customVars],
            }
          }),
        }))
        if (!cancelled) {
          setSections(merged)
          setHasUnsavedChanges(false)
        }
      } catch (e) {
        if (!cancelled) {
          setSections([])
          setLoadError('Preise konnten nicht geladen werden.')
        }
      }
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    setIsSafari(isSafariBrowser())
  }, [])

  useEffect(() => {
    const el = containerRef.current
    const update = () => {
      if (el?.clientWidth != null) setContainerWidth(el.clientWidth)
      else if (typeof window !== 'undefined') setContainerWidth(window.innerWidth)
    }
    update()
    if (!el) return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [ready])

  const updateThumb = useRef(() => {
    const el = containerRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    const maxScroll = scrollHeight - clientHeight
    if (maxScroll <= 0) {
      setScrollThumb({ height: 0, top: 0 })
      return
    }
    const ratio = clientHeight / scrollHeight
    const height = Math.max(20, clientHeight * ratio)
    const top = (scrollTop / maxScroll) * (clientHeight - height)
    setScrollThumb({ height, top })
  })

  useEffect(() => {
    if (!isSafari || !ready) return
    const el = containerRef.current
    if (!el) return
    updateThumb.current()
    el.addEventListener('scroll', updateThumb.current)
    const ro = new ResizeObserver(updateThumb.current)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', updateThumb.current)
      ro.disconnect()
    }
  }, [isSafari, ready])

  const handleThumbMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    if (!containerRef.current) return
    setIsDragging(true)
    dragStartY.current = e.clientY
    dragStartScrollTop.current = containerRef.current.scrollTop
  }

  useEffect(() => {
    if (!isDragging) return
    const onMove = (e: MouseEvent) => {
      const el = containerRef.current
      if (!el) return
      const delta = e.clientY - dragStartY.current
      const { scrollHeight, clientHeight } = el
      const maxScroll = scrollHeight - clientHeight
      const thumbTravel = clientHeight - scrollThumb.height
      const scrollDelta = thumbTravel > 0 ? (delta / thumbTravel) * maxScroll : 0
      el.scrollTop = Math.max(0, Math.min(maxScroll, dragStartScrollTop.current + scrollDelta))
    }
    const onUp = () => setIsDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [isDragging, scrollThumb.height])

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = containerRef.current
    const track = e.currentTarget
    if (!el || !track) return
    const rect = track.getBoundingClientRect()
    const y = e.clientY - rect.top
    const { scrollHeight, clientHeight } = el
    const maxScroll = scrollHeight - clientHeight
    if (maxScroll <= 0) return
    const ratio = y / rect.height
    el.scrollTop = ratio * maxScroll
  }

  const flushSave = useRef(() => {
    const allowed = allowedPricingKeysRef.current
    const params: Record<string, number> = {}
    for (const [id, value] of Object.entries(pendingSaveRef.current)) {
      if (allowed.has(id)) params[id] = value
    }
    pendingSaveRef.current = {}
    if (Object.keys(params).length === 0) return
    apiFetch('/pricing-parameters', {
      method: 'PATCH',
      body: JSON.stringify({ params }),
    }).catch(() => {})
  })

  const updateValue = (
    sectionIndex: number,
    subsectionIndex: number,
    id: string,
    value: number
  ) => {
    setHasUnsavedChanges(true)
    setSections((prev) =>
      prev.map((sec, i) => {
        if (i !== sectionIndex) return sec
        return {
          ...sec,
          subsections: sec.subsections.map((sub, j) => {
            if (j !== subsectionIndex) return sub
            return {
              ...sub,
              variables: sub.variables.map((v) => (v.id === id ? { ...v, value } : v)),
            }
          }),
        }
      })
    )
    pendingSaveRef.current = { ...pendingSaveRef.current, [id]: value }
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current)
    saveDebounceRef.current = setTimeout(() => {
      saveDebounceRef.current = null
      flushSave.current()
    }, 600)
  }

  const handleSave = async () => {
    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current)
      saveDebounceRef.current = null
    }
    const allowed = allowedPricingKeysRef.current
    const params: Record<string, number> = {}
    for (const sec of sections) {
      for (const sub of sec.subsections) {
        for (const v of sub.variables) {
          if (!allowed.has(v.id)) continue
          const num = Number(v.value)
          params[v.id] = Number.isFinite(num) ? num : 0
        }
      }
    }
    setSaving(true)
    setSaveMessage(null)
    setSaveErrorMessage(null)
    try {
      const body: {
        params: Record<string, number>
        deleteKeys?: string[]
        newOptions?: Array<{ field_tag: string; option_label: string; price: number }>
        labelUpdates?: Array<{ price_key: string; option_label: string }>
      } = { params }
      if (deletedKeys.length > 0) body.deleteKeys = deletedKeys
      if (pendingNewOptions.length > 0) body.newOptions = pendingNewOptions
      if (Object.keys(pendingLabelUpdates).length > 0) {
        body.labelUpdates = Object.entries(pendingLabelUpdates).map(([price_key, option_label]) => ({
          price_key,
          option_label,
        }))
      }
      const res = await apiFetch('/pricing-parameters', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }) as { params?: Record<string, number> } | Record<string, number>
      const rawUpdated = res && typeof res === 'object' && 'params' in res ? res.params : res
      const updated: Record<string, number> =
        rawUpdated && typeof rawUpdated === 'object' && !Array.isArray(rawUpdated)
          ? (rawUpdated as Record<string, number>)
          : {}
      pendingSaveRef.current = {}
      setDeletedKeys([])
      setPendingNewOptions([])
      setPendingLabelUpdates({})
      setHasUnsavedChanges(false)
      setSections((prev) =>
        prev.map((sec) => ({
          ...sec,
          subsections: sec.subsections.map((sub) => ({
            ...sub,
            variables: sub.variables.map((v) => ({
              ...v,
              value: typeof updated[v.id] === 'number' ? updated[v.id] : v.value,
            })),
          })),
        }))
      )
      setSaveMessage('success')
      window.dispatchEvent(new CustomEvent('pricing-parameters:saved'))
      setTimeout(() => setSaveMessage(null), 3000)
    } catch (err: any) {
      setSaveMessage('error')
      setSaveErrorMessage(err?.message || 'Fehler beim Speichern')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = (sectionIndex: number, subsectionIndex: number, id: string) => {
    if (isProtectedVariable(id)) return
    setHasUnsavedChanges(true)
    setSections((prev) =>
      prev.map((sec, i) => {
        if (i !== sectionIndex) return sec
        return {
          ...sec,
          subsections: sec.subsections.map((sub, j) => {
            if (j !== subsectionIndex) return sub
            return {
              ...sub,
              variables: sub.variables.filter((v) => v.id !== id),
            }
          }),
        }
      })
    )
    setDeletedKeys((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }

  const handleAddOption = (
    sectionIndex: number,
    subsectionIndex: number,
    fieldTag: string,
    label: string,
    value: number,
    unit: string
  ) => {
    if (!label.trim() || !fieldTag) return
    const key = `opt_${fieldTag}_${slugFromLabel(label)}`
    setSections((prev) =>
      prev.map((sec, i) => {
        if (i !== sectionIndex) return sec
        return {
          ...sec,
          subsections: sec.subsections.map((sub, j) => {
            if (j !== subsectionIndex) return sub
            return {
              ...sub,
              variables: [
                ...sub.variables,
                { id: key, label: label.trim(), unit: unit || '€', value: Number(value) || 0 },
              ],
            }
          }),
        }
      })
    )
    allowedPricingKeysRef.current.add(key)
    setHasUnsavedChanges(true)
    setPendingNewOptions((prev) => [...prev, { field_tag: fieldTag, option_label: label.trim(), price: Number(value) || 0 }])
    setAddingAt(null)
  }

  const handleEditLabel = (sectionIndex: number, subsectionIndex: number, id: string, newLabel: string) => {
    if (isProtectedVariable(id)) return
    if (!newLabel.trim()) return
    setHasUnsavedChanges(true)
    const trimmed = newLabel.trim()
    setSections((prev) =>
      prev.map((sec, i) => {
        if (i !== sectionIndex) return sec
        return {
          ...sec,
          subsections: sec.subsections.map((sub, j) => {
            if (j !== subsectionIndex) return sub
            return {
              ...sub,
              variables: sub.variables.map((v) => (v.id === id ? { ...v, label: trimmed } : v)),
            }
          }),
        }
      })
    )
    // Persistăm redenumirea la Save (opțiuni custom în tenant_form_options, variabile din sistem în parameter_label_overrides).
    setPendingLabelUpdates((prev) => ({ ...prev, [id]: trimmed }))
    setEditingLabelId(null)
  }

  if (!ready) return null

  const effectiveWidth =
    containerWidth > 0
      ? containerWidth
      : typeof window !== 'undefined'
        ? window.innerWidth
        : 1200
  const availableWidth = Math.max(0, effectiveWidth - CONTAINER_PADDING_PX)
  const maxColumnsThatFit =
    availableWidth <= 0
      ? 1
      : Math.max(1, Math.floor((availableWidth + GAP_PX) / (MIN_COL_WIDTH + GAP_PX)))

  const pageContent = (
    <div className="p-6 w-full max-w-[140rem] mx-auto">
      <div className="sticky top-0 z-20 -mx-6 px-6 pt-6 pb-4 mb-4 bg-white/[0.06] backdrop-blur-md border-b border-white/10">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white mb-1">Preisdatenbank</h1>
            <p className="text-sand/80 text-base md:text-lg">
              Verwalten Sie hier Ihre Quadratmeterpreise, Stückpreise und Subunternehmerkosten – die
              Grundlage für alle Ihre Angebotsberechnungen.
            </p>
            {loadError && (
              <p className="mt-4 p-3 rounded-lg bg-yellow-500/20 text-yellow-200 text-base" role="alert">
                {loadError}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {saveMessage === 'success' && (
              <span className="flex items-center gap-1.5 text-yellow-400 text-base">
                <CheckCircle2 size={18} /> Gespeichert
              </span>
            )}
            {saveMessage === 'error' && (
              <span className="flex flex-col gap-1 text-yellow-400 text-base max-w-md">
                <span className="flex items-center gap-1.5">
                  <AlertCircle size={18} /> Fehler beim Speichern
                </span>
                {saveErrorMessage && (
                  <span className="text-sm text-yellow-300/90 font-mono break-all">{saveErrorMessage}</span>
                )}
              </span>
            )}
            <div className="flex flex-col items-end gap-1.5">
              <button
                type="button"
                onClick={hasUnsavedChanges ? handleSave : undefined}
                disabled={saving || !hasUnsavedChanges}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold shadow-lg transition-all duration-200 ease-out text-base ${
                  hasUnsavedChanges
                    ? 'bg-[#E5B800] hover:bg-[#F5D030] text-white disabled:opacity-60 disabled:cursor-not-allowed'
                    : 'bg-transparent text-white border border-white cursor-not-allowed opacity-90'
                }`}
              >
                {saving ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Speichern…
                  </>
                ) : (
                  <>
                    <Save size={18} />
                    Speichern
                  </>
                )}
              </button>
              <p className="text-sand/60 text-sm text-right max-w-[200px]">
                Änderungen gelten für alle neuen Angebote.
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 mb-6">
        <button
          type="button"
          onClick={() => setActiveCatalog('neubau')}
          className={`px-4 py-2 rounded-lg border text-sm font-semibold ${activeCatalog === 'neubau' ? 'bg-[#E5B800] text-white border-[#E5B800]' : 'border-white/20 text-white/90 hover:border-[#E5B800]/70'}`}
        >
          Neubau
        </button>
        <button
          type="button"
          onClick={() => setActiveCatalog('dachstuhl')}
          className={`px-4 py-2 rounded-lg border text-sm font-semibold ${activeCatalog === 'dachstuhl' ? 'bg-[#E5B800] text-white border-[#E5B800]' : 'border-white/20 text-white/90 hover:border-[#E5B800]/70'}`}
        >
          Dachstuhl
        </button>
      </div>
      <div className="flex flex-col gap-10 md:gap-12">
        {sections
          .map((section, originalIndex) => ({ section, originalIndex }))
          .filter(({ section }) => (activeCatalog === 'dachstuhl' ? section.stepKey === 'projektdaten' : section.stepKey !== 'projektdaten'))
          .map(({ section, originalIndex: sectionIndex }) => {
          // Grupăm cardurile cu un singur element (unu sub altul)
          const items: Array<
            | { type: 'card'; sub: (typeof section.subsections)[0]; subsectionIndex: number }
            | { type: 'stack'; subs: Array<{ sub: (typeof section.subsections)[0]; subsectionIndex: number }> }
            | { type: 'kaminCard'; subs: Array<{ sub: (typeof section.subsections)[0]; subsectionIndex: number }> }
          > = []
          let i = 0
          while (i < section.subsections.length) {
            const sub = section.subsections[i]
            const nextSub = section.subsections[i + 1]
            if (sub.title === 'Kaminabzug' && nextSub?.title === 'Kamin / Ofen') {
              items.push({
                type: 'kaminCard',
                subs: [
                  { sub: section.subsections[i], subsectionIndex: i },
                  { sub: section.subsections[i + 1], subsectionIndex: i + 1 },
                ],
              })
              i += 2
              continue
            }
            if (sub.variables.length === 1) {
              const stackSubs: Array<{ sub: (typeof section.subsections)[0]; subsectionIndex: number }> = []
              while (i < section.subsections.length && section.subsections[i].variables.length === 1) {
                stackSubs.push({ sub: section.subsections[i], subsectionIndex: i })
                i++
              }
              items.push({ type: 'stack', subs: stackSubs })
            } else {
              items.push({ type: 'card', sub, subsectionIndex: i })
              i++
            }
          }
          const nItems = items.length
          const wideCount = items.filter((it) => (it.type === 'card' && it.sub.variables.length > 4) || it.type === 'kaminCard').length
          // Coloane fixe 300px; cardurile „late” (2 coloane interne) ocupă 2 celule ca gap-ul să rămână constant.
          const stepColumns = Math.min(6, maxColumnsThatFit, Math.max(1, nItems + wideCount))
          const stepGridMaxPx = stepColumns * CARD_MAX_PX + (stepColumns - 1) * GAP_PX
          const stepSubtitle = (section.stepKey && STEP_SUBTITLES[section.stepKey]) || section.subtitle
          return (
            <div
              key={section.stepKey ?? section.title}
              className="flex flex-col gap-4 md:gap-5 border-t border-white/10 pt-4 first:pt-4"
            >
              <header className="text-center">
                <h2 className="text-xl md:text-2xl font-bold text-[#E5B800]">{section.title}</h2>
                {stepSubtitle && (
                  <p className="text-white text-sm md:text-base mt-1">{stepSubtitle}</p>
                )}
              </header>
              <div
                className="grid justify-center justify-items-center items-start mx-auto w-full"
                style={{
                  gridTemplateColumns: `repeat(${stepColumns}, minmax(0, ${CARD_MAX_PX}px))`,
                  maxWidth: `${stepGridMaxPx}px`,
                  gap: `${GAP_PX}px`,
                }}
              >
                {items.map((item) =>
                  item.type === 'stack' ? (
                    <div
                      key={item.subs.map((s) => s.sub.title).join(',')}
                      className="flex flex-col gap-3 w-full max-w-[300px] justify-self-center"
                    >
                      {item.subs.map(({ sub, subsectionIndex }) => (
                        <article
                          key={sub.title}
                          className="rounded-xl border border-white/10 bg-white/5 p-3 md:p-4 flex flex-col min-w-0 w-full"
                        >
                          <div className="border-b border-white/10 pb-2 mb-2">
                            <h3 className="text-sm font-semibold text-[#E5B800]">{sub.title}</h3>
                            <p className="text-white/90 text-xs mt-0.5">{cardSubtitle(sub.title, sub.subtitle)}</p>
                          </div>
                          <div className="grid grid-cols-1 gap-2">
                            {sub.variables.map((v) => (
                              <div key={v.id} className="flex flex-col gap-1 group" data-field={v.id}>
                                <div className="flex items-center gap-2 wiz-label text-sun/90 text-sm">
                                  {editingLabelId === v.id ? (
                                    <input
                                      type="text"
                                      className="sun-input flex-1 min-w-0 text-sm"
                                      defaultValue={labelWithoutUnit(v.label)}
                                      autoFocus
                                      onBlur={(e) => handleEditLabel(sectionIndex, subsectionIndex, v.id, e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          handleEditLabel(sectionIndex, subsectionIndex, v.id, (e.target as HTMLInputElement).value)
                                        }
                                        if (e.key === 'Escape') setEditingLabelId(null)
                                      }}
                                    />
                                  ) : (
                                    <>
                                      <span className="flex-1 min-w-0 truncate">{labelWithoutUnit(v.label)}</span>
                                      {!isProtectedVariable(v.id) && !isValueOnlyFieldTag(sub.fieldTag) && <button type="button" onClick={() => setEditingLabelId(v.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded text-sand/70 hover:text-[#E5B800]" title="Bezeichnung bearbeiten" aria-label="Bezeichnung bearbeiten"><Pencil size={14} /></button>}
                                      {!isProtectedVariable(v.id) && !isValueOnlyFieldTag(sub.fieldTag) && <button type="button" onClick={() => handleDelete(sectionIndex, subsectionIndex, v.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded text-sand/70 hover:text-red-400" title="Option entfernen" aria-label="Option entfernen"><Trash2 size={14} /></button>}
                                    </>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <input
                                    id={v.id}
                                    type="number"
                                    min={0}
                                    step={getStep(v.unit)}
                                    value={v.value}
                                    onChange={(e) => updateValue(sectionIndex, subsectionIndex, v.id, parseFloat(e.target.value) || 0)}
                                    className="sun-input flex-1 min-w-0 max-w-[100px] text-sm"
                                  />
                                  {v.unit ? <span className="text-sand/70 text-sm shrink-0">{v.unit}</span> : null}
                                </div>
                              </div>
                            ))}
                            {addingAt?.sectionIndex === sectionIndex && addingAt?.subsectionIndex === subsectionIndex && (
                              <div className="flex flex-wrap items-center gap-2 text-left text-sm">
                                <input type="text" placeholder="Bezeichnung" className="sun-input w-32 text-sm" id={`add-label-${sectionIndex}-${subsectionIndex}`} />
                                <input type="number" min={0} step={0.01} placeholder="Preis" className="sun-input w-20 text-sm" id={`add-value-${sectionIndex}-${subsectionIndex}`} />
                                {sub.variables[0]?.unit ? <span className="text-sand/70 text-sm">{sub.variables[0].unit}</span> : null}
                                <button type="button" onClick={() => { const labelEl = document.getElementById(`add-label-${sectionIndex}-${subsectionIndex}`) as HTMLInputElement; const valueEl = document.getElementById(`add-value-${sectionIndex}-${subsectionIndex}`) as HTMLInputElement; if (labelEl && valueEl && sub.fieldTag) handleAddOption(sectionIndex, subsectionIndex, sub.fieldTag, labelEl.value, parseFloat(valueEl.value) || 0, sub.variables[0]?.unit ?? '') }} className="px-2 py-1 rounded bg-[#E5B800] text-white text-sm">Übernehmen</button>
                                <button type="button" onClick={() => setAddingAt(null)} className="px-2 py-1 rounded border border-white/20 text-sand/80 text-sm">Abbrechen</button>
                              </div>
                            )}
                            {canAddOptionsForFieldTag(sub.fieldTag) && !(addingAt?.sectionIndex === sectionIndex && addingAt?.subsectionIndex === subsectionIndex) && (
                              <button type="button" onClick={() => setAddingAt({ sectionIndex, subsectionIndex })} className="flex items-center gap-2 py-1 text-sm text-[#E5B800] hover:underline text-left w-full justify-start">
                                <Plus size={14} /> Option hinzufügen
                              </button>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : item.type === 'kaminCard' ? (
                    <article
                      key="Kamin / Ofen"
                      className="rounded-xl border border-white/10 bg-white/5 p-4 md:p-5 flex flex-col min-w-0 w-full max-w-[624px]"
                      style={{ gridColumn: 'span 2' }}
                    >
                      <div className="border-b border-white/10 pb-3 mb-3">
                        <h3 className="text-base font-semibold text-[#E5B800]">Kamin / Ofen</h3>
                        <p className="text-white/90 text-sm mt-1">{cardSubtitle('Kamin / Ofen', null)}</p>
                      </div>
                      <div className="flex flex-col gap-6">
                        {item.subs.map(({ sub, subsectionIndex }) => (
                          <div key={sub.title} className="flex flex-col gap-2">
                            <h4 className="text-sm font-medium text-sand/80 border-b border-white/10 pb-1">{sub.title}</h4>
                            <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
                              {sub.variables.map((v) => (
                                <div key={v.id} className="flex flex-col gap-1 group" data-field={v.id}>
                                  <div className="flex items-center gap-2 wiz-label text-sun/90 text-sm">
                                    {editingLabelId === v.id ? (
                                      <input
                                        type="text"
                                        className="sun-input flex-1 min-w-0 text-sm"
                                        defaultValue={labelWithoutUnit(v.label)}
                                        autoFocus
                                        onBlur={(e) => handleEditLabel(sectionIndex, subsectionIndex, v.id, e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') handleEditLabel(sectionIndex, subsectionIndex, v.id, (e.target as HTMLInputElement).value)
                                          if (e.key === 'Escape') setEditingLabelId(null)
                                        }}
                                      />
                                    ) : (
                                      <>
                                        <span className="flex-1 min-w-0 truncate">{labelWithoutUnit(v.label)}</span>
                                        {!isProtectedVariable(v.id) && !isValueOnlyFieldTag(sub.fieldTag) && <button type="button" onClick={() => setEditingLabelId(v.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded text-sand/70 hover:text-[#E5B800]" title="Bezeichnung bearbeiten" aria-label="Bezeichnung bearbeiten"><Pencil size={14} /></button>}
                                        {!isProtectedVariable(v.id) && !isValueOnlyFieldTag(sub.fieldTag) && <button type="button" onClick={() => handleDelete(sectionIndex, subsectionIndex, v.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded text-sand/70 hover:text-red-400" title="Option entfernen" aria-label="Option entfernen"><Trash2 size={14} /></button>}
                                      </>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <input
                                      id={v.id}
                                      type="number"
                                      min={0}
                                      step={getStep(v.unit)}
                                      value={v.value}
                                      onChange={(e) => updateValue(sectionIndex, subsectionIndex, v.id, parseFloat(e.target.value) || 0)}
                                      className="sun-input flex-1 min-w-0 max-w-[120px] text-sm"
                                    />
                                    {v.unit ? <span className="text-sand/70 text-sm shrink-0">{v.unit}</span> : null}
                                  </div>
                                </div>
                              ))}
                            </div>
                            {canAddOptionsForFieldTag(sub.fieldTag) && addingAt?.sectionIndex === sectionIndex && addingAt?.subsectionIndex === subsectionIndex ? (
                              <div className="flex flex-wrap items-center gap-2 text-left text-sm">
                                <input type="text" placeholder="Bezeichnung" className="sun-input w-32 text-sm" id={`add-label-${sectionIndex}-${subsectionIndex}`} />
                                <input type="number" min={0} step={0.01} placeholder="Preis" className="sun-input w-20 text-sm" id={`add-value-${sectionIndex}-${subsectionIndex}`} />
                                {sub.variables[0]?.unit ? <span className="text-sand/70 text-sm">{sub.variables[0].unit}</span> : null}
                                <button type="button" onClick={() => { const labelEl = document.getElementById(`add-label-${sectionIndex}-${subsectionIndex}`) as HTMLInputElement; const valueEl = document.getElementById(`add-value-${sectionIndex}-${subsectionIndex}`) as HTMLInputElement; if (labelEl && valueEl && sub.fieldTag) handleAddOption(sectionIndex, subsectionIndex, sub.fieldTag, labelEl.value, parseFloat(valueEl.value) || 0, sub.variables[0]?.unit ?? '') }} className="px-2 py-1 rounded bg-[#E5B800] text-white text-sm">Übernehmen</button>
                                <button type="button" onClick={() => setAddingAt(null)} className="px-2 py-1 rounded border border-white/20 text-sand/80 text-sm">Abbrechen</button>
                              </div>
                            ) : canAddOptionsForFieldTag(sub.fieldTag) ? (
                              <button type="button" onClick={() => setAddingAt({ sectionIndex, subsectionIndex })} className="flex items-center gap-2 py-1 text-sm text-[#E5B800] hover:underline text-left">
                                <Plus size={14} /> Option hinzufügen
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </article>
                  ) : (
                  <article
                    key={item.sub.title}
                    className={`rounded-xl border border-white/10 bg-white/5 p-4 md:p-5 flex flex-col min-w-0 w-full ${item.sub.variables.length > 4 ? 'max-w-[624px]' : 'max-w-[300px]'}`}
                    style={item.sub.variables.length > 4 ? { gridColumn: 'span 2' } : undefined}
                  >
                    <div className="border-b border-white/10 pb-3 mb-3">
                      <h3 className="text-base font-semibold text-[#E5B800]">
                        {item.sub.title}
                      </h3>
                      <p className="text-white/90 text-sm mt-1">
                        {cardSubtitle(item.sub.title, item.sub.subtitle)}
                      </p>
                    </div>
                    <div
                      className={`grid gap-3 md:gap-4 ${item.sub.variables.length > 4 ? 'grid-cols-2' : 'grid-cols-1'}`}
                    >
                            {item.sub.variables.map((v) => (
                        <div key={v.id} className="flex flex-col gap-1 group" data-field={v.id}>
                          <div className="flex items-center gap-2 wiz-label text-sun/90 text-sm md:text-base">
                            {editingLabelId === v.id ? (
                              <input
                                type="text"
                                className="sun-input flex-1 min-w-0"
                                defaultValue={labelWithoutUnit(v.label)}
                                autoFocus
                                onBlur={(e) => handleEditLabel(sectionIndex, item.subsectionIndex, v.id, e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    handleEditLabel(sectionIndex, item.subsectionIndex, v.id, (e.target as HTMLInputElement).value)
                                  }
                                  if (e.key === 'Escape') setEditingLabelId(null)
                                }}
                              />
                            ) : (
                              <>
                                <span className="flex-1 min-w-0">{labelWithoutUnit(v.label)}</span>
                                {!isProtectedVariable(v.id) && !isValueOnlyFieldTag(item.sub.fieldTag) && <button
                                  type="button"
                                  onClick={() => setEditingLabelId(v.id)}
                                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-sand/70 hover:text-[#E5B800]"
                                  title="Bezeichnung bearbeiten"
                                  aria-label="Bezeichnung bearbeiten"
                                >
                                  <Pencil size={14} />
                                </button>}
                                {!isProtectedVariable(v.id) && !isValueOnlyFieldTag(item.sub.fieldTag) && <button
                                  type="button"
                                  onClick={() => handleDelete(sectionIndex, item.subsectionIndex, v.id)}
                                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-sand/70 hover:text-red-400"
                                  title="Option entfernen"
                                  aria-label="Option entfernen"
                                >
                                  <Trash2 size={14} />
                                </button>}
                              </>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              id={v.id}
                              type="number"
                              min={0}
                              step={getStep(v.unit)}
                              value={v.value}
                              onChange={(e) =>
                                updateValue(sectionIndex, item.subsectionIndex, v.id, parseFloat(e.target.value) || 0)
                              }
                              className="sun-input flex-1 min-w-0 max-w-[120px] md:max-w-[140px]"
                            />
                            {v.unit ? <span className="text-sand/70 text-sm md:text-base shrink-0">{v.unit}</span> : null}
                          </div>
                        </div>
                      ))}
                      {addingAt?.sectionIndex === sectionIndex && addingAt?.subsectionIndex === item.subsectionIndex ? (
                        <div className={`flex flex-wrap items-center gap-2 text-left ${item.sub.variables.length > 4 ? 'col-span-2' : ''}`}>
                          <input
                            type="text"
                            placeholder="Bezeichnung"
                            className="sun-input w-40 text-sm"
                            id={`add-label-${sectionIndex}-${item.subsectionIndex}`}
                          />
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            placeholder="Preis"
                            className="sun-input w-24 text-sm"
                            id={`add-value-${sectionIndex}-${item.subsectionIndex}`}
                          />
                          {item.sub.variables[0]?.unit ? <span className="text-sand/70 text-sm">{item.sub.variables[0].unit}</span> : null}
                          <button
                            type="button"
                            onClick={() => {
                              const labelEl = document.getElementById(`add-label-${sectionIndex}-${item.subsectionIndex}`) as HTMLInputElement
                              const valueEl = document.getElementById(`add-value-${sectionIndex}-${item.subsectionIndex}`) as HTMLInputElement
                              if (labelEl && valueEl && item.sub.fieldTag)
                                handleAddOption(
                                  sectionIndex,
                                  item.subsectionIndex,
                                  item.sub.fieldTag,
                                  labelEl.value,
                                  parseFloat(valueEl.value) || 0,
                                  item.sub.variables[0]?.unit ?? '€'
                                )
                            }}
                            className="px-3 py-1.5 rounded bg-[#E5B800] text-white text-sm font-medium"
                          >
                            Übernehmen
                          </button>
                          <button
                            type="button"
                            onClick={() => setAddingAt(null)}
                            className="px-3 py-1.5 rounded border border-white/20 text-sand/80 text-sm"
                          >
                            Abbrechen
                          </button>
                        </div>
                      ) : canAddOptionsForFieldTag(item.sub.fieldTag) ? (
                        <button
                          type="button"
                          onClick={() => setAddingAt({ sectionIndex, subsectionIndex: item.subsectionIndex })}
                          className={`flex items-center gap-2 py-2 text-sm md:text-base text-[#E5B800] hover:underline text-left w-full justify-start ${item.sub.variables.length > 4 ? 'col-span-2' : ''}`}
                        >
                          <Plus size={16} /> Option hinzufügen
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
/* Safari macOS: scrollbar mereu vizibil ca să accepte stiluri (overlay = nativ, ignoră ::-webkit-scrollbar) */
.preisdatenbank-scroll {
  overflow-y: scroll !important;
  overflow-x: auto !important;
  scrollbar-width: thin !important;
  scrollbar-color: #E5B800 transparent !important;
}
.preisdatenbank-scroll::-webkit-scrollbar {
  width: 10px !important;
  height: 10px !important;
  -webkit-appearance: none !important;
  appearance: none !important;
}
.preisdatenbank-scroll::-webkit-scrollbar-track {
  background: transparent !important;
  -webkit-appearance: none !important;
}
.preisdatenbank-scroll::-webkit-scrollbar-thumb {
  background: #E5B800 !important;
  border-radius: 9999px !important;
  border: 2px solid transparent !important;
  background-clip: padding-box !important;
  -webkit-appearance: none !important;
  min-height: 40px !important;
}
.preisdatenbank-scroll::-webkit-scrollbar-thumb:hover {
  background: #F5D030 !important;
}
.preisdatenbank-scroll::-webkit-scrollbar-corner {
  background: transparent !important;
}
/* Safari: ascunde scrollbar-ul nativ când folosim scrollbar custom */
.preisdatenbank-scroll-safari-hide {
  scrollbar-width: none !important;
  -ms-overflow-style: none !important;
}
.preisdatenbank-scroll-safari-hide::-webkit-scrollbar {
  width: 0 !important;
  height: 0 !important;
  display: none !important;
}
`,
        }}
      />
      {isSafari ? (
        <div className="col-span-full min-h-0 h-full flex">
          <div
            ref={containerRef}
            className="flex-1 min-w-0 min-h-0 flex flex-col overflow-y-scroll overflow-x-auto preisdatenbank-scroll-safari-hide"
          >
            {pageContent}
          </div>
          <div
            className="w-[10px] shrink-0 h-full relative cursor-pointer select-none"
            onClick={handleTrackClick}
            role="scrollbar"
            aria-label="Scroll"
          >
            <div
              className="absolute left-0 w-full rounded-full bg-[#E5B800] hover:bg-[#F5D030] min-h-[20px] cursor-grab active:cursor-grabbing"
              style={{
                height: scrollThumb.height,
                top: scrollThumb.top,
              }}
              onMouseDown={handleThumbMouseDown}
              role="slider"
              aria-valuenow={containerRef.current?.scrollTop ?? 0}
            />
          </div>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="col-span-full min-h-0 h-full flex flex-col overflow-y-scroll overflow-x-auto preisdatenbank-scroll"
        >
          {pageContent}
        </div>
      )}
    </>
  )
}
