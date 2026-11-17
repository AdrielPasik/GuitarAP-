import { useState, type ReactNode } from 'react';
import type { NotebookBlock } from '@/core/model';
import { Icon } from '@/components/ui/Icon';
import { Segmented } from '@/components/ui/Segmented';

/**
 * "Letra + melodía": the lyrics and the melody they are sung with, side by side. It does not copy anything: both
 * panes are the very same blocks (same editors, same data), so an edit on either side is an edit of the block,
 * and closing the view changes nothing. On narrow screens the two panes alternate instead of squeezing.
 */
export function VocalView({
  lyrics,
  melody,
  readOnly,
  renderBody,
  onClose,
  index,
}: {
  lyrics: NotebookBlock;
  melody: NotebookBlock;
  readOnly: boolean;
  renderBody: (block: NotebookBlock, index: number) => ReactNode;
  onClose: () => void;
  index: number;
}) {
  const [pane, setPane] = useState<'lyrics' | 'melody'>('lyrics');
  const title = ('title' in melody && melody.title?.trim()) || ('title' in lyrics && lyrics.title?.trim()) || '';
  return (
    <section className="vocal-view" aria-label={`Letra + melodía${title ? `: ${title}` : ''}`} data-pane={pane}>
      <header className="vocal-head">
        <span className="block-kind">
          <Icon name="link2" size={15} />
        </span>
        <h3 className="vocal-title">Letra + melodía{title ? <span className="muted"> · {title}</span> : null}</h3>
        <span className="vocal-switch">
          <Segmented<'lyrics' | 'melody'>
            label="Qué mostrar"
            value={pane}
            onChange={setPane}
            options={[
              { value: 'lyrics', label: 'Letra' },
              { value: 'melody', label: 'Melodía' },
            ]}
          />
        </span>
        <span className="spacer" />
        {!readOnly && (
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cerrar esta vista
          </button>
        )}
      </header>
      <div className="vocal-grid">
        <div className="vocal-pane vocal-lyrics" aria-label="Panel de la letra">
          {renderBody(lyrics, index)}
        </div>
        <div className="vocal-pane vocal-melody" aria-label="Panel de la melodía">
          {renderBody(melody, index)}
        </div>
      </div>
    </section>
  );
}
