# Formular dinamic – sursa pașilor

Formularul (StepWizard) și Preisdatenbank citesc **direct** din:

**`holzbot-web/data/form-schema/holzbau-form-steps.json`**

(Import static în cod – fără fetch, fără cache.)

## Cum vezi modificările

1. Deschide și editează **`data/form-schema/holzbau-form-steps.json`** (placeholders, labels, pași, prețuri).
2. **Salvează** fișierul.
3. În dev (`npm run dev`): Next.js recompilează; dă **refresh (F5)** în browser.
4. Modificările ar trebui să apară în formular și în Preisdatenbank.

Dacă nu se actualizează: oprește dev serverul, rulează din nou `npm run dev`, apoi refresh la pagină.
