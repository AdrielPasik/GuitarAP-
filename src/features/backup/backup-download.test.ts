import { describe, expect, it } from 'vitest';
import { inspectBackup } from '@/features/backup/backup-download';

describe('backup validation', () => {
  it('reports every recoverable collection before download', () => {
    const summary = inspectBackup(JSON.stringify({
      schema: 1,
      nodes: [{ kind: 'folder' }, { kind: 'song' }],
      documents: [{ id: 'document-1' }],
      versions: [{ id: 'version-1' }],
    }));
    expect(summary).toEqual({ nodes: 2, folders: 1, songs: 1, documents: 1, versions: 1 });
  });

  it('rejects malformed and incomplete output instead of claiming success', () => {
    expect(() => inspectBackup('{')).toThrow('JSON válido');
    expect(() => inspectBackup(JSON.stringify({ schema: 1, nodes: [], documents: [] }))).toThrow('incompleto');
  });
});
