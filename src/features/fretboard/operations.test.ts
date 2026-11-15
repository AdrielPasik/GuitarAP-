import { describe, expect, it } from 'vitest';
import { createFretboardContent } from '@/core/model';
import {
  duplicateSpatialPosition,
  removeSpatialPosition,
  toggleSpatialNote,
} from '@/features/fretboard/operations';

describe('spatial fretboard semantics', () => {
  it('keeps six frets on the same string as independent spatial notes', () => {
    let content = createFretboardContent();
    for (const fret of [0, 1, 3, 5, 7, 8]) content = toggleSpatialNote(content, 5, fret, 1);

    expect(content.positions[0].notes.map((note) => note.fret)).toEqual([0, 1, 3, 5, 7, 8]);
    expect(content.positions[0].notes.every((note) => note.string === 5)).toBe(true);
  });

  it('removes only the position clicked a second time', () => {
    let content = createFretboardContent();
    for (const fret of [0, 1, 3]) content = toggleSpatialNote(content, 5, fret, 1);
    content = toggleSpatialNote(content, 5, 1, 1);
    expect(content.positions[0].notes.map((note) => note.fret)).toEqual([0, 3]);
  });

  it('duplicates and deletes positions without merging their notes', () => {
    let content = toggleSpatialNote(createFretboardContent(), 5, 3, 1);
    const originalId = content.positions[0].id;
    content = duplicateSpatialPosition(content, originalId);
    expect(content.positions).toHaveLength(2);
    expect(content.positions[1].notes).toEqual(content.positions[0].notes);
    content = toggleSpatialNote(content, 4, 5, 2);
    expect(content.positions[0].notes).toHaveLength(1);
    expect(content.positions[1].notes).toHaveLength(2);
    content = removeSpatialPosition(content, content.positions[1].id);
    expect(content.positions).toHaveLength(1);
    expect(content.selectedPositionId).toBe(originalId);
  });
});
