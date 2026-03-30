/**
 * Wizard / offer flows relevant for LiveFeed copy and progress fallback.
 * Dachstuhl = roof-only (Dachstuhl-Angebot), Neubau = full-house and related (Mengen, etc.).
 */
export type OfferFlow = 'neubau' | 'dachstuhl'

export type OfferFlowMeta = {
  roof_only_offer?: boolean | null
  wizard_package?: string | null
  offer_type_slug?: string | null
}

export function inferOfferFlow(meta: OfferFlowMeta | null | undefined): OfferFlow {
  if (!meta) return 'neubau'
  if (meta.roof_only_offer === true) return 'dachstuhl'
  const wp = (meta.wizard_package ?? '').toString().toLowerCase()
  if (wp === 'dachstuhl') return 'dachstuhl'
  const slug = (meta.offer_type_slug ?? '').toString().toLowerCase()
  if (slug === 'dachstuhl') return 'dachstuhl'
  return 'neubau'
}
