// lib/offer-pdf.ts
export type OfferFile = {
  id: string;
  storage_path: string;
  meta?: { mime?: string; filename?: string | null } | null;
  created_at?: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL!;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!; // ex: https://xxxx.supabase.co
const BUCKET = "house-plans";

// Construieste URL public direct din storage_path (bucket public)
export function storagePublicUrl(storagePath: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encodeURI(storagePath)}`;
}

// Cere lista de fisiere din backend si returneaza primul PDF (cel mai nou)
export async function getFirstPdfUrlForOffer(offerId: string): Promise<string | null> {
  const needsApiPrefix = API_URL.includes('api.holzbot.com')
  const apiPath = needsApiPrefix ? '/api/file' : '/file'
  const res = await fetch(`${API_URL}${apiPath}?offerId=${offerId}`, { cache: "no-store" });
  if (!res.ok) return null;

  const payload = await res.json();
  const files: OfferFile[] = payload?.data ?? payload ?? [];

  if (!Array.isArray(files) || files.length === 0) return null;

  // filtreaza PDF; accepta fie mime, fie extensie .pdf
  const pdfs = files
    .filter(f =>
      (f.meta?.mime?.toLowerCase() === "application/pdf") ||
      (f.meta?.filename?.toLowerCase?.().endsWith(".pdf"))
    )
    .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());

  if (pdfs.length === 0) return null;

  // daca backend-ul nu iti da deja public_url, il formam din storage_path
  return storagePublicUrl(pdfs[0].storage_path);
}
