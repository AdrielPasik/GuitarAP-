export type BackupSummary = {
  nodes: number;
  folders: number;
  songs: number;
  documents: number;
  versions: number;
};

type BackupRecord = { kind?: unknown };

export function inspectBackup(raw: string): BackupSummary {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    throw new Error('No se pudo generar un JSON válido para el backup.');
  }
  if (!candidate || typeof candidate !== 'object') throw new Error('El backup generado no es válido.');
  const backup = candidate as { schema?: unknown; nodes?: unknown; documents?: unknown; versions?: unknown };
  if (backup.schema !== 1 || !Array.isArray(backup.nodes) || !Array.isArray(backup.documents) || !Array.isArray(backup.versions)) {
    throw new Error('El backup generado está incompleto y no se descargó.');
  }
  const nodes = backup.nodes as BackupRecord[];
  return {
    nodes: nodes.length,
    folders: nodes.filter((node) => node.kind === 'folder').length,
    songs: nodes.filter((node) => node.kind === 'song').length,
    documents: backup.documents.length,
    versions: backup.versions.length,
  };
}

export function downloadBackup(raw: string): BackupSummary {
  const summary = inspectBackup(raw);
  const blob = new Blob([raw], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = `guitarap-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.hidden = true;
  window.document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
  return summary;
}

export function describeBackup(summary: BackupSummary) {
  return `${summary.folders} carpeta(s), ${summary.songs} canción(es), ${summary.documents} documento(s) y ${summary.versions} versión(es)`;
}
