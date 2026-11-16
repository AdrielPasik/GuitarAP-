import { describe, expect, it } from 'vitest';
import { createFretboardContent } from '@/core/model';
import {
  addPosition,
  applyNotes,
  clearPosition,
  duplicateSpatialPosition,
  generatedScaleNotes,
  removeSpatialPosition,
  setNoteFinger,
  setRange,
  toggleNoteIn,
  toggleSpatialNote,
} from '@/features/fretboard/operations';

describe('spatial fretboard semantics', () => {
  it('keeps six frets on the same string as independent spatial notes', () => {
    let content = createFretboardContent();
    for (const fret of [0, 1, 3, 5, 7, 8]) content = toggleSpatialNote(content, 5, fret);

    expect(content.positions[0].notes.map((note) => note.fret)).toEqual([0, 1, 3, 5, 7, 8]);
    expect(content.positions[0].notes.every((note) => note.string === 5)).toBe(true);
  });

  it('keeps earlier marks when other strings are marked', () => {
    let content = createFretboardContent();
    for (const fret of [0, 1, 3, 5, 7, 8]) content = toggleSpatialNote(content, 5, fret);
    for (const [string, fret] of [[4, 3], [4, 5], [3, 2], [3, 3], [2, 5]] as const) {
      content = toggleSpatialNote(content, string, fret);
    }
    expect(content.positions[0].notes).toHaveLength(11);
    expect(content.baseNotes).toHaveLength(11);
    expect(content.positions[0].notes.filter((note) => note.string === 5)).toHaveLength(6);
  });

  it('removes only the point clicked a second time', () => {
    let content = createFretboardContent();
    for (const fret of [0, 1, 3]) content = toggleSpatialNote(content, 5, fret);
    content = toggleSpatialNote(content, 5, 1);
    expect(content.positions[0].notes.map((note) => note.fret)).toEqual([0, 3]);
  });

  it('does not stamp a finger on notes unless one was chosen', () => {
    let content = toggleSpatialNote(createFretboardContent(), 5, 3);
    expect(content.positions[0].notes[0]).toEqual({ string: 5, fret: 3 });
    content = setNoteFinger(content, content.selectedPositionId, 5, 3, 2);
    expect(content.positions[0].notes[0].finger).toBe(2);
    content = setNoteFinger(content, content.selectedPositionId, 5, 3, undefined);
    expect(content.positions[0].notes[0]).toEqual({ string: 5, fret: 3 });
  });

  it('duplicates and deletes positions without merging their notes', () => {
    let content = toggleSpatialNote(createFretboardContent(), 5, 3);
    const originalId = content.positions[0].id;
    content = duplicateSpatialPosition(content, originalId);
    expect(content.positions).toHaveLength(2);
    expect(content.positions[1].notes).toEqual(content.positions[0].notes);
    content = toggleSpatialNote(content, 4, 5);
    expect(content.positions[0].notes).toHaveLength(1);
    expect(content.positions[1].notes).toHaveLength(2);
    content = removeSpatialPosition(content, content.positions[1].id);
    expect(content.positions).toHaveLength(1);
    expect(content.selectedPositionId).toBe(originalId);
  });

  it('edits any position without touching the others', () => {
    let content = addPosition(toggleSpatialNote(createFretboardContent(), 5, 0));
    const [first, second] = content.positions;
    content = toggleNoteIn(content, second.id, 5, 0);
    content = toggleNoteIn(content, second.id, 5, 2);
    expect(content.positions[0].notes.map((note) => note.fret)).toEqual([0]);
    expect(content.positions[1].notes.map((note) => note.fret)).toEqual([0, 2]);
    content = clearPosition(content, second.id);
    expect(content.positions.find((position) => position.id === first.id)?.notes).toHaveLength(1);
    expect(content.baseNotes).toHaveLength(1);
  });

  it('proposes a scale without replacing manual marks unless asked', () => {
    let content = createFretboardContent();
    // F♯ on the first string is not part of C minor pentatonic: a manual mark that must survive.
    content = toggleSpatialNote(content, 0, 2);
    const proposal = generatedScaleNotes({ ...content, maxFret: 5 }, 'Pentatónica menor');
    expect(proposal).not.toContainEqual({ string: 0, fret: 2 });
    const merged = applyNotes(content, content.selectedPositionId, proposal, 'merge');
    expect(merged.positions[0].notes).toContainEqual({ string: 0, fret: 2 });
    expect(merged.positions[0].notes.length).toBeGreaterThan(proposal.length);
    const replaced = applyNotes(content, content.selectedPositionId, proposal, 'replace');
    expect(replaced.positions[0].notes).toHaveLength(proposal.length);
  });

  it('keeps hidden notes when the visible range shrinks', () => {
    let content = toggleSpatialNote(createFretboardContent(), 0, 12);
    content = setRange(content, 0, 5);
    expect(content.maxFret).toBe(5);
    expect(content.positions[0].notes).toHaveLength(1);
  });
});
