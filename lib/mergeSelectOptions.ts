export function mergeSelectOptions(params: {
  tag?: string
  schemaOptions?: string[]
  preisdatenbankOptions?: string[]
  customOptions?: Array<{ label?: string; value?: string }>
  hiddenKeys?: Set<string>
  optionValueToPriceKey?: Record<string, Record<string, string>>
}): string[] {
  const {
    tag,
    schemaOptions = [],
    preisdatenbankOptions = [],
    customOptions = [],
    hiddenKeys = new Set<string>(),
    optionValueToPriceKey = {},
  } = params

  const out: string[] = []
  const seen = new Set<string>()

  const add = (raw: string | undefined | null) => {
    const value = String(raw ?? '').trim()
    if (!value || seen.has(value)) return
    const priceKey = tag ? optionValueToPriceKey[tag]?.[value] : undefined
    if (priceKey && hiddenKeys.has(priceKey)) return
    seen.add(value)
    out.push(value)
  }

  for (const option of preisdatenbankOptions) add(option)
  for (const option of schemaOptions) add(option)
  for (const option of customOptions) add(option?.label || option?.value || '')

  return out
}
