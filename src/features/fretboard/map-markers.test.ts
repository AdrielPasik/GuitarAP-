import { describe, expect, it } from 'vitest';
import { createFretboardContent } from '@/core/model';
import { markersForAll, markersForPosition, rolesPresent, legendLabel } from '@/features/fretboard/map-markers';
import { setView, resolvedView, toggleSpatialNote } from '@/features/fretboard/operations';

/** C major on the low E string: C(8) E(12) G(3) B(7) plus D(10) F(1) A(5). */
function cMajor() {
  let content = { ...createFretboardContent(), maxFret: 12 };
  for (const fret of [8, 10, 12, 1, 3, 5, 7]) content = toggleSpatialNote(content, 5, fret);
  return content;
}

describe('harmonic markers on the neck', () => {
  it('colors tonic, third, fifth and seventh and leaves the other degrees neutral', () => {
    const content = cMajor();
    const markers = markersForPosition(content, content.positions[0], 0, { show: 'intervals' });
    const byFret = Object.fromEntries(markers.map((marker) => [marker.fret, marker]));
    expect(byFret[8]).toMatchObject({ label: '1', role: 'root', tone: 'root' });
    expect(byFret[12]).toMatchObject({ label: '3', role: 'third' });
    expect(byFret[3]).toMatchObject({ label: '5', role: 'fifth' });
    expect(byFret[7]).toMatchObject({ label: '7', role: 'seventh' });
    expect(byFret[10]).toMatchObject({ label: '2', role: 'other' });
    expect(byFret[1]).toMatchObject({ label: '4', role: 'other' });
    expect(byFret[5]).toMatchObject({ label: '6', role: 'other' });
  });

  it('shows the note as the main label and the interval as the secondary one', () => {
    const content = cMajor();
    const third = markersForPosition(content, content.positions[0], 0, { show: 'both' }).find((marker) => marker.fret === 12);
    expect(third).toMatchObject({ label: 'Mi', sub: '3', role: 'third' });
  });

  it('highlighting a triad only softens the other degrees: every saved note stays', () => {
    const content = cMajor();
    const markers = markersForPosition(content, content.positions[0], 0, { show: 'notes', emphasis: ['root', 'third', 'fifth'] });
    expect(markers).toHaveLength(7);
    expect(markers.filter((marker) => !marker.dim).map((marker) => marker.label).sort()).toEqual(['Do', 'Mi', 'Sol']);
    expect(markers.filter((marker) => marker.dim)).toHaveLength(4);
    const withSeventh = markersForPosition(content, content.positions[0], 0, { show: 'notes', emphasis: ['root', 'third', 'fifth', 'seventh'] });
    expect(withSeventh.filter((marker) => !marker.dim).map((marker) => marker.label)).toContain('Si');
  });

  it('marks altered degrees without relying on color alone', () => {
    let content = { ...createFretboardContent(), maxFret: 12 };
    for (const fret of [8, 11, 3, 6, 10]) content = toggleSpatialNote(content, 5, fret); // C, E♭, G, B♭... (E♭ = fret 11 low E)
    const markers = markersForPosition(content, content.positions[0], 0, { show: 'intervals' });
    expect(markers.find((marker) => marker.fret === 11)).toMatchObject({ label: '♭3', altered: true, role: 'third' });
    expect(markers.find((marker) => marker.fret === 6)).toMatchObject({ label: '♭7', altered: true, role: 'seventh' });
  });

  it('keeps the same color for the same function in every position and in the whole-map view', () => {
    const content = cMajor();
    const all = markersForAll(content, { show: 'intervals' });
    const single = markersForPosition(content, content.positions[0], 0, { show: 'intervals' });
    expect(all.map((marker) => [marker.fret, marker.role])).toEqual(single.map((marker) => [marker.fret, marker.role]));
  });

  it('can color by position when asked, and then drops the function colors', () => {
    const content = cMajor();
    const marker = markersForAll(content, { show: 'positions' })[0];
    expect(marker.role).toBeUndefined();
    expect(marker.group).toBe(0);
  });

  it('knows which functions a map contains and how to name them in its legend', () => {
    const content = cMajor();
    expect(rolesPresent(content).sort()).toEqual(['fifth', 'other', 'root', 'seventh', 'third']);
    expect(legendLabel(content, 'third')).toBe('3');
  });
});

describe('reading preferences', () => {
  it('default to what older maps did and never change a note', () => {
    const content = cMajor();
    expect(resolvedView(content)).toMatchObject({ labels: 'notes', legend: true, emphasis: undefined });
    expect(resolvedView({ ...content, notation: 'intervals' }).labels).toBe('intervals');
    const changed = setView(setView(content, { labels: 'both' }), { emphasis: ['root'] });
    expect(changed.positions).toEqual(content.positions);
    expect(changed.baseNotes).toEqual(content.baseNotes);
    expect(changed.notation).toBe('notes');
    expect(setView(changed, { emphasis: undefined }).view?.emphasis).toBeUndefined();
  });
});
