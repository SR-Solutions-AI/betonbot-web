// apps/web/app/api/paraphrase/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/app/lib/supabase-server'

const DEFAULT_FAST_MODEL = 'gemini-2.0-flash'

type GeminiGenerateResult = { ok: true; text: string } | { ok: false; error: string }

async function geminiGenerateText(params: {
  apiKey: string
  model: string
  systemInstruction: string
  userText: string
  temperature: number
  maxOutputTokens: number
}): Promise<GeminiGenerateResult> {
  const { apiKey, model, systemInstruction, userText, temperature, maxOutputTokens } = params
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: {
      temperature,
      maxOutputTokens,
    },
  }
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      const errBody = await resp.text()
      return { ok: false, error: `Gemini HTTP ${resp.status}: ${errBody.slice(0, 400)}` }
    }
    const data = (await resp.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const parts = data?.candidates?.[0]?.content?.parts
    const out = parts?.[0]?.text
    if (typeof out === 'string' && out.trim()) {
      return { ok: true, text: out.trim() }
    }
    return { ok: false, error: 'Răspuns Gemini gol sau invalid' }
  } catch (e: unknown) {
    return { ok: false, error: String(e instanceof Error ? e.message : e) }
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const apiKey = process.env.GEMINI_API_KEY?.trim()
    if (!apiKey) {
      return NextResponse.json(
        { text: '', error: 'GEMINI_API_KEY lipsește din environment' },
        { status: 503 }
      )
    }

    const { text } = await req.json()
    const model =
      process.env.GEMINI_MODEL_FAST?.trim() || DEFAULT_FAST_MODEL

    const system =
      'Parafrazează concis în limba GERMANA, păstrând sensul tehnic și notarea matematică. Nu introduce cifre/variabile noi. Păstrează prefixul "AI:", "FORMULĂ:", "REZULTAT:".'
    const user = `Parafrazează textul următor, in limba GERMANA. Dacă există LaTeX între $...$ sau $$...$$, păstrează-l neschimbat si elimina toate cuvintele sau comentariile din calcule si sterge cuvantul FORMULA sau alte abrevieri:\n\n${text}`

    const result = await geminiGenerateText({
      apiKey,
      model,
      systemInstruction: system,
      userText: user,
      temperature: 0.7,
      maxOutputTokens: 4096,
    })

    if (!result.ok) {
      return NextResponse.json({ text: '', error: result.error }, { status: 200 })
    }
    return NextResponse.json({ text: result.text })
  } catch (e: unknown) {
    return NextResponse.json(
      { text: '', error: String(e instanceof Error ? e.message : e) },
      { status: 200 }
    )
  }
}
