import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'

export const dynamic = 'force-dynamic'

/**
 * GET /api/form-schema?tenant=holzbau
 * Citește JSON-ul de pe disc la fiecare request (fără cache).
 * Rădăcina proiectului = process.cwd() (folderul din care rulează next dev).
 */
export async function GET(req: NextRequest) {
  try {
    const tenant = req.nextUrl.searchParams.get('tenant') || 'holzbau'
    const filePath = path.join(process.cwd(), 'data', 'form-schema', `${tenant}-form-steps.json`)
    const content = await readFile(filePath, 'utf-8')
    const data = JSON.parse(content)
    if (process.env.NODE_ENV === 'development') {
      console.log('[form-schema] served', filePath, 'steps:', (data as { steps?: unknown[] }).steps?.length)
    }
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        Pragma: 'no-cache',
      },
    })
  } catch (e) {
    console.error('[form-schema] error', (e as NodeJS.ErrnoException).message, 'cwd:', process.cwd())
    return NextResponse.json({ error: 'Schema not found' }, { status: 404 })
  }
}
