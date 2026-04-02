/**
 * Etichete tab-uri etaj în editor: afișare fără numerotare pentru Obergeschoss
 * (datele/manifestul pot rămâne „1. Obergeschoss” / „Obergeschoss 2”).
 */
export function displayFloorTabLabelDe(raw: string): string {
  const t = raw.trim()
  if (!t) return t
  const dotted = t.match(/^(\d+)\.\s*Obergeschoss(\s*\/.*)?$/i)
  if (dotted) return dotted[2] ? `Obergeschoss${dotted[2]}` : 'Obergeschoss'
  if (/^Obergeschoss\s+\d+$/i.test(t)) return 'Obergeschoss'
  return t
}
