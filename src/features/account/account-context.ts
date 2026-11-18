import { createContext, useContext } from 'react';
import type { BackupSummary } from '@/features/backup/backup-download';
import type { StatusView } from '@/features/account/account-status';
import type { SyncDiagnostic, Explained } from '@/features/sync/diagnostic';
import type { SupabaseSession } from '@/features/sync/supabase-auth';

export type Dialog = null | 'sign-in' | 'protect';
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
  linked: boolean;
  status: StatusView;
  lastSyncAt: number | undefined;
  message: string;
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
};

export const AccountContext = createContext<Account | null>(null);

export function useAccount() {
  const value = useContext(AccountContext);
  if (!value) throw new Error('useAccount debe usarse dentro de AccountProvider.');
  return value;
}


export const emptyBackup: BackupFlow = { summary: null, summaryText: '', busy: false, error: '', confirmed: false };
