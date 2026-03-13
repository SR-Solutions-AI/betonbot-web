// app/components/Header.tsx
'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient' // Ajustează calea
import Link from 'next/link'
import { Caveat } from 'next/font/google'

const hand = Caveat({
    subsets: ['latin'],
    weight: ['400', '600', '700'],
    display: 'swap',
})

export default function Header() {
    const [session, setSession] = useState<any>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        // Citirea sesiunii pe client (unde 'supabase.auth.getSession()' funcționează)
        supabase.auth.getSession().then(({ data }) => {
            setSession(data.session)
            setLoading(false)
        })
    }, [])

    function handleLogout() {
        supabase.auth.signOut().then(() => window.location.href = '/')
    }

    return (
        <header className="h-18 flex items-center justify-center px-5 bg-coffee-850 border-b border-black/50 shadow-soft relative shrink-0">
            <div
                className="absolute inset-0 pointer-events-none opacity-30"
                style={{ background: 'radial-gradient(40% 100% at 0% 0%, rgba(216,162,94,.35), transparent 60%)' }}
            />
            
            {/* Conținutul Header-ului (pe client) */}
            <div className="flex items-center gap-3 relative flex-1 max-w-[1280px] justify-between">
                <Link href={session ? "/dashboard" : "/"} className="flex items-center gap-3">
                    <img src="/identity.png" alt="logo" className="h-10 w-auto rounded-md" />
                    <div className={`text-4xl font-normal tracking-tight ${hand.className}`}>Betonbot</div>
                </Link>
                
                {/* Buton Login/Logout (vizibil doar după ce se încarcă sesiunea) */}
                <div className="shrink-0">
                    {loading ? (
                        <div className="h-8 w-16 bg-black/20 rounded-xl animate-pulse" />
                    ) : session ? (
                        <button onClick={handleLogout} className="btn-primary py-2 px-4">
                            Log Out
                        </button>
                    ) : (
                        <Link href="/login" className="btn-primary py-2 px-4">
                            Log In
                        </Link>
                    )}
                </div>
            </div>
        </header>
    )
}