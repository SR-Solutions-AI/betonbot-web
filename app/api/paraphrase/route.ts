// apps/web/app/api/paraphrase/route.ts
import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json()

    const system =
      'Parafrazează concis în limba GERMANA, păstrând sensul tehnic și notarea matematică. Nu introduce cifre/variabile noi. Păstrează prefixul "AI:", "FORMULĂ:", "REZULTAT:".'
    const user = `Parafrazează textul următor, in limba GERMANA. Dacă există LaTeX între $...$ sau $$...$$, păstrează-l neschimbat si elimina toate cuvintele sau comentariile din calcule si sterge cuvantul FORMULA sau alte abrevieri:\n\n${text}`

    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    })

    const out = resp.choices?.[0]?.message?.content ?? text
    return NextResponse.json({ text: out })
  } catch (e: any) {
    return NextResponse.json(
      { text: '', error: String(e?.message || e) },
      { status: 200 }
    )
  }
}
