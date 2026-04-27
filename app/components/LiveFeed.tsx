
'use client'

import { JSX, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../lib/supabaseClient'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { Cpu, FunctionSquare, CheckCircle2, Loader2, Download } from 'lucide-react'
import { inferOfferFlow, resolveOfferFlowWithExplicit, type OfferFlow } from '../lib/offerFlow'

/* ========= CONFIGURARE ETAPE (Protocolul Nou) ========= */

const STAGE_TO_SEQUENCE: Record<string, number[]> = {
  segmentation_start: [1],
  segmentation: [2],
  classification: [3],
  floor_classification: [4],
  detections: [5],
  detections_review: [6], // editor verificare: input_resized + poligoane (nu afișăm alte detecții în LiveFeed)
  scale: [6],
  scale_flood: [6],
  count_objects: [7],
  exterior_doors: [8, 9],
  measure_objects: [10],
  perimeter: [11],
  area: [12],
  roof: [13],
  pricing: [14, 15],
  offer_generation: [16, 17],
  pdf_generation: [18, 19],
  computation_complete: [],
}

/** Fallback sequence index for unknown stages so they still appear in history (e.g. backend adds new stage) */
const UNKNOWN_STAGE_SEQUENCE = [0]
function getStageSequence(stage: string): number[] {
  return STAGE_TO_SEQUENCE[stage] ?? UNKNOWN_STAGE_SEQUENCE
}

// Calculează progresul bazat pe etapele procesate (fallback când motorul nu trimite încă UI:PROGRESS)
const TOTAL_STAGES_NEUBAU = 19
const TOTAL_STAGES_DACHSTUHL = 17

function getStageTitlesForFlow(flow: OfferFlow, stage: string): string[] {
  if (flow === 'dachstuhl' && STAGE_TITLES_DACHSTUHL[stage]) return STAGE_TITLES_DACHSTUHL[stage]
  const t = STAGE_TITLES[stage]
  return t && t.length > 0 ? t : [stage]
}

function calculateProgress(
  processedStages: Set<string>,
  currentStage: string | null,
  flow: OfferFlow,
): { progress: number; currentStageName: string | null } {
  const totalStages = flow === 'dachstuhl' ? TOTAL_STAGES_DACHSTUHL : TOTAL_STAGES_NEUBAU

  if (processedStages.size === 0 && !currentStage) {
    return { progress: 0, currentStageName: null }
  }

  let completedSteps = 0
  for (const stage of processedStages) {
    const seq = STAGE_TO_SEQUENCE[stage]
    if (seq && seq.length > 0 && seq[0] > 0) {
      completedSteps = Math.max(completedSteps, Math.max(...seq))
    }
  }

  if (currentStage) {
    const seq = STAGE_TO_SEQUENCE[currentStage]
    if (seq && seq.length > 0 && seq[0] > 0) {
      const currentStep = Math.max(...seq)
      if (currentStep > completedSteps) {
        completedSteps = currentStep - 0.5
      }
    }
  }

  const progress = Math.min(100, Math.round((completedSteps / totalStages) * 100))

  let stageName: string | null = null
  if (currentStage) {
    const titles = getStageTitlesForFlow(flow, currentStage)
    stageName = titles[0] ?? currentStage
  }

  return { progress, currentStageName: stageName }
}

const STAGES_WITH_IMAGES = [
  'segmentation',        
  'classification', 
  'scale',  // ✅ Adăugat pentru a afișa walls_3d.png
  'scale_flood',
  'count_objects', 
  'exterior_doors',
  'area',
  'roof'  // house_3d.png, house_3d_pyramid.png, house_3d_shed.png
]

/* ========= TITLURI DINAMICE ========= */
const STAGE_TITLES: Record<string, string[]> = {
  segmentation_start: [
    'Initialisierung der Plananalyse',
    'Vorbereitung der Segmentierung',
    'Start der Bildverarbeitung'
  ],
  segmentation: [
    'Plansegmentierung und Normalisierung',
    'Strukturanalyse und Topologie',
    'Vektorisierung der Grundrisse'
  ],
  classification: [
    'Klassifizierung der Planansichten',
    'Identifikation der Zeichnungstypen',
    'Sortierung nach Grundriss/Schnitt'
  ],
  floor_classification: [
    'Geschosszuordnung und Höhenprüfung',
    'Ebenen-Identifikation',
    'Zuordnung der Stockwerke'
  ],
  detections: [
    'Objekterkennung',
    'Detektion von Bauelementen',
    'Scannen nach Fenstern und Türen'
  ],
  scale: [
    'Maßstabsberechnung und Kalibrierung',
    'Pixel-zu-Meter Konversion',
    'Referenzmessung und Skalierung'
  ],
  detections_review: [
    'Erkennung prüfen',
    'Blueprint-Editor',
    'Detektionen bestätigen'
  ],
  scale_flood: [
    'Flood-Fill (Innen/Außen) – Strukturprüfung',
    'Segmentierung der Außenhülle',
    'Validierung der Wandkontakte'
  ],
  count_objects: [
    'Inventarisierung der Öffnungen',
    'OCR-Erkennung und Deduplizierung',
    'Klassifizierung der Objekte'
  ],
  exterior_doors: [
    'Gebäudehülle und Außenwände',
    'Perimeter und Fassadenflächen',
    'Abgrenzung Innen-/Außenwände'
  ],
  measure_objects: [
    'Vermessung der Öffnungen',
    'Bemaßung der Bauteile',
    'Geometrische Auswertung'
  ],
  perimeter: [
    'Struktureller Abgleich',
    'Wandmessung und Pfadintegral',
    'Vorläufige Strukturkalkulation'
  ],
  area: [
    'Flächenberechnung (Wohn/Nutz)',
    'Konsolidierung der Flächen',
    'Raumflächenbilanz'
  ],
  roof: [
    'Dachkalkulation und Neigung',
    'Parametrisierung des Daches',
    'Projektion und effektive Fläche'
  ],
  pricing: [
    'Preiskalkulation und Marktwerte',
    'Anwendung regionaler Indizes',
    'Kostenschätzung nach Gewerken'
  ],
  offer_generation: [
    'Zusammenstellung des Angebots',
    'Strukturierung der Kostenpositionen',
    'Finalisierung der Kalkulation'
  ],
  pdf_generation: [
    'Generierung des PDF-Dokuments',
    'Layout und Formatierung',
    'Erstellung der Druckversion'
  ],
  computation_complete: [
    'Verarbeitung abgeschlossen',
    'Fertiggestellt',
    'Berechnung beendet'
  ],
  cubicasa_step: [
    'RasterScan-Detail',
    'CubiCasa Verarbeitungsschritt',
    'Zwischenschritt RasterScan'
  ]
}

/** Titluri pentru flux Dachstuhl (roof-only): același protocol de etape, alt focus în feed */
const STAGE_TITLES_DACHSTUHL: Partial<Record<string, string[]>> = {
  segmentation_start: [
    'Dachstuhl-Plan – Analysestart',
    'Vorbereitung Schnitte und Grundrisse',
    'Eingabe prüfen',
  ],
  segmentation: [
    'Planaufbereitung für Dachstuhl',
    'Geometrie und Konturen',
    'Vektorisierung der relevanten Bereiche',
  ],
  classification: [
    'Ansichten und Schnitte zuordnen',
    'Planarten erkennen',
    'Dachrelevante Blätter markieren',
  ],
  floor_classification: [
    'Geschosse / Dachkörper zuordnen',
    'Ebenen für Dachmodell',
    'Referenzgeschosse',
  ],
  detections_review: [
    'Planlage prüfen (Dachstuhl)',
    'Blueprint-Editor',
    'Freigabe für Holztragwerk',
  ],
  scale: [
    'Maßstab für Dachstuhl',
    'Kalibrierung Pixel/Meter',
    'Referenzlängen',
  ],
  roof: [
    'Dachstuhl-Geometrie und Neigung',
    'Hauptkalkulation Dach',
    'Flächen und Sparrenlogik',
  ],
  pricing: [
    'Dachstuhl-Preisbildung',
    'Positionen und Zuschläge',
    'Kostenermittlung',
  ],
  offer_generation: [
    'Angebot Dachstuhl zusammenstellen',
    'Positionen finalisieren',
    'Kalkulation prüfen',
  ],
  pdf_generation: [
    'PDF Dachstuhl erzeugen',
    'Dokumentlayout',
    'Druckversion',
  ],
  computation_complete: [
    'Dachstuhl-Berechnung fertig',
    'Abgeschlossen',
    'Bereit zum Download',
  ],
}

/* ========= TIMING ========= */
const SAFE_GAP_BETWEEN_ITEMS_MS = 0
const EXTRA_MARGIN_AFTER_IMAGE_MS = 500

/* ========= UTILS & COMPONENTS ========= */
type FeedFile = {
  url: string
  mime?: string
  caption?: string
  path?: string
  name?: string
  storage_path?: string
  storagePath?: string
}
type TextItem = { kind: 'text'; stage: string; role: 'ai'|'formula'|'rezultat'; text: string; __id: string }
type SpinnerItem = { kind: 'spinner'; stage: string; __id: string }
type ImageItem = { kind: 'image'; stage: string; files: FeedFile[]; __id: string }
type BreakItem = { kind: 'break'; stage: string; __id: string }
type CongratsItem = {
  kind: 'congrats'
  stage: 'final'
  pdfUrl: string
  offerId: string
  adminPdfUrl?: string | null
  canDownloadAdminPdf?: boolean
  roofMeasurementsPdfUrl?: string | null
  /** Nur Maß-/Mengen-PDF (kein Angebots-PDF). */
  measurementsOnlyOffer?: boolean
  __id: string
}
type SyntheticItem = TextItem | SpinnerItem | ImageItem | BreakItem | CongratsItem
type Group = { id: string; stage: string; startedAt: string; title: string; items: SyntheticItem[]; instant?: boolean }
type Row = { kind: 'group'; id: string; group: Group } | { kind: 'gap'; id: string }

const isImage = (f: FeedFile) => (f.mime?.startsWith('image/') ?? true) || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(f.url)
const isPdf = (f: FeedFile) => f.mime?.includes('pdf') || /\.pdf(\?|$)/i.test(f.url)
const isDisplayable = (f: FeedFile) => isImage(f)

const shouldHideScaleWalls3dFromFeed = (stage: string, f: FeedFile): boolean => {
  if (stage !== 'scale') return false
  const raw = [f.url, f.path, f.name, f.caption, f.storage_path, f.storagePath]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return raw.includes('04_walls_3d.png')
}

const generateId = (prefix: string = '') => 
  `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`

const safeString = (val: any): string => {
  if (typeof val === 'string') return val
  if (typeof val === 'number') return String(val)
  if (!val) return ''
  try { return JSON.stringify(val) } catch { return '...' }
}

const strip = (s: string) => {
  return safeString(s)
    .replace(/^\s*\[[^\]]+\]\s*/, '') 
    .replace(/^\s*(AI|FORMULĂ|FORMULA|REZULTAT|RESULTAT)[:\s]*\s*/i, '') 
}

type Trio = { ai: string; formula: string; rezultat: string }

/* ========= FORMULE MATEMATICE COMPLEXE (HARDCODATE, PUR LaTeX) ========= */
const MESSAGES: Record<number, Trio> = {
  1: { 
    ai:'Ich validiere die Datei und erkenne den Maßstab aus Bemaßungen/Legenden; Konsistenz- und Einheitenprüfung.',
    formula:'s^* = \\underset{s \\in \\mathbb{R}^+}{\\arg\\min} \\sum_{k=1}^{N} \\left| d_k^{\\mathrm{meas}} \\cdot s - d_k^{\\mathrm{ref}} \\right|^2 + \\lambda \\|s - s_0\\|^2',
    rezultat:'Maßstab bestätigt und Arbeitstoleranz bestimmt.' 
  },
  2: { 
    ai:'Ich segmentiere den Plan (Wände/Texte/Symbole), normalisiere die Ausrichtung und stelle die Topologie wieder her.',
    formula:'\\mathbf{x}^\\prime = \\mathbf{R}(\\theta) \\mathbf{x} + \\mathbf{t}, \\quad \\mathbf{R}(\\theta) = \\begin{pmatrix} \\cos\\theta & -\\sin\\theta \\\\ \\sin\\theta & \\cos\\theta \\end{pmatrix}',
    rezultat:'Kohärente Vektorebenen, bereit zur Vermessung.' 
  },
  3: { 
    ai:'Ich klassifiziere die extrahierten Pläne nach Typ (Grundriss/Ansicht/Text).',
    formula:'P(c | \\mathbf{I}) = \\frac{\\exp\\left(\\sum_{i=1}^{M} w_i \\phi_i(\\mathbf{I}, c)\\right)}{\\sum_{c^\\prime} \\exp\\left(\\sum_{i=1}^{M} w_i \\phi_i(\\mathbf{I}, c^\\prime)\\right)}',
    rezultat:'Grundrisse identifiziert und kategorisiert.' 
  },
  4: { 
    ai:'Ich ordne die Geschosse zu (EG/OG) anhand von Merkmalen.',
    formula:'\\ell(y) = \\underset{k \\in \\{1,\\ldots,K\\}}{\\arg\\max} \\left\\langle \\mathbf{w}_k, \\Phi(\\mathbf{F}) \\right\\rangle + b_k',
    rezultat:'Geschosse erkannt und zugeordnet.' 
  },
  5: { 
    ai:'Ich suche nach Bauelementen - Fenster, Türen, Wände.',
    formula:'\\mathrm{IoU}(B_i, B_j) = \\frac{|B_i \\cap B_j|}{|B_i \\cup B_j|} > \\tau, \\quad c_i > \\gamma',
    rezultat:'Elemente lokalisiert und klassifiziert.' 
  },
  6: { 
    ai:'Kalibrierung Meter/Pixel aus repräsentativen Maßen.',
    formula:'s = \\frac{1}{N} \\sum_{i=1}^{N} \\frac{d_i^{\\mathrm{real}}}{d_i^{\\mathrm{px}}}, \\quad \\sigma_s = \\sqrt{\\frac{1}{N-1} \\sum_{i=1}^{N} \\left(s_i - s\\right)^2}',
    rezultat:'Maßstab bestätigt und validiert.' 
  },
  7: { 
    ai:'Ich inventarisiere Fenster und Türen.',
    formula:'N_{\\mathrm{obj}} = \\sum_{i=1}^{M} \\mathbb{1}_{\\{c_i > \\theta\\}}(o_i), \\quad A_{\\mathrm{tot}} = \\sum_{i=1}^{N_{\\mathrm{obj}}} w_i \\cdot h_i \\cdot s^2',
    rezultat:'Objekte gezählt und vermessen.' 
  },
  8: { 
    ai:'Ich analysiere die Außenhülle mit Flood-Fill-Algorithmus.',
    formula:'\\mathcal{M}_{\\mathrm{ext}} = \\bigcup_{p \\in S} \\left\\{ q \\in \\Omega : \\exists \\gamma_{p \\to q}, \\, I(\\gamma) < \\tau_{\\mathrm{wall}} \\right\\}',
    rezultat:'Außenwände markiert und berechnet.' 
  },
  9: { 
    ai:'Ich berechne den Perimeter der Außenwände.',
    formula:'P = \\oint_{\\partial \\mathcal{M}_{\\mathrm{ext}}} ds = \\sum_{i=1}^{N_{\\mathrm{seg}}} \\sqrt{(x_{i+1} - x_i)^2 + (y_{i+1} - y_i)^2}',
    rezultat:'Umfang berechnet und validiert.' 
  },
  10: { 
    ai:'Ich vermesse die Objekte (Breite aus Bounding Boxes).',
    formula:'w_i = (x_{\\mathrm{max}}^{(i)} - x_{\\mathrm{min}}^{(i)}) \\cdot s, \\quad h_i = (y_{\\mathrm{max}}^{(i)} - y_{\\mathrm{min}}^{(i)}) \\cdot s',
    rezultat:'Maße extrahiert für alle Objekte.' 
  },
  11: { 
    ai:'Ich berechne die Wandlängen mit Pfadintegral.',
    formula:'L_{\\mathrm{wall}} = \\int_{\\gamma} \\|\\nabla \\psi(\\mathbf{r})\\| \\, d\\mathbf{r}, \\quad L_{\\mathrm{tot}} = \\sum_{j=1}^{N_{\\mathrm{walls}}} L_j',
    rezultat:'Wände vermessen und summiert.' 
  },
  12: { 
    ai:'Ich kalkuliere alle Flächen (Wände, Böden, Decken).',
    formula:'A_{\\mathrm{poly}} = \\frac{1}{2} \\left| \\sum_{i=0}^{n-1} (x_i y_{i+1} - x_{i+1} y_i) \\right|, \\quad A_{\\mathrm{tot}} = \\sum_{k=1}^{K} A_k',
    rezultat:'Flächenbilanz erstellt und validiert.' 
  },
  13: { 
    ai:'Ich berechne das Dach (Neigung, Fläche, Materialien).',
    formula:'A_{\\mathrm{roof}} = \\frac{A_{\\mathrm{proj}}}{\\cos(\\alpha)} + \\Delta A_{\\mathrm{overhang}}, \\quad \\alpha = \\arctan\\left(\\frac{h_{\\mathrm{ridge}}}{w/2}\\right)',
    rezultat:'Dachpreis kalkuliert mit allen Parametern.' 
  },
  14: { 
    ai:'Ich erstelle die Kostenaufstellung für alle Materialien.',
    formula:'C_{\\mathrm{raw}} = \\sum_{i=1}^{n} Q_i \\cdot P_i + \\sum_{j=1}^{m} A_j \\cdot p_j + \\kappa_{\\mathrm{overhead}}',
    rezultat:'Rohbaukosten berechnet nach Kategorien.' 
  },
  15: { 
    ai:'Ich finalisiere das Angebot mit Gewinnmarge und Steuern.',
    formula:'C_{\\mathrm{final}} = C_{\\mathrm{raw}} \\cdot (1 + \\mu_{\\mathrm{margin}}) \\cdot (1 + \\tau_{\\mathrm{vat}}) + \\Delta C_{\\mathrm{logistics}}',
    rezultat:'Finales Angebot bereit zur Präsentation.' 
  },
  16: { 
    ai:'Ich strukturiere das finale Angebot nach Kategorien.',
    formula:'\\mathcal{O} = \\bigcup_{k=1}^{K} \\left\\{ (c_k, Q_k, P_k) : c_k \\in \\mathcal{C}_{\\mathrm{valid}} \\right\\}',
    rezultat:'Angebot strukturiert und kategorisiert.' 
  },
  17: { 
    ai:'Ich validiere alle Berechnungen und Konsistenz.',
    formula:'\\mathcal{V}(\\mathcal{O}) = \\bigwedge_{i=1}^{N} \\left( \\left| \\sum_{j \\in G_i} C_j - C_i^{\\mathrm{target}} \\right| < \\epsilon \\right)',
    rezultat:'Validierung erfolgreich - Daten korrekt.' 
  },
  18: { 
    ai:'PDF wird generiert mit Layout und Formatierung.',
    formula:'\\mathcal{D}_{\\mathrm{pdf}} = \\mathcal{G}\\left(\\mathcal{T}_{\\mathrm{template}}, \\mathcal{O}, \\{\\mathbf{I}_k\\}_{k=1}^{N}\\right)',
    rezultat:'PDF-Layout erstellt und formatiert.' 
  },
  19: { 
    ai:'PDF wird finalisiert mit allen Details und Signaturen.',
    formula:'\\mathcal{F}(\\mathcal{D}_{\\mathrm{pdf}}) \\xrightarrow{\\mathrm{sign}} \\mathcal{D}_{\\mathrm{final}}, \\quad \\mathrm{hash}(\\mathcal{D}_{\\mathrm{final}}) = H',
    rezultat:'Komplettes Dokument bereit zum Download.' 
  },
}

/** Fallback when stage has no MESSAGES entry (unknown stage or sequence [0]) so the feed always shows at least one line */
const FALLBACK_MESSAGE: Trio = {
  ai: 'Dieser Verarbeitungsschritt wurde ausgeführt.',
  formula: '—',
  rezultat: 'Schritt abgeschlossen.'
}

async function paraphrase(text: string) {
  try { 
    const res = await fetch('/api/paraphrase', {method:'POST', body:JSON.stringify({text})})
    if (!res.ok) return text
    const json = await res.json()
    return strip(json?.text || text)
  } catch { 
    return text 
  }
}

async function downloadPdfWithRefresh(
  offerId: string,
  currentUrl: string,
  kind: 'offer' | 'roofMeasurements' | 'admin' = 'offer',
  isAllowed?: () => boolean,
) {
  const allow = () => isAllowed == null || isAllowed()
  if (!allow()) return

  let urlToUse = currentUrl

  if (!currentUrl || currentUrl.startsWith('/') || !currentUrl.startsWith('http')) {
    try {
      const fresh = await apiFetch(`/offers/${offerId}/export-url`)
      if (!allow()) return
      const freshUrl =
        kind === 'roofMeasurements'
          ? fresh?.measurements_only_offer === true
            ? (fresh?.url || fresh?.download_url || fresh?.pdf)
            : (fresh?.roofMeasurementsPdf?.download_url || fresh?.roofMeasurementsPdf?.url)
          : kind === 'admin'
            ? (fresh?.adminPdf?.download_url || fresh?.adminPdf?.url)
            : (fresh?.url || fresh?.download_url || fresh?.pdf)
      if (freshUrl) urlToUse = freshUrl
    } catch {}
  }

  const tryBlobDownload = async (url: string) => {
    const res = await fetch(url, { method: 'GET', mode: 'cors', credentials: 'omit' })
    if (!res.ok) throw new Error('fetch-failed')
    const disp = res.headers.get('content-disposition') || ''
    const nameMatch = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disp)
    const defaultName =
      kind === 'roofMeasurements'
        ? 'mengenermittlung.pdf'
        : kind === 'admin'
          ? 'admin.pdf'
          : 'angebot.pdf'
    const filename = nameMatch ? decodeURIComponent(nameMatch[1]) : defaultName
    const blob = await res.blob()
    const objUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(objUrl)
  }

  const tryOpenAsLastResort = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  try {
    if (!allow()) return
    await tryBlobDownload(urlToUse)
    return
  } catch {
    try {
      const fresh = await apiFetch(`/offers/${offerId}/export-url`)
      if (!allow()) return
      const freshUrl =
        kind === 'roofMeasurements'
          ? fresh?.measurements_only_offer === true
            ? (fresh?.url || fresh?.download_url || fresh?.pdf)
            : (fresh?.roofMeasurementsPdf?.download_url || fresh?.roofMeasurementsPdf?.url)
          : kind === 'admin'
            ? (fresh?.adminPdf?.download_url || fresh?.adminPdf?.url)
            : (fresh?.url || fresh?.download_url || fresh?.pdf)
      if (freshUrl) {
        try {
          if (!allow()) return
          await tryBlobDownload(freshUrl)
          return
        } catch {
          if (!allow()) return
          tryOpenAsLastResort(freshUrl)
          return
        }
      }
    } catch {}

    if (!allow()) return
    tryOpenAsLastResort(urlToUse)
  }
}

function Spinner() { 
  return (
    <div className="py-2 flex justify-center">
      <Loader2 className="h-4 w-4 animate-spin text-neutral-400"/>
    </div>
  ) 
}

function FitFormula({ html }: { html: string }) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    const outer = outerRef.current, inner = innerRef.current
    if (!outer || !inner) return
    
    inner.style.transform = 'scale(1)'
    inner.style.transformOrigin = 'left top'
    
    const maxW = outer.clientWidth - 20
    const w = inner.scrollWidth
    
    if (w > maxW && maxW > 0) {
      const scale = Math.max(0.65, maxW / w)
      inner.style.transform = `scale(${scale})`
    }
  }, [html])
  
  return (
    <div ref={outerRef} className="w-full overflow-hidden">
      <div ref={innerRef} className="w-fit max-w-full">
        <div className="math-note rounded-lg px-3 py-2 border border-white/10">
          <div className="katex-block text-left break-words" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </div>
  )
}

function FormulaBlock({ input }: { input: string }) {
  const raw = (input ?? '').trim()
  let content: JSX.Element
  
  if (!raw || raw === '—' || raw === '-') {
    content = (
      <div className="math-note rounded-lg px-3 py-2 border border-white/10 bg-coffee-800/40">
        <div className="text-sm text-sand/85 font-mono">{raw || '—'}</div>
      </div>
    )
  } else {
    try {
      const html = katex.renderToString(raw, {
        displayMode: true,
        throwOnError: true,
        strict: false,
        trust: false,
        maxSize: 100
      })
      content = <FitFormula html={html} />
    } catch (e) {
      content = (
        <div className="math-note rounded-lg px-3 py-2 border border-white/10 bg-coffee-800/40">
          <div className="text-sm text-sand/85 font-mono break-words leading-relaxed whitespace-pre-wrap">
            {raw}
          </div>
        </div>
      )
    }
  }
  
  return <div className="my-2">{content}</div>
}

function TypeWriter({ text, speed = 16, instant = false }: { text: string; speed?: number; instant?: boolean }) {
  const [out, setOut] = useState('')
  const safeText = safeString(text || '')

  useEffect(() => {
    if (instant) {
      setOut(safeText)
      return
    }
    
    let i = 0, alive = true
    const tick = () => { 
      if(alive && i<=safeText.length){ 
        setOut(safeText.slice(0,i)); 
        i++; 
        setTimeout(tick, speed) 
      } 
    }
    tick()
    return () => { alive = false }
  }, [safeText, speed, instant])
  
  // Ensure we always return a valid React node, never undefined/null
  return <span>{out || ''}</span>
}

function MessageRow({ role, text, instant = false }: { role: string, text: string, instant?: boolean }) {
  const safeContent = safeString(text ?? '')
  // Formula: do not strip (preserve LaTeX); other roles: strip stage/prefix so display is clean
  const displayContent = role === 'formula' ? safeContent.trim() : strip(safeContent)
  
  if (!displayContent) {
    return null
  }
  
  return (
    <div className={`flex items-start gap-3 mb-2 ${instant ? '' : 'animate-fade-in'}`}>
      <div className="shrink-0 text-neutral-300 mt-1">
        {role==='ai' ? <Cpu size={18}/> : role==='formula' ? <FunctionSquare size={18}/> : <CheckCircle2 size={18}/>}
      </div>
      <div className="text-[16px] leading-relaxed text-neutral-100 min-w-0 flex-1">
        {role==='formula' ? <FormulaBlock input={displayContent} /> : <TypeWriter text={displayContent} instant={instant} />}
      </div>
    </div>
  )
}

function SmartImage({ file, instant = false }: { file: FeedFile, instant?: boolean }) {
  const [isPortrait, setIsPortrait] = useState(false)
  return (
    <img
      src={file.url}
      loading="lazy"
      decoding="async"
      onLoad={(e) => {
        const img = e.currentTarget
        setIsPortrait(img.naturalHeight > img.naturalWidth)
      }}
      className={`rounded-lg border border-white/10 shadow-lg hover:shadow-xl transition-shadow ${
        isPortrait ? 'w-[60%] ml-0' : 'w-full'
      } ${instant ? '' : 'animate-fade-in'}`}
      alt="result"
    />
  )
}

/* ========= MAIN COMPONENT ========= */
export default function LiveFeed() {
  const [rows, setRows] = useState<Row[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [offerId, setOfferId] = useState<string|null>(null)
  const offerIdRef = useRef<string | null>(null)
  const [runId, setRunId] = useState<string|null>(null)
  const [computing, setComputing] = useState(false)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [canDownloadAdminPdf, setCanDownloadAdminPdf] = useState(false)
  const [progress, setProgress] = useState(0) // 0-100
  const [currentStageName, setCurrentStageName] = useState<string | null>(null)
  const [offerFlow, setOfferFlow] = useState<OfferFlow>('einfamilienhaus')
  const [isMeasurementsOnlyOffer, setIsMeasurementsOnlyOffer] = useState(false)
  const flowModeRef = useRef<OfferFlow>('einfamilienhaus')

  const filesByStage = useRef<Record<string, FeedFile[]>>({})
  const processedStages = useRef<Set<string>>(new Set())
  const stageQueue = useRef<string[]>([])
  const processing = useRef(false)
  const sinceRef = useRef<number|undefined>(undefined)
  const seenEventIdsRef = useRef<Set<number>>(new Set())
  const currentStageRef = useRef<string|null>(null)
  /** Țintă progres: server (UI:PROGRESS) sau calculateProgress; afișarea e interpolată (fără salturi). */
  const targetProgressRef = useRef(0)
  const displayProgressRef = useRef(0)
  /** După primul eveniment [progress] din run, ținem bara sincronă cu motorul Python (monoton). */
  const serverDrivesProgressRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const titleIndexRef = useRef<Record<string, number>>({})
  
  const finalPdfUrlRef = useRef<string|null>(null)
  const isHistoryMode = useRef(false)
  const allStagesCompleted = useRef(false)

  const queuedStages = useRef<Set<string>>(new Set())
  const pendingCompletionRef = useRef<{
    offerId: string
    pdfUrl: string
    adminPdfUrl?: string | null
    canDownloadAdminPdf?: boolean
    roofMeasurementsPdfUrl?: string | null
    measurementsOnlyOffer?: boolean
  } | null>(null)
  /** In history mode: first event created_at per stage (for correct timestamps) */
  const stageStartedAtRef = useRef<Record<string, string>>({})
  /** Când primim detections_review, afișăm editorul (input_resized + poligoane); nu afișăm alte detecții în feed */
  const reviewPendingRef = useRef<{ files: FeedFile[] } | null>(null)
  const pendingStagesAfterReviewRef = useRef<string[]>([])
  const roofReviewPendingRef = useRef<{ files: FeedFile[] } | null>(null)
  const pendingStagesAfterRoofReviewRef = useRef<string[]>([])
  const detectionsReviewActiveRef = useRef(false)
  const roofReviewActiveRef = useRef(false)
  const progressLockedInEditorRef = useRef<number | null>(null)
  const freezeProgressAtCurrent = () => {
    const base = progressLockedInEditorRef.current ?? displayProgressRef.current
    const frozen = Math.min(100, Math.max(0, base || 0))
    progressLockedInEditorRef.current = frozen
    targetProgressRef.current = frozen
    displayProgressRef.current = frozen
    setProgress(Math.round(frozen * 10) / 10)
  }

  const STORAGE_KEY_OFFER = 'holzbot_dashboard_offer'
  const STORAGE_KEY_RUNNING = 'holzbot_dashboard_running'
  const persistOfferState = (offerId: string | null, runId: string | null, isComputing: boolean, flow: OfferFlow = 'einfamilienhaus') => {
    try {
      if (typeof window === 'undefined') return
      if (!offerId) {
        sessionStorage.removeItem(STORAGE_KEY_OFFER)
        sessionStorage.removeItem(STORAGE_KEY_RUNNING)
        return
      }
      sessionStorage.setItem(STORAGE_KEY_OFFER, JSON.stringify({ offerId, runId: runId || null, isComputing, flow }))
      if (isComputing && runId) {
        sessionStorage.setItem(STORAGE_KEY_RUNNING, JSON.stringify({ offerId, runId }))
      } else {
        // Ștergem RUNNING doar dacă oferta pe care o persistăm este cea care rula (s-a terminat acum)
        const raw = sessionStorage.getItem(STORAGE_KEY_RUNNING)
        if (raw) {
          try {
            const running = JSON.parse(raw) as { offerId?: string }
            if (running?.offerId === offerId) sessionStorage.removeItem(STORAGE_KEY_RUNNING)
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  // ✅ [FIX CRITIC] Session ID pentru a invalida procesele vechi la reset
  const sessionRef = useRef<number>(0)
  /** Generație pentru loadHistory: nu folosește sessionRef (reset/compute-started ar invalida același flux). */
  const historyLoadGenRef = useRef(0)
  const activeRunIdRef = useRef<string|null>(null)

  useEffect(() => { 
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) 
  }, [rows])

  useEffect(() => {
    offerIdRef.current = offerId
  }, [offerId])

  // Progres afișat: interpolare (lerp) spre țintă – ținta vine din server sau din etape (fallback).
  useEffect(() => {
    if (!computing && !runId) {
      setProgress(0)
      setCurrentStageName(null)
      targetProgressRef.current = 0
      displayProgressRef.current = 0
      serverDrivesProgressRef.current = false
      return
    }

    const interval = setInterval(() => {
      if (!computing && !runId) {
        setProgress(0)
        setCurrentStageName(null)
        targetProgressRef.current = 0
        displayProgressRef.current = 0
        serverDrivesProgressRef.current = false
        return
      }

      const editorOpen =
        detectionsReviewActiveRef.current ||
        roofReviewActiveRef.current ||
        reviewPendingRef.current != null ||
        roofReviewPendingRef.current != null
      if (editorOpen) {
        freezeProgressAtCurrent()
        return
      }

      let target = targetProgressRef.current
      if (!serverDrivesProgressRef.current) {
        const { progress: np, currentStageName: ns } = calculateProgress(
          processedStages.current,
          currentStageRef.current,
          flowModeRef.current,
        )
        target = np
        targetProgressRef.current = np
        setCurrentStageName(ns)
      }

      const d = displayProgressRef.current
      const k = 0.18
      let next = d + (target - d) * k
      if (Math.abs(target - next) < 0.05) next = target
      next = Math.min(100, Math.max(0, next))
      displayProgressRef.current = next
      setProgress(Math.round(next * 10) / 10)
    }, 42)

    return () => clearInterval(interval)
  }, [computing, runId])

  // Obține flag-ul can_download_admin_pdf din /me
  useEffect(() => {
    (async () => {
      try {
        const me = await apiFetch('/me')
        const canDownload = me?.tenant?.can_download_admin_pdf === true
        setCanDownloadAdminPdf(canDownload)
      } catch {
        setCanDownloadAdminPdf(false)
      }
    })()
  }, [])

  useEffect(() => {
    activeRunIdRef.current = runId
  }, [runId])

  // Încărcăm meta ofertă imediat ce avem runId: evenimentele scale pot ajunge înainte de offer:compute-started.
  useEffect(() => {
    if (!offerId || !runId) return
    let cancelled = false
    void apiFetch(`/offers/${encodeURIComponent(offerId)}`)
      .then((o: any) => {
        if (cancelled) return
        const meta = o?.meta ?? o?.offer?.meta
        const slug = o?.offer_type_slug ?? o?.offer?.offer_type_slug
        const inferred = inferOfferFlow({ ...meta, offer_type_slug: slug })
        flowModeRef.current = inferred
        setOfferFlow(inferred)
        setIsMeasurementsOnlyOffer(meta?.measurements_only_offer === true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [offerId, runId])

  // Persistăm starea „nu mai e computing” ca să nu restaurem GIF la refresh după ce run-ul s-a terminat
  useEffect(() => {
    if (!computing && offerId) persistOfferState(offerId, null, false, flowModeRef.current)
  }, [computing, offerId])

  useEffect(() => {
    const reset = () => { 
      // ✅ INCREMENTEAZĂ SESIUNEA LA RESET (Oprește orice proces async vechi)
      sessionRef.current = sessionRef.current + 1

      setRows([]); 
      setGroups([]); 
      filesByStage.current={}; 
      processedStages.current.clear(); 
      stageQueue.current=[]; 
      processing.current=false; 
      sinceRef.current=undefined; 
      seenEventIdsRef.current.clear();
      currentStageRef.current = null;
      titleIndexRef.current = {};
      finalPdfUrlRef.current = null;
      isHistoryMode.current = false;
      allStagesCompleted.current = false;
      queuedStages.current.clear();
      pendingCompletionRef.current = null;
      reviewPendingRef.current = null;
      pendingStagesAfterReviewRef.current = [];
      roofReviewPendingRef.current = null;
      pendingStagesAfterRoofReviewRef.current = [];
      detectionsReviewActiveRef.current = false;
      roofReviewActiveRef.current = false;
      progressLockedInEditorRef.current = null;
      targetProgressRef.current = 0
      displayProgressRef.current = 0
      serverDrivesProgressRef.current = false
      stageStartedAtRef.current = {};
      setPdfUrl(null)

      setRunId(null)
      activeRunIdRef.current = null
      setComputing(false)
      setProgress(0)
      setCurrentStageName(null)
      flowModeRef.current = 'einfamilienhaus'
      setOfferFlow('einfamilienhaus')
      setIsMeasurementsOnlyOffer(false)
    }
    
    const onComputeStarted = (e: any) => { 
      // 1. Întâi resetăm totul (inclusiv incrementarea sessionRef pentru filtrare)
      reset() 
      
      // 2. Apoi setăm noile valori
      const offerId = e.detail.offerId
      const runId = e.detail.runId
      const detailFlow = e.detail?.flow as OfferFlow | undefined
      const explicitFlow: OfferFlow | undefined =
        detailFlow === 'einfamilienhaus' || detailFlow === 'dachstuhl' || detailFlow === 'aufstockung' || detailFlow === 'zubau'
          ? detailFlow
          : undefined
      const provisional: OfferFlow =
        explicitFlow === 'aufstockung' || explicitFlow === 'zubau' || explicitFlow === 'dachstuhl' ? explicitFlow : 'einfamilienhaus'
      flowModeRef.current = provisional
      setOfferFlow(provisional)
      setIsMeasurementsOnlyOffer(e?.detail?.measurementsOnlyOffer === true)

      setOfferId(offerId); 
      setComputing(true) // Activează progress bar-ul
      // Pornește polling-ul live imediat (nu mai așteptăm history hydrate).
      setRunId(runId)
      activeRunIdRef.current = runId
      isHistoryMode.current = false
      allStagesCompleted.current = false
      persistOfferState(offerId, runId, true, provisional)

      const metaSession = sessionRef.current
      void apiFetch(`/offers/${encodeURIComponent(offerId)}`)
        .then((o: any) => {
          if (sessionRef.current !== metaSession) return
          const meta = o?.meta ?? o?.offer?.meta
          const slug = o?.offer_type_slug ?? o?.offer?.offer_type_slug
          const resolved = resolveOfferFlowWithExplicit(meta, slug, explicitFlow)
          flowModeRef.current = resolved
          setOfferFlow(resolved)
          setIsMeasurementsOnlyOffer(meta?.measurements_only_offer === true)
          persistOfferState(offerId, runId, true, resolved)
        })
        .catch(() => {})
      // Hydrate instant from history so spectators see everything immediately, then continue live.
      ;(async () => {
        const hydrateSession = sessionRef.current
        try {
          const historyData = await apiFetch(`/calc-events/history?offer_id=${encodeURIComponent(offerId)}`)
          if (sessionRef.current !== hydrateSession) return
          if (historyData?.items?.length && historyData?.run_id === runId) {
            setRows([])
            setGroups([])
            filesByStage.current = {}
            processedStages.current.clear()
            stageQueue.current = []
            processing.current = false
            currentStageRef.current = null
            targetProgressRef.current = 0
            displayProgressRef.current = 0
            serverDrivesProgressRef.current = false
            seenEventIdsRef.current.clear()

            // collect files per stage
            for (const ev of historyData.items) {
              if (typeof ev?.id === 'number') seenEventIdsRef.current.add(ev.id)
              const match = ev.message.match(/^\s*\[([^\]]+)\]/)
              if (match && ev.payload?.files) {
                const stage = match[1].trim()
                const newFiles = ev.payload.files
                  .filter((f: any) => isDisplayable(f))
                  .filter((f: FeedFile) => !shouldHideScaleWalls3dFromFeed(stage, f))
                const existing = filesByStage.current[stage] || []
                const uniqueNew = newFiles.filter((nf: FeedFile) => !existing.some((ex: FeedFile) => ex.url === nf.url))
                if (uniqueNew.length > 0) {
                  filesByStage.current[stage] = [...existing, ...uniqueNew]
                }
              }
            }

            const stageOrder: string[] = []
            const seen = new Set<string>()
            for (const ev of historyData.items) {
              const m = ev.message?.match(/^\s*\[([^\]]+)\]/)
              const stage = m?.[1]?.trim()
              if (stage && !seen.has(stage)) {
                seen.add(stage)
                stageOrder.push(stage)
              }
            }

            stageQueue.current = stageOrder
            await processQueueInstant()
            if (sessionRef.current !== hydrateSession) return

            // set cursor for live polling
            sinceRef.current = historyData.last_event_id ?? (historyData.items[historyData.items.length - 1]?.id)
          }
        } catch (_) {
          // ignore hydrate errors; live polling will still populate
        }
      })()
    }

    const onOfferNew = () => {
      persistOfferState(null, null, false)
      reset()
    }

    const onOfferWizardFlush = (e: Event) => {
      const want = (e as CustomEvent<{ offerId?: string }>).detail?.offerId
      const cur = offerIdRef.current
      if (want && cur && want !== cur) return
      if (!want && !cur) return
      sessionRef.current = sessionRef.current + 1
      setRows([])
      setGroups([])
      filesByStage.current = {}
      processedStages.current.clear()
      stageQueue.current = []
      processing.current = false
      sinceRef.current = undefined
      seenEventIdsRef.current.clear()
      currentStageRef.current = null
      titleIndexRef.current = {}
      finalPdfUrlRef.current = null
      isHistoryMode.current = false
      allStagesCompleted.current = false
      queuedStages.current.clear()
      pendingCompletionRef.current = null
      reviewPendingRef.current = null
      pendingStagesAfterReviewRef.current = []
      roofReviewPendingRef.current = null
      pendingStagesAfterRoofReviewRef.current = []
      detectionsReviewActiveRef.current = false
      roofReviewActiveRef.current = false
      progressLockedInEditorRef.current = null
      targetProgressRef.current = 0
      displayProgressRef.current = 0
      serverDrivesProgressRef.current = false
      stageStartedAtRef.current = {}
      setPdfUrl(null)
      setRunId(null)
      activeRunIdRef.current = null
      setProgress(0)
      setCurrentStageName(null)
      setComputing(false)
    }
    const onDetectionsReviewStart = () => {
      if (progressLockedInEditorRef.current == null) {
        progressLockedInEditorRef.current = Math.min(100, Math.max(0, displayProgressRef.current || 0))
      }
      detectionsReviewActiveRef.current = true
      reviewPendingRef.current = { files: reviewPendingRef.current?.files ?? [] }
      freezeProgressAtCurrent()
    }
    const onRoofReviewStart = () => {
      if (progressLockedInEditorRef.current == null) {
        progressLockedInEditorRef.current = Math.min(100, Math.max(0, displayProgressRef.current || 0))
      }
      roofReviewActiveRef.current = true
      roofReviewPendingRef.current = { files: roofReviewPendingRef.current?.files ?? [] }
      freezeProgressAtCurrent()
    }

    window.addEventListener('offer:compute-started', onComputeStarted)
    window.addEventListener('offer:new', onOfferNew)
    window.addEventListener('offer:wizard-flush-feed', onOfferWizardFlush as EventListener)
    window.addEventListener('offer:detections-review-start', onDetectionsReviewStart as EventListener)
    window.addEventListener('offer:roof-review-start', onRoofReviewStart as EventListener)
    // Fallback: if the wizard signals PDF ready but stage queue never reaches computation_complete,
    // inject the final download card anyway.
    const onPdfReady = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail as { offerId?: string; pdfUrl?: string }
        const oid = String(detail?.offerId || '').trim()
        const url = String(detail?.pdfUrl || '').trim()
        if (!oid || !url) return
        // Only for the currently selected offer (avoid cross-offer bleed).
        if (offerId && oid !== offerId) return
        pendingCompletionRef.current = { offerId: oid, pdfUrl: url, canDownloadAdminPdf }
        if (!queuedStages.current.has('computation_complete')) {
          queuedStages.current.add('computation_complete')
          stageQueue.current.push('computation_complete')
          void processQueue()
        }
      } catch (_) {}
    }
    window.addEventListener('offer:pdf-ready', onPdfReady as EventListener)
    
    return () => {
      window.removeEventListener('offer:compute-started', onComputeStarted)
      window.removeEventListener('offer:new', onOfferNew)
      window.removeEventListener('offer:wizard-flush-feed', onOfferWizardFlush as EventListener)
      window.removeEventListener('offer:detections-review-start', onDetectionsReviewStart as EventListener)
      window.removeEventListener('offer:roof-review-start', onRoofReviewStart as EventListener)
      window.removeEventListener('offer:pdf-ready', onPdfReady as EventListener)
    }
  }, [])

  const nextTitle = (stage: string): string => {
    const variants = getStageTitlesForFlow(flowModeRef.current, stage)
    const idx = (titleIndexRef.current[stage] ?? -1) + 1
    titleIndexRef.current[stage] = idx % variants.length
    return variants[titleIndexRef.current[stage]]
  }

  useEffect(() => {
    const loadHistory = async (e: any) => {
      // ✅ Invalidăm sesiunea veche și aici
      sessionRef.current = sessionRef.current + 1
      historyLoadGenRef.current += 1
      const loadGen = historyLoadGenRef.current

      const id = e.detail.offerId as string

      let offerFlowResolved: OfferFlow = 'einfamilienhaus'
      try {
        const o = await apiFetch(`/offers/${encodeURIComponent(id)}`)
        const meta = o?.meta ?? o?.offer?.meta
        const slug = o?.offer_type_slug ?? o?.offer?.offer_type_slug
        offerFlowResolved = inferOfferFlow({ ...meta, offer_type_slug: slug })
        setIsMeasurementsOnlyOffer(meta?.measurements_only_offer === true)
      } catch (_) {}
      if (loadGen !== historyLoadGenRef.current) return
      flowModeRef.current = offerFlowResolved
      setOfferFlow(offerFlowResolved)

      // Când selectăm o ofertă din History (inclusiv draft),
      // resetăm explicit starea de rulare ca să nu mai rămână GIF-ul vechi.
      setComputing(false)
      setRunId(null)
      activeRunIdRef.current = null
      targetProgressRef.current = 0
      displayProgressRef.current = 0
      serverDrivesProgressRef.current = false
      setProgress(0)
      setCurrentStageName(null)

      setOfferId(id)
      persistOfferState(id, null, false, offerFlowResolved)
      isHistoryMode.current = true
      allStagesCompleted.current = false
      
      try {
        const historyData = await apiFetch(`/calc-events/history?offer_id=${id}`)
        if (loadGen !== historyLoadGenRef.current) return
        const runStatus = (historyData as any)?.run_status
        const runIdFromHistory = (historyData as any)?.run_id ?? null
        const lastEventId = (historyData as any)?.last_event_id ?? null

        if (historyData.items && historyData.items.length > 0) {
          setRows([])
          setGroups([])
          filesByStage.current = {}
          processedStages.current.clear()
          stageQueue.current = []
          processing.current = false
          currentStageRef.current = null
          targetProgressRef.current = 0
          displayProgressRef.current = 0
          serverDrivesProgressRef.current = false

          setRunId(historyData.run_id)
          activeRunIdRef.current = historyData.run_id

          // Build stage → first event created_at so timestamps in feed are correct
          stageStartedAtRef.current = {}
          for (const ev of historyData.items) {
            const m = ev.message?.match(/^\s*\[([^\]]+)\]/)
            const stage = m?.[1]?.trim()
            const createdAt = (ev as any).created_at
            if (stage && createdAt && stageStartedAtRef.current[stage] === undefined) {
              stageStartedAtRef.current[stage] = typeof createdAt === 'string' ? createdAt : new Date(createdAt).toISOString()
            }
          }

          for (const ev of historyData.items) {
            const match = ev.message?.match(/^\s*\[([^\]]+)\]/)
            if (match && ev.payload?.files) {
              const stage = match[1].trim()
              const newFiles = ev.payload.files
                .filter((f: any) => isDisplayable(f))
                .filter((f: FeedFile) => !shouldHideScaleWalls3dFromFeed(stage, f))
              const existing = filesByStage.current[stage] || []
              const uniqueNew = newFiles.filter((nf: FeedFile) => !existing.some((ex: FeedFile) => ex.url === nf.url))
              
              if (uniqueNew.length > 0) {
                filesByStage.current[stage] = [...existing, ...uniqueNew]
              }
            }
          }
          
          const stageOrder: string[] = []
          const seen = new Set<string>()
          for (const ev of historyData.items) {
            const m = ev.message?.match(/^\s*\[([^\]]+)\]/)
            const stage = m?.[1]?.trim()
            if (stage && !seen.has(stage)) {
              seen.add(stage)
              stageOrder.push(stage)
            }
          }
          
          stageQueue.current = stageOrder
          await processQueueInstant()
          if (loadGen !== historyLoadGenRef.current) return
          allStagesCompleted.current = true

          // Dacă oferta e încă în curs, trecem în mod live: GIF + progress + polling
          if (runStatus === 'running' && runIdFromHistory) {
            isHistoryMode.current = false
            setComputing(true)
            setRunId(runIdFromHistory)
            activeRunIdRef.current = runIdFromHistory
            sinceRef.current = lastEventId ?? undefined
            window.dispatchEvent(
              new CustomEvent('offer:compute-started', {
                detail: { offerId: id, runId: runIdFromHistory, flow: offerFlowResolved },
              }),
            )
          }

          try {
            const fresh = await apiFetch(`/offers/${id}/export-url`)
            if (loadGen !== historyLoadGenRef.current) return
            const url = fresh?.url || fresh?.download_url || fresh?.pdf
            if (url) {
              addCongrats(id, url, {
                measurementsOnlyOffer: fresh?.measurements_only_offer === true,
                roofMeasurementsPdfUrl:
                  fresh?.roofMeasurementsPdf?.download_url || fresh?.roofMeasurementsPdf?.url || null,
              })
              window.dispatchEvent(new CustomEvent('offer:pdf-ready', {
                detail: { offerId: id, pdfUrl: url },
              }))
              window.dispatchEvent(new Event('tokens:refresh'))
            }
          } catch {}
        } else if (runStatus === 'running' && runIdFromHistory) {
          // Oferta rulează dar nu avem încă evenimente: afișăm GIF + progress și pornim polling
          setRunId(runIdFromHistory)
          activeRunIdRef.current = runIdFromHistory
          isHistoryMode.current = false
          setComputing(true)
          sinceRef.current = lastEventId ?? undefined
          window.dispatchEvent(
            new CustomEvent('offer:compute-started', {
              detail: { offerId: id, runId: runIdFromHistory, flow: offerFlowResolved },
            }),
          )
          setRows([])
          setGroups([])
          filesByStage.current = {}
          processedStages.current.clear()
          stageQueue.current = []
          processing.current = false
          currentStageRef.current = null
          targetProgressRef.current = 0
          displayProgressRef.current = 0
          serverDrivesProgressRef.current = false
          allStagesCompleted.current = false
        } else {
          setRunId(null)
          activeRunIdRef.current = null
          setRows([])
          setGroups([])
          filesByStage.current = {}
          processedStages.current.clear()
          stageQueue.current = []
          processing.current = false
          currentStageRef.current = null
          targetProgressRef.current = 0
          displayProgressRef.current = 0
          serverDrivesProgressRef.current = false
          allStagesCompleted.current = true
          stageStartedAtRef.current = {}
          
          try {
            const fresh = await apiFetch(`/offers/${id}/export-url`)
            if (loadGen !== historyLoadGenRef.current) return
            const url = fresh?.url || fresh?.download_url || fresh?.pdf
            
            if (url) {
              setPdfUrl(url)
              setComputing(false)
              window.dispatchEvent(new CustomEvent('offer:pdf-ready', { 
                detail: { offerId: id, pdfUrl: url } 
              }))
              window.dispatchEvent(new Event('tokens:refresh'))
            } else {
              setPdfUrl(null)
              setComputing(false)
            }
          } catch {
            if (loadGen !== historyLoadGenRef.current) return
            setPdfUrl(null)
            setComputing(false)
          }
        }
      } catch (err) {
        if (loadGen !== historyLoadGenRef.current) return
        setRunId(null)
        activeRunIdRef.current = null
        setRows([])
        setGroups([])
        filesByStage.current = {}
        processedStages.current.clear()
        stageQueue.current = []
        processing.current = false
        currentStageRef.current = null
        targetProgressRef.current = 100
        displayProgressRef.current = 100
        serverDrivesProgressRef.current = true
        setPdfUrl(null)
        setComputing(false)
        allStagesCompleted.current = true
        stageStartedAtRef.current = {}
        setProgress(100)
        setCurrentStageName('Abgeschlossen')
      }
    }
    
    window.addEventListener('offer:selected', loadHistory)
    return () => window.removeEventListener('offer:selected', loadHistory)
  }, [])

  useEffect(() => {
    if(!runId || isHistoryMode.current) return
    
    // ✅ CAPTURE SESSIONS ID
    const mySessionId = sessionRef.current

    const iv = setInterval(async () => {
      // ✅ CHECK 1: Sesiune invalidată înainte de request
      if (sessionRef.current !== mySessionId) return
      
      try {
        const res = await apiFetch(`/calc-events?run_id=${runId}${sinceRef.current ? `&sinceId=${sinceRef.current}` : ''}`)
        
        // ✅ CHECK 2: Sesiune invalidată în timpul request-ului
        if (sessionRef.current !== mySessionId) return
        if (activeRunIdRef.current !== runId) return

        if(res.items?.length) {
          const last = res.items[res.items.length-1]
          sinceRef.current = last.id
          
          for(const ev of res.items) {
            if (typeof ev?.id === 'number') {
              if (seenEventIdsRef.current.has(ev.id)) continue
              seenEventIdsRef.current.add(ev.id)
            }
            const match = ev.message.match(/^\s*\[([^\]]+)\]/)
            if(!match) continue
            const stage = match[1].trim()

            // ✅ Progres de la server (UI:PROGRESS) – țintă pentru interpolarea barei
            if (stage === 'progress' && ev.payload?.progress != null) {
              if (
                detectionsReviewActiveRef.current ||
                roofReviewActiveRef.current ||
                reviewPendingRef.current != null ||
                roofReviewPendingRef.current != null
              ) {
                continue
              }
              const p = Math.min(100, Math.max(0, Number(ev.payload.progress)))
              serverDrivesProgressRef.current = true
              targetProgressRef.current = p
              setCurrentStageName('Verarbeitung...')
              continue
            }
            
            if(ev.payload?.files?.length) {
              const newImages = ev.payload.files
                .filter(isDisplayable)
                .filter((f: FeedFile) => !shouldHideScaleWalls3dFromFeed(stage, f))
              const existing = filesByStage.current[stage] || []
              const uniqueNew = newImages.filter((nf: FeedFile) => !existing.some(ex => ex.url === nf.url))
              
              if (uniqueNew.length > 0) {
                  filesByStage.current[stage] = [...existing, ...uniqueNew]
                  const pdf = ev.payload.files.find(isPdf)
                  if(pdf && (stage === 'pdf_generation' || stage === 'final')) {
                     finalPdfUrlRef.current = pdf.url
                  }
              }
            }

            // Editor verificare: detections_review (input_resized + poligoane) → afișare în StepWizard, nu în feed
            if (stage === 'detections_review' && ev.payload?.files?.length) {
              const files = (ev.payload.files as FeedFile[]).filter(isDisplayable)
              if (files.length > 0) {
                detectionsReviewActiveRef.current = true
                if (progressLockedInEditorRef.current == null) {
                  progressLockedInEditorRef.current = Math.min(100, Math.max(0, displayProgressRef.current || 0))
                }
                reviewPendingRef.current = { files }
                freezeProgressAtCurrent()
                try {
                  window.dispatchEvent(new CustomEvent('offer:detections-review', {
                    detail: { files, offerId: offerIdRef.current, runId: activeRunIdRef.current },
                  }))
                } catch (_) {}
              }
              continue
            }

            // Roof editor is handled in StepWizard (direct calc-events poll). LiveFeed must ignore roof stage completely.
            if (stage === 'roof') {
              const files = (ev.payload?.files as FeedFile[] | undefined)?.filter(isDisplayable) ?? []
              roofReviewActiveRef.current = true
              if (progressLockedInEditorRef.current == null) {
                progressLockedInEditorRef.current = Math.min(100, Math.max(0, displayProgressRef.current || 0))
              }
              roofReviewPendingRef.current = { files }
              freezeProgressAtCurrent()
              continue
            }

            // În timpul review-ului, etapele de detecții se bufferizează și vor fi procesate după Approve
            const stagesBufferedDuringReview = ['scale_flood', 'detections', 'exterior_doors', 'count_objects']
            if (reviewPendingRef.current != null && stagesBufferedDuringReview.includes(stage)) {
              if (STAGE_TO_SEQUENCE[stage] && !pendingStagesAfterReviewRef.current.includes(stage)) {
                pendingStagesAfterReviewRef.current.push(stage)
              }
              continue
            }

            const stagesBufferedDuringRoofReview = ['pricing', 'offer_generation', 'pdf_generation', 'computation_complete']
            if (roofReviewPendingRef.current != null && stagesBufferedDuringRoofReview.includes(stage)) {
              // If completion arrives while roof review is open, persist export URLs now.
              // Otherwise, when buffered stage is replayed after approval, we can miss the final card.
              if (stage === 'computation_complete' && offerId && pendingCompletionRef.current == null) {
                let realPdfUrl: string | null = finalPdfUrlRef.current || null
                let adminPdfUrl: string | null = null
                let roofMeasurementsPdfUrl: string | null = null
                let measurementsOnlyFlag = false
                try {
                  const exportRes = await apiFetch(`/offers/${offerId}/export-url`)
                  realPdfUrl = exportRes?.url || exportRes?.download_url || exportRes?.pdf || realPdfUrl
                  adminPdfUrl = exportRes?.adminPdf?.download_url || exportRes?.adminPdf?.url || null
                  roofMeasurementsPdfUrl = exportRes?.roofMeasurementsPdf?.download_url || exportRes?.roofMeasurementsPdf?.url || null
                  measurementsOnlyFlag = exportRes?.measurements_only_offer === true
                } catch (_) {}
                pendingCompletionRef.current = {
                  offerId,
                  pdfUrl: realPdfUrl || '',
                  adminPdfUrl,
                  canDownloadAdminPdf,
                  roofMeasurementsPdfUrl,
                  measurementsOnlyOffer: measurementsOnlyFlag,
                }
              }
              if (STAGE_TO_SEQUENCE[stage] && !pendingStagesAfterRoofReviewRef.current.includes(stage)) {
                pendingStagesAfterRoofReviewRef.current.push(stage)
              }
              continue
            }

            // Nu afișăm scale_flood, detections, exterior_doors, count_objects în LiveFeed
            if (['scale_flood', 'detections', 'exterior_doors', 'count_objects'].includes(stage)) {
              continue
            }

            if(stage === 'computation_complete') {
              allStagesCompleted.current = true
              serverDrivesProgressRef.current = true
              targetProgressRef.current = 100
              displayProgressRef.current = 100
              setProgress(100)
              setCurrentStageName('Abgeschlossen')
              await new Promise(r => setTimeout(r, 1500));
              if (sessionRef.current !== mySessionId) return // Check after delay

              let realPdfUrl: string | null = null
              let adminPdfUrl: string | null = null
              let roofMeasurementsPdfUrl: string | null = null
              let measurementsOnlyFlag = false
              if (offerId) {
                try {
                  const exportRes = await apiFetch(`/offers/${offerId}/export-url`)
                  realPdfUrl = exportRes?.url || exportRes?.download_url || exportRes?.pdf
                  adminPdfUrl = exportRes?.adminPdf?.download_url || exportRes?.adminPdf?.url || null
                  roofMeasurementsPdfUrl = exportRes?.roofMeasurementsPdf?.download_url || exportRes?.roofMeasurementsPdf?.url || null
                  measurementsOnlyFlag = exportRes?.measurements_only_offer === true
                } catch (e) {
                  console.warn('Failed to fetch export url on complete', e)
                }
              }

              if (!realPdfUrl && finalPdfUrlRef.current) {
                realPdfUrl = finalPdfUrlRef.current
              }

              if (offerId) {
                pendingCompletionRef.current = {
                  offerId,
                  pdfUrl: realPdfUrl || '',
                  adminPdfUrl: adminPdfUrl,
                  canDownloadAdminPdf: canDownloadAdminPdf,
                  roofMeasurementsPdfUrl: roofMeasurementsPdfUrl,
                  measurementsOnlyOffer: measurementsOnlyFlag,
                }
                if (STAGE_TO_SEQUENCE[stage] && !queuedStages.current.has(stage)) {
                  queuedStages.current.add(stage)
                  stageQueue.current.push(stage)
                  processQueue()
                }
              }
              continue
            }

            if (STAGE_TO_SEQUENCE[stage]) {
              if (processedStages.current.has(stage)) {
                if (ev.payload?.files?.length) {
                  const newImages = ev.payload.files
                    .filter(isDisplayable)
                    .filter((f: FeedFile) => !shouldHideScaleWalls3dFromFeed(stage, f))
                  setGroups(prev => {
                    const groupIndex = prev.findIndex(g => g.stage === stage)
                    if (groupIndex >= 0) {
                      const group = prev[groupIndex]
                      const newItems = group.items.map(item => {
                          if (item.kind === 'image') {
                              const uniqueForState = newImages.filter((nf: FeedFile) => !item.files.some(ex => ex.url === nf.url))
                              if (uniqueForState.length > 0) {
                                  return { ...item, files: [...item.files, ...uniqueForState] }
                              }
                          }
                          return item
                      })
                      if (newItems !== group.items) {
                          const updatedGroup = { ...group, items: newItems }
                          const next = [...prev]
                          next[groupIndex] = updatedGroup
                          setRows(next.map(x => ({ kind: 'group', id: x.id, group: x })))
                          return next
                      }
                    }
                    return prev
                  })
                }
              } else if (!queuedStages.current.has(stage) && currentStageRef.current !== stage) {
                queuedStages.current.add(stage)
                stageQueue.current.push(stage)
                processQueue()
              }
            }
          }
        }
      } catch {}
    }, 250)
    
    return () => clearInterval(iv)
  }, [runId, offerId, offerFlow])

  // După ce userul aprobă detecțiile în editor, eliberăm review-ul și procesăm eventualele etape bufferizate
  useEffect(() => {
    const onApproved = () => {
      if (reviewPendingRef.current == null) return
      detectionsReviewActiveRef.current = false
      if (!roofReviewActiveRef.current) {
        const locked = progressLockedInEditorRef.current
        if (typeof locked === 'number') {
          targetProgressRef.current = locked
          displayProgressRef.current = locked
          setProgress(Math.round(locked * 10) / 10)
        }
        progressLockedInEditorRef.current = null
      }
      reviewPendingRef.current = null
      if (!queuedStages.current.has('detections_review')) {
        queuedStages.current.add('detections_review')
        stageQueue.current.push('detections_review')
      }
      for (const s of pendingStagesAfterReviewRef.current) {
        if (!queuedStages.current.has(s)) {
          queuedStages.current.add(s)
          stageQueue.current.push(s)
        }
      }
      pendingStagesAfterReviewRef.current = []
      processQueue()
    }
    window.addEventListener('offer:detections-review-approved', onApproved)
    return () => window.removeEventListener('offer:detections-review-approved', onApproved)
  }, [])

  useEffect(() => {
    const onApproved = () => {
      if (roofReviewPendingRef.current == null) return
      roofReviewActiveRef.current = false
      if (!detectionsReviewActiveRef.current) {
        const locked = progressLockedInEditorRef.current
        if (typeof locked === 'number') {
          targetProgressRef.current = locked
          displayProgressRef.current = locked
          setProgress(Math.round(locked * 10) / 10)
        }
        progressLockedInEditorRef.current = null
      }
      roofReviewPendingRef.current = null
      if (!queuedStages.current.has('roof')) {
        queuedStages.current.add('roof')
        stageQueue.current.push('roof')
      }
      for (const s of pendingStagesAfterRoofReviewRef.current) {
        if (!queuedStages.current.has(s)) {
          queuedStages.current.add(s)
          stageQueue.current.push(s)
        }
      }
      pendingStagesAfterRoofReviewRef.current = []
      processQueue()
    }
    window.addEventListener('offer:roof-review-approved', onApproved)
    return () => window.removeEventListener('offer:roof-review-approved', onApproved)
  }, [])

  const processQueue = async () => {
    // ✅ CHECK RUN ID
    if (!activeRunIdRef.current && !isHistoryMode.current) return

    if(processing.current || !stageQueue.current.length) return
    processing.current = true
    const stage = stageQueue.current.shift()!
    currentStageRef.current = stage
    
    // Actualizează progresul cu etapa curentă
    const progressData = calculateProgress(
      processedStages.current,
      stage,
      flowModeRef.current,
    )
    if (!serverDrivesProgressRef.current) {
      setProgress(progressData.progress)
      targetProgressRef.current = progressData.progress
      displayProgressRef.current = progressData.progress
    }
    setCurrentStageName(progressData.currentStageName)
    
    // ✅ PASS CURRENT SESSION ID
    await executeStage(stage, false, sessionRef.current)
    
    processedStages.current.add(stage)
    currentStageRef.current = null
    
    // Actualizează progresul după finalizarea etapei
    const finalProgressData = calculateProgress(
      processedStages.current,
      null,
      flowModeRef.current,
    )
    if (!serverDrivesProgressRef.current) {
      setProgress(finalProgressData.progress)
      targetProgressRef.current = finalProgressData.progress
      displayProgressRef.current = finalProgressData.progress
    }
    setCurrentStageName(finalProgressData.currentStageName)
    
    processing.current = false
    processQueue()
  }

  const processQueueInstant = async () => {
    const queue = [...stageQueue.current]
    stageQueue.current = []
    if (queue.length === 0) return

    // History mode: build all groups in one pass and set state once for better performance
    if (isHistoryMode.current) {
      const newGroups: Group[] = []
      for (const stage of queue) {
        const indices = getStageSequence(stage)
        const gid = generateId('g-')
        const title = getStageTitlesForFlow(flowModeRef.current, stage)[0] ?? stage
        const items: SyntheticItem[] = []

        for (let i = 0; i < indices.length; i++) {
          const idx = indices[i]
          const m = (idx > 0 ? MESSAGES[idx] : null) ?? FALLBACK_MESSAGE
          if (i > 0) items.push({ kind: 'break', stage, __id: `br-${i}` } as BreakItem)
          items.push({ kind: 'text', role: 'ai', text: safeString(m.ai), stage, __id: `ai-${idx}` } as TextItem)
          items.push({ kind: 'text', role: 'formula', text: safeString(m.formula), stage, __id: `f-${idx}` } as TextItem)
          items.push({ kind: 'text', role: 'rezultat', text: safeString(m.rezultat), stage, __id: `r-${idx}` } as TextItem)
        }
        // If stage has no sequence entries (e.g. computation_complete with []), show at least one line
        if (items.length === 0 && stage !== 'computation_complete') {
          items.push({ kind: 'text', role: 'ai', text: FALLBACK_MESSAGE.ai, stage, __id: 'fb-ai' } as TextItem)
          items.push({ kind: 'text', role: 'formula', text: FALLBACK_MESSAGE.formula, stage, __id: 'fb-f' } as TextItem)
          items.push({ kind: 'text', role: 'rezultat', text: FALLBACK_MESSAGE.rezultat, stage, __id: 'fb-r' } as TextItem)
        }

        if (STAGES_WITH_IMAGES.includes(stage)) {
          const files = filesByStage.current[stage]
          if (files?.length) {
            items.push({ kind: 'image', stage, files, __id: generateId('img-') } as ImageItem)
          }
        }

        const startedAt = stageStartedAtRef.current[stage] ?? new Date().toISOString()
        const skipEmptyComplete = stage === 'computation_complete' && items.length === 0
        if (!skipEmptyComplete) {
          newGroups.push({ id: gid, stage, startedAt, title, items, instant: true })
        }
        processedStages.current.add(stage)
        queuedStages.current.add(stage)
      }
      setGroups(prev => [...prev, ...newGroups])
      setRows(prev => [...prev, ...newGroups.map(g => ({ kind: 'group' as const, id: g.id, group: g }))])
      return
    }

    while (queue.length > 0) {
      const stage = queue.shift()!
      await executeStageInstant(stage)
      processedStages.current.add(stage)
      queuedStages.current.add(stage)
    }
  }

  // ✅ RECEIVE SESSION ID & CHECK VALIDITY
  const executeStage = async (stage: string, instant: boolean = false, sessionId?: number) => {
    const isAborted = () => sessionId !== undefined && sessionRef.current !== sessionId
    if (isAborted()) return

    const indices = STAGE_TO_SEQUENCE[stage]
    if(!indices) return

    const gid = generateId('g-')
    const title = nextTitle(stage)
    
    setGroups(prev => {
      const g: Group = { id: gid, stage, startedAt: new Date().toISOString(), title, items: [], instant }
      const next = [...prev, g]
      setRows(next.map(x => ({ kind: 'group', id: x.id, group: x })))
      return next
    })

    const addItem = (item: SyntheticItem) => {
      setGroups(prev => {
        const idx = prev.findIndex(g => g.id === gid)
        if(idx<0) return prev
        const g = { ...prev[idx], items: [...prev[idx].items, item] }
        const next = [...prev]; 
        next[idx] = g
        setRows(next.map(x => ({ kind: 'group', id: x.id, group: x })))
        return next
      })
    }
    
    const replaceSpinner = (item: SyntheticItem) => {
       setGroups(prev => {
        const idx = prev.findIndex(g => g.id === gid)
        if(idx<0) return prev
        const items = [...prev[idx].items]
        if(items.length > 0 && items[items.length-1].kind === 'spinner') {
            items[items.length-1] = item
        } else {
            items.push(item)
        }
        const g = { ...prev[idx], items }
        const next = [...prev]; 
        next[idx] = g
        setRows(next.map(x => ({ kind: 'group', id: x.id, group: x })))
        return next
      }) 
    }

    if (stage === 'computation_complete') {
      const completion = pendingCompletionRef.current
      if (completion) {
        const item: CongratsItem = {
          kind: 'congrats',
          stage: 'final',
          offerId: completion.offerId,
          pdfUrl: completion.pdfUrl,
          adminPdfUrl: completion.adminPdfUrl || null,
          canDownloadAdminPdf: completion.canDownloadAdminPdf || false,
          roofMeasurementsPdfUrl: completion.roofMeasurementsPdfUrl || null,
          measurementsOnlyOffer: completion.measurementsOnlyOffer === true,
          __id: 'final',
        }
        addItem(item)
        window.dispatchEvent(new CustomEvent('offer:pdf-ready', {
          detail: { offerId: completion.offerId, pdfUrl: completion.pdfUrl }
        }))
        window.dispatchEvent(new Event('tokens:refresh'))
        pendingCompletionRef.current = null
      }
      if (!instant) {
        setRows(prev => [...prev, { kind: 'gap', id: generateId('gap-') }])
      }
      return
    }

    if (indices.length > 0) {
        await playMessage(indices[0], addItem, replaceSpinner, instant)
        if (isAborted()) return // ✅ STOP
    }

    if (STAGES_WITH_IMAGES.includes(stage)) {
        if (!instant) {
          addItem({ kind: 'spinner', stage, __id: generateId('spin-') } as SpinnerItem)
        }
        
        let foundFiles: FeedFile[] = []
        const start = Date.now()
        
        while(Date.now() - start < 25000) {
            if (isAborted()) return // ✅ STOP

            const files = filesByStage.current[stage]
            if (files && files.length > 0) {
                foundFiles = files
                if (!instant) await new Promise(r => setTimeout(r, 1000))
                if (isAborted()) return // ✅ STOP
                foundFiles = filesByStage.current[stage] || foundFiles
                break
            }
            await new Promise(r => setTimeout(r, 1000))
        }

        if (foundFiles.length > 0) {
            if (instant) {
              addItem({ kind: 'image', stage, files: foundFiles, __id: generateId('img-') } as ImageItem)
            } else {
              replaceSpinner({ kind: 'image', stage, files: foundFiles, __id: generateId('img-') } as ImageItem)
              await new Promise(r => setTimeout(r, EXTRA_MARGIN_AFTER_IMAGE_MS))
            }
        } else {
            if (!instant) {
              setGroups(prev => {
                   const idx = prev.findIndex(g => g.id === gid)
                   if(idx<0) return prev
                   const items = prev[idx].items.filter(i => i.kind !== 'spinner')
                   const next = [...prev]; 
                   next[idx] = { ...prev[idx], items }
                   setRows(next.map(x => ({ kind: 'group', id: x.id, group: x })))
                   return next
              })
            }
        }
    }

    for (let i = 1; i < indices.length; i++) {
        if (isAborted()) return // ✅ STOP

        addItem({ kind: 'break', stage, __id: `br-${i}` } as BreakItem)
        await playMessage(indices[i], addItem, replaceSpinner, instant)
    }
    
    if (!instant) {
      setRows(prev => [...prev, { kind: 'gap', id: generateId('gap-') }])
    }
  }

  const executeStageInstant = async (stage: string) => {
    const indices = getStageSequence(stage)
    if (!indices || indices.length === 0) return
    const gid = generateId('g-')
    const title = nextTitle(stage)
    const items: SyntheticItem[] = []

    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i]
      const m = (idx > 0 ? MESSAGES[idx] : null) ?? FALLBACK_MESSAGE
      if (i > 0) {
        items.push({ kind: 'break', stage, __id: `br-${i}` } as BreakItem)
      }
      items.push({ kind: 'text', role: 'ai', text: safeString(m.ai), stage, __id: `ai-${idx}` } as TextItem)
      items.push({ kind: 'text', role: 'formula', text: safeString(m.formula), stage, __id: `f-${idx}` } as TextItem)
      items.push({ kind: 'text', role: 'rezultat', text: safeString(m.rezultat), stage, __id: `r-${idx}` } as TextItem)
    }
    if (items.length === 0 && stage !== 'computation_complete') {
      items.push({ kind: 'text', role: 'ai', text: FALLBACK_MESSAGE.ai, stage, __id: 'fb-ai' } as TextItem)
      items.push({ kind: 'text', role: 'formula', text: FALLBACK_MESSAGE.formula, stage, __id: 'fb-f' } as TextItem)
      items.push({ kind: 'text', role: 'rezultat', text: FALLBACK_MESSAGE.rezultat, stage, __id: 'fb-r' } as TextItem)
    }

    if (STAGES_WITH_IMAGES.includes(stage)) {
      const files = filesByStage.current[stage]
      if (files && files.length > 0) {
        items.push({ kind: 'image', stage, files, __id: generateId('img-') } as ImageItem)
      }
    }

    setGroups(prev => {
      const g: Group = { id: gid, stage, startedAt: new Date().toISOString(), title, items, instant: true }
      const next = [...prev, g]
      setRows(next.map(x => ({ kind: 'group', id: x.id, group: x })))
      return next
    })
  }

  const playMessage = async (idx: number, add: any, replace: any, instant: boolean = false) => {
    const m = MESSAGES[idx]; 
    if(!m) return
    
    if (instant) {
      // Ensure text values are always strings to avoid React #418 error
      add({ kind:'text', role:'ai', text:safeString(m.ai), __id:`t1-${idx}` } as TextItem)
      add({ kind:'text', role:'formula', text:safeString(m.formula), __id:`t2-${idx}` } as TextItem)
      add({ kind:'text', role:'rezultat', text:safeString(m.rezultat), __id:`t3-${idx}` } as TextItem)
    } else {
      add({ kind:'spinner', stage:'' } as SpinnerItem)
      const cleanAI = strip(safeString(m.ai))
      const t1 = await paraphrase(cleanAI) 
      replace({ kind:'text', role:'ai', text:safeString(t1), __id:`t1-${idx}` } as TextItem)
      await new Promise(r => setTimeout(r, SAFE_GAP_BETWEEN_ITEMS_MS))

      add({ kind:'spinner', stage:'' } as SpinnerItem)
      replace({ kind:'text', role:'formula', text:safeString(m.formula), __id:`t2-${idx}` } as TextItem)
      await new Promise(r => setTimeout(r, SAFE_GAP_BETWEEN_ITEMS_MS))

      add({ kind:'spinner', stage:'' } as SpinnerItem)
      const cleanR = strip(safeString(m.rezultat))
      const t3 = await paraphrase(cleanR)
      replace({ kind:'text', role:'rezultat', text:safeString(t3), __id:`t3-${idx}` } as TextItem)
      await new Promise(r => setTimeout(r, SAFE_GAP_BETWEEN_ITEMS_MS))
    }
  }

  const addCongrats = (
    oid: string,
    url: string,
    opts?: { measurementsOnlyOffer?: boolean; roofMeasurementsPdfUrl?: string | null },
  ) => {
    const measOnly = opts?.measurementsOnlyOffer === true
    const roofMeas = opts?.roofMeasurementsPdfUrl ?? null
    setGroups((prev) => {
      const clean = prev.filter((g) => g.stage !== 'final')
      const g: Group = {
        id: 'final',
        stage: 'final',
        startedAt: new Date().toISOString(),
        title: 'Fertig',
        items: [
          {
            kind: 'congrats',
            stage: 'final',
            offerId: oid,
            pdfUrl: url,
            roofMeasurementsPdfUrl: measOnly ? roofMeas || url : roofMeas,
            measurementsOnlyOffer: measOnly,
            __id: 'final',
          } as CongratsItem,
        ],
      }
      const next = [...clean, g]
      setRows(next.map((x) => ({ kind: 'group', id: x.id, group: x })))
      return next
    })
  }

  return (
    <div className="h-full w-full overflow-hidden flex flex-col">
      {/* Progress Bar */}
      {computing && runId && (
        <div className="shrink-0 px-3 pt-3 pb-2 border-b border-white/10 bg-panel/40">
          <div className="flex items-center justify-between mb-2 gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span
                className={`shrink-0 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                  isMeasurementsOnlyOffer
                    ? 'border-[#E5B800]/28 text-sand/75 bg-[#E5B800]/[0.08]'
                    : 'border-[#E5B800]/45 text-[#F5D86A] bg-[#E5B800]/12'
                }`}
              >
                {isMeasurementsOnlyOffer
                  ? offerFlow === 'dachstuhl'
                    ? 'Dachstuhl Mengenermittlung'
                    : offerFlow === 'aufstockung'
                      ? 'Aufstockung Mengenermittlung'
                      : offerFlow === 'zubau'
                        ? 'Zubau Mengenermittlung'
                        : 'Einfamilienhaus Mengenermittlung'
                  : offerFlow === 'dachstuhl'
                    ? 'Dachstuhl Angebot'
                    : offerFlow === 'aufstockung'
                      ? 'Aufstockung Angebot'
                      : offerFlow === 'zubau'
                        ? 'Zubau Angebot'
                        : 'Einfamilienhaus Angebot'}
              </span>
              <div className="text-xs font-medium text-sand/80 truncate">
                {currentStageName || 'Verarbeitung...'}
              </div>
            </div>
            <div className="text-xs font-semibold text-[#E5B800] shrink-0">
              {Math.round(progress)}%
            </div>
          </div>
          <div className="w-full h-2 bg-black/30 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#E5B800] to-[#F5D030] transition-[width] duration-200 ease-out rounded-full"
              style={{ width: `${Math.max(2, Math.round(progress))}%` }}
            />
          </div>
        </div>
      )}
      
      <div ref={scrollRef} className="pretty-scroll flex-1 overflow-y-auto p-3 space-y-8">
         {rows.length===0 && (
           <div className="text-neutral-400 text-center mt-10">
             Bereit zum Start...
           </div>
         )}
         
         {rows.map(r => {
             if(r.kind === 'gap') {
               return (
                 <div key={r.id} className="flex justify-center py-4">
                   <Loader2 className="h-6 w-6 animate-spin text-sand/60" />
                 </div>
               )
             }
             
             const g = r.group
             const instant = isHistoryMode.current || g.instant === true
             
             return (
                 <div key={g.id} className={`border-b border-white/10 pb-6 ${instant ? '' : 'animate-slide-up'}`}>
                     <div className="text-xs text-neutral-500 mb-1">
                       {new Date(g.startedAt).toLocaleTimeString()}
                     </div>
                     <div className="text-lg font-bold text-sand mb-3">
                       {g.title}
                     </div>
                     
                     <div className="space-y-4">
                         {g.items.filter(Boolean).map((it, idx) => {
                             const uniqueKey = `${it.__id}-${idx}`;

                             if(it.kind === 'text') {
                               return <MessageRow key={uniqueKey} role={it.role} text={it.text} instant={instant} />
                             }
                             
                             if(it.kind === 'spinner') {
                               return <Spinner key={uniqueKey} />
                             }
                             
                             if(it.kind === 'break') {
                               return <div key={uniqueKey} className="h-px bg-white/5 my-2" />
                             }
                             
                             if(it.kind === 'image') {
                               return (
                                 <div key={uniqueKey} className="grid gap-4">
                                     {it.files.map((f, imgIdx) => (
                                       <SmartImage key={`${f.url}-${imgIdx}`} file={f} instant={instant} />
                                     ))}
                                 </div>
                               )
                             }
                             
                             if(it.kind === 'congrats') {
                               return (
                                 <div
                                   key={uniqueKey}
                                   className="relative overflow-hidden rounded-xl2 p-4 shadow-soft animate-pulse-slow"
                                   style={{
                                     border: '1px solid rgba(229,184,0,0.35)',
                                     background:
                                       'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02)),' +
                                       'rgba(38,38,38,0.95)'
                                   }}
                                 >
                                   <div className="congrats-ribbon" />
                                   <div className="flex items-start gap-3">
                                     <div
                                       className="shrink-0 h-9 w-9 rounded-full flex items-center justify-center animate-pop shadow-soft bg-[#E5B800] text-white"
                                     >
                                       <CheckCircle2 className="h-6 w-6" />
                                     </div>
                                     <div className="flex-1">
                                       <div className="text-[18px] font-semibold text-[#E5B800]">
                                         {it.measurementsOnlyOffer
                                           ? 'Mengenermittlung abgeschlossen'
                                           : 'Angebot erfolgreich erstellt!'}
                                       </div>
                                       <div className="text-sm text-white/70 mt-1">
                                         {it.measurementsOnlyOffer
                                           ? 'Ihr Maß-/Mengen-PDF ist bereit. Es enthält keine Preisangaben.'
                                           : 'Das PDF ist bereit. Sie können die Dokumente über die Buttons unten herunterladen.'}
                                       </div>
                                       <div className="mt-3 flex flex-col gap-2">
                                        {!it.measurementsOnlyOffer && (
                                        <button
                                          onClick={async () => {
                                            let url: string | null = it.pdfUrl || null
                                            if (!url) {
                                              try {
                                                const res = await apiFetch(`/offers/${it.offerId}/export-url`) as { download_url?: string; url?: string; pdf?: string }
                                                url = res?.url || res?.download_url || res?.pdf || null
                                              } catch {
                                                url = null
                                              }
                                            }
                                            if (url) downloadPdfWithRefresh(it.offerId, url, 'offer')
                                          }}
                                          className="btn-sun"
                                        >
                                          <Download className="h-4 w-4" /> Angebot herunterladen (PDF)
                                        </button>
                                        )}
                                        {(it.measurementsOnlyOffer || it.roofMeasurementsPdfUrl || it.pdfUrl) && (
                                        <button
                                          onClick={async () => {
                                            let url: string | null =
                                              it.roofMeasurementsPdfUrl || (it.measurementsOnlyOffer ? it.pdfUrl : null) || null
                                            if (!url) {
                                              try {
                                                const res = await apiFetch(`/offers/${it.offerId}/export-url`) as {
                                                  measurements_only_offer?: boolean
                                                  roofMeasurementsPdf?: { download_url?: string; url?: string }
                                                  download_url?: string
                                                  url?: string
                                                  pdf?: string
                                                }
                                                if (res?.measurements_only_offer === true) {
                                                  url = res?.url || res?.download_url || res?.pdf || null
                                                } else {
                                                  url = res?.roofMeasurementsPdf?.download_url || res?.roofMeasurementsPdf?.url || null
                                                }
                                              } catch {
                                                url = null
                                              }
                                            }
                                            if (url) downloadPdfWithRefresh(it.offerId, url, 'roofMeasurements')
                                          }}
                                          className={it.measurementsOnlyOffer ? 'btn-sun' : 'btn-sun-secondary'}
                                        >
                                          <Download className="h-4 w-4" /> Mengenermittlung herunterladen (PDF)
                                        </button>
                                        )}
                                       </div>
                                     </div>
                                   </div>
                                 </div>
                               )
                             }
                             
                             return null
                         })}
                     </div>
                 </div>
             )
         })}
      </div>
      
      <style jsx global>{`
        :root {
          --color-caramel: #737373;
          --color-sand: #E5E7EB;
          --color-coffee: #1A1A1A;
          --color-ink: #080808;
        }
        
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes pulse-slow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.8; }
        }
        
        @keyframes pop-in { 
          0% { transform: scale(.6); opacity: 0 } 
          100% { transform: scale(1); opacity: 1 } 
        }
        
        @keyframes shimmer {
          from { transform: translate3d(-2%, -1%, 0); opacity: .85; }
          to   { transform: translate3d(2%, 1%, 0);  opacity: 1; }
        }
        
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
        
        .animate-slide-up {
          animation: slide-up 0.4s ease-out;
        }
        
        .animate-pulse-slow {
          animation: pulse-slow 2s ease-in-out infinite;
        }
        
        .animate-pop {
          animation: pop-in .45s cubic-bezier(.21,1.02,.73,1) both;
        }
        
        .congrats-ribbon {
          position: absolute;
          inset: -20%;
          background:
            radial-gradient(ellipse at top left, rgba(229,184,0,.18), transparent 55%),
            radial-gradient(ellipse at bottom right, rgba(229,184,0,.14), transparent 55%);
          pointer-events: none;
          animation: shimmer 3.2s ease-in-out infinite alternate;
        }
        
        .btn-sun {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 1rem;
          background: #E5B800;
          color: white;
          font-weight: 600;
          border-radius: 0.5rem;
          border: none;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 2px 8px rgba(229,184,0,0.35);
        }
        
        .btn-sun:hover {
          background: #E5B800;
          opacity: 0.9;
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(229,184,0,0.45);
        }
        
        .btn-sun:active {
          transform: translateY(0);
          box-shadow: 0 2px 6px rgba(229,184,0,0.35);
        }
        
        .btn-sun-secondary {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 1rem;
          background: rgba(229,184,0,0.15);
          color: #E5B800;
          font-weight: 600;
          border-radius: 0.5rem;
          border: 1px solid rgba(229,184,0,0.45);
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 2px 8px rgba(229,184,0,0.15);
        }
        
        .btn-sun-secondary:hover {
          background: rgba(229,184,0,0.25);
          border-color: rgba(229,184,0,0.6);
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(229,184,0,0.25);
        }
        
        .btn-sun-secondary:active {
          transform: translateY(0);
          box-shadow: 0 2px 6px rgba(229,184,0,0.15);
        }
        
        .rounded-xl2 {
          border-radius: 0.75rem;
        }
        
        .shadow-soft {
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
        }
        
        .text-sand {
          color: var(--color-sand);
        }
        
        .text-sand\\/85 {
          color: rgba(232, 212, 184, 0.85);
        }
        
        .text-sand\\/60 {
          color: rgba(232, 212, 184, 0.6);
        }
      `}</style>
    </div>
  )
}
