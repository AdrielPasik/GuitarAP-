import { describe, expect, it } from 'vitest';
import {
  assignSyllables, duplicateEvents, emptyMelody, insertEvents, intervalLabel, melodyToText, noteEvent, parseMelodyText, range,
  removeEvents, reverseOrder, setLyric, splitSyllables, transpose,
} from '@/features/melody/operations';
import { formatNote } from '@/core/theory/pitch';
import { addComment, fromNotebook, removeBlock, toNotebook, updateBlock } from '@/core/notebook';

const names = (events: ReturnType<typeof parseMelodyText>['events']) =>
  events.map((event) => (event.type === 'rest' ? 'r' : formatNote(event.midi!, 'english')));

describe('melody entry', () => {
  it('Do4 Re4 Mi4 Sol4 are C4 D4 E4 G4', () => {
    const { events, errors } = parseMelodyText('Do4 — Re4 — Mi4 — Sol4');
    expect(errors).toEqual([]);
    expect(events.map((event) => event.midi)).toEqual([60, 62, 64, 67]);
  });
  it('reads durations, rests and mixed naming; errors apply nothing', () => {
    const ok = parseMelodyText('C4 D4:2 r:0.5 Sib3');
    expect(names(ok.events)).toEqual(['C4', 'D4', 'r', 'A♯3']);
    expect(ok.events.map((event) => event.beats)).toEqual([1, 2, 0.5, 1]);
    const bad = parseMelodyText('C4 H4 Cmaj7 E4:x');
    expect(bad.errors.map((error) => error.token)).toEqual(['H4', 'Cmaj7', 'E4:x']);
    expect(bad.errors[1].reason).toMatch(/acorde/);
  });
  it('round-trips through text without changing pitch', () => {
    const melody = { ...emptyMelody(), events: parseMelodyText('Do4 Re♭4:2 r Fa♯5').events };
    const again = parseMelodyText(melodyToText(melody, 'latin')).events;
    expect(again.map((event) => event.midi)).toEqual(melody.events.map((event) => event.midi));
    expect(again.map((event) => event.beats)).toEqual(melody.events.map((event) => event.beats));
  });
});

describe('melody edits', () => {
  const base = { ...emptyMelody(), events: parseMelodyText('C4 D4 E4 G4').events };
  it('insert, remove, transpose, reverse and duplicate keep ids stable', () => {
    const inserted = insertEvents(base, [noteEvent(65)], 2);
    expect(inserted.events.map((event) => event.midi)).toEqual([60, 62, 65, 64, 67]);
    expect(inserted.events[0].id).toBe(base.events[0].id);
    expect(removeEvents(inserted, [inserted.events[2].id]).events.map((event) => event.midi)).toEqual([60, 62, 64, 67]);
    expect(transpose(base, 2).events.map((event) => event.midi)).toEqual([62, 64, 66, 69]);
    expect(transpose(base, 12, [base.events[0].id]).events.map((event) => event.midi)).toEqual([72, 62, 64, 67]);
    expect(reverseOrder(base).events.map((event) => event.midi)).toEqual([67, 64, 62, 60]);
    const dup = duplicateEvents(base, [base.events[1].id, base.events[2].id]);
    expect(dup.melody.events.map((event) => event.midi)).toEqual([60, 62, 64, 62, 64, 67]);
    expect(new Set(dup.melody.events.map((event) => event.id)).size).toBe(6);
  });
  it('range and intervals', () => {
    expect(range(base)).toEqual({ low: 60, high: 67, span: 7 });
    expect(intervalLabel(60, 64)).toBe('3ª mayor ↑');
    expect(intervalLabel(67, 60)).toBe('5ª justa ↓');
    expect(intervalLabel(60, 72)).toBe('octava ↑');
  });
  it('syllables belong to notes: editing the melody never moves them to the wrong note', () => {
    expect(splitSyllables('Hoy vuel-vo a')).toEqual(['Hoy', 'vuel', 'vo', 'a']);
    const sung = assignSyllables(base, ['Hoy', 'vuel', 'vo', 'a']);
    expect(sung.events.map((event) => event.lyric)).toEqual(['Hoy', 'vuel', 'vo', 'a']);
    const withNewNote = insertEvents(sung, [noteEvent(65)], 1);
    expect(withNewNote.events.map((event) => event.lyric)).toEqual(['Hoy', undefined, 'vuel', 'vo', 'a']);
    const removed = removeEvents(withNewNote, [withNewNote.events[2].id]);
    expect(removed.events.map((event) => event.lyric)).toEqual(['Hoy', undefined, 'vo', 'a']);
    expect(setLyric(sung, sung.events[0].id, '').events[0].lyric).toBeUndefined();
    const partial = assignSyllables(base, ['solo'], base.events[2].id);
    expect(partial.events.map((event) => event.lyric)).toEqual([undefined, undefined, 'solo', undefined]);
  });
});

describe('comments follow ids, not positions', () => {
  const melody = { ...emptyMelody(), events: parseMelodyText('C4 D4 E4').events };
  const notebook = { kind: 'notebook' as const, version: 1 as const, blocks: [{ id: 'm1', kind: 'melody' as const, content: melody }] };
  it('keeps a note comment when notes move and drops it with the note or the block', () => {
    const second = melody.events[1].id;
    const { notebook: withComment } = addComment(notebook, { blockId: 'm1', eventId: second }, 'Probar una tercera más abajo');
    const reordered = updateBlock(withComment, 'm1', (block) => (block.kind === 'melody' ? { ...block, content: reverseOrder(block.content) } : block));
    expect(reordered.comments).toHaveLength(1);
    const deletedNote = updateBlock(reordered, 'm1', (block) => (block.kind === 'melody' ? { ...block, content: removeEvents(block.content, [second]) } : block));
    expect(deletedNote.comments ?? []).toHaveLength(0);
    expect(removeBlock(withComment, 'm1').comments ?? []).toHaveLength(0);
  });
  it('a notebook with meta or comments is never collapsed into the legacy shape', () => {
    const { notebook: withComment } = addComment(notebook, {}, 'Falta resolver el puente');
    expect(fromNotebook({ type: 'tablature' }, withComment)).toBe(withComment);
    expect(toNotebook({ id: 'x', type: 'tablature', content: withComment }).comments).toHaveLength(1);
  });
});
