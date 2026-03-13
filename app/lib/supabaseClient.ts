'use client'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Debug: verificăm dacă variabilele de mediu sunt setate
if (typeof window !== 'undefined') {
  if (!url || !anon) {
    console.error('❌ [SUPABASE] Variabilele de mediu lipsesc!', {
      hasUrl: !!url,
      hasAnon: !!anon,
    })
  } else {
    console.log('✅ [SUPABASE] Configurație OK', {
      url: url.substring(0, 30) + '...',
      hasAnon: !!anon,
    })
  }
}

export const supabase = createClient(url, anon)

const DEFAULT_API_TIMEOUT_MS = 90_000 // 90s – pipeline-ul (roof 3D, garage, blacklist) poate dura mult

export type ApiFetchOptions = RequestInit & { timeoutMs?: number }

export async function apiFetch(path: string, options: ApiFetchOptions = {}) {
    const { timeoutMs = DEFAULT_API_TIMEOUT_MS, ...fetchOptions } = options
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    
    // MODIFICARE CRITICĂ: Adăugăm fallback la http://localhost:4000
    const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

    const isFormData = typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData
    const headers: Record<string, string> = {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(fetchOptions.headers as Record<string, string> || {})
    }

    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base
    const cleanPath = path.startsWith('/') ? path : `/${path}`
    
    const needsApiPrefix = cleanBase.includes('api.holzbot.com') && !cleanPath.startsWith('/api')
    const finalPath = needsApiPrefix ? `/api${cleanPath}` : cleanPath

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    
    try {
      const res = await fetch(`${cleanBase}${finalPath}`, { 
        ...fetchOptions, 
        headers,
        signal: controller.signal 
      })
      clearTimeout(timeoutId)
      
      if (!res.ok) {
        if (res.status === 404 && /\/offers\/[^/]+\/export-url$/.test(cleanPath)) {
            return { url: null }
        }
        const errorText = await res.text().catch(() => res.statusText)
        console.error(`API Fetch Error [${res.status}] la ${cleanBase}${cleanPath}:`, errorText)
        let message = `${res.status} ${res.statusText}`
        try {
          const body = JSON.parse(errorText)
          if (body?.message) message = body.message
        } catch {
          if (errorText) message = errorText.slice(0, 200)
        }
        throw new Error(message)
      }

      const contentType = res.headers.get('content-type')
      if (contentType && contentType.includes('application/json')) return res.json()
      return res.text().then((t) => {
        try { return JSON.parse(t) } catch { return { raw: t } }
      })
    } catch (error: any) {
      clearTimeout(timeoutId)
      if (error.name === 'AbortError') {
        console.error(`API Fetch Timeout (>${timeoutMs / 1000}s) la ${cleanBase}${finalPath}`)
        throw new Error('Request timeout - server took too long to respond')
      }
      throw error
    }
}