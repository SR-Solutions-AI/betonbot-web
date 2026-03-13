// hooks/useOfferPdf.ts
import { useCallback, useEffect, useRef, useState } from "react";
import { getFirstPdfUrlForOffer } from "../lib/ offer-pdf";

type Options = {
  // daca ai semnal extern, da-i trigger=true cand il primesti
  trigger?: any;
  // cat timp sa incerce polling (ms)
  timeoutMs?: number;
};

export function useOfferPdf(offerId: string, opts: Options = {}) {
  const { trigger, timeoutMs = 45_000 } = opts;
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchOnce = useCallback(async () => {
    try {
      setErr(null);
      const u = await getFirstPdfUrlForOffer(offerId);
      if (u) setUrl(u);
      return !!u;
    } catch (e: any) {
      setErr(e?.message ?? "Eroare la citirea PDF-ului");
      return false;
    }
  }, [offerId]);

  // apel direct cand vine semnalul "pdf ready"
  useEffect(() => {
    if (!trigger) return;
    fetchOnce();
  }, [trigger, fetchOnce]);

  // fallback: polling pana apare
  const refreshUntilFound = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const start = Date.now();
    let delay = 1200;

    while (Date.now() - start < timeoutMs) {
      const found = await fetchOnce();
      if (found) break;
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 5000);
    }
    setLoading(false);
  }, [fetchOnce, timeoutMs]);

  return { url, loading, error, refreshUntilFound, refetch: fetchOnce };
}
