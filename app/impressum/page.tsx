'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { motion, Variants } from 'framer-motion'

const LOGO_IMAGE_URL = '/logo.png'

const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } }
}

const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.2 }
  }
}

function FooterSection() {
  return (
    <footer className="w-full bg-[#0A0A0A] pt-24 pb-12 px-6 border-t border-[#E5B800]/10 relative overflow-hidden mt-20">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-[#E5B800]/5 blur-[120px] rounded-full pointer-events-none" />
      <div className="max-w-[1600px] mx-auto relative z-10">
        <div className="flex flex-col md:flex-row justify-between items-start gap-12 mb-20">
            <div className="max-w-xl flex flex-col items-center md:items-start text-center md:text-left">
               <img src={LOGO_IMAGE_URL} className="h-20 w-auto mb-8 object-contain" alt="Betonbot Logo" />
               <p className="text-sand/80 text-lg leading-relaxed mb-8 font-medium">
                 Betonbot — Ihr Partner für digitale & KI-Transformation in der Bauindustrie.
               </p>
            </div>
            <div className="flex flex-col items-center md:items-end text-center md:text-right w-full md:w-auto">
               <h4 className="text-[#E5B800] font-bold text-2xl mb-4">Kontakt</h4>
               <a href="mailto:christian@betonbot.com" className="text-white hover:text-[#E5B800] font-bold text-2xl lg:text-3xl underline decoration-[#E5B800] decoration-2 underline-offset-8 transition-all">
                  christian@betonbot.com
               </a>
            </div>
        </div>
        <div className="h-px w-full bg-white/10 mb-10" />
        <div className="flex flex-col md:flex-row justify-between items-center gap-6 text-sm text-sand/40">
           <p>Copyright 2026 | SR SOLUTIONS AI SRL | UID: RO50767531</p>
           <div className="flex gap-6">
              <Link href="/agb" className="hover:text-white transition-colors">AGB</Link>
              <Link href="/impressum" className="hover:text-white transition-colors">Impressum</Link>
              <Link href="/datenschutz" className="hover:text-white transition-colors">Datenschutz</Link>
           </div>
        </div>
      </div>
    </footer>
  )
}

export default function ImpressumPage() {
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white/90 font-sans selection:bg-[#E5B800]/30 overflow-x-hidden">
      
      <div className="max-w-3xl mx-auto px-6 pt-20 pb-10">
        
        {/* Header */}
        <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-12"
        >
          <Link href="/" className="inline-flex items-center gap-2 text-[#E5B800] hover:text-[#E5B800]/80 transition-colors font-medium group">
            <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform" /> Zurück zur Startseite
          </Link>
        </motion.div>

        <motion.div initial="hidden" animate="visible" variants={staggerContainer} className="space-y-12">
            
            <motion.h1 variants={fadeInUp} className="text-4xl md:text-5xl font-extrabold mb-12 text-white">Impressum</motion.h1>

            <div className="space-y-10 text-lg leading-relaxed text-sand/80">
            
            <motion.section variants={fadeInUp}>
                <div className="pl-4 border-l-2 border-[#E5B800]">
                    <p className="font-bold text-white text-xl mb-1">SR SOLUTIONS AI S.R.L.</p>
                    <p>Strada Republicii 35</p>
                    <p>437335 Șomcuta Mare</p>
                    <p>Județul Maramureș</p>
                    <p>Rumänien</p>
                </div>
            </motion.section>

            <motion.section variants={fadeInUp}>
                <h3 className="font-bold text-[#E5B800] mb-2 text-xl">Geschäftsführer:</h3>
                <p>Christian Hartl</p>
            </motion.section>

            <motion.section variants={fadeInUp}>
                <h3 className="font-bold text-[#E5B800] mb-2 text-xl">Kontakt:</h3>
                <p>E-Mail: <a href="mailto:christian@betonbot.com" className="text-white hover:text-[#E5B800] transition-colors underline decoration-1 underline-offset-4">christian@betonbot.com</a></p>
                <p>Website: <a href="https://www.betonbot.com" className="text-white hover:text-[#E5B800] transition-colors underline decoration-1 underline-offset-4">https://www.betonbot.com</a></p>
            </motion.section>

            <motion.div variants={fadeInUp} className="h-px bg-white/10 w-full my-8" />

            <motion.section variants={fadeInUp}>
                <h3 className="font-bold text-[#E5B800] mb-2 text-xl">Handelsregisternummer (Registrul Comerțului):</h3>
                <p>J2024034898004</p>
                <h3 className="font-bold text-[#E5B800] mb-2 mt-4 text-xl">Umsatzsteuer-Identifikationsnummer (UID):</h3>
                <p>RO50767531</p>
                <h3 className="font-bold text-[#E5B800] mb-2 mt-4 text-xl">Gesellschaftsform:</h3>
                <p>Societate cu Răspundere Limitată (S.R.L.)</p>
                <h3 className="font-bold text-[#E5B800] mb-2 mt-4 text-xl">Registergericht:</h3>
                <p>Oficiul Național al Registrului Comerțului (ONRC), Rumänien</p>
            </motion.section>

            <motion.section variants={fadeInUp}>
                <h3 className="font-bold text-[#E5B800] mb-2 text-xl">Inhaltlich Verantwortlich gemäß EU-Recht:</h3>
                <p>Christian Hartl, Strada Republicii 35, 437335 Șomcuta Mare, Rumänien</p>
            </motion.section>

            <motion.div variants={fadeInUp} className="bg-white/5 border border-white/10 p-8 rounded-3xl mt-12 backdrop-blur-sm">
                <h3 className="font-bold text-[#E5B800] mb-2">Haftungsausschluss:</h3>
                <p className="text-sm leading-relaxed text-white/70">
                Trotz sorgfältiger inhaltlicher Kontrolle übernimmt SR Solutions AI S.R.L. keine Haftung für die Inhalte externer Links. Für den Inhalt verlinkter Seiten sind ausschließlich deren Betreiber verantwortlich.
                </p>
            </motion.div>

            </div>
        </motion.div>
      </div>

      <FooterSection />
    </div>
  )
}