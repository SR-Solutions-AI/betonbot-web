// Minimal DE mappings for AdminDashboard (step labels + option values).
// Keep this small and deterministic; extend as needed.

export const ADMIN_STEP_LABELS_DE: Record<string, string> = {
  dateGenerale: 'Allgemeine Daten',
  client: 'Kunde',
  sistemConstructiv: 'Bausystem',
  daemmungDachdeckung: 'Dämmung & Dachdeckung',
  materialeFinisaj: 'Materialien & Ausbaustufe',
  performanta: 'Energieeffizienz',
  performantaEnergetica: 'Energieeffizienz',
  logistica: 'Baustellenbedingungen & Logistik',
  conditiiSantier: 'Baustellenbedingungen & Logistik',
  upload: 'Pläne',
}

export const ADMIN_FIELD_LABELS_DE: Record<string, string> = {
  tipSistem: 'Systemtyp',
  accesSantier: 'Baustellenzufahrt',
  tipFundatie: 'Fundamenttyp',
  tipAcoperis: 'Dachtyp',
  nivelOferta: 'Gewünschter Angebotsumfang',
  fatada: 'Fassade',
  tamplarie: 'Fenster/Türen',
  finisajInterior: 'Innenausbau',
  materialAcoperis: 'Dachmaterial',
  dachdeckung: 'Dachdeckung',
  dachstuhlTyp: 'Dachstuhl-Typ',
  daemmung: 'Dämmung',
  incalzire: 'Heizung',
  tipIncalzire: 'Heizung',
  nivelEnergetic: 'Energie',
  teren: 'Gelände',
}

export const ADMIN_OPTION_DE: Record<string, string> = {
  // Foundations
  'Placă': 'Bodenplatte',
  'Piloți': 'Pfahlgründung',
  'Soclu': 'Streifenfundament (Sockel)',

  // Roof materials
  Ziegel: 'Ziegel',
  Betonstein: 'Betonstein',
  Blech: 'Blech',
  Schindel: 'Schindel',
  Sonstiges: 'Sonstiges',
  'Țiglă': 'Dachziegel',
  'Țiglă ceramică': 'Tondachziegel',
  'Țiglă beton': 'Betondachstein',
  'Tablă': 'Blech',
  'Tablă fălțuită': 'Stehfalzblech',
  'Șindrilă bituminoasă': 'Bitumschindel',
  'Membrană': 'Membranbahn',
  'Membrană PVC': 'PVC-Bahn',
  'Hidroizolație bitum': 'Bitumenabdichtung',

  // Openings
  'PVC': 'Kunststoff',
  'Aluminiu': 'Aluminium',
  'Lemn-Aluminiu': 'Holz-Aluminium',

  // Facade
  'Tencuială': 'Putz',
  'Fibrociment': 'Faserzement',
  'Mix': 'Mischung',

  // Offer level
  'Structură': 'Rohbau/Tragwerk',
  'Structură + ferestre': 'Tragwerk + Fenster',
  'Casă completă': 'Schlüsselfertiges Haus',

  // Heating / energy
  'Gaz': 'Gas',
  'Pompa de căldură': 'Wärmepumpe',
  'Electric': 'Elektrisch',
  'KfW 55': 'KfW 55',
  'KfW 40': 'KfW 40',
  'KfW 40+': 'KfW 40+',

  // Site logistics
  'Plan': 'Eben',
  'Pantă ușoară': 'Leichte Hanglage',
  'Pantă mare': 'Starke Hanglage',
  'Ușor (camion 40t)': 'Leicht (LKW 40t)',
  'Mediu': 'Mittel',
  'Dificil': 'Schwierig',
}

export function toDeOption(raw: any): string {
  const s = typeof raw === 'string' ? raw : raw == null ? '' : String(raw)
  return ADMIN_OPTION_DE[s] ?? s
}
