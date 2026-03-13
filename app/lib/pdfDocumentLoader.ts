// PDF Document Loader - încărcat doar pe client la runtime
// Acest modul gestionează încărcarea documentelor PDF fără ca Turbopack să analizeze codul

import { loadPdfJs } from './pdfLoader'

export async function loadPdfDocument(src: string | ArrayBuffer) {
  if (typeof window === 'undefined') {
    throw new Error('PDF documents can only be loaded in browser')
  }
  
  const pdfjs = await loadPdfJs()
  const data = typeof src === 'string' ? { url: src } : { data: src }
  const doc = await pdfjs.getDocument({ ...data, verbosity: 0 }).promise
  return doc
}





