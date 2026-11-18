import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

/**
 * A REAL PostgreSQL engine (PGlite, WebAssembly) running the project's actual migrations with Supabase's shape:
 * the anon / authenticated roles, auth.users, auth.uid() driven by a JWT-claim setting, and default privileges
 * like a Supabase project. Row Level Security and function privileges are therefore enforced by Postgres itself.
 *
 * It is NOT Supabase: there is no PostgREST, no GoTrue and no network. It proves the SQL (policies, grants,
 * functions); the HTTP layer and the real project's configuration still need the manual check in docs/sharing-activation.md.
 */
export type Role = 'anon' | 'authenticated' | 'postgres';
export type Harness = Awaited<ReturnType<typeof createHarness>>;

const SHIM = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
`;

const migrationsDir = path.resolve('supabase/migrations');
export const migrationFiles = () => readdirSync(migrationsDir).filter((file) => /^000\d_.*\.sql$/.test(file) && !file.includes('rollback')).sort();

export async function createHarness(upTo = '0008') {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SHIM);
  for (const file of migrationFiles()) {
    if (file.slice(0, 4) > upTo) continue;
    await db.exec(readFileSync(path.join(migrationsDir, file), 'utf8'));
  }

  async function run(role: Role, uid: string | null, sql: string, params: unknown[] = [], headers?: Record<string, string>) {
    await db.exec('begin');
    try {
      if (role !== 'postgres') await db.exec(`set local role ${role}`);
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
      // PostgREST publishes the request headers to the function like this.
      await db.query(`select set_config('request.headers', $1, true)`, [headers ? JSON.stringify(headers) : '']);
      const result = await db.query(sql, params);
      await db.exec('commit');
      return result.rows as Array<Record<string, unknown>>;
    } catch (error) {
      await db.exec('rollback');
      throw error;
    }
  }

  const as = (role: Role, uid: string | null, headers?: Record<string, string>) => ({
    sql: (sql: string, params: unknown[] = []) => run(role, uid, sql, params, headers),
    /** Calls public.<name>(named args) the way PostgREST does, as the given role. */
    async rpc<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
      const keys = Object.keys(args);
      const call = keys.map((key, index) => `${key} => $${index + 1}`).join(', ');
      const values = keys.map((key) => (args[key] !== null && typeof args[key] === 'object' ? JSON.stringify(args[key]) : args[key]));
      const rows = await run(role, uid, `select public.${name}(${call}) as result`, values, headers);
      return rows[0].result as T;
    },
  });

  const admin = as('postgres', null);
  const newUser = async (email: string) => (await admin.sql(`insert into auth.users(email) values ($1) returning id`, [email]))[0].id as string;
  const newNode = async (owner: string, name: string, parent: string | null = null, kind: 'folder' | 'song' = 'folder') =>
    (await admin.sql(
      `insert into public.library_nodes(id, owner_id, parent_id, kind, name, sort_order, rev, created_at, updated_at) values (gen_random_uuid(), $1, $2, $3, $4, 1, 1, now(), now()) returning id`,
      [owner, parent, kind, name],
    ))[0].id as string;
  const newDocument = async (owner: string, title: string, content: unknown, nodeId: string | null = null, songId: string | null = null) =>
    (await admin.sql(
      `insert into public.documents(id, owner_id, node_id, song_id, type, title, payload, rev) values (gen_random_uuid(), $1, $2, $3, 'tablature', $4, $5::jsonb, 1) returning id`,
      [owner, nodeId, songId, title, JSON.stringify(content)],
    ))[0].id as string;

  return { db, as, admin, newUser, newNode, newDocument, close: () => db.close() };
}

export const notebook = (...blocks: Array<Record<string, unknown>>) => ({ kind: 'notebook', version: 1, blocks });
export const lyricsBlock = (id: string, text: string) => ({ id, kind: 'lyrics', content: { text } });
export const melodyBlock = (id: string, midis: number[]) => ({ id, kind: 'melody', content: { version: 1, events: midis.map((midi, index) => ({ id: `${id}-${index}`, type: 'note', midi, beats: 1 })) } });
