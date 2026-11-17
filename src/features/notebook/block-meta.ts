import type { NotebookBlock } from '@/core/model';
import { newBlock } from '@/core/notebook';
import type { IconName } from '@/components/ui/Icon';

export const blockMeta: Record<NotebookBlock['kind'], { label: string; icon: IconName }> = {
  tablature: { label: 'Tablatura', icon: 'tab' },
  map: { label: 'Mapa del mástil', icon: 'map' },
  melody: { label: 'Melodía', icon: 'melody' },
  lyrics: { label: 'Letra', icon: 'lyrics' },
  chords: { label: 'Acordes', icon: 'chords' },
  section: { label: 'Sección', icon: 'text' },
  text: { label: 'Texto', icon: 'text' },
};


export type NewBlockKind = 'tablature' | 'map' | 'melody' | 'lyrics' | 'chords' | 'section' | 'heading' | 'note';

export function blockFor(kind: NewBlockKind) {
  return kind === 'heading' ? newBlock('text', 'heading') : kind === 'note' ? newBlock('text', 'note') : newBlock(kind);
}
