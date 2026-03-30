// app/formConfig.ts
export type Field =
  | { type: 'text'; name: string; label: string; placeholder?: string }
  | { type: 'textarea'; name: string; label: string; placeholder?: string }
  | { type: 'number'; name: string; label: string; min?: number; max?: number }
  | { type: 'bool'; name: string; label: string; tag?: string }
  | { type: 'select'; name: string; label: string; options: string[]; tag?: string }
  | { type: 'upload'; name: string; label: string; accept?: string; optional?: boolean; multiple?: boolean }
  | { type: 'price'; name: string; label: string; unit: string; default: number };

export type Step = {
  key: string
  label: string
  subtitle?: string
  fields: Field[]
  /** Grup Preisdatenbank: pași cu același key sunt în același card */
  priceSectionKey?: string
  /** Titlul cardului (folosit de primul pas din grup) */
  priceSectionTitle?: string
  /** Subtitlul cardului (folosit de primul pas din grup) */
  priceSectionSubtitle?: string
};

/** Type guard: field is price (Preisdatenbank variable) */
export function isPriceField(f: Field): f is { type: 'price'; name: string; label: string; unit: string; default: number } {
  return f.type === 'price';
}

/**
 * Modificări:
 * 1) am inversat pasul 1 cu 2: "dateGenerale" devine primul pas (include doar "referinta")
 * 2) am eliminat complet câmpul "beci"
 */
export const formSteps: Step[] = [
  // 1) Date generale proiect — primul pas (denumire)
  {
    key: 'dateGenerale',
    label: 'Allgemeine Projektdaten (Bezeichnung)',
    fields: [
      { type: 'text', name: 'referinta', label: 'Bezeichnung / Referenz', placeholder: 'z.B.: Einfamilienhaus 150 m²' },
      // { type: 'bool', name: 'beci', label: 'Beci subteran' }, // ELIMINAT conform cerinței
    ],
  },

  // 2) Kundendaten
  {
    key: 'client',
    label: 'Kundendaten',
    fields: [
      { type: 'text', name: 'nume',       label: 'Vor- und Nachname', placeholder: 'z.B. Max Mustermann' },
      { type: 'text', name: 'telefon',    label: 'Telefonnummer', placeholder: 'z.B. +49 123 456789' },
      { type: 'text', name: 'email',      label: 'E-Mail', placeholder: 'z.B. max@beispiel.de' },
      { type: 'text', name: 'localitate', label: 'Adresse', placeholder: 'Straße, PLZ Ort' },
    ],
  },

  // 3) Allgemeine Projektinformationen (Systemtyp removed)
  {
    key: 'sistemConstructiv',
    label: 'Allgemeine Projektinformationen',
    fields: [
      { type: 'select', name: 'nivelOferta', label: 'Angebotsumfang', options: ['Structură', 'Structură + ferestre', 'Casă completă'] },
      { type: 'select', name: 'accesSantier', label: 'Baustellenzufahrt', options: ['Ușor (camion 40t)', 'Mediu', 'Dificil'] },
      { type: 'select', name: 'teren',       label: 'Gelände: eben oder Hang?', options: ['Plan', 'Pantă ușoară', 'Pantă mare'] },
      { type: 'bool',   name: 'utilitati',   label: 'Strom-/Wasseranschluss vorhanden' },
    ],
  },

  // 3.5) Gebäudestruktur (vizual) – includes hasWintergarden / hasBalkone for optional step Wintergärten & Balkone
  {
    key: 'structuraCladirii',
    label: 'Gebäudestruktur',
    fields: [
      { type: 'select', name: 'tipFundatieBeci', label: 'Untergeschoss / Fundament', options: ['Kein Keller (nur Bodenplatte)', 'Keller (unbeheizt / Nutzkeller)', 'Keller (mit einfachem Ausbau)'] },
      { type: 'bool', name: 'pilons', label: 'Pfahlgründung erforderlich' },
      { type: 'select', name: 'inaltimeEtaje', label: 'Raumhöhe', options: ['Standard (2,50 m)', 'Komfort (2,70 m)', 'Hoch (2,85+ m)'] },
      { type: 'bool', name: 'hasWintergarden', label: 'Wintergarten vorhanden' },
      { type: 'bool', name: 'hasBalkone', label: 'Balkone vorhanden' },
    ],
  },

  // 3.55) Wintergärten & Balkone (shown only if hasWintergarden or hasBalkone in Gebäudestruktur)
  {
    key: 'wintergaertenBalkone',
    label: 'Wintergärten & Balkone',
    fields: [
      { type: 'select', name: 'wintergartenTyp', label: 'Wintergärten', options: ['Glaswand', 'Plexiglaswand'] },
      { type: 'select', name: 'balkonTyp', label: 'Balkone', options: ['Holzgeländer', 'Stahlgeländer', 'Glasgeländer'] },
    ],
  },

  // 3.6) Dämmung & Dachdeckung (din formular acoperiș)
  {
    key: 'daemmungDachdeckung',
    label: 'Dämmung & Dachdeckung',
    fields: [
      { type: 'select', name: 'daemmung', label: 'Dämmung', options: ['Keine', 'Zwischensparren', 'Aufsparren', 'Kombination'] },
      { type: 'select', name: 'unterdach', label: 'Unterdach', options: ['Folie', 'Schalung + Folie'] },
      { type: 'select', name: 'dachstuhlTyp', label: 'Dachstuhl-Typ', options: ['Sparrendach', 'Pfettendach', 'Kehlbalkendach', 'Sonderkonstruktion'] },
      { type: 'bool',   name: 'sichtdachstuhl', label: 'Sichtdachstuhl' },
      { type: 'select', name: 'dachdeckung', label: 'Dachdeckung', options: ['Ziegel', 'Betonstein', 'Blech', 'Schindel', 'Sonstiges'] },
    ],
  },

  // 3.7) Ferestre și uși
  {
    key: 'ferestreUsi',
    label: 'Fenster & Türen',
    fields: [
      { type: 'select', name: 'windowQuality', label: 'Fensterart (Preis 2-/3-fach)', options: ['2-fach verglast', '3-fach verglast', '3-fach verglast, Passiv'] },
      { type: 'select', name: 'doorMaterialInterior', label: 'Innentüren (Preis pro Stück)', options: ['Standard', 'Holz', 'Glas', 'Weiß lackiert'], tag: 'door_material_interior' },
      { type: 'select', name: 'doorMaterialExterior', label: 'Außentüren (Preis pro Stück)', options: ['Standard', 'Holz', 'Aluminium', 'Kunststoff'], tag: 'door_material_exterior' },
      { type: 'bool', name: 'garagentorGewuenscht', label: 'Garagentor gewünscht' },
      {
        type: 'select',
        name: 'garageDoorType',
        label: 'Garagentor',
        options: ['Sektionaltor Standard', 'Sektionaltor Premium', 'Rolltor', 'Schwingtor', 'Seiten-Sektionaltor'],
        tag: 'garage_door_type',
      },
    ],
  },

  // 3.9) Wandaufbau (per-floor Außenwände / Innenwände, before Materialien)
  {
    key: 'wandaufbau',
    label: 'Wandaufbau',
    fields: [
      // Câmpurile dinamice per etaj sunt generate în WandaufbauStep (außenwande_ground, innenwande_ground, etc.)
    ],
  },

  // 4) Materialien & Ausbaustufe
  {
    key: 'materialeFinisaj',
    label: 'Materialien & Ausbaustufe',
    fields: [
      // Câmpurile dinamice vor fi generate în componenta specială MaterialeFinisajStep
      // Dachmaterial a fost mutat în Dämmung & Dachdeckung (dachdeckung)
    ],
  },

  // 4.5) Geschossdecken und Bodenaufbauten
  {
    key: 'bodenDeckeBelag',
    label: 'Geschossdecken und Bodenaufbauten',
    fields: [],
  },

  // 5) Energieeffizienz & Heizung
  {
    key: 'performantaEnergetica',
    label: 'Energieeffizienz & Heizung',
    fields: [
      { type: 'select', name: 'nivelEnergetic', label: 'Gewünschtes Energieniveau', options: ['Standard', 'KfW 55', 'KfW 40', 'KfW 40+'] },
      { type: 'select', name: 'tipIncalzire',   label: 'Heizungssystem', options: ['Gaz', 'Pompa de căldură', 'Electric'] },
      { type: 'bool',   name: 'ventilatie',     label: 'Lüftung / Wärmerückgewinnung' },
      { type: 'select', name: 'tipSemineu', label: 'Welchen Kamin / Ofen wünscht der Kunde?', options: ['Kein Kamin', 'Klassischer Holzofen', 'Moderner Design-Kaminofen', 'Pelletofen (automatisch)', 'Einbaukamin', 'Kachel-/wassergeführter Kamin'] },
    ],
  },

  // 7) Datei-Upload
  {
    key: 'upload',
    label: 'Datei-Upload',
    fields: [
      {
        type: 'upload',
        name: 'planArhitectural',
        label: 'Einreichplan',
        accept: '.pdf,.jpg,.jpeg,.png,.dwg',
        multiple: true, // 👈 AICI
      },
      { type: 'upload', name: 'fotografii',   label: 'Fotos / Renderings', accept: '.pdf,.jpg,.jpeg,.png', optional: true },
      { type: 'upload', name: 'documentatie', label: 'Zusätzliche Dokumentation', accept: '.pdf,.jpg,.jpeg,.png,.zip', optional: true },
    ],
  },

];

/** Flow scurt pentru Dachstuhl: dateGenerale → client → projektdaten → Dämmung & Dachdeckung → upload */
export const formStepsDachstuhl: Step[] = [
  {
    key: 'dateGenerale',
    label: 'Allgemeine Projektdaten (Bezeichnung)',
    fields: [
      { type: 'text', name: 'referinta', label: 'Bezeichnung / Referenz', placeholder: 'z.B.: Einfamilienhaus 150 m²' },
    ],
  },
  {
    key: 'client',
    label: 'Kundendaten',
    fields: [
      { type: 'text', name: 'nume',       label: 'Vor- und Nachname', placeholder: 'z.B. Max Mustermann' },
      { type: 'text', name: 'telefon',    label: 'Telefonnummer', placeholder: 'z.B. +49 123 456789' },
      { type: 'text', name: 'email',      label: 'E-Mail', placeholder: 'z.B. max@beispiel.de' },
      { type: 'text', name: 'localitate', label: 'Adresse', placeholder: 'Straße, PLZ Ort' },
    ],
  },
  {
    key: 'projektdaten',
    label: 'Projektdaten',
    fields: [
      { type: 'select', name: 'projektumfang', label: 'Projektumfang', options: ['Dachstuhl', 'Dachdeckung', 'Dachstuhl + Dachdeckung'] },
      { type: 'select', name: 'nutzungDachraum', label: 'Nutzung des Dachraums', options: ['Nicht ausgebaut', 'Wohnraum / ausgebaut'] },
      { type: 'select', name: 'deckenInnenausbau', label: 'Decken-Innenausbau', options: ['Standard', 'Premium', 'Exklusiv'], tag: 'decke_innenausbau' },
    ],
  },
  {
    key: 'daemmungDachdeckung',
    label: 'Dämmung & Dachdeckung',
    fields: [
      { type: 'select', name: 'daemmung', label: 'Dämmung', options: ['Keine', 'Zwischensparren', 'Aufsparren', 'Kombination'], tag: 'roof_insulation' },
      { type: 'select', name: 'unterdach', label: 'Unterdach', options: ['Folie', 'Schalung + Folie'], tag: 'under_roof' },
      { type: 'select', name: 'dachstuhlTyp', label: 'Dachstuhl-Typ', options: ['Sparrendach', 'Pfettendach', 'Kehlbalkendach', 'Sonderkonstruktion'], tag: 'roof_structure_type' },
      { type: 'bool',   name: 'sichtdachstuhl', label: 'Sichtdachstuhl' },
      { type: 'bool',   name: 'dachfensterImDach', label: 'Dachfenster einplanen', tag: 'roof_skylights' },
      {
        type: 'select',
        name: 'dachfensterTyp',
        label: 'Dachfenster-Ausführung',
        options: ['Standard', 'Velux', 'Roto', 'Fakro', 'Sonstiges'],
        tag: 'roof_skylight_type',
      },
      { type: 'select', name: 'dachdeckung', label: 'Dachdeckung', options: ['Ziegel', 'Betonstein', 'Blech', 'Schindel', 'Sonstiges'], tag: 'roof_covering' },
    ],
  },
  {
    key: 'upload',
    label: 'Datei-Upload',
    fields: [
      { type: 'upload', name: 'planArhitectural', label: 'Einreichplan', accept: '.pdf,.jpg,.jpeg,.png,.dwg', multiple: true },
      { type: 'upload', name: 'fotografii',   label: 'Fotos / Renderings', accept: '.pdf,.jpg,.jpeg,.png', optional: true },
      { type: 'upload', name: 'documentatie', label: 'Zusätzliche Dokumentation', accept: '.pdf,.jpg,.jpeg,.png,.zip', optional: true },
    ],
  },
];

/**
 * Structura Preisdatenbank: pași cu câmpuri type 'price'.
 * Gruparea: priceSectionKey = același → același card; fiecare pas = o subsectiune.
 * Titlul/subtitlul cardului: priceSectionTitle / priceSectionSubtitle pe primul pas din grup.
 */
export const preisdatenbankSteps: Step[] = [
  {
    key: 'preis_wande_aussen',
    label: 'Außenwände',
    priceSectionKey: 'quadratmeter_wande',
    priceSectionTitle: 'Quadratmeterpreise – Wände',
    priceSectionSubtitle: 'Preise pro m² für Wände und Fassade',
    fields: [
      { type: 'price', name: 'aussenwand', label: 'Außenwände Standard', unit: '€/m²', default: 185 },
      { type: 'price', name: 'fassade_putz', label: 'Fassade Putz', unit: '€/m²', default: 65 },
      { type: 'price', name: 'fassade_klinker', label: 'Fassade Klinker', unit: '€/m²', default: 145 },
    ],
  },
  {
    key: 'preis_wande_innen',
    label: 'Innenwände',
    priceSectionKey: 'quadratmeter_wande',
    fields: [
      { type: 'price', name: 'innenwand', label: 'Innenwände', unit: '€/m²', default: 120 },
      { type: 'price', name: 'innenputz', label: 'Innenputz', unit: '€/m²', default: 42 },
    ],
  },
  {
    key: 'preis_decken',
    label: 'Decken',
    priceSectionKey: 'quadratmeter_decken_boden',
    priceSectionTitle: 'Quadratmeterpreise – Decken & Böden',
    priceSectionSubtitle: 'Preise pro m² für Decken und Bodenbeläge',
    fields: [
      { type: 'price', name: 'decke', label: 'Decken', unit: '€/m²', default: 95 },
      { type: 'price', name: 'tapete', label: 'Tapete', unit: '€/m²', default: 28 },
    ],
  },
  {
    key: 'preis_boden',
    label: 'Böden',
    priceSectionKey: 'quadratmeter_decken_boden',
    fields: [
      { type: 'price', name: 'boden', label: 'Böden', unit: '€/m²', default: 85 },
      { type: 'price', name: 'estrich', label: 'Estrich', unit: '€/m²', default: 38 },
      { type: 'price', name: 'fliesen', label: 'Fliesen', unit: '€/m²', default: 72 },
      { type: 'price', name: 'parkett', label: 'Parkett / Laminat', unit: '€/m²', default: 88 },
    ],
  },
  {
    key: 'preis_dach_flaeche',
    label: 'Dachfläche',
    priceSectionKey: 'quadratmeter_dach',
    priceSectionTitle: 'Quadratmeterpreise – Dach',
    priceSectionSubtitle: 'Dachfläche und Dachzubehör',
    fields: [
      { type: 'price', name: 'dach', label: 'Dachfläche', unit: '€/m²', default: 220 },
      { type: 'price', name: 'dachfenster', label: 'Dachfenster (Dachfläche)', unit: '€/m²', default: 0 },
    ],
  },
  {
    key: 'preis_dach_zubehoer',
    label: 'Dachzubehör',
    priceSectionKey: 'quadratmeter_dach',
    fields: [
      { type: 'price', name: 'dachrinne', label: 'Dachrinne (lfm)', unit: '€/m', default: 55 },
    ],
  },
  {
    key: 'preis_dachfenster_neubau',
    label: 'Dachfenster (Neubau)',
    priceSectionKey: 'stueck_dachfenster_neubau',
    priceSectionTitle: 'Stückpreise – Dachfenster (Hausbau)',
    priceSectionSubtitle: 'Entspricht Formular „Dachfenster-Ausführung“; Anzahl aus Dach-Editor',
    fields: [
      { type: 'price', name: 'dachfenster_stueck_standard', label: 'Standard', unit: '€/Stück', default: 650 },
      { type: 'price', name: 'dachfenster_stueck_velux', label: 'Velux', unit: '€/Stück', default: 890 },
      { type: 'price', name: 'dachfenster_stueck_roto', label: 'Roto', unit: '€/Stück', default: 820 },
      { type: 'price', name: 'dachfenster_stueck_fakro', label: 'Fakro', unit: '€/Stück', default: 850 },
      { type: 'price', name: 'dachfenster_stueck_sonstiges', label: 'Sonstiges', unit: '€/Stück', default: 750 },
    ],
  },
  {
    key: 'preis_dachfenster_roofonly',
    label: 'Dachfenster (nur Dach)',
    priceSectionKey: 'stueck_dachfenster_roofonly',
    priceSectionTitle: 'Stückpreise – Dachfenster (nur Dach)',
    priceSectionSubtitle: 'Gleiche Logik wie Neubau, eigene Keys für Dachstuhl-Paket',
    fields: [
      { type: 'price', name: 'roofonly_dachfenster_stueck_standard', label: 'Standard', unit: '€/Stück', default: 650 },
      { type: 'price', name: 'roofonly_dachfenster_stueck_velux', label: 'Velux', unit: '€/Stück', default: 890 },
      { type: 'price', name: 'roofonly_dachfenster_stueck_roto', label: 'Roto', unit: '€/Stück', default: 820 },
      { type: 'price', name: 'roofonly_dachfenster_stueck_fakro', label: 'Fakro', unit: '€/Stück', default: 850 },
      { type: 'price', name: 'roofonly_dachfenster_stueck_sonstiges', label: 'Sonstiges', unit: '€/Stück', default: 750 },
    ],
  },
  {
    key: 'preis_fenster',
    label: 'Standard',
    priceSectionKey: 'stueck_fenster',
    priceSectionTitle: 'Stückpreise – Fenster',
    priceSectionSubtitle: 'Pauschalpreise pro Fenster',
    fields: [
      { type: 'price', name: 'fenster', label: 'Fenster (Stück)', unit: '€', default: 450 },
      { type: 'price', name: 'kellerfenster', label: 'Kellerfenster', unit: '€', default: 220 },
      { type: 'price', name: 'dachfenster_stueck', label: 'Dachfenster (Stück)', unit: '€', default: 890 },
    ],
  },
  {
    key: 'preis_fenster_zubehoer',
    label: 'Zubehör',
    priceSectionKey: 'stueck_fenster',
    fields: [
      { type: 'price', name: 'rollladen', label: 'Rolladen (Stück)', unit: '€', default: 340 },
    ],
  },
  {
    key: 'preis_tueren_innen',
    label: 'Innentüren',
    priceSectionKey: 'stueck_tueren',
    priceSectionTitle: 'Stückpreise – Türen',
    priceSectionSubtitle: 'Entspricht Innen-/Außentüren im Formular',
    fields: [
      { type: 'price', name: 'door_interior_standard', label: 'Innen Standard', unit: '€/Stück', default: 320 },
      { type: 'price', name: 'door_interior_holz', label: 'Innen Holz', unit: '€/Stück', default: 580 },
      { type: 'price', name: 'door_interior_glas', label: 'Innen Glas', unit: '€/Stück', default: 890 },
      { type: 'price', name: 'door_interior_weiss_lackiert', label: 'Innen Weiß lackiert', unit: '€/Stück', default: 420 },
    ],
  },
  {
    key: 'preis_tueren_aussen',
    label: 'Außentüren',
    priceSectionKey: 'stueck_tueren',
    fields: [
      { type: 'price', name: 'door_exterior_standard', label: 'Außen Standard', unit: '€/Stück', default: 1450 },
      { type: 'price', name: 'door_exterior_holz', label: 'Außen Holz', unit: '€/Stück', default: 2200 },
      { type: 'price', name: 'door_exterior_aluminium', label: 'Außen Aluminium', unit: '€/Stück', default: 2800 },
      { type: 'price', name: 'door_exterior_kunststoff', label: 'Außen Kunststoff', unit: '€/Stück', default: 1600 },
    ],
  },
  {
    key: 'preis_garagentor',
    label: 'Garagentor',
    priceSectionKey: 'stueck_garagentor',
    priceSectionTitle: 'Stückpreise – Garagentor',
    priceSectionSubtitle: 'Nur wenn „Garagentor gewünscht“ im Formular',
    fields: [
      { type: 'price', name: 'garage_door_sektional_standard_stueck', label: 'Sektionaltor Standard', unit: '€/Stück', default: 2400 },
      { type: 'price', name: 'garage_door_sektional_premium_stueck', label: 'Sektionaltor Premium', unit: '€/Stück', default: 3200 },
      { type: 'price', name: 'garage_door_rolltor_stueck', label: 'Rolltor', unit: '€/Stück', default: 2100 },
      { type: 'price', name: 'garage_door_schwingtor_stueck', label: 'Schwingtor', unit: '€/Stück', default: 1800 },
      { type: 'price', name: 'garage_door_seiten_sektional_stueck', label: 'Seiten-Sektionaltor', unit: '€/Stück', default: 3800 },
    ],
  },
  {
    key: 'preis_sub_dach',
    label: 'Dach & Fassade',
    priceSectionKey: 'subunternehmer_bau',
    priceSectionTitle: 'Subunternehmer – Bau',
    priceSectionSubtitle: 'Externe Gewerke Rohbau',
    fields: [
      { type: 'price', name: 'dachdecker', label: 'Dachdecker', unit: '€/m²', default: 95 },
      { type: 'price', name: 'maurer', label: 'Maurer', unit: '€/m²', default: 75 },
    ],
  },
  {
    key: 'preis_sub_fenster',
    label: 'Fenster & Türen',
    priceSectionKey: 'subunternehmer_bau',
    fields: [
      { type: 'price', name: 'fenster_lieferant', label: 'Fensterlieferant', unit: '€/m²', default: 320 },
    ],
  },
  {
    key: 'preis_sub_elektrik',
    label: 'Elektrik & Sanitär',
    priceSectionKey: 'subunternehmer_ausbau',
    priceSectionTitle: 'Subunternehmer – Ausbau',
    priceSectionSubtitle: 'Externe Gewerke Innenausbau',
    fields: [
      { type: 'price', name: 'elektriker', label: 'Elektriker', unit: '€/m²', default: 58 },
      { type: 'price', name: 'sanitaer', label: 'Sanitär', unit: '€/m²', default: 82 },
      { type: 'price', name: 'heizung', label: 'Heizung / Lüftung', unit: '€/m²', default: 95 },
    ],
  },
  {
    key: 'preis_sub_innenausbau',
    label: 'Innenausbau',
    priceSectionKey: 'subunternehmer_ausbau',
    fields: [
      { type: 'price', name: 'maler', label: 'Maler', unit: '€/m²', default: 28 },
      { type: 'price', name: 'fliesenleger', label: 'Fliesenleger', unit: '€/m²', default: 45 },
      { type: 'price', name: 'estrich_unternehmer', label: 'Estrich', unit: '€/m²', default: 32 },
      { type: 'price', name: 'trockenbau', label: 'Trockenbau', unit: '€/m²', default: 38 },
    ],
  },
  {
    key: 'preis_zusatz_baustelle',
    label: 'Baustelle',
    priceSectionKey: 'zusatz_pauschalen',
    priceSectionTitle: 'Zusatzkosten – Pauschalen',
    priceSectionSubtitle: 'Gerüst, Entsorgung, Anschluss',
    fields: [
      { type: 'price', name: 'geruest', label: 'Gerüst (Pauschale)', unit: '€', default: 1200 },
      { type: 'price', name: 'container', label: 'Container / Entsorgung', unit: '€', default: 450 },
      { type: 'price', name: 'anschluss', label: 'Anschlusskosten (Pauschale)', unit: '€', default: 850 },
    ],
  },
  {
    key: 'preis_zusatz_prozent',
    label: 'Aufschläge',
    priceSectionKey: 'zusatz_prozent_fahrt',
    priceSectionTitle: 'Zusatzkosten – Prozente & Fahrt',
    priceSectionSubtitle: 'Bauleitung, Risiko, Fahrtkosten',
    fields: [
      { type: 'price', name: 'bauleitung', label: 'Bauleitung (% vom Netto)', unit: '%', default: 4 },
      { type: 'price', name: 'risiko', label: 'Risiko / Unvorhersehbares', unit: '%', default: 3 },
      { type: 'price', name: 'gewaehrleistung', label: 'Gewährleistungsrücklage', unit: '%', default: 2 },
    ],
  },
  {
    key: 'preis_zusatz_fahrt',
    label: 'Anfahrt',
    priceSectionKey: 'zusatz_prozent_fahrt',
    fields: [
      { type: 'price', name: 'fahrtkosten', label: 'Fahrtkosten (pro km)', unit: '€', default: 0.85 },
      { type: 'price', name: 'mindestfahrt', label: 'Mindestfahrtpauschale', unit: '€', default: 95 },
    ],
  },
  {
    key: 'preis_sonder_flaechen',
    label: 'Sonderflächen',
    priceSectionKey: 'sonderpositionen',
    priceSectionTitle: 'Sonderpositionen',
    priceSectionSubtitle: 'Individuelle Preise für Sonderwünsche',
    fields: [
      { type: 'price', name: 'sonder_wand', label: 'Sonderwand (z. B. Glas)', unit: '€/m²', default: 280 },
      { type: 'price', name: 'sonder_decke', label: 'Sonderdecke (z. B. Holz)', unit: '€/m²', default: 165 },
    ],
  },
  {
    key: 'preis_sonder_sonstiges',
    label: 'Sonstiges',
    priceSectionKey: 'sonderpositionen',
    fields: [
      { type: 'price', name: 'treppe', label: 'Treppe (pro Stück)', unit: '€', default: 4500 },
      { type: 'price', name: 'kamin', label: 'Kaminanschluss', unit: '€', default: 420 },
      { type: 'price', name: 'sockel', label: 'Sockelarbeiten (laufend)', unit: '€/m', default: 35 },
      { type: 'price', name: 'abdichtung', label: 'Abdichtung (z. B. Keller)', unit: '€/m²', default: 75 },
    ],
  },
];

/** Tipuri pentru Preisdatenbank (derivate din form config) */
export type PriceVar = { id: string; label: string; unit: string; value: number; /** true = opțiune adăugată la acest câmp (formular), nu variabilă separată */ isCustomOption?: boolean }
export type PreisdatenbankSubsection = { title: string; subtitle?: string; fieldTag?: string; variables: PriceVar[] }
export type PreisdatenbankSection = { title: string; subtitle: string; subsections: PreisdatenbankSubsection[]; stepKey?: string }

/**
 * Variabile de preț care corespund EXACT cheilor din pricing_parameters (engine: pricing/db_loader.py).
 * Workflow-ul de pricing citește aceste chei la fiecare rulare.
 */
export type PricingVariableDef = { key: string; label: string; unit: string; default: number }
export type PricingVariablesSubsectionDef = { title: string; variables: PricingVariableDef[] }
export type PricingVariablesSectionDef = { title: string; subtitle: string; subsections: PricingVariablesSubsectionDef[] }

export const PRICING_VARIABLES_SECTIONS: PricingVariablesSectionDef[] = [
  {
    title: 'Fundament',
    subtitle: 'Preise pro m² Fundament',
    subsections: [
      {
        title: 'Fundație',
        variables: [
          { key: 'unit_price_placa', label: 'Placă (€/m²)', unit: '€/m²', default: 0 },
          { key: 'unit_price_piloti', label: 'Piloți (€/m²)', unit: '€/m²', default: 0 },
          { key: 'unit_price_soclu', label: 'Soclu (€/m²)', unit: '€/m²', default: 0 },
        ],
      },
    ],
  },
  {
    title: 'System & Rohbau',
    subtitle: 'Systempreise und Prefabrication',
    subsections: [
      {
        title: 'CLT',
        variables: [
          { key: 'clt_interior_price', label: 'CLT Innen (€/m²)', unit: '€/m²', default: 0 },
          { key: 'clt_exterior_price', label: 'CLT Außen (€/m²)', unit: '€/m²', default: 0 },
        ],
      },
      {
        title: 'Holzrahmen',
        variables: [
          { key: 'holzrahmen_interior_price', label: 'Holzrahmen Innen (€/m²)', unit: '€/m²', default: 0 },
          { key: 'holzrahmen_exterior_price', label: 'Holzrahmen Außen (€/m²)', unit: '€/m²', default: 0 },
        ],
      },
      {
        title: 'Massivholz',
        variables: [
          { key: 'massivholz_interior_price', label: 'Massivholz Innen (€/m²)', unit: '€/m²', default: 0 },
          { key: 'massivholz_exterior_price', label: 'Massivholz Außen (€/m²)', unit: '€/m²', default: 0 },
        ],
      },
      {
        title: 'Baustellenzufahrt (Faktor auf Gesamtstruktur)',
        variables: [
          { key: 'acces_santier_leicht_factor', label: 'Leicht (LKW 40t)', unit: '', default: 1 },
          { key: 'acces_santier_mittel_factor', label: 'Mittel', unit: '', default: 1.1 },
          { key: 'prefab_modifier_santier', label: 'Schwierig', unit: '', default: 1.25 },
        ],
      },
    ],
  },
  {
    title: 'Dach',
    subtitle: 'Dachneigung, Dachdeckung, Dämmung',
    subsections: [
      {
        title: 'Dach – Allgemein',
        variables: [
          { key: 'overhang_m', label: 'Dachüberstand (m)', unit: 'm', default: 0.4 },
          { key: 'sheet_metal_price_per_m', label: 'Blech (€/m)', unit: '€/m', default: 0 },
          { key: 'insulation_price_per_m2', label: 'Dämmung (€/m²)', unit: '€/m²', default: 0 },
          { key: 'tile_price_per_m2', label: 'Ziegel (€/m²)', unit: '€/m²', default: 0 },
          { key: 'metal_price_per_m2', label: 'Metall (€/m²)', unit: '€/m²', default: 0 },
          { key: 'membrane_price_per_m2', label: 'Membran (€/m²)', unit: '€/m²', default: 0 },
        ],
      },
      {
        title: 'Dach – Sondertypen',
        variables: [
          { key: 'roof_shingle_price_per_m2', label: 'Schindel (€/m²)', unit: '€/m²', default: 0 },
          { key: 'roof_metal_tile_price_per_m2', label: 'Metallziegel (€/m²)', unit: '€/m²', default: 0 },
          { key: 'roof_ceramic_tile_price_per_m2', label: 'Keramikziegel (€/m²)', unit: '€/m²', default: 0 },
          { key: 'roof_tpo_pvc_price_per_m2', label: 'TPO/PVC (€/m²)', unit: '€/m²', default: 0 },
          { key: 'roof_green_extensive_price_per_m2', label: 'Gründach (€/m²)', unit: '€/m²', default: 0 },
        ],
      },
    ],
  },
  {
    title: 'Finishes – Innen',
    subtitle: 'Innenausbau pro m²',
    subsections: [
      {
        title: 'Innen',
        variables: [
          { key: 'interior_tencuiala', label: 'Tencuială (€/m²)', unit: '€/m²', default: 0 },
          { key: 'interior_lemn', label: 'Lemn (€/m²)', unit: '€/m²', default: 0 },
          { key: 'interior_fibrociment', label: 'Fibrociment (€/m²)', unit: '€/m²', default: 0 },
          { key: 'interior_mix', label: 'Mix (€/m²)', unit: '€/m²', default: 0 },
          { key: 'interior_rigips_glet_lavabil', label: 'Rigips + glet (€/m²)', unit: '€/m²', default: 0 },
          { key: 'interior_fermacell', label: 'Fermacell (€/m²)', unit: '€/m²', default: 0 },
          { key: 'interior_osb_aparent', label: 'OSB aparent (€/m²)', unit: '€/m²', default: 0 },
          { key: 'interior_lambriu', label: 'Lambriu (€/m²)', unit: '€/m²', default: 0 },
          { key: 'interior_panouri_acustice', label: 'Panouri acustice (€/m²)', unit: '€/m²', default: 0 },
        ],
      },
    ],
  },
  {
    title: 'Finishes – Fassade',
    subtitle: 'Fassade pro m²',
    subsections: [
      {
        title: 'Außen',
        variables: [
          { key: 'exterior_tencuiala', label: 'Tencuială (€/m²)', unit: '€/m²', default: 0 },
          { key: 'exterior_lemn', label: 'Lemn (€/m²)', unit: '€/m²', default: 0 },
          { key: 'exterior_fibrociment', label: 'Fibrociment (€/m²)', unit: '€/m²', default: 0 },
          { key: 'exterior_mix', label: 'Mix (€/m²)', unit: '€/m²', default: 0 },
          { key: 'exterior_lemn_ars', label: 'Lemn Ars / Shou Sugi Ban (€/m²)', unit: '€/m²', default: 0 },
          { key: 'exterior_hpl_ventilat', label: 'HPL ventilat (€/m²)', unit: '€/m²', default: 0 },
          { key: 'exterior_ceramica_ventilat', label: 'Keramik ventilat (€/m²)', unit: '€/m²', default: 0 },
          { key: 'exterior_caramida_aparenta_placaj', label: 'Klinker (€/m²)', unit: '€/m²', default: 0 },
          { key: 'exterior_piatra_naturala_placaj', label: 'Naturstein (€/m²)', unit: '€/m²', default: 0 },
          { key: 'exterior_wpc', label: 'WPC (€/m²)', unit: '€/m²', default: 0 },
        ],
      },
    ],
  },
  {
    title: 'Fenster & Türen (€/m²)',
    subtitle: 'Fensterart wählt den Preis (2-/3-fach). Höhe nur für Flächenberechnung.',
    subsections: [
      {
        title: 'Fenster (pro m² Glasfläche, je nach Fensterart im Formular)',
        variables: [
          { key: 'window_2_fach_price', label: '2-fach verglast (€/m²)', unit: '€/m²', default: 320 },
          { key: 'window_3_fach_price', label: '3-fach verglast (€/m²)', unit: '€/m²', default: 420 },
          { key: 'window_3fach_passiv_price', label: '3-fach verglast, Passiv (€/m²)', unit: '€/m²', default: 580 },
        ],
      },
      {
        title: 'Türen (pro m², Innen vs. Außen)',
        variables: [
          { key: 'door_interior_price', label: 'Innentür (€/m²)', unit: '€/m²', default: 380 },
          { key: 'door_exterior_price', label: 'Außentür (€/m²)', unit: '€/m²', default: 480 },
        ],
      },
      {
        title: 'Garagentor (pro m²)',
        variables: [
          { key: 'garage_door_standard_price', label: 'Sektionaltor Standard (€/m²)', unit: '€/m²', default: 360 },
          { key: 'garage_door_premium_price', label: 'Sektionaltor Premium (€/m²)', unit: '€/m²', default: 470 },
          { key: 'garage_door_rolltor_price', label: 'Rolltor (€/m²)', unit: '€/m²', default: 420 },
        ],
      },
    ],
  },
  {
    title: 'Fläche & Decke',
    subtitle: 'Koeffizienten pro m²',
    subsections: [
      {
        title: 'Boden / Decke',
        variables: [
          { key: 'floor_coeff_per_m2', label: 'Boden (€/m²)', unit: '€/m²', default: 0 },
          { key: 'ceiling_coeff_per_m2', label: 'Decke (€/m²)', unit: '€/m²', default: 0 },
        ],
      },
    ],
  },
  {
    title: 'Treppe',
    subtitle: 'Preise pro Stufe',
    subsections: [
      {
        title: 'Treppe',
        variables: [
          { key: 'price_per_stair_unit', label: 'Pro Stück (€)', unit: '€', default: 0 },
          { key: 'railing_price_per_stair', label: 'Geländer pro Stück (€)', unit: '€', default: 0 },
          { key: 'stairs_type_standard_piece_price', label: 'Treppentyp Standard (€/Stück)', unit: '€/Stück', default: 0 },
          { key: 'stairs_type_holz_piece_price', label: 'Treppentyp Holz (€/Stück)', unit: '€/Stück', default: 0 },
          { key: 'stairs_type_beton_piece_price', label: 'Treppentyp Beton (€/Stück)', unit: '€/Stück', default: 0 },
          { key: 'stairs_type_metall_piece_price', label: 'Treppentyp Metall (€/Stück)', unit: '€/Stück', default: 0 },
          { key: 'stairs_type_sonder_piece_price', label: 'Treppentyp Sonder (€/Stück)', unit: '€/Stück', default: 0 },
        ],
      },
    ],
  },
  {
    title: 'Haustechnik',
    subtitle: 'Strom, Heizung, Abwasser, Lüftung (€/m²)',
    subsections: [
      {
        title: 'Anschlüsse',
        variables: [
          { key: 'electricity_base_price', label: 'Strom (€/m²)', unit: '€/m²', default: 60 },
          { key: 'heating_base_price', label: 'Heizung (€/m²)', unit: '€/m²', default: 70 },
          { key: 'sewage_base_price', label: 'Abwasser (€/m²)', unit: '€/m²', default: 45 },
          { key: 'ventilation_base_price', label: 'Lüftung (€/m²)', unit: '€/m²', default: 55 },
        ],
      },
    ],
  },
]

/**
 * Construiește secțiunile Preisdatenbank din definiția de variabile (chei = pricing_parameters) + valori din API.
 */
export function buildPreisdatenbankSectionsFromPricingVariables(
  sectionsDef: PricingVariablesSectionDef[],
  valuesOverride?: Record<string, number>
): PreisdatenbankSection[] {
  return sectionsDef.map((sec) => ({
    title: sec.title,
    subtitle: sec.subtitle,
    subsections: sec.subsections.map((sub) => ({
      title: sub.title,
      variables: sub.variables.map((v) => ({
        id: v.key,
        label: v.label,
        unit: v.unit,
        value: valuesOverride?.[v.key] ?? v.default,
      })),
    })),
  }))
}

/**
 * Construiește secțiunile Preisdatenbank din pașii de preț (form config).
 * Grupează după priceSectionKey; titlul/subtitlul cardului de la primul pas din grup.
 * valuesOverride: map id variabilă -> valoare (ex. din DB per user); dacă lipsește, se folosește default.
 */
export function buildPreisdatenbankSections(
  steps: Step[],
  valuesOverride?: Record<string, number>
): PreisdatenbankSection[] {
  const priceSteps = steps.filter(s => s.fields.some(isPriceField))
  if (priceSteps.length === 0) return []

  const groupKey = (s: Step) => s.priceSectionKey ?? s.key
  const groups = new Map<string, Step[]>()
  for (const step of priceSteps) {
    const key = groupKey(step)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(step)
  }

  return Array.from(groups.values()).map((groupSteps) => {
    const first = groupSteps[0]!
    const title = first.priceSectionTitle ?? first.label
    const subtitle = first.priceSectionSubtitle ?? ''
    const subsections: PreisdatenbankSubsection[] = groupSteps.map((step) => ({
      title: step.label,
      variables: step.fields.filter(isPriceField).map((f) => ({
        id: f.name,
        label: f.label,
        unit: f.unit,
        value: valuesOverride?.[f.name] ?? f.default,
      })),
    }))
    return { title, subtitle, subsections }
  })
}
