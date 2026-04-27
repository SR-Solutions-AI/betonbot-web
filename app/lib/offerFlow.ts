/**
 * Wizard / offer flows relevant for LiveFeed copy and progress fallback.
 * Dachstuhl = roof-only, Aufstockung = full offer with existing/new floors, Einfamilienhaus = default full-house.
 */
export type OfferFlow = 'einfamilienhaus' | 'dachstuhl' | 'aufstockung' | 'zubau' | 'zubau_aufstockung'

export type OfferFlowMeta = {
  roof_only_offer?: boolean | null
  wizard_package?: string | null
  offer_type_slug?: string | null
  /** Setat la creare pentru Aufstockung; folosit când `wizard_package` lipsește din meta. */
  aufstockung_floor_kinds?: unknown
}

export function inferOfferFlow(meta: OfferFlowMeta | null | undefined): OfferFlow {
  if (!meta) return 'einfamilienhaus'
  if (meta.roof_only_offer === true) return 'dachstuhl'
  const wp = (meta.wizard_package ?? '').toString().toLowerCase()
  if (wp === 'einfamilienhaus' || wp === 'neubau' || wp === 'full_house') return 'einfamilienhaus'
  if (wp === 'dachstuhl') return 'dachstuhl'
  if (wp === 'aufstockung') return 'aufstockung'
  if (wp === 'zubau') return 'zubau'
  if (wp === 'zubau_aufstockung') return 'zubau_aufstockung'
  const slug = (meta.offer_type_slug ?? '').toString().toLowerCase()
  if (slug === 'einfamilienhaus' || slug === 'neubau' || slug === 'full_house') return 'einfamilienhaus'
  if (slug === 'dachstuhl') return 'dachstuhl'
  if (slug === 'aufstockung') return 'aufstockung'
  if (slug === 'zubau') return 'zubau'
  if (slug === 'zubau_aufstockung') return 'zubau_aufstockung'
  const fk = meta.aufstockung_floor_kinds
  if (Array.isArray(fk) && fk.length > 0) return 'aufstockung'
  return 'einfamilienhaus'
}

/**
 * Combină meta ofertă (sursa de adevăr în DB) cu `flow` din eveniment (sessionStorage, default LiveFeed).
 * Dacă evenimentul spune `einfamilienhaus` dar `meta.wizard_package` e `aufstockung`/`zubau`,
 * rămâne fluxul extins — altfel editorul de detecții e Einfamilienhaus.
 */
export function resolveOfferFlowWithExplicit(
  meta: OfferFlowMeta | null | undefined,
  offerTypeSlug: string | null | undefined,
  explicit?: OfferFlow,
): OfferFlow {
  const inferred = inferOfferFlow({ ...meta, offer_type_slug: offerTypeSlug ?? meta?.offer_type_slug })
  if (inferred === 'aufstockung' || inferred === 'zubau' || inferred === 'zubau_aufstockung' || inferred === 'dachstuhl') return inferred
  if (explicit === 'aufstockung' || explicit === 'zubau' || explicit === 'zubau_aufstockung' || explicit === 'dachstuhl') return explicit
  return 'einfamilienhaus'
}
