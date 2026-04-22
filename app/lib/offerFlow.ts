/**
 * Wizard / offer flows relevant for LiveFeed copy and progress fallback.
 * Dachstuhl = roof-only, Aufstockung = full offer with existing/new floors, Neubau = default full-house.
 */
export type OfferFlow = 'neubau' | 'dachstuhl' | 'aufstockung' | 'zubau' | 'zubau_aufstockung'

export type OfferFlowMeta = {
  roof_only_offer?: boolean | null
  wizard_package?: string | null
  offer_type_slug?: string | null
  /** Setat la creare pentru Aufstockung; folosit când `wizard_package` lipsește din meta. */
  aufstockung_floor_kinds?: unknown
}

export function inferOfferFlow(meta: OfferFlowMeta | null | undefined): OfferFlow {
  if (!meta) return 'neubau'
  if (meta.roof_only_offer === true) return 'dachstuhl'
  const wp = (meta.wizard_package ?? '').toString().toLowerCase()
  if (wp === 'dachstuhl') return 'dachstuhl'
  if (wp === 'aufstockung') return 'aufstockung'
  if (wp === 'zubau') return 'zubau'
  if (wp === 'zubau_aufstockung') return 'zubau_aufstockung'
  const slug = (meta.offer_type_slug ?? '').toString().toLowerCase()
  if (slug === 'dachstuhl') return 'dachstuhl'
  if (slug === 'aufstockung') return 'aufstockung'
  if (slug === 'zubau') return 'zubau'
  if (slug === 'zubau_aufstockung') return 'zubau_aufstockung'
  const fk = meta.aufstockung_floor_kinds
  if (Array.isArray(fk) && fk.length > 0) return 'aufstockung'
  return 'neubau'
}

/**
 * Combină meta ofertă (sursa de adevăr în DB) cu `flow` din eveniment (sessionStorage, default LiveFeed).
 * Dacă evenimentul spune `neubau` dar `meta.wizard_package` e `aufstockung`/`zubau`,
 * rămâne fluxul extins — altfel editorul de detecții e Neubau.
 */
export function resolveOfferFlowWithExplicit(
  meta: OfferFlowMeta | null | undefined,
  offerTypeSlug: string | null | undefined,
  explicit?: OfferFlow,
): OfferFlow {
  const inferred = inferOfferFlow({ ...meta, offer_type_slug: offerTypeSlug ?? meta?.offer_type_slug })
  if (inferred === 'aufstockung' || inferred === 'zubau' || inferred === 'zubau_aufstockung' || inferred === 'dachstuhl') return inferred
  if (explicit === 'aufstockung' || explicit === 'zubau' || explicit === 'zubau_aufstockung' || explicit === 'dachstuhl') return explicit
  return 'neubau'
}
