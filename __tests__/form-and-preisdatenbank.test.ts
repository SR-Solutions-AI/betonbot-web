/**
 * Teste pentru întreaga Preisdatenbank: fiecare secțiune, subsecțiune și variabilă.
 * Plus: cardul unic Kamin / Ofen cu două subsecțiuni (Kaminabzug apoi tipurile de semineu).
 */
import { buildFormFromJson, buildPriceSectionsFromFormStepsJson } from '../lib/buildFormFromJson'
import holzbauSchema from '../data/form-schema/holzbau-form-steps.json'

const { priceSections } = buildFormFromJson(holzbauSchema)

describe('Preisdatenbank – acoperire completă', () => {
  describe('Card Kamin / Ofen: o singură carte cu 2 subsecțiuni (Kaminabzug apoi Kamin/Ofen)', () => {
    it('secțiunea Energieeffizienz există', () => {
      const section = priceSections.find((s) => s.title === 'Energieeffizienz & Heizung')
      expect(section).toBeDefined()
    })

    it('Kaminabzug există în Energieeffizienz și conține horn (doar edit)', () => {
      const section = priceSections.find((s) => s.title === 'Energieeffizienz & Heizung')
      expect(section).toBeDefined()
      const kaminabzug = section!.subsections.find((sub) => sub.title === 'Kaminabzug')
      expect(kaminabzug).toBeDefined()
      expect(kaminabzug!.variables.some((v) => v.id === 'horn_price_per_floor')).toBe(true)
    })

    it('în Energieeffizienz, Kamin / Ofen este a doua subsecțiune după Kaminabzug (tipuri semineu)', () => {
      const section = priceSections.find((s) => s.title === 'Energieeffizienz & Heizung')
      const kaminabzugIdx = section!.subsections.findIndex((sub) => sub.title === 'Kaminabzug')
      const kaminIdx = section!.subsections.findIndex((sub) => sub.title === 'Kamin / Ofen')
      expect(kaminabzugIdx).toBeGreaterThanOrEqual(0)
      expect(kaminIdx).toBe(kaminabzugIdx + 1)
      const kamin = section!.subsections[kaminIdx]
      expect(kamin?.variables.some((v) => v.id === 'tip_semineu_kein_price')).toBe(true)
      expect(kamin?.variables.some((v) => v.id === 'tip_semineu_holzofen_price')).toBe(true)
    })

    it('Kaminabzug nu conține fieldTag (doar edit)', () => {
      const section = priceSections.find((s) => s.title === 'Energieeffizienz & Heizung')
      const kaminabzug = section!.subsections.find((sub) => sub.title === 'Kaminabzug')
      expect(kaminabzug?.fieldTag).toBeFalsy()
    })
  })

  describe('Fiecare secțiune Preisdatenbank', () => {
    const expectedSectionTitles = [
      'Allgemeine Projektinformationen',
      'Fenster & Türen',
      'Wandaufbau',
      'Materialien & Ausbaustufe',
      'Geschossdecken und Bodenaufbauten',
      'Energieeffizienz & Heizung',
      'Dachstuhl, Dämmung und Dachdeckung',
    ]

    expectedSectionTitles.forEach((title) => {
      it(`secțiunea "${title}" există și are subsections`, () => {
        const section = priceSections.find((s) => s.title === title)
        expect(section).toBeDefined()
        expect(Array.isArray(section!.subsections)).toBe(true)
        expect(section!.subsections.length).toBeGreaterThan(0)
      })
    })

    it('Geschossdecken und Bodenaufbauten include Pfahlgründung, Fundament și Treppe (fost Gebäudestruktur)', () => {
      const section = priceSections.find((s) => s.title === 'Geschossdecken und Bodenaufbauten')
      expect(section).toBeDefined()
      const titles = section!.subsections.map((s) => s.title)
      expect(titles).toContain('Pfahlgründung')
      expect(titles).toContain('Fundament')
      expect(titles).toContain('Treppe')
    })
  })

  describe('Fiecare subsecțiune Preisdatenbank', () => {
    priceSections.forEach((section) => {
      section.subsections.forEach((sub) => {
        it(`subsecțiunea "${section.title}" > "${sub.title}" are title și variables`, () => {
          expect(sub.title).toBeDefined()
          expect(sub.title.length).toBeGreaterThan(0)
          expect(Array.isArray(sub.variables)).toBe(true)
        })
      })
    })
  })

  describe('Fiecare variabilă Preisdatenbank', () => {
    priceSections.forEach((section) => {
      section.subsections.forEach((sub) => {
        sub.variables.forEach((v) => {
          it(`variabila "${v.id}" (${section.title} > ${sub.title}) are id, label, unit, value numeric >= 0`, () => {
            expect(v.id).toBeDefined()
            expect(v.id.length).toBeGreaterThan(0)
            expect(v.label).toBeDefined()
            expect(v.unit).toBeDefined()
            expect(typeof v.value).toBe('number')
            expect(Number.isFinite(v.value)).toBe(true)
            expect(v.value).toBeGreaterThanOrEqual(0)
          })
        })
      })
    })
  })

  describe('Niciun titlu Zusätzliche Optionen', () => {
    it('niciun subsection nu se numește Zusätzliche Optionen', () => {
      for (const section of priceSections) {
        for (const sub of section.subsections) {
          expect(sub.title).not.toBe('Zusätzliche Optionen')
        }
      }
    })
  })

  describe('Modificare valoare se reflectă în build', () => {
    it('modificarea horn_price_per_floor în schema apare în buildPriceSectionsFromFormStepsJson', () => {
      const modified = JSON.parse(JSON.stringify(holzbauSchema))
      const sections = modified.preisdatenbank?.sections ?? []
      for (const sec of sections) {
        for (const sub of sec.subsections ?? []) {
          for (const v of sub.variables ?? []) {
            if (v.key === 'horn_price_per_floor') {
              v.value = 2000
              break
            }
          }
        }
      }
      const rebuilt = buildPriceSectionsFromFormStepsJson(modified)
      const kaminabzug = rebuilt.flatMap((s) => s.subsections).find((sub) => sub.title === 'Kaminabzug')
      expect(kaminabzug).toBeDefined()
      const hornPerFloor = kaminabzug!.variables.find((v) => v.id === 'horn_price_per_floor')
      expect(hornPerFloor?.value).toBe(2000)
    })
  })

  describe('Chei așteptate de motor prezente', () => {
    const engineKeys = [
      'horn_price_per_floor',
      'tip_semineu_kein_price',
      'tip_semineu_holzofen_price',
      'electricity_base_price',
      'sewage_base_price',
      'unit_price_piloti',
      'unit_price_placa',
      'window_2_fach_price',
      // Innentüren are split by type (piece prices)
      'door_interior_standard',
      'wandaufbau_aussen_clt_35',
      'tip_incalzire_gas_price',
      'bodenaufbau_holz_standard_price',
    ]

    it('toate cheile motor sunt în secțiunile construite', () => {
      const allIds = new Set<string>()
      for (const section of priceSections) {
        for (const sub of section.subsections) {
          for (const v of sub.variables) allIds.add(v.id)
        }
      }
      for (const key of engineKeys) {
        expect(allIds.has(key)).toBe(true)
      }
    })
  })
})
