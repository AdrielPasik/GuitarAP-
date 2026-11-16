// Safe build diagnostics. It reports only booleans, branch names and a short commit hash:
// never a variable value, never a key. Runs before (`pre`) and after (`post`) `vite build`.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const NAMES = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
const supabaseHost = /https:\/\/[a-z0-9]{15,}\.supabase\.co/;
const jwtLike = /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g;

const has = (value) => typeof value === 'string' && value.trim().length > 0;

/** Pure: inspects the text of the built files. Returns booleans only. */
export function scanArtifact(texts, supabaseUrl) {
  const url = has(supabaseUrl) ? supabaseUrl.trim().replace(/\/$/, '') : '';
  let urlEmbedded = false;
  let projectUrlFound = false;
  let privateKeyFound = false;
  for (const text of texts) {
    if (url && text.includes(url)) urlEmbedded = true;
    if (supabaseHost.test(text)) projectUrlFound = true;
    if (text.includes('sb_secret_')) privateKeyFound = true;
    for (const match of text.matchAll(jwtLike)) {
      try {
        const payload = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
        if (payload && payload.role === 'service_role') privateKeyFound = true;
      } catch {
        /* not a JWT */
      }
    }
  }
  return { urlEmbedded, projectUrlFound, privateKeyFound };
}

async function listFiles(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(js|html|css|webmanifest|json)$/.test(entry.name))
    .map((entry) => new URL(`${entry.parentPath ?? entry.path}/${entry.name}`.replace(/\\/g, '/'), 'file:///').pathname);
}

function context() {
  const onCloudflare = process.env.CF_PAGES === '1';
  const branch = process.env.CF_PAGES_BRANCH ?? '';
  const productionBranch = process.env.PRODUCTION_BRANCH ?? 'main';
  return {
    onCloudflare,
    branch,
    commit: (process.env.CF_PAGES_COMMIT_SHA ?? '').slice(0, 7),
    // Cloudflare does not expose which branch is "production"; main is this project's.
    environment: !onCloudflare ? 'local' : branch === productionBranch ? 'production' : 'preview',
  };
}

async function viteEnv() {
  const { loadEnv } = await import('vite');
  return loadEnv('production', process.cwd(), 'VITE_');
}

async function pre() {
  const ctx = context();
  const env = await viteEnv();
  const inProcess = Object.fromEntries(NAMES.map((name) => [name, has(process.env[name])]));
  const inVite = Object.fromEntries(NAMES.map((name) => [name, has(env[name])]));
  const lines = [
    `[build-diagnostics] Cloudflare Pages build: ${ctx.onCloudflare}`,
    `[build-diagnostics] environment: ${ctx.environment}${ctx.branch ? ` (branch ${ctx.branch}, commit ${ctx.commit})` : ''}`,
    ...NAMES.map((name) => `[build-diagnostics] ${name} present in the build environment: ${inProcess[name]}`),
    ...NAMES.map((name) => `[build-diagnostics] ${name} will be inlined by Vite: ${inVite[name]}`),
    `[build-diagnostics] VITE_SUPABASE_URL looks like a Supabase project URL: ${/^https:\/\/[a-z0-9]{15,}\.supabase\.co\/?$/.test(env.VITE_SUPABASE_URL ?? '')}`,
    `[build-diagnostics] wrangler.toml in the repository: ${existsSync(new URL('../wrangler.toml', import.meta.url))}`,
  ];
  console.log(lines.join('\n'));
  if (existsSync(new URL('../wrangler.toml', import.meta.url))) {
    console.log(
      '::warning::wrangler.toml with pages_build_output_dir makes the file the source of truth for Cloudflare Pages: dashboard variables can be ignored.',
    );
  }
  if (ctx.onCloudflare && NAMES.some((name) => !inVite[name])) {
    console.log(
      `::warning::Supabase variables are missing from THIS build (${ctx.environment}). Production and Preview have separate variable sets in Cloudflare → Settings → Variables and secrets.`,
    );
  }
}

async function post() {
  const ctx = context();
  const dist = new URL('../dist/', import.meta.url);
  const files = await listFiles(fileURLToPath(dist));
  const texts = await Promise.all(files.map((file) => readFile(file.replace(/^\/([A-Za-z]:)/, '$1'), 'utf8')));
  const env = await viteEnv();
  const scan = scanArtifact(texts, env.VITE_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL);
  const info = {
    builtAt: new Date().toISOString(),
    environment: ctx.environment,
    branch: ctx.branch || null,
    commit: ctx.commit || null,
    variablesInBuildEnvironment: Object.fromEntries(NAMES.map((name) => [name, has(process.env[name]) || has(env[name])])),
    artifact: { supabaseUrlEmbedded: scan.urlEmbedded, anySupabaseProjectUrl: scan.projectUrlFound, privateKeyFound: scan.privateKeyFound },
  };
  await writeFile(new URL('build-info.json', dist), `${JSON.stringify(info, null, 2)}\n`);
  console.log(
    [
      `[build-diagnostics] artifact embeds the Supabase URL: ${scan.urlEmbedded}`,
      `[build-diagnostics] artifact contains a Supabase project URL: ${scan.projectUrlFound}`,
      `[build-diagnostics] artifact contains a private key: ${scan.privateKeyFound}`,
      '[build-diagnostics] wrote dist/build-info.json (booleans only)',
    ].join('\n'),
  );
  if (scan.privateKeyFound) {
    console.error('Refusing to publish: a service_role/secret key pattern was found in the build output.');
    process.exit(1);
  }
  if (ctx.environment === 'production' && !scan.urlEmbedded) {
    console.log('::warning::This production artifact has no Supabase URL: sign-in will report that the cloud is not connected.');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const phase = process.argv[2];
  if (phase === 'pre') await pre();
  else if (phase === 'post') await post();
  else {
    console.error('Usage: node scripts/build-diagnostics.mjs <pre|post>');
    process.exit(2);
  }
}
