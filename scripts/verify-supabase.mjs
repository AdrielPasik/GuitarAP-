import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

function parseEnv(raw) {
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        const value = line
          .slice(separator + 1)
          .trim()
          .replace(/^(['"])(.*)\1$/, '$2');
        return [line.slice(0, separator).trim(), value];
      }),
  );
}

async function localEnvironment() {
  const combined = {};
  for (const file of ['.env.local', '.env.sync-test.local']) {
    try {
      Object.assign(
        combined,
        parseEnv(await readFile(new URL(`../${file}`, import.meta.url), 'utf8')),
      );
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return { ...combined, ...process.env };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const env = await localEnvironment();
const required = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'GUITARAP_TEST_USER_A_EMAIL',
  'GUITARAP_TEST_USER_A_PASSWORD',
  'GUITARAP_TEST_USER_B_EMAIL',
  'GUITARAP_TEST_USER_B_PASSWORD',
];
const missing = required.filter((name) => !env[name]);
if (missing.length) {
  throw new Error(`Faltan variables para la prueba remota aislada: ${missing.join(', ')}.`);
}
if (env.GUITARAP_REMOTE_TEST_CONFIRM !== 'isolated-test-users') {
  throw new Error(
    'Definí GUITARAP_REMOTE_TEST_CONFIRM=isolated-test-users únicamente después de crear dos cuentas exclusivas para QA.',
  );
}
assert(
  env.GUITARAP_TEST_USER_A_EMAIL !== env.GUITARAP_TEST_USER_B_EMAIL,
  'Las dos cuentas de QA deben ser diferentes.',
);

const baseUrl = env.VITE_SUPABASE_URL.replace(/\/$/, '');
const publicKey = env.VITE_SUPABASE_ANON_KEY;
const run = randomUUID().slice(0, 8);
const now = Date.now();
const ids = {
  root: randomUUID(),
  nested: randomUUID(),
  song: randomUUID(),
  tab: randomUUID(),
  map: randomUUID(),
  tabVersion: randomUUID(),
  mapVersion: randomUUID(),
};

async function request(
  path,
  { token, method = 'GET', body, headers = {}, allowFailure = false } = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      apikey: publicKey,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok && !allowFailure)
    throw new Error(
      `Supabase respondió ${response.status} para ${path}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`,
    );
  return { response, payload };
}

async function signIn(email, password) {
  const { payload } = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password },
  });
  assert(
    typeof payload?.access_token === 'string' && typeof payload?.user?.id === 'string',
    'Supabase Auth no devolvió una sesión válida.',
  );
  return { token: payload.access_token, ownerId: payload.user.id };
}

async function rpc(session, name, body, allowFailure = false) {
  return request(`/rest/v1/rpc/${name}`, {
    token: session.token,
    method: 'POST',
    body,
    allowFailure,
  });
}

async function push(session, opId, snapshot) {
  const { payload } = await rpc(session, 'sync_library', {
    p_owner_id: session.ownerId,
    p_op_id: opId,
    p_snapshot: snapshot,
  });
  return payload;
}

async function pullAll(session, cursor = '0', limit = 2) {
  const changes = [];
  let next = cursor;
  let hasMore = false;
  do {
    const { payload } = await rpc(session, 'pull_library', {
      p_owner_id: session.ownerId,
      p_after: next,
      p_limit: limit,
    });
    assert(Array.isArray(payload?.changes), 'pull_library no devolvió una página válida.');
    changes.push(...payload.changes);
    next = payload.cursor;
    hasMore = payload.hasMore;
  } while (hasMore);
  return { cursor: next, changes };
}

const node = (id, parentId, kind, name, extra = {}) => ({
  id,
  parentId,
  kind,
  name,
  order: now,
  rev: 1,
  createdAt: now,
  updatedAt: now,
  ...extra,
});
const root = node(ids.root, null, 'folder', `[GuitarAP QA ${run}]`);
const nested = node(ids.nested, ids.root, 'folder', 'Escalas');
const song = node(ids.song, ids.root, 'song', 'Canción QA', {
  song: { artist: 'QA', key: 'C', bpm: 96 },
});
let tablature = {
  id: ids.tab,
  nodeId: ids.root,
  songId: ids.song,
  type: 'tablature',
  title: `Solo QA ${run}`,
  content: {
    tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'],
    columns: [5, 7, 8].map((fret) => ({ id: randomUUID(), cells: [{ fret }, {}, {}, {}, {}, {}] })),
    zoom: 1,
    wrapAfter: 16,
    annotations: [],
    techniqueLinks: [],
  },
  rev: 1,
  createdAt: now,
  updatedAt: now,
};
let fretboard = {
  id: ids.map,
  nodeId: ids.nested,
  songId: null,
  type: 'fretboard',
  title: `Do mayor QA ${run}`,
  content: {
    tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'],
    maxFret: 15,
    root: 0,
    notation: 'notes',
    latin: true,
    positions: [1, 2, 3].map((number) => ({
      id: randomUUID(),
      name: `Posición ${number}`,
      notes: [0, 1, 3, 5, 7, 8].map((fret) => ({ string: 5, fret })),
    })),
    baseNotes: [],
    selectedPositionId: '',
  },
  rev: 1,
  createdAt: now,
  updatedAt: now,
};
fretboard.content.selectedPositionId = fretboard.content.positions[0].id;
const versions = [
  {
    id: ids.tabVersion,
    documentId: ids.tab,
    reason: 'manual',
    title: tablature.title,
    content: tablature.content,
    createdAt: now,
  },
  {
    id: ids.mapVersion,
    documentId: ids.map,
    reason: 'manual',
    title: fretboard.title,
    content: fretboard.content,
    createdAt: now,
  },
];

let accountA;
let created = false;
try {
  console.log(
    `Iniciando validación remota aislada ${run}. No se enumerarán ni modificarán registros preexistentes.`,
  );
  accountA = await signIn(env.GUITARAP_TEST_USER_A_EMAIL, env.GUITARAP_TEST_USER_A_PASSWORD);
  const deviceB = await signIn(env.GUITARAP_TEST_USER_A_EMAIL, env.GUITARAP_TEST_USER_A_PASSWORD);
  const otherUser = await signIn(env.GUITARAP_TEST_USER_B_EMAIL, env.GUITARAP_TEST_USER_B_PASSWORD);

  const initialOperation = randomUUID();
  const initial = await push(accountA, initialOperation, {
    nodes: [root, nested, song],
    documents: [tablature, fretboard],
    versions,
  });
  assert(
    initial.nodes?.length === 3 &&
      initial.documents?.length === 2 &&
      initial.versions?.length === 2,
    'La creación inicial no aplicó todos los registros.',
  );
  assert(initial.conflicts?.length === 0, 'La creación inicial devolvió conflictos inesperados.');
  created = true;

  const duplicate = await push(accountA, initialOperation, {
    nodes: [root, nested, song],
    documents: [tablature, fretboard],
    versions,
  });
  assert(
    JSON.stringify(duplicate) === JSON.stringify(initial),
    'La repetición del mismo op_id no fue idempotente.',
  );

  let deviceState = await pullAll(deviceB, '0', 2);
  assert(
    deviceState.changes.length === 7,
    `La segunda sesión recibió ${deviceState.changes.length} cambios en vez de 7.`,
  );
  const pulledIds = new Set(deviceState.changes.map((change) => change.record.id));
  for (const id of Object.values(ids)) assert(pulledIds.has(id), `Falta el registro remoto ${id}.`);

  const forbiddenPull = await rpc(
    otherUser,
    'pull_library',
    {
      p_owner_id: accountA.ownerId,
      p_after: '0',
      p_limit: 10,
    },
    true,
  );
  assert(
    !forbiddenPull.response.ok,
    'RLS/RPC permitió a la segunda cuenta leer el owner de la primera.',
  );

  for (const [table, id] of [
    ['documents', ids.tab],
    ['library_nodes', ids.root],
    ['document_versions', ids.tabVersion],
  ]) {
    const { payload } = await request(`/rest/v1/${table}?id=eq.${id}&select=id`, {
      token: otherUser.token,
    });
    assert(Array.isArray(payload) && payload.length === 0, `RLS expuso ${table} a otra cuenta.`);
  }
  const forbiddenWrite = await request(`/rest/v1/documents?id=eq.${ids.tab}&select=id`, {
    token: otherUser.token,
    method: 'PATCH',
    body: { title: 'RLS should block this' },
    headers: { prefer: 'return=representation' },
    allowFailure: true,
  });
  assert(
    !forbiddenWrite.response.ok ||
      (Array.isArray(forbiddenWrite.payload) && forbiddenWrite.payload.length === 0),
    'RLS permitió modificar un documento ajeno.',
  );

  tablature = { ...tablature, nodeId: ids.nested, rev: 2, updatedAt: Date.now() };
  const moved = await push(accountA, randomUUID(), {
    nodes: [],
    documents: [tablature],
    versions: [],
  });
  assert(
    moved.documents?.[0]?.nodeId === ids.nested,
    'El movimiento entre carpetas no se propagó.',
  );

  tablature = { ...tablature, rev: 3, deletedAt: Date.now(), updatedAt: Date.now() };
  const trashed = await push(accountA, randomUUID(), {
    nodes: [],
    documents: [tablature],
    versions: [],
  });
  assert(trashed.documents?.[0]?.deletedAt, 'La papelera no se propagó.');
  const { deletedAt: _discarded, ...restoredTablature } = tablature;
  void _discarded;
  tablature = { ...restoredTablature, rev: 4, updatedAt: Date.now() };
  const restored = await push(accountA, randomUUID(), {
    nodes: [],
    documents: [tablature],
    versions: [],
  });
  assert(
    restored.documents?.[0] && !restored.documents[0].deletedAt,
    'La restauración no se propagó.',
  );

  const winner = {
    ...tablature,
    title: `${tablature.title} · dispositivo A`,
    rev: 5,
    updatedAt: Date.now(),
  };
  const loser = {
    ...tablature,
    title: `${tablature.title} · dispositivo B offline`,
    rev: 5,
    updatedAt: Date.now() + 1,
  };
  const winnerResult = await push(accountA, randomUUID(), {
    nodes: [],
    documents: [winner],
    versions: [],
  });
  assert(winnerResult.documents?.length === 1, 'La primera edición concurrente no se aplicó.');
  const conflictResult = await push(deviceB, randomUUID(), {
    nodes: [],
    documents: [loser],
    versions: [],
  });
  assert(
    conflictResult.conflicts?.length === 1 && conflictResult.documents?.length === 0,
    'La segunda edición concurrente no se devolvió como conflicto.',
  );
  assert(
    conflictResult.conflicts[0].title === winner.title,
    'El conflicto no conservó la versión remota más reciente.',
  );
  tablature = winner;

  const afterChanges = await pullAll(deviceB, deviceState.cursor, 2);
  assert(
    afterChanges.changes.length === 4,
    'La segunda sesión no recibió movimiento, papelera, restauración y edición ganadora.',
  );
  deviceState = afterChanges;
  console.log(
    'OK: autenticación, paginación, idempotencia, dos sesiones, RLS, movimiento, papelera, restauración, mapas, historial y conflicto.',
  );
} finally {
  if (created && accountA && env.GUITARAP_REMOTE_TEST_KEEP !== '1') {
    const deletedAt = Date.now();
    try {
      const cleanup = await push(accountA, randomUUID(), {
        nodes: [root, nested, song].map((item) => ({
          ...item,
          rev: item.rev + 1,
          deletedAt,
          updatedAt: deletedAt,
        })),
        documents: [tablature, fretboard].map((item) => ({
          ...item,
          rev: item.rev + 1,
          deletedAt,
          updatedAt: deletedAt,
        })),
        versions: [],
      });
      assert(cleanup.conflicts?.length === 0, 'El cierre aislado devolvió conflictos.');
      console.log(
        `Los materiales QA ${run} quedaron enviados a papelera; no se borró ninguna fila.`,
      );
    } catch (error) {
      console.error(
        `No se pudo enviar a papelera el conjunto QA ${run}. Sus títulos incluyen este identificador.`,
      );
      console.error(error instanceof Error ? error.message : String(error));
    }
  }
}
