/**
 * Script: citește holzbau-form-steps.json (formular + prețuri),
 * construiește dinamic pașii formularului și secțiunile de prețuri.
 * Rulează: npx tsx scripts/load-form-schema.ts
 */

import * as fs from 'fs'
import * as path from 'path'
import { buildFormFromJson } from '../lib/buildFormFromJson'

const FORM_STEPS_PATH = path.join(__dirname, '..', 'data', 'form-schema', 'holzbau-form-steps.json')

function main() {
  let formStepsRaw: unknown

  try {
    formStepsRaw = JSON.parse(fs.readFileSync(FORM_STEPS_PATH, 'utf-8'))
  } catch (e) {
    console.error('Eroare la citirea holzbau-form-steps.json:', e)
    process.exit(1)
  }

  const { steps, priceSections } = buildFormFromJson(formStepsRaw)

  console.log('--- Formular (pași) ---')
  console.log('Număr pași:', steps.length)
  steps.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.key}: ${s.label} (${s.fields.length} câmpuri)`)
  })

  console.log('\n--- Prețuri (secțiuni) ---')
  console.log('Număr secțiuni:', priceSections.length)
  priceSections.forEach((sec, i) => {
    const totalVars = sec.subsections.reduce((acc, sub) => acc + sub.variables.length, 0)
    console.log(`  ${i + 1}. ${sec.title}: ${totalVars} variabile`)
  })

  console.log('\nOK – formularul și prețurile pot fi construite dinamic din JSON.')
}

main()
