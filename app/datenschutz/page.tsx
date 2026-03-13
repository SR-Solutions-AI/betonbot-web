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

export default function DatenschutzPage() {
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white/90 font-sans selection:bg-[#E5B800]/30 overflow-x-hidden">
      
      <div className="max-w-4xl mx-auto px-6 pt-20 pb-10">
        
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

        {/* Title */}
        <motion.div 
            initial="hidden" 
            animate="visible" 
            variants={staggerContainer}
            className="mb-16"
        >
            <motion.h1 variants={fadeInUp} className="text-4xl md:text-5xl lg:text-6xl font-extrabold mb-6 text-white leading-tight">
                DATENSCHUTZERKLÄRUNG (DSGVO)
            </motion.h1>
            <motion.p variants={fadeInUp} className="text-white/60 text-lg">Stand: 11. März 2026</motion.p>
        </motion.div>

        {/* Content */}
        <motion.div 
            initial="hidden"
            animate="visible"
            variants={staggerContainer}
            className="space-y-12 text-lg leading-relaxed text-sand/80"
        >
          
          <motion.p variants={fadeInUp}>
            Diese Datenschutzerklärung informiert Sie darüber, wie personenbezogene Daten auf der Website betonbot.com und innerhalb der Software Betonbot verarbeitet werden.
            Der Schutz Ihrer Daten ist uns wichtig. Wir verarbeiten personenbezogene Daten ausschließlich im Einklang mit der Datenschutz-Grundverordnung (DSGVO), dem österreichischen Datenschutzgesetz (DSG) und den anwendbaren EU-Vorschriften.
          </motion.p>

          <motion.section variants={fadeInUp}>
            <h2 className="text-2xl font-bold text-[#E5B800] mb-4">1. Verantwortlicher</h2>
            <div className="bg-white/5 border border-white/10 p-8 rounded-3xl backdrop-blur-sm">
                <p className="font-bold text-white text-xl mb-1">SR SOLUTIONS AI S.R.L.</p>
                <p>Strada Republicii 35, 437335 Șomcuta Mare</p>
                <p>Maramureș, Rumänien</p>
                <div className="my-4 h-px bg-white/10 w-full" />
                <p>E-Mail: <a href="mailto:christian@betonbot.com" className="text-[#E5B800] hover:underline">christian@betonbot.com</a></p>
                <p>Geschäftsführer: Christian Hartl</p>
            </div>
          </motion.section>

          <motion.section variants={fadeInUp}>
            <h2 className="text-2xl font-bold text-[#E5B800] mb-4">2. Erhebung und Speicherung personenbezogener Daten beim Besuch dieser Website</h2>
            <p className="mb-4">Beim Aufrufen unserer Website betonbot.com werden automatisch folgende Daten durch unseren Hostinganbieter verarbeitet:</p>
            <ul className="list-disc pl-6 mb-4 space-y-1 marker:text-[#E5B800]">
                <li>IP-Adresse</li>
                <li>Datum und Uhrzeit des Zugriffs</li>
                <li>Browsertyp und Browserversion</li>
                <li>Betriebssystem</li>
                <li>Referrer-URL</li>
                <li>aufgerufene Seiten</li>
                <li>technische Server-Logfiles</li>
            </ul>
            <p>Diese Daten sind technisch erforderlich, um die Website anzuzeigen und ihre Stabilität und Sicherheit zu gewährleisten (Art. 6 Abs. 1 lit. f DSGVO – berechtigtes Interesse). Es findet keine Weitergabe dieser Daten statt.</p>
          </motion.section>

          <motion.section variants={fadeInUp}>
            <h2 className="text-2xl font-bold text-[#E5B800] mb-4">3. Kontaktaufnahme</h2>
            <p className="mb-4">Wenn Sie uns per E-Mail, Telefon oder Formular kontaktieren, verarbeiten wir:</p>
            <ul className="list-disc pl-6 mb-4 space-y-1 marker:text-[#E5B800]">
                <li>Name</li>
                <li>E-Mail-Adresse</li>
                <li>Firmenname</li>
                <li>Telefonnummer (falls angegeben)</li>
                <li>Inhalte der Nachricht</li>
            </ul>
            <p>Diese Daten werden ausschließlich zur Bearbeitung Ihrer Anfrage genutzt (Art. 6 Abs. 1 lit. b DSGVO – vorvertragliche Maßnahmen).</p>
          </motion.section>

          <motion.section variants={fadeInUp}>
            <h2 className="text-2xl font-bold text-[#E5B800] mb-4">4. Nutzung von Betonbot – Verarbeitete Daten</h2>
            <p className="mb-4">Wenn Sie als Kunde Betonbot nutzen, verarbeiten wir folgende Daten:</p>
            
            <div className="pl-4 border-l-2 border-white/10 my-4">
                <h3 className="text-xl font-bold text-white mb-2">4.1 Nutzungsdaten</h3>
                <ul className="list-disc pl-6 mb-6 space-y-1 marker:text-[#E5B800]">
                    <li>Login-Daten</li>
                    <li>Benutzerkonten</li>
                    <li>Zeitstempel</li>
                    <li>technische Protokolle</li>
                    <li>Formularangaben für die Preisschätzung</li>
                </ul>

                <h3 className="text-xl font-bold text-white mb-2">4.2 Hochgeladene Pläne / Projektdaten</h3>
                <p className="mb-2">Der Nutzer kann folgende Daten hochladen:</p>
                <ul className="list-disc pl-6 mb-4 space-y-1 marker:text-[#E5B800]">
                    <li>Grundrisse</li>
                    <li>Baupläne</li>
                    <li>Projektdokumente</li>
                    <li>technische Zeichnungen</li>
                    <li>Angaben zu Bauvorhaben</li>
                </ul>
            </div>
            
            <p className="mb-4">Diese Daten können personenbezogene Informationen beinhalten (z. B. Adressen oder Namen auf Plänen). Wir verarbeiten diese Daten ausschließlich:</p>
            <ul className="list-disc pl-6 mb-4 space-y-1 marker:text-[#E5B800]">
                <li>zur Bereitstellung der Preisschätzung</li>
                <li>zur Verbesserung der Genauigkeit des Systems (siehe Punkt 5)</li>
            </ul>
            <p className="italic text-white/60">Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung).</p>
          </motion.section>

          <motion.section variants={fadeInUp}>
            <h2 className="text-2xl font-bold text-[#E5B800] mb-4">5. Nutzung hochgeladener Pläne zur Verbesserung von Betonbot</h2>
            <p className="mb-4">Wir verwenden hochgeladene Pläne, Grundrisse und Projektdaten ausschließlich anonymisiert, um:</p>
            <ul className="list-disc pl-6 mb-4 space-y-1 marker:text-[#E5B800]">
                <li>unsere Erkennungsmodelle zu verbessern</li>
                <li>Genauigkeiten zu erhöhen</li>
                <li>Algorithmusfehler zu erkennen</li>
                <li>Trainingsdaten zu erweitern</li>
            </ul>
            <p className="mb-4">Dies geschieht nur, weil der Kunde im Bestellformular ausdrücklich zugestimmt hat.</p>
            <p className="italic text-white/60 mb-4">Rechtsgrundlage: Art. 6 Abs. 1 lit. a DSGVO – Einwilligung des Kunden.</p>
            
            <div className="p-6 bg-[#E5B800]/10 border border-[#E5B800]/30 rounded-2xl">
                <p className="font-bold text-[#E5B800] mb-2 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#E5B800]"></span> Wichtig:
                </p>
                <ul className="list-disc pl-6 space-y-1 text-sm text-white/80 marker:text-[#E5B800]">
                    <li>Die Einwilligung ist freiwillig.</li>
                    <li>Der Kunde kann die Einwilligung jederzeit für die Zukunft widerrufen.</li>
                    <li>Ein Widerruf hat keine Auswirkungen auf bereits verarbeitete Daten.</li>
                </ul>
            </div>
          </motion.section>

          <motion.section variants={fadeInUp}>
            <h2 className="text-2xl font-bold text-[#E5B800] mb-4">6. Auftragsverarbeitung (Art. 28 DSGVO)</h2>
            <p className="mb-2">Für die Nutzung von Betonbot verarbeiten wir Daten im Auftrag des jeweiligen Unternehmens.</p>
            <p>Zur rechtlich korrekten Nutzung schließen wir mit jedem Kunden auf Wunsch einen Auftragsverarbeitungsvertrag (AVV / DPA).</p>
          </motion.section>

          <motion.section variants={fadeInUp}>
            <h2 className="text-2xl font-bold text-[#E5B800] mb-4">7. Weitergabe von Daten</h2>
            <p className="mb-2">Wir geben personenbezogene Daten nicht an Dritte weiter, mit Ausnahme:</p>
            <ul className="list-disc pl-6 mb-4 space-y-1 marker:text-[#E5B800]">
                <li>Hostinganbieter (zur technischen Bereitstellung)</li>
                <li>Dienstleister, die wir zur Vertragserfüllung benötigen (z. B. Server, E-Mail-Systeme)</li>
            </ul>
            <p>In allen Fällen achten wir auf DSGVO-konforme Verarbeitung. Es findet keine Weitergabe an Dritte zu Marketingzwecken statt.</p>
          </motion.section>

          <motion.section variants={fadeInUp}>
            <h2 className="text-2xl font-bold text-[#E5B800] mb-4">8. Speicherung & Löschung</h2>
            <p className="mb-2">Wir speichern Daten nur so lange, wie dies für:</p>
            <ul className="list-disc pl-6 mb-4 space-y-1 marker:text-[#E5B800]">
                <li>die Vertragserfüllung</li>
                <li>gesetzliche Pflichten</li>
                <li>Supportzwecke</li>
            </ul>
            <p className="mb-2">erforderlich ist.</p>
            <p>Hochgeladene Pläne können auf Wunsch jederzeit gelöscht werden. Anonymisierte Daten, die zur Verbesserung des Systems genutzt wurden, können nicht rückwirkend gelöscht werden.</p>
          </motion.section>

          <motion.section variants={fadeInUp}>
            <h2 className="text-2xl font-bold text-[#E5B800] mb-4">9. Cookies</h2>
            <p className="mb-2">Unsere Website verwendet ausschließlich technisch notwendige Cookies:</p>
            <ul className="list-disc pl-6 mb-4 space-y-1 marker:text-[#E5B800]">
                <li>Session-Cookies</li>
                <li>Login-Cookies</li>
            </ul>
            <p className="mb-2">Es werden keine Tracking- oder Werbe-Cookies eingesetzt.</p>
            <p className="italic text-white/60">Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO.</p>
          </motion.section>

          <motion.section variants={fadeInUp}>
            <h2 className="text-2xl font-bold text-[#E5B800] mb-4">10. Datenübertragung in Länder außerhalb der EU</h2>
            <p>SR Solutions AI S.R.L. ist ein EU-Unternehmen (Rumänien). Daten werden ausschließlich innerhalb der EU/EWR verarbeitet. Keine Übertragung in Drittstaaten.</p>
          </motion.section>

          <motion.section variants={fadeInUp}>
            <h2 className="text-2xl font-bold text-[#E5B800] mb-4">11. Rechte der Betroffenen</h2>
            <p className="mb-4">Sie haben folgende Rechte:</p>
            <ul className="list-disc pl-6 mb-6 space-y-1 marker:text-[#E5B800]">
                <li>Auskunft (Art. 15 DSGVO)</li>
                <li>Löschung (Art. 17 DSGVO)</li>
                <li>Berichtigung (Art. 16 DSGVO)</li>
                <li>Einschränkung (Art. 18 DSGVO)</li>
                <li>Datenübertragbarkeit (Art. 20 DSGVO)</li>
                <li>Widerspruch (Art. 21 DSGVO)</li>
                <li>Widerruf einer Einwilligung (Art. 7 Abs. 3 DSGVO)</li>
            </ul>
            <p>Anfragen richten Sie bitte an: <a href="mailto:christian@betonbot.com" className="text-[#E5B800] hover:underline">christian@betonbot.com</a></p>
          </motion.section>

          <motion.section variants={fadeInUp}>
            <h2 className="text-2xl font-bold text-[#E5B800] mb-4">12. Sicherheit</h2>
            <p className="mb-2">Wir setzen technische und organisatorische Maßnahmen ein, um Daten vor:</p>
            <ul className="list-disc pl-6 mb-2 space-y-1 marker:text-[#E5B800]">
                <li>Verlust</li>
                <li>Missbrauch</li>
                <li>unbefugtem Zugriff</li>
            </ul>
            <p>zu schützen.</p>
          </motion.section>

          <motion.section variants={fadeInUp}>
            <h2 className="text-2xl font-bold text-[#E5B800] mb-4">13. Änderungen der Datenschutzerklärung</h2>
            <p>Wir behalten uns vor, diese Datenschutzerklärung zu ändern, wenn rechtliche oder technische Gründe dies erforderlich machen.</p>
            <p>Die jeweils aktuelle Version ist jederzeit unter betonbot.com/datenschutz abrufbar.</p>
          </motion.section>

        </motion.div>
      </div>

      <FooterSection />
    </div>
  )
}