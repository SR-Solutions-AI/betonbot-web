'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadPdfDocument } from '../lib/pdfDocumentLoader'

type Props = {
  /** URL sau ArrayBuffer pentru PDF */
  src: string | ArrayBuffer | null
  /** înălțime maximă la care vrem scroll (optional) */
  maxHeight?: number | string
  className?: string
  /** densitatea de pixeli; 1–2 recomandat */
  pixelRatio?: number
}

/** Canvas pentru o singură pagină (lazy render cu IntersectionObserver) */
function PageCanvas({
  pdf,
  pageNumber,
  containerWidth,
  pixelRatio,
}: {
  pdf: any
  pageNumber: number
  containerWidth: number
  pixelRatio: number
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const holderRef = useRef<HTMLDivElement | null>(null)
  const renderTaskRef = useRef<any | null>(null)
  const mountedRef = useRef(true)
  const isRenderingRef = useRef(false) // Flag pentru a preveni rendering-ul dublu
  const [rendered, setRendered] = useState(false)

  const renderPage = useCallback(async () => {
    // Lock atomic - verificăm și setăm într-un singur pas pentru a preveni race conditions
    if (isRenderingRef.current) {
      console.log(`PageCanvas ${pageNumber}: Render already in progress, skipping`)
      return
    }
    
    // Anulează un render anterior (dacă există) ÎNAINTE de a seta flag-ul
    if (renderTaskRef.current) {
      try { 
        renderTaskRef.current.cancel() 
      } catch (e) {
        // Ignorăm erorile de anulare
      }
      renderTaskRef.current = null
    }
    
    if (!canvasRef.current || !mountedRef.current) {
      console.log(`PageCanvas ${pageNumber}: Cannot render - no canvas or not mounted`)
      return
    }
    
    // Verifică dacă PDF-ul este încă valid (nu a fost distrus)
    if (!pdf || pdf.destroyed) {
      console.log(`PageCanvas ${pageNumber}: Cannot render - PDF invalid or destroyed`)
      return
    }
    
    if (containerWidth <= 0) {
      console.log(`PageCanvas ${pageNumber}: Cannot render - containerWidth is ${containerWidth}`)
      return
    }

    // Setează flag-ul IMEDIAT înainte de a începe operațiile async
    // Astfel, dacă un al doilea apel vine înainte de await, va vedea flag-ul setat
    isRenderingRef.current = true
    
    // Verifică din nou după setarea flag-ului (pentru cazul în care s-a schimbat ceva)
    if (!canvasRef.current || !mountedRef.current || !pdf || pdf.destroyed) {
      isRenderingRef.current = false
      return
    }

    let page
    try {
      page = await pdf.getPage(pageNumber)
      // Verifică din nou după await - dacă s-a schimbat ceva, anulează
      if (!mountedRef.current || !pdf || pdf.destroyed || !canvasRef.current) {
        isRenderingRef.current = false
        return
      }
    } catch (e: any) {
      // Dacă documentul a fost distrus, nu mai continuăm
      isRenderingRef.current = false
      if (e?.message?.includes('destroyed') || e?.message?.includes('Transport destroyed')) {
        return
      }
      throw e
    }

    // 1) viewport în **CSS px** (fără DPR)
    const v1 = page.getViewport({ scale: 1 })
    const scaleCss = containerWidth / v1.width
    const viewport = page.getViewport({ scale: scaleCss })

    const canvas = canvasRef.current
    // Verifică din nou că canvas-ul este încă disponibil
    if (!canvas || !mountedRef.current) {
      isRenderingRef.current = false
      return
    }
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) {
      isRenderingRef.current = false
      return
    }

    // 2) dimensiuni reale ale canvasului (device pixels)
    const dpr = Math.max(1, pixelRatio || 1)
    const outputScale = dpr
    canvas.width = Math.floor(viewport.width * outputScale)
    canvas.height = Math.floor(viewport.height * outputScale)

    // 3) dimensiuni CSS (în px logici) — fără round ca să nu introducem offset
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`
    canvas.style.display = 'block'

    // 4) reset transform + clear ca să nu „alunece" conținutul
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // 5) randare cu transform pentru DPR (recomandat de pdf.js)
    // Folosim transform array pentru PDF.js - format: [a, b, c, d, e, f]
    // Pentru scale: [scaleX, 0, 0, scaleY, 0, 0]
    const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined
    
    console.log(`PageCanvas ${pageNumber}: Rendering - canvas: ${canvas.width}x${canvas.height}, CSS: ${canvas.style.width}x${canvas.style.height}, viewport: ${viewport.width.toFixed(1)}x${viewport.height.toFixed(1)}, scale: ${outputScale.toFixed(2)}`)
    
    const renderOptions: any = {
      canvasContext: ctx,
      viewport,
    }
    
    // Adăugăm transform doar dacă este necesar
    if (transform) {
      renderOptions.transform = transform
    }
    
    const task = page.render(renderOptions)
    
    renderTaskRef.current = task
    try {
      await task.promise
      // Verifică din nou după render
      if (mountedRef.current) {
        console.log(`PageCanvas: Successfully rendered page ${pageNumber}`)
        setRendered(true)
      }
    } catch (e: any) {
      if (e?.name !== 'RenderingCancelledException' && e?.message !== 'Transport destroyed') {
        console.error(`PageCanvas: Render error for page ${pageNumber}:`, e)
      }
    } finally {
      if (renderTaskRef.current === task) renderTaskRef.current = null
      isRenderingRef.current = false // Reset flag după ce render-ul s-a terminat
    }
  }, [containerWidth, pageNumber, pdf, pixelRatio])

  // Cleanup când componenta se demontează
  useEffect(() => {
    mountedRef.current = true
    isRenderingRef.current = false
    return () => {
      mountedRef.current = false
      isRenderingRef.current = false
      // Anulează task-ul de render dacă există
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel() } catch {}
        renderTaskRef.current = null
      }
    }
  }, [])

  // Efect pentru a declanșa rendering-ul când canvas-ul este montat și PDF-ul este disponibil
  useEffect(() => {
    if (!pdf || pdf.destroyed || rendered || isRenderingRef.current) {
      return
    }
    
    // Funcție pentru a verifica și declanșa rendering-ul
    const attemptRender = () => {
      // Verifică dacă deja se renderizează
      if (isRenderingRef.current) {
        return false
      }
      
      if (!canvasRef.current || !mountedRef.current) {
        return false
      }
      
      if (!holderRef.current) {
        return false
      }
      
      console.log(`PageCanvas ${pageNumber}: All conditions met, starting render`)
      renderPage()
      return true
    }
    
    // Încearcă imediat dacă canvas-ul este gata
    if (attemptRender()) {
      return
    }
    
    // Dacă nu a reușit, retry după un mic delay (doar unul)
    let timeoutId: NodeJS.Timeout | null = null
    
    const scheduleRetry = () => {
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        if (!rendered && pdf && !pdf.destroyed && !isRenderingRef.current && mountedRef.current) {
          attemptRender()
        }
      }, 100)
    }
    
    scheduleRetry()
    
    // Folosim IntersectionObserver pentru când devine vizibil
    if (!holderRef.current) {
      return () => {
        if (timeoutId) clearTimeout(timeoutId)
      }
    }
    
    const el = holderRef.current
    const io = new IntersectionObserver(
      (entries) => {
        // Verifică dacă deja se renderizează sau dacă este deja renderizat
        if (entries[0].isIntersecting && !rendered && !isRenderingRef.current && canvasRef.current && mountedRef.current) {
          console.log(`PageCanvas ${pageNumber}: IntersectionObserver triggered render`)
          renderPage()
          io.disconnect()
        }
      },
      { rootMargin: '200px 0px' }
    )
    io.observe(el)
    
    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      io.disconnect()
    }
  }, [pdf, pageNumber, renderPage, rendered])

  // Re-render când containerWidth se schimbă (dar nu când rendered devine true)
  useEffect(() => {
    if (rendered && containerWidth > 0 && !isRenderingRef.current) {
      // Re-render doar când lățimea se schimbă, nu când rendered devine true
      const t = setTimeout(() => {
        if (mountedRef.current && !isRenderingRef.current) {
          renderPage()
        }
      }, 100)
      return () => clearTimeout(t)
    }
  }, [containerWidth, renderPage, rendered]) // Removed 'rendered' to avoid infinite loop

  return (
    <div
      ref={holderRef}
      className="rounded-2xl overflow-hidden bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-black/10"
      style={{ width: containerWidth, margin: '0 auto' }}
    >
      <canvas ref={canvasRef} />
    </div>
  )
}


export default function SimplePdfViewer({
  src,
  maxHeight = '75vh',
  className = '',
  pixelRatio = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1.5 : 1.5),
}: Props) {
  // Guard: nu executăm nimic pe server
  if (typeof window === 'undefined') {
    return <div className="py-10 text-center text-neutral-200">PDF wird generiert…</div>
  }

  // If maxHeight is "100%" or "none", use full height without maxHeight constraint
  const useFullHeight = maxHeight === '100%' || maxHeight === 'none'
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [pdf, setPdf] = useState<any | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [containerWidth, setContainerWidth] = useState(820) // fallback
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [isWideScreen, setIsWideScreen] = useState(false)

  useEffect(() => {
    if (!src) { setPdf(null); setNumPages(0); return }
    let canceled = false
    setLoading(true); setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let currentDoc: any = null

    // Folosim o funcție async separată pentru a evita analiza statică de Turbopack
    const loadDocument = async () => {
      try {
        console.log('SimplePdfViewer: Loading PDF from:', typeof src === 'string' ? src.substring(0, 50) + '...' : 'ArrayBuffer')
        // Folosim modulul pdfDocumentLoader care este încărcat doar pe client
        const doc = await loadPdfDocument(src)
        if (canceled) { 
          try { await doc.destroy() } catch {} 
          return 
        }
        currentDoc = doc
        if (!canceled) {
          console.log(`SimplePdfViewer: PDF loaded successfully, ${doc.numPages} pages`)
          setPdf(doc)
          setNumPages(doc.numPages)
        }
      } catch (e: any) {
        if (!canceled) {
          console.error('SimplePdfViewer: PDF load error:', e)
          setError(e?.message || 'Nu am putut încărca PDF-ul.')
        }
      } finally {
        if (!canceled) setLoading(false)
      }
    }
    
    loadDocument()

    return () => {
      canceled = true
      // Distruge documentul curent dacă există
      if (currentDoc && !currentDoc.destroyed) {
        try { currentDoc.destroy() } catch {}
      }
    }
  }, [src])  // Removed pdf from dependencies to avoid re-running


  // măsurăm lățimea disponibilă pentru pagină (și refacem la resize)
  useEffect(() => {
    function measure() {
      const w = wrapRef.current?.clientWidth
      const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 0
      // Pe ecrane foarte late (>= 2200px) afișăm side by side, altfel una sub alta
      const wide = screenWidth >= 2200
      setIsWideScreen(wide)
      
      if (w) {
        // Pe ecrane late, folosim mai mult din lățime (până la 1600px în loc de 1200px)
        // Pe ecrane mici, minim 280px
        const maxWidth = screenWidth >= 1400 ? 1600 : 1200
        // Pe ecrane late, calculăm lățimea pentru 2 coloane
        const availableWidth = wide ? w : w
        setContainerWidth(Math.max(280, Math.min(maxWidth, availableWidth)))
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const pages = useMemo(() => {
    if (!pdf || !numPages) return []
    return new Array(numPages).fill(0).map((_, i) => i + 1)
  }, [pdf, numPages])

  return (
    <div
      ref={wrapRef}
      className={[
        'overflow-auto pretty-scroll',
        className,
        ].join(' ')}
      style={useFullHeight ? { height: '100%', paddingTop: '0.75rem', paddingBottom: '0.75rem' } : { maxHeight, paddingTop: '0.75rem', paddingBottom: '0.75rem' }}
    >
      {loading && (
        <div className="py-10 text-center text-neutral-200">PDF wird generiert…</div>
      )}
      {error && (
        <div className="py-6 px-4 bg-black/20 rounded-lg border border-red-400/40 text-red-200">
          {error}
        </div>
      )}
      {pdf && (
        <div className={isWideScreen ? 'grid grid-cols-2 gap-6' : 'flex flex-col'}>
          {pages.map((p) => (
            <div key={p} className={!isWideScreen && p > 1 ? 'mt-6' : ''}>
              <PageCanvas
                pdf={pdf}
                pageNumber={p}
                containerWidth={isWideScreen ? Math.floor((containerWidth - 24) / 2) : containerWidth}
                pixelRatio={pixelRatio}
              />
            </div>
          ))}
        </div>
      )}
      {!loading && !error && !pdf && (
        <div className="py-8 text-center text-neutral-300">Es gab ein Problem beim erstellen des PDFs...</div>
      )}
    </div>
  )
}
