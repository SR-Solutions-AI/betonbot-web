'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogOut, User, Database, Settings, ChevronDown, Building2, FileText, Home } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { apiFetch } from '../lib/supabaseClient'
import { useEffect, useState, useRef } from 'react'

// --- CONFIG ---
const LOGO_IMAGE_URL = '/logo.png'

export default function DashboardHeader() {
  const pathname = usePathname()
  const isPreisdatenbank = pathname?.includes('/preisdatenbank')
  const isSettingsArea = pathname?.includes('/settings') || isPreisdatenbank
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [me, setMe] = useState<{ user?: { email?: string | null; role?: string | null; can_manage_org?: boolean }, tenant?: { config?: any } | null } | null>(null)
  const [wrongApp, setWrongApp] = useState<{ forApp: string; loginUrl: string } | null>(null)
  const mountedRef = useRef(true)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const canSeeOrgSettings =
    (me?.user as any)?.role === 'org_leader' || (me?.user as any)?.can_manage_org === true
  const isSiteAdmin = (me?.user as any)?.role === 'admin'
  const canSeeOfferCustomization = !isSiteAdmin
  const canSeePreisdatenbank = !isSiteAdmin

  // --- FUNCTIA DE LOGOUT (FIXED) ---
  const handleLogout = async () => {
    // 1. Încercăm să dăm sign out la Supabase
    try {
        await supabase.auth.signOut()
    } catch (e) {
        console.error("Eroare la sign out:", e)
    } finally {
        // 2. IMPORTANT: Folosim window.location.href in loc de router.push
        // Asta forteaza un refresh complet al paginii și curăță memoria
        window.location.href = '/'
    }
  }

  const fetchMe = async () => {
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
  }

  useEffect(() => {
    mountedRef.current = true
    fetchMe()
    const onTenantConfigSaved = () => fetchMe()
    window.addEventListener('tenant-config:saved', onTenantConfigSaved)
    return () => {
      mountedRef.current = false
      window.removeEventListener('tenant-config:saved', onTenantConfigSaved)
    }
  }, [])

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
  const role = (me as any)?.user?.role as string | undefined
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
        
        {/* Full-width header content: left + center + right pushed to edges */}
        <div className="relative z-10 w-full grid grid-cols-3 items-center px-2 sm:px-6">
          {/* Left: tenant logo */}
          <div className="flex items-center gap-3 min-w-0 h-12 sm:h-14">
            {tenantLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={tenantLogoUrl}
                alt="Logo"
                className="h-[50px] sm:h-[60px] w-auto max-w-[200px] object-contain object-left"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            ) : null}
          </div>

          {/* Center: Betonbot logo only */}
          <div className="flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={LOGO_IMAGE_URL}
              alt="Betonbot"
              className="h-[50px] sm:h-[60px] w-auto object-contain"
              onError={(e) => (e.currentTarget.style.display = 'none')}
            />
          </div>

          {/* Right: email + Settings (Organisation / Preisdatenbank) + logout */}
          <div className="flex justify-end items-center gap-2 sm:gap-3 min-w-0">
            <div className="hidden sm:flex items-center gap-2 text-xs sm:text-sm text-sand/70 truncate max-w-[200px]">
              <User size={16} className="flex-shrink-0" />
              <span className="truncate">{email || ''}</span>
            </div>
            <div className="relative" ref={dropdownRef}>
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
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-[#ffffff] shadow-md transition-all duration-200 ease-out border border-white/30 bg-coffee-850 hover:bg-coffee-800 hover:border-[#E5B800]/50"
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

