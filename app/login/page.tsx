'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { LogIn, ArrowLeft, Mail, Lock } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { apiFetch } from '../lib/supabaseClient'

const HOLZBOT_LOGIN_URL = process.env.NEXT_PUBLIC_HOLZBOT_ORIGIN
  ? `${process.env.NEXT_PUBLIC_HOLZBOT_ORIGIN}/login`
  : 'http://localhost:3000/login'

const DE = {
  title: 'Anmeldung',
  email: 'E-Mail',
  password: 'Passwort',
  submit: 'Anmelden',
  back: 'Zurück zur Startseite',
  genericError: 'Anmeldung fehlgeschlagen.',
  wrongApp: 'Dieses Konto ist für Holzbot. Bitte melden Sie sich dort an:',
}

function toGermanError(msg: string | null | undefined): string {
  if (!msg) return DE.genericError
  const m = msg.toLowerCase()
  if (m.includes('invalid login credentials') || m.includes('invalid email or password'))
    return 'Ungültige Zugangsdaten.'
  if (m.includes('user not found')) return 'Benutzer nicht gefunden.'
  if (m.includes('wrong password')) return 'Falsches Passwort.'
  if (m.includes('too many') || m.includes('rate limit'))
    return 'Zu viele Versuche. Bitte später erneut versuchen.'
  if (m.includes('network') || m.includes('failed to fetch') || m.includes('cors') || m.includes('522'))
    return 'Verbindung fehlgeschlagen. Bitte Internet und Einstellungen prüfen.'
  return DE.genericError
}

const container = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.15 },
  },
}

const item = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const } },
}

const card = {
  hidden: { opacity: 0, scale: 0.96, y: 20 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const router = useRouter()

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password })

    if (err) {
      setError(err.message)
      setSubmitting(false)
      return
    }

    try {
      const me = await apiFetch('/me')
      const slug = (me?.tenant as any)?.slug
      if (slug && slug !== 'betonbau') {
        await supabase.auth.signOut()
        setError(`${DE.wrongApp} ${HOLZBOT_LOGIN_URL}`)
        setSubmitting(false)
        return
      }
    } catch {
      setError(DE.genericError)
      setSubmitting(false)
      return
    }

    router.push('/')
    setSubmitting(false)
  }

  const errorDe = toGermanError(error || undefined)
  const errorDisplay = error && (error.includes('Betonbot') || error.includes('Holzbot'))
    ? error
    : errorDe

  return (
    <div className="fixed inset-0 overflow-hidden bg-coffee-900 flex flex-col items-center justify-center px-4 py-8">
      {/* Background image (same as presentation site corner) */}
      <div
        className="absolute inset-0 bg-no-repeat bg-cover bg-center opacity-40 z-0"
        style={{ backgroundImage: "url('/images/landing-bg.png')" }}
      />
      <div className="absolute inset-0 bg-coffee-900/75 z-[1]" aria-hidden />

      {/* Animated background blobs */}
      <motion.div
        animate={{ scale: [1, 1.15, 1], opacity: [0.12, 0.2, 0.12] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-[-15%] left-[-10%] w-[120vw] h-[120vw] max-w-[700px] max-h-[700px] bg-[#E5B800]/20 blur-[100px] rounded-full pointer-events-none z-[2]"
      />
      <motion.div
        animate={{ scale: [1.1, 1, 1.1], opacity: [0.08, 0.15, 0.08] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
        className="absolute bottom-[-20%] right-[-15%] w-screen h-[100vw] max-w-[500px] max-h-[500px] bg-caramel/15 blur-[80px] rounded-full pointer-events-none z-[2]"
      />
      <motion.div
        animate={{ opacity: [0.05, 0.12, 0.05] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vw] max-w-[400px] h-[80vw] max-h-[400px] bg-[#E5B800]/10 blur-[60px] rounded-full pointer-events-none z-[2]"
      />

      {/* Subtle grid */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03] z-[2]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(229,184,0,.45) 1px, transparent 1px),
            linear-gradient(90deg, rgba(229,184,0,.45) 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
        }}
      />

      {/* Back link */}
      <motion.div
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4, delay: 0.2 }}
        className="absolute top-6 left-6 z-10"
      >
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sand/70 hover:text-[#E5B800] transition-colors text-sm font-medium"
        >
          <ArrowLeft size={18} />
          {DE.back}
        </Link>
      </motion.div>

      {/* Form card */}
      <motion.form
        variants={card}
        initial="hidden"
        animate="visible"
        onSubmit={onSubmit}
        className="relative w-full max-w-[400px] flex flex-col gap-5 overflow-hidden rounded-2xl border border-white/10 bg-coffee-800/90 p-8 shadow-2xl shadow-black/40 backdrop-blur-md z-10"
        style={{
          backgroundImage: `
            linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,0) 50%),
            radial-gradient(120% 140% at 10% 0%, rgba(229,184,0,.1), transparent 50%)
          `,
        }}
      >
        {/* Accent glow behind card */}
        <div className="absolute -top-32 -right-32 h-64 w-64 rounded-full bg-[#E5B800]/15 blur-[70px] pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 h-48 w-48 rounded-full bg-caramel/10 blur-[50px] pointer-events-none" />

        <motion.div variants={container} initial="hidden" animate="visible" className="relative flex flex-col gap-5">
          <motion.div variants={item} className="flex flex-col items-center gap-3 text-center">
            <img src="/logo.png" alt="Betonbot" className="h-[70px] w-auto object-contain opacity-95" />
            <h1 className="text-2xl font-extrabold tracking-tight text-(--color-sun)">{DE.title}</h1>
            <p className="text-xs text-sand/60">Bitte melden Sie sich an, um fortzufahren.</p>
          </motion.div>

          <motion.label variants={item} className="block">
            <span className="mb-1.5 flex items-center gap-2 text-sm font-medium text-sand/90">
              <Mail size={14} className="text-[#E5B800]/80" />
              {DE.email}
            </span>
            <input
              className="sun-input w-full"
              placeholder={DE.email}
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </motion.label>

          <motion.label variants={item} className="block">
            <span className="mb-1.5 flex items-center gap-2 text-sm font-medium text-sand/90">
              <Lock size={14} className="text-[#E5B800]/80" />
              {DE.password}
            </span>
            <input
              className="sun-input w-full"
              placeholder={DE.password}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </motion.label>

          <AnimatePresence mode="wait">
            {error && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25 }}
                className="overflow-hidden rounded-xl border border-[#E5B800]/40 bg-[#E5B800]/10 px-3 py-2.5 text-center text-sm text-[#E5B800]"
              >
                {errorDisplay}
              </motion.p>
            )}
          </AnimatePresence>

          <motion.div variants={item}>
            <motion.button
              type="submit"
              disabled={submitting}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="btn-accent w-full flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-wait disabled:transform-none"
            >
              {submitting ? (
                <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <>
                  <LogIn size={18} />
                  {DE.submit}
                </>
              )}
            </motion.button>
          </motion.div>
        </motion.div>
      </motion.form>
    </div>
  )
}
