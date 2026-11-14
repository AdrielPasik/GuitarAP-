export const STANDARD_TUNING = ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'] as const;

export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export const SCALE_PATTERNS = {
  Mayor: [0, 2, 4, 5, 7, 9, 11],
  'Menor natural': [0, 2, 3, 5, 7, 8, 10],
  'Pentatónica mayor': [0, 2, 4, 7, 9],
  'Pentatónica menor': [0, 3, 5, 7, 10],
  Blues: [0, 3, 5, 6, 7, 10],
  Jónico: [0, 2, 4, 5, 7, 9, 11],
  Dórico: [0, 2, 3, 5, 7, 9, 10],
  Frigio: [0, 1, 3, 5, 7, 8, 10],
  Lidio: [0, 2, 4, 6, 7, 9, 11],
  Mixolidio: [0, 2, 4, 5, 7, 9, 10],
  Eólico: [0, 2, 3, 5, 7, 8, 10],
  Locrio: [0, 1, 3, 5, 6, 8, 10],
} as const;

export type ScaleName = keyof typeof SCALE_PATTERNS;

export function noteName(root: number, interval: number, latin = false) {
  const english = NOTE_NAMES[(root + interval + 120) % 12];
  if (!latin) return english;
  return english
    .replace('C', 'Do')
    .replace('D', 'Re')
    .replace('E', 'Mi')
    .replace('F', 'Fa')
    .replace('G', 'Sol')
    .replace('A', 'La')
    .replace('B', 'Si');
}

export function tuningPitch(openString: string) {
  const names: Record<string, number> = {
    C: 0,
    'C#': 1,
    'C♯': 1,
    D: 2,
    'D#': 3,
    'D♯': 3,
    E: 4,
    F: 5,
    'F#': 6,
    'F♯': 6,
    G: 7,
    'G#': 8,
    'G♯': 8,
    A: 9,
    'A#': 10,
    'A♯': 10,
    B: 11,
  };
  return names[openString.slice(0, -1)] ?? 0;
}
