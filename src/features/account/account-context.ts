import { createContext, useContext } from 'react';
import type { BackupSummary } from '@/features/backup/backup-download';
import type { StatusView } from '@/features/account/account-status';
import type { SyncDiagnostic, Explained } from '@/features/sync/diagnostic';
import type { SupabaseSession } from '@/features/sync/supabase-auth';

export type Dialog = null | 'sign-in' | 'protect';
export type RecoveryCounts = { folders: number; songs: number; documents: number; trashed: number; versions: number };
/** The first download of an account on this device, as the person sees it. Only facts the library itself confirmed. */
export type RecoveryView =
  | { phase: 'idle' }
  | { phase: 'recovering'; pulled: number; pages: number; /** what it is doing right now */ step?: 'push' | 'pull'; /** true: nothing is being uploaded */ downloadOnly?: boolean }
  | { phase: 'waiting'; reason: 'offline' | 'error' | 'halted' }
  | { phase: 'done'; counts: RecoveryCounts; empty: boolean; issues: number; seen: boolean };
/** Material this device holds that belongs to no account: listed, never adopted without a decision. */
export type LocalDataView = { nodes: number; documents: Array<{ id: string; title: string }>; decided: boolean };
export type BackupFlow = {
  summary: BackupSummary | null;
  summaryText: string;
  busy: boolean;
  error: string;
  confirmed: boolean;
};

export type Account = {
  /** False when this build has no Supabase settings: the UI says so instead of hiding sign-in. */
  configured: boolean;
  restoring: boolean;
  session: SupabaseSession | null;
  email: string | undefined;
  /** Who the library on screen belongs to: a live session, an expired one (offline access), nobody (signed out) or no account at all. */
  identityMode: 'authenticated' | 'expired' | 'signed-out' | 'anonymous';
  linked: boolean;
  status: StatusView;
  lastSyncAt: number | undefined;
  message: string;
  /** Local changes the server has not confirmed yet (documents and folders). */
  pendingCount: number;
  conflictCount: number;
  autoSync: boolean;
  setAutoSync: (value: boolean) => void;
  dialog: Dialog;
  openDialog: (dialog: Exclude<Dialog, null>) => void;
  closeDialog: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  /** Resolves true only when the server confirmed the round trip (nothing pending, nothing failed). */
  syncNow: () => Promise<boolean>;
  syncDiagnostic: SyncDiagnostic | undefined;
  syncProblem: Explained | undefined;
  probeServer: () => Promise<void>;
  backup: BackupFlow;
  prepareBackup: () => Promise<void>;
  setBackupConfirmed: (value: boolean) => void;
  linkLibrary: () => Promise<void>;
  /** v0.8 phase 1.3 behind its flag: false means everything below stays inert and the previous behaviour applies. */
  autoRecovery: boolean;
  recovery: RecoveryView;
  dismissRecovery: () => void;
  /**
   * Downloads the account's log again, deleting nothing. 'download': never writes to the server and leaves records with
   * un-uploaded changes as they are. 'sync': uploads pending changes first, then downloads (the person confirmed it).
   */
  rebuildFromCloud: (mode: 'download' | 'sync') => Promise<{ refetched: number; held: number; pushed: number } | undefined>;
  localData: LocalDataView | null;
  adoptLocalData: () => Promise<void>;
  keepLocalData: () => Promise<void>;
  backupLocalData: () => Promise<void>;
};

export const AccountContext = createContext<Account | null>(null);

export function useAccount() {
  const value = useContext(AccountContext);
  if (!value) throw new Error('useAccount debe usarse dentro de AccountProvider.');
  return value;
}


export const emptyBackup: BackupFlow = { summary: null, summaryText: '', busy: false, error: '', confirmed: false };
