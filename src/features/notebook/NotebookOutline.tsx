import type { NotebookContent } from '@/core/model';
import { Icon } from '@/components/ui/Icon';
import { blockMeta } from '@/features/notebook/block-meta';

/**
 * A compact index of the song: its sections, and under each the blocks it holds. It only navigates (it scrolls to
 * the chosen block); it never edits. Collapsible from the notebook header.
 */
export function NotebookOutline({ notebook, onClose }: { notebook: NotebookContent; onClose: () => void }) {
  type Group = { id: string | null; title: string; blocks: Array<{ id: string; label: string; kind: NotebookContent['blocks'][number]['kind'] }> };
  const groups: Group[] = [];
  let current: Group = { id: null, title: '', blocks: [] };
  for (const block of notebook.blocks) {
    if (block.kind === 'section') {
      if (current.id !== null || current.blocks.length) groups.push(current);
      current = { id: block.id, title: block.title || 'Sección sin nombre', blocks: [] };
    } else {
      const meta = blockMeta[block.kind] ?? { label: 'Bloque' };
      const title = 'title' in block && block.title?.trim() ? block.title.trim() : '';
      current.blocks.push({ id: block.id, label: title || meta.label, kind: block.kind });
    }
  }
  if (current.id !== null || current.blocks.length) groups.push(current);
  const go = (id: string) => document.getElementById(`block-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  return (
    <nav className="outline" aria-label="Índice de la canción">
      <header>
        <h2>Índice</h2>
        <button type="button" className="icon-btn" aria-label="Cerrar el índice" onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </header>
      {groups.length === 0 ? (
        <p className="muted small">Cuando agregues bloques o secciones, aparecen acá.</p>
      ) : (
        <ul>
          {groups.map((group, index) => (
            <li key={group.id ?? `loose-${index}`}>
              {group.id ? (
                <button type="button" className="outline-section" onClick={() => go(group.id!)}>
                  {group.title}
                </button>
              ) : (
                <span className="outline-loose muted small">Sin sección</span>
              )}
              <ul>
                {group.blocks.map((block) => (
                  <li key={block.id}>
                    <button type="button" className="outline-block" onClick={() => go(block.id)}>
                      <Icon name={blockMeta[block.kind]?.icon ?? 'text'} size={12} />
                      {block.label}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
