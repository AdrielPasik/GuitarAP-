/**
 * Harmonic reading of a note relative to the tonic.
 *
 * A pitch class is a chromatic distance (0-11 semitones above the tonic); a degree is a musical role
 * ("major third", "flat seventh"). They are not the same: 6 semitones is a diminished fifth in a
 * locrian or blues context and a raised fourth in a lydian one. The context is the set of distances
 * actually present in the material, so every position of the same map is labelled consistently.
 */
export type Role = 'root' | 'third' | 'fifth' | 'seventh' | 'other';

export type Degree = {
  semitones: number;
  /** "1", "♭3", "5", "♯5", "7"… */
  label: string;
  role: Role;
  /** Flattened or sharpened relative to the major scale / perfect intervals. */
  altered: boolean;
};

export const ROLES: Role[] = ['root', 'third', 'fifth', 'seventh'];

export const ROLE_INFO: Record<Role, { short: string; name: string; description: string }> = {
  root: { short: '1', name: 'Tónica', description: 'La nota que da nombre a la escala o al acorde.' },
  third: { short: '3', name: 'Tercera', description: 'Define si es mayor (3) o menor (♭3).' },
  fifth: { short: '5', name: 'Quinta', description: 'Quinta justa (5); disminuida (♭5) o aumentada (♯5) si está alterada.' },
  seventh: { short: '7', name: 'Séptima', description: 'Séptima mayor (7) o menor (♭7).' },
  other: { short: '·', name: 'Otros grados', description: 'Segunda, cuarta, sexta y extensiones.' },
};

export type Emphasis = 'all' | 'root' | 'triad' | 'seventh';

/** Which roles each preset keeps in full color. `undefined` means everything. */
export const EMPHASIS_ROLES: Record<Emphasis, Role[] | undefined> = {
  all: undefined,
  root: ['root'],
  triad: ['root', 'third', 'fifth'],
  seventh: ['root', 'third', 'fifth', 'seventh'],
};

export function emphasisOf(roles: Role[] | undefined): Emphasis | 'custom' {
  if (!roles) return 'all';
  const key = [...roles].sort().join();
  for (const [name, preset] of Object.entries(EMPHASIS_ROLES) as Array<[Emphasis, Role[] | undefined]>) {
    if (preset && [...preset].sort().join() === key) return name;
  }
  return 'custom';
}

const mod12 = (value: number) => ((value % 12) + 12) % 12;

export type HarmonicOptions = { extensions?: boolean };

/** Degree of a chromatic distance, given the distances present in the material. */
export function degreeOf(semitones: number, present: ReadonlySet<number> = new Set(), options: HarmonicOptions = {}): Degree {
  const d = mod12(semitones);
  const has = (value: number) => present.has(value);
  switch (d) {
    case 0:
      return { semitones: d, label: '1', role: 'root', altered: false };
    case 1:
      return { semitones: d, label: '♭2', role: 'other', altered: true };
    case 2:
      return { semitones: d, label: options.extensions ? '9' : '2', role: 'other', altered: false };
    case 3:
      return { semitones: d, label: '♭3', role: 'third', altered: true };
    case 4:
      return { semitones: d, label: '3', role: 'third', altered: false };
    case 5:
      return { semitones: d, label: options.extensions ? '11' : '4', role: 'other', altered: false };
    case 6:
      // Raised fourth only when the material has a perfect fifth and no perfect fourth (lydian-like).
      return has(7) && !has(5)
        ? { semitones: d, label: '♯4', role: 'other', altered: true }
        : { semitones: d, label: '♭5', role: 'fifth', altered: true };
    case 7:
      return { semitones: d, label: '5', role: 'fifth', altered: false };
    case 8:
      // Augmented fifth only over a major third without a perfect fifth; otherwise a flat sixth.
      return has(4) && !has(7)
        ? { semitones: d, label: '♯5', role: 'fifth', altered: true }
        : { semitones: d, label: '♭6', role: 'other', altered: true };
    case 9:
      return { semitones: d, label: options.extensions ? '13' : '6', role: 'other', altered: false };
    case 10:
      return { semitones: d, label: '♭7', role: 'seventh', altered: true };
    default:
      return { semitones: d, label: '7', role: 'seventh', altered: false };
  }
}

export function presentDistances(pitchClasses: Iterable<number>, root: number) {
  return new Set([...pitchClasses].map((pitch) => mod12(pitch - root)));
}
