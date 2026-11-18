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
  it('a tablature or a chord progression with no choice of its own is a guitar, whatever else was ever stored', () => {
    expect(resolveInstrument({ kind: 'tablature', explicit: null, preference: null })).toEqual({ id: 'guitar', source: 'system' });
    expect(resolveInstrument({ kind: 'chords', explicit: undefined })).toEqual({ id: 'guitar', source: 'system' });
  });
});
