// app/lib/useOfferTitle.ts
'use client';

import { useRef, useState } from 'react';

function useDebounced(ms = 400) {
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (fn: () => void) => {
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(fn, ms);
  };
}

export function useOfferTitle(initialId?: string | null) {
  const [offerId, setOfferId] = useState<string | null>(initialId ?? null);
  const debounced = useDebounced(400);

  async function createOrUpdateTitle(title: string) {
    if (!title?.trim()) return;
    if (!offerId) {
      const r = await fetch('/api/offers', { method: 'POST', body: JSON.stringify({ title }) });
      const j = await r.json();
      setOfferId(j.id);
    } else {
      await fetch(`/api/offers/${offerId}`, { method: 'PATCH', body: JSON.stringify({ title }) });
    }
  }

  function onTitleChange(title: string) {
    debounced(() => createOrUpdateTitle(title));
  }

  return { offerId, onTitleChange };
}
