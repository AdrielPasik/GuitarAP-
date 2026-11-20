import { describe, expect, it } from 'vitest';

/**
 * v0.8 phase 1.4 — there is no way left, by an old route or an internal call, to import a backup by replacing the library.
 * These read the application's own source (not the tests') and fail if such a route comes back.
 */
const sources = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const app = Object.entries(sources).filter(([path]) => !/\.test\.tsx?$/.test(path) && !path.includes('/test/'));

describe('no destructive import exists', () => {
  it('finds the application source', () => {
    expect(app.length).toBeGreaterThan(100);
  });
  it('nothing in the application calls an importBackup or offers to replace the library', () => {
    for (const [path, text] of app) {
      expect(text, path).not.toMatch(/importBackup\s*\(/);
      expect(text, path).not.toMatch(/Reemplazar toda la biblioteca/);
    }
  });
  it('no table is ever emptied by the application', () => {
    for (const [path, text] of app) expect(text, path).not.toMatch(/db\.(nodes|documents|versions|settings|shared)\.clear\s*\(/);
  });
  it('the only code that turns a backup into records is the add-only import, and it adds with add (never put)', () => {
    const importer = app.find(([path]) => path.endsWith('backup-import.ts'))![1];
    expect(importer).toMatch(/bulkAdd/);
    expect(importer).not.toMatch(/bulkPut|\.clear\(|bulkDelete/);
    const planner = app.find(([path]) => path.endsWith('import-plan.ts'))![1];
    expect(planner).not.toMatch(/db\./); // the planner cannot write: it has no database
  });
  it('the repository has no import operation', async () => {
    const { libraryRepository } = await import('@/data/library-repository');
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(libraryRepository)).filter((name) => /import/i.test(name))).toEqual([]);
  });
});
