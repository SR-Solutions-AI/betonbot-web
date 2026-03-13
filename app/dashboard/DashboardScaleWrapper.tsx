'use client'

import { useState, useEffect } from 'react'

const REFERENCE_WIDTH = 1600
const MIN_SCALE = 0.28

function getScale(): number {
  if (typeof window === 'undefined') return 1
  const w = window.innerWidth
  if (w >= REFERENCE_WIDTH) return 1
  const linear = w / REFERENCE_WIDTH
  const scale = Math.pow(linear, 0.85)
  return Math.max(MIN_SCALE, Math.min(1, scale))
}

export default function DashboardScaleWrapper({ children }: { children: React.ReactNode }) {
  const [scale, setScale] = useState(1)

  useEffect(() => {
    setScale(getScale())
    const onResize = () => setScale(getScale())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const effectiveScale = Math.max(MIN_SCALE, Math.min(1, scale))

  return (
    <div
      className="w-full overflow-hidden relative flex flex-col"
      style={{
        height: '100vh',
        minHeight: '100dvh',
      }}
    >
      <div
        className="absolute top-0 left-0 flex flex-col origin-top-left"
        style={{
          width: effectiveScale < 1 ? `${100 / effectiveScale}%` : '100%',
          height: effectiveScale < 1 ? `${100 / effectiveScale}%` : '100%',
          transform: `scale(${effectiveScale})`,
          transformOrigin: 'top left',
        }}
      >
        {children}
      </div>
    </div>
  )
}
