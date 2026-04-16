'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase } from './lib/supabaseClient'
import { useRouter } from 'next/navigation'
import { motion, Variants } from 'framer-motion'
import { LogIn, ArrowRight, Hammer, XCircle, CheckCircle2, FileText, Clock, TrendingUp, Shield, Users, Briefcase, Download, Check, Plus, Lightbulb, Mail, Play, Pause, RotateCcw, SkipBack, SkipForward } from 'lucide-react'

// --- CONFIG ---
const BACKGROUND_IMAGE_URL = '/images/landing-bg.png'
const PRICING_BG_URL = '/images/construction-site.jpg' 
const VIDEO_URL = '/videos/intro-video.mp4'
const LOGO_IMAGE_URL = '/logo.png'
/** Exemple PDF din public – servite prin /api/sample-pdf/* cu titlu BTN-2026-0072 (ca holzbot). */
const PDF_PREVIEWS = [
  {
    image: '/angebot.png',
    href: '/api/sample-pdf/angebot',
    alt: 'Angebot PDF Vorschau',
    buttonLabel: 'Angebot ansehen',
  },
  {
    image: '/mengenermittlung.png',
    href: '/api/sample-pdf/mengenermittlung',
    alt: 'Mengenermittlung PDF Vorschau',
    buttonLabel: 'Mengenermittlung ansehen',
  },
] as const
const ORDER_FORM_URL = '/documents/bestellformular.pdf'
const BENEFITS_IMAGE_URL = '/images/second-bg.png'
const TESTIMONIAL_IMAGE_URL = '/images/testimonial.png'
const TESTIMONIAL_ABSTRACT_URL = '/images/second-bg.png'
const PROBLEM_BROWN = '#8B4513';

// --- ANIMATION VARIANTS ---
const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 60 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } }
}

const fadeInLeft: Variants = {
  hidden: { opacity: 0, x: -60 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.6, ease: "easeOut" } }
}

const fadeInRight: Variants = {
  hidden: { opacity: 0, x: 60 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.6, ease: "easeOut" } }
}

const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: "easeOut" } }
}

const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.2
    }
  }
}

/* ================= FEATURE / PDF SECTION ================= */
function FeatureSection() {
  return (
    <section id="features" className="relative w-full bg-coffee-800 pt-16 pb-20 md:pt-32 md:pb-40 overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-px bg-[#E5B800]/30" />
      
      {/* UPDATE: Blob GIGANTIC pe mobil (180vw) */}
      <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} transition={{ duration: 1.5 }} className="absolute top-20 left-[-20%] w-[180vw] h-[180vw] md:w-[500px] md:h-[500px] bg-[#E5B800]/5 blur-[80px] md:blur-[120px] rounded-full pointer-events-none" />

      <div className="relative z-10 max-w-[1700px] mx-auto grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-x-8 xl:gap-x-10 gap-y-12 items-center px-1 md:px-2">
        {/* LEFT - PROBLEM */}
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-50px" }} variants={fadeInLeft} className="flex flex-col gap-6 md:gap-8 p-6 md:p-8 rounded-3xl border border-white/5 bg-white/5 backdrop-blur-sm shadow-2xl relative order-1 lg:order-1">
          <div className={`absolute -left-2 top-10 w-1 h-20 rounded-full bg-[${PROBLEM_BROWN}]`} />
          <div>
            <h3 className="text-2xl md:text-3xl lg:text-4xl font-extrabold text-white mb-2 leading-tight">Das Problem: Angebote im Bau dauern zu lange - oft umsonst</h3>
            <div className={`h-1.5 w-24 rounded-full mt-4 bg-[${PROBLEM_BROWN}]`} />
          </div>
          <ul className="space-y-4 md:space-y-6">
            <li className="flex items-start gap-4">
               <XCircle className={`shrink-0 mt-1 text-[${PROBLEM_BROWN}]`} size={24} />
               <span className="text-lg md:text-xl text-sand/90 font-medium">4–6 Stunden pro Angebot – oft umsonst</span>
            </li>
            <li className="flex items-start gap-4">
               <XCircle className={`shrink-0 mt-1 text-[${PROBLEM_BROWN}]`} size={24} />
               <span className="text-lg md:text-xl text-sand/90 font-medium">Viele Interessenten springen ab, bevor ein Preis da ist</span>
            </li>
            <li className="flex items-start gap-4">
               <XCircle className={`shrink-0 mt-1 text-[${PROBLEM_BROWN}]`} size={24} />
               <span className="text-lg md:text-xl text-sand/90 font-medium">Verpasste Kunden durch zu späte Antworten</span>
            </li>
          </ul>
        </motion.div>

        {/* CENTER - PDF */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-50px" }}
          variants={scaleIn}
          className="relative flex justify-center order-2 lg:order-2 my-4 lg:my-0"
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[160%] h-[160%] bg-[#E5B800]/10 blur-3xl rounded-full" />
          <div className="relative w-full max-w-3xl">
            <div id="pdf-previews" className="grid grid-cols-1 md:grid-cols-2 gap-5 scroll-mt-24 md:scroll-mt-28">
              {PDF_PREVIEWS.map((preview) => (
                <div key={preview.href} className="relative group cursor-pointer">
                  <img src={preview.image} alt={preview.alt} className="rounded-2xl shadow-2xl border-4 border-white/10 w-full h-auto" />
                  <div className="absolute inset-0 flex items-center justify-center px-3">
                    <a
                      href={preview.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-[#E5B800] hover:bg-[#E5B800]/90 text-white font-bold text-sm md:text-base py-3 px-4 md:py-3.5 md:px-5 rounded-xl flex items-center gap-2 shadow-xl transition-transform duration-300 hover:scale-105 text-center"
                    >
                      {preview.buttonLabel} <ArrowRight size={18} />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* RIGHT - SOLUTION */}
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-50px" }} variants={fadeInRight} className="flex flex-col gap-6 md:gap-8 p-6 md:p-8 rounded-3xl border border-white/5 bg-white/5 backdrop-blur-sm shadow-2xl relative order-3 lg:order-3">
           <div className="absolute -right-2 top-10 w-1 h-20 bg-[#E5B800] rounded-full" />
          <div>
            <h3 className="text-2xl md:text-3xl lg:text-4xl font-extrabold text-white mb-2 leading-tight">Die Lösung: Ein Schätzungsangebot in Minuten statt Stunden.</h3>
            <div className="h-1.5 w-24 bg-[#E5B800] rounded-full mt-4" />
          </div>
          <ol className="space-y-4 md:space-y-6">
            <li className="flex items-start gap-4">
                <div className="bg-[#E5B800]/20 w-8 h-8 flex items-center justify-center rounded-full text-[#E5B800] shrink-0 mt-1">
                    <span className="font-bold text-lg">1</span>
                </div>
                <span className="text-lg md:text-xl text-sand/90 font-medium">Hausdaten eingeben</span>
            </li>
            <li className="flex items-start gap-4">
                <div className="bg-[#E5B800]/20 w-8 h-8 flex items-center justify-center rounded-full text-[#E5B800] shrink-0 mt-1">
                    <span className="font-bold text-lg">2</span>
                </div>
                <span className="text-lg md:text-xl text-sand/90 font-medium">Bauplan (PDF) hochladen</span>
            </li>
             <li className="flex items-start gap-4">
                <div className="bg-[#E5B800]/20 w-8 h-8 flex items-center justify-center rounded-full text-[#E5B800] shrink-0 mt-1">
                    <span className="font-bold text-lg">3</span>
                </div>
                <span className="text-lg md:text-xl text-sand/90 font-medium">Betonbot analysiert Bauplan</span>
            </li>
             <li className="flex items-start gap-4">
                <CheckCircle2 className="text-[#E5B800] shrink-0 w-8 h-8 mt-1" />
                <span className="text-lg md:text-xl font-bold text-white">Schätzungsangebot als PDF erhalten</span>
            </li>
          </ol>
        </motion.div>
      </div>
    </section>
  )
}

/* ================= BENEFITS SECTION ================= */
function BenefitsSection() {
  return (
    <section className="relative w-full py-16 md:py-24 overflow-hidden bg-coffee-900 flex flex-col items-center justify-center">
      
      {/* IMAGINE ABSTRACTĂ PE FUNDAL - stânga, sus */}
      <div className="absolute left-0 -top-[25%] w-[80vw] h-[80vh] pointer-events-none opacity-40">
        <img src={BENEFITS_IMAGE_URL} alt="" className="w-full h-full object-contain object-left-top opacity-20" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 text-center">
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeInUp} className="inline-block mb-12 md:mb-16">
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-extrabold text-white mb-6">Die Vorteile</h2>
            <div className="h-1.5 w-24 bg-[#E5B800] rounded-full mx-auto" />
        </motion.div>

        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-50px" }} variants={staggerContainer} className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10">
            {/* Cards... */}
            <motion.div variants={fadeInUp} className="group relative p-6 md:p-8 rounded-2xl bg-black/60 border border-white/10 backdrop-blur-md hover:border-[#E5B800]/50 transition-all duration-300">
               <div className="flex justify-center mb-6">
                  <div className="bg-[#E5B800]/10 p-4 rounded-2xl text-[#E5B800]">
                     <Clock size={32} className="md:w-10 md:h-10" />
                  </div>
               </div>
               <h3 className="text-xl md:text-2xl font-bold text-white mb-3">Weniger Arbeit</h3>
               <p className="text-sand/80 text-base md:text-lg leading-relaxed">Keine Zeitverschwendung mehr mit Kunden die nicht kaufen.</p>
            </motion.div>
            <motion.div variants={fadeInUp} className="group relative p-6 md:p-8 rounded-2xl bg-black/60 border border-white/10 backdrop-blur-md hover:border-[#E5B800]/50 transition-all duration-300">
               <div className="flex justify-center mb-6">
                  <div className="bg-[#E5B800]/10 p-4 rounded-2xl text-[#E5B800]">
                     <TrendingUp size={32} className="md:w-10 md:h-10" />
                  </div>
               </div>
               <h3 className="text-xl md:text-2xl font-bold text-white mb-3">Mehr Abschlüsse</h3>
               <p className="text-sand/80 text-base md:text-lg leading-relaxed">Schnellere Angebote führen direkt zu einer besseren Abschlussquote.</p>
            </motion.div>
            <motion.div variants={fadeInUp} className="group relative p-6 md:p-8 rounded-2xl bg-black/60 border border-white/10 backdrop-blur-md hover:border-[#E5B800]/50 transition-all duration-300">
               <div className="flex justify-center mb-6">
                  <div className="bg-[#E5B800]/10 p-4 rounded-2xl text-[#E5B800]">
                     <Shield size={32} className="md:w-10 md:h-10" />
                  </div>
               </div>
               <h3 className="text-xl md:text-2xl font-bold text-white mb-3">Modernes Auftreten</h3>
               <p className="text-sand/80 text-base md:text-lg leading-relaxed">Überzeugen Sie Kunden professionell und digital ab der ersten Sekunde.</p>
            </motion.div>
        </motion.div>
      </div>

      {/* SEPARATOR LA FINAL DE SECȚIUNE (Gradient line) */}
      <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-[#E5B800]/40 to-transparent" />
    </section>
  )
}

/* ================= FAQ SECTION ================= */
function FAQSection() {
  return (
    <section className="relative w-full bg-coffee-800 py-16 md:py-32 px-6 z-20 overflow-hidden">
      <div className="relative z-10 max-w-[1600px] mx-auto">
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeInUp} className="text-center mb-12 md:mb-20">
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white mb-6 leading-tight">Häufig gestellte Fragen</h2>
            <div className="h-1.5 w-32 bg-[#E5B800] rounded-full mx-auto" />
        </motion.div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 md:gap-10 items-stretch">
            <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeInLeft} className="space-y-6 md:space-y-8 p-6 md:p-8 rounded-3xl bg-white/5 border border-white/10 hover:border-[#E5B800]/30 transition-all">
                <h3 className="text-2xl md:text-3xl font-bold text-white mb-6 flex items-center gap-3">
                    <Users className="text-[#E5B800]" /> Ist Betonbot für unsere Firma geeignet?
                </h3>
                <div className="space-y-6">
                    <div>
                        <p className="text-lg md:text-xl font-bold text-white mb-4 flex items-center gap-2">
                            <CheckCircle2 className="text-[#E5B800] shrink-0" size={20} />
                            <span className="underline decoration-[#E5B800]/70 underline-offset-2">Ja, wenn:</span>
                        </p>
                        <ul className="space-y-3 ml-7">
                            <li className="flex items-start gap-3">
                                <div className="mt-1.5 w-2 h-2 rounded-full bg-[#E5B800] shrink-0" />
                                <span className="text-lg md:text-xl text-sand/90"><span className="font-semibold text-white">Neubauten</span> zu Ihren Hauptleistungen zählen</span>
                            </li>
                            <li className="flex items-start gap-3">
                                <div className="mt-1.5 w-2 h-2 rounded-full bg-[#E5B800] shrink-0" />
                                <span className="text-lg md:text-xl text-sand/90">Sie regelmäßig Zeit mit <span className="font-semibold text-white">Angeboten verschwenden</span>, die nicht zum Abschluss führen</span>
                            </li>
                            <li className="flex items-start gap-3">
                                <div className="mt-1.5 w-2 h-2 rounded-full bg-[#E5B800] shrink-0" />
                                <span className="text-lg md:text-xl text-sand/90">Ihre Kunden mit fertigen Plänen kommen und <span className="font-semibold text-white">schnell einen Preis erwarten</span></span>
                            </li>
                            <li className="flex items-start gap-3">
                                <div className="mt-1.5 w-2 h-2 rounded-full bg-[#E5B800] shrink-0" />
                                <span className="text-lg md:text-xl text-sand/90">Sie Preise oft <span className="font-semibold text-white">zu spät nennen</span>, weil mehrere Anfragen parallel bearbeitet werden müssen</span>
                            </li>
                        </ul>
                    </div>
                </div>
            </motion.div>
            <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeInUp} className="space-y-6 md:space-y-8 p-6 md:p-8 rounded-3xl bg-white/5 border border-white/10 hover:border-[#E5B800]/30 transition-all">
                <h3 className="text-2xl md:text-3xl font-bold text-white mb-6 flex items-center gap-3">
                    <TrendingUp className="text-[#E5B800]" /> Lohnt sich Betonbot für unser Unternehmen?
                </h3>
                <div className="space-y-6 text-lg md:text-xl text-sand/90 leading-relaxed">
                    <p className="font-bold text-white text-xl md:text-2xl underline decoration-[#E5B800] decoration-2 underline-offset-2">Ja, in den meisten Fällen deutlich.</p>
                    <p>Ein typisches Bauunternehmen erstellt <span className="font-semibold text-white">ca. 8–12 Angebote pro Monat</span>.<br />Rund die Hälfte davon führt nicht zum Auftrag.</p>
                    <p>Pro Angebot fallen durchschnittlich <span className="font-semibold text-white">4–6 Stunden</span> Kalkulationszeit an.<br />Bei ca. <span className="font-bold text-[#E5B800]">80 €</span> interner Stundensatz sind das rund <span className="font-bold text-[#E5B800]">400 € pro Angebot</span>.</p>
                    <p>Wenn 5 Angebote pro Monat nicht beauftragt werden:</p>
                    <p className="ml-4 font-semibold text-white">→ ca. 2.000 € interner Aufwand monatlich</p>
                    <p>Gewinnen Sie durch schnellere Angebote nur <span className="font-semibold text-white">einen zusätzlichen Auftrag pro Jahr</span>:</p>
                    <ul className="space-y-2 ml-4">
                        <li className="flex items-start gap-2">
                            <span className="text-[#E5B800] font-bold">•</span>
                            <span><span className="font-semibold text-white">Ø Projekt:</span> 500.000 €</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="text-[#E5B800] font-bold">•</span>
                            <span><span className="font-semibold text-white">Ø Gewinn (10 %):</span> 50.000 €</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="text-[#E5B800] font-bold">•</span>
                            <span className="font-semibold text-white">→ ≈ 4.000 € zusätzlicher Gewinn pro Monat</span>
                        </li>
                    </ul>
                    <p className="font-bold text-white text-xl md:text-2xl pt-2 py-2 px-4 rounded-xl bg-[#E5B800]/20 border border-[#E5B800]/40 inline-block">Total ≈ 6.000 € / Monat</p>
                </div>
            </motion.div>
            <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeInRight} className="space-y-6 md:space-y-8 p-6 md:p-8 rounded-3xl bg-white/5 border border-white/10 hover:border-[#E5B800]/30 transition-all">
                <h3 className="text-2xl md:text-3xl font-bold text-white mb-6 flex items-center gap-3">
                    <TrendingUp className="text-[#E5B800]" /> Woher hat Betonbot seine Preise und Daten?
                </h3>
                <div className="space-y-6 text-lg md:text-xl text-sand/90 leading-relaxed">
                    <p className="font-bold text-white text-xl md:text-2xl underline decoration-[#E5B800] decoration-2 underline-offset-2">Von Ihnen.</p>
                    <p>Betonbot arbeitet mit den Preis- und Leistungsdaten <span className="font-semibold text-white">Ihres Unternehmens</span>.<br />Sie hinterlegen Ihre <span className="font-semibold text-white">Quadratmeterpreise, Stückpreise und Subunternehmerkosten</span> direkt im System.</p>
                    <p>Auf dieser Basis berechnet Betonbot Ihre Projekte automatisch mit <span className="font-bold text-[#E5B800]">genau den Zahlen, die Sie selbst verwenden</span>.</p>
                    <p>Sie behalten jederzeit die <span className="font-semibold text-white underline decoration-[#E5B800]/60 underline-offset-1">volle Kontrolle</span> und können Ihre Preise im System selbst anpassen.</p>
                </div>
            </motion.div>
        </div>
      </div>
    </section>
  )
}

/* ================= TESTIMONIAL / EXPERTISE SECTION ================= */
function TestimonialSection() {
  return (
    <section className="w-full bg-coffee-800 py-10 md:py-20 px-6 relative z-20">
      
      {/* Abstract Background Element - mai mic */}
      <div className="absolute bottom-0 left-0 w-[65%] h-auto opacity-15 pointer-events-none">
          <img src={TESTIMONIAL_ABSTRACT_URL} className="w-full h-auto object-contain object-bottom-left" alt="" />
      </div>

      <div className="relative z-10 max-w-[1450px] mx-auto">
        {/* Header */}
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeInUp} className="text-center mb-16 md:mb-20">
            <h4 className="text-[#E5B800] font-bold text-xs md:text-sm uppercase tracking-widest mb-3">Unsere Expertise</h4>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-extrabold text-white leading-tight">Aus der Praxis für die Praxis</h2>
        </motion.div>
        
        {/* Grid: Image column larger (lg:grid-cols-[6fr_5fr]) */}
        <div className="grid grid-cols-1 lg:grid-cols-[6fr_5fr] gap-12 md:gap-20 items-center">
          
          {/* === LEFT: IMAGE (Larger, Framed & GLOW ADDED) === */}
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }} variants={scaleIn} className="relative group order-1">
            {/* Offset Border Effect (Rama decalată portocalie) */}
            <div className="absolute top-4 left-4 md:top-5 md:left-5 w-full h-full rounded-[2rem] md:rounded-[2.5rem] border-2 border-[#E5B800]/50 -z-10 transition-transform group-hover:translate-x-2 group-hover:translate-y-2 duration-500"></div>
            
            {/* Main Image Container CU GLOW */}
            <div className="relative rounded-[2rem] md:rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.5),0_0_60px_rgba(229,184,0,0.3)] overflow-hidden border border-white/5 z-10">
                 {/* Gradient Overlay subtil */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent pointer-events-none"></div>
                <img src={TESTIMONIAL_IMAGE_URL} className="w-full h-auto object-cover scale-100 group-hover:scale-105 transition-transform duration-700" alt="picture" />
            </div>
          </motion.div>

          {/* === RIGHT: TEXT CONTENT (Structured with Icons, NO LOGO) === */}
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={staggerContainer} className="flex flex-col gap-8 md:gap-10 order-2">
            
            {/* Point 1: Origin */}
            <motion.div variants={fadeInRight} className="flex items-start gap-4 md:gap-5">
                <div className="bg-[#E5B800]/20 p-3 rounded-xl shrink-0">
                    <Briefcase size={24} className="text-[#E5B800] md:w-7 md:h-7" />
                </div>
                <div>
                    <h3 className="text-xl md:text-2xl font-bold text-white mb-2 md:mb-3">Jahrelange KI-Erfahrung</h3>
                    <p className="text-lg md:text-xl text-sand/80 leading-relaxed font-medium">Betonbot ist das Ergebnis jahrelanger Arbeit an KI-gestützten Softwarelösungen für Bau- und Holzbauunternehmen. Unsere Systeme werden nicht im Labor entwickelt, sondern gemeinsam mit erfahrenen Betrieben aus der Praxis.</p>
                </div>
            </motion.div>

            {/* Point 2: Partnership (LOGO ELIMINAT) */}
            <motion.div variants={fadeInRight} className="flex items-start gap-4 md:gap-5 relative">
                {/* Connecting Line */}
                <div className="absolute top-16 left-6 w-px h-24 bg-[#E5B800]/20 -z-10 hidden md:block"></div>

                <div className="bg-[#E5B800]/20 p-3 rounded-xl shrink-0">
                    <Users size={24} className="text-[#E5B800] md:w-7 md:h-7" />
                </div>
                <div>
                    <h3 className="text-xl md:text-2xl font-bold text-white mb-3 md:mb-4">Starke Partnerschaften</h3>
                    {/* LOGO-UL A FOST ELIMINAT DE AICI */}
                    <p className="text-lg md:text-xl text-sand/80 leading-relaxed font-medium">Wir arbeiten seit Jahren eng mit Bau- und Holzbaubetrieben zusammen und haben zahlreiche digitale Werkzeuge für Vertrieb, Kundenkommunikation und interne Prozesse umgesetzt. Dieses praxisnahe Feedback fließt direkt in die Weiterentwicklung unserer Lösungen ein.</p>
                </div>
            </motion.div>

             {/* Point 3: Industry Understanding */}
             <motion.div variants={fadeInRight} className="flex items-start gap-4 md:gap-5">
                <div className="bg-[#E5B800]/20 p-3 rounded-xl shrink-0">
                    <Lightbulb size={24} className="text-[#E5B800] md:w-7 md:h-7" />
                </div>
                <div>
                    <h3 className="text-xl md:text-2xl font-bold text-white mb-2 md:mb-3">Tiefes Branchenverständnis</h3>
                    <p className="text-lg md:text-xl text-sand/80 leading-relaxed font-medium">Dieses tiefe Verständnis ermöglicht es uns, Lösungen zu entwickeln, die im Alltag tatsächlich funktionieren, insbesondere dort, wo Zeit und schnelle Reaktionsfähigkeit über den Projekterfolg entscheiden.</p>
                </div>
            </motion.div>
            
          </motion.div>
        </div>
      </div>
    </section>
  )
}

/* ================= LOGO SECTION (BIGGER & SMOOTHER) ================= */
function LogoSection() {
  const logos = [
    { name: "Hausbauhaus", url: "/images/holz1.png" },
    { name: "Sadiki Bau", url: "/images/holz2.png" },
    { name: "Binar Electronics", url: "/images/holz3.png" },
    { name: "MXG", url: "/images/holz4.png" },
    { name: "Trifolia", url: "/images/holz5.png" },
  ];

  // Dublăm lista pentru loop infinit perfect
  const infiniteLogos = [...logos, ...logos];

  return (
    <section className="w-full bg-[#1a120e] py-15 md:py-25 border-t border-[#E5B800]/10 relative z-20 overflow-hidden">
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes scroll-infinite {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .scroll-container {
          display: flex;
          width: max-content;
          animation: scroll-infinite linear infinite;
        }
        /* Viteză Desktop: 40s (Lent și elegant) */
        .speed-desktop {
          animation-duration: 40s;
        }
        /* Viteză Mobil: 20s (Mai lent decât înainte, dar fluid) */
        @media (max-width: 768px) {
          .speed-mobile {
            animation-duration: 20s;
          }
        }
      `}} />

      <div className="max-w-full mx-auto text-center">
        <motion.h3 
          initial={{ opacity: 0, y: 20 }} 
          whileInView={{ opacity: 1, y: 0 }} 
          transition={{ duration: 0.8 }} 
          className="text-2xl md:text-4xl font-extrabold text-white mb-16 md:mb-28 max-w-5xl mx-auto px-6"
        >
          Unsere Erfahrung aus KI-Projekten in anderen Branchen – jetzt speziell für den Holzbau eingesetzt.
        </motion.h3>
        
        <div className="relative w-full overflow-hidden">
            {/* Gradienturi laterale mai late pentru a acomoda pozele mari */}
            <div className="absolute top-0 left-0 w-24 md:w-64 h-full bg-gradient-to-r from-[#1a120e] to-transparent z-10 pointer-events-none" />
            <div className="absolute top-0 right-0 w-24 md:w-64 h-full bg-gradient-to-l from-[#1a120e] to-transparent z-10 pointer-events-none" />

            <div className="scroll-container speed-desktop speed-mobile hover:[animation-play-state:paused]">
              {infiniteLogos.map((logo, index) => (
                <div 
                  key={index} 
                  /* Spațiere orizontală crescută pentru a nu aglomera pozele mari */
                  className="flex-shrink-0 px-7 md:px-15 flex items-center justify-center"
                >
                  <img 
                    src={logo.url} 
                    alt={logo.name} 
                    /* Mobil: h-28 (~112px)
                       Desktop: md:h-60 (~240px) - Foarte mari
                       Opacity maxim, fără filtre de transparență
                    */
                    className="h-35 md:h-50 w-auto object-contain brightness-0 invert opacity-100 block" 
                  />
                </div>
              ))}
            </div>
        </div>
      </div>
    </section>
  )
}

/* ================= PRICING SECTION (SINGLE WIDE LICENSE CARD) ================= */
const BETONBOT_LICENSE_FEATURES = [
  {
    title: 'Automatische Plananalyse',
    text: 'Betonbot erkennt Bauelemente, Flächen und Maße direkt aus dem Bauplan – für Neubau, Dachstuhl, Zubau und Aufstockung.',
  },
  {
    title: 'Preisschätzung in Minuten',
    text: 'Ihre Firmenpreise und Kalkulationslogik sind hinterlegt – Betonbot erstellt daraus automatisch eine strukturierte Preisschätzung inkl. Mengenübersicht.',
  },
  {
    title: 'Alles in einem System',
    text: 'Mengenermittlung, Kalkulation und Preisschätzung kombiniert – ideal für schnelle Vor-Kalkulationen und effiziente Angebotsprozesse.',
  },
] as const

const BETONBOT_PRICE_TIERS = [
  { label: '5 Projekte / Monat', price: '190 €' },
  { label: '10 Projekte / Monat', price: '390 €' },
  { label: '25 Projekte / Monat', price: '590 €' },
  { label: 'Unbegrenzte Projekte', price: '990 €', highlight: true },
] as const

function PricingSection() {
  return (
    <section
      id="preise"
      className="relative w-full min-h-[620px] md:min-h-[680px] py-12 md:py-16 px-4 sm:px-6 overflow-hidden z-20 scroll-mt-24 md:scroll-mt-28 bg-coffee-900 bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: `url("${PRICING_BG_URL}")` }}
    >
      <div className="pointer-events-none absolute inset-0 z-0 bg-black/65 mix-blend-multiply" />
      <div className="pointer-events-none absolute top-0 left-0 z-0 w-full h-28 bg-gradient-to-b from-coffee-900 to-transparent" />

      <motion.div animate={{ opacity: [0.25, 0.45, 0.25], scale: [1, 1.05, 1] }} transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }} className="absolute top-0 right-0 w-[140vw] h-[140vw] md:w-[420px] md:h-[420px] bg-[#E5B800]/10 blur-[90px] md:blur-[120px] rounded-full pointer-events-none z-[1]" />

      <div className="relative z-10 max-w-6xl mx-auto w-full">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          variants={fadeInUp}
          className="rounded-2xl md:rounded-3xl border border-white/10 bg-black/50 backdrop-blur-xl shadow-[0_16px_48px_rgba(0,0,0,0.4)] overflow-hidden ring-1 ring-white/[0.06]"
        >
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#E5B800]/35 to-transparent pointer-events-none" />

          <div className="grid min-h-0 grid-cols-1 lg:grid-cols-[clamp(280px,32vw,420px)_minmax(0,1fr)] lg:items-stretch">
            <aside className="order-2 lg:order-1 flex min-h-0 w-full max-w-md shrink-0 flex-col overflow-hidden border-t border-white/10 bg-white aspect-[1000/1300] mx-auto lg:mx-0 lg:max-w-none lg:aspect-[1000/1300] lg:h-full lg:min-h-0 lg:w-full lg:shrink-0 lg:border-t-0 lg:border-r">
              <div
                role="img"
                aria-label="Betonbot Softwarelizenz"
                className="flex-1 min-h-0 w-full bg-center bg-cover bg-no-repeat"
                style={{ backgroundImage: 'url("/images/betonpaket.png")' }}
              />
            </aside>

            <div className="order-1 lg:order-2 min-w-0 p-6 md:p-8 lg:p-9">
              <div className="pb-6 border-b border-white/10">
                <div className="inline-flex items-center gap-2 rounded-full border border-[#E5B800]/25 bg-[#E5B800]/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#E5B800] mb-3">
                  Lizenz
                </div>
                <h3 className="text-xl md:text-2xl lg:text-[1.65rem] font-extrabold text-white tracking-tight mb-1.5 leading-snug">Betonbot Softwarelizenz</h3>
                <p className="text-sand/85 text-sm md:text-[0.95rem] font-medium leading-relaxed max-w-xl">Komplett-Paket für Preisschätzungen im Bau</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 md:gap-x-8 lg:gap-x-10 pt-6">
                <ul className="space-y-4 md:space-y-4 pb-6 md:pb-0 md:pr-2 border-b md:border-b-0 md:border-r border-white/10">
                  {BETONBOT_LICENSE_FEATURES.map((item) => (
                    <li key={item.title} className="flex gap-3">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#E5B800]/15 text-[#E5B800] ring-1 ring-[#E5B800]/30">
                        <Check className="h-3.5 w-3.5" strokeWidth={3} />
                      </span>
                      <div>
                        <p className="font-bold text-white text-sm mb-0.5">{item.title}</p>
                        <p className="text-sand/75 text-xs md:text-[0.8125rem] leading-relaxed">{item.text}</p>
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="pt-6 md:pt-0 md:pl-2">
                  <h4 className="text-lg md:text-xl font-extrabold text-white mb-1">Preisstruktur</h4>
                  <p className="text-sand/65 text-xs md:text-sm mb-4">Transparente Preise basierend auf Nutzung.</p>

                  <div className="rounded-xl border border-white/10 overflow-hidden bg-black/45">
                    {BETONBOT_PRICE_TIERS.map((tier, i) => (
                      <div
                        key={tier.label}
                        className={`flex flex-row items-center justify-between gap-3 px-3.5 py-3 ${'highlight' in tier && tier.highlight ? 'bg-[#E5B800]/[0.06]' : ''} ${i < BETONBOT_PRICE_TIERS.length - 1 ? 'border-b border-white/10' : ''}`}
                      >
                        <span className={`text-xs md:text-sm leading-snug ${'highlight' in tier && tier.highlight ? 'text-white font-semibold' : 'text-sand/90 font-medium'}`}>{tier.label}</span>
                        <div className="flex items-baseline gap-1.5 shrink-0">
                          <span className="text-base md:text-lg font-extrabold text-white tabular-nums">{tier.price}</span>
                          <span className="text-[10px] md:text-[11px] text-sand/50">zzgl. MwSt.</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <p className="mt-3 text-sand/45 text-[10px] md:text-[11px] pl-2.5 border-l-2 border-[#E5B800]/35">Alle Preise zzgl. gesetzlicher MwSt.</p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

/* ================= FOOTER SECTION (BIGGER TEXT & MORE DETAILS) ================= */
function FooterSection() {
  return (
    <footer className="w-full bg-coffee-900 pt-16 md:pt-24 pb-12 px-6 md:px-8 border-t border-[#E5B800]/10 relative overflow-hidden">
      
      {/* Background Glow subtil - Gigantic pe mobil */}
      <motion.div animate={{ opacity: [0.1, 0.3, 0.1] }} transition={{ duration: 5, repeat: Infinity }} className="absolute top-0 left-1/2 -translate-x-1/2 w-[180vw] h-[180vw] md:w-[600px] md:h-[300px] bg-[#E5B800]/5 blur-[80px] md:blur-[120px] rounded-full pointer-events-none" />

      <div className="max-w-[1600px] mx-auto relative z-10">
        
        {/* === PARTEA DE SUS (Detaliată) === */}
        <div className="flex flex-col md:flex-row justify-between items-center md:items-start gap-12 md:gap-16 mb-16 md:mb-20 text-center md:text-left">
            
            {/* Stânga: Logo, Descriere & Adresă */}
            <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeInUp} className="max-w-xl flex flex-col items-center md:items-start">
               {/* Logo Mai Mare */}
               <img src={LOGO_IMAGE_URL} className="h-[70px] md:h-[100px] w-auto mb-6 md:mb-8 object-contain -translate-x-[5%]" alt="Betonbot Logo" />
               
               {/* Text descriptiv mare */}
               <p className="text-sand/80 text-lg md:text-xl leading-relaxed mb-6 md:mb-10 font-medium">In Minuten vom Plan zum Schätzungsangebot.</p>

            </motion.div>

            {/* Dreapta: CTA Contact & Timp Răspuns */}
            <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeInLeft} className="flex flex-col items-center md:items-end w-full md:w-auto">
               <h4 className="text-[#E5B800] font-bold text-2xl md:text-3xl mb-4">Bereit anzufangen?</h4>
               <p className="text-sand/70 text-base md:text-lg mb-4 font-medium">Kontaktieren Sie uns direkt unter:</p>
               
               {/* Email Masiv */}
               <a href="mailto:christian@betonbot.com" className="text-white hover:text-[#E5B800] font-bold text-2xl lg:text-4xl underline decoration-[#E5B800] decoration-2 underline-offset-8 transition-all hover:scale-[1.02] break-all">christian@betonbot.com</a>

            </motion.div>
        </div>

        {/* Separator */}
        <motion.div initial={{ width: 0 }} whileInView={{ width: "100%" }} transition={{ duration: 1.5 }} className="h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent mb-10" />

        {/* === PARTEA DE JOS (Copyright & Links) === */}
        <div className="flex flex-col md:flex-row justify-between items-center gap-8">
           
           {/* DETALIU 3: Copyright + UID */}
           <p className="text-sand/40 text-sm md:text-base font-medium text-center md:text-left order-2 md:order-1">Copyright 2026 | SR SOLUTIONS AI SRL <span className="block md:inline mx-0 md:mx-2 opacity-30">|</span> UID: RO50767531</p>

           {/* Legal Links (Text mai mare) */}
           <div className="flex flex-wrap justify-center gap-6 md:gap-10 text-sm md:text-base font-medium text-sand/60 order-1 md:order-2">
              <a href="/agb" className="hover:text-white transition-colors">AGB</a>
              <a href="/impressum" className="hover:text-white transition-colors">Impressum</a>
              <a href="/datenschutz" className="hover:text-white transition-colors">Datenschutz</a>
           </div>
        </div>

      </div>
    </footer>
  )
}

/* ================= MAIN ================= */
export default function LandingPage() {
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace('/dashboard')
      else setLoading(false)
    })
  }, [router])

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause()
      } else {
        videoRef.current.play()
      }
      setIsPlaying(!isPlaying)
    }
  }

  const restartVideo = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = 0
      videoRef.current.play()
      setIsPlaying(true)
    }
  }

  const seekBy = (deltaSeconds: number) => {
    if (!videoRef.current) return
    const video = videoRef.current
    const duration = Number.isFinite(video.duration) ? video.duration : 0
    const targetTime = Math.min(Math.max(video.currentTime + deltaSeconds, 0), duration || video.currentTime + deltaSeconds)
    video.currentTime = targetTime
  }

  if (loading) return null

  return (
    <div className="bg-coffee-900 overflow-x-hidden leading-relaxed">

      {/* HERO SECTION */}
      <div className="relative md:min-h-screen sm:min-h-0 w-full overflow-hidden flex flex-col">
        
        {/* ELEMENTE FUNDAL - UPDATE: Blobs GIGANTICE pe mobil (180vw-200vw) */}
        <motion.div animate={{ scale: [1, 1.2, 1], opacity: [0.1, 0.2, 0.1] }} transition={{ duration: 8, repeat: Infinity }} className="absolute top-[-10%] left-[-10%] w-[180vw] h-[180vw] md:w-[600px] md:h-[600px] bg-[#E5B800]/10 blur-[100px] rounded-full pointer-events-none z-0" />
        <div className="absolute top-[20%] left-[-5%] w-[80vw] h-[80vw] md:w-[400px] md:h-[400px] border-2 border-[#E5B800]/5 rounded-[40px] rotate-12 pointer-events-none z-0" />
        <svg className="absolute bottom-0 left-0 w-[100vw] md:w-[500px] h-auto opacity-10 pointer-events-none z-0" viewBox="0 0 500 200" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M-50 200L200 -50" stroke="#E5B800" strokeWidth="2"/>
          <path d="M50 200L300 -50" stroke="#E5B800" strokeWidth="2"/>
          <path d="M150 200L400 -50" stroke="#E5B800" strokeWidth="2"/>
        </svg>

        {/* Abstract Image Background */}
        <motion.div initial={{ opacity: 0, scale: 1.1 }} animate={{ opacity: 0.5, scale: 1 }} transition={{ duration: 2 }} className="absolute right-0 top-0 h-[50%] md:h-[80%] w-full md:w-[65%] bg-no-repeat z-0 pointer-events-none" style={{ backgroundImage: `url(${BACKGROUND_IMAGE_URL})`, backgroundSize: '92%', backgroundPosition: 'top right' }} />

        {/* UPDATE: Padding minim sus pe mobil (pt-12) */}
        <div className="lg:mt-0 relative z-20 w-full flex-grow flex flex-col lg:flex-row items-center justify-between px-6 md:px-16 sm:mt-25 lg:px-24 pt-12 pb-12 md:pt-32 md:pb-20">
            <div className="flex flex-col items-center lg:items-start gap-4 md:gap-8 max-w-xl text-center lg:text-left">
              <motion.img initial={{ opacity: 0, y: -30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }} src={LOGO_IMAGE_URL} className="w-[280px] md:w-[480px] lg:w-[650px] h-auto object-contain mb-2 lg:-ml-7 drop-shadow-2xl" alt="Betonbot Logo" />
              <motion.div initial="hidden" animate="visible" variants={staggerContainer} className="space-y-4 md:space-y-6">
                <motion.p variants={fadeInUp} className="text-3xl md:text-4xl lg:text-5xl font-black text-white leading-tight tracking-tight"><span className="text-white">In Minuten</span> vom Plan zum <br className="hidden md:block"/><span className="relative inline-block mt-2"><span className="text-white underline decoration-[#E5B800] decoration-4 underline-offset-8 decoration-solid">Schätzungsangebot.</span></span></motion.p>
                <motion.p variants={fadeInUp} className="text-lg md:text-2xl text-sand/90 leading-relaxed font-medium">Betonbot erstellt automatisch eine Preisschätzung aus Ihrem Bauplan, einfach, schnell und zuverlässig.</motion.p>
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.8 }} className="flex flex-col sm:flex-row items-center gap-4 md:gap-6 mt-4 md:mt-6 w-full sm:w-auto">
                <motion.a
                  href="/login"
                  whileHover={{ scale: 1.05, y: -2 }}
                  whileTap={{ scale: 0.95 }}
                  className="bg-[#E5B800] hover:bg-[#E5B800]/80 transition text-white font-bold text-base md:text-lg py-3 px-6 md:py-4 md:px-5 rounded-2xl flex items-center justify-center gap-3 shadow-xl duration-300 w-full sm:w-auto"
                >
                  <LogIn size={24} className="md:w-7 md:h-7 shrink-0" />
                  Log in
                </motion.a>
                <a
                  href="/#pdf-previews"
                  className="text-white hover:text-[#E5B800] transition font-bold text-lg md:text-xl flex items-center justify-center gap-3 border-2 border-white/20 hover:border-[#E5B800]/50 px-6 py-3 md:px-8 md:py-4 rounded-2xl w-full sm:w-auto"
                >
                  <ArrowRight size={24} />
                  PDF-Beispiele
                </a>
              </motion.div>
            </div>
            
            {/* VIDEO CU GLOW & CONTROLS */}
            <motion.div initial={{ opacity: 0, scale: 0.9, x: 50 }} animate={{ opacity: 1, scale: 1, x: 0 }} transition={{ duration: 1, delay: 0.2 }} className="w-full lg:w-[55%] mt-4 lg:mt-0">
              <div className="relative group rounded-[1.5rem] sm:mt-20 lg:mt-0 md:rounded-[2.5rem] overflow-hidden shadow-[0_0_40px_rgba(229,184,0,0.2)] md:shadow-[0_0_80px_rgba(229,184,0,0.3)] border border-[#E5B800]/20">
                  <video ref={videoRef} autoPlay muted loop playsInline src={VIDEO_URL} className="w-full h-auto object-cover" />
                  
                  {/* Custom Controls - SNAPPY HOVER FIX */}
                  {/* Am adaugat transform-gpu pentru hardware acceleration si am scos transition-all */}
                  <div className="absolute bottom-4 right-4 flex items-center gap-3 z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <button type="button" onClick={() => seekBy(-5)} className="bg-black/40 hover:bg-[#E5B800] backdrop-blur-xl border border-white/10 text-white p-3 rounded-full transition-colors transform-gpu duration-200 group/btn" aria-label="Zurueck 5 Sekunden"><SkipBack className="w-5 h-5" /></button>
                    <button type="button" onClick={togglePlay} className="bg-black/40 hover:bg-[#E5B800] backdrop-blur-xl border border-white/10 text-white p-3 rounded-full transition-colors transform-gpu duration-200 group/btn" aria-label={isPlaying ? "Pause" : "Play"}>{isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}</button>
                    <button type="button" onClick={restartVideo} className="bg-black/40 hover:bg-[#E5B800] backdrop-blur-xl border border-white/10 text-white p-3 rounded-full transition-colors transform-gpu duration-200 group/btn" aria-label="Restart Video"><RotateCcw className="w-5 h-5" /></button>
                    <button type="button" onClick={() => seekBy(5)} className="bg-black/40 hover:bg-[#E5B800] backdrop-blur-xl border border-white/10 text-white p-3 rounded-full transition-colors transform-gpu duration-200 group/btn" aria-label="Vor 5 Sekunden"><SkipForward className="w-5 h-5" /></button>
                  </div>
              </div>
            </motion.div>
        </div>
      </div>

      <FeatureSection />
      <BenefitsSection />
      <FAQSection />
      <TestimonialSection />
      <PricingSection />
      <FooterSection />

    </div>
  )
}