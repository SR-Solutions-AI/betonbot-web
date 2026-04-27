'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { apiFetch } from '../lib/supabaseClient'
import HistoryList from '../components/HistoryList'
import LiveFeed from '../components/LiveFeed'
import StepWizard from '../components/StepWizard'
import type { OfferFlow } from '../lib/offerFlow'
import AdminDashboard from '../components/AdminDashboard'

export default function Home() {
  const [ready, setReady] = useState(false)
  const [isOrgAdmin, setIsOrgAdmin] = useState(false)
  const [isSiteAdmin, setIsSiteAdmin] = useState(false)
  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.error('❌ [DASHBOARD] Eroare la verificarea sesiunii:', error)
        window.location.href = '/login'
        return
      }
      
      if (!data.session) {
        console.log('⚠️ [DASHBOARD] Nu există sesiune, redirecționare la login')
        window.location.href = '/login'
      } else {
        console.log('✅ [DASHBOARD] Sesiune validă:', { userId: data.session.user.id })
        setReady(true)
      }
    })
  }, [])
  useEffect(() => {
    // IMPORTANT: keep hooks order stable across renders.
    // Only run once we're authenticated/ready.
    if (!ready) return
    let mounted = true
    ;(async () => {
      try {
        const me = await apiFetch('/me')
        const role = (me?.user?.role ?? null) as string | null
        if (mounted) {
          setIsOrgAdmin(role === 'org_leader' || (me?.user as any)?.can_manage_org === true)
          setIsSiteAdmin(role === 'admin')
        }
      } catch {
        if (mounted) {
          setIsOrgAdmin(false)
          setIsSiteAdmin(false)
        }
      }
    })()
    return () => { mounted = false }
  }, [ready])

  // Restore step wizard + live feed state after refresh or when returning to dashboard (persisted in sessionStorage)
  useEffect(() => {
    if (!ready || isSiteAdmin) return
    try {
      const raw = typeof window !== 'undefined' ? sessionStorage.getItem('holzbot_dashboard_offer') : null
      if (!raw) return
      const data = JSON.parse(raw) as {
        offerId?: string
        runId?: string | null
        isComputing?: boolean
        flow?: OfferFlow | 'neubau'
      }
      const offerId = data?.offerId
      if (!offerId) return
      const runId = data?.runId ?? null
      const isComputing = data?.isComputing === true
      const flow =
        data?.flow === 'dachstuhl' || data?.flow === 'einfamilienhaus' || data?.flow === 'neubau' || data?.flow === 'aufstockung' || data?.flow === 'zubau' || data?.flow === 'zubau_aufstockung'
          ? (data.flow === 'neubau' ? 'einfamilienhaus' : data.flow)
          : undefined
      const timer = window.setTimeout(() => {
        if (isComputing && runId) {
          window.dispatchEvent(new CustomEvent('offer:compute-started', { detail: { offerId, runId, ...(flow ? { flow } : {}) } }))
        } else {
          window.dispatchEvent(new CustomEvent('offer:selected', { detail: { offerId } }))
        }
      }, 150)
      return () => clearTimeout(timer)
    } catch {}
  }, [ready, isSiteAdmin])

  if (!ready) return null

  return (
    <>
      {isSiteAdmin ? (
        <AdminDashboard />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr_440px] gap-4 h-full min-h-0">
          {/* Stânga: proiecte */}
          <aside className="bg-panel/80 border border-black/40 rounded-xl2 p-3 shadow-soft flex flex-col min-w-0 h-full min-h-0">
            <HistoryList variant="wood" />
          </aside>

          {/* Mijloc: StepWizard */}
          <main className="bg-wizard-area border border-black/40 rounded-xl2 p-3 shadow-soft min-w-0 h-full min-h-0 overflow-hidden">
            <StepWizard />
          </main>
          {/* Dreapta: LiveFeed */}
          <div className="min-w-0 h-full min-h-0 overflow-hidden">
            <LiveFeed />
          </div>
        </div>
      )}
    </>
  )
}
