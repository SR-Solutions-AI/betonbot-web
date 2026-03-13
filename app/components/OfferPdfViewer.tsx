// components/OfferPdfViewer.tsx
"use client";

import { useEffect } from "react";
import { useOfferPdf } from "../hooks/useOfferPdf";

export default function OfferPdfViewer({ offerId, signal }: { offerId: string; signal?: any }) {
  const { url, loading, error, refreshUntilFound } = useOfferPdf(offerId, { trigger: signal });

  useEffect(() => {
    // Daca avem doar semnal generic "run finished", pornește polling
    if (!url) {
      refreshUntilFound();
    }
  }, [url, refreshUntilFound]);

  if (error) return <div className="text-red-600">Eroare: {error}</div>;
  if (loading && !url) return <div>Se pregătește PDF-ul…</div>;
  if (!url) return <div>Nu s-a găsit încă PDF-ul. Reîncearcă în câteva secunde.</div>;

  return (
    <div className="space-y-3">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex rounded-lg px-3 py-2 bg-black text-white"
      >
        Descarcă oferta (PDF)
      </a>

      {/* Opțional, previzualizare inline */}
      <object data={url} type="application/pdf" width="100%" height="800">
        <p>
          Nu pot afișa PDF-ul inline. Poți descărca fișierul de aici:{" "}
          <a className="underline" href={url} target="_blank" rel="noreferrer">
            {url}
          </a>
        </p>
      </object>
    </div>
  );
}
