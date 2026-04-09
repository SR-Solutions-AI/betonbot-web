import { readFile } from 'fs/promises'
import path from 'path'
import { PDFDocument } from 'pdf-lib'
import { NextResponse } from 'next/server'

/** Titlu în metadata PDF + nume fișier la deschidere (evită „(anonymous)” în viewer). */
const SAMPLE_OFFER_TITLE = 'BTN-2026-0072'

const KIND_MAP: Record<string, { file: string; stem: string }> = {
  angebot: { file: 'angebot.pdf', stem: `${SAMPLE_OFFER_TITLE}-Angebot` },
  mengenermittlung: { file: 'mengenermittlung.pdf', stem: `${SAMPLE_OFFER_TITLE}-Mengenermittlung` },
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ kind: string }> },
) {
  const { kind } = await context.params
  const meta = KIND_MAP[kind]
  if (!meta) {
    return new NextResponse('Not found', { status: 404 })
  }

  const filePath = path.join(process.cwd(), 'public', meta.file)
  try {
    const buf = await readFile(filePath)
    const pdf = await PDFDocument.load(buf)
    pdf.setTitle(SAMPLE_OFFER_TITLE)
    pdf.setSubject(meta.stem)
    const out = await pdf.save()
    const filename = `${meta.stem}.pdf`
    return new NextResponse(Buffer.from(out), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (e) {
    console.error('[sample-pdf]', kind, e)
    return new NextResponse('PDF unavailable', { status: 500 })
  }
}
