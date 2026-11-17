// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';

describe('the test database', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  }, 120_000);
  afterAll(async () => {
    await h.close();
  });

  it('runs the real migrations 0001 to 0007 and exposes the sharing capability probe to anyone', async () => {
    expect(await h.as('anon', null).rpc('collab_capabilities')).toEqual({ sharing: 1 });
    const tables = await h.admin.sql(`select table_name from information_schema.tables where table_schema = 'public' order by 1`);
    expect(tables.map((row) => row.table_name)).toEqual(expect.arrayContaining(['documents', 'library_nodes', 'share_members', 'share_links', 'share_invites', 'collab_ops']));
  });

  it('bcrypt and sha256 are available the way the migration needs them', async () => {
    const rows = await h.admin.sql(`select extensions.crypt('secreto', extensions.gen_salt('bf', 4)) as hash, encode(extensions.digest('abc', 'sha256'), 'hex') as sha`);
    expect(String(rows[0].hash)).toMatch(/^\$2[aby]\$04\$/);
    expect(rows[0].sha).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
