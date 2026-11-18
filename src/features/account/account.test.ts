import { describe, expect, it } from 'vitest';
import { describeLastSync, describeStatus, type StatusInput } from '@/features/account/account-status';
import { validateCredentials } from '@/features/account/credentials';

const base: StatusInput = {
  signedIn: true,
  linked: true,
  online: true,
  syncing: false,
  failed: false,
  offlineReport: false,
  pending: 0,
  conflicts: 0,
};

describe('sync status in plain words', () => {
  it('never lets someone believe local work is in the cloud', () => {
    const status = describeStatus({ ...base, signedIn: false, linked: false });
    expect(status.kind).toBe('local');
    expect(status.label).toBe('Solo en este dispositivo');
  });

  it('asks for the backup step before claiming anything is synced', () => {
    expect(describeStatus({ ...base, linked: false }).kind).toBe('unlinked');
  });

  it('describes each state a person can be in', () => {
    expect(describeStatus({ ...base, confirmed: true })).toMatchObject({ kind: 'synced', label: 'Todo sincronizado' });
    // Linked, nothing pending yet, but the server never confirmed a round trip: that is NOT "synced".
    expect(describeStatus({ ...base, confirmed: false })).toMatchObject({ kind: 'pending', label: 'Falta la primera sincronización' });
    expect(describeStatus({ ...base, pending: 1 }).label).toBe('1 cambio pendiente');
    expect(describeStatus({ ...base, pending: 3 }).label).toBe('3 cambios pendientes');
    expect(describeStatus({ ...base, syncing: true }).kind).toBe('syncing');
    expect(describeStatus({ ...base, failed: true }).label).toBe('No pudimos sincronizar');
    expect(describeStatus({ ...base, online: false, pending: 2 }).label).toBe('Sin conexión · 2 pendientes');
    expect(describeStatus({ ...base, offlineReport: true }).kind).toBe('offline');
  });

  it('puts conflicts first because nothing may be overwritten silently', () => {
    const status = describeStatus({ ...base, conflicts: 2, failed: true, pending: 4 });
    expect(status.kind).toBe('conflict');
    expect(status.detail).toContain('Nada se sobrescribió');
  });

  it('says when the last sync happened', () => {
    const now = Date.UTC(2026, 10, 16, 12, 0, 0);
    expect(describeLastSync(undefined, now)).toBe('Todavía no se sincronizó');
    expect(describeLastSync(now - 10_000, now)).toBe('Hace unos segundos');
    expect(describeLastSync(now - 5 * 60_000, now)).toBe('Hace 5 min');
    expect(describeLastSync(now - 3 * 3_600_000, now)).toBe('Hace 3 h');
  });
});

describe('sign-in validation', () => {
  it('asks for both fields', () => {
    expect(validateCredentials('', '')).toEqual({ email: 'Escribí tu correo.', password: 'Escribí tu contraseña.' });
  });
  it('checks the shape of the address', () => {
    expect(validateCredentials('no-es-correo', 'x').email).toBe('Revisá el formato del correo.');
    expect(validateCredentials(' a@b.co ', 'x')).toEqual({});
  });
});
