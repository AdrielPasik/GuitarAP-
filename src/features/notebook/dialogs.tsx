import { useLiveQuery } from 'dexie-react-hooks';
import { Dialog } from '@/components/ui/Dialog';
import { db } from '@/data/database';
import { belongsToOwner, libraryScope } from '@/data/library-scope';
import { libraryRepository } from '@/data/library-repository';

const reasonLabel: Record<string, string> = {
  autosave: 'Guardado automático',
  manual: 'Guardado manual',
  'pre-restore': 'Antes de restaurar',
  import: 'Importación',
  'conflict-device': 'Punto de recuperación: versión de este dispositivo (conflicto)',
  'conflict-cloud': 'Punto de recuperación: versión de la nube (conflicto)',
};

export function HistoryDialog({
  documentId,
  onClose,
  onRestored,
}: {
  documentId: string;
  onClose: () => void;
  onRestored: () => void;
}) {
  const versions = useLiveQuery(
    async () => {
      const scope = await libraryScope();
      return (await db.versions.where('documentId').equals(documentId).sortBy('createdAt')).filter((version) => belongsToOwner(version, scope)).reverse();
    },
    [documentId],
  );
  return (
    <Dialog title="Historial de versiones" onClose={onClose} size="lg">
      <p className="muted">
        Restaurar guarda primero el estado actual como una versión más: no se pierde nada.
      </p>
      {!versions ? (
        <p className="muted">Cargando…</p>
      ) : versions.length === 0 ? (
        <p className="muted">Todavía no hay versiones anteriores de este material.</p>
      ) : (
        <ul className="version-list">
          {versions.map((version) => (
            <li key={version.id}>
              <span>
                <strong>{new Date(version.createdAt).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })}</strong>
                <small>{reasonLabel[version.reason] ?? version.reason}</small>
              </span>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void libraryRepository.restoreVersion(documentId, version.id).then(() => {
                    onRestored();
                    onClose();
                  });
                }}
              >
                Restaurar
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

const shortcuts: Array<[string, string]> = [
  ['0–9', 'Escribir el traste (12, 15, 24 con dos dígitos seguidos)'],
  ['← → ↑ ↓', 'Moverse por eventos y cuerdas'],
  ['Espacio · Enter · Tab', 'Confirmar y pasar al evento siguiente'],
  ['Retroceso · Supr', 'Borrar la nota (nunca el evento)'],
  ['Mayús + ← →', 'Seleccionar eventos'],
  ['Ctrl+C · X · V · D', 'Copiar, cortar, pegar, duplicar'],
  ['Ctrl+Enter · Ctrl+⌫', 'Insertar o eliminar un evento'],
  ['h o p', 'Ligado con la nota siguiente de la cuerda'],
  ['/ o \\', 'Slide con la nota siguiente de la cuerda'],
  ['b · ~ · x', 'Bend (½, 1), vibrato, nota apagada'],
  ['Ctrl+Z · Ctrl+Y', 'Deshacer y rehacer'],
  ['Mástil: flechas y espacio', 'Marcar o desmarcar con el teclado'],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Atajos de teclado" onClose={onClose} size="md">
      <dl className="shortcuts">
        {shortcuts.map(([keys, action]) => (
          <div key={keys}>
            <dt>
              <kbd>{keys}</kbd>
            </dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
