/**
 * Modul curat: citește din JSON-urile de formular și prețuri și construiește
 * structura necesară pentru formular dinamic (pași) și pentru Preisdatenbank (secțiuni prețuri).
 * Fără dependențe de formConfig sau cod vechi.
 */

export type FormField =
  | { type: 'text'; name: string; label: string; placeholder?: string }
  | { type: 'textarea'; name: string; label: string; placeholder?: string }
  | { type: 'number'; name: string; label: string; min?: number; max?: number }
  | { type: 'bool'; name: string; label: string }
  | { type: 'select'; name: string; label: string; options: string[]; tag?: string }
  | { type: 'upload'; name: string; label: string; accept?: string; optional?: boolean; multiple?: boolean }
  | { type: 'price'; name: string; label: string; unit: string; default: number }

export type FormStep = {
  key: string
  label: string
  subtitle?: string
  fields: FormField[]
}

export type FormStepPriceSection = {
  title: string
  subtitle?: string
  /** Tag-ul câmpului din formular (ex: system_type) – opțiunile adăugate aici apar ca opțiuni la acel câmp și păstrează același tag. */
  fieldTag?: string
  variables: Array<{ key: string; label: string; unit: string; value: number }>
}

/** Secțiuni explicite pentru pagina Preisdatenbank – folosite ca sursă primară când sunt prezente. */
export type PreisdatenbankSectionDef = {
  stepKey?: string
  title: string
  subtitle: string
  subsections: Array<{
    title: string
    subtitle?: string
    fieldTag?: string
    variables: Array<{ key: string; label: string; unit: string; value: number }>
  }>
}

export type FormStepsSchema = {
  schemaVersion?: string
  tenant?: string
  flow?: string
  steps: Array<{
    key: string
    label: string
    subtitle?: string
    fields: Array<Record<string, unknown>>
    priceSections?: FormStepPriceSection[]
  }>
  /** Definiție explicită a paginii de prețuri; dacă există, este folosită în locul steps[].priceSections. */
  preisdatenbank?: { sections: PreisdatenbankSectionDef[] }
}

export type PriceVariable = { key: string; label: string; unit: string; value: number }

export type PriceStepSchema = {
  stepKey: string
  title: string
  subtitle?: string
  variables: Array<{ key: string; label: string; unit: string; value: number }>
}

export type PricesSchema = {
  schemaVersion?: string
  tenant?: string
  steps: PriceStepSchema[]
}

export type PriceSection = {
  stepKey?: string
  title: string
  subtitle: string
  subsections: Array<{
    title: string
    subtitle?: string
    /** Tag-ul câmpului (ex: system_type) – opțiunile noi se adaugă la acest câmp și păstrează tag-ul. */
    fieldTag?: string
    variables: Array<{ id: string; label: string; unit: string; value: number }>
  }>
}

function ensureString(val: unknown, fallback = ''): string {
  return typeof val === 'string' ? val : fallback
}

function ensureNumber(val: unknown, fallback = 0): number {
  if (typeof val === 'number' && !Number.isNaN(val)) return val
  const n = parseFloat(String(val))
  return Number.isNaN(n) ? fallback : n
}

/**
 * Normalizează un câmp din JSON la tipul FormField.
 */
function normalizeField(f: Record<string, unknown>): FormField | null {
  const type = ensureString(f.type, 'text')
  const name = ensureString(f.name)
  const label = ensureString(f.label, name)
  if (!name) return null

  const base = { name, label }

  switch (type) {
    case 'text':
      return { ...base, type: 'text', placeholder: ensureString(f.placeholder) || undefined }
    case 'textarea':
      return { ...base, type: 'textarea', placeholder: ensureString(f.placeholder) || undefined }
    case 'number':
      return {
        ...base,
        type: 'number',
        min: f.min != null ? ensureNumber(f.min) : undefined,
        max: f.max != null ? ensureNumber(f.max) : undefined,
      }
    case 'bool':
      return { ...base, type: 'bool' }
    case 'select': {
      const options = Array.isArray(f.options)
        ? f.options.map((o) => (typeof o === 'string' ? o : String(o)))
        : []
      const tag = f.tag != null ? ensureString(f.tag) : undefined
      return { ...base, type: 'select', options, tag }
    }
    case 'upload':
      return {
        ...base,
        type: 'upload',
        accept: ensureString(f.accept) || undefined,
        optional: !!f.optional,
        multiple: !!f.multiple,
      }
    case 'price':
      return {
        ...base,
        type: 'price',
        unit: ensureString(f.unit, '€'),
        default: ensureNumber(f.default, 0),
      }
    default:
      return { ...base, type: 'text', placeholder: ensureString(f.placeholder) || undefined }
  }
}

/**
 * Extrage din JSON-ul de pași formular array-ul de FormStep, gata de folosit în wizard.
 */
export function buildFormStepsFromJson(data: unknown): FormStep[] {
  if (!data || typeof data !== 'object') return []
  const schema = data as FormStepsSchema
  const rawSteps = Array.isArray(schema.steps) ? schema.steps : []
  const result: FormStep[] = []

  for (const s of rawSteps) {
    const key = ensureString(s.key)
    if (!key) continue
    const label = ensureString(s.label, key)
    const subtitle = s.subtitle != null ? ensureString(s.subtitle) : undefined
    const rawFields = Array.isArray(s.fields) ? s.fields : []
    const fields: FormField[] = []
    for (const f of rawFields) {
      if (f && typeof f === 'object') {
        const field = normalizeField(f as Record<string, unknown>)
        if (field) fields.push(field)
      }
    }
    result.push({ key, label, subtitle, fields })
  }

  return result
}

/**
 * Extrage din JSON-ul de prețuri (holzbau-prices.json) secțiunile pentru Preisdatenbank.
 * Folosit doar dacă prețurile sunt într-un fișier separat.
 */
export function buildPriceSectionsFromJson(data: unknown): PriceSection[] {
  if (!data || typeof data !== 'object') return []
  const schema = data as PricesSchema
  const rawSteps = Array.isArray(schema.steps) ? schema.steps : []

  return rawSteps.map((step) => {
    const title = ensureString(step.title, step.stepKey)
    const subtitle = ensureString(step.subtitle, '')
    const variables = (step.variables || []).map((v) => ({
      id: ensureString(v.key),
      label: ensureString(v.label, v.key),
      unit: ensureString(v.unit, '€'),
      value: ensureNumber(v.value, 0),
    }))
    return {
      title,
      subtitle,
      subsections: [{ title, variables }],
    }
  })
}

/**
 * Construiește secțiunile pentru Preisdatenbank din holzbau-form-steps.json.
 * Prioritate: dacă există preisdatenbank.sections[], se folosesc acestea (sursă explicită);
 * altfel se construiesc din steps[].priceSections[].
 */
export function buildPriceSectionsFromFormStepsJson(data: unknown): PriceSection[] {
  if (!data || typeof data !== 'object') return []
  const schema = data as FormStepsSchema

  if (Array.isArray(schema.preisdatenbank?.sections) && schema.preisdatenbank.sections.length > 0) {
    return schema.preisdatenbank.sections.map((sec) => ({
      stepKey: sec.stepKey || undefined,
      title: ensureString(sec.title, ''),
      subtitle: ensureString(sec.subtitle, ''),
      subsections: (sec.subsections || []).map((sub) => ({
        title: ensureString(sub.title, ''),
        subtitle: sub.subtitle != null ? ensureString(sub.subtitle) : undefined,
        fieldTag: sub.fieldTag != null ? ensureString(sub.fieldTag) : undefined,
        variables: (sub.variables || []).map((v) => ({
          id: ensureString(v.key, ''),
          label: ensureString(v.label, v.key),
          unit: ensureString(v.unit, '€'),
          value: ensureNumber(v.value, 0),
        })),
      })),
    }))
  }

  const rawSteps = Array.isArray(schema.steps) ? schema.steps : []
  const result: PriceSection[] = []
  for (const step of rawSteps) {
    const priceSections = step.priceSections
    if (!Array.isArray(priceSections) || priceSections.length === 0) continue
    const stepKey = ensureString(step.key, '')
    const stepLabel = ensureString(step.label, stepKey)
    const stepSubtitle = step.subtitle != null ? ensureString(step.subtitle) : ''
    const subsections = priceSections.map((ps) => ({
      title: ensureString(ps.title, stepLabel),
      subtitle: ps.subtitle != null ? ensureString(ps.subtitle) : undefined,
      fieldTag: (ps as { fieldTag?: string }).fieldTag != null ? ensureString((ps as { fieldTag?: string }).fieldTag) : undefined,
      variables: (ps.variables || []).map((v) => ({
        id: ensureString(v.key),
        label: ensureString(v.label, v.key),
        unit: ensureString(v.unit, '€'),
        value: ensureNumber(v.value, 0),
      })),
    }))
    result.push({
      stepKey: stepKey || undefined,
      title: stepLabel,
      subtitle: ensureString(priceSections[0]?.subtitle, stepSubtitle),
      subsections,
    })
  }
  return result
}

/**
 * Construiește pașii formularului și secțiunile de prețuri din același JSON (form steps).
 * Pentru utilizare când formularul și Preisdatenbank folosesc un singur fișier.
 */
export function buildFormFromJson(formStepsData: unknown, pricesData?: unknown): {
  steps: FormStep[]
  priceSections: PriceSection[]
} {
  const steps = buildFormStepsFromJson(formStepsData)
  const priceSections =
    pricesData !== undefined
      ? buildPriceSectionsFromJson(pricesData)
      : buildPriceSectionsFromFormStepsJson(formStepsData)
  return { steps, priceSections }
}
