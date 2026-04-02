/** Display-only: same numeric values, EUR vs CHF label (no FX). */

export type DisplayCurrency = 'EUR' | 'CHF'

export function normalizeDisplayCurrency(v: unknown): DisplayCurrency {
  return v === 'CHF' ? 'CHF' : 'EUR'
}

export function adaptPriceUnit(unit: string, code: DisplayCurrency): string {
  if (!unit || code === 'EUR') return unit || '€'
  return String(unit).replace(/€/g, 'CHF')
}

/** Replace € with CHF in UI copy (subtitles, etc.). */
export function adaptCurrencyCopy(text: string, code: DisplayCurrency): string {
  if (code === 'EUR') return text
  return text
    .replace(/€\/m²/g, 'CHF/m²')
    .replace(/€\/m\b/g, 'CHF/m')
    .replace(/€/g, 'CHF')
}
