'use client'

import { useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { apiFetch } from '../lib/supabaseClient'
import {
  inferOfferFlow,
  resolveOfferFlowWithExplicit,
  type OfferFlow,
  type OfferFlowMeta,
} from '../lib/offerFlow'
import { buildFormStepsFromJson, buildPriceSectionsFromFormStepsJson } from '../../lib/buildFormFromJson'
import { mergeSelectOptions } from '../../lib/mergeSelectOptions'
import { adaptCurrencyCopy, type DisplayCurrency, normalizeDisplayCurrency } from '../../lib/displayCurrency'
import holzbauFormStepsJson from '../../data/form-schema/holzbau-form-steps.json'
import { type Field, formStepsDachstuhl } from '../dashboard/formConfig'
import { CheckCircle2, ChevronLeft, ChevronRight, ChevronDown, Loader2, AlertTriangle, X } from 'lucide-react'
import { DetectionsReviewEditor } from './DetectionsReviewEditor'

const SimplePdfViewer = dynamic(() => import('./SimplePdfViewer.client'), {
  ssr: false,
  loading: () => <div className="py-10 text-center text-neutral-200">PDF wird generiert…</div>
})

type Drafts = Record<string, Record<string, any>>
type Errors = Record<string, string | undefined>

// Timpul minim (în ms) pentru care afișăm animația de loading/progres
const MIN_ANIMATION_TIME = 5000;

/** Preview-uri modale „Angebot bearbeiten” (`public/images/btnform.png`, `btneditor.png`). */
const EDIT_OFFER_DLG_IMG_FORM = '/images/btnform.png'
const EDIT_OFFER_DLG_IMG_EDITOR = '/images/btneditor.png'

/** Etape care apar în log după ce utilizatorul a confirmat editorul de detecții (refresh: nu mai redeschidem editorul). */
const STAGES_AFTER_DETECTIONS_REVIEW = new Set([
  'scale_flood',
  'exterior_doors',
  'count_objects',
  'measure_objects',
  'perimeter',
  'area',
  'roof',
  'pricing',
  'offer_generation',
  'pdf_generation',
  'computation_complete',
])
const STAGES_AFTER_ROOF_REVIEW = new Set(['pricing', 'offer_generation', 'pdf_generation', 'computation_complete'])

/** Keller mit nutzbarer Ausstattung – neue Formulierungen + Legacy aus gespeicherten Angeboten. */
function isKellerMitAusbauChoice(tip: string): boolean {
  return tip.includes('Keller (mit Ausbau)') || tip.includes('mit einfachem Ausbau')
}

type CalcEventLite = {
  id?: number
  level?: string
  message?: string
  payload?: { files?: unknown[] }
}

function inferReviewCompletionFromCalcEvents(items: CalcEventLite[]): {
  detectionsReviewPassed: boolean
  roofReviewPassed: boolean
} {
  const sorted = [...items]
    .filter((e): e is CalcEventLite & { id: number } => typeof e.id === 'number')
    .sort((a, b) => a.id - b.id)

  let maxDr = -1
  let maxAfterDr = -1
  let maxRoof = -1
  let maxAfterRoof = -1

  for (const ev of sorted) {
    const id = ev.id
    const match = ev.message?.match(/^\s*\[([^\]]+)\]/)
    const stage = match?.[1]?.trim() ?? ''
    const hasFiles = Array.isArray(ev.payload?.files) && ev.payload.files.length > 0

    if (stage === 'detections_review' && hasFiles) {
      maxDr = Math.max(maxDr, id)
    }
    if (maxDr >= 0 && id > maxDr) {
      if (STAGES_AFTER_DETECTIONS_REVIEW.has(stage)) {
        maxAfterDr = Math.max(maxAfterDr, id)
      }
      if (stage === 'detections') {
        maxAfterDr = Math.max(maxAfterDr, id)
      }
    }

    if (stage === 'roof' && hasFiles) {
      maxRoof = Math.max(maxRoof, id)
    }
    if (maxRoof >= 0 && id > maxRoof && STAGES_AFTER_ROOF_REVIEW.has(stage)) {
      maxAfterRoof = Math.max(maxAfterRoof, id)
    }
  }

  return {
    detectionsReviewPassed: maxDr >= 0 && maxAfterDr > maxDr,
    roofReviewPassed: maxRoof >= 0 && maxAfterRoof > maxRoof,
  }
}

/** Ofertă doar acoperiș (Dachstuhl): meta, wizard_package sau tip ofertă slug. */
function isRoofOnlyOfferFromMeta(
  meta: { roof_only_offer?: boolean | null; wizard_package?: string | null } | null | undefined,
  offerTypeSlug?: string | null,
): boolean {
  if (meta?.roof_only_offer === true) return true
  if ((meta?.wizard_package ?? '').toString().toLowerCase() === 'dachstuhl') return true
  if ((offerTypeSlug ?? '').toString().toLowerCase() === 'dachstuhl') return true
  return false
}

/* ================== DATE ACOPERIȘ (grid 4x6) ================== */
const ROOF_TYPES = [
  { name_de: 'Flachdach', img: '/roof_types/1.png' },
  { name_de: 'Fußwalmdach', img: '/roof_types/2.png' },
  { name_de: 'Kreuzdach', img: '/roof_types/3.png' },
  { name_de: 'Grabendach', img: '/roof_types/4.png' },
  { name_de: 'Krüppelwalmdach', img: '/roof_types/5.png' },
  { name_de: 'Mansardendach', img: '/roof_types/6.png' },
  { name_de: 'Mansardendach mit Fußwalm', img: '/roof_types/7.png' },
  { name_de: 'Mansardendach mit Schopf', img: '/roof_types/8.png' },
  { name_de: 'Mansardenwalmdach', img: '/roof_types/9.png' },
  { name_de: 'Nurdach', img: '/roof_types/10.png' },
  { name_de: 'Paralleldach', img: '/roof_types/11.png' },
  { name_de: 'Pultdach', img: '/roof_types/12.png' },
  { name_de: 'Pultdach erweitert/versetzt', img: '/roof_types/13.png' },
  { name_de: 'Satteldach', img: '/roof_types/14.png' },
  { name_de: 'Satteldach erweitert', img: '/roof_types/15.png' },
  { name_de: 'Sattel-Walmdach', img: '/roof_types/16.png' },
  { name_de: 'Scheddach / Sägezahndach', img: '/roof_types/17.png' },
  { name_de: 'Schleppdach', img: '/roof_types/18.png' },
  { name_de: 'Schmetterlingsdach', img: '/roof_types/19.png' },
  { name_de: 'Tonnendach', img: '/roof_types/20.png' },
  { name_de: 'Walmdach', img: '/roof_types/21.png' },
  { name_de: 'Walm-Kehldach', img: '/roof_types/22.png' },
  { name_de: 'Zeltdach', img: '/roof_types/23.png' },
  { name_de: 'Zwerchdach', img: '/roof_types/24.png' },
] as const

/* ===================== UI DICTIONAR (AFIȘARE) ===================== */
const DE = {
  steps: {
    dateGenerale: 'Allgemeine Projektdaten (Bezeichnung)',
    client: 'Kundendaten',
    sistemConstructiv: 'Allgemeine Projektinformationen',
    wintergaertenBalkone: 'Wintergärten & Balkone',
    structuraCladirii: 'Gebäudestruktur',
    projektdaten: 'Projektdaten',
    daemmungDachdeckung: 'Dämmung & Dachdeckung',
    tipAcoperis: 'Dachart',
    ferestreUsi: 'Fenster & Türen',
    wandaufbau: 'Wandaufbau',
    materialeFinisaj: 'Materialien & Ausbaustufe',
    bodenDeckeBelag: 'Geschossdecken und Bodenaufbauten',
    performantaEnergetica: 'Energieeffizienz & Heizung',
    performanta: 'Energieeffizienz & Heizung',
    conditiiSantier: 'Baustellenbedingungen & Logistik',
    logistica: 'Baustellenbedingungen & Logistik',
    upload: 'Datei-Upload',
  },
  // Wir behalten die statischen Übersetzungen als Fallback, falls die DB keine Labels liefert
  fieldsGlobal: {
    'Tip sistem': 'Systemtyp',
    'Baustellenzufahrt': 'Baustellenzufahrt',
    'Tip fundație': 'Fundamenttyp',
    'Tip acoperiș': 'Dachtyp',
    'Material pereți': 'Wandmaterial',
    'Material acoperiș': 'Dachmaterial',
    'Nivel de finisaj': 'Ausbaustufe',
    'Fațadă': 'Fassade',
    'Tâmplărie': 'Fenster/Türen',
    'Tip termoizolație': 'Dämmstoff',
    'Grosime termoizolație': 'Dämmstärke (mm)',
    'Finisaje interioare': 'Innenausbau',
    'Încălzire': 'Heizung',
    'Încălzire secundară': 'Zusatzheizung',
    'Sistem distribuție': 'Wärmeverteilung',
    'Ventilație': 'Lüftung',
    'Clasă energetică': 'Energieklasse',
    'Producție energie': 'Eigenenergie',
    'Condiții de șantier și logistică': 'Baustellenbedingungen & Logistik',
    'Acces șantier': 'Baustellenzufahrt',
    'Utilități disponibile': 'Verfügbare Anschlüsse',
    'Macara': 'Kran',
    'Spațiu depozitare': 'Lagermöglichkeit',
    'Drenaj': 'Perimeterdrainage',
    'Observații': 'Anmerkungen',
    'Încărcare fișiere': 'Datei-Upload',

    'Informații despre client': 'Kundendaten',
    'Sistem constructiv': 'Bausystem',
    'Materiale și nivel de finisaj': 'Materialien & Ausbaustufe',
    'Performanță energetică': 'Energieeffizienz & Heizung',

    'Nivel de ofertă dorit': 'Gewünschter Angebotsumfang',
    'Tip finisaj interior': 'Innenausbau – Typ',
    'Tip fațadă': 'Fassade – Typ',
    'Tip ferestre și uși': 'Fenster/Türen – Typ',
    'Sistem încălzire preferat': 'Bevorzugte Heizung',
    'Nivel energetic dorit': 'Gewünschtes Energieniveau',
    'Teren plat sau pantă?': 'Gelände: eben oder Hang?',
    'Acces curent electric / apă': 'Strom-/Wasseranschluss vorhanden',

    'Plan arhitectural': 'Einreichplan',
    'Fotografii / randări': 'Fotos / Renderings',
    'Documentație suplimentară': 'Zusätzliche Dokumentation',
    'Choose File': 'Datei auswählen',
    'no file selected': 'keine Datei ausgewählt',

    inaltimeEtaje: 'Raumhöhe',
  },

  optionsGlobal: {
    // Statische Übersetzungen für Dropdown-Werte
    'Placă': 'Bodenplatte',
    'Piloți': 'Pfahlgründung',
    'Soclu': 'Streifenfundament (Sockel)',
    'Zidărie': 'Mauerwerk',
    'Beton armat': 'Stahlbeton',
    'Lemn': 'Holz',
    'Metal': 'Stahlbau',
    'Structură ușoară': 'Leichtbau',
    'Structură mixtă': 'Mischkonstruktion',

    'Țiglă': 'Dachziegel',
    'Țiglă ceramică': 'Tondachziegel',
    'Țiglă beton': 'Betondachstein',
    'Tablă': 'Blech',
    'Tablă fălțuită': 'Stehfalzblech',
    'Șindrilă bituminoasă': 'Bitumschindel',
    'Membrană': 'Membranbahn',
    'Membrană PVC': 'PVC-Bahn',
    'Hidroizolație bitum': 'Bitumenabdichtung',

    'Cărămidă': 'Ziegel',
    'BCA': 'Porenbeton',
    'EPS': 'EPS',
    'XPS': 'XPS',
    'Vată bazaltică': 'Steinwolle',
    'Vată minerală': 'Mineralwolle',
    'Celuloză': 'Zellulose',
    'Poliuretan': 'PU',

    'PVC': 'Kunststoff',
    'Lemn stratificat': 'Brettschichtholz',
    'Aluminiu': 'Aluminium',
    'Lemn-Aluminiu': 'Holz-Aluminium',
    'Termopan': 'Zweifachverglasung',
    'Tripan': 'Dreifachverglasung',

    'Centrală pe gaz': 'Gastherme',
    'Pompă de căldură': 'Wärmepumpe',
    'Cazan pe peleți': 'Pelletkessel',
    'Încălzire prin pardoseală': 'Fußbodenheizung',
    'Radiatoare': 'Heizkörper',
    'Ventilație cu recuperare': 'Kontrollierte Lüftung mit WRG',
    'Naturală': 'Natürlich',
    'Clasă energetică A': 'Energieklasse A',
    'Clasă energetică B': 'Energieklasse B',
    'Clasă energetică C': 'Energieklasse C',
    'nZEB': 'nZEB',
    'Panouri fotovoltaice': 'Photovoltaik',
    'Pregătire fotovoltaice': 'PV-Vorbereitung',

    'Da': 'Ja',
    'Nu': 'Nein',

    'Ușor (camion 40t)': 'Leicht (LKW 40t)',
    'Mediu': 'Mittel',
    'Dificil': 'Schwierig',
    'Plan': 'Eben',
    'Pantă ușoară': 'Leichte Hanglage',
    'Pantă mare': 'Starke Hanglage',

    'Structură': 'Rohbau/Tragwerk',
    'Structură + ferestre': 'Tragwerk + Fenster',
    'Casă completă': 'Schlüsselfertiges Haus',
    'Tencuială': 'Putz',
    'Fibrociment': 'Faserzement',
    'Mix': 'Mischung',

    'Gaz': 'Gas',
    'Pompa de căldură': 'Wärmepumpe',
    'Electric': 'Elektrisch',
    'Standard': 'Standard',
    'KfW 55': 'KfW 55',
    'KfW 40': 'KfW 40',
    'KfW 40+': 'KfW 40+',

    'Plan arhitectură': 'Einreichplan',
    'Plan arhitectural': 'Einreichplan',
    'Plan structură': 'Tragwerksplan',
    'Caiet de sarcini': 'Leistungsverzeichnis',
    'Documentație urbanism': 'B-Plan / Bau-Doku',
    'Documentație suplimentară': 'Zusätzliche Dokumentation',
    'Alte documente': 'Weitere Dokumente',
    'PDF plan': 'Plan-PDF',
    'DWG/DXF': 'DWG/DXF',
    'Imagini': 'Bilder',
    'Fotografii / randări': 'Fotos / Renderings',
  },

  common: {
    selected: 'Ausgewählt',
    notSelected: 'Nicht ausgewählt',
    selectPlaceholder: '— auswählen —',
    uploadingError: 'Fehler beim Hochladen',
    processingAlt: 'Wird verarbeitet…',
    btnBack: 'Zurück',
    btnNext: 'Weiter',
    btnFinish: 'Abschließen',
    toastSaving: 'Speichern…',
    toastSaved: 'Gespeichert ✓',
    toastError: 'Fehler beim Speichern',
    pdfNoLinkYet: 'Es gibt noch keinen gültigen PDF-Link.',
    pdfTryAgain: 'Es gibt noch keinen gültigen PDF-Link. Bitte in ein paar Sekunden erneut versuchen.',
    copyOk: 'Link in die Zwischenablage kopiert.',
    copyFail: 'Konnte den Link nicht kopieren. In neuem Tab öffnen und aus der Adressleiste kopieren.',
    finalizeErrorPrefix: 'Fehler beim Abschließen',
    validatingPlan: 'Plan wird überprüft...',
    uploadingFiles: 'Dateien werden hochgeladen...',
    planInvalidTitle: 'Plan ungültig',
    planInvalidMsg: 'Die KI konnte keine Raumbezeichnungen oder Maßstäbe erkennen. Bitte laden Sie einen lesbaren Grundriss hoch.',
    planInvalidNoSideView: 'Es wird mindestens eine Ansicht oder ein Schnitt (Seitenansicht) für die Dachklassifizierung benötigt. Bitte laden Sie einen Plan mit Grundriss und mindestens einer Ansicht/Schnitt hoch.',
    computeErrorTitle: 'Ein Problem ist aufgetreten',
    computeErrorMessage: 'Die Berechnung konnte nicht abgeschlossen werden. Bitte starten Sie ein neues Projekt und versuchen Sie es erneut.',
    computeErrorRetry: 'Erneut versuchen',
  },
} as const

/* Helpers: prioritate la label/placeholder din JSON (fallback), apoi DE */
function tStepLabel(key: string, fallback: string) {
  const fromJson = typeof fallback === 'string' && fallback.trim()
  return fromJson ? fallback : (DE.steps as any)?.[key] ?? key
}
function tFieldLabel(stepKey: string, fieldName: string, fallback: string | undefined) {
  if (fieldName === 'inaltimeEtaje') return 'Raumhöhe'
  const fromJson = typeof fallback === 'string' && fallback.trim()
  if (fromJson) return fallback
  const fb = fieldName ?? ''
  return (DE.fieldsGlobal as any)?.[fb] ?? fb
}
function tPlaceholder(stepKey: string, fieldName: string, fallback?: string) {
  return typeof fallback === 'string' && fallback.trim() ? fallback : undefined
}
function tOption(stepKey: string, fieldName: string, value: string) {
  return (DE.optionsGlobal as any)?.[value] ?? value
}

function asBool(v: any): boolean {
  if (v === true || v === 1) return true
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    return s === 'true' || s === '1' || s === 'yes' || s === 'ja' || s === 'on'
  }
  return false
}

const STEP_FIELD_PREFIXES: Record<string, string[]> = {
  wandaufbau: ['außenwande', 'innenwande'],
  bodenDeckeBelag: ['bodenaufbau', 'bodenbelag', 'deckenaufbau'],
  materialeFinisaj: ['finisajInterior', 'fatada'],
}

const STEP_FIELD_NAMES: Record<string, string[]> = {
  projektdaten: ['projektumfang', 'nutzungDachraum', 'deckenInnenausbau'],
  wintergaertenBalkone: ['wintergartenTyp', 'balkonTyp'],
  structuraCladirii: ['tipFundatieBeci', 'inaltimeEtaje', 'listaEtaje', 'pilons', 'hasWintergarden', 'hasBalkone', 'treppeTyp', 'floorsNumber'],
}

function extractStepData(stepKey: string, source: Record<string, any>, fields: Field[] = []): Record<string, any> {
  const out: Record<string, any> = {}
  const fieldNames = new Set<string>((Array.isArray(fields) ? fields : []).map((f) => f.name).filter(Boolean))
  for (const name of STEP_FIELD_NAMES[stepKey] ?? []) fieldNames.add(name)
  const prefixes = STEP_FIELD_PREFIXES[stepKey] ?? []

  for (const [key, value] of Object.entries(source ?? {})) {
    const matchesField = fieldNames.has(key)
    const matchesPrefix = prefixes.some((prefix) => key.startsWith(prefix))
    const matchesMansardaHeight = stepKey === 'structuraCladirii' && key.startsWith('inaltimePeretiMansarda_')
    if (matchesField || matchesPrefix || matchesMansardaHeight) {
      out[key] = value
    }
  }

  return out
}

/** Form + drafts + pasul curent (înainte ca setDrafts din stash să fie vizibil în state) → sursă pentru flush DB înainte de recomputare. */
function buildMergedWizardSource(
  form: Record<string, any>,
  drafts: Drafts,
  currentStepKey: string,
  currentFields: Field[],
): Record<string, any> {
  const base: Record<string, any> = {}
  for (const d of Object.values(drafts)) {
    if (d && typeof d === 'object') Object.assign(base, d)
  }
  Object.assign(base, extractStepData(currentStepKey, form, currentFields))
  return { ...base, ...form }
}

/* ================= VALIDATORS ================= */
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i
const phoneRe = /^[0-9+\s().-]{6,}$/

function validateClient(form: Record<string, any>): Errors {
  const e: Errors = {}
  const nume = (form.nume ?? '').trim()
  
  if (!nume) e.nume = 'Bitte den Namen eingeben.'
  // Rest ist optional für schnellen Test
  return e
}

function validateGeneric(stepKey: string, fields: Field[], form: Record<string, any>, drafts?: Record<string, any>): Errors {
  const e: Errors = {}
  const sistemConstructivData = stepKey === 'sistemConstructiv' ? form : (drafts?.sistemConstructiv || {})
  const nivelOferta = sistemConstructivData.nivelOferta || ''

  const shouldHideField = (fieldName: string): boolean => {
    const listaEtaje = Array.isArray(form.listaEtaje) ? form.listaEtaje : []
    const hasFloorAboveGround = listaEtaje.some((e: string) => e !== 'parter')
    if (stepKey === 'projektdaten' && fieldName === 'deckenInnenausbau') {
      return (form.nutzungDachraum ?? '') !== 'Wohnraum / ausgebaut'
    }
    if (stepKey === 'structuraCladirii' && fieldName === 'treppeTyp' && !hasFloorAboveGround) return true
    if (stepKey === 'daemmungDachdeckung' && fieldName === 'dachfensterTyp' && !asBool(form.dachfensterImDach)) return true
    if (stepKey === 'wintergaertenBalkone') {
      if (fieldName === 'wintergartenTyp' && !asBool(form.hasWintergarden)) return true
      if (fieldName === 'balkonTyp' && !asBool(form.hasBalkone)) return true
    }
    if (stepKey === 'ferestreUsi' && fieldName === 'garageDoorType' && !asBool(form.garagentorGewuenscht)) return true
    if ((stepKey === 'sistemConstructiv' || stepKey === 'structuraCladirii' || stepKey === 'materialeFinisaj') && fieldName === 'tipAcoperis') return true
    if (stepKey === 'structuraCladirii' && fieldName === 'floorsNumber') return true
    if (!nivelOferta) return false
    const nivelStr = String(nivelOferta).toLowerCase()
    const isCasaCompleta = nivelStr.includes('schlüsselfertig') || nivelStr.includes('completă') || nivelStr.includes('completa')
    if (stepKey === 'performantaEnergetica') return false
    if (stepKey !== 'materialeFinisaj') return false
    const isStructuraOnly = (nivelStr.includes('rohbau') || nivelStr.includes('tragwerk') || nivelStr.includes('structură'))
      && !nivelStr.includes('fenster') && !nivelStr.includes('ferestre') && !nivelStr.includes('completă') && !nivelStr.includes('schlüsselfertig')
    if (isStructuraOnly) return fieldName === 'tamplarie' || fieldName === 'finisajInterior'
    const isStructuraPlusFenestre = (nivelStr.includes('tragwerk') || nivelStr.includes('structură')) && (nivelStr.includes('fenster') || nivelStr.includes('ferestre'))
    if (isStructuraPlusFenestre) return fieldName === 'finisajInterior'
    return false
  }

  if (stepKey === 'structuraCladirii') {
    const listaEtaje = Array.isArray(form.listaEtaje) ? form.listaEtaje : []
    if (listaEtaje.length === 0) {
      e.listaEtaje = 'Bitte fügen Sie mindestens ein Element hinzu.'
    } else {
      const ultimulEtaj = listaEtaje[listaEtaje.length - 1]
      const isPod = ultimulEtaj === 'pod'
      const isMansarda = typeof ultimulEtaj === 'string' && ultimulEtaj.startsWith('mansarda')
      if (!isPod && !isMansarda) {
        e.listaEtaje = 'Das letzte Element muss ein Dachboden oder ein Dachgeschoss sein.'
      }
    }
    const wizardPackage = String((form as any).wizardPackage ?? '').toLowerCase()
    if (wizardPackage === 'aufstockung') {
      const floorKinds = Array.isArray((form as any).aufstockungFloorKinds) ? (form as any).aufstockungFloorKinds : []
      const hasNewFloor = floorKinds.some((k: unknown) => String(k).toLowerCase() === 'new')
      if (!hasNewFloor) e.aufstockungFloorKinds = 'Bitte markieren Sie mindestens ein neues Geschoss.'
    }
  }

  for (const f of fields) {
    if ((f as any).optional) continue
    if (f.type === 'bool') continue
    if (shouldHideField(f.name)) continue
    if (f.type === 'upload') {
      const v = (form as any)[f.name]
      if (!v || (Array.isArray(v) && v.length === 0)) e[f.name] = 'Bitte laden Sie mindestens eine Datei hoch.'
      continue
    }
    const v = (form as any)[f.name]
    if (f.type === 'select') {
      if (v === undefined || v === null || String(v).trim() === '') e[f.name] = 'Bitte wählen Sie eine Option aus.'
      continue
    }
    if (f.type === 'text' || f.type === 'textarea') {
      const str = String(v ?? '').trim()
      if (!str) e[f.name] = 'Dieses Feld ist erforderlich.'
      else if (str.length < 2) e[f.name] = 'Dieses Feld muss mindestens 2 Zeichen lang sein.'
      continue
    }
    if (f.type === 'number') {
      if (v === undefined || v === null || v === '') e[f.name] = 'Bitte geben Sie eine Zahl ein.'
      else if (isNaN(Number(v))) e[f.name] = 'Bitte geben Sie eine gültige Zahl ein.'
      continue
    }
  }
  return e
}


/* Helper: API poate returna options ca string[] sau { value, label }[] — normalizăm la valoare primitivă */
function optValue(opt: string | { value?: string; label?: string }): string {
  if (opt == null) return ''
  if (typeof opt === 'object' && 'value' in opt) return String((opt as any).value ?? '')
  return String(opt)
}

const FIELD_TAG_FALLBACK_BY_NAME: Record<string, string> = {
  daemmung: 'roof_insulation',
  unterdach: 'under_roof',
  dachstuhlTyp: 'roof_structure_type',
  dachdeckung: 'roof_covering',
  sichtdachstuhl: 'visible_roof_structure',
  dachfensterTyp: 'roof_skylight_type',
  deckenInnenausbau: 'decke_innenausbau',
}

/* =============== Select custom (PORTAL) =============== */
function SelectSun({
  value,
  onChange,
  options,
  placeholder = DE.common.selectPlaceholder,
  displayFor,
}:{
  value?: string
  onChange: (v: string) => void
  options: (string | { value?: string; label?: string })[]
  placeholder?: string
  displayFor?: (raw: string) => string
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number; width: number }>({ left: 0, top: 0, width: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)

  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect()
    if (!b) return
    setPos({ left: Math.round(b.left), top: Math.round(b.bottom + 6), width: Math.round(b.width) })
  }, [])

  useLayoutEffect(() => { if (open) place() }, [open, place])
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
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const show = (raw?: string) => raw ? (displayFor ? displayFor(raw) : raw) : placeholder

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        className={`sun-select ${open ? 'sun-select--open' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className={`truncate ${value ? 'text-ink' : 'text-neutral-500'}`}>{show(value)}</span>
        <ChevronDown size={16} className="shrink-0 opacity-80" />
      </button>

      {open && typeof window !== 'undefined' && createPortal(
        <div
          className="sun-menu themed-scroll"
          role="listbox"
          style={{ position: 'fixed', left: pos.left, top: pos.top, width: pos.width, zIndex: 9999 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {(options ?? []).map((opt, i) => {
            const val = optValue(opt)
            const active = val === value
            const label = displayFor ? displayFor(val) : (typeof opt === 'object' && opt !== null && 'label' in opt ? String((opt as any).label ?? val) : val)
            return (
              <button
                key={val != null && val !== '' ? `opt-${String(val)}-${i}` : `opt-${i}`}
                type="button"
                className={`sun-menu-item ${active ? 'is-active' : ''}`}
                onClick={() => { onChange(val); setOpen(false) }}
              >
                <span className="truncate">{label}</span>
                {active && <CheckCircle2 size={16} className="shrink-0" />}
              </button>
            )
          })}
        </div>,
        document.body
      )}
    </div>
  )
}

/* =============== Grid selector acoperiș =============== */
function RoofGridSelect({ value, onChange }:{ value?: string; onChange: (v: string) => void }) {
  return (
    <div className="rounded-xl border p-2 bg-coffee-850/80 border-white/10 shadow-soft shadow-black/40 backdrop-blur-xs max-h-[330px] overflow-y-auto pretty-scroll">
      <div className="grid gap-2 grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {ROOF_TYPES.map(r => {
          const active = r.name_de === value
          return (
            <button
              key={r.name_de}
              type="button"
              title={r.name_de}
              aria-pressed={active}
              onClick={() => onChange(r.name_de)}
              className={[
                'group relative rounded-lg p-2 text-center transition-transform duration-150 ease-out will-change-transform',
                'bg-[#6a4b39]/70 border border-[#e3c7ab22] hover:border-[#e3c7ab55]',
                active ? 'ring-2 ring-caramel/60 shadow-soft scale-[1.02] bg-[#6a4b39]/50' : 'hover:scale-[1.02] hover:shadow-soft hover:ring-1 hover:ring-caramel/35',
              ].join(' ')}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.img} alt={r.name_de} className="w-full h-26 object-contain rounded-md mx-auto bg-[#f1e6d3]/15" loading="lazy" decoding="async" />
              <div className="mt-1 text-center text-[12px] font-semibold leading-tight text-sand line-clamp-2">{r.name_de}</div>
              {active && (
                <div className="absolute top-1 right-1 bg-caramel text-ink rounded-full p-[2px] shadow"><CheckCircle2 size={13} /></div>
              )}
              <span className="pointer-events-none absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition ring-0 group-hover:ring-1 group-hover:ring-caramel/30" />
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ================= Helpers pentru PDF re-signed ================= */
async function probeUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}

/* MODIFICARE IMPORTANTĂ: Validare URL cu Guard */
async function fetchFreshPdfUrl(offerId: string | null): Promise<string | null> {
  if (!offerId) return null; 
  try {
    const r = await apiFetch(`/offers/${offerId}/export-url`)
    const url = r?.url || r?.download_url || r?.pdf
    if (!url) return null
    
    const ok = await probeUrl(url)
    return ok ? url : null
  } catch {
    return null
  }
}

/* ================= Wizard ================= */
export default function StepWizard() {
  // 1. Definim TOATE hook-urile la început (FĂRĂ condiții/returns înainte)
  const [dynamicSteps, setDynamicSteps] = useState<any[]>([])
  const [loadingForm, setLoadingForm] = useState(true)

  const [offerId, setOfferId] = useState<string | null>(null)
  const offerIdRef = useRef<string | null>(null)
  const [idx, setIdx] = useState(0)
  const [form, setForm] = useState<Record<string, any>>({})
  const [drafts, setDrafts] = useState<Drafts>({})
  
  const [saving, setSaving] = useState(false)
  const [processStatus, setProcessStatus] = useState<string>('')

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingStepsRef = useRef<Set<string>>(new Set())
  /** Coadă per step_key: evită return prematur și pierderea salvării la dublu-click pe Weiter. */
  const stepSaveChainRef = useRef<Record<string, Promise<void>>>({})
  const [editWizardPreparing, setEditWizardPreparing] = useState(false)
  const [editOfferEnterSeq, setEditOfferEnterSeq] = useState(0)
  const editWizardBootstrapRef = useRef(false)


  const creatingRef = useRef(false)
  const [computing, setComputing] = useState(false)
  const [computeFailed, setComputeFailed] = useState(false)
  const [computeRunId, setComputeRunId] = useState<string | null>(null)
  /** Run-ul curent pentru care acceptăm offer:pdf-ready (evită PDF/congrats din rulare anterioară). */
  const pdfReadyRunIdRef = useRef<string | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [computeStartTime, setComputeStartTime] = useState<number | null>(null)

  const [dir, setDir] = useState<'next' | 'back' | null>(null)
  const [animKey, setAnimKey] = useState(0)

  const [errors, setErrors] = useState<Errors>({})
  const [showErrors, setShowErrors] = useState(false)
  
  const [validationError, setValidationError] = useState<string | null>(null)
  /** null = closed; delete_offer = bisheriges Verhalten (Angebot löschen); abort_edit = Bearbeiten verlassen, PDF zurück */
  const [cancelDialog, setCancelDialog] = useState<null | 'delete_offer' | 'abort_edit'>(null)

  const [selectedPackage, setSelectedPackage] = useState<'mengen' | 'dachstuhl' | 'neubau' | 'aufstockung' | null>(null)
  const [packagePickerMengenSub, setPackagePickerMengenSub] = useState(false)
  /** Monatslimit für Projekte erreicht; Paket-Karten nicht klickbar. */
  const [tokensBlocked, setTokensBlocked] = useState(false)
  /** Pachet WIP: click pe Aufstockung/Zubau afișează banner „în dezvoltare". */
  const [wipNotice, setWipNotice] = useState<string | null>(null)

  /** „Angebot bearbeiten“: ohne Upload-Schritt (Variablen / Variablen+Erkennungen). */
  const [editOfferSkipUpload, setEditOfferSkipUpload] = useState(false)
  const [showEditOfferDialog, setShowEditOfferDialog] = useState(false)
  const [editDlgVars, setEditDlgVars] = useState(false)
  const [editDlgDet, setEditDlgDet] = useState(false)
  const [currentOfferMeasurementsOnly, setCurrentOfferMeasurementsOnly] = useState(false)
  const pendingPostEditorComputeRef = useRef(false)
  const editOfferBothAfterFormRef = useRef(false)
  /** Editor Erkennungen außerhalb eines laufenden Computes (Bearbeiten vom fertigen PDF). */
  const [editOfferDetectionsStandalone, setEditOfferDetectionsStandalone] = useState(false)
  const [measurementsOnlyFlow, setMeasurementsOnlyFlow] = useState(false)
  /** Editor verificare detecții: blueprint + overlay (camere, uși) – afișat în loc de GIF până la Approve */
  const [showDetectionsReview, setShowDetectionsReview] = useState(false)
  const [reviewImages, setReviewImages] = useState<Array<{ url: string; caption?: string }>>([])
  const [planReviewImages, setPlanReviewImages] = useState<Array<{ url: string; caption?: string }>>([])
  const [roofReviewImages, setRoofReviewImages] = useState<Array<{ url: string; caption?: string }>>([])
  /** Sincron cu meta `roof_only_offer` pentru UI-ul editorului unificat (state, nu doar ref). */
  const [activeRoofOnlyOffer, setActiveRoofOnlyOffer] = useState(false)

  /** Opțiuni custom per tag (din Preisdatenbank) – cu price_key pentru mapare etichete. */
  const [customOptionsForm, setCustomOptionsForm] = useState<Record<string, Array<{ label: string; value: string; price_key: string }>>>({})
  /** Override-uri de etichete pentru variabile (Preisdatenbank) – folosite la afișarea opțiunilor în formular. */
  const [paramLabelOverrides, setParamLabelOverrides] = useState<Record<string, string>>({})
  /** Chei ascunse în Preisdatenbank – nu le afișăm în formular (select-uri / opțiuni). */
  const [hiddenKeysForm, setHiddenKeysForm] = useState<Set<string>>(new Set())
  /** Währung nur Anzeige (EUR/CHF) – gleiche Zahlen wie in Preisdatenbank/PDF. */
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>('EUR')

  const lastProcessedCreationId = useRef<number>(0)
  const activeCreationPromise = useRef<Promise<string> | null>(null)
  const pendingOfferTypeIdRef = useRef<string | null>(null)
  /** Card „Dachstuhl“: ofertă doar acoperiș (meta + tip ofertă) */
  const roofOnlyOfferRef = useRef(false)
  /** Mengenermittlung-only: meta.measurements_only_offer cât mai devreme pentru eticheta din listă. */
  const measurementsOnlyFlowRef = useRef(false)
  /** Prevent reopening detections editor after it was approved in current run. */
  const detectionsReviewApprovedRef = useRef(false)
  /** Prevent reopening roof editor after it was approved in current run. */
  const roofReviewApprovedRef = useRef(false)
  const [offerTypesBySlug, setOfferTypesBySlug] = useState<Record<string, string>>({})
  /** Ultima stare a checkbox-urilor Wintergarten/Balkone pe pasul Gebäudestruktur – ca debifarea să nu fie suprascrisă de effect. */
  const structuraWinterBalkoneRef = useRef<{ hasWintergarden?: boolean; hasBalkone?: boolean }>({})
  const stepsScrollContainerRef = useRef<HTMLDivElement>(null)
  /** Invalidă GET /step în curs când se salvează sau se schimbă pasul/oferta – evită suprascrierea textului tastat. */
  const stepLoadNonceRef = useRef(0)
  /** Invalidă încărcarea ofertei când utilizatorul selectează altă ofertă înainte să termine request-urile. */
  const offerSelectNonceRef = useRef(0)
  /** Sursă de adevăr pentru vizibilitatea pasului Wintergärten & Balkone – actualizat la toggle pe Gebäudestruktur. */
  const [winterBalkoneFlags, setWinterBalkoneFlags] = useState<{ hasWintergarden: boolean; hasBalkone: boolean }>({ hasWintergarden: false, hasBalkone: false })

  const updateRunUrl = useCallback((offer: string | null, run: string | null) => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (offer) url.searchParams.set('offerId', offer)
    else url.searchParams.delete('offerId')
    if (run) url.searchParams.set('runId', run)
    else url.searchParams.delete('runId')
    window.history.replaceState(null, '', url.toString())
  }, [])
  useEffect(() => { offerIdRef.current = offerId }, [offerId])
  useEffect(() => {
    measurementsOnlyFlowRef.current = measurementsOnlyFlow
  }, [measurementsOnlyFlow])

  useEffect(() => {
    apiFetch('/offers/types')
      .then((r: unknown) => {
        const items = (r as { items?: Array<{ slug?: string; id?: string }> })?.items ?? []
        const m: Record<string, string> = {}
        for (const t of items) {
          if (t?.slug && t?.id) m[t.slug] = t.id
        }
        setOfferTypesBySlug(m)
      })
      .catch(() => {})
  }, [])

  // Dacă URL-ul conține offerId/runId, pornește automat aceeași ofertă/rulare (sharing între utilizatori)
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const url = new URL(window.location.href)
      const offerFromUrl = url.searchParams.get('offerId')
      const runFromUrl = url.searchParams.get('runId')
      if (!offerFromUrl) return
      if (runFromUrl) {
        void apiFetch(`/offers/${encodeURIComponent(offerFromUrl)}`)
          .then((o: any) => {
            const meta = o?.meta ?? o?.offer?.meta
            const slug = o?.offer_type_slug ?? o?.offer?.offer_type_slug
            const flow = inferOfferFlow({ ...meta, offer_type_slug: slug })
            window.dispatchEvent(
              new CustomEvent('offer:compute-started', {
                detail: { offerId: offerFromUrl, runId: runFromUrl, flow },
              }),
            )
          })
          .catch(() => {
            window.dispatchEvent(
              new CustomEvent('offer:compute-started', { detail: { offerId: offerFromUrl, runId: runFromUrl } }),
            )
          })
      } else {
        window.dispatchEvent(new CustomEvent('offer:selected', { detail: { offerId: offerFromUrl } }))
      }
    } catch {
      // ignore malformed URLs
    }
  }, [])

  // Ascundem pasul Wintergärten & Balkone dacă nici Wintergarten nici Balkone nu sunt bifate (folosim winterBalkoneFlags ca sursă de adevăr)
  // Ascundem pașii Finisaje și Performanță energetică când utilizatorul a ales doar structură sau structură + ferestre
  const visibleSteps = useMemo(() => {
    const hasWG = winterBalkoneFlags.hasWintergarden === true
    const hasB = winterBalkoneFlags.hasBalkone === true
    let steps = dynamicSteps
    if (editOfferSkipUpload) {
      steps = steps.filter((s: { key?: string }) => (s as { key?: string }).key !== 'upload')
    }
    if (!hasWG && !hasB) {
      steps = steps.filter((s: { key?: string }) => (s as any).key !== 'wintergaertenBalkone')
    }
    // nivelOferta stă în drafts['sistemConstructiv'] după ce părăsim pasul — mergeStepForm nu păstrează ...prev, deci form pierde câmpurile celorlalte pași
    const nivelRaw = (
      form.nivelOferta ||
      form.sistemConstructiv?.nivelOferta ||
      form.materialeFinisaj?.nivelOferta ||
      drafts.sistemConstructiv?.nivelOferta ||
      drafts.materialeFinisaj?.nivelOferta ||
      ''
    )
      .toString()
      .trim()
      .toLowerCase()
    const hasOpeningsInScope = nivelRaw.includes('fenster') || nivelRaw.includes('ferestre')
    const isFullHouse =
      nivelRaw.includes('completă') ||
      nivelRaw.includes('completa') ||
      nivelRaw.includes('schlüsselfertig') ||
      nivelRaw.includes('schlüsselfertiges haus')
    const isOnlyStructure =
      !hasOpeningsInScope &&
      !isFullHouse &&
      (nivelRaw.includes('rohbau') ||
        nivelRaw.includes('tragwerk') ||
        nivelRaw.includes('structură') ||
        nivelRaw.includes('structura'))
    const isStructurePlusWindows =
      hasOpeningsInScope &&
      !isFullHouse &&
      (nivelRaw.includes('rohbau') ||
        nivelRaw.includes('tragwerk') ||
        nivelRaw.includes('structură') ||
        nivelRaw.includes('structura'))
    if (isOnlyStructure || isStructurePlusWindows) {
      steps = steps.filter((s: { key?: string }) => {
        const key = (s as any).key
        return key !== 'materialeFinisaj' && key !== 'performantaEnergetica'
      })
      if (isOnlyStructure) {
        steps = steps.filter((s: { key?: string }) => (s as any).key !== 'ferestreUsi')
      }
    }
    return steps
  }, [
    dynamicSteps,
    winterBalkoneFlags.hasWintergarden,
    winterBalkoneFlags.hasBalkone,
    form.nivelOferta,
    form.sistemConstructiv,
    form.materialeFinisaj,
    drafts.sistemConstructiv,
    drafts.materialeFinisaj,
    editOfferSkipUpload,
  ])

  // -- UseMemo hooks (safe to run even if visibleSteps is empty)
  const step = visibleSteps[idx]
  const isFirst = idx === 0
  const isLast = idx === (visibleSteps.length > 0 ? visibleSteps.length - 1 : 0)

  const progressPct = useMemo(
    () => (visibleSteps.length > 1 ? Math.round((idx / (visibleSteps.length - 1)) * 100) : 0),
    [idx, visibleSteps.length]
  )

  const stepsMeta = useMemo(
    () => visibleSteps.map(s => tStepLabel((s as any).key, (s as any).label)),
    [visibleSteps]
  )

  // Bara de progres: afișăm întotdeauna TOȚI pașii (dynamicSteps), cei ascunși de nivelOferta sunt marcați ca „săriți” — structura nu se schimbă când ajungi la Gebäudestruktur
  const progressBarSteps = useMemo(() => {
    return visibleSteps.map((s: { key: string; label?: string }, i: number) => {
      const key = (s as any).key
      const label = tStepLabel(key, (s as any).label)
      const isDone = i < idx
      const isActive = i === idx
      return { key, label, isSkipped: false, isDone, isActive }
    })
  }, [visibleSteps, idx])

  // Scroll pașii orizontal ca pasul curent să fie vizibil (doar pașii „din jur” se văd, restul prin scroll)
  useEffect(() => {
    const container = stepsScrollContainerRef.current
    if (!container) return
    const activeEl = container.querySelector(`[data-step-index="${idx}"]`) as HTMLElement | null
    if (activeEl) activeEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [idx])

  const visibleErrors = showErrors ? errors : {}

  // Schema din data/form-schema/holzbau-form-steps.json (import static – la modificare fișier, salvează și refresh)
  const formStepsFromJson = useMemo(
    () => buildFormStepsFromJson(holzbauFormStepsJson as unknown),
    []
  )

  // Aceeași sursă ca Preisdatenbank: secțiunile din holzbau-form-steps.json (preisdatenbank.sections)
  const baseSectionsPreisdatenbank = useMemo(() => {
    try {
      const out = buildPriceSectionsFromFormStepsJson(holzbauFormStepsJson as unknown)
      return Array.isArray(out) ? out : []
    } catch {
      return []
    }
  }, [])

  // Elimină sufixul de unitate din label (ex: " (€/m²)", " (Faktor)") pentru a obține stringul folosit ca opțiune în formular
  const stripLabelForOption = useCallback((label: string) => {
    if (!label || typeof label !== 'string') return ''
    return label
      .replace(/\s*\(\s*€\/m²\s*\)\s*$/i, '')
      .replace(/\s*\(\s*€\s*\)\s*$/i, '')
      .replace(/\s*\(\s*€\/Stück\s*\)\s*$/i, '')
      .replace(/\s*\(\s*CHF\/m²\s*\)\s*$/i, '')
      .replace(/\s*\(\s*CHF\s*\)\s*$/i, '')
      .replace(/\s*\(\s*CHF\/Stück\s*\)\s*$/i, '')
      .replace(/\s*\(\s*CHF\/m\s*\)\s*$/i, '')
      .replace(/\s*\(\s*Faktor\s*\)\s*$/i, '')
      .replace(/\s*\(\s*€\/m\s*\)\s*$/i, '')
      .trim() || label
  }, [])

  // Opțiuni per tag = exact ce e în Preisdatenbank: variabile din secțiuni (neascunse) + opțiuni custom, în aceeași ordine
  const preisdatenbankOptionsByTag = useMemo(() => {
    const out: Record<string, string[]> = {}
    try {
      const sections = Array.isArray(baseSectionsPreisdatenbank) ? baseSectionsPreisdatenbank : []
      for (const sec of sections) {
        const subs = Array.isArray(sec?.subsections) ? sec.subsections : []
        for (const sub of subs) {
          const tag = sub?.fieldTag
          if (!tag) continue
          const options: string[] = Array.isArray(out[tag]) ? [...out[tag]] : []
          const vars = Array.isArray(sub?.variables) ? sub.variables : []
          for (const v of vars) {
            if (hiddenKeysForm?.has?.(v?.id)) continue
            const optStr = stripLabelForOption(v?.label ?? '')
            if (optStr && !options.includes(optStr)) options.push(optStr)
          }
          const custom = Array.isArray(customOptionsForm?.[tag]) ? customOptionsForm[tag] : []
          for (const o of custom) {
            const l = (o?.label || o?.value || '').trim()
            if (l && !options.includes(l)) options.push(l)
          }
          out[tag] = options
        }
      }
    } catch (_) {
      // fallback: obiect gol ca formularul să se încarce
    }
    return out
  }, [baseSectionsPreisdatenbank, hiddenKeysForm, customOptionsForm, stripLabelForOption])

  // Mapare option string -> price_key (pentru override etichete): din secțiuni Preisdatenbank + custom options
  const optionValueToPriceKey = useMemo(() => {
    const out: Record<string, Record<string, string>> = {}
    try {
      const sections = Array.isArray(baseSectionsPreisdatenbank) ? baseSectionsPreisdatenbank : []
      for (const sec of sections) {
        const subs = Array.isArray(sec?.subsections) ? sec.subsections : []
        for (const sub of subs) {
          const tag = sub?.fieldTag
          if (!tag) continue
          if (!out[tag]) out[tag] = {}
          const vars = Array.isArray(sub?.variables) ? sub.variables : []
          for (const v of vars) {
            const optStr = stripLabelForOption(v?.label ?? '')
            if (optStr && v?.id) out[tag][optStr] = v.id
          }
        }
      }
      if (customOptionsForm && typeof customOptionsForm === 'object') {
        for (const [tag, arr] of Object.entries(customOptionsForm)) {
          if (!Array.isArray(arr)) continue
          if (!out[tag]) out[tag] = {}
          for (const o of arr) {
            const l = (o?.label || o?.value || '').trim()
            if (l && o?.price_key) out[tag][l] = o.price_key
          }
        }
      }
    } catch (_) {
      // fallback
    }
    return out
  }, [baseSectionsPreisdatenbank, customOptionsForm, stripLabelForOption])

  useEffect(() => {
    setDynamicSteps(formStepsFromJson as any[])
    setLoadingForm(false)
  }, [formStepsFromJson])

  useEffect(() => {
    void apiFetch('/tenant-config')
      .then((c: unknown) => {
        const cfg = c as { displayCurrency?: string } | null
        setDisplayCurrency(normalizeDisplayCurrency(cfg?.displayCurrency))
      })
      .catch(() => {})
    const onSaved = () => {
      void apiFetch('/tenant-config')
        .then((c: unknown) => {
          const cfg = c as { displayCurrency?: string } | null
          setDisplayCurrency(normalizeDisplayCurrency(cfg?.displayCurrency))
        })
        .catch(() => {})
    }
    window.addEventListener('tenant-config:saved', onSaved)
    return () => window.removeEventListener('tenant-config:saved', onSaved)
  }, [])

  // 1b. Când user alege pachet (Dachstuhl vs Neubau/Mengen), folosim flow-ul corespunzător
  useEffect(() => {
    if (measurementsOnlyFlow && selectedPackage === 'dachstuhl') {
      const uploadOnly = (formStepsDachstuhl as any[]).filter((s) => s.key === 'upload')
      setDynamicSteps(uploadOnly.length ? uploadOnly : (formStepsDachstuhl as any[]))
      setIdx(0)
    } else if (measurementsOnlyFlow && (selectedPackage === 'neubau' || selectedPackage === 'aufstockung')) {
      const uploadOnly = (formStepsFromJson as any[]).filter((s) => s.key === 'upload')
      setDynamicSteps(uploadOnly.length ? uploadOnly : (formStepsFromJson as any[]))
      setIdx(0)
    } else if (selectedPackage === 'dachstuhl') {
      setDynamicSteps(formStepsDachstuhl as any[])
      setIdx(0)
    } else if ((selectedPackage === 'neubau' || selectedPackage === 'mengen' || selectedPackage === 'aufstockung') && formStepsFromJson.length > 0) {
      setDynamicSteps(formStepsFromJson as any[])
      setIdx(0)
    }
  }, [measurementsOnlyFlow, selectedPackage, formStepsFromJson])

  const fetchPricingParameters = useCallback(() => {
    // Întotdeauna reîmprospătăm datele din Preisdatenbank (indiferent de pachet), ca formularul să reflecte starea actuală
    const url = '/pricing-parameters?t=' + Date.now()
    apiFetch(url)
      .then((res: any) => {
        const hiddenArr = Array.isArray(res?.hiddenKeys) ? res.hiddenKeys.filter((k: unknown) => typeof k === 'string') as string[] : []
        const hiddenSet = new Set(hiddenArr)
        setHiddenKeysForm(hiddenSet)
        const co = res?.customOptions
        if (co && typeof co === 'object') {
          const filtered: Record<string, Array<{ label: string; value: string; price_key: string }>> = {}
          for (const [tag, arr] of Object.entries(co)) {
            const list = Array.isArray(arr) ? arr : []
            filtered[tag] = list
              .filter((o: { label?: string; value?: string; price_key?: string }) => !hiddenSet.has(String(o?.price_key ?? '')))
              .map((o: { label?: string; value?: string; price_key?: string }) => ({
                label: String(o?.label ?? ''),
                value: String(o?.value ?? ''),
                price_key: String(o?.price_key ?? ''),
              }))
          }
          setCustomOptionsForm(filtered)
        }
        const overrides = res?.paramLabelOverrides
        if (overrides && typeof overrides === 'object') setParamLabelOverrides(overrides)
      })
      .catch(() => {})
  }, [])

  useEffect(() => { fetchPricingParameters() }, [fetchPricingParameters])

  // Re-fetch la revenirea pe tab/fereastră sau după salvare în Preisdatenbank (mereu, ca datele să fie actualizate)
  useEffect(() => {
    const refetch = () => { fetchPricingParameters() }
    const onVisibility = () => { if (document.visibilityState === 'visible') refetch() }
    const onPricingSaved = () => { refetch() }
    window.addEventListener('focus', refetch)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pricing-parameters:saved', onPricingSaved)
    return () => {
      window.removeEventListener('focus', refetch)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pricing-parameters:saved', onPricingSaved)
    }
  }, [fetchPricingParameters])

  // 2. New Project Listener
  useEffect(() => {
    const handleNewProject = (e: Event) => {
      const detail = (e as CustomEvent).detail
      const creationId = detail?.creationId
      const offerTypeId = detail?.offerTypeId as string | undefined

      if (creationId && lastProcessedCreationId.current === creationId) return
      if (creationId) lastProcessedCreationId.current = creationId
      pendingOfferTypeIdRef.current = offerTypeId ?? null

      // Anulează încărcarea unei oferte selectate înainte (click rapid: ofertă veche → Neues Projekt).
      offerSelectNonceRef.current += 1
      stepLoadNonceRef.current += 1
      updateRunUrl(null, null)

      setOfferId(null)
      offerIdRef.current = null
      setIdx(0)
      setForm({})
      setDrafts({})
      setErrors({})
      setShowErrors(false)
      setValidationError(null)
      setPdfUrl(null)
      pdfReadyRunIdRef.current = null
      setComputing(false)
      setComputeFailed(false)
      setComputeRunId(null)
      setComputeStartTime(null)
      setSaveStatus('idle')
      setSelectedPackage(null)
      setMeasurementsOnlyFlow(false)
      roofOnlyOfferRef.current = false
      setActiveRoofOnlyOffer(false)
      creatingRef.current = false
      activeCreationPromise.current = null
    }

    window.addEventListener('offer:new', handleNewProject)
    return () => window.removeEventListener('offer:new', handleNewProject)
  }, [updateRunUrl])

  // 2b. Compute Started Listener — pentru restaurare după refresh (dashboard dispatch)
  useEffect(() => {
    const onComputeStarted = (e: any) => {
      const detail = e?.detail as { offerId?: string; runId?: string; flow?: OfferFlow }
      if (!detail?.offerId || !detail?.runId) return
      // Blochează evenimente întârziate (ex. HistoryList: history API după „Neues Projekt”).
      if (typeof window !== 'undefined') {
        const fromUrl = new URL(window.location.href).searchParams.get('offerId')
        if (fromUrl != null && fromUrl !== detail.offerId) return
        if (fromUrl == null && offerIdRef.current !== detail.offerId) return
      }
      const explicitFlow = detail.flow
      // Doar Aufstockung / Dachstuhl din eveniment sunt aplicate imediat; `neubau` explicit poate fi fals
      // (sessionStorage / default LiveFeed) și trebuie confirmat din meta la GET /offers.
      if (explicitFlow === 'aufstockung' || explicitFlow === 'dachstuhl') {
        const roFlow = explicitFlow === 'dachstuhl'
        roofOnlyOfferRef.current = roFlow
        setActiveRoofOnlyOffer(roFlow)
        const wp = explicitFlow === 'dachstuhl' ? 'dachstuhl' : 'aufstockung'
        setForm((prev) => ({ ...prev, wizardPackage: wp }))
        setSelectedPackage(explicitFlow)
      }
      detectionsReviewApprovedRef.current = false
      roofReviewApprovedRef.current = false
      setOfferId(detail.offerId)
      offerIdRef.current = detail.offerId
      pdfReadyRunIdRef.current = detail.runId
      setComputing(true)
      setComputeRunId(detail.runId)
      setComputeStartTime(Date.now())
      setPdfUrl(null)
      setComputeFailed(false)
      void apiFetch(`/offers/${detail.offerId}`)
        .then((o: unknown) => {
          const row = o as {
            meta?: { roof_only_offer?: boolean; wizard_package?: string | null }
            offer?: { meta?: { roof_only_offer?: boolean; wizard_package?: string | null }; offer_type_slug?: string | null }
          }
          const meta = row?.offer?.meta ?? row?.meta
          const slug = row?.offer?.offer_type_slug ?? null
          const resolvedWizardPackage = resolveOfferFlowWithExplicit(meta, slug, explicitFlow)
          const ro = resolvedWizardPackage === 'dachstuhl'
          roofOnlyOfferRef.current = ro
          setActiveRoofOnlyOffer(ro)
          const wpSet =
            resolvedWizardPackage === 'dachstuhl'
              ? 'dachstuhl'
              : resolvedWizardPackage === 'aufstockung'
                ? 'aufstockung'
                : 'neubau'
          setForm((prev) => ({ ...prev, wizardPackage: wpSet }))
          setSelectedPackage(
            resolvedWizardPackage === 'aufstockung'
              ? 'aufstockung'
              : ro
                ? 'dachstuhl'
                : 'neubau',
          )
        })
        .catch(() => {})
    }
    window.addEventListener('offer:compute-started', onComputeStarted as EventListener)
    return () => window.removeEventListener('offer:compute-started', onComputeStarted as EventListener)
  }, [])

  // 3. Clear Validation Error la schimbarea pasului (nu și la form – obiect nou la fiecare setForm → buclă infinită)
  useEffect(() => {
    setValidationError(null)
  }, [idx])

  // Ajustare idx când visibleSteps se scurtează (ex. ascundem performantaEnergetica)
  useEffect(() => {
    if (visibleSteps.length === 0) return
    if (idx >= visibleSteps.length) setIdx(Math.max(0, visibleSteps.length - 1))
  }, [visibleSteps.length, idx])

  // 4. PDF Ready Listener
  useEffect(() => {
    const onReady = (e: Event) => {
      const detail = (e as CustomEvent).detail as { offerId?: string; pdfUrl?: string; runId?: string }
      if (!detail?.pdfUrl) return
      const evRun = String(detail.runId || '').trim()
      if (evRun && pdfReadyRunIdRef.current && evRun !== pdfReadyRunIdRef.current) return
      if (offerId && detail.offerId && offerId !== detail.offerId) return
      if (detail.offerId) {
        const fromUrl =
          typeof window !== 'undefined' ? new URL(window.location.href).searchParams.get('offerId') : null
        if (fromUrl != null && fromUrl !== detail.offerId) return
        if (fromUrl == null && offerIdRef.current !== detail.offerId) return
      }

      // Close editors immediately once final PDF is ready (avoid brief "editor flash" before viewer).
      setShowDetectionsReview(false)
      setReviewImages([])
      setRoofReviewImages([])
      roofReviewApprovedRef.current = true

      const now = Date.now()
      const elapsed = computeStartTime ? now - computeStartTime : MIN_ANIMATION_TIME
      const remainingTime = Math.max(0, MIN_ANIMATION_TIME - elapsed)
      const oid = detail.offerId
      const expectedRunId = (detail as { runId?: string }).runId ?? pdfReadyRunIdRef.current

      setTimeout(() => {
        if (oid) {
          const fromUrl =
            typeof window !== 'undefined' ? new URL(window.location.href).searchParams.get('offerId') : null
          if (fromUrl != null && fromUrl !== oid) return
          if (fromUrl == null && offerIdRef.current !== oid) return
        }
        if (expectedRunId && pdfReadyRunIdRef.current && expectedRunId !== pdfReadyRunIdRef.current) return
        setPdfUrl(detail.pdfUrl || null)
        setComputing(false)
        setComputeRunId(null)
        pdfReadyRunIdRef.current = null
        setComputeStartTime(null)
        window.dispatchEvent(new Event('offers:refresh'))
        window.dispatchEvent(new Event('tokens:refresh'))
      }, remainingTime)
    }
    window.addEventListener('offer:pdf-ready', onReady as EventListener)
    return () => window.removeEventListener('offer:pdf-ready', onReady as EventListener)
  }, [offerId, computeStartTime])

  useEffect(() => {
    const load = async () => {
      try {
        const me = await apiFetch('/me')
        const t = me?.tokens as { unlimited?: boolean; limit?: number | null; used?: number } | undefined
        if (!t) {
          setTokensBlocked(false)
          return
        }
        const blocked =
          !t.unlimited && t.limit != null && typeof t.used === 'number' && t.used >= t.limit
        setTokensBlocked(blocked)
      } catch {
        setTokensBlocked(false)
      }
    }
    void load()
    const onTok = () => void load()
    window.addEventListener('tokens:refresh', onTok)
    return () => window.removeEventListener('tokens:refresh', onTok)
  }, [])

  // 4b. Compute Failed Listener
  useEffect(() => {
    const onFailed = (e: Event) => {
      const detail = (e as CustomEvent).detail as { offerId?: string }
      if (offerIdRef.current && detail?.offerId && detail.offerId !== offerIdRef.current) return
      setComputeFailed(true)
      setComputing(false)
      setComputeRunId(null)
      pdfReadyRunIdRef.current = null
    }
    window.addEventListener('offer:compute-failed', onFailed as EventListener)
    return () => window.removeEventListener('offer:compute-failed', onFailed as EventListener)
  }, [])

  // 4b2. Editor verificare detecții: când LiveFeed primește detections_review, afișăm overlay-urile în loc de GIF
  useEffect(() => {
    const onDetectionsReviewStart = () => {
      if (detectionsReviewApprovedRef.current) return
      setShowDetectionsReview(true)
    }
    window.addEventListener('offer:detections-review-start', onDetectionsReviewStart as EventListener)
    return () => window.removeEventListener('offer:detections-review-start', onDetectionsReviewStart as EventListener)
  }, [])
  useEffect(() => {
    const onReview = (e: Event) => {
      if (detectionsReviewApprovedRef.current) return
      const detail = (e as CustomEvent<{ files: Array<{ url: string; caption?: string }>; offerId?: string; runId?: string }>).detail
      const evOfferId = String(detail?.offerId ?? '').trim()
      const evRunId = String(detail?.runId ?? '').trim()
      if (evOfferId && offerIdRef.current && evOfferId !== offerIdRef.current) return
      if (evRunId && computeRunId && evRunId !== computeRunId) return
      const files = detail?.files ?? []
      if (files.length > 0) {
        setReviewImages(files)
        setPlanReviewImages(files)
        setShowDetectionsReview(true)
      }
    }
    window.addEventListener('offer:detections-review', onReview as EventListener)
    return () => window.removeEventListener('offer:detections-review', onReview as EventListener)
  }, [computeRunId])
  useEffect(() => {
    const onRoofReviewStart = () => {
      if (roofReviewApprovedRef.current) return
      setShowDetectionsReview(true)
    }
    window.addEventListener('offer:roof-review-start', onRoofReviewStart as EventListener)
    return () => window.removeEventListener('offer:roof-review-start', onRoofReviewStart as EventListener)
  }, [])
  useEffect(() => {
    const onRoofReview = (e: Event) => {
      if (roofReviewApprovedRef.current) return
      const detail = (e as CustomEvent<{ files: Array<{ url: string; caption?: string }>; offerId?: string; runId?: string }>).detail
      const evOfferId = String(detail?.offerId ?? '').trim()
      const evRunId = String(detail?.runId ?? '').trim()
      if (evOfferId && offerIdRef.current && evOfferId !== offerIdRef.current) return
      if (evRunId && computeRunId && evRunId !== computeRunId) return
      const files = detail?.files ?? []
      if (files.length === 0) return
      setRoofReviewImages(files)
      setShowDetectionsReview(true)
    }
    window.addEventListener('offer:roof-review', onRoofReview as EventListener)
    return () => window.removeEventListener('offer:roof-review', onRoofReview as EventListener)
  }, [computeRunId])
  useEffect(() => {
    const onDetectionsReviewApproved = () => {
      detectionsReviewApprovedRef.current = true
      setShowDetectionsReview(false)
      setReviewImages([])
      setRoofReviewImages([])
    }
    window.addEventListener('offer:detections-review-approved', onDetectionsReviewApproved as EventListener)
    return () => window.removeEventListener('offer:detections-review-approved', onDetectionsReviewApproved as EventListener)
  }, [])
  useEffect(() => {
    const onRoofReviewApproved = () => {
      roofReviewApprovedRef.current = true
    }
    window.addEventListener('offer:roof-review-approved', onRoofReviewApproved as EventListener)
    return () => window.removeEventListener('offer:roof-review-approved', onRoofReviewApproved as EventListener)
  }, [])
  useEffect(() => {
    if (!computing && !editOfferDetectionsStandalone) {
      setShowDetectionsReview(false)
      setReviewImages([])
      setRoofReviewImages([])
      setActiveRoofOnlyOffer(false)
    }
  }, [computing, editOfferDetectionsStandalone])

  // 4c. Poll calc-events direct în StepWizard (erori + trigger editoare), independent de LiveFeed
  const calcEventsSinceRef = useRef<number | undefined>(undefined)
  const calcEventsPollRunIdRef = useRef<string | null>(null)
  const calcEventsHandledIdsRef = useRef<Set<number>>(new Set())
  useEffect(() => {
    if (!computing || !computeRunId || computeFailed) return
    if (calcEventsPollRunIdRef.current !== computeRunId) {
      calcEventsPollRunIdRef.current = computeRunId
      calcEventsSinceRef.current = undefined
      calcEventsHandledIdsRef.current.clear()
    }
    const POLL_INTERVAL = 250
    const iv = setInterval(async () => {
      try {
        const since = calcEventsSinceRef.current
        const url = since != null
          ? `/calc-events?run_id=${encodeURIComponent(computeRunId)}&sinceId=${since}`
          : `/calc-events?run_id=${encodeURIComponent(computeRunId)}`
        const res = (await apiFetch(url)) as {
          items?: Array<{
            id: number
            level?: string
            message?: string
            payload?: { files?: Array<{ url?: string; caption?: string }> }
          }>
        }
        const items = res?.items ?? []
        for (const ev of items) {
          const nid = ev.id
          if (nid != null) {
            const prev = calcEventsSinceRef.current
            calcEventsSinceRef.current = prev == null ? nid : Math.max(prev, nid)
            if (calcEventsHandledIdsRef.current.has(nid)) continue
            calcEventsHandledIdsRef.current.add(nid)
          }
          const match = ev.message?.match(/^\s*\[([^\]]+)\]/)
          const stage = match?.[1]?.trim()
          const files = (ev.payload?.files ?? []).filter((f) => typeof f?.url === 'string' && f.url.length > 0) as Array<{ url: string; caption?: string }>

          // Dacă stream-ul a trecut deja de review, nu redeschidem editorul la refresh.
          if ([
            'scale_flood', 'detections', 'exterior_doors', 'count_objects', 'measure_objects',
            'perimeter', 'area', 'roof', 'pricing', 'offer_generation', 'pdf_generation', 'computation_complete',
          ].includes(stage || '')) {
            detectionsReviewApprovedRef.current = true
            setShowDetectionsReview(false)
          }
          if (['pricing', 'offer_generation', 'pdf_generation', 'computation_complete'].includes(stage || '')) {
            roofReviewApprovedRef.current = true
            setShowDetectionsReview(false)
          }

          if (stage === 'detections_review') {
            if (detectionsReviewApprovedRef.current) continue
            if (files.length === 0) continue
            window.dispatchEvent(new CustomEvent('offer:detections-review-start'))
            setReviewImages(files)
            setPlanReviewImages(files)
            setShowDetectionsReview(true)
          }
          if (stage === 'roof') {
            if (roofReviewApprovedRef.current) continue
            if (files.length === 0) continue
            window.dispatchEvent(new CustomEvent('offer:roof-review-start'))
            setRoofReviewImages(files)
            setShowDetectionsReview(true)
          }

          if (ev.level === 'error') {
            setComputeFailed(true)
            setComputing(false)
            setComputeRunId(null)
            return
          }
        }
      } catch (_) {}
    }, POLL_INTERVAL)
    return () => clearInterval(iv)
  }, [computing, computeRunId, computeFailed])

  // 4d. Fallback: poll offer status (failed or ready without PDF)
  // La restaurare după refresh nu rulăm check() imediat, ca să nu afișăm PDF-ul unei rulări anterioare dacă offer.status e încă 'ready'.
  useEffect(() => {
    if (!computing || !offerId || pdfUrl || computeFailed) return
    const POLL_MS = 2500
    const FIRST_CHECK_DELAY_MS = 4000
    let iv: ReturnType<typeof setInterval> | null = null
    const check = async () => {
      const oid = offerId
      try {
        if (offerIdRef.current !== oid) return
        const data = (await apiFetch(`/offers/${offerId}`)) as { offer?: { status?: string } }
        if (offerIdRef.current !== oid) return
        const status = data?.offer?.status
        if (status === 'failed') {
          if (iv) clearInterval(iv)
          iv = null
          setComputeFailed(true)
          setComputing(false)
          return
        }
        if (status === 'ready') {
          if (typeof window !== 'undefined') {
            const uRun = new URL(window.location.href).searchParams.get('runId')
            if (computeRunId && uRun && uRun !== computeRunId) return
          }
          const exportRes = await apiFetch(`/offers/${offerId}/export-url`).catch(() => null) as { url?: string; download_url?: string; pdf?: string } | null
          if (offerIdRef.current !== oid) return
          if (typeof window !== 'undefined') {
            const u = new URL(window.location.href).searchParams.get('offerId')
            if (u && u !== oid) return
          }
          const url = exportRes?.url || exportRes?.download_url || exportRes?.pdf
          if (iv) clearInterval(iv)
          iv = null
          if (url) {
            window.dispatchEvent(
              new CustomEvent('offer:pdf-ready', {
                detail: { offerId: oid, pdfUrl: url, runId: computeRunId || undefined },
              }),
            )
            window.dispatchEvent(new Event('tokens:refresh'))
          } else {
            setComputeFailed(true)
            setComputing(false)
          }
          return
        }
      } catch (_) {}
    }
    const startPolling = () => {
      check()
      iv = setInterval(check, POLL_MS)
    }
    const timeout = window.setTimeout(startPolling, FIRST_CHECK_DELAY_MS)
    return () => {
      clearTimeout(timeout)
      if (iv) clearInterval(iv)
    }
  }, [computing, offerId, pdfUrl, computeFailed, computeRunId])

  // 5. Offer Selected Listener — doar setăm offerId; NU suprascriem selectedPackage (altfel flow Dachstuhl s-ar transforma în Neubau după primul pas)
  useEffect(() => {
    const onSel = async (e: any) => {
      const id = e.detail.offerId as string
      if (!id) {
        offerSelectNonceRef.current += 1
        setSelectedPackage(null)
        setDrafts({})
        setForm({})
        setCurrentOfferMeasurementsOnly(false)
        setEditOfferSkipUpload(false)
        setEditOfferDetectionsStandalone(false)
        editOfferBothAfterFormRef.current = false
        pendingPostEditorComputeRef.current = false
        return
      }
      if (typeof window !== 'undefined') {
        const u = new URL(window.location.href).searchParams.get('offerId')
        if (u && u !== id) return
      }
      offerSelectNonceRef.current += 1
      const selNonce = offerSelectNonceRef.current
      stepLoadNonceRef.current += 1
      // Clean current wizard state before loading the newly selected offer
      setSelectedPackage(null)
      setWipNotice(null)
      setMeasurementsOnlyFlow(false)
      setEditOfferSkipUpload(false)
      setEditOfferDetectionsStandalone(false)
      editOfferBothAfterFormRef.current = false
      pendingPostEditorComputeRef.current = false
      setDrafts({})
      setForm({})
      setErrors({})
      setShowErrors(false)
      setValidationError(null)
      setComputeFailed(false)
      setComputeRunId(null)
      pdfReadyRunIdRef.current = null
      setPdfUrl(null)
      setComputing(false)
      setComputeStartTime(null)
      setProcessStatus('')
      setSaveStatus('idle')
      setIdx(0)

      setOfferId(id)
      offerIdRef.current = id
      try {
        const offerRow = (await apiFetch(`/offers/${id}`)) as {
          meta?: { roof_only_offer?: boolean; wizard_package?: string | null; measurements_only_offer?: boolean }
          offer?: {
            meta?: { roof_only_offer?: boolean; wizard_package?: string | null; measurements_only_offer?: boolean }
            offer_type_slug?: string | null
          }
        }
        if (selNonce !== offerSelectNonceRef.current) return
        if (typeof window !== 'undefined') {
          const u = new URL(window.location.href).searchParams.get('offerId')
          if (u && u !== id) return
        }
        const offerMeta = offerRow?.offer?.meta ?? offerRow?.meta
        const slug = offerRow?.offer?.offer_type_slug ?? null
        const resolvedWizardPackage = inferOfferFlow({
          ...(offerMeta as OfferFlowMeta | null),
          offer_type_slug: slug ?? undefined,
        })
        const ro = resolvedWizardPackage === 'dachstuhl'
        roofOnlyOfferRef.current = ro
        setActiveRoofOnlyOffer(ro)
        setForm((prev) => ({ ...prev, wizardPackage: resolvedWizardPackage }))
        setSelectedPackage(
          resolvedWizardPackage === 'aufstockung'
            ? 'aufstockung'
            : ro
              ? 'dachstuhl'
              : 'neubau',
        )
        setCurrentOfferMeasurementsOnly(offerMeta?.measurements_only_offer === true)
      } catch {
        if (selNonce !== offerSelectNonceRef.current) return
        if (typeof window !== 'undefined') {
          const u = new URL(window.location.href).searchParams.get('offerId')
          if (u && u !== id) return
        }
        roofOnlyOfferRef.current = false
        setActiveRoofOnlyOffer(false)
        setCurrentOfferMeasurementsOnly(false)
      }
      if (selNonce !== offerSelectNonceRef.current) return
      if (typeof window !== 'undefined') {
        const u = new URL(window.location.href).searchParams.get('offerId')
        if (u && u !== id) return
      }
      try {
        const fresh = await fetchFreshPdfUrl(id)
        if (selNonce !== offerSelectNonceRef.current) return
        if (typeof window !== 'undefined') {
          const u = new URL(window.location.href).searchParams.get('offerId')
          if (u && u !== id) return
        }
        if (fresh) {
          setPdfUrl(fresh)
          setComputing(false)
        } else {
          setPdfUrl(null)
        }
        try {
          const stepsData = await apiFetch(`/offers/${id}/steps`).catch(() => null)
          if (selNonce !== offerSelectNonceRef.current) return
          if (typeof window !== 'undefined') {
            const u = new URL(window.location.href).searchParams.get('offerId')
            if (u && u !== id) return
          }
          if (stepsData && typeof stepsData === 'object') {
            setDrafts(stepsData)
          }
        } catch {
          // Endpoint might not exist
        }
      } catch {
        if (selNonce !== offerSelectNonceRef.current) return
        if (typeof window !== 'undefined') {
          const u = new URL(window.location.href).searchParams.get('offerId')
          if (u && u !== id) return
        }
        setPdfUrl(null)
      }
    }
    window.addEventListener('offer:selected', onSel)
    return () => window.removeEventListener('offer:selected', onSel)
  }, [])

  // 6. Update Form State on Step Change (ca pe VPS)
  // structuraCladirii + wintergaertenBalkone: folosim ref / prev pentru hasWintergarden/hasBalkone ca debifarea să persiste
  // și ca pe pasul Wintergärten & Balkone să apară doar secțiunile pentru opțiunile încă bifate.
  function mergeStepForm(key: string, loaded: Record<string, any>, prev: Record<string, any>): Record<string, any> {
    if (!loaded || typeof loaded !== 'object') return loaded
    const r = structuraWinterBalkoneRef.current
    const keepFlagsFromUser = (key === 'structuraCladirii' || key === 'wintergaertenBalkone')
    if (keepFlagsFromUser) {
      return {
        ...loaded,
        hasWintergarden: r.hasWintergarden ?? prev.hasWintergarden ?? loaded.hasWintergarden,
        hasBalkone: r.hasBalkone ?? prev.hasBalkone ?? loaded.hasBalkone,
      }
    }
    return {
      ...loaded,
      hasWintergarden: loaded.hasWintergarden ?? prev.hasWintergarden,
      hasBalkone: loaded.hasBalkone ?? prev.hasBalkone,
    }
  }

  // Încărcare date pas: doar când idx sau offerId se schimbă (fără currentStepKey/form ca să nu retrigărăm la fiecare setForm → Maximum update depth).
  useEffect(() => {
    const key = visibleSteps[idx]?.key
    const finishEditBootstrap = () => {
      if (!editWizardBootstrapRef.current) return
      editWizardBootstrapRef.current = false
      setEditWizardPreparing(false)
    }
    const scheduleFinishBootstrap = (token: number) => {
      queueMicrotask(() => {
        if (token !== stepLoadNonceRef.current) return
        finishEditBootstrap()
      })
    }
    if (visibleSteps.length === 0 || !key) {
      if (editOfferSkipUpload) finishEditBootstrap()
      return
    }
    stepLoadNonceRef.current += 1
    const loadNonce = stepLoadNonceRef.current

    const draftData = drafts[key]
    const applyMerge = (prev: Record<string, any>, loaded: Record<string, any>) => {
      const merged = mergeStepForm(key, extractStepData(key, loaded, step?.fields ?? []), prev)
      if (key === 'structuraCladirii') {
        structuraWinterBalkoneRef.current = {
          hasWintergarden: merged.hasWintergarden ?? structuraWinterBalkoneRef.current.hasWintergarden,
          hasBalkone: merged.hasBalkone ?? structuraWinterBalkoneRef.current.hasBalkone,
        }
        setWinterBalkoneFlags({
          hasWintergarden: merged.hasWintergarden === true,
          hasBalkone: merged.hasBalkone === true,
        })
      }
      return merged
    }
    /** După merge cu server/draft, păstrăm câmpurile deja editate în UI (prev câștigă la conflicte). */
    const loadIntoForm = (prev: Record<string, any>, loaded: Record<string, any>) => {
      const merged = applyMerge(prev, loaded)
      return { ...merged, ...prev }
    }
    if (draftData && Object.keys(draftData).length > 0) {
      setForm(prev => loadIntoForm(prev, draftData))
      scheduleFinishBootstrap(loadNonce)
    } else if (offerId) {
      apiFetch(`/offers/${offerId}/step?step_key=${encodeURIComponent(key)}`)
        .then((data: any) => {
          if (loadNonce !== stepLoadNonceRef.current) return
          const stepData = data?.data
          if (stepData && Object.keys(stepData).length > 0) {
            const scopedStepData = extractStepData(key, stepData, step?.fields ?? [])
            setDrafts(prev => ({ ...prev, [key]: scopedStepData }))
            setForm(prev => loadIntoForm(prev, scopedStepData))
          } else {
            const defaultForStep = key === 'structuraCladirii' ? { tipFundatieBeci: 'Kein Keller (nur Bodenplatte)', inaltimeEtaje: 'Standard (2,50 m)' } : {}
            setForm(prev => loadIntoForm(prev, defaultForStep))
          }
          if (loadNonce === stepLoadNonceRef.current) finishEditBootstrap()
        })
        .catch(() => {
          if (loadNonce !== stepLoadNonceRef.current) return
          const defaultForStep = key === 'structuraCladirii' ? { tipFundatieBeci: 'Kein Keller (nur Bodenplatte)', inaltimeEtaje: 'Standard (2,50 m)' } : {}
          setForm(prev => loadIntoForm(prev, defaultForStep))
          finishEditBootstrap()
        })
    } else {
      const defaultForStep = key === 'structuraCladirii' ? { tipFundatieBeci: 'Kein Keller (nur Bodenplatte)', inaltimeEtaje: 'Standard (2,50 m)' } : {}
      setForm(prev => loadIntoForm(prev, defaultForStep))
      scheduleFinishBootstrap(loadNonce)
    }
    setErrors({})
    setShowErrors(false)
    // intenționat fără visibleSteps/currentStepKey în deps – altfel setForm(merged) → re-render → effect din nou → buclă
  }, [idx, offerId, editOfferSkipUpload, editOfferEnterSeq])

  const loadDetectionsReviewFromHistory = useCallback(async (oid: string, includeRoof: boolean): Promise<boolean> => {
    const historyData = (await apiFetch(
      `/calc-events/history?offer_id=${encodeURIComponent(oid)}&prefer_detections_review=1`,
    )) as {
      items?: Array<{
        message?: string
        payload?: { files?: Array<{ url?: string; caption?: string }> }
      }>
    }
    const items = historyData?.items ?? []
    let best: Array<{ url: string; caption?: string }> = []
    let roofBest: Array<{ url: string; caption?: string }> = []
    for (const ev of items) {
      const m = ev.message?.match(/^\s*\[([^\]]+)\]/)
      const stage = m?.[1]?.trim() ?? ''
      const raw = (ev.payload?.files ?? []) as Array<{ url?: string; caption?: string }>
      const files = raw.filter((f): f is { url: string; caption?: string } => typeof f.url === 'string' && f.url.length > 0)
      if (stage === 'detections_review' && files.length > best.length) {
        best = files
      }
      if (includeRoof && stage === 'roof' && files.length > 0) {
        roofBest = files
      }
    }
    if (best.length === 0) return false
    setReviewImages(best)
    setPlanReviewImages(best)
    if (includeRoof) setRoofReviewImages(roofBest)
    else setRoofReviewImages([])
    return true
  }, [])

  const startEditResumeCompute = useCallback(
    async (mode: 'variables' | 'post_editor') => {
      const id = offerIdRef.current
      if (!id) return
      try {
        const cur = (await apiFetch(`/offers/${id}`)) as {
          meta?: Record<string, unknown>
          offer?: { meta?: Record<string, unknown>; offer_type_slug?: string | null }
          offer_type_slug?: string | null
        }
        const currentMeta = (cur?.meta ?? cur?.offer?.meta ?? {}) as Record<string, unknown>
        const slug = cur?.offer_type_slug ?? cur?.offer?.offer_type_slug
        const resumeFlow = inferOfferFlow({ ...currentMeta, offer_type_slug: slug })
        const meta = {
          ...currentMeta,
          edit_recompute_mode: mode,
          reuse_offer_no: true,
        }
        await apiFetch(`/offers/${id}`, { method: 'PATCH', body: JSON.stringify({ meta }) })
        let run_id: string
        try {
          const started = (await apiFetch(`/offers/${id}/compute`, {
            method: 'POST',
            body: JSON.stringify({ payload: {} }),
            timeoutMs: 180_000,
          })) as { run_id: string }
          run_id = started.run_id
        } catch (computeErr) {
          try {
            const cur2 = (await apiFetch(`/offers/${id}`)) as {
              meta?: Record<string, unknown>
              offer?: { meta?: Record<string, unknown> }
            }
            const m2 = { ...(cur2?.meta ?? cur2?.offer?.meta ?? {}) } as Record<string, unknown>
            delete m2.edit_recompute_mode
            delete m2.reuse_offer_no
            await apiFetch(`/offers/${id}`, { method: 'PATCH', body: JSON.stringify({ meta: m2 }) })
          } catch {
            /* best-effort rollback */
          }
          throw computeErr
        }
        setPdfUrl(null)
        pdfReadyRunIdRef.current = run_id
        setComputeFailed(false)
        setComputing(true)
        setComputeStartTime(Date.now())
        setComputeRunId(run_id)
        updateRunUrl(id, run_id)
        setEditOfferSkipUpload(false)
        editOfferBothAfterFormRef.current = false
        setEditOfferDetectionsStandalone(false)
        pendingPostEditorComputeRef.current = false
        window.dispatchEvent(
          new CustomEvent('offer:compute-started', {
            detail: {
              offerId: id,
              runId: run_id,
              flow: roofOnlyOfferRef.current ? 'dachstuhl' : resumeFlow,
            },
          }),
        )
        window.dispatchEvent(new Event('offers:refresh'))
      } catch (err: unknown) {
        console.error('Edit resume compute failed:', err)
        const msg = err instanceof Error ? err.message : String(err)
        alert(msg)
      }
    },
    [updateRunUrl],
  )

  const abortEditOfferFlow = useCallback(async () => {
    const id = offerIdRef.current
    editWizardBootstrapRef.current = false
    setEditWizardPreparing(false)
    setEditOfferSkipUpload(false)
    setEditOfferDetectionsStandalone(false)
    editOfferBothAfterFormRef.current = false
    pendingPostEditorComputeRef.current = false
    detectionsReviewApprovedRef.current = false
    roofReviewApprovedRef.current = false
    setShowDetectionsReview(false)
    setReviewImages([])
    setRoofReviewImages([])
    setShowEditOfferDialog(false)
    setSaving(false)
    setIdx(0)
    if (id) {
      try {
        const fresh = await fetchFreshPdfUrl(id)
        if (fresh) setPdfUrl(fresh)
        else setPdfUrl(null)
      } catch {
        setPdfUrl(null)
      }
      window.dispatchEvent(new Event('offers:refresh'))
    } else {
      setPdfUrl(null)
    }
  }, [])

  const handleEditOfferDialogStart = useCallback(async () => {
    const id = offerIdRef.current
    if (!id) return
    const wantVars = editDlgVars && !currentOfferMeasurementsOnly
    const wantDet = editDlgDet
    if (!wantVars && !wantDet) return

    let offerMeta: Record<string, unknown> = {}
    try {
      const row = (await apiFetch(`/offers/${id}`)) as {
        meta?: Record<string, unknown>
        offer?: { meta?: Record<string, unknown> }
      }
      offerMeta = (row?.meta ?? row?.offer?.meta ?? {}) as Record<string, unknown>
    } catch {
      alert('Angebot konnte nicht geladen werden.')
      return
    }
    const lastEngine = String(offerMeta.last_engine_run_id ?? '').trim()
    if (!lastEngine) {
      alert(
        'Bearbeiten ist noch nicht möglich: die erste Berechnung muss vollständig abgeschlossen sein (kein gespeicherter Rechenlauf).',
      )
      return
    }

    setShowEditOfferDialog(false)
    const ro = roofOnlyOfferRef.current || activeRoofOnlyOffer
    const wp = String(offerMeta?.wizard_package ?? '').toLowerCase()
    const editPackage: 'dachstuhl' | 'aufstockung' | 'neubau' = ro ? 'dachstuhl' : (wp === 'aufstockung' ? 'aufstockung' : 'neubau')
    if (wantVars) {
      setSelectedPackage(editPackage)
    } else if (wantDet) {
      setSelectedPackage(editPackage)
    }

    detectionsReviewApprovedRef.current = false
    roofReviewApprovedRef.current = false

    if (wantDet && !wantVars) {
      setSaving(true)
      try {
        setPdfUrl(null)
        const includeRoof = ro
        const ok = await loadDetectionsReviewFromHistory(id, includeRoof)
        if (!ok) {
          alert('Keine Erkennungs-Vorschau in der Historie gefunden.')
          const fresh = await fetchFreshPdfUrl(id)
          if (fresh) setPdfUrl(fresh)
          return
        }
        pendingPostEditorComputeRef.current = true
        setEditOfferDetectionsStandalone(true)
        setShowDetectionsReview(true)
      } finally {
        setSaving(false)
      }
      return
    }

    if (wantVars && !wantDet) {
      editWizardBootstrapRef.current = true
      setEditWizardPreparing(true)
      setEditOfferEnterSeq((s) => s + 1)
      setEditOfferSkipUpload(true)
      editOfferBothAfterFormRef.current = false
      pendingPostEditorComputeRef.current = false
      setPdfUrl(null)
      setIdx(0)
      return
    }

    editWizardBootstrapRef.current = true
    setEditWizardPreparing(true)
    setEditOfferEnterSeq((s) => s + 1)
    setEditOfferSkipUpload(true)
    editOfferBothAfterFormRef.current = true
    pendingPostEditorComputeRef.current = false
    setPdfUrl(null)
    setIdx(0)
  }, [
    activeRoofOnlyOffer,
    currentOfferMeasurementsOnly,
    editDlgDet,
    editDlgVars,
    loadDetectionsReviewFromHistory,
  ])

  // -- Helper Functions
  async function ensureOffer(): Promise<string> {
    if (offerIdRef.current) {
      const oid = offerIdRef.current
      try {
        const cur = (await apiFetch(`/offers/${oid}`)) as {
          meta?: Record<string, unknown>
          offer?: { meta?: Record<string, unknown> }
        }
        const m = { ...(cur?.meta ?? cur?.offer?.meta ?? {}) }
        let dirty = false
        if (roofOnlyOfferRef.current) {
          if (m.roof_only_offer !== true || m.wizard_package !== 'dachstuhl') dirty = true
          m.roof_only_offer = true
          m.wizard_package = 'dachstuhl'
        }
        if (measurementsOnlyFlowRef.current && m.measurements_only_offer !== true) {
          m.measurements_only_offer = true
          dirty = true
        }
        if (dirty) {
          await apiFetch(`/offers/${oid}`, { method: 'PATCH', body: JSON.stringify({ meta: m }) })
          window.dispatchEvent(new Event('offers:refresh'))
        }
      } catch (_) {
        /* non-fatal */
      }
      return oid
    }
    if (activeCreationPromise.current) return activeCreationPromise.current

    if (creatingRef.current) {
      return new Promise((resolve) => {
        const iv = setInterval(() => {
          if (offerIdRef.current) {
            clearInterval(iv)
            resolve(offerIdRef.current!)
          }
        }, 50)
      })
    }

    creatingRef.current = true
    const promise = (async () => {
      try {
        const selectedPackageOfferTypeId =
          selectedPackage === 'aufstockung'
            ? (offerTypesBySlug['aufstockung'] ?? null)
            : selectedPackage === 'dachstuhl'
              ? (offerTypesBySlug['dachstuhl'] ?? null)
              : selectedPackage === 'neubau'
                ? (offerTypesBySlug['neubau'] ?? null)
                : null
        const offer_type_id =
          selectedPackageOfferTypeId ||
          pendingOfferTypeIdRef.current ||
          (roofOnlyOfferRef.current && offerTypesBySlug['dachstuhl'] ? offerTypesBySlug['dachstuhl'] : null)
        const created = await apiFetch('/offers', {
          method: 'POST',
          body: JSON.stringify(
            offer_type_id
              ? { title: 'Ofertă nouă', offer_type_id }
              : { title: 'Ofertă nouă' }
          )
        })
        const metaPatch: Record<string, unknown> = {}
        if (roofOnlyOfferRef.current) {
          metaPatch.roof_only_offer = true
          metaPatch.wizard_package = 'dachstuhl'
        } else if (selectedPackage === 'aufstockung') {
          metaPatch.roof_only_offer = false
          metaPatch.wizard_package = 'aufstockung'
          const floorKinds = Array.isArray(form.aufstockungFloorKinds)
            ? form.aufstockungFloorKinds.map((k: unknown) => (String(k).toLowerCase() === 'new' ? 'new' : 'existing'))
            : []
          metaPatch.aufstockung_floor_kinds = floorKinds
        }
        if (measurementsOnlyFlowRef.current) {
          metaPatch.measurements_only_offer = true
        }
        if (Object.keys(metaPatch).length > 0) {
          try {
            await apiFetch(`/offers/${created.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ meta: metaPatch }),
            })
          } catch (_) {}
        }
        offerIdRef.current = created.id
        setOfferId(created.id)
        window.dispatchEvent(new CustomEvent('offer:selected', { detail: { offerId: created.id } }))
        window.dispatchEvent(new Event('offers:refresh'))
        return created.id as string
      } finally {
        creatingRef.current = false
        activeCreationPromise.current = null
      }
    })()
    activeCreationPromise.current = promise
    return promise
  }

  function stashDraft(next?: Partial<Record<string, any>>) {
    if(!step) return
    const key = step.key
    const updated = {
      ...(drafts[key] ?? {}),
      ...extractStepData(key, next ?? form, step.fields),
    }
    setDrafts(prev => ({ ...prev, [key]: updated }))
  }

  async function saveStepLive(stepKey: string, dataObj: Record<string, any>) {
    const prev = stepSaveChainRef.current[stepKey] ?? Promise.resolve()
    const next = prev.catch(() => {}).then(async () => {
      savingStepsRef.current.add(stepKey)
      try {
        setSaveStatus('saving')
        const id = await ensureOffer()
        await apiFetch(`/offers/${id}/step`, { method: 'POST', body: JSON.stringify({ step_key: stepKey, data: dataObj }) })
        setDrafts(prevD => ({ ...prevD, [stepKey]: dataObj }))
        stepLoadNonceRef.current += 1
        await maybeUpdateOfferTitle(id)
        if (stepKey === 'dateGenerale') {
          if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
          refreshTimerRef.current = setTimeout(() => window.dispatchEvent(new Event('offers:refresh')), 500)
        }
        setSaveStatus('saved')
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
        savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 1600)
      } catch (e) {
        console.error('saveStepLive failed', e)
        setSaveStatus('error')
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
        savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
      } finally {
        setTimeout(() => savingStepsRef.current.delete(stepKey), 300)
      }
    })
    stepSaveChainRef.current[stepKey] = next
    await next
  }

  /** Scrie toți pașii din wizard în offer_steps înainte de recomputare (PDF/Preis din DB). */
  async function flushAllWizardStepsToDb() {
    if (!step) return
    const id = await ensureOffer()
    const merged = buildMergedWizardSource(form, drafts, step.key, step.fields ?? [])
    setSaveStatus('saving')
    try {
      for (const st of dynamicSteps) {
        const k = (st as { key?: string }).key
        if (!k || k === 'upload') continue
        const dataObj = extractStepData(k, merged, (st as { fields?: Field[] }).fields ?? [])
        await apiFetch(`/offers/${id}/step`, { method: 'POST', body: JSON.stringify({ step_key: k, data: dataObj }) })
        setDrafts(prev => ({ ...prev, [k]: dataObj }))
      }
      stepLoadNonceRef.current += 1
      await maybeUpdateOfferTitle(id)
      setSaveStatus('saved')
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 1600)
    } catch (e) {
      console.error('flushAllWizardStepsToDb failed', e)
      setSaveStatus('error')
      throw e
    }
  }

  /** Actualizare formular în memorie; salvare pe server doar la „Weiter” (onContinue). */
  function applyFormUpdate(
    _stepKey: string,
    v: Record<string, any> | ((prev: Record<string, any>) => Record<string, any>)
  ) {
    ensureOffer().catch(() => {})
    if (typeof v === 'function') {
      setForm(v as (p: Record<string, any>) => Record<string, any>)
    } else {
      setForm(v)
    }
  }

  function validateCurrentStep(): Errors {
    if (!step) return {}
    if (step.key === 'client') return validateClient(form)
    if (step.key === 'dateGenerale') {
      const e: Errors = {}
      const referinta = (form.referinta ?? '').trim()
      if (!referinta) e.referinta = 'Bitte geben Sie eine Referenz ein.'
      else if (referinta.length < 3) e.referinta = 'Die Referenz muss mindestens 3 Zeichen lang sein.'
      return e
    }
    if (step.key === 'upload') return {}
    return validateGeneric(step.key, step.fields, form, drafts)
  }

  async function uploadSingleFile(id: string, fieldName: string, file: File): Promise<{ storagePath: string, mime: string }> {
     const contentType = file.type || 'application/octet-stream'
     const presign = await apiFetch(`/offers/${id}/file/presign`, {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, contentType, size: file.size })
      })

     const putRes = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
          'Authorization': `Bearer ${presign.uploadToken}`,
          'x-upsert': 'true',
        },
        body: file
      })
      if (!putRes.ok) {
        const bodyText = await putRes.text().catch(() => '')
        console.error(`Upload PUT failed for ${file.name}:`, putRes.status, putRes.statusText, bodyText)
        const detail = bodyText ? ` (${bodyText.slice(0, 120)})` : ` (${putRes.status} ${putRes.statusText})`
        throw new Error(`Upload failed for ${file.name}${detail}`)
      }

      await apiFetch(`/offers/${id}/file`, {
        method: 'POST',
        body: JSON.stringify({
          storagePath: presign.storagePath,
          meta: { filename: file.name, kind: fieldName, mime: contentType, size: file.size }
        })
      })
      return { storagePath: presign.storagePath, mime: contentType };
  }

  async function onContinue() {
    if (!step) return
    try {
      setSaving(true)
      setValidationError(null)

      const stepErrors = validateCurrentStep()
      setErrors(stepErrors)
      const hasErrors = Object.values(stepErrors).some(Boolean)
      if (hasErrors && step.key !== 'upload') {
        setShowErrors(true)
        setSaving(false)
        return
      }

      setShowErrors(false)
      stashDraft()

      const skipSingleSaveForEditFlush = editOfferSkipUpload && isLast

      if (step.key !== 'upload' && !skipSingleSaveForEditFlush) {
        try {
          await saveStepLive(step.key, extractStepData(step.key, form, step.fields))
        } catch (_) {}
      }

      if (!isLast) {
        setDir('next')
        setIdx(i => Math.min(i + 1, visibleSteps.length - 1))
        setAnimKey(k => k + 1)
        setSaving(false)
        return
      }

      if (editOfferSkipUpload && isLast) {
        const eid = offerIdRef.current
        if (!eid) {
          setSaving(false)
          return
        }
        if (editOfferBothAfterFormRef.current) {
          try {
            await flushAllWizardStepsToDb()
            const includeRoof = roofOnlyOfferRef.current || activeRoofOnlyOffer || selectedPackage === 'dachstuhl'
            const ok = await loadDetectionsReviewFromHistory(eid, includeRoof)
            if (!ok) {
              alert(
                'Keine Erkennungs-Vorschau in der Historie gefunden. Die Berechnung muss mindestens einmal bis zur Prüfung der Erkennungen gelaufen sein.',
              )
              setSaving(false)
              return
            }
            pendingPostEditorComputeRef.current = true
            detectionsReviewApprovedRef.current = false
            roofReviewApprovedRef.current = false
            setEditOfferDetectionsStandalone(true)
            setShowDetectionsReview(true)
          } catch (err: unknown) {
            console.error(err)
            alert(err instanceof Error ? err.message : String(err))
          } finally {
            setSaving(false)
          }
          return
        }
        try {
          await flushAllWizardStepsToDb()
          await startEditResumeCompute('variables')
        } finally {
          setSaving(false)
        }
        return
      }

      /* FINALIZARE */
      setPdfUrl(null)
      const id = await ensureOffer()
      window.dispatchEvent(new CustomEvent('offer:wizard-flush-feed', { detail: { offerId: id } }))
      const filesToUpload: { key: string, file: File }[] = []
      for (const key in form) {
        const val = form[key]
        if (Array.isArray(val) && val.length > 0 && val[0] instanceof File) {
          val.forEach((f: File) => filesToUpload.push({ key, file: f }))
        }
      }

      if (filesToUpload.length === 0) {
        alert('Bitte Plan hochladen.')
        setSaving(false)
        return
      }

      setProcessStatus(DE.common.uploadingFiles || 'Dateien werden hochgeladen...')
      const uploadedFiles: { storagePath: string; mime: string; key: string }[] = []

      for (const item of filesToUpload) {
        const res = await uploadSingleFile(id, item.key, item.file)
        uploadedFiles.push({ storagePath: res.storagePath, mime: res.mime || '', key: item.key })
      }

      const planLikeMimes = /pdf|jpeg|jpg|png|webp/i
      const toValidate = uploadedFiles.filter((f) => f.storagePath && planLikeMimes.test(f.mime || ''))
      if (toValidate.length > 0) {
        setProcessStatus((DE.common as any).validatingPlan || 'Plan wird überprüft...')
        const body =
          toValidate.length > 1
            ? { storagePaths: toValidate.map((f) => f.storagePath) }
            : { storagePath: toValidate[0].storagePath, mimeType: toValidate[0].mime }
        const aiRes = await apiFetch('/validate-plan', { method: 'POST', body: JSON.stringify(body) })
        const aiJson = aiRes?.valid !== undefined ? aiRes : await (aiRes as any)?.json?.().catch(() => ({ valid: true }))
        if (aiJson?.valid === false) {
          const reason = aiJson.reason || DE.common.planInvalidMsg
          const noSideView =
            typeof reason === 'string' &&
            (reason.toLowerCase().includes('side view') ||
              reason.toLowerCase().includes('ansicht') ||
              reason.toLowerCase().includes('schnitt') ||
              reason.toLowerCase().includes('elevation'))
          setValidationError(noSideView ? (DE.common as any).planInvalidNoSideView || reason : reason)
          setSaving(false)
          return
        }
      }

      const formWizardPackage = String(form.wizardPackage ?? '').toLowerCase()
      const effectivePackage =
        selectedPackage ??
        (formWizardPackage === 'aufstockung'
          ? 'aufstockung'
          : formWizardPackage === 'dachstuhl'
            ? 'dachstuhl'
            : 'neubau')
      const roofOnly = roofOnlyOfferRef.current || effectivePackage === 'dachstuhl'
      const wizardPackage =
        roofOnly
          ? 'dachstuhl'
          : effectivePackage === 'aufstockung'
            ? 'aufstockung'
            : 'neubau'
      const aufstockungFloorKinds =
        effectivePackage === 'aufstockung' && Array.isArray(form.aufstockungFloorKinds)
          ? form.aufstockungFloorKinds.map((k: unknown) => (String(k).toLowerCase() === 'new' ? 'new' : 'existing'))
          : undefined
      try {
        const cur = (await apiFetch(`/offers/${id}`)) as { meta?: Record<string, unknown>; offer?: { meta?: Record<string, unknown> } }
        const currentMeta = cur?.meta ?? cur?.offer?.meta ?? {}
        const meta = {
          ...currentMeta,
          roof_only_offer: roofOnly,
          wizard_package: wizardPackage,
          ...(aufstockungFloorKinds ? { aufstockung_floor_kinds: aufstockungFloorKinds } : {}),
          ...(measurementsOnlyFlow ? { measurements_only_offer: true } : {}),
        }
        await apiFetch(`/offers/${id}`, { method: 'PATCH', body: JSON.stringify({ meta }) })
      } catch (_) { /* meta merge best-effort */ }

      setActiveRoofOnlyOffer(roofOnly)
      const computeFlow: OfferFlow = roofOnly
        ? 'dachstuhl'
        : effectivePackage === 'aufstockung'
          ? 'aufstockung'
          : 'neubau'
      const { run_id } = await apiFetch(`/offers/${id}/compute`, { method: 'POST', body: JSON.stringify({ payload: {} }), timeoutMs: 180_000 })
      setPdfUrl(null)
      pdfReadyRunIdRef.current = run_id
      setComputeFailed(false)
      setComputing(true)
      setComputeStartTime(Date.now())
      setComputeRunId(run_id)
      updateRunUrl(id, run_id)
      window.dispatchEvent(
        new CustomEvent('offer:compute-started', {
          detail: {
            offerId: id,
            runId: run_id,
            flow: computeFlow,
            measurementsOnlyOffer: measurementsOnlyFlow,
          },
        }),
      )
      window.dispatchEvent(new Event('offers:refresh'))
    } catch (err: any) {
      console.error('Finalize failed:', err)
      const isNetwork = err?.message === 'Failed to fetch' || err?.name === 'TypeError'
      const msg = isNetwork
        ? 'API nicht erreichbar. Bitte Backend starten: cd holzbot-api && npm run start:dev'
        : `${DE.common.finalizeErrorPrefix}: ${err?.message ?? err}`
      alert(msg)
    } finally {
      setSaving(false)
    }
  }

  function onBack() {
    if (isFirst || saving) return
    stashDraft()
    setDir('back'); setIdx(i => i - 1); setAnimKey(k => k + 1)
  }

  async function handleResetToNewProject() {
    const id = offerIdRef.current
    setSaving(true)
    try {
      if (id) {
        try {
          await apiFetch(`/offers/${id}/compute/cancel`, { method: 'POST', timeoutMs: 35_000 })
        } catch {
          /* Rechenjob evtl. schon fertig oder keine Zeile — Löschen trotzdem versuchen */
        }
        try {
          await apiFetch(`/offers/${id}`, { method: 'DELETE', timeoutMs: 45_000 })
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          alert(`Angebot konnte nicht gelöscht werden: ${msg}`)
          return
        }
      }
    } finally {
      setSaving(false)
    }

    setOfferId(null)
    offerIdRef.current = null
    setIdx(0)
    setForm({})
    setDrafts({})
    setErrors({})
    setShowErrors(false)
    setValidationError(null)
    setComputeFailed(false)
    setComputeRunId(null)
    pdfReadyRunIdRef.current = null
    setPdfUrl(null)
    setComputing(false)
    setComputeStartTime(null)
    setProcessStatus('')
    setSaveStatus('idle')
    setSelectedPackage(null)
    setMeasurementsOnlyFlow(false)
    measurementsOnlyFlowRef.current = false
    setEditOfferSkipUpload(false)
    setEditOfferDetectionsStandalone(false)
    editOfferBothAfterFormRef.current = false
    pendingPostEditorComputeRef.current = false
    setCurrentOfferMeasurementsOnly(false)
    roofOnlyOfferRef.current = false
    setActiveRoofOnlyOffer(false)
    creatingRef.current = false
    activeCreationPromise.current = null
    updateRunUrl(null, null)
    window.dispatchEvent(new CustomEvent('offer:new', { detail: { creationId: Date.now() } }))
    window.dispatchEvent(new Event('offers:refresh'))
  }

  async function onUpload(name: string, file: File | null) {
    if (!file) return
    try {
      setSaving(true)
      setSaveStatus('saving')

      const id = await ensureOffer()
      await uploadSingleFile(id, name, file)

      window.dispatchEvent(new Event('offers:refresh'))
      setSaveStatus('saved')
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 1600)
    } catch (err: any) {
      console.error('Upload failed:', err)
      setSaveStatus('error')
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
      alert(`${DE.common.uploadingError}: ${err?.message ?? err}`)
    } finally {
      setSaving(false)
    }
  }

  async function maybeUpdateOfferTitle(id: string) {
    const dg = drafts['dateGenerale'] ?? (step?.key === 'dateGenerale' ? form : {})
    const cl = drafts['client'] ?? (step?.key === 'client' ? form : {})
    const title = [cl?.nume?.trim(), dg?.referinta?.trim()].filter(Boolean).join(' — ')
    try {
      if (title) {
        await apiFetch(`/offers/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) })
      }
      if (dg && (dg.referinta?.trim() || dg.beci !== undefined)) {
        const currentOffer = (await apiFetch(`/offers/${id}`)) as any
        const currentMeta = currentOffer?.meta || currentOffer?.offer?.meta || {}
        const updatedMeta: any = { ...currentMeta }
        if (dg.referinta?.trim()) updatedMeta.referinta = dg.referinta.trim()
        if (dg.beci !== undefined) updatedMeta.beci = dg.beci === true || dg.beci === 'true' || dg.beci === 1
        await apiFetch(`/offers/${id}`, { method: 'PATCH', body: JSON.stringify({ meta: updatedMeta }) })
      }
    } catch (_) {}
  }

  // --- RENDERING ---
  
  // 1. Loading State
  if (loadingForm) {
    return (
      <div className="flex items-center justify-center h-full min-h-[300px]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-sun mx-auto mb-2" />
          <div className="text-sand/80">Formular wird geladen...</div>
        </div>
      </div>
    )
  }

  // 2. Error State (No Data)
  if (dynamicSteps.length === 0) {
    return (
      <div className="p-8 text-center text-red-300">
        Die Formulardefinition konnte nicht geladen werden. <br/>
        Prüfen Sie, ob <code>data/form-schema/holzbau-form-steps.json</code> existiert.
      </div>
    )
  }

  // 3. Main Wizard UI — direct Paket auswählen; după Haus-Angebot starten → wizard
  const showPackagePicker = !computing && !pdfUrl && !offerId && selectedPackage === null
  const showForm = (selectedPackage === 'neubau' || selectedPackage === 'dachstuhl' || selectedPackage === 'mengen' || selectedPackage === 'aufstockung' || offerId) && !computing && !pdfUrl
  const showProgressHeader = !computing && !pdfUrl && !showPackagePicker && showForm
  const centerWizardSteps = progressBarSteps.length > 0 && progressBarSteps.length <= 5

  return (
    <div
      className={`wizard-wrap${showProgressHeader ? '' : ' wizard-wrap--solo'}`}
      style={{ height: '100%', minHeight: 0, maxHeight: '100%' }}
    >
      {showProgressHeader && (
      <div className="px-2 mt-1 page-enter">
        <div
          ref={stepsScrollContainerRef}
          className={`wizard-steps wizard-steps--inline wizard-steps--spread relative flex items-start text-center hide-scroll w-full max-w-[96vw] mx-auto px-5 ${centerWizardSteps ? 'justify-center' : 'justify-start'}`}
        >
          {progressBarSteps.map((step, i) => {
            const dotClass = step.isSkipped ? 'skipped' : step.isDone ? 'done' : step.isActive ? 'active' : ''
            const stepClass = `wizard-step v-start${step.isSkipped ? ' skipped' : ''}`
            return (
              <div key={step.key} data-step-index={i} className={stepClass}>
                <div className={`wizard-dot ${dotClass}`} />
                <div className="wizard-label">{step.label}</div>
              </div>
            )
          })}
        </div>

        <div className="wizard-progress mt-3 hide-scroll" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPct}>
          <div className="wizard-progress__bar" style={{ width: `${progressPct}%` }} />
        </div>
      </div>
    )}

      <div
        className={`wizard-stage flex flex-col min-h-0 items-center relative ${pdfUrl ? 'justify-start' : 'justify-center'}`}
        style={{ gridRow: showProgressHeader ? 2 : 1, minHeight: 0 }}
      >
        {computeFailed && !pdfUrl ? (
          <div className="relative w-full flex flex-col items-center justify-center mt-24 gap-4 px-4" style={{ minHeight: '68vh' }}>
            <div className="wizard-card wizard-sunny max-w-lg w-full flex flex-col items-center gap-4 animate-fade-in">
              <div className="p-3 bg-orange-900/30 border border-orange-500/50 rounded-xl flex items-start gap-2 w-full">
                <AlertTriangle className="shrink-0 text-orange-400 h-6 w-6 mt-0.5" />
                <div>
                  <div className="font-bold text-orange-200 text-lg">{DE.common.computeErrorTitle}</div>
                  <div className="text-sm text-orange-100/80 mt-2">{DE.common.computeErrorMessage}</div>
                </div>
              </div>
              <button
                onClick={() => void handleResetToNewProject()}
                className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-[#ffffff] shadow-lg transition-all duration-200 ease-out bg-gradient-to-b from-[#CC9900] to-[#E5B800] hover:brightness-110 hover:-translate-y-[1px] hover:shadow-[0_4px_14px_rgba(229,184,0,0.35)] active:translate-y-[1px] active:scale-95"
              >
                {DE.common.computeErrorRetry}
              </button>
            </div>
          </div>
        ) : !pdfUrl &&
          showDetectionsReview &&
          (reviewImages.length > 0 || planReviewImages.length > 0 || activeRoofOnlyOffer) &&
          (computing || editOfferDetectionsStandalone) ? (
            <DetectionsReviewEditor
              offerId={offerId ?? undefined}
              images={reviewImages.length > 0 ? reviewImages : planReviewImages}
              roofImages={roofReviewImages.length > 0 ? roofReviewImages : undefined}
              roofOnlyOffer={activeRoofOnlyOffer || selectedPackage === 'dachstuhl'}
              forceAufstockungFlow={
                selectedPackage === 'aufstockung' ||
                String(form.wizardPackage ?? '').toLowerCase() === 'aufstockung' ||
                (Array.isArray((form as { aufstockungFloorKinds?: unknown }).aufstockungFloorKinds) &&
                  ((form as { aufstockungFloorKinds: unknown[] }).aufstockungFloorKinds?.length ?? 0) > 0)
              }
              onConfirm={async () => {
                if (pendingPostEditorComputeRef.current) {
                  pendingPostEditorComputeRef.current = false
                  await startEditResumeCompute('post_editor')
                  setEditOfferDetectionsStandalone(false)
                  setShowDetectionsReview(false)
                  setReviewImages([])
                  setRoofReviewImages([])
                  detectionsReviewApprovedRef.current = true
                  roofReviewApprovedRef.current = true
                  window.dispatchEvent(new CustomEvent('offer:detections-review-approved'))
                  window.dispatchEvent(new CustomEvent('offer:roof-review-approved'))
                  return
                }
                detectionsReviewApprovedRef.current = true
                roofReviewApprovedRef.current = true
                setShowDetectionsReview(false)
                setReviewImages([])
                setRoofReviewImages([])
                window.dispatchEvent(new CustomEvent('offer:detections-review-approved'))
                window.dispatchEvent(new CustomEvent('offer:roof-review-approved'))
              }}
              onCancel={() =>
                setCancelDialog(
                  editOfferDetectionsStandalone || editOfferSkipUpload ? 'abort_edit' : 'delete_offer',
                )
              }
            />
        ) : computing && !pdfUrl ? (
          <div className="relative w-full flex flex-col items-center justify-center mt-24 gap-4 page-enter" style={{ minHeight: '68vh' }}>
            <img 
              src="/houseblueprint.gif" 
              alt={DE.common.processingAlt} 
              className="w-auto h-auto max-w-[92vw] max-h-[60vh] object-contain" 
            />
            <button
              type="button"
              onClick={() => setCancelDialog('delete_offer')}
              disabled={saving}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-[#ffffff] shadow-lg transition-all duration-200 ease-out bg-gradient-to-b from-[#CC9900] to-[#E5B800] hover:brightness-110 hover:-translate-y-[1px] hover:shadow-[0_4px_14px_rgba(229,184,0,0.35)] active:translate-y-[1px] active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
            >
              Abbrechen
            </button>
          </div>
        ) : pdfUrl ? (
          <div className="flex-1 w-full h-full p-1.5 box-border overflow-hidden page-enter flex flex-col min-h-0 gap-4">
            <div className="flex-1 min-h-0 overflow-hidden rounded-xl">
              <SimplePdfViewer
                key={pdfUrl}
                src={pdfUrl}
                maxHeight="100%"
                className="w-full h-full min-h-0 rounded-xl"
              />
            </div>
            {offerId ? (
              <div className="shrink-0 flex justify-center items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    setEditDlgVars(false)
                    setEditDlgDet(false)
                    setShowEditOfferDialog(true)
                  }}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-[#ffffff] shadow-md transition-all duration-200 ease-out bg-gradient-to-b from-[#CC9900] to-[#E5B800] hover:brightness-110 hover:-translate-y-px hover:shadow-[0_3px_10px_rgba(229,184,0,0.28)] active:translate-y-px active:scale-[0.98]"
                >
                  Angebot bearbeiten
                </button>
              </div>
            ) : null}
          </div>
        ) : showPackagePicker ? (
          <div className="relative w-full max-w-full self-stretch flex flex-1 min-h-0 flex-col justify-center px-2 page-enter">
            <div className={`px-3 text-center transition-all duration-300 ${wipNotice !== null ? 'opacity-0 pointer-events-none h-0 overflow-hidden mb-0' : 'opacity-100 mb-5 sm:mb-6'}`}>
              <p className="text-[11px] sm:text-xs uppercase tracking-[0.18em] text-white/45 font-semibold mb-1.5">Projektwahl</p>
              <h2 className="text-white/95 text-2xl sm:text-3xl font-semibold tracking-tight leading-snug">
                {packagePickerMengenSub
                  ? 'Für welches Projekt brauchen Sie eine Mengenübersicht?'
                  : 'Für welches Projekt brauchen Sie eine Preisschätzung?'}
              </h2>
            </div>
            {tokensBlocked ? (
              <p className="text-center text-amber-100/90 text-sm sm:text-base font-medium mb-4 max-w-xl mx-auto px-3 leading-snug">
                Sie haben für diesen Monat keine Projekte mehr im Rahmen Ihres Limits. Am 1. des nächsten Monats stehen
                wieder Projekte zur Verfügung.
              </p>
            ) : null}
            <div
              className="w-full max-w-[760px] mx-auto px-1 relative flex-1 min-h-0 flex flex-col"
              style={{ background: 'transparent', border: 'none', boxShadow: 'none' }}
            >
              <div
                className={`absolute inset-0 flex items-center justify-center px-1 transition-all duration-300 ease-out ${
                  packagePickerMengenSub || wipNotice !== null
                    ? 'opacity-0 scale-[0.97] pointer-events-none -translate-y-2'
                    : 'opacity-100 scale-100 translate-y-0'
                }`}
                aria-hidden={packagePickerMengenSub || wipNotice !== null}
              >
                <div
                  className={`grid grid-cols-1 sm:grid-cols-2 gap-3 w-full ${
                    tokensBlocked ? 'opacity-[0.38] pointer-events-none saturate-50' : ''
                  }`}
                >
                {/* 1) Neubau */}
                <div className="bg-black/40 rounded-2xl p-4 flex flex-col border border-[#E5B800]/40 shadow-[0_0_24px_rgba(229,184,0,0.22)]">
                  <div className="flex items-center justify-center mb-3">
                    <img
                      src="/images/house.png"
                      alt="Neubau"
                      className="w-20 h-20 rounded-full object-cover border-2 border-[#E5B800]/35 grayscale contrast-[1.05]"
                    />
                  </div>
                  <div className="text-white font-extrabold text-lg text-center">Neubau</div>
                  <div className="text-sand/80 text-sm text-center mt-1.5 px-1">Erstellung einer Preisschätzung für Neubauten</div>
                  <div className="flex-1" />
                  <button
                    type="button"
                    disabled={tokensBlocked}
                    onClick={() => {
                      if (tokensBlocked) return
                      setMeasurementsOnlyFlow(false)
                      roofOnlyOfferRef.current = false
                      setForm(prev => ({ ...prev, wizardPackage: 'neubau' }))
                      setSelectedPackage('neubau')
                    }}
                    className="mt-4 w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-white shadow-lg transition-all duration-200 ease-out bg-gradient-to-b from-[#CC9900] to-[#E5B800] hover:brightness-110 hover:-translate-y-[1px] hover:shadow-[0_4px_14px_rgba(229,184,0,0.35)] active:translate-y-[1px] active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
                  >
                    Kalkulation starten
                    <ChevronRight size={18} className="opacity-85" />
                  </button>
                </div>

                {/* 2) Aufstockung */}
                <div className="bg-black/40 rounded-2xl p-4 flex flex-col border border-[#E5B800]/40 shadow-[0_0_24px_rgba(229,184,0,0.22)]">
                  <div className="flex items-center justify-center mb-3">
                    <img
                      src="/images/aufstockung.png"
                      alt="Aufstockung"
                      className="w-20 h-20 rounded-full object-cover border-2 border-[#E5B800]/35"
                    />
                  </div>
                  <div className="text-white font-extrabold text-lg text-center">Aufstockung</div>
                  <div className="text-sand/80 text-sm text-center mt-1.5 px-1">Erstellung einer Preisschätzung für Aufstockungen</div>
                  <div className="flex-1" />
                  <button
                    type="button"
                    disabled={tokensBlocked}
                    onClick={() => {
                      if (tokensBlocked) return
                      setMeasurementsOnlyFlow(false)
                      roofOnlyOfferRef.current = false
                      setForm(prev => ({ ...prev, wizardPackage: 'aufstockung' }))
                      setSelectedPackage('aufstockung')
                    }}
                    className="mt-4 w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-white shadow-lg transition-all duration-200 ease-out bg-gradient-to-b from-[#CC9900] to-[#E5B800] hover:brightness-110 hover:-translate-y-[1px] hover:shadow-[0_4px_14px_rgba(229,184,0,0.35)] active:translate-y-[1px] active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
                  >
                    Kalkulation starten
                    <ChevronRight size={18} className="opacity-85" />
                  </button>
                </div>

                {/* 3) Zubau */}
                <div className="bg-black/40 rounded-2xl p-4 flex flex-col border border-[#E5B800]/25 shadow-[0_0_20px_rgba(229,184,0,0.18)]">
                  <div className="flex items-center justify-center mb-3">
                    <img
                      src="/images/zubau.png"
                      alt="Zubau"
                      className="w-20 h-20 rounded-full object-cover border-2 border-[#E5B800]/30"
                    />
                  </div>
                  <div className="text-white font-extrabold text-lg text-center">Zubau</div>
                  <div className="text-sand/80 text-sm text-center mt-1.5 px-1">Erstellung einer Preisschätzung für Zubauten</div>
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={() => setWipNotice('zubau')}
                    className="mt-4 w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-white shadow-lg transition-all duration-200 ease-out bg-gradient-to-b from-[#CC9900] to-[#E5B800] hover:brightness-110 hover:-translate-y-[1px] hover:shadow-[0_4px_14px_rgba(229,184,0,0.35)] active:translate-y-[1px] active:scale-95"
                  >
                    Kalkulation starten
                  </button>
                </div>

                {/* 4) Mengenübersicht */}
                <div className="bg-black/40 rounded-2xl p-4 flex flex-col border border-[#E5B800]/40 shadow-[0_0_24px_rgba(229,184,0,0.22)]">
                  <div className="flex items-center justify-center mb-3">
                    <img
                      src="/images/blueprint.png"
                      alt="Mengenübersicht"
                      className="w-20 h-20 rounded-full object-cover border-2 border-[#E5B800]/35 grayscale contrast-[1.05]"
                    />
                  </div>
                  <div className="text-white font-extrabold text-lg text-center">Mengenübersicht</div>
                  <div className="text-sand/80 text-sm text-center mt-1.5 px-1">Nur Maß-/Mengen-PDF – ohne Preisangebot</div>
                  <div className="flex-1" />
                  <button
                    type="button"
                    disabled={tokensBlocked}
                    onClick={() => {
                      if (tokensBlocked) return
                      roofOnlyOfferRef.current = false
                      setPackagePickerMengenSub(true)
                    }}
                    className="mt-4 w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-white shadow-lg transition-all duration-200 ease-out bg-gradient-to-b from-[#CC9900] to-[#E5B800] hover:brightness-110 hover:-translate-y-[1px] hover:shadow-[0_4px_14px_rgba(229,184,0,0.35)] active:translate-y-[1px] active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
                  >
                    Weiter
                    <ChevronRight size={18} className="opacity-85" />
                  </button>
                </div>
              </div>
              </div>

              <div
                className={`flex flex-col flex-1 min-h-0 transition-all duration-300 ease-out ${
                  packagePickerMengenSub
                    ? 'opacity-100 scale-100 relative'
                    : 'opacity-0 scale-[0.97] pointer-events-none absolute inset-0 translate-y-3'
                }`}
                aria-hidden={!packagePickerMengenSub}
              >
                <div className="flex-1 flex flex-col items-center justify-center px-2 py-8 sm:py-10 min-h-[280px]">
                  <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(320px,320px))] gap-4 w-full max-w-[1024px] justify-center justify-items-stretch items-stretch ${
                    tokensBlocked ? 'opacity-[0.38] pointer-events-none saturate-50' : ''
                  }`}>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <button
                      type="button"
                      onClick={() => setPackagePickerMengenSub(false)}
                      className="flex items-center gap-1.5 text-sm text-sand/80 hover:text-sand transition-colors py-1"
                    >
                      <ChevronLeft size={18} />
                      Zurück zur Auswahl
                    </button>
                  </div>

                  <div className="bg-black/40 rounded-2xl p-4 flex flex-col w-full max-w-[320px] mx-auto h-full border border-[#E5B800]/40 shadow-[0_0_24px_rgba(229,184,0,0.22)]">
                    <div className="flex items-center justify-center mb-3">
                      <img
                        src="/images/blueprint.png"
                        alt="Neubau Mengenübersicht"
                        className="w-20 h-20 rounded-full object-cover border-2 border-[#E5B800]/35 grayscale contrast-[1.05]"
                      />
                    </div>
                    <div className="text-white font-extrabold text-lg text-center">Neubau Mengenübersicht</div>
                    <div className="text-sand/80 text-sm text-center mt-1.5 flex-1">
                      Nur Maß-/Mengen-PDF – ohne Preisangebot
                    </div>
                      <button
                      type="button"
                      disabled={tokensBlocked}
                      onClick={() => {
                        if (tokensBlocked) return
                        setMeasurementsOnlyFlow(true)
                        roofOnlyOfferRef.current = false
                        setPackagePickerMengenSub(false)
                        setForm(prev => ({ ...prev, wizardPackage: 'neubau' }))
                        setSelectedPackage('neubau')
                      }}
                      className="mt-4 w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-white shadow-lg transition-all duration-200 ease-out bg-gradient-to-b from-[#CC9900] to-[#E5B800] hover:brightness-110 hover:-translate-y-[1px] hover:shadow-[0_4px_14px_rgba(229,184,0,0.35)] active:translate-y-[1px] active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
                      >
                        Kalkulation starten
                      <ChevronRight size={18} className="opacity-85" />
                    </button>
                  </div>

                  <div className="bg-black/40 rounded-2xl p-4 flex flex-col w-full max-w-[320px] mx-auto h-full border border-[#E5B800]/25 shadow-[0_0_20px_rgba(229,184,0,0.18)]">
                    <div className="flex items-center justify-center mb-3">
                      <img
                        src="/images/aufstockung.png"
                        alt="Aufstockung Mengenübersicht"
                        className="w-20 h-20 rounded-full object-cover border-2 border-[#E5B800]/30"
                      />
                    </div>
                    <div className="text-white font-extrabold text-lg text-center">Aufstockung Mengenübersicht</div>
                    <div className="text-sand/80 text-sm text-center mt-1.5 flex-1">
                      Nur Maß-/Mengen-PDF – ohne Preisangebot
                    </div>
                    <button
                      type="button"
                      onClick={() => {}}
                      className="mt-4 w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-white shadow-lg transition-all duration-200 ease-out bg-gradient-to-b from-[#CC9900] to-[#E5B800] hover:brightness-110 hover:-translate-y-[1px] hover:shadow-[0_4px_14px_rgba(229,184,0,0.35)] active:translate-y-[1px] active:scale-95"
                    >
                      Kalkulation starten
                      <ChevronRight size={18} className="opacity-85" />
                    </button>
                  </div>

                  <div className="bg-black/40 rounded-2xl p-4 flex flex-col w-full max-w-[320px] mx-auto h-full border border-[#E5B800]/25 shadow-[0_0_20px_rgba(229,184,0,0.18)]">
                    <div className="flex items-center justify-center mb-3">
                      <img
                        src="/images/zubau.png"
                        alt="Zubau Mengenübersicht"
                        className="w-20 h-20 rounded-full object-cover border-2 border-[#E5B800]/30"
                      />
                    </div>
                    <div className="text-white font-extrabold text-lg text-center">Zubau Mengenübersicht</div>
                    <div className="text-sand/80 text-sm text-center mt-1.5 flex-1">
                      Nur Maß-/Mengen-PDF – ohne Preisangebot
                    </div>
                    <button
                      type="button"
                      onClick={() => {}}
                      className="mt-4 w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-white shadow-lg transition-all duration-200 ease-out bg-gradient-to-b from-[#CC9900] to-[#E5B800] hover:brightness-110 hover:-translate-y-[1px] hover:shadow-[0_4px_14px_rgba(229,184,0,0.35)] active:translate-y-[1px] active:scale-95"
                    >
                      Kalkulation starten
                      <ChevronRight size={18} className="opacity-85" />
                    </button>
                  </div>

                  </div>
                </div>
              </div>

            </div>

            {/* WIP screen — Aufstockung / Zubau */}
            <div
              className={`absolute inset-0 flex flex-col items-center justify-center transition-all duration-300 ease-out ${
                wipNotice !== null
                  ? 'opacity-100 scale-100 pointer-events-auto'
                  : 'opacity-0 scale-[0.97] pointer-events-none translate-y-2'
              }`}
              aria-hidden={wipNotice === null}
            >
              <div className="text-6xl mb-6">🚧</div>
              <h3 className="text-white font-extrabold text-2xl mb-3">
                {wipNotice === 'aufstockung' ? 'Aufstockung' : 'Zubau'}
              </h3>
              <p className="text-sand/80 text-base max-w-xs leading-relaxed text-center">
                Dieses Modul ist zur Zeit in Entwicklung.
              </p>
              <button
                type="button"
                onClick={() => setWipNotice(null)}
                className="mt-10 flex items-center gap-1.5 text-sm text-sand/70 hover:text-sand transition-colors py-1"
              >
                <ChevronLeft size={18} />
                Zurück zur Auswahl
              </button>
            </div>
          </div>
        ) : (
          <div
            key={`${step.key}-${animKey}`}
            className={`wizard-card wizard-sunny w-full max-w-[min(720px,100%)] shrink-0 ${dir === null ? 'card-initial' : dir === 'back' ? 'card-in-back' : 'card-in-next'}`}
          >
            <div className="wizard-header">
              <div className="wizard-title text-sun">
                {tStepLabel(step.key, step.label)}
              </div>
            </div>
            <div className="wizard-body preisdatenbank-scroll relative">
               {saving && (
                  <div className="absolute inset-0 z-50 bg-black/20 backdrop-blur-[1px] flex flex-col items-center justify-center rounded-xl">
                      <Loader2 className="animate-spin text-sun h-10 w-10 mb-2"/>
                      <span className="text-sand font-medium shadow-sm">{processStatus}</span>
                  </div>
              )}
              {editOfferSkipUpload && editWizardPreparing && (
                <div className="absolute inset-0 z-40 bg-black/55 backdrop-blur-[2px] flex flex-col items-center justify-center rounded-xl">
                  <Loader2 className="animate-spin text-sun h-10 w-10 mb-2" />
                  <span className="text-sand font-medium text-sm px-4 text-center">Formular wird geladen…</span>
                </div>
              )}

              {validationError && (
                <div className="mb-3 p-3 bg-orange-900/30 border border-orange-500/50 rounded-lg flex items-start gap-2 animate-fade-in">
                  <AlertTriangle className="shrink-0 text-orange-400 h-5 w-5 mt-0.5" />
                  <div>
                    <div className="font-semibold text-orange-200">{DE.common.planInvalidTitle}</div>
                    <div className="text-sm text-orange-100/80 mt-1">{validationError}</div>
                  </div>
                </div>
              )}
              
              {step.key === 'client' && (!step.fields || step.fields.length === 0) ? (
                <ClientStep
                  form={form}
                  setForm={(v) => applyFormUpdate('client', v)}
                  errors={visibleErrors}
                  onEnter={onContinue}
                />
              ) : step.key === 'client' ? (
                <div className="space-y-4">
                  <DynamicFields
                    stepKey={step.key}
                    fields={step.fields}
                    form={form}
                    setForm={(v) => applyFormUpdate('client', v)}
                    onUpload={onUpload}
                    ensureOffer={ensureOffer}
                    errors={visibleErrors}
                    onEnter={onContinue}
                    customOptionsForm={customOptionsForm}
                    paramLabelOverrides={paramLabelOverrides}
                    optionValueToPriceKey={optionValueToPriceKey}
                    hiddenKeysForm={hiddenKeysForm}
                    preisdatenbankOptionsByTag={preisdatenbankOptionsByTag}
                    displayCurrency={displayCurrency}
                  />
                </div>
              ) : step.key === 'structuraCladirii' ? (
                <BuildingStructureStep
                  displayCurrency={displayCurrency}
                  wizardPackage={
                    String(form.wizardPackage ?? '').toLowerCase() ||
                    (selectedPackage ?? (activeRoofOnlyOffer ? 'dachstuhl' : 'neubau'))
                  }
                  form={form}
                  setForm={(v) => {
                    ensureOffer().catch(() => {})
                    const syncWinterBalkone = (next: Record<string, any>) => {
                      if (
                        typeof next.hasWintergarden !== 'undefined' ||
                        typeof next.hasBalkone !== 'undefined'
                      ) {
                        structuraWinterBalkoneRef.current = {
                          ...structuraWinterBalkoneRef.current,
                          ...(typeof next.hasWintergarden !== 'undefined' && { hasWintergarden: next.hasWintergarden }),
                          ...(typeof next.hasBalkone !== 'undefined' && { hasBalkone: next.hasBalkone }),
                        }
                        setWinterBalkoneFlags(prev => ({
                          hasWintergarden: typeof next.hasWintergarden !== 'undefined' ? next.hasWintergarden === true : prev.hasWintergarden,
                          hasBalkone: typeof next.hasBalkone !== 'undefined' ? next.hasBalkone === true : prev.hasBalkone,
                        }))
                      }
                    }
                    if (typeof v === 'function') {
                      setForm(prev => {
                        const next = v(prev)
                        syncWinterBalkone(next)
                        return next
                      })
                    } else {
                      syncWinterBalkone(v)
                      setForm(v)
                    }
                  }}
                  errors={visibleErrors}
                  hiddenKeysForm={hiddenKeysForm}
                  optionValueToPriceKey={optionValueToPriceKey}
                  customOptionsForm={customOptionsForm}
                  paramLabelOverrides={paramLabelOverrides}
                  preisdatenbankOptionsByTag={preisdatenbankOptionsByTag}
                />
              ) : step.key === 'wandaufbau' ? (
                <WandaufbauStep
                  displayCurrency={displayCurrency}
                  wizardPackage={
                    String(form.wizardPackage ?? '').toLowerCase() ||
                    (selectedPackage ?? (activeRoofOnlyOffer ? 'dachstuhl' : 'neubau'))
                  }
                  form={form}
                  setForm={(v) => applyFormUpdate(step.key, v)}
                  errors={visibleErrors}
                  drafts={drafts}
                  optionValueToPriceKey={optionValueToPriceKey}
                  customOptionsForm={customOptionsForm}
                  paramLabelOverrides={paramLabelOverrides}
                  hiddenKeysForm={hiddenKeysForm}
                  tOption={tOption}
                  preisdatenbankOptionsByTag={preisdatenbankOptionsByTag}
                />
              ) : step.key === 'wintergaertenBalkone' ? (
                <WintergaertenBalkoneStep
                  displayCurrency={displayCurrency}
                  form={form}
                  setForm={(v) => applyFormUpdate(step.key, v)}
                  errors={visibleErrors}
                  optionValueToPriceKey={optionValueToPriceKey}
                  customOptionsForm={customOptionsForm}
                  hiddenKeysForm={hiddenKeysForm}
                  paramLabelOverrides={paramLabelOverrides}
                  tOption={tOption}
                  preisdatenbankOptionsByTag={preisdatenbankOptionsByTag}
                />
              ) : step.key === 'materialeFinisaj' ? (
                <MaterialeFinisajStep
                  displayCurrency={displayCurrency}
                  wizardPackage={
                    String(form.wizardPackage ?? '').toLowerCase() ||
                    (selectedPackage ?? (activeRoofOnlyOffer ? 'dachstuhl' : 'neubau'))
                  }
                  form={form}
                  setForm={(v) => applyFormUpdate(step.key, v)}
                  errors={visibleErrors}
                  drafts={drafts}
                  customOptionsForm={customOptionsForm}
                  paramLabelOverrides={paramLabelOverrides}
                  optionValueToPriceKey={optionValueToPriceKey}
                  hiddenKeysForm={hiddenKeysForm}
                  tOption={tOption}
                  preisdatenbankOptionsByTag={preisdatenbankOptionsByTag}
                />
              ) : step.key === 'bodenDeckeBelag' ? (
                <BodenDeckeBelagStep
                  displayCurrency={displayCurrency}
                  wizardPackage={
                    String(form.wizardPackage ?? '').toLowerCase() ||
                    (selectedPackage ?? (activeRoofOnlyOffer ? 'dachstuhl' : 'neubau'))
                  }
                  form={form}
                  setForm={(v) => applyFormUpdate(step.key, v)}
                  errors={visibleErrors}
                  drafts={drafts}
                  tOption={tOption}
                  customOptionsForm={customOptionsForm}
                  paramLabelOverrides={paramLabelOverrides}
                  optionValueToPriceKey={optionValueToPriceKey}
                  hiddenKeysForm={hiddenKeysForm}
                  preisdatenbankOptionsByTag={preisdatenbankOptionsByTag}
                />
              ) : step.key === 'projektdaten' ? (
                <ProjektdatenStepContent
                  displayCurrency={displayCurrency}
                  form={form}
                  setForm={(v) => applyFormUpdate('projektdaten', v)}
                  errors={visibleErrors}
                  onEnter={onContinue}
                  preisdatenbankOptionsByTag={preisdatenbankOptionsByTag}
                  optionValueToPriceKey={optionValueToPriceKey}
                  paramLabelOverrides={paramLabelOverrides}
                />
              ) : step.key === 'daemmungDachdeckung' && selectedPackage === 'dachstuhl' ? (
                <DachOnlyDaemmungStepContent
                  displayCurrency={displayCurrency}
                  form={form}
                  drafts={drafts}
                  setForm={(v) => applyFormUpdate(step.key, v)}
                  fields={step.fields}
                  onUpload={onUpload}
                  ensureOffer={ensureOffer}
                  errors={visibleErrors}
                  onEnter={onContinue}
                  customOptionsForm={customOptionsForm}
                  paramLabelOverrides={paramLabelOverrides}
                  optionValueToPriceKey={optionValueToPriceKey}
                  hiddenKeysForm={hiddenKeysForm}
                  preisdatenbankOptionsByTag={preisdatenbankOptionsByTag}
                />
              ) : step.key !== 'upload' ? (
                <div className="space-y-4">
                  <DynamicFields
                    stepKey={step.key}
                    fields={step.fields}
                    form={form}
                    setForm={(v) => applyFormUpdate(step.key, v)}
                    onUpload={onUpload}
                    ensureOffer={ensureOffer}
                    errors={visibleErrors}
                    onEnter={onContinue}
                    customOptionsForm={customOptionsForm}
                    paramLabelOverrides={paramLabelOverrides}
                    optionValueToPriceKey={optionValueToPriceKey}
                    hiddenKeysForm={hiddenKeysForm}
                    preisdatenbankOptionsByTag={preisdatenbankOptionsByTag}
                    displayCurrency={displayCurrency}
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  <DynamicFields 
                    stepKey={step.key} 
                    fields={step.fields} 
                    form={form} 
                    setForm={(v) => setForm(v)} 
                    onUpload={onUpload} 
                    ensureOffer={ensureOffer}
                    customOptionsForm={customOptionsForm} 
                    paramLabelOverrides={paramLabelOverrides}
                    optionValueToPriceKey={optionValueToPriceKey}
                    hiddenKeysForm={hiddenKeysForm}
                    errors={{}}
                    onEnter={onContinue}
                    preisdatenbankOptionsByTag={preisdatenbankOptionsByTag}
                    displayCurrency={displayCurrency}
                  />
                </div>
              )}
            </div>
            
            <div className="wizard-footer flex items-center justify-between mt-4 gap-2 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <button 
                  onClick={isFirst && !editOfferSkipUpload
                    ? () => {
                        if (!offerId) { void handleResetToNewProject() }
                        else { setCancelDialog('delete_offer') }
                      }
                    : onBack}
                  disabled={saving || (isFirst && editOfferSkipUpload)}
                  className={`
                    flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-all duration-200 ease-in-out
                    border border-[#D8A25E]/30 text-[#D8A25E] bg-transparent
                    hover:bg-[#D8A25E]/10 hover:border-[#D8A25E]/60
                    disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent
                  `}
                >
                  <ChevronLeft size={19} /> 
                  {isFirst && !editOfferSkipUpload ? 'Zurück zur Übersicht' : DE.common.btnBack}
                </button>
                {editOfferSkipUpload ? (
                  <button
                    type="button"
                    onClick={() => setCancelDialog('abort_edit')}
                    disabled={saving}
                    className="px-4 py-2.5 rounded-xl font-medium text-sand/80 hover:text-sand border border-white/15 hover:bg-white/5 transition-colors disabled:opacity-50"
                  >
                    Abbrechen
                  </button>
                ) : null}
              </div>

              <div className="flex-1 min-w-[8px]" />

              <button 
                onClick={onContinue} 
                disabled={saving}
                className={`
                  flex items-center gap-2 px-8 py-2.5 rounded-xl font-bold text-[#ffffff] shadow-lg transition-all duration-200 ease-out
                  bg-gradient-to-b from-[#CC9900] to-[#E5B800]
                  hover:brightness-110 hover:-translate-y-[1px] hover:shadow-[0_4px_14px_rgba(229,184,0,0.35)]
                  active:translate-y-[1px] active:scale-95
                  disabled:opacity-70 disabled:cursor-wait disabled:transform-none disabled:shadow-none
                `}
              >
                {isLast ? (
                  <span>{DE.common.btnFinish}</span>
                ) : (
                  <>
                    {DE.common.btnNext} 
                    <ChevronRight size={19} className="opacity-80" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {!computing && saveStatus !== 'idle' && (
        <div className="saving-toast-fixed">
          <div className={`saving-dot ${saveStatus === 'error' ? 'bg-red-400' : ''}`} />
          <span>
            {saveStatus === 'saving' && DE.common.toastSaving}
            {saveStatus === 'saved' && DE.common.toastSaved}
            {saveStatus === 'error' && DE.common.toastError}
          </span>
        </div>
      )}

      <style jsx global>{`
        .pretty-scroll { scrollbar-width: thin; scrollbar-color: #9aa0a6 #1b1f24; }
        .pretty-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
        .pretty-scroll::-webkit-scrollbar-track { background: #1b1f24; border-radius: 8px; }
        .pretty-scroll::-webkit-scrollbar-thumb { background: #9aa0a6; border-radius: 8px; border: 2px solid #1b1f24; }
        .pretty-scroll::-webkit-scrollbar-thumb:hover { background: #bfc5cc; }
        .animate-fade-in { animation: fadeIn 0.3s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {showEditOfferDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-panel rounded-xl p-6 max-w-xl w-full mx-4 max-h-[90vh] overflow-y-auto pretty-scroll shadow-soft border border-white/10 animate-fade-in">
            <h3 className="text-lg font-bold text-sand mb-2">Angebot bearbeiten</h3>
            <p className="text-sand/70 text-sm mb-4">Wählen Sie, was neu berechnet werden soll.</p>
            <label
              className={`flex flex-col gap-3 mb-5 rounded-xl p-3 transition-all duration-200 border ${
                currentOfferMeasurementsOnly
                  ? 'cursor-not-allowed opacity-55 border-white/10 bg-black/6'
                  : editDlgVars
                    ? 'cursor-pointer border-[#E5B800]/50 bg-[#E5B800]/12 shadow-[0_0_20px_rgba(229,184,0,0.22)]'
                    : 'cursor-pointer border-white/12 bg-black/10 hover:border-white/20'
              }`}
            >
              <img
                src={EDIT_OFFER_DLG_IMG_FORM}
                alt="Formular"
                className={`w-full max-h-[min(38vh,280px)] rounded-xl object-contain object-top bg-black/25 transition-all duration-200 ${
                  currentOfferMeasurementsOnly
                    ? 'border border-white/15 opacity-45'
                    : editDlgVars
                      ? 'border-2 border-[#E5B800]'
                      : 'border border-[#E5B800]/22 opacity-90'
                }`}
              />
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 rounded border border-[#D8A25E]/50 bg-black/25 accent-[#CC9900] focus:outline-none focus:ring-2 focus:ring-[#E5B800]/40 focus:ring-offset-0 focus:ring-offset-transparent disabled:opacity-40"
                  checked={!currentOfferMeasurementsOnly && editDlgVars}
                  disabled={currentOfferMeasurementsOnly}
                  onChange={(e) => setEditDlgVars(e.target.checked)}
                />
                <span
                  className={`text-sm min-w-0 ${
                    currentOfferMeasurementsOnly
                      ? 'text-sand/55'
                      : editDlgVars
                        ? 'text-sand font-semibold'
                        : 'text-sand/85'
                  }`}
                >
                  Optionen im Formular anpassen
                  <span
                    className={`block text-xs mt-0.5 font-normal ${
                      currentOfferMeasurementsOnly
                        ? 'text-sand/45'
                        : editDlgVars
                          ? 'text-sand/70'
                          : 'text-sand/55'
                    }`}
                  >
                    Ladezeit: ungefähr 30 Sekunden
                  </span>
                </span>
              </div>
            </label>
            <label
              className={`flex flex-col gap-3 mb-6 cursor-pointer rounded-xl p-3 transition-all duration-200 border ${
                editDlgDet
                  ? 'border-[#E5B800]/50 bg-[#E5B800]/12 shadow-[0_0_20px_rgba(229,184,0,0.22)]'
                  : 'border-white/12 bg-black/10 hover:border-white/20'
              }`}
            >
              <img
                src={EDIT_OFFER_DLG_IMG_EDITOR}
                alt="Bearbeitungsfenster"
                className={`w-full max-h-[min(38vh,280px)] rounded-xl object-contain object-top bg-black/25 transition-all duration-200 ${
                  editDlgDet
                    ? 'border-2 border-[#E5B800]'
                    : 'border border-[#E5B800]/22 opacity-90'
                }`}
              />
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 rounded border border-[#D8A25E]/50 bg-black/25 accent-[#CC9900] focus:outline-none focus:ring-2 focus:ring-[#E5B800]/40 focus:ring-offset-0 focus:ring-offset-transparent disabled:opacity-40"
                  checked={editDlgDet}
                  onChange={(e) => setEditDlgDet(e.target.checked)}
                />
                <span className={`text-sm min-w-0 ${editDlgDet ? 'text-sand font-semibold' : 'text-sand/85'}`}>
                  Oberflächen und Erkennungen im Bearbeitungsfenster anpassen
                  <span
                    className={`block text-xs mt-0.5 font-normal ${editDlgDet ? 'text-sand/70' : 'text-sand/55'}`}
                  >
                    Ladezeit: ungefähr 3 Minuten
                  </span>
                </span>
              </div>
            </label>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowEditOfferDialog(false)}
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-sand/80 hover:text-sand bg-black/10 hover:bg-black/20 border border-white/10 transition-colors"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={() => void handleEditOfferDialogStart()}
                disabled={
                  saving ||
                  (!editDlgDet && (!editDlgVars || currentOfferMeasurementsOnly))
                }
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-[#ffffff] shadow-md transition-all duration-200 ease-out bg-gradient-to-b from-[#CC9900] to-[#E5B800] hover:brightness-110 disabled:opacity-45 disabled:pointer-events-none disabled:shadow-none"
              >
                Weiter
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-panel rounded-xl p-6 max-w-md w-full mx-4 shadow-soft border border-white/10 animate-fade-in">
            <h3 className="text-lg font-bold text-sand mb-4">
              {cancelDialog === 'abort_edit' ? 'Bearbeitung abbrechen?' : 'Angebot löschen?'}
            </h3>
            <p className="text-sand/80 mb-6">
              {cancelDialog === 'abort_edit'
                ? 'Die Angebotsbearbeitung wird verworfen und das PDF wird wieder angezeigt. Das Angebot bleibt erhalten.'
                : 'Das Angebot wird unwiderruflich gelöscht (inkl. hochgeladener Pläne und gespeicherter Schritte). Ein laufender Rechenprozess wird zuerst gestoppt.'}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setCancelDialog(null)}
                className="px-4 py-2.5 rounded-xl font-medium text-sand/80 hover:text-sand bg-black/10 hover:bg-black/20 border border-white/10 transition-colors"
              >
                Nein
              </button>
              <button
                type="button"
                disabled={saving && cancelDialog === 'delete_offer'}
                onClick={() => {
                  const mode = cancelDialog
                  setCancelDialog(null)
                  if (mode === 'abort_edit') void abortEditOfferFlow()
                  else void handleResetToNewProject()
                }}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-[#ffffff] shadow-lg transition-all duration-200 ease-out bg-gradient-to-b from-[#CC9900] to-[#E5B800] hover:brightness-110 hover:-translate-y-[1px] hover:shadow-[0_4px_14px_rgba(229,184,0,0.35)] active:translate-y-[1px] active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
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

function ClientStep({ form, setForm, errors, onEnter }:{ form: Record<string, any>; setForm: (v: Record<string, any> | ((prev: Record<string, any>) => Record<string, any>)) => void; errors: Errors; onEnter: () => void }) {
  const fields = [
    { key: 'nume', label: 'Vor- und Nachname', placeholder: 'z.B. Max Mustermann' },
    { key: 'telefon', label: 'Telefonnummer', placeholder: 'z.B. +49 123 456789' },
    { key: 'email', label: 'E-Mail', placeholder: 'z.B. max@beispiel.de' },
    { key: 'localitate', label: 'Adresse', placeholder: 'Straße, PLZ Ort' },
  ] as const
  return (
    <div className="space-y-3">
      {fields.map(f => {
        const fieldErr = errors[f.key]
        const raw = form[f.key]
        const inputVal = (typeof raw === 'string' || typeof raw === 'number') ? String(raw) : ''
        return (
          <label key={f.key} className="flex flex-col gap-1" data-field={f.key}>
            <span className="wiz-label text-sun/90">{f.label}</span>
            <input
              className={`sun-input w-full ${fieldErr ? 'ring-2 ring-orange-400/60 focus:ring-orange-400/60' : ''}`}
              value={inputVal}
              placeholder={f.placeholder}
              onChange={(e) => {
                const v = e.target.value
                setForm(prev => ({ ...prev, [f.key]: v }))
              }}
              onKeyDown={(e) => handleInputEnter(e, onEnter)}
            />
            {fieldErr && <span className="text-xs text-orange-400">{fieldErr}</span>}
          </label>
        )
      })}
    </div>
  )
}


function ProjektdatenStepContent({
  form,
  setForm,
  errors,
  onEnter,
  preisdatenbankOptionsByTag = {},
  optionValueToPriceKey = {},
  paramLabelOverrides = {},
  displayCurrency = 'EUR',
}: {
  form: Record<string, any>
  setForm: (v: Record<string, any> | ((prev: Record<string, any>) => Record<string, any>)) => void
  errors: Errors
  onEnter: () => void
  preisdatenbankOptionsByTag?: Record<string, string[]>
  optionValueToPriceKey?: Record<string, Record<string, string>>
  paramLabelOverrides?: Record<string, string>
  displayCurrency?: DisplayCurrency
}) {
  const deckenInnenausbauOptions = preisdatenbankOptionsByTag['decke_innenausbau'] ?? ['Standard', 'Premium', 'Exklusiv']
  const displayDeckenInnenausbau = (opt: string) =>
    adaptCurrencyCopy(paramLabelOverrides[optionValueToPriceKey['decke_innenausbau']?.[opt] ?? ''] ?? opt, displayCurrency)

  return (
    <div className="space-y-5">
      <label className="flex flex-col gap-1" data-field="projektumfang">
        <span className="wiz-label text-sun/90">Projektumfang</span>
        <div className={errors.projektumfang ? 'ring-2 ring-orange-400/60 rounded-lg' : ''}>
          <SelectSun
            value={form.projektumfang ?? ''}
            onChange={(v) => setForm(prev => ({ ...prev, projektumfang: v }))}
            options={['Dachstuhl', 'Dachdeckung', 'Dachstuhl + Dachdeckung']}
            placeholder="Wählen Sie eine Option"
          />
        </div>
        {errors.projektumfang && <span className="text-xs text-orange-400">{errors.projektumfang}</span>}
      </label>
      <label className="flex flex-col gap-1" data-field="nutzungDachraum">
        <span className="wiz-label text-sun/90">Nutzung des Dachraums</span>
        <div className={errors.nutzungDachraum ? 'ring-2 ring-orange-400/60 rounded-lg' : ''}>
          <SelectSun
            value={form.nutzungDachraum ?? ''}
            onChange={(v) => setForm(prev => ({ ...prev, nutzungDachraum: v }))}
            options={['Nicht ausgebaut', 'Wohnraum / ausgebaut']}
            placeholder="Wählen Sie eine Option"
          />
        </div>
        {errors.nutzungDachraum && <span className="text-xs text-orange-400">{errors.nutzungDachraum}</span>}
      </label>
      {form.nutzungDachraum === 'Wohnraum / ausgebaut' && (
        <label className="flex flex-col gap-1" data-field="deckenInnenausbau">
          <span className="wiz-label text-sun/90">Decken-Innenausbau</span>
          <div className={errors.deckenInnenausbau ? 'ring-2 ring-orange-400/60 rounded-lg' : ''}>
            <SelectSun
              value={form.deckenInnenausbau ?? ''}
              onChange={(v) => setForm(prev => ({ ...prev, deckenInnenausbau: v }))}
              options={deckenInnenausbauOptions}
              displayFor={displayDeckenInnenausbau}
              placeholder="Wählen Sie eine Option"
            />
          </div>
          {errors.deckenInnenausbau && <span className="text-xs text-orange-400">{errors.deckenInnenausbau}</span>}
        </label>
      )}
    </div>
  )
}

function DachOnlyDaemmungStepContent({
  form,
  drafts,
  setForm,
  fields,
  onUpload,
  ensureOffer,
  errors,
  onEnter,
  customOptionsForm,
  paramLabelOverrides,
  optionValueToPriceKey,
  hiddenKeysForm,
  preisdatenbankOptionsByTag,
  displayCurrency = 'EUR',
}: {
  form: Record<string, any>
  drafts: Drafts
  setForm: (v: Record<string, any> | ((prev: Record<string, any>) => Record<string, any>)) => void
  fields: Field[]
  onUpload: (name: string, file: File | null) => void
  ensureOffer: () => Promise<string>
  errors: Errors
  onEnter: () => void
  customOptionsForm?: Record<string, Array<{ label: string; value: string; price_key?: string }>>
  paramLabelOverrides?: Record<string, string>
  optionValueToPriceKey?: Record<string, Record<string, string>>
  hiddenKeysForm?: Set<string>
  preisdatenbankOptionsByTag?: Record<string, string[]>
  displayCurrency?: DisplayCurrency
}) {
  const projektumfang = (form.projektumfang || drafts?.projektdaten?.projektumfang || '').toString().trim()
  const includeDachstuhl = projektumfang === '' || projektumfang === 'Dachstuhl' || projektumfang === 'Dachstuhl + Dachdeckung'
  const includeDachdeckung = projektumfang === '' || projektumfang === 'Dachdeckung' || projektumfang === 'Dachstuhl + Dachdeckung'
  const allowed = new Set<string>(['daemmung', 'unterdach', 'sichtdachstuhl', 'dachfensterImDach', 'dachfensterTyp'])
  if (includeDachstuhl) allowed.add('dachstuhlTyp')
  if (includeDachdeckung) allowed.add('dachdeckung')
  const tagByFieldName: Record<string, string> = {
    daemmung: 'roof_insulation',
    unterdach: 'under_roof',
    dachstuhlTyp: 'roof_structure_type',
    dachdeckung: 'roof_covering',
    sichtdachstuhl: 'visible_roof_structure',
    dachfensterTyp: 'roof_skylight_type',
  }
  const filtered = fields
    .filter((f) => allowed.has(f.name))
    .map((f) => {
      const tag = tagByFieldName[f.name]
      if (!tag) return f
      return { ...(f as any), tag }
    })
  return (
    <DynamicFields
      stepKey="daemmungDachdeckung"
      fields={filtered}
      form={form}
      setForm={setForm}
      onUpload={onUpload}
      ensureOffer={ensureOffer}
      errors={errors}
      onEnter={onEnter}
      customOptionsForm={customOptionsForm}
      paramLabelOverrides={paramLabelOverrides}
      optionValueToPriceKey={optionValueToPriceKey}
      hiddenKeysForm={hiddenKeysForm}
      preisdatenbankOptionsByTag={preisdatenbankOptionsByTag}
      displayCurrency={displayCurrency}
    />
  )
}

const WANDAUFBAU_OPTIONS = [
  'CLT 35cm', 'CLT 32cm', 'CLT 30cm',
  'Holzriegel 35cm', 'Holzriegel 32cm', 'Holzriegel 30cm',
  'Beton 35cm', 'Beton 32cm', 'Beton 30cm',
] as const

/** Per-floor form idx 0 = Erdgeschoss (implicit, not in listaEtaje). aufstockungFloorKinds[i] matches listaEtaje[i] (first Obergeschoss = kinds[0]). */
function isAufstockungNewBuildStandardFloorIdx(standardFloorIdx: number, kinds: string[]): boolean {
  if (standardFloorIdx <= 0) return false
  return String(kinds[standardFloorIdx - 1] ?? '').toLowerCase() === 'new'
}

function resolveAufstockungFlow(form: Record<string, any>, wizardPackageProp?: string): boolean {
  return String(wizardPackageProp ?? form.wizardPackage ?? '').toLowerCase() === 'aufstockung'
}

function WandaufbauStep({
  form,
  setForm,
  errors,
  drafts,
  wizardPackage,
  optionValueToPriceKey = {},
  customOptionsForm = {},
  paramLabelOverrides = {},
  hiddenKeysForm = new Set<string>(),
  tOption,
  preisdatenbankOptionsByTag = {},
  displayCurrency = 'EUR',
}: {
  form: Record<string, any>
  setForm: (v: Record<string, any> | ((prev: Record<string, any>) => Record<string, any>)) => void
  errors: Errors
  drafts: Drafts
  wizardPackage?: string
  optionValueToPriceKey?: Record<string, Record<string, string>>
  customOptionsForm?: Record<string, Array<{ label: string; value: string; price_key?: string }>>
  paramLabelOverrides?: Record<string, string>
  hiddenKeysForm?: Set<string>
  tOption: (stepKey: string, fieldName: string, opt: string) => string
  preisdatenbankOptionsByTag?: Record<string, string[]>
  displayCurrency?: DisplayCurrency
}) {
  const structuraData = drafts?.structuraCladirii || {}
  const tipFundatieBeci = structuraData.tipFundatieBeci || form.tipFundatieBeci || 'Kein Keller (nur Bodenplatte)'
  const listaEtaje = Array.isArray(structuraData.listaEtaje) ? structuraData.listaEtaje : (Array.isArray(form.listaEtaje) ? form.listaEtaje : [])
  const aufstockungFloorKinds = Array.isArray(structuraData.aufstockungFloorKinds)
    ? structuraData.aufstockungFloorKinds
    : (Array.isArray(form.aufstockungFloorKinds) ? form.aufstockungFloorKinds : [])
  const isAufstockungFlow = resolveAufstockungFlow(form, wizardPackage)
  const hasBasement = tipFundatieBeci.includes('Keller') && !tipFundatieBeci.includes('Kein Keller')
  const hasMansarda = listaEtaje.some((e: string) => e.startsWith('mansarda'))
  const mansardaIndex = listaEtaje.findIndex((e: string) => e.startsWith('mansarda'))
  const showMansardaFields = hasMansarda && (!isAufstockungFlow || String(aufstockungFloorKinds[mansardaIndex] ?? '').toLowerCase() === 'new')
  const etajeIntermediare = listaEtaje.filter((e: string) => e === 'intermediar').length
  const totalFloors = 1 + etajeIntermediare
  const editableFloorIndexes = Array.from({ length: totalFloors }, (_, idx) => idx).filter(
    (idx) => !isAufstockungFlow || isAufstockungNewBuildStandardFloorIdx(idx, aufstockungFloorKinds),
  )

  const außenOptions = preisdatenbankOptionsByTag['wandaufbau_aussen'] ?? []
  const innenOptions = preisdatenbankOptionsByTag['wandaufbau_innen'] ?? []
  const displayAußen = (opt: string) =>
    adaptCurrencyCopy(
      paramLabelOverrides[optionValueToPriceKey['wandaufbau_aussen']?.[opt] ?? ''] ?? tOption('wandaufbau', 'außenwandeBeci', opt),
      displayCurrency,
    )
  const displayInnen = (opt: string) =>
    adaptCurrencyCopy(
      paramLabelOverrides[optionValueToPriceKey['wandaufbau_innen']?.[opt] ?? ''] ?? tOption('wandaufbau', 'innenwandeBeci', opt),
      displayCurrency,
    )

  return (
    <div className="space-y-4">
      {hasBasement && (
        <div className="flex gap-4 items-start">
          <label className="flex flex-col gap-1 flex-1" data-field="außenwandeBeci">
            <span className="wiz-label text-sun/90">Außenwände – Keller</span>
            <SelectSun
              value={form.außenwandeBeci || ''}
              onChange={(v) => setForm(prev => ({ ...prev, außenwandeBeci: v }))}
              options={außenOptions}
              displayFor={displayAußen}
            />
          </label>
          <label className="flex flex-col gap-1 flex-1" data-field="innenwandeBeci">
            <span className="wiz-label text-sun/90">Innenwände – Keller</span>
            <SelectSun
              value={form.innenwandeBeci || ''}
              onChange={(v) => setForm(prev => ({ ...prev, innenwandeBeci: v }))}
              options={innenOptions}
              displayFor={displayInnen}
            />
          </label>
        </div>
      )}
      {editableFloorIndexes.map((idx) => {
        const floorLabel = idx === 0 ? 'Erdgeschoss' : `Obergeschoss ${idx}`
        const floorKey = idx === 0 ? 'ground' : `floor_${idx}`
        return (
          <div key={floorKey} className="flex gap-4 items-start">
            <label className="flex flex-col gap-1 flex-1">
              <span className="wiz-label text-sun/90">Außenwände – {floorLabel}</span>
              <SelectSun
                value={form[`außenwande_${floorKey}`] || ''}
                onChange={(v) => setForm(prev => ({ ...prev, [`außenwande_${floorKey}`]: v }))}
                options={außenOptions}
                displayFor={displayAußen}
              />
            </label>
            <label className="flex flex-col gap-1 flex-1">
              <span className="wiz-label text-sun/90">Innenwände – {floorLabel}</span>
              <SelectSun
                value={form[`innenwande_${floorKey}`] || ''}
                onChange={(v) => setForm(prev => ({ ...prev, [`innenwande_${floorKey}`]: v }))}
                options={innenOptions}
                displayFor={displayInnen}
              />
            </label>
          </div>
        )
      })}
      {showMansardaFields && (
        <div className="flex gap-4 items-start">
          <label className="flex flex-col gap-1 flex-1">
            <span className="wiz-label text-sun/90">Außenwände – Dachgeschoss</span>
            <SelectSun
              value={form.außenwandeMansarda || ''}
              onChange={(v) => setForm(prev => ({ ...prev, außenwandeMansarda: v }))}
              options={außenOptions}
              displayFor={displayAußen}
            />
          </label>
          <label className="flex flex-col gap-1 flex-1">
            <span className="wiz-label text-sun/90">Innenwände – Dachgeschoss</span>
            <SelectSun
              value={form.innenwandeMansarda || ''}
              onChange={(v) => setForm(prev => ({ ...prev, innenwandeMansarda: v }))}
              options={innenOptions}
              displayFor={displayInnen}
            />
          </label>
        </div>
      )}
    </div>
  )
}

const WINTERGARTEN_BASE_OPTIONS = ['Glaswand', 'Plexiglaswand']
const BALKON_BASE_OPTIONS = ['Holzgeländer', 'Stahlgeländer', 'Glasgeländer']

function WintergaertenBalkoneStep({
  form,
  setForm,
  errors,
  optionValueToPriceKey = {},
  customOptionsForm = {},
  hiddenKeysForm = new Set<string>(),
  paramLabelOverrides = {},
  tOption,
  preisdatenbankOptionsByTag = {},
  displayCurrency = 'EUR',
}: {
  form: Record<string, any>
  setForm: (v: Record<string, any> | ((prev: Record<string, any>) => Record<string, any>)) => void
  errors: Errors
  optionValueToPriceKey?: Record<string, Record<string, string>>
  customOptionsForm?: Record<string, Array<{ label: string; value: string; price_key?: string }>>
  hiddenKeysForm?: Set<string>
  paramLabelOverrides?: Record<string, string>
  tOption: (stepKey: string, fieldName: string, opt: string) => string
  preisdatenbankOptionsByTag?: Record<string, string[]>
  displayCurrency?: DisplayCurrency
}) {
  const hasWintergarden = form.hasWintergarden === true
  const hasBalkone = form.hasBalkone === true

  const wintergartenOptions = preisdatenbankOptionsByTag['wintergarten_type'] ?? []
  const balkonOptions = preisdatenbankOptionsByTag['balkon_type'] ?? []

  return (
    <div className="space-y-4">
      {hasWintergarden && (
        <label className="flex flex-col gap-1" data-field="wintergartenTyp">
          <span className="wiz-label text-sun/90 font-medium">Wintergärten</span>
          <SelectSun
            value={form.wintergartenTyp || ''}
            onChange={(v) => setForm(prev => ({ ...prev, wintergartenTyp: v }))}
            options={wintergartenOptions}
            displayFor={(opt) =>
              adaptCurrencyCopy(
                paramLabelOverrides[optionValueToPriceKey['wintergarten_type']?.[opt] ?? ''] ??
                  tOption('wintergaertenBalkone', 'wintergartenTyp', opt),
                displayCurrency,
              )
            }
          />
        </label>
      )}
      {hasBalkone && (
        <label className="flex flex-col gap-1" data-field="balkonTyp">
          <span className="wiz-label text-sun/90 font-medium">Balkone</span>
          <SelectSun
            value={form.balkonTyp || ''}
            onChange={(v) => setForm(prev => ({ ...prev, balkonTyp: v }))}
            options={balkonOptions}
            displayFor={(opt) =>
              adaptCurrencyCopy(
                paramLabelOverrides[optionValueToPriceKey['balkon_type']?.[opt] ?? ''] ?? tOption('wintergaertenBalkone', 'balkonTyp', opt),
                displayCurrency,
              )
            }
          />
        </label>
      )}
      {!hasWintergarden && !hasBalkone && (
        <p className="text-sun/70 text-sm">Bitte in „Gebäudestruktur“ mindestens „Wintergarten vorhanden“ oder „Balkone vorhanden“ aktivieren.</p>
      )}
    </div>
  )
}

const BODENAUFBAU_OPTIONS = ['Geschossdecke Holz Standard', 'Holzbalkendecke', 'Massivdecke Stahlbeton', 'Bodenplatte Beton'] as const
const DECKENAUFBAU_OPTIONS = ['Gipskarton Standard', 'Gipskarton Akustik', 'Sichtschalung Holz', 'Unterdecke abgehängt'] as const
const BODENBELAG_OPTIONS = ['Estrich + Fliesen', 'Parkett Eiche', 'Laminat', 'Teppichboden'] as const

function BodenDeckeBelagStep({
  form,
  setForm,
  errors,
  drafts,
  wizardPackage,
  tOption,
  customOptionsForm = {},
  paramLabelOverrides = {},
  optionValueToPriceKey = {},
  hiddenKeysForm = new Set<string>(),
  preisdatenbankOptionsByTag = {},
  displayCurrency = 'EUR',
}: {
  form: Record<string, any>
  setForm: (v: Record<string, any> | ((prev: Record<string, any>) => Record<string, any>)) => void
  errors: Errors
  drafts: Drafts
  wizardPackage?: string
  tOption: (stepKey: string, fieldName: string, opt: string) => string
  customOptionsForm?: Record<string, Array<{ label: string; value: string; price_key?: string }>>
  paramLabelOverrides?: Record<string, string>
  optionValueToPriceKey?: Record<string, Record<string, string>>
  hiddenKeysForm?: Set<string>
  preisdatenbankOptionsByTag?: Record<string, string[]>
  displayCurrency?: DisplayCurrency
}) {
  const structuraData = drafts?.structuraCladirii || {}
  const tipFundatieBeci = structuraData.tipFundatieBeci || form.tipFundatieBeci || 'Kein Keller (nur Bodenplatte)'
  const listaEtaje = Array.isArray(structuraData.listaEtaje) ? structuraData.listaEtaje : (Array.isArray(form.listaEtaje) ? form.listaEtaje : [])
  const aufstockungFloorKinds = Array.isArray(structuraData.aufstockungFloorKinds)
    ? structuraData.aufstockungFloorKinds
    : (Array.isArray(form.aufstockungFloorKinds) ? form.aufstockungFloorKinds : [])
  const isAufstockungFlow = resolveAufstockungFlow(form, wizardPackage)
  const hasBasement = tipFundatieBeci.includes('Keller') && !tipFundatieBeci.includes('Kein Keller')
  const basementLivable = isKellerMitAusbauChoice(tipFundatieBeci)
  const hasMansarda = listaEtaje.some((e: string) => e.startsWith('mansarda'))
  const hasPod = listaEtaje.some((e: string) => e === 'pod')
  const mansardaIndex = listaEtaje.findIndex((e: string) => e.startsWith('mansarda'))
  const podIndex = listaEtaje.findIndex((e: string) => e === 'pod')
  const showMansardaFields = hasMansarda && (!isAufstockungFlow || String(aufstockungFloorKinds[mansardaIndex] ?? '').toLowerCase() === 'new')
  const showPodFields = hasPod && (!isAufstockungFlow || String(aufstockungFloorKinds[podIndex] ?? '').toLowerCase() === 'new')
  const etajeIntermediare = listaEtaje.filter((e: string) => e === 'intermediar').length
  const totalFloors = 1 + etajeIntermediare
  const editableFloorIndexes = Array.from({ length: totalFloors }, (_, idx) => idx).filter(
    (idx) => !isAufstockungFlow || isAufstockungNewBuildStandardFloorIdx(idx, aufstockungFloorKinds),
  )
  const bodenaufbauOptions = preisdatenbankOptionsByTag['bodenaufbau'] ?? []
  const deckenaufbauOptions = preisdatenbankOptionsByTag['deckenaufbau'] ?? []
  const bodenbelagOptions = preisdatenbankOptionsByTag['bodenbelag'] ?? []
  const displayBodenaufbau = (opt: string) =>
    adaptCurrencyCopy(
      paramLabelOverrides[optionValueToPriceKey['bodenaufbau']?.[opt] ?? ''] ?? tOption('bodenDeckeBelag', 'bodenaufbau', opt),
      displayCurrency,
    )
  const displayDeckenaufbau = (opt: string) =>
    adaptCurrencyCopy(
      paramLabelOverrides[optionValueToPriceKey['deckenaufbau']?.[opt] ?? ''] ?? tOption('bodenDeckeBelag', 'deckenaufbau', opt),
      displayCurrency,
    )
  const displayBodenbelag = (opt: string) =>
    adaptCurrencyCopy(
      paramLabelOverrides[optionValueToPriceKey['bodenbelag']?.[opt] ?? ''] ?? tOption('bodenDeckeBelag', 'bodenbelag', opt),
      displayCurrency,
    )
  return (
    <div className="space-y-4">
      <p className="text-sun/70 text-sm">Wählen Sie für jede Etage die passende Konstruktion und den entsprechenden Bodenaufbau entsprechend Ihrer Gebäudeplanung.</p>
      {hasBasement && basementLivable && (
        <div className="rounded-lg border border-white/10 p-3 space-y-3 bg-panel/30">
          <span className="wiz-label text-sun/90 font-medium">Keller</span>
          <div className="flex flex-wrap gap-4 items-start">
            <label className="flex flex-col gap-1 min-w-[180px]">
              <span className="text-xs text-sun/70">Bodenbelag</span>
              <SelectSun
                value={form.bodenbelagBeci || ''}
                onChange={(v) => setForm(prev => ({ ...prev, bodenbelagBeci: v }))}
                options={bodenbelagOptions}
                displayFor={displayBodenbelag}
              />
            </label>
            <label className="flex flex-col gap-1 min-w-[180px]">
              <span className="text-xs text-sun/70">Deckenaufbau</span>
              <SelectSun
                value={form.deckenaufbauBeci || ''}
                onChange={(v) => setForm(prev => ({ ...prev, deckenaufbauBeci: v }))}
                options={deckenaufbauOptions}
                displayFor={displayDeckenaufbau}
              />
            </label>
          </div>
        </div>
      )}
      {editableFloorIndexes.map((idx) => {
        const floorLabel = idx === 0 ? 'Erdgeschoss' : `Obergeschoss ${idx}`
        const floorKey = idx === 0 ? 'ground' : `floor_${idx}`
        const isParter = idx === 0
        const showBodenaufbauParter = hasBasement || !isParter
        return (
          <div key={floorKey} className="rounded-lg border border-white/10 p-3 space-y-3 bg-panel/30">
            <span className="wiz-label text-sun/90 font-medium">{floorLabel}</span>
            <div className="flex flex-wrap gap-4 items-start">
              {showBodenaufbauParter && (
                <label className="flex flex-col gap-1 min-w-[180px]">
                  <span className="text-xs text-sun/70">Bodenaufbau</span>
                  <SelectSun
                    value={form[`bodenaufbau_${floorKey}`] || ''}
                    onChange={(v) => setForm(prev => ({ ...prev, [`bodenaufbau_${floorKey}`]: v }))}
                    options={bodenaufbauOptions}
                    displayFor={displayBodenaufbau}
                  />
                </label>
              )}
              <label className="flex flex-col gap-1 min-w-[180px]">
                <span className="text-xs text-sun/70">Bodenbelag</span>
                <SelectSun
                  value={form[`bodenbelag_${floorKey}`] || ''}
                  onChange={(v) => setForm(prev => ({ ...prev, [`bodenbelag_${floorKey}`]: v }))}
                  options={bodenbelagOptions}
                  displayFor={displayBodenbelag}
                />
              </label>
              <label className="flex flex-col gap-1 min-w-[180px]">
                <span className="text-xs text-sun/70">Deckenaufbau</span>
                <SelectSun
                  value={form[`deckenaufbau_${floorKey}`] || ''}
                  onChange={(v) => setForm(prev => ({ ...prev, [`deckenaufbau_${floorKey}`]: v }))}
                  options={deckenaufbauOptions}
                  displayFor={displayDeckenaufbau}
                />
              </label>
            </div>
          </div>
        )
      })}
      {showMansardaFields && (
        <div className="rounded-lg border border-white/10 p-3 space-y-3 bg-panel/30">
          <span className="wiz-label text-sun/90 font-medium">Dachgeschoss</span>
          <div className="flex flex-wrap gap-4 items-start">
            <label className="flex flex-col gap-1 min-w-[180px]">
              <span className="text-xs text-sun/70">Bodenaufbau</span>
              <SelectSun
                value={form.bodenaufbauMansarda || ''}
                onChange={(v) => setForm(prev => ({ ...prev, bodenaufbauMansarda: v }))}
                options={bodenaufbauOptions}
                displayFor={displayBodenaufbau}
              />
            </label>
            <label className="flex flex-col gap-1 min-w-[180px]">
              <span className="text-xs text-sun/70">Bodenbelag</span>
              <SelectSun
                value={form.bodenbelagMansarda || ''}
                onChange={(v) => setForm(prev => ({ ...prev, bodenbelagMansarda: v }))}
                options={bodenbelagOptions}
                displayFor={displayBodenbelag}
              />
            </label>
            <label className="flex flex-col gap-1 min-w-[180px]">
              <span className="text-xs text-sun/70">Deckenaufbau</span>
              <SelectSun
                value={form.deckenaufbauMansarda || ''}
                onChange={(v) => setForm(prev => ({ ...prev, deckenaufbauMansarda: v }))}
                options={deckenaufbauOptions}
                displayFor={displayDeckenaufbau}
              />
            </label>
          </div>
        </div>
      )}
      {showPodFields && (
        <div className="rounded-lg border border-white/10 p-3 space-y-3 bg-panel/30">
          <span className="wiz-label text-sun/90 font-medium">Dachboden</span>
          <div className="flex flex-wrap gap-4 items-start">
            <label className="flex flex-col gap-1 min-w-[180px]">
              <span className="text-xs text-sun/70">Bodenaufbau</span>
              <SelectSun
                value={form.bodenaufbauPod || ''}
                onChange={(v) => setForm(prev => ({ ...prev, bodenaufbauPod: v }))}
                options={bodenaufbauOptions}
                displayFor={displayBodenaufbau}
              />
            </label>
            <label className="flex flex-col gap-1 min-w-[180px]">
              <span className="text-xs text-sun/70">Bodenbelag (wenn ausgebaut)</span>
              <SelectSun
                value={form.bodenbelagPod || ''}
                onChange={(v) => setForm(prev => ({ ...prev, bodenbelagPod: v }))}
                options={bodenbelagOptions}
                placeholder="— auswählen —"
                displayFor={displayBodenbelag}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  )
}

function MaterialeFinisajStep({ form, setForm, errors, drafts, wizardPackage, customOptionsForm = {}, paramLabelOverrides = {}, optionValueToPriceKey = {}, hiddenKeysForm = new Set<string>(), tOption, preisdatenbankOptionsByTag = {}, displayCurrency = 'EUR' }: { form: Record<string, any>; setForm: (v: Record<string, any> | ((prev: Record<string, any>) => Record<string, any>)) => void; errors: Errors; drafts: Drafts; wizardPackage?: string; customOptionsForm?: Record<string, Array<{ label: string; value: string; price_key?: string }>>; paramLabelOverrides?: Record<string, string>; optionValueToPriceKey?: Record<string, Record<string, string>>; hiddenKeysForm?: Set<string>; tOption: (stepKey: string, fieldName: string, opt: string) => string; preisdatenbankOptionsByTag?: Record<string, string[]>; displayCurrency?: DisplayCurrency }) {
  const structuraData = drafts?.structuraCladirii || {}
  const tipFundatieBeci = structuraData.tipFundatieBeci || form.tipFundatieBeci || 'Kein Keller (nur Bodenplatte)'
  const listaEtaje = Array.isArray(structuraData.listaEtaje) ? structuraData.listaEtaje : (Array.isArray(form.listaEtaje) ? form.listaEtaje : [])
  const aufstockungFloorKinds = Array.isArray(structuraData.aufstockungFloorKinds)
    ? structuraData.aufstockungFloorKinds
    : (Array.isArray(form.aufstockungFloorKinds) ? form.aufstockungFloorKinds : [])
  const isAufstockungFlow = resolveAufstockungFlow(form, wizardPackage)
  const hasBasement = tipFundatieBeci.includes('Keller') && !tipFundatieBeci.includes('Kein Keller')
  const basementLivable = isKellerMitAusbauChoice(tipFundatieBeci)
  const hasMansarda = listaEtaje.some((e: string) => e.startsWith('mansarda'))
  const mansardaIndex = listaEtaje.findIndex((e: string) => e.startsWith('mansarda'))
  const showMansardaFields = hasMansarda && (!isAufstockungFlow || String(aufstockungFloorKinds[mansardaIndex] ?? '').toLowerCase() === 'new')
  const etajeIntermediare = listaEtaje.filter((e: string) => e === 'intermediar').length
  const totalFloors = 1 + etajeIntermediare
  const editableFloorIndexes = Array.from({ length: totalFloors }, (_, idx) => idx).filter(
    (idx) => !isAufstockungFlow || isAufstockungNewBuildStandardFloorIdx(idx, aufstockungFloorKinds),
  )
  const INTERIOR_FINISH_KEY: Record<string, string> = { 'Tencuială': 'interior_tencuiala', 'Lemn': 'interior_lemn', 'Fibrociment': 'interior_fibrociment', 'Mix': 'interior_mix' }
  const INTERIOR_OUTER_FINISH_KEY: Record<string, string> = { 'Tencuială': 'interior_outer_tencuiala', 'Lemn': 'interior_outer_lemn', 'Fibrociment': 'interior_outer_fibrociment', 'Mix': 'interior_outer_mix' }
  const EXTERIOR_FACADE_KEY: Record<string, string> = { 'Tencuială': 'exterior_tencuiala', 'Lemn': 'exterior_lemn', 'Fibrociment': 'exterior_fibrociment', 'Mix': 'exterior_mix' }
  const finishOptionsInteriorInner = useMemo(() => [...(preisdatenbankOptionsByTag['interior_finish_interior_walls'] ?? preisdatenbankOptionsByTag['interior_finish'] ?? [])], [preisdatenbankOptionsByTag['interior_finish_interior_walls'], preisdatenbankOptionsByTag['interior_finish']])
  const finishOptionsInteriorOuter = useMemo(() => [...(preisdatenbankOptionsByTag['interior_finish_exterior_walls'] ?? preisdatenbankOptionsByTag['interior_finish'] ?? [])], [preisdatenbankOptionsByTag['interior_finish_exterior_walls'], preisdatenbankOptionsByTag['interior_finish']])
  const finishOptionsExterior = useMemo(() => [...(preisdatenbankOptionsByTag['exterior_facade'] ?? [])], [preisdatenbankOptionsByTag['exterior_facade']])
  const displayFinish = (fieldName: string, opt: string) => {
    const isExterior = fieldName.startsWith('fatada')
    const isInteriorOuter = fieldName.startsWith('finisajInteriorAussen')
    const key = isExterior ? EXTERIOR_FACADE_KEY[opt] : isInteriorOuter ? INTERIOR_OUTER_FINISH_KEY[opt] : INTERIOR_FINISH_KEY[opt]
    let raw: string
    if (key && paramLabelOverrides[key]) raw = paramLabelOverrides[key]
    else {
      const tag = isExterior ? 'exterior_facade' : isInteriorOuter ? 'interior_finish_exterior_walls' : 'interior_finish_interior_walls'
      const pk = optionValueToPriceKey[tag]?.[opt] ?? (!isExterior && !isInteriorOuter ? optionValueToPriceKey['interior_finish']?.[opt] : undefined)
      if (pk && paramLabelOverrides[pk]) raw = paramLabelOverrides[pk]
      else raw = tOption('materialeFinisaj', fieldName, opt) || opt
    }
    return adaptCurrencyCopy(raw, displayCurrency)
  }

  return (
    <div className="space-y-4">
      {hasBasement && basementLivable && (
        <label className="flex flex-col gap-1" data-field="finisajInteriorBeci">
          <span className="wiz-label text-sun/90">Innenausbau (Keller)</span>
          <div className={errors.finisajInteriorBeci ? 'ring-2 ring-orange-400/60 rounded-lg' : ''}>
            <SelectSun value={form.finisajInteriorBeci || ''} onChange={(v) => setForm(prev => ({ ...prev, finisajInteriorBeci: v }))} options={finishOptionsInteriorInner} displayFor={(opt) => displayFinish('finisajInteriorBeci', opt)} />
          </div>
        </label>
      )}
      {editableFloorIndexes.map((idx) => {
        const floorLabel = idx === 0 ? 'Erdgeschoss' : `Obergeschoss ${idx}`
        const floorKey = idx === 0 ? 'ground' : `floor_${idx}`
        return (
          <div key={floorKey} className="grid gap-4 md:grid-cols-3 items-start">
            <label className="flex flex-col gap-1 flex-1">
              <span className="wiz-label text-sun/90">Innenausbau Innenwände - {floorLabel}</span>
              <SelectSun value={form[`finisajInteriorInnen_${floorKey}`] || form[`finisajInterior_${floorKey}`] || ''} onChange={(v) => setForm(prev => ({ ...prev, [`finisajInteriorInnen_${floorKey}`]: v }))} options={finishOptionsInteriorInner} displayFor={(opt) => displayFinish(`finisajInteriorInnen_${floorKey}`, opt)} />
            </label>
            <label className="flex flex-col gap-1 flex-1">
              <span className="wiz-label text-sun/90">Innenausbau Außenwände - {floorLabel}</span>
              <SelectSun value={form[`finisajInteriorAussen_${floorKey}`] || form[`finisajInterior_${floorKey}`] || ''} onChange={(v) => setForm(prev => ({ ...prev, [`finisajInteriorAussen_${floorKey}`]: v }))} options={finishOptionsInteriorOuter} displayFor={(opt) => displayFinish(`finisajInteriorAussen_${floorKey}`, opt)} />
            </label>
            <label className="flex flex-col gap-1 flex-1">
              <span className="wiz-label text-sun/90">Fassade - {floorLabel}</span>
              <SelectSun value={form[`fatada_${floorKey}`] || ''} onChange={(v) => setForm(prev => ({ ...prev, [`fatada_${floorKey}`]: v }))} options={finishOptionsExterior} displayFor={(opt) => displayFinish(`fatada_${floorKey}`, opt)} />
            </label>
          </div>
        )
      })}
      {showMansardaFields && (
        <div className="grid gap-4 md:grid-cols-3 items-start">
          <label className="flex flex-col gap-1 flex-1">
            <span className="wiz-label text-sun/90">Innenausbau Innenwände - Dachgeschoss</span>
            <SelectSun value={form.finisajInteriorInnenMansarda || form.finisajInteriorMansarda || ''} onChange={(v) => setForm(prev => ({ ...prev, finisajInteriorInnenMansarda: v }))} options={finishOptionsInteriorInner} displayFor={(opt) => displayFinish('finisajInteriorInnenMansarda', opt)} />
          </label>
          <label className="flex flex-col gap-1 flex-1">
            <span className="wiz-label text-sun/90">Innenausbau Außenwände - Dachgeschoss</span>
            <SelectSun value={form.finisajInteriorAussenMansarda || form.finisajInteriorMansarda || ''} onChange={(v) => setForm(prev => ({ ...prev, finisajInteriorAussenMansarda: v }))} options={finishOptionsInteriorOuter} displayFor={(opt) => displayFinish('finisajInteriorAussenMansarda', opt)} />
          </label>
          <label className="flex flex-col gap-1 flex-1">
            <span className="wiz-label text-sun/90">Fassade - Dachgeschoss</span>
            <SelectSun value={form.fatadaMansarda || ''} onChange={(v) => setForm(prev => ({ ...prev, fatadaMansarda: v }))} options={finishOptionsExterior} displayFor={(opt) => displayFinish('fatadaMansarda', opt)} />
          </label>
        </div>
      )}
    </div>
  )
}

/* =============== Gebäudestruktur: listaEtaje + ilustrație casă (stack bottom-up) =============== */
const FLOOR_TYPE_OPTIONS = [
  { value: 'intermediar', label: 'Obergeschoss (Wohnfläche)' },
  { value: 'pod', label: 'Dachboden (Keine Wohnfläche)' },
  { value: 'mansarda_ohne', label: 'Dachgeschoss ohne Kniestock (Wohnfläche)' },
  { value: 'mansarda_mit', label: 'Dachgeschoss mit Kniestock (Wohnfläche)' },
] as const

const FOUNDATION_OPTIONS = [
  'Kein Keller (nur Bodenplatte)',
  'Keller (ohne Ausbau)',
  'Keller (mit Ausbau)',
] as const
const FLOOR_HEIGHT_OPTIONS = ['Standard (2,50 m)', 'Komfort (2,70 m)', 'Hoch (2,85+ m)'] as const
const STAIR_TYPE_OPTIONS = ['Standard', 'Holz', 'Beton', 'Metall', 'Sonder'] as const

function BuildingStructureStep({ form, setForm, errors, hiddenKeysForm = new Set<string>(), optionValueToPriceKey = {}, customOptionsForm = {}, paramLabelOverrides = {}, preisdatenbankOptionsByTag = {}, displayCurrency = 'EUR', wizardPackage }: { form: Record<string, any>; setForm: (v: Record<string, any> | ((prev: Record<string, any>) => Record<string, any>)) => void; errors: Errors; hiddenKeysForm?: Set<string>; optionValueToPriceKey?: Record<string, Record<string, string>>; customOptionsForm?: Record<string, Array<{ label: string; value: string; price_key?: string }>>; paramLabelOverrides?: Record<string, string>; preisdatenbankOptionsByTag?: Record<string, string[]>; displayCurrency?: DisplayCurrency; wizardPackage?: string }) {
  const [showAddFloorDropdown, setShowAddFloorDropdown] = useState(false)
  const addFloorBtnRef = useRef<HTMLButtonElement>(null)
  const [addFloorPos, setAddFloorPos] = useState<{ left: number; top: number; width: number }>({ left: 0, top: 0, width: 0 })

  const tipFundatieBeci = form.tipFundatieBeci || 'Kein Keller (nur Bodenplatte)'
  const pilons = form.pilons === true
  const inaltimeEtaje = form.inaltimeEtaje || 'Standard (2,50 m)'
  const listaEtaje = Array.isArray(form.listaEtaje) ? form.listaEtaje : []
  const aufstockungFloorKinds = Array.isArray(form.aufstockungFloorKinds) ? form.aufstockungFloorKinds : []
  const resolvedWizardPackage = String(wizardPackage ?? form.wizardPackage ?? '').toLowerCase()
  const isAufstockungFlow = resolvedWizardPackage === 'aufstockung'
  const foundationOptions = preisdatenbankOptionsByTag['foundation_type'] ?? []
  const floorHeightOptions = preisdatenbankOptionsByTag['floor_height'] ?? []
  const stairTypeOptions = preisdatenbankOptionsByTag['stairs_type'] ?? []
  const hasBasement = tipFundatieBeci.includes('Keller') && !tipFundatieBeci.includes('Kein Keller')
  const hasBase = true
  const basementUse = isKellerMitAusbauChoice(tipFundatieBeci)
  useEffect(() => {
    if (foundationOptions.length > 0 && !foundationOptions.includes(tipFundatieBeci)) {
      setForm(prev => ({ ...prev, tipFundatieBeci: foundationOptions[0] }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- sync when hidden options change; form used only for merge
  }, [foundationOptions.length, foundationOptions.join(','), tipFundatieBeci])
  useEffect(() => {
    if (floorHeightOptions.length > 0 && !floorHeightOptions.includes(inaltimeEtaje)) {
      setForm(prev => ({ ...prev, inaltimeEtaje: floorHeightOptions[0] }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- sync when hidden options change
  }, [floorHeightOptions.length, floorHeightOptions.join(','), inaltimeEtaje])
  const etajeIntermediare = listaEtaje.filter((e: string) => e === 'intermediar').length
  const hasFloorAboveGround = listaEtaje.some((e: string) => e !== 'parter')
  const stairOptsEffective = stairTypeOptions.length > 0 ? stairTypeOptions : Array.from(STAIR_TYPE_OPTIONS)
  useEffect(() => {
    if (!hasFloorAboveGround) return
    const def = stairOptsEffective[0] ?? 'Standard'
    if (form.treppeTyp == null || String(form.treppeTyp).trim() === '') {
      setForm((prev: Record<string, any>) => ({ ...prev, treppeTyp: def }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- default treppe when field becomes visible
  }, [hasFloorAboveGround, stairOptsEffective.join(',')])
  useEffect(() => {
    if (!hasFloorAboveGround || stairOptsEffective.length === 0) return
    const cur = form.treppeTyp != null ? String(form.treppeTyp) : ''
    if (cur && !stairOptsEffective.includes(cur)) {
      setForm((prev: Record<string, any>) => ({ ...prev, treppeTyp: stairOptsEffective[0] }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- resync when DB option list changes
  }, [hasFloorAboveGround, stairOptsEffective.join(','), form.treppeTyp])
  const hasPod = listaEtaje.some((e: string) => e === 'pod')
  const hasMansarda = listaEtaje.some((e: string) => e.startsWith('mansarda'))
  const mansardaType = listaEtaje.find((e: string) => e.startsWith('mansarda'))?.split('_')[1] ?? null
  const canAddFloors = !hasPod && !hasMansarda && listaEtaje.length < 4
  const floorsNumber = etajeIntermediare
  const normalizeAufstockungFloorKinds = useCallback(
    (source: unknown[], targetFloors: string[] = listaEtaje) =>
      targetFloors.map((_, idx) => {
        const floorType = String(targetFloors[idx] ?? '').toLowerCase()
        const v = String(source?.[idx] ?? '').toLowerCase()
        if (v === 'new') return 'new'
        if (v === 'existing') return 'existing'
        // Parter defaults to 'existing'; all other unset floors default based on position (last = new)
        if (floorType === 'parter') return 'existing'
        return idx === targetFloors.length - 1 ? 'new' : 'existing'
      }),
    [listaEtaje],
  )
  useEffect(() => {
    if (!isAufstockungFlow) return
    const normalized = normalizeAufstockungFloorKinds(aufstockungFloorKinds)
    const same =
      normalized.length === aufstockungFloorKinds.length &&
      normalized.every((v, idx) => v === aufstockungFloorKinds[idx])
    if (same) return
    setForm((prev: Record<string, any>) => ({ ...prev, aufstockungFloorKinds: normalized }))
  // eslint-disable-next-line react-hooks/exhaustive-deps -- normalize local floor kind state when floor list changes
  }, [isAufstockungFlow, listaEtaje.length, normalizeAufstockungFloorKinds, aufstockungFloorKinds.join('|')])

  const getRandomImage = (options: string[], seed: string) => {
    let hash = 0
    for (let i = 0; i < seed.length; i++) { hash = ((hash << 5) - hash) + seed.charCodeAt(i); hash = hash & hash }
    return options[Math.abs(hash) % options.length]
  }
  const downImage = getRandomImage(['/builder/down1.png', '/builder/down2.png'], `down-${floorsNumber}`)
  const upImages: string[] = []
  for (let i = 0; i < floorsNumber; i++) upImages.push(getRandomImage(['/builder/up1.png', '/builder/up2.png', '/builder/up3.png'], `up-${i}-${floorsNumber}`))
  const mansardeImage = getRandomImage(['/builder/mansarde1.png', '/builder/mansarde2.png'], 'mansarde')
  const mansardeSmallImage = getRandomImage(['/builder/mansarde-small1.png', '/builder/mansarde-small2.png'], 'mansarde-small')

  const [originalSizes, setOriginalSizes] = useState<Record<string, { width: number; height: number }>>({})
  const [scaleFactor, setScaleFactor] = useState(1)
  const [heights, setHeights] = useState<Record<string, number>>({})
  const [viewportWidth, setViewportWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024)
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const updateOriginalSize = useCallback((key: string, w: number, h: number) => {
    setOriginalSizes(prev => (prev[key]?.width === w && prev[key]?.height === h ? prev : { ...prev, [key]: { width: w, height: h } }))
  }, [])

  useEffect(() => {
    const targetWidth = viewportWidth < 480 ? 140 : viewportWidth < 640 ? 180 : viewportWidth < 1024 ? 220 : 300
    const sizes = Object.values(originalSizes)
    if (sizes.length === 0) return
    const maxW = Math.max(...sizes.map(s => s.width))
    if (maxW > 0) setScaleFactor(targetWidth / maxW)
  }, [originalSizes, viewportWidth])
  // Înălțimi implicite pentru straturi (beci, base, pilons) până când imaginile se încarcă – astfel pozițiile sunt corecte de la început
  const DEFAULT_LAYER_HEIGHT = 80
  const DEFAULT_BASEMENT_HEIGHT = 100
  useEffect(() => {
    const next: Record<string, number> = {}
    Object.entries(originalSizes).forEach(([k, s]) => { next[k] = s.height * scaleFactor })
    if (hasBasement && next.basement == null) next.basement = DEFAULT_BASEMENT_HEIGHT
    if (hasBase && next.base == null) next.base = DEFAULT_LAYER_HEIGHT
    if (pilons && next.pilons == null) next.pilons = DEFAULT_LAYER_HEIGHT
    setHeights(next)
  }, [originalSizes, scaleFactor, hasBasement, hasBase, pilons])

  const groundHeight = heights.ground ?? 0
  const groundBottom = 0
  const basementHeight = heights.basement ?? 0
  // Piloni, fundație, beci: aliniere cu partea de SUS a imaginii ground (fix sub etajul cel mai de jos)
  const groundTop = groundBottom + groundHeight
  const basementBottom = hasBasement ? groundTop - basementHeight : -1
  const baseHeight = heights.base ?? 0
  let baseBottom = -10000
  if (hasBase && baseHeight > 0) {
    if (hasBasement) baseBottom = basementBottom - baseHeight
    else baseBottom = groundTop - baseHeight
  }
  const pilonsHeight = heights.pilons ?? 0
  let pilonsBottom = -10000
  if (pilons && pilonsHeight > 0) {
    if (hasBase && baseHeight > 0 && baseBottom > -10000) pilonsBottom = baseBottom - pilonsHeight
    else if (hasBasement) pilonsBottom = basementBottom - pilonsHeight
    else pilonsBottom = groundTop - pilonsHeight
  }
  const downBottom = groundBottom + groundHeight
  const upBottoms: number[] = []
  let currentBottom = downBottom + (heights.down ?? 0)
  for (let i = 0; i < floorsNumber; i++) {
    upBottoms.push(currentBottom)
    currentBottom += heights[`up-${i}`] ?? 0
  }
  const roofBottom = (hasPod || hasMansarda) ? currentBottom : -1
  let topElementTop = currentBottom
  if (hasPod && (heights.roof ?? 0) > 0) topElementTop += heights.roof
  else if (hasMansarda) {
    if (mansardaType === 'ohne' && (heights['mansarde-small'] ?? 0) > 0) topElementTop += heights['mansarde-small']
    else if ((heights.mansarde ?? 0) > 0) topElementTop += heights.mansarde
  }
  const topMargin = (hasPod || hasMansarda) ? 30 : 75
  // Înălțimea frame-ului NU depinde de piloni / beci / fundație – doar de parter + etaje + acoperiș
  const paddingTopValue = topMargin
  const frameHeight = Math.max(topElementTop - groundBottom + topMargin, 320)
  const effectiveTargetWidth = viewportWidth < 480 ? 140 : viewportWidth < 640 ? 180 : viewportWidth < 1024 ? 220 : 300
  const getScaledWidth = (key: string) => (originalSizes[key] ? originalSizes[key].width * scaleFactor : effectiveTargetWidth)
  const containerWidth = Math.max(...Object.keys(originalSizes).length ? Object.keys(originalSizes).map(getScaledWidth) : [effectiveTargetWidth], effectiveTargetWidth)
  const contentWidth = containerWidth + 40 + 420 + 40 + 40

  const placeAddFloorDropdown = useCallback(() => {
    const b = addFloorBtnRef.current?.getBoundingClientRect()
    if (!b) return
    setAddFloorPos({ left: Math.round(b.left), top: Math.round(b.bottom + 6), width: Math.round(b.width) })
  }, [])
  useLayoutEffect(() => { if (showAddFloorDropdown) placeAddFloorDropdown() }, [showAddFloorDropdown, placeAddFloorDropdown])
  useEffect(() => {
    if (!showAddFloorDropdown) return
    const onScroll = () => placeAddFloorDropdown()
    const onResize = () => placeAddFloorDropdown()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onResize) }
  }, [showAddFloorDropdown, placeAddFloorDropdown])
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!showAddFloorDropdown) return
      const t = e.target as Node
      if (addFloorBtnRef.current?.contains(t)) return
      setShowAddFloorDropdown(false)
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setShowAddFloorDropdown(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc) }
  }, [showAddFloorDropdown])

  const handleAddFloor = (floorType: string) => {
    const nextLista = [...listaEtaje, floorType]
    setForm(prev => ({
      ...prev,
      listaEtaje: nextLista,
      ...(isAufstockungFlow
        ? { aufstockungFloorKinds: normalizeAufstockungFloorKinds(Array.isArray(prev.aufstockungFloorKinds) ? prev.aufstockungFloorKinds : [], nextLista) }
        : {}),
    }))
    setShowAddFloorDropdown(false)
  }

  return (
    <div className="w-full flex flex-col items-start">
      <div className="flex flex-col gap-4 !pb-0 w-full max-w-full">
        <div className="flex gap-10 items-center w-full">
        <div className="relative flex-shrink-0 border-2 border-white/20 rounded-xl overflow-hidden bg-panel/50" style={{ width: `${containerWidth}px`, height: `${frameHeight}px` }}>
          <div
            className="relative w-full h-full betonbot-building-structure-illus"
            style={{ paddingTop: `${paddingTopValue}px` }}
          >
            {/* Ground și etaje la spate; piloni, fundație, beci desenate în față (z-index mai mare) */}
            <img src="/builder/ground.png" alt="Ground" className="absolute" style={{ width: `${getScaledWidth('ground')}px`, height: 'auto', bottom: `${groundBottom}px`, left: '50%', transform: 'translateX(-50%)', zIndex: 1 }} onLoad={(e) => { const img = e.currentTarget; if (img?.naturalWidth > 0 && img.naturalHeight > 0) updateOriginalSize('ground', img.naturalWidth, img.naturalHeight) }} />
            <img src={downImage} alt="Down" className="absolute" style={{ width: `${getScaledWidth('down')}px`, height: 'auto', bottom: `${downBottom}px`, left: '50%', transform: 'translateX(-50%)', zIndex: 25 }} onLoad={(e) => { const img = e.currentTarget; if (img?.naturalWidth > 0 && img.naturalHeight > 0) updateOriginalSize('down', img.naturalWidth, img.naturalHeight) }} />
            {upImages.map((img, i) => (
              <img key={`up-${i}`} src={img} alt={`Floor ${i + 1}`} className="absolute" style={{ width: `${getScaledWidth(`up-${i}`)}px`, height: 'auto', bottom: `${upBottoms[i] ?? 0}px`, left: '50%', transform: 'translateX(-50%)', zIndex: 30 + i }} onLoad={(e) => { const im = e.currentTarget; if (im?.naturalWidth > 0 && im.naturalHeight > 0) updateOriginalSize(`up-${i}`, im.naturalWidth, im.naturalHeight) }} />
            ))}
            {hasPod && roofBottom >= 0 && <img src="/builder/roof.png" alt="Dachboden" className="absolute" style={{ width: `${getScaledWidth('roof')}px`, height: 'auto', bottom: `${roofBottom}px`, left: '50%', transform: 'translateX(-50%)', zIndex: 50 }} onLoad={(e) => { const img = e.currentTarget; if (img?.naturalWidth > 0 && img.naturalHeight > 0) updateOriginalSize('roof', img.naturalWidth, img.naturalHeight) }} />}
            {hasMansarda && roofBottom >= 0 && (mansardaType === 'ohne' ? <img src={mansardeSmallImage} alt="Dachgeschoss ohne Kniestock" className="absolute" style={{ width: `${getScaledWidth('mansarde-small')}px`, height: 'auto', bottom: `${roofBottom}px`, left: '50%', transform: 'translateX(-50%)', zIndex: 50 }} onLoad={(e) => { const img = e.currentTarget; if (img?.naturalWidth > 0 && img.naturalHeight > 0) updateOriginalSize('mansarde-small', img.naturalWidth, img.naturalHeight) }} /> : <img src={mansardeImage} alt="Dachgeschoss mit Kniestock" className="absolute" style={{ width: `${getScaledWidth('mansarde')}px`, height: 'auto', bottom: `${roofBottom}px`, left: '50%', transform: 'translateX(-50%)', zIndex: 50 }} onLoad={(e) => { const img = e.currentTarget; if (img?.naturalWidth > 0 && img.naturalHeight > 0) updateOriginalSize('mansarde', img.naturalWidth, img.naturalHeight) }} />)}
            {/* Piloni, fundație, beci în față (z-index > etaje) și aliniate cu partea de sus a ground */}
            {pilons && <img src="/builder/pilons.png" alt="Pilons" className="absolute" style={{ width: `${getScaledWidth('pilons')}px`, height: 'auto', bottom: `${pilonsBottom}px`, left: '50%', transform: 'translateX(-50%)', zIndex: 60 }} onLoad={(e) => { const img = e.currentTarget; if (img?.naturalWidth > 0 && img.naturalHeight > 0) updateOriginalSize('pilons', img.naturalWidth, img.naturalHeight) }} />}
            {hasBase && <img src="/builder/base.png" alt="Base" className="absolute" style={{ width: `${getScaledWidth('base')}px`, height: 'auto', bottom: `${baseBottom}px`, left: '50%', transform: 'translateX(-50%)', zIndex: 65 }} onLoad={(e) => { const img = e.currentTarget; if (img?.naturalWidth > 0 && img.naturalHeight > 0) updateOriginalSize('base', img.naturalWidth, img.naturalHeight) }} />}
            {hasBasement && <img src={basementUse ? '/builder/basement-live.png' : '/builder/basement-empty.png'} alt="Basement" className="absolute object-cover object-center" style={{ width: `${getScaledWidth('basement')}px`, height: `${basementHeight}px`, bottom: `${basementBottom}px`, left: '50%', transform: 'translateX(-50%)', zIndex: 70 }} onLoad={(e) => { const img = e.currentTarget; if (img?.naturalWidth > 0 && img.naturalHeight > 0) updateOriginalSize('basement', img.naturalWidth, img.naturalHeight) }} />}
          </div>
        </div>

      <div className="flex-1 min-w-0 relative z-10 space-y-4 !pb-0 !mb-0">
        <label className="flex flex-col gap-1" data-field="inaltimeEtaje">
          <span className="wiz-label text-sun/90">
            {adaptCurrencyCopy(tFieldLabel('structuraCladirii', 'inaltimeEtaje', undefined), displayCurrency)}
          </span>
          <div className={errors.inaltimeEtaje ? 'ring-2 ring-orange-400/60 rounded-lg' : ''}>
            <SelectSun
              value={inaltimeEtaje}
              onChange={(v) => setForm(prev => ({ ...prev, inaltimeEtaje: v }))}
              options={floorHeightOptions}
              placeholder="Wählen Sie eine Option"
              displayFor={(opt) =>
                adaptCurrencyCopy(paramLabelOverrides[optionValueToPriceKey['floor_height']?.[opt] ?? ''] ?? opt, displayCurrency)
              }
            />
          </div>
          {errors.inaltimeEtaje && <span className="text-xs text-orange-400">{errors.inaltimeEtaje}</span>}
        </label>

        <label className="flex flex-col gap-1" data-field="tipFundatieBeci">
          <span className="wiz-label text-sun/90">Untergeschoss / Fundament</span>
          <div className={errors.tipFundatieBeci ? 'ring-2 ring-orange-400/60 rounded-lg' : ''}>
            <SelectSun
              value={foundationOptions.includes(tipFundatieBeci) ? tipFundatieBeci : (foundationOptions[0] ?? '')}
              onChange={(v) => setForm(prev => ({ ...prev, tipFundatieBeci: v }))}
              options={foundationOptions}
              placeholder="Wählen Sie eine Option"
              displayFor={(opt) =>
                adaptCurrencyCopy(paramLabelOverrides[optionValueToPriceKey['foundation_type']?.[opt] ?? ''] ?? opt, displayCurrency)
              }
            />
          </div>
          {errors.tipFundatieBeci && <span className="text-xs text-orange-400">{errors.tipFundatieBeci}</span>}
        </label>

        <label className="flex items-center gap-2 mt-1" data-field="pilons">
          <input
            type="checkbox"
            className="sun-checkbox"
            checked={pilons}
            onChange={(e) => setForm(prev => ({ ...prev, pilons: e.target.checked }))}
          />
          <span className="text-sm font-medium text-sun/90">Pfahlgründung erforderlich</span>
          {errors.pilons && <span className="ml-2 text-xs text-orange-400">{errors.pilons}</span>}
        </label>

        <div className="space-y-2 pt-2 border-t border-[#e3c7ab22]">
          {errors.listaEtaje && <span className="text-xs text-orange-400">{errors.listaEtaje}</span>}
          {errors.aufstockungFloorKinds && <span className="text-xs text-orange-400">{errors.aufstockungFloorKinds}</span>}
          {listaEtaje.length === 0 && <p className="text-sand/60 text-sm">Keine Elemente hinzugefügt</p>}
          {listaEtaje.map((etaj: string, idx: number) => (
            <div key={idx} className="flex flex-col gap-2 p-2 bg-panel/50 rounded-lg border border-white/10">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <SelectSun
                    value={etaj}
                    onChange={(v) => {
                      const newLista = [...listaEtaje]
                      if (v === 'pod' || v.startsWith('mansarda')) {
                        newLista[idx] = v
                        const cutLista = newLista.slice(0, idx + 1)
                        setForm(prev => ({
                          ...prev,
                          listaEtaje: cutLista,
                          ...(isAufstockungFlow
                            ? { aufstockungFloorKinds: normalizeAufstockungFloorKinds(Array.isArray(prev.aufstockungFloorKinds) ? prev.aufstockungFloorKinds : [], cutLista) }
                            : {}),
                        }))
                      } else {
                        newLista[idx] = v
                        setForm(prev => ({
                          ...prev,
                          listaEtaje: newLista,
                          ...(isAufstockungFlow
                            ? { aufstockungFloorKinds: normalizeAufstockungFloorKinds(Array.isArray(prev.aufstockungFloorKinds) ? prev.aufstockungFloorKinds : [], newLista) }
                            : {}),
                        }))
                      }
                    }}
                    options={['intermediar', 'pod', 'mansarda_ohne', 'mansarda_mit']}
                    displayFor={(opt: string) => {
                      if (opt === 'intermediar') return 'Obergeschoss (Wohnfläche)'
                      if (opt === 'pod') return 'Dachboden (Keine Wohnfläche)'
                      if (opt === 'mansarda_ohne') return 'Dachgeschoss ohne Kniestock (Wohnfläche)'
                      if (opt === 'mansarda_mit') return 'Dachgeschoss mit Kniestock (Wohnfläche)'
                      return opt
                    }}
                    placeholder="Wählen Sie eine Option"
                  />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setForm(prev => {
                      const nextLista = listaEtaje.filter((_: any, i: number) => i !== idx)
                      return {
                        ...prev,
                        listaEtaje: nextLista,
                        ...(isAufstockungFlow
                          ? { aufstockungFloorKinds: normalizeAufstockungFloorKinds(Array.isArray(prev.aufstockungFloorKinds) ? prev.aufstockungFloorKinds : [], nextLista) }
                          : {}),
                      }
                    })
                  }
                  className="px-2 py-1 text-orange-400 hover:text-orange-300 text-sm font-bold"
                >
                  ×
                </button>
              </div>
              {isAufstockungFlow && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="sun-checkbox"
                    checked={String(aufstockungFloorKinds[idx] ?? '').toLowerCase() !== 'new'}
                    onChange={(e) => {
                      setForm((prev: Record<string, any>) => {
                        const current = normalizeAufstockungFloorKinds(Array.isArray(prev.aufstockungFloorKinds) ? prev.aufstockungFloorKinds : [])
                        current[idx] = e.target.checked ? 'existing' : 'new'
                        return { ...prev, aufstockungFloorKinds: current }
                      })
                    }}
                  />
                  <span className="text-xs text-sand/90">Bereits bestehendes Geschoss</span>
                </label>
              )}
              {etaj === 'mansarda_mit' && (
                <label className="flex flex-col gap-1">
                  <span className="wiz-label text-sun/90 text-xs">Kniestock (cm)</span>
                  <input
                    type="number"
                    className="sun-input"
                    min={0}
                    max={300}
                    step={1}
                    value={form[`inaltimePeretiMansarda_${idx}`] ?? ''}
                    onChange={(e) => setForm(prev => ({ ...prev, [`inaltimePeretiMansarda_${idx}`]: parseFloat(e.target.value) || 0 }))}
                    placeholder="z.B. 150"
                  />
                </label>
              )}
            </div>
          ))}
          {canAddFloors && (
            <>
              <button
                ref={addFloorBtnRef}
                type="button"
                onClick={() => setShowAddFloorDropdown(!showAddFloorDropdown)}
                className="px-3 py-1.5 bg-gradient-to-b from-[#CC9900] to-[#E5B800] hover:brightness-110 text-white rounded-lg text-sm font-medium transition-all"
              >
                + Neues Geschoss
              </button>
              {showAddFloorDropdown && typeof window !== 'undefined' && createPortal(
                <div
                  className="sun-menu themed-scroll"
                  role="listbox"
                  style={{ position: 'fixed', left: addFloorPos.left, top: addFloorPos.top, width: Math.max(addFloorPos.width, 350), zIndex: 9999 }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {FLOOR_TYPE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      className="sun-menu-item"
                      onClick={() => handleAddFloor(opt.value)}
                    >
                      <span className="whitespace-normal text-left">{opt.label}</span>
                    </button>
                  ))}
                </div>,
                document.body
              )}
            </>
          )}
        </div>

        {hasFloorAboveGround && (
          <label className="flex flex-col gap-1" data-field="treppeTyp">
            <span className="wiz-label text-sun/90">
              {adaptCurrencyCopy('Treppentyp (Preis pro Stück)', displayCurrency)}
            </span>
            <div className={errors.treppeTyp ? 'ring-2 ring-orange-400/60 rounded-lg' : ''}>
              <SelectSun
                value={String(form.treppeTyp || (stairOptsEffective[0] ?? STAIR_TYPE_OPTIONS[0]))}
                onChange={(v) => setForm(prev => ({ ...prev, treppeTyp: v }))}
                options={stairOptsEffective}
                placeholder="Wählen Sie eine Option"
                displayFor={(opt) => {
                  const key = optionValueToPriceKey['stairs_type']?.[opt]
                  const raw = key ? (paramLabelOverrides[key] ?? opt) : opt
                  return adaptCurrencyCopy(raw, displayCurrency)
                }}
              />
            </div>
            {errors.treppeTyp && <span className="text-xs text-orange-400">{errors.treppeTyp}</span>}
          </label>
        )}

        <div className="space-y-2 pt-3 mt-3 border-t border-[#e3c7ab22]">
          <label className="flex items-center gap-2 cursor-pointer select-none" htmlFor="struct-has-wintergarden" data-field="hasWintergarden">
            <input
              id="struct-has-wintergarden"
              type="checkbox"
              className="sun-checkbox cursor-pointer"
              checked={form.hasWintergarden === true}
              onChange={(e) => setForm((prev: Record<string, any>) => ({ ...prev, hasWintergarden: e.target.checked }))}
            />
            <span className="text-sm font-medium text-sun/90">Wintergarten vorhanden</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none" htmlFor="struct-has-balkone" data-field="hasBalkone">
            <input
              id="struct-has-balkone"
              type="checkbox"
              className="sun-checkbox cursor-pointer"
              checked={form.hasBalkone === true}
              onChange={(e) => setForm((prev: Record<string, any>) => ({ ...prev, hasBalkone: e.target.checked }))}
            />
            <span className="text-sm font-medium text-sun/90">Balkone vorhanden</span>
          </label>
        </div>
        </div>
      </div>
    </div>
    </div>
  )
}

function DynamicFields({
  stepKey, fields, form, setForm, onUpload, ensureOffer, errors, onEnter, customOptionsForm = {},
  paramLabelOverrides = {}, optionValueToPriceKey = {}, hiddenKeysForm = new Set<string>(), preisdatenbankOptionsByTag = {},
  displayCurrency = 'EUR',
}: {
  stepKey: string
  fields: Field[]
  form: Record<string, any>
  setForm: (v: Record<string, any> | ((prev: Record<string, any>) => Record<string, any>)) => void
  onUpload: (name: string, file: File | null) => void
  ensureOffer: () => Promise<string>
  errors: Errors
  onEnter: () => void
  customOptionsForm?: Record<string, Array<{ label: string; value: string; price_key?: string }>>
  paramLabelOverrides?: Record<string, string>
  optionValueToPriceKey?: Record<string, Record<string, string>>
  hiddenKeysForm?: Set<string>
  preisdatenbankOptionsByTag?: Record<string, string[]>
  displayCurrency?: DisplayCurrency
}) {
  const fmt = (s: string) => adaptCurrencyCopy(s, displayCurrency)

  let currentFields = fields;
  if (stepKey === 'upload') {
      currentFields = fields.filter(f => f.name === 'planArhitectural' || f.name === 'planArhitectura');
      if (currentFields.length === 0 && fields.length > 0) {
          currentFields = [fields[0]];
      }
  }

  return (
    <div className="grid grid-cols-1 gap-3">
      {currentFields.map(f => {
        if (stepKey === 'structuraCladirii' && f.name === 'treppeTyp') {
          const listaEtaje = Array.isArray(form.listaEtaje) ? form.listaEtaje : []
          const hasFloorAboveGround = listaEtaje.some((e: string) => e !== 'parter')
          if (!hasFloorAboveGround) return null
        }
        if (stepKey === 'daemmungDachdeckung' && f.name === 'dachfensterTyp' && !asBool(form.dachfensterImDach)) {
          return null
        }
        if (stepKey === 'ferestreUsi' && f.name === 'garageDoorType' && !asBool(form.garagentorGewuenscht)) {
          return null
        }
        if (f.type === 'upload') {
             return (
                 <SimpleUploadField 
                    key={f.name} 
                    stepKey={stepKey} 
                    field={f as Extract<Field, { type: 'upload' }>}
                    files={form[f.name] || []}
                    onChange={(newFiles) => setForm(prev => ({ ...prev, [f.name]: newFiles }))}
                    displayCurrency={displayCurrency}
                 />
             )
        }

        if (f.type === 'select') {
          const hasErr = !!errors[f.name]
          const displayLabel = fmt(tFieldLabel(stepKey, f.name, f.label))
          const displayPlaceholder = fmt(
            tPlaceholder(stepKey, f.name, ('placeholder' in f && (f as any).placeholder) ? (f as any).placeholder : undefined) ?? '',
          )
          const rawVal = form[f.name]
          const selectValue = (rawVal != null && typeof rawVal === 'object' && 'value' in rawVal) ? String((rawVal as any).value) : (rawVal != null ? String(rawVal) : '')

          // Kamin/Ofen: afișare cu prețuri (ca pe VPS)
          const isFireplaceField = f.name === 'tipSemineu'
          const fireplaceLabels: Record<string, string> = {
            'Kein Kamin': 'Kein Kamin',
            'Klassischer Holzofen': 'Klassischer Holzofen – ca. 8.500 €',
            'Moderner Design-Kaminofen': 'Moderner Design-Kaminofen – ca. 12.000 €',
            'Pelletofen (automatisch)': 'Pelletofen (automatisch) – ca. 11.000 €',
            'Einbaukamin': 'Einbaukamin – ca. 14.000 €',
            'Kachel-/wassergeführter Kamin': 'Kachel-/wassergeführter Kamin – ca. 18.000 €',
          }

          return (
            <label key={f.name} className="flex flex-col gap-1" data-field={f.name}>
              <span className="wiz-label text-sun/90">{displayLabel}</span>
              <div className={hasErr ? 'ring-2 ring-orange-400/60 rounded-lg' : ''}>
                <SelectSun
                  value={selectValue}
                  onChange={(v) => {
                    ensureOffer().catch(() => {})
                    setForm(prev => ({ ...prev, [f.name]: v }))
                  }}
                  options={
                    (() => {
                      const tag = (f as any).tag || FIELD_TAG_FALLBACK_BY_NAME[f.name]
                      const fromPreisdatenbank = tag && preisdatenbankOptionsByTag[tag]
                      const schemaOptions = (((f as any).options ?? []) as string[]).filter((o) => o != null && String(o).trim() !== '')
                      return mergeSelectOptions({
                        tag,
                        schemaOptions,
                        preisdatenbankOptions: fromPreisdatenbank || [],
                        customOptions: customOptionsForm[tag] || [],
                        hiddenKeys: hiddenKeysForm,
                        optionValueToPriceKey,
                      })
                    })()
                  }
                  placeholder={(displayPlaceholder || DE.common.selectPlaceholder) as string}
                  displayFor={(opt) => {
                    const val = typeof opt === 'string' ? opt : optValue(opt)
                    const tag = (f as any).tag || FIELD_TAG_FALLBACK_BY_NAME[f.name]
                    const priceKey = tag && optionValueToPriceKey[tag]?.[val]
                    const override = priceKey && paramLabelOverrides[priceKey]
                    if (override) return fmt(override)
                    if (isFireplaceField && fireplaceLabels[val]) return fmt(fireplaceLabels[val])
                    const objLabel = typeof opt === 'object' && opt !== null && (opt as any).label != null && (opt as any).label !== '' ? String((opt as any).label) : null
                    return fmt(objLabel ?? tOption(stepKey, f.name, val))
                  }}
                />
              </div>
              {hasErr && <span className="text-xs text-orange-400">{errors[f.name]}</span>}
              {isFireplaceField && form[f.name] && form[f.name] !== 'Kein Kamin' && (
                <span className="text-xs text-sand/70 mt-1">
                  {fmt(
                    '*Schornstein wird dazugerechnet mit Anzahl der Stockwerke (4.500 € Standardpreis + 1.500 € pro Geschoss)',
                  )}
                </span>
              )}
            </label>
          )
        }

        if (f.type === 'bool') {
          const displayLabel = fmt(tFieldLabel(stepKey, f.name, f.label))
          return (
            <label key={f.name} className="flex items-center gap-2 mt-1" data-field={f.name}>
              <input
                type="checkbox"
                className="sun-checkbox"
                checked={asBool(form[f.name])}
                onChange={(e) => {
                  const checked = e.target.checked
                  ensureOffer().catch(() => {})
                  setForm(prev => {
                    const next: Record<string, any> = { ...prev, [f.name]: checked }
                    if (f.name === 'dachfensterImDach') {
                      if (!checked) next.dachfensterTyp = ''
                      else if (!prev.dachfensterTyp) next.dachfensterTyp = 'Standard'
                    }
                    if (f.name === 'garagentorGewuenscht') {
                      if (!checked) next.garageDoorType = ''
                      else if (!prev.garageDoorType) next.garageDoorType = 'Sektionaltor Standard'
                    }
                    return next
                  })
                }}
                onKeyDown={(e) => handleInputEnter(e, onEnter)}
              />
              <span className="text-sm font-medium">{displayLabel}</span>
              {errors[f.name] && <span className="ml-2 text-xs text-orange-400">{errors[f.name]}</span>}
            </label>
          )
        }

        const displayLabel = fmt(tFieldLabel(stepKey, f.name, f.label))
        const displayPlaceholder = fmt(
          tPlaceholder(stepKey, f.name, ('placeholder' in f && (f as any).placeholder) ? (f as any).placeholder : undefined) ?? '',
        )

        const rawFieldVal = form[f.name]
        const inputValue = (typeof rawFieldVal === 'string' || typeof rawFieldVal === 'number') ? String(rawFieldVal) : ''
        const common: any = {
          className: `sun-input ${errors[f.name] ? 'ring-2 ring-orange-400/60 focus:ring-orange-400/60' : ''}`,
          value: inputValue,
          placeholder: displayPlaceholder,
          onChange: (e: any) => {
            const raw = e.target.value
            const val = f.type === 'number' ? (raw === '' ? '' : Number(raw)) : raw
            setForm(prev => ({ ...prev, [f.name]: val }))
          },
          onKeyDown: (e: React.KeyboardEvent) => handleInputEnter(e, onEnter)
        }

        return (
          <label key={f.name} className="flex flex-col gap-1" data-field={f.name}>
            <span className="wiz-label text-sun/90">{displayLabel}</span>
            {f.type === 'textarea'
              ? <textarea {...common} className={`sun-textarea ${errors[f.name] ? 'ring-2 ring-orange-400/60 focus:ring-orange-400/60' : ''}`} />
              : <input
                  type={f.type === 'number' ? 'number' : 'text'}
                  {...common}
                  {...(f.type === 'number' && 'min' in f && f.min != null ? { min: f.min } : {})}
                  {...(f.type === 'number' && 'max' in f && f.max != null ? { max: f.max } : {})}
                />}
            {errors[f.name] && <span className="text-xs text-orange-400">{errors[f.name]}</span>}
          </label>
        )
      })}
    </div>
  )
}

function SimpleUploadField({
  stepKey,
  field,
  files,
  onChange,
  displayCurrency = 'EUR',
}: {
  stepKey: string
  field: Extract<Field, { type: 'upload' }>
  files: File[]
  onChange: (f: File[]) => void
  displayCurrency?: DisplayCurrency
}) {
  const displayLabel = adaptCurrencyCopy(tFieldLabel(stepKey, field.name, field.label), displayCurrency)
  const [isDragging, setIsDragging] = useState(false) // Stare pentru efect vizual

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
          const newFiles = Array.from(e.target.files)
          onChange(field.multiple ? [...files, ...newFiles] : newFiles)
      }
  }

  // --- HANDLERS PENTRU DRAG & DROP ---
  const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          const newFiles = Array.from(e.dataTransfer.files)
          // Validare tip fișier (opțional, dar recomandat)
          // Aici acceptăm orice, dar poți filtra după field.accept dacă vrei
          onChange(field.multiple ? [...files, ...newFiles] : newFiles)
          
          // Resetăm input-ul fișierului pentru a permite re-selectarea aceluiași fișier dacă e nevoie
          // (Deși la Drag&Drop nu e strict necesar, e bună practică)
      }
  }
  // -------------------------------------

  const removeFile = (idx: number) => {
      const next = files.filter((_, i) => i !== idx)
      onChange(next)
  }

  return (
    <div className="border border-black/30 rounded-xl2 p-3 bg-black/10">
      <div className="text-sm font-semibold text-sun mb-2">
        {displayLabel} {(field as any).optional && <span className="opacity-70 font-normal">(freiwillig)</span>}
      </div>
      
      <div className="flex flex-col gap-4">
          {/* Lista de fișiere selectate */}
          {files.map((f, i) => (
              <div key={i} className="flex items-center justify-between bg-coffee-800/40 px-2 py-1 rounded text-sm text-sand/90 border border-white/5">
                  <span className="truncate max-w-[200px]">{f.name}</span>
                  <button type="button" onClick={() => removeFile(i)} className="text-orange-400 hover:text-orange-300 px-2 font-bold">×</button>
              </div>
          ))}

          {/* Zona de Upload + Drag & Drop */}
          <label 
            className={`group cursor-pointer relative flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-xl transition-all duration-300
              ${isDragging ? 'border-sun bg-sun/10 scale-[1.02]' : 'border-sun/30 hover:bg-sun/5 hover:border-sun/50'}
            `}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
                type="file"
                accept={field.accept}
                multiple={field.multiple}
                className="absolute inset-0 opacity-0 cursor-pointer z-10"
                onChange={handleFileChange}
            />
            
            {/* Imaginea de upload */}
            <img 
                src="/file-upload.png" 
                alt="Upload" 
                className={`h-16 w-16 object-contain transition-all duration-300
                  ${isDragging ? 'scale-110 opacity-100' : 'opacity-80 group-hover:opacity-100 group-hover:scale-110'}
                `}
            />
            
            <span className={`mt-3 text-sm font-medium transition-colors ${isDragging ? 'text-sun' : 'text-sun/70 group-hover:text-sun'}`}>
                {isDragging ? 'Datei hier ablegen!' : (files.length > 0 ? '+ Weitere Dateien hinzufügen' : 'Datei hier ablegen oder klicken')}
            </span>
          </label>
      </div>
    </div>
  )
}

const handleInputEnter = (e: React.KeyboardEvent, onNextStep: () => void) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    const target = e.currentTarget as HTMLElement
    const container = target.closest('.wizard-body')
    if (!container) return

    // Select all interactive form elements we consider "steps"
    // Including button.sun-select to allow jumping TO it
    const selector = 'input:not([type="hidden"]):not([type="checkbox"]):not([disabled]), textarea:not([disabled]), button.sun-select'
    const elements = Array.from(container.querySelectorAll(selector)) as HTMLElement[]
    
    const currentIndex = elements.indexOf(target)
    
    if (currentIndex !== -1 && currentIndex < elements.length - 1) {
      // Move to next
      elements[currentIndex + 1].focus()
    } else {
      // It's the last one, submit/next step
      onNextStep()
    }
  }
}