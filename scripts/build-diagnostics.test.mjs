import { describe, expect, it } from 'vitest';
import { scanArtifact } from './build-diagnostics.mjs';

const jwt = (payload) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signaturesignature`;
const url = 'https://abcdefghijklmnopqrst.supabase.co';

describe('build artifact scan', () => {
  it('detects whether the configured URL was inlined, without needing its value in the output', () => {
    expect(scanArtifact([`const a="${url}"`], url)).toMatchObject({ urlEmbedded: true, projectUrlFound: true });
    expect(scanArtifact(['const a=void 0'], url)).toMatchObject({ urlEmbedded: false, projectUrlFound: false });
    expect(scanArtifact([`x="${url}"`], '')).toMatchObject({ urlEmbedded: false, projectUrlFound: true });
  });

  it('accepts the public anon key and rejects service_role or secret keys', () => {
    expect(scanArtifact([`k="${jwt({ role: 'anon' })}"`], url).privateKeyFound).toBe(false);
    expect(scanArtifact([`k="${jwt({ role: 'service_role' })}"`], url).privateKeyFound).toBe(true);
    expect(scanArtifact(['k="sb_secret_abcdefghijklmnop"'], url).privateKeyFound).toBe(true);
    expect(scanArtifact(['k="sb_publishable_abcdefghijklmnop"'], url).privateKeyFound).toBe(false);
  });
});
