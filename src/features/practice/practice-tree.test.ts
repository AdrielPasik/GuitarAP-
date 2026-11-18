import { describe, expect, it } from 'vitest';
import type { LibraryNode, MusicalDocument } from '@/core/model';
import { countBelow, levelOf, locationOf, partsOf, searchMaterials } from '@/features/practice/practice-tree';

const node = (id: string, name: string, kind: 'folder' | 'song', parentId: string | null): LibraryNode => ({ id, name, kind, parentId, order: 1, createdAt: 1, updatedAt: 1, rev: 1 });
const doc = (id: string, title: string, nodeId: string | null, songId: string | null = null, createdAt = 1): MusicalDocument =>
  ({ id, title, nodeId, songId, type: 'tablature', content: { kind: 'notebook', version: 1, blocks: [] } as never, rev: 1, createdAt, updatedAt: createdAt });

// The library from the user's screenshot: ESCALAS (C and D Jonico), a song project with two parts, one loose melody.
const nodes = [node('esc', 'ESCALAS', 'folder', null), node('tema', 'Tema 1 ft Gottya', 'song', null), node('sub', 'Modos', 'folder', 'esc')];
const docs = [
  doc('c', 'C Jónico', 'esc'),
  doc('d', 'D Jónico', 'esc'),
  doc('arr', 'Arreglos', null, 'tema', 20),
  doc('let', 'Letra y melodía', null, 'tema', 10),
  doc('mel', 'Nueva melodía', null),
  doc('deep', 'Dórico', 'sub'),
];

describe('Practice reads the library hierarchy instead of a flat list', () => {
  it('the root shows folders, songs and loose materials, and nothing from inside them', () => {
    const root = levelOf(nodes, docs, null);
    expect(root.nodes.map((n) => n.name)).toEqual(['ESCALAS', 'Tema 1 ft Gottya']);
    expect(root.documents.map((d) => d.title)).toEqual(['Nueva melodía']);
  });
  it('a folder shows its scales and sub-folders, a song shows its parts in creation order', () => {
    const folder = levelOf(nodes, docs, 'esc');
    expect(folder.nodes.map((n) => n.name)).toEqual(['Modos']);
    expect(folder.documents.map((d) => d.title)).toEqual(['C Jónico', 'D Jónico']);
    expect(folder.trail.map((n) => n.name)).toEqual(['ESCALAS']);
    const song = levelOf(nodes, docs, 'tema');
    expect(song.documents.map((d) => d.title)).toEqual(['Letra y melodía', 'Arreglos']);
    expect(song.nodes).toEqual([]);
  });
  it('hierarchies do not mix: nothing from the song appears under the folder and vice versa', () => {
    const titles = (id: string | null) => levelOf(nodes, docs, id).documents.map((d) => d.title);
    expect(titles('esc')).not.toContain('Arreglos');
    expect(titles('tema')).not.toContain('C Jónico');
    expect(titles(null)).not.toContain('C Jónico');
  });
  it('knows where a document lives and who its sibling parts are', () => {
    expect(locationOf(nodes, docs[2])).toBe('tema');
    expect(locationOf(nodes, docs[0])).toBe('esc');
    expect(locationOf(nodes, docs[4])).toBeNull();
    expect(partsOf(docs, docs[2]).map((d) => d.title)).toEqual(['Letra y melodía', 'Arreglos']);
    expect(partsOf(docs, docs[0])).toEqual([]);
  });
  it('counts what is below a folder and finds materials with their path', () => {
    expect(countBelow(nodes, docs, nodes[0])).toBe(3);
    const hits = searchMaterials(nodes, docs, 'jónico');
    expect(hits.map((h) => [h.document.title, h.where])).toEqual([['C Jónico', 'ESCALAS'], ['D Jónico', 'ESCALAS']]);
    expect(searchMaterials(nodes, docs, '  ')).toEqual([]);
  });
});
