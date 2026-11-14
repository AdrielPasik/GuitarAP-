import { describe, expect, it } from 'vitest';
import { createTablatureContent, type MusicalDocument } from '@/core/model';
import { FakeTransport } from '@/features/sync/transport';

const document = (rev = 1): MusicalDocument => ({ id: 'doc', nodeId: null, type: 'tablature', title: 'Riff', content: createTablatureContent(), rev, createdAt: 1, updatedAt: 1 });
describe('FakeTransport', () => { it('is idempotent and exposes concurrent revisions as conflicts', async () => { const transport = new FakeTransport(); expect((await transport.push('u', 'op-1', [document()])).applied).toHaveLength(1); expect((await transport.push('u', 'op-1', [document()])).applied).toHaveLength(1); const conflict = await transport.push('u', 'op-2', [document(1)]); expect(conflict.conflicts).toHaveLength(1); }); });
