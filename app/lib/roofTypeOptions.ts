/** Roof types for roof review editor (matches holzbot-roof / pipeline). */
export const ROOF_TYPE_OPTIONS = [
  {
    id: '0_w' as const,
    /** Pipeline id – UI shows German name */
    labelDe: 'Flachdach',
    image: '/roof_types/1.png',
  },
  {
    id: '1_w' as const,
    labelDe: 'Pultdach',
    image: '/roof_types/12.png',
  },
  {
    id: '2_w' as const,
    labelDe: 'Satteldach',
    image: '/roof_types/14.png',
  },
  {
    id: '4_w' as const,
    labelDe: 'Walmdach',
    image: '/roof_types/21.png',
  },
  {
    id: '4.5_w' as const,
    labelDe: 'Krüppelwalmdach',
    image: '/roof_types/5.png',
  },
] as const

export type RoofTypeId = (typeof ROOF_TYPE_OPTIONS)[number]['id']

export function roofTypeLabelDe(id: RoofTypeId): string {
  const o = ROOF_TYPE_OPTIONS.find((x) => x.id === id)
  return o?.labelDe ?? id
}

export const DEFAULT_ROOF_ANGLE = 30
export const DEFAULT_ROOF_TYPE: RoofTypeId = '2_w'
/** Default overhang in metres (40 cm in roof editor UI), per surface. */
export const DEFAULT_ROOF_OVERHANG_M = 0.4
