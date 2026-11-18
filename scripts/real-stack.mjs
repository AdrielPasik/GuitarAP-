// Runs the sharing migration against Supabase's real Postgres image + GoTrue + PostgREST in throw-away containers.
// Usage: npm run test:real-stack      (set KEEP=1 to leave the containers running afterwards)
// Requires Docker. It never contacts a real Supabase project and uses only test accounts created for the run.
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const compose = ['compose', '-f', 'tests/real-stack/docker-compose.yml'];
const run = (args, options = {}) => execFileSync('docker', args, { stdio: options.input ? ['pipe', 'inherit', 'inherit'] : 'inherit', ...options });
const psqlFile = (file) =>
  execFileSync('docker', ['exec', '-i', 'guitarap-real-stack-db-1', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], {
    input: readFileSync(file, 'utf8'), stdio: ['pipe', 'ignore', 'inherit'],
  });

let code = 1;
try {
  run([...compose, 'down', '-v']); // always from scratch: the migrations are applied to an empty database
  run([...compose, 'up', '-d', '--wait']);
  const files = readdirSync('supabase/migrations').filter((f) => /^000\d_.*\.sql$/.test(f) && !f.includes('rollback')).sort();
  for (const file of files) {
    console.log(`applying ${file}`);
    psqlFile(path.join('supabase/migrations', file));
  }
  // PostgREST reloads its schema cache asynchronously after the migrations (NOTIFY pgrst): wait until it sees the newest
  // function instead of racing it (on a slow machine the first requests answered 404).
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = await fetch('http://127.0.0.1:4322/rpc/sync_capabilities', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.ok, () => false);
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const result = spawnSync('npx', ['vitest', 'run', 'tests/real-stack'], { stdio: 'inherit', shell: true, env: { ...process.env, REAL_STACK: '1' } });
  code = result.status ?? 1;
} finally {
  if (!process.env.KEEP) run([...compose, 'down', '-v']);
}
process.exit(code);
