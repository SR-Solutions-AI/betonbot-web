'use client'

import { useEffect, useRef, useState } from 'react'
import { loadPdfJs } from '../lib/pdfLoader'

type Props = {
  src: string | null
  width: number
  height: number
  className?: string
}

export default function PdfThumbnail({ src, width, height, className = '' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!src || !canvasRef.current) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    ;(async () => {
      try {
        const pdfjs = await loadPdfJs()
        const doc = await pdfjs.getDocument({ url: src, verbosity: 0 }).promise
        if (cancelled) {
          try { await doc.destroy() } catch {}
          return
        }

        const page = await doc.getPage(1)
        const viewport = page.getViewport({ scale: 1 })
        
        // Calculate scale to fit in thumbnail
        const scaleX = width / viewport.width
        const scaleY = height / viewport.height
        const scale = Math.min(scaleX, scaleY, 1) // Don't scale up
        
        const scaledViewport = page.getViewport({ scale })
        const canvas = canvasRef.current
        if (!canvas || cancelled) {
          try { await doc.destroy() } catch {}
          return
        }

        const ctx = canvas.getContext('2d', { alpha: false })
        if (!ctx) {
          try { await doc.destroy() } catch {}
          return
        }

        canvas.width = scaledViewport.width
        canvas.height = scaledViewport.height
        canvas.style.width = `${width}px`
        canvas.style.height = `${height}px`

        await page.render({
          canvasContext: ctx,
          viewport: scaledViewport,
        }).promise

        try { await doc.destroy() } catch {}
        if (!cancelled) {
          setLoading(false)
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || 'Failed to load PDF')
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [src, width, height])

  if (!src) {
    return (
      <div className={`flex items-center justify-center bg-[#1a120e] ${className}`} style={{ width, height }}>
        <span className="text-[9px] text-white/30">Kein PDF</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-[#1a120e] ${className}`} style={{ width, height }}>
        <span className="text-[9px] text-white/30">Fehler</span>
      </div>
    )
  }

  return (
    <div className={`relative ${className}`} style={{ width, height }}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#1a120e]">
          <span className="text-[9px] text-white/40">Lädt...</span>
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="w-full h-full object-contain bg-white"
        style={{ display: loading ? 'none' : 'block' }}
      />
    </div>
  )
}






