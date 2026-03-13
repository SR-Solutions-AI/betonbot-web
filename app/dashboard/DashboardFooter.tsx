'use client'

import Link from 'next/link'
import { Mail } from 'lucide-react' 

export default function DashboardFooter() {
  return (
    <footer className="w-full mt-auto pt-4 pb-4 px-6 border-t border-white/10 relative overflow-hidden bg-[#1A1A1A] shrink-0 z-50">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] h-[100px] bg-[#E5B800]/5 blur-[60px] rounded-full pointer-events-none" />
      <div className="relative z-10 flex flex-col md:flex-row justify-between items-center gap-4 text-xs md:text-sm text-sand/60">
        <div className="flex items-center gap-4">
           {/* eslint-disable-next-line @next/next/no-img-element */}
           <img src="/logo.png" alt="Betonbot" className="h-10 w-auto object-contain opacity-80" />
           <p>© 2026 SR SOLUTIONS AI SRL <span className="opacity-30 mx-1">|</span> Alle Rechte vorbehalten.</p>
        </div>
        <div className="flex gap-6 font-medium">
            <Link href="/agb" className="hover:text-[#E5B800] transition-colors">AGB</Link>
            <Link href="/impressum" className="hover:text-[#E5B800] transition-colors">Impressum</Link>
            <Link href="/datenschutz" className="hover:text-[#E5B800] transition-colors">Datenschutz</Link>
        </div>
        <a href="mailto:christian@betonbot.com" className="flex items-center gap-2 hover:text-[#E5B800] transition-colors">
            <Mail size={14} /> christian@betonbot.com
        </a>
      </div>
    </footer>
  )
}







