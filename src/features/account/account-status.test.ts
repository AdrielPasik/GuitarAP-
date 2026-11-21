import { describe, expect, it } from 'vitest';
import { describeStatus, STALE_AFTER_MS, type StatusInput } from '@/features/account/account-status';

/**
 * v0.8 phase 1.5 — «Guardado en tu cuenta» is a claim about the server. It may only appear when everything that proves it
 * is in place; this checks every state that must NOT produce it, and a sweep over all combinations.
 */
const now = Date.UTC(2026, 10, 20, 12, 0, 0);
const clean: StatusInput = { signedIn: true, linked: true, online: true, syncing: false, failed: false, offlineReport: false, pending: 0, conflicts: 0, confirmed: true, lastConfirmedAt: now - 30_000, now };
const SAVED = 'Guardado en tu cuenta';

describe('what justifies «Guardado en tu cuenta»', () => {
  it('a recent complete confirmation, nothing pending, nothing wrong', () => {
    expect(describeStatus(clean)).toMatchObject({ kind: 'synced', label: SAVED });
  });
  it('says how old the confirmation is once it is not fresh, instead of sounding current', () => {
    const old = describeStatus({ ...clean, lastConfirmedAt: now - STALE_AFTER_MS - 60_000 * 50 });
    expect(old.kind).toBe('synced');
    expect(old.label).toMatch(/^Guardado en tu cuenta · hace /);
    expect(old.detail).toMatch(/no se pudo comprobar si hay novedades/);
  });
  it('never without the server having confirmed a complete round trip', () => {
    expect(describeStatus({ ...clean, confirmed: false, lastConfirmedAt: undefined })).toMatchObject({ kind: 'pending', label: 'Falta la primera sincronización' });
  });
});

describe('every state that does NOT justify it says something else', () => {
  const cases: Array<[string, Partial<StatusInput>]> = [
    ['changes pending to upload', { pending: 2 }],
    ['an editor still holds changes not written to the document', { unsaved: 1 }],
    ['a conflict waits', { conflicts: 1 }],
    ['records that cannot be uploaded', { skipped: 1 }],
    ['a sync is running', { syncing: true }],
    ['the first download is running', { recovering: { pulled: 3 } }],
    ['the first download is incomplete', { recoveryPending: true }],
    ['the app must be updated', { updateNeeded: true }],
    ['the last attempt failed', { failed: true }],
    ['the browser says offline', { online: false }],
    ['the last report was offline', { offlineReport: true }],
    ['the last report was offline with a network failure', { offlineReport: true, failure: { kind: 'network' } }],
    ['the server timed out', { offlineReport: true, failure: { kind: 'timeout' } }],
    ['the server answered 500', { offlineReport: true, failure: { kind: 'server', status: 500 } }],
    ['the server asked to wait (429)', { offlineReport: true, failure: { kind: 'rate-limit', status: 429 } }],
    ['not signed in', { signedIn: false }],
    ['session expired', { signedIn: false, expired: true }],
    ['not linked', { linked: false }],
  ];
  it.each(cases)('%s', (_name, change) => {
    const status = describeStatus({ ...clean, ...change });
    expect(status.label).not.toContain(SAVED);
    expect(status.kind).not.toBe('synced');
  });
  it('and across ALL combinations, "synced" appears only when every condition holds', () => {
    const flags = ['pending', 'unsaved', 'conflicts', 'skipped', 'syncing', 'recovering', 'recoveryPending', 'updateNeeded', 'failed', 'offline', 'offlineReport', 'signedOut', 'unlinked', 'neverConfirmed'] as const;
    for (let mask = 0; mask < 1 << flags.length; mask += 1) {
      const on = (flag: (typeof flags)[number]) => Boolean(mask & (1 << flags.indexOf(flag)));
      const input: StatusInput = {
        ...clean,
        pending: on('pending') ? 1 : 0,
        unsaved: on('unsaved') ? 1 : 0,
        conflicts: on('conflicts') ? 1 : 0,
        skipped: on('skipped') ? 1 : 0,
        syncing: on('syncing'),
        recovering: on('recovering') ? { pulled: 1 } : undefined,
        recoveryPending: on('recoveryPending'),
        updateNeeded: on('updateNeeded'),
        failed: on('failed'),
        online: !on('offline'),
        offlineReport: on('offlineReport'),
        signedIn: !on('signedOut'),
        linked: !on('unlinked'),
        confirmed: !on('neverConfirmed'),
        lastConfirmedAt: on('neverConfirmed') ? undefined : clean.lastConfirmedAt,
      };
      const status = describeStatus(input);
      const everythingHolds = mask === 0;
      if (everythingHolds) expect(status.kind).toBe('synced');
      else expect(status.label.startsWith(SAVED), `${flags.filter((flag) => on(flag)).join('+')} -> ${status.label}`).toBe(false);
    }
  });
});

describe('each failure says exactly what is known', () => {
  it('a network failure does not claim a cause the browser cannot see', () => {
    const status = describeStatus({ ...clean, offlineReport: true, failure: { kind: 'network' }, pending: 3 });
    expect(status.label).toBe('Sin conexión con el servidor');
    expect(status.detail).toMatch(/no dice por qué/);
    expect(status.detail).toMatch(/guardados en este dispositivo/);
    expect(status.detail).not.toMatch(/DNS (falló|no resuelve)/i);
  });
  it('a rate limit is a pause, not an error', () => {
    const status = describeStatus({ ...clean, offlineReport: true, failure: { kind: 'rate-limit' }, retryInMs: 120_000 });
    expect(status.label).toBe('Sincronización en pausa');
    expect(status.detail).toMatch(/pidió esperar/);
    expect(status.detail).toMatch(/en unos 2 min/);
  });
  it('a temporary server problem is calm and says it retries by itself', () => {
    const status = describeStatus({ ...clean, offlineReport: true, failure: { kind: 'server', status: 503 }, retryInMs: 8_000 });
    expect(status.label).toBe('Error temporal del servidor');
    expect(status.detail).toContain('503');
    expect(status.detail).toMatch(/se reintenta/i);
  });
  it('an update needed outranks everything about the connection', () => {
    expect(describeStatus({ ...clean, updateNeeded: true, offlineReport: true, failure: { kind: 'network' } }).kind).toBe('update');
    expect(describeStatus({ ...clean, updateNeeded: true }).label).toBe('Actualización necesaria');
  });
  it('an expired session is not a sign-out and keeps the library available', () => {
    const status = describeStatus({ ...clean, signedIn: false, expired: true });
    expect(status).toMatchObject({ kind: 'expired', label: 'Sesión vencida' });
    expect(status.detail).toMatch(/seguir trabajando/);
  });
  it('typing is never reported as saved anywhere', () => {
    expect(describeStatus({ ...clean, unsaved: 2 }).label).toBe('Cambios sin guardar aún');
  });
});
