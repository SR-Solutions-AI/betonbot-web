'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogOut, User, Database, Settings, ChevronDown, Building2, FileText, Home, Coins } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { apiFetch } from '../lib/supabaseClient'
import { useCallback, useEffect, useState, useRef } from 'react'

// --- CONFIG ---
const LOGO_IMAGE_URL = '/logo.png'

export default function DashboardHeader() {
  const pathname = usePathname()
  const isPreisdatenbank = pathname?.includes('/preisdatenbank')
  const isSettingsArea = pathname?.includes('/settings') || isPreisdatenbank
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [me, setMe] = useState<{
    user?: { email?: string | null; role?: string | null; can_manage_org?: boolean }
    tenant?: { id?: string; config?: any } | null
    tokens?: { display?: string; unlimited?: boolean } | null
  } | null>(null)
  const [wrongApp, setWrongApp] = useState<{ forApp: string; loginUrl: string } | null>(null)
  const mountedRef = useRef(true)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const role = (me?.user as any)?.role as string | undefined
  const canSeeOrgSettings =
    role === 'org_leader' || role === 'admin' || (me?.user as any)?.can_manage_org === true
  const isSiteAdmin = role === 'admin'
  const tokenDisplay = me?.tokens?.display
  const hasTenant = Boolean(me?.tenant?.id)
  const canSeeOfferCustomization = !isSiteAdmin
  const canSeePreisdatenbank = !isSiteAdmin

  const handleLogout = async () => {
    const clearClientAuthState = () => {
      try {
        sessionStorage.removeItem('holzbot_dashboard_offer')
      } catch {}
      try {
        sessionStorage.removeItem('holzbot_dashboard_running')
      } catch {}
      try {
        const keys: string[] = []
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key && key.startsWith('sb-')) keys.push(key)
        }
        for (const key of keys) localStorage.removeItem(key)
      } catch {}
    }

    try {
      await supabase.auth.signOut({ scope: 'global' })
    } catch (e) {
      console.error('Eroare la sign out:', e)
    } finally {
      clearClientAuthState()
      window.location.href = '/'
    }
  }

  const fetchMe = useCallback(async () => {
    try {
      const data = await apiFetch('/me')
      if (!mountedRef.current) return
      // Doar tenant-ul betonbau poate folosi Betonbot; alții sunt pentru Holzbot → sign out + mesaj (fără redirect)
      if (data?.tenant?.slug && data.tenant.slug !== 'betonbau') {
        await supabase.auth.signOut()
        setMe(null)
        setWrongApp({ forApp: 'Holzbot', loginUrl: process.env.NEXT_PUBLIC_HOLZBOT_ORIGIN ? `${process.env.NEXT_PUBLIC_HOLZBOT_ORIGIN}/login` : 'http://localhost:3000/login' })
        return
      }
      setWrongApp(null)
      setMe(data)
    } catch {
      if (mountedRef.current) setMe(null)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void fetchMe()
    const onTenantConfigSaved = () => void fetchMe()
    const onTokensRefresh = () => void fetchMe()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void fetchMe()
    }
    window.addEventListener('tenant-config:saved', onTenantConfigSaved)
    window.addEventListener('tokens:refresh', onTokensRefresh)
    document.addEventListener('visibilitychange', onVisibility)
    const intervalId = window.setInterval(() => void fetchMe(), 30_000)
    return () => {
      mountedRef.current = false
      window.removeEventListener('tenant-config:saved', onTenantConfigSaved)
      window.removeEventListener('tokens:refresh', onTokensRefresh)
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(intervalId)
    }
  }, [fetchMe])

  useEffect(() => {
    void fetchMe()
  }, [pathname, fetchMe])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSettingsOpen(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  const email = me?.user?.email || null
  const tenantConfig = (me?.tenant as any)?.config
  const tenantLogoUrlRaw =
    (tenantConfig?.logo_url ?? tenantConfig?.logoUrl) as string | undefined
  const tenantLogoUrl =
    (tenantLogoUrlRaw && tenantLogoUrlRaw.startsWith('http') ? tenantLogoUrlRaw : undefined)

  if (wrongApp) {
    return (
      <header className="h-[4.5rem] flex items-center justify-center bg-coffee-850 border-b border-black/50 shrink-0 z-40">
        <div className="text-center px-4">
          <p className="text-sand/90 text-sm">
            Dieses Konto ist für {wrongApp.forApp}. Bitte melden Sie sich dort an:
          </p>
          <a href={wrongApp.loginUrl} className="text-[#E5B800] font-medium underline mt-1 inline-block">
            {wrongApp.loginUrl}
          </a>
        </div>
      </header>
    )
  }

  return (
    <header className="h-[4.5rem] flex items-center bg-coffee-850 border-b border-black/50 shadow-soft relative shrink-0 z-40">
        <div
          className="absolute inset-0 pointer-events-none opacity-30"
          style={{ background: 'radial-gradient(40% 100% at 0% 0%, rgba(229,184,0,.35), transparent 60%)' }}
        />
        
        {/* Flex: logo left, title viewport-centered, actions with looser spacing */}
        <div className="relative z-10 flex w-full min-w-0 items-center gap-4 px-3 sm:px-8">
          {/* Left: tenant logo */}
          <div className="flex h-[50px] shrink-0 items-center gap-3 sm:h-[60px] min-w-0 max-w-[min(220px,34vw)]">
            {tenantLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={tenantLogoUrl}
                alt="Logo"
                className="h-[50px] sm:h-[60px] w-auto max-h-full max-w-full object-contain object-left"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            ) : null}
          </div>

          {/* Center: Betonbot — true viewport center */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={LOGO_IMAGE_URL}
              alt="Betonbot"
              className="h-[50px] sm:h-[60px] w-auto object-contain"
              onError={(e) => (e.currentTarget.style.display = 'none')}
            />
          </div>

          {/* Right: email + Projekte-Kontingent + settings + logout */}
          <div className="relative z-10 ml-auto flex min-w-0 items-center gap-3 sm:gap-5 pr-1 sm:pr-2">
            <div className="flex min-w-0 flex-col items-end gap-1 text-[11px] sm:text-sm sm:gap-1.5">
              <div className="flex max-w-[11rem] min-w-0 items-center gap-2 text-sand/70 sm:max-w-[16rem]">
                <User size={16} className="shrink-0" />
                <span className="min-w-0 truncate text-right" title={email ?? undefined}>
                  {email || ''}
                </span>
              </div>
              {hasTenant && tokenDisplay ? (
                <div
                  className="flex shrink-0 items-center gap-1.5 whitespace-nowrap font-normal text-white"
                  title="Projekte: noch verfügbar / Monatslimit (Kalender Berlin)"
                >
                  <Coins size={16} className="shrink-0 opacity-90" aria-hidden />
                  <span className="tabular-nums">{tokenDisplay}</span>
                  <span>Projekte</span>
                </div>
              ) : null}
            </div>
            <div className="relative shrink-0" ref={dropdownRef}>
              <>
                <button
                  type="button"
                  onClick={() => setSettingsOpen((o) => !o)}
                  className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2.5 rounded-xl font-bold text-[#ffffff] shadow-lg transition-all duration-200 ease-out bg-gradient-to-b from-[#CC9900] to-[#E5B800] hover:brightness-110 hover:-translate-y-[1px] hover:shadow-[0_4px_14px_rgba(229,184,0,0.35)] active:translate-y-[1px] active:scale-95"
                  title="Einstellungen"
                >
                  <Settings size={18} className="shrink-0" />
                  <span className="hidden sm:inline">Einstellungen</span>
                  <ChevronDown size={16} className={`shrink-0 transition-transform ${settingsOpen ? 'rotate-180' : ''}`} />
                </button>
                {settingsOpen && (
                  <div className="absolute right-0 top-full mt-1 py-1 w-72 rounded-xl bg-coffee-850 border border-white/20 shadow-xl z-50">
                    <Link
                      href="/dashboard"
                      onClick={() => setSettingsOpen(false)}
                      className="flex items-start gap-2 px-4 py-2.5 text-left text-white hover:bg-white/10 rounded-lg mx-1 whitespace-normal leading-snug"
                    >
                      <Home size={18} className="shrink-0 text-sand/80" />
                      <span className="leading-snug">Angebot generieren</span>
                    </Link>
                    {canSeeOrgSettings && (
                      <Link
                        href="/dashboard/settings/organisation"
                        onClick={() => setSettingsOpen(false)}
                        className="flex items-start gap-2 px-4 py-2.5 text-left text-white hover:bg-white/10 rounded-lg mx-1 whitespace-normal leading-snug"
                      >
                        <Building2 size={18} className="shrink-0 text-sand/80" />
                        <span className="leading-snug">Organisationseinstellungen</span>
                      </Link>
                    )}
                    {canSeeOfferCustomization && (
                      <Link
                        href="/dashboard/settings/angebotsanpassung"
                        onClick={() => setSettingsOpen(false)}
                        className="flex items-start gap-2 px-4 py-2.5 text-left text-white hover:bg-white/10 rounded-lg mx-1 whitespace-normal leading-snug"
                      >
                        <FileText size={18} className="shrink-0 text-sand/80" />
                        <span className="leading-snug">Angebotsanpassung</span>
                      </Link>
                    )}
                    {canSeePreisdatenbank && (
                      <Link
                        href="/dashboard/preisdatenbank"
                        onClick={() => setSettingsOpen(false)}
                        className="flex items-start gap-2 px-4 py-2.5 text-left text-white hover:bg-white/10 rounded-lg mx-1 whitespace-normal leading-snug"
                      >
                        <Database size={18} className="shrink-0 text-sand/80" />
                        <span className="leading-snug">Preisdatenbank</span>
                      </Link>
                    )}
                  </div>
                )}
              </>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-normal text-[#ffffff] shadow-md transition-all duration-200 ease-out border border-white/30 bg-coffee-850 hover:bg-coffee-800 hover:border-[#E5B800]/50"
              title="Log Out"
            >
              <span className="hidden sm:inline">Log Out</span>
              <LogOut size={18} />
            </button>
          </div>
        </div>
    </header>
  )
}

