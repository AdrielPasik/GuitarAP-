// A LOCAL stand-in for Supabase's REST layer, used only by the browser tests.
//
// It runs the project's real migrations (0001-0007) in a real PostgreSQL engine (PGlite) and exposes
// POST /rest/v1/rpc/<function> the way PostgREST does, with Row Level Security and function privileges enforced by
// Postgres. It is NOT Supabase: there is no real GoTrue, no real PostgREST, no network hop to a hosted project.
// Test accounts are identified by a bearer token of the form "test-user:<uuid>"; anything else is the anon role.
// Nothing here can reach a real project or a real library.
import http from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const PORT = Number(process.env.GATEWAY_PORT ?? 4310);
const migrations = path.resolve('supabase/migrations');
const SHIM = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create schema auth; create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
`;

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(SHIM);
for (const file of readdirSync(migrations).filter((f) => /^000\d_.*\.sql$/.test(f) && !f.includes('rollback')).sort()) {
  await db.exec(readFileSync(path.join(migrations, file), 'utf8'));
}

let queue = Promise.resolve();
const serial = (work) => {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
};

async function runAs(role, uid, sql, params = []) {
  await db.exec('begin');
  try {
    if (role !== 'postgres') await db.exec(`set local role ${role}`);
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
    const result = await db.query(sql, params);
    await db.exec('commit');
    return result.rows;
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
};
const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors });
  res.end(body === undefined ? '' : JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve) => {
  let data = '';
  req.on('data', (chunk) => { data += chunk; });
  req.on('end', () => resolve(data ? JSON.parse(data) : {}));
});

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === '/__health') return send(res, 200, { ok: true });
  try {
    if (url.pathname === '/__admin' && req.method === 'POST') {
      const { sql, params } = await readBody(req);
      return send(res, 200, await serial(() => runAs('postgres', null, sql, params ?? [])));
    }
    const match = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url.pathname);
    if (!match || req.method !== 'POST') return send(res, 404, { code: 'PGRST202', message: 'not found' });
    const body = await readBody(req);
    const bearer = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
    const uid = bearer.startsWith('test-user:') ? bearer.slice('test-user:'.length) : null;
    const role = uid ? 'authenticated' : 'anon';
    const keys = Object.keys(body);
    if (!keys.every((key) => /^p_[a-z_]+$/.test(key))) return send(res, 400, { code: '22023', message: 'bad argument' });
    const call = keys.map((key, index) => `${key} => $${index + 1}`).join(', ');
    const values = keys.map((key) => (body[key] !== null && typeof body[key] === 'object' ? JSON.stringify(body[key]) : body[key]));
    const rows = await serial(() => runAs(role, uid, `select public.${match[1]}(${call}) as result`, values));
    const result = rows[0]?.result;
    return send(res, result === null || result === undefined ? 204 : 200, result ?? undefined);
  } catch (error) {
    const code = String(error.code ?? '');
    const message = String(error.message ?? 'error');
    if (code === '42883' || /function public\.[a-z_]+\(.*\) does not exist/.test(message)) return send(res, 404, { code: 'PGRST202', message });
    if (code === '28000') return send(res, 401, { code, message });
    if (code === '42501' || /permission denied/.test(message)) return send(res, 403, { code: '42501', message });
    return send(res, 400, { code: code || 'P0001', message });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`test gateway on ${PORT}`));
