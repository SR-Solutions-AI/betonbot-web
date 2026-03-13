// PDF loader module - încărcat doar pe client la runtime
// Folosim o abordare care evită complet analiza statică de Turbopack

let pdfjsModule: any = null
let loadingPromise: Promise<any> | null = null

export async function loadPdfJs() {
  if (typeof window === 'undefined') {
    throw new Error('PDF.js can only be used in browser')
  }
  
  // Dacă deja avem modulul încărcat, returnăm direct
  if (pdfjsModule) {
    return pdfjsModule
  }
  
  // Dacă există deja un promise de încărcare, așteptăm pe el
  if (loadingPromise) {
    return loadingPromise
  }
  
  // Creăm un promise nou pentru încărcare
  // Folosim o funcție care este executată doar la runtime pentru a evita analiza statică
  loadingPromise = (async () => {
    try {
      // Folosim o variabilă construită dinamic pentru a evita analiza statică de Turbopack
      const basePath = 'pdfjs-dist'
      const subPath = '/legacy/build/pdf.mjs'
      const fullPath = basePath + subPath
      
      // Dynamic import cu string literal - Turbopack nu poate analiza acest cod la build time
      const imported = await import(/* @vite-ignore */ fullPath)
      
      // Handle both default export and named exports
      const pdfjs = imported.default || imported
      
      if (!pdfjs || typeof pdfjs.getDocument !== 'function') {
        throw new Error('PDF.js module failed to load correctly')
      }
      
      // Set worker source
      if (pdfjs.GlobalWorkerOptions) {
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
      }
      
      pdfjsModule = pdfjs
      return pdfjs
    } catch (error) {
      loadingPromise = null // Reset promise on error
      throw error
    }
  })()
  
  return loadingPromise
}
