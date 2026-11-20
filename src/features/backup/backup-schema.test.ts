import { describe, expect, it } from 'vitest';
import { BackupError, LIMITS, parseBackup } from '@/features/backup/backup-schema';

/** Reading a backup file safely: every way it can be wrong ends in a plain sentence, and nothing odd gets through. */
const content = { kind: 'notebook', version: 1, blocks: [] };
const doc = (id: string, extra: Record<string, unknown> = {}) => ({ id, nodeId: null, songId: null, type: 'tablature', title: id, content, rev: 1, createdAt: 1, updatedAt: 1, ...extra });
const file = (parts: Record<string, unknown> = {}) => JSON.stringify({ schema: 1, exportedAt: '2026-11-20T10:00:00.000Z', nodes: [], documents: [], versions: [], ...parts });
const reason = (raw: string) => {
  try {
    parseBackup(raw);
  } catch (error) {
    expect(error).toBeInstanceOf(BackupError);
    return (error as Error).message;
  }
  return 'accepted';
};

describe('files that cannot be a backup say why', () => {
  it('empty, blank, not JSON, not an object', () => {
    expect(reason('')).toMatch(/vacío/);
    expect(reason('   \n ')).toMatch(/vacío/);
    expect(reason('{')).toMatch(/JSON válido/);
    expect(reason('[1,2,3]')).toMatch(/no parece una copia/);
    expect(reason('"hola"')).toMatch(/no parece una copia/);
  });
  it('no schema, or one this version does not know, or a newer one', () => {
    expect(reason(JSON.stringify({ nodes: [], documents: [], versions: [] }))).toMatch(/no dice con qué versión/);
    expect(reason(JSON.stringify({ schema: 'uno', nodes: [], documents: [], versions: [] }))).toMatch(/no dice con qué versión/);
    expect(reason(JSON.stringify({ schema: 0, nodes: [], documents: [], versions: [] }))).toMatch(/no dice con qué versión/);
    expect(reason(file({ schema: 99 }))).toMatch(/versión más nueva/);
  });
  it('missing sections', () => {
    expect(reason(JSON.stringify({ schema: 1, nodes: [], documents: [] }))).toMatch(/incompleta/);
    expect(reason(JSON.stringify({ schema: 1, nodes: {}, documents: [], versions: [] }))).toMatch(/incompleta/);
  });
  it('more elements than can be imported at once', () => {
    const many = Array.from({ length: LIMITS.nodes + 1 }, (_, index) => ({ id: `n${index}`, kind: 'folder', name: 'x' }));
    expect(reason(file({ nodes: many }))).toMatch(/más elementos/);
  });
});

describe('what it accepts', () => {
  it('an old backup (schema 1) and an empty one', () => {
    const parsed = parseBackup(file({ documents: [doc('d1')] }));
    expect(parsed.schema).toBe(1);
    expect(parsed.documents).toHaveLength(1);
    const empty = parseBackup(file());
    expect(empty.documents).toEqual([]);
    expect(empty.invalidTotal).toBe(0);
  });
  it('schema 2: the library part is read and the rest is listed, not imported and not an error', () => {
    const parsed = parseBackup(file({ schema: 2, documents: [doc('d1')], preferences: { 'appearance.skin': 'vinilo' }, folderPresentations: {} }));
    expect(parsed.schema).toBe(2);
    expect(parsed.documents).toHaveLength(1);
    expect(parsed.extras.sort()).toEqual(['folderPresentations', 'preferences']);
  });
  it('keeps the record fields it needs and drops everything else', () => {
    const parsed = parseBackup(file({ documents: [doc('d1', { somethingElse: 'x', onclick: 'alert(1)' })] }));
    expect(Object.keys(parsed.documents[0]).sort()).toEqual(['content', 'createdAt', 'id', 'nodeId', 'ownerId', 'rev', 'songId', 'title', 'type', 'updatedAt']);
  });
});

describe('records that are not valid are left out, counted and explained', () => {
  it('repeated ids, unknown types, missing content, bad references', () => {
    const parsed = parseBackup(
      file({
        nodes: [{ id: 'f', kind: 'folder', name: 'A' }, { id: 'f', kind: 'folder', name: 'otra' }, { id: 'g', kind: 'carpeta?', name: 'x' }, { id: '', kind: 'folder', name: 'x' }],
        documents: [doc('d1'), doc('d1'), doc('d2', { type: 'cancion' }), doc('d3', { content: null }), doc('d4', { nodeId: 7 }), 'basura', null],
        versions: [{ id: 'v1', documentId: 'd1', title: 't', content }, { id: 'v1', documentId: 'd1', title: 't', content }, { id: 'v2', title: 't', content }],
      }),
    );
    expect(parsed.nodes.map((item) => item.id)).toEqual(['f']);
    expect(parsed.documents.map((item) => item.id)).toEqual(['d1']);
    expect(parsed.versions.map((item) => item.id)).toEqual(['v1']);
    expect(parsed.invalidTotal).toBe(11); // 3 folders, 6 documents, 2 versions
    expect(parsed.invalid.length).toBeLessThanOrEqual(LIMITS.invalidKept);
    expect(parsed.invalid.map((item) => item.reason)).toEqual(expect.arrayContaining(['identificador repetido', 'tipo desconocido', 'no tiene contenido']));
  });
  it('a document bigger than the limit', () => {
    const big = { kind: 'notebook', blocks: [{ text: 'x'.repeat(LIMITS.contentBytes + 10) }] };
    const parsed = parseBackup(file({ documents: [doc('big', { content: big }), doc('ok')] }));
    expect(parsed.documents.map((item) => item.id)).toEqual(['ok']);
    expect(parsed.invalid[0].reason).toMatch(/demasiado grande/);
  });
  it('nesting that is absurdly deep', () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < LIMITS.depth + 5; i += 1) deep = { child: deep };
    const parsed = parseBackup(file({ documents: [doc('deep', { content: deep }), doc('ok')] }));
    expect(parsed.documents.map((item) => item.id)).toEqual(['ok']);
    expect(parsed.invalidTotal).toBe(1);
  });
});

describe('dangerous fields', () => {
  it('keys that could tamper with prototypes never come through, at any depth', () => {
    const raw = `{"schema":1,"nodes":[],"versions":[],"documents":[{"id":"d","nodeId":null,"songId":null,"type":"tablature","title":"t","rev":1,"createdAt":1,"updatedAt":1,"content":{"kind":"notebook","__proto__":{"polluted":true},"nested":{"constructor":{"prototype":{"polluted":true}},"ok":1}}}]}`;
    const parsed = parseBackup(raw);
    const text = JSON.stringify(parsed.documents[0].content);
    expect(text).not.toContain('__proto__');
    expect(text).not.toContain('constructor');
    expect(text).toContain('"ok":1');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('odd section names are not echoed back', () => {
    const parsed = parseBackup(file({ '<img src=x onerror=alert(1)>': 1, preferences: {} }));
    expect(parsed.extras).toEqual(['preferences']);
  });
});
