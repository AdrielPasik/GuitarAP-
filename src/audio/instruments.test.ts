import { describe, expect, it } from 'vitest';
import { resolveInstrument, SYSTEM_INSTRUMENT } from '@/audio/instruments';

describe('instrument resolution', () => {
  it('uses the system default for each kind of block when nothing else is set', () => {
    expect(resolveInstrument({ kind: 'melody' })).toEqual({ id: 'piano', source: 'system' });
    expect(resolveInstrument({ kind: 'tablature' })).toEqual({ id: 'guitar', source: 'system' });
    expect(resolveInstrument({ kind: 'chords' })).toEqual({ id: 'guitar', source: 'system' });
    expect(SYSTEM_INSTRUMENT).toEqual({ melody: 'piano', tablature: 'guitar', chords: 'guitar' });
  });
  it('a preference for a kind beats the system default, and an explicit block choice beats both', () => {
    expect(resolveInstrument({ kind: 'melody', preference: 'guitar' })).toEqual({ id: 'guitar', source: 'preference' });
    expect(resolveInstrument({ kind: 'melody', preference: 'guitar', explicit: 'piano' })).toEqual({ id: 'piano', source: 'block' });
    expect(resolveInstrument({ kind: 'tablature', explicit: 'piano' })).toEqual({ id: 'piano', source: 'block' });
  });
  it('the old single global setting is respected only if the person had set it, below the new per-kind preference', () => {
    expect(resolveInstrument({ kind: 'tablature', legacy: 'piano' })).toEqual({ id: 'piano', source: 'legacy' });
    expect(resolveInstrument({ kind: 'tablature', legacy: 'piano', preference: 'guitar' })).toEqual({ id: 'guitar', source: 'preference' });
    expect(resolveInstrument({ kind: 'melody', legacy: null })).toEqual({ id: 'piano', source: 'system' });
  });
});
