import type { FretboardContent, FretPosition, NotebookContent, TablatureContent, TextBlockStyle } from '@/core/model';

/** What the person picked: which blocks, and for a map, which of its positions. */
export type ExportSelection = {
  included: string[];
  /** Per map block: 'each' (one figure per position), 'complete' (every note on one neck) or `pos:<id>`. */
  scopes: Record<string, string>;
};

export type ExportItem = {
  key: string;
  blockId: string;
  kind: 'map' | 'tablature' | 'text';
  caption: string;
  map?: { content: FretboardContent; position?: FretPosition; positionIndex: number; complete: boolean };
  tab?: TablatureContent;
  text?: { style: TextBlockStyle; value: string };
};

export type ExportSettings = {
  format: 'png' | 'pdf';
  theme: 'light' | 'dark';
  background: 'paper' | 'white' | 'transparent';
  title: boolean;
  legend: boolean;
  notes: boolean;
  /** Pixel ratio of the image (1 = screen, 2 = sharp, 3 = print). */
  quality: 1 | 2 | 3;
};

export const defaultSettings: ExportSettings = {
  format: 'png',
  theme: 'light',
  background: 'paper',
  title: true,
  legend: true,
  notes: true,
  quality: 2,
};

export function everything(notebook: NotebookContent): ExportSelection {
  return { included: notebook.blocks.map((block) => block.id), scopes: {} };
}

export function onlyBlock(blockId: string): ExportSelection {
  return { included: [blockId], scopes: {} };
}

/** Turns a selection into the ordered figures that will be drawn. Nothing unselected can appear. */
export function planExport(notebook: NotebookContent, selection: ExportSelection): ExportItem[] {
  const items: ExportItem[] = [];
  for (const block of notebook.blocks) {
    if (!selection.included.includes(block.id)) continue;
    if (block.kind === 'tablature') {
      items.push({ key: block.id, blockId: block.id, kind: 'tablature', caption: block.title?.trim() ?? '', tab: block.content });
    } else if (block.kind === 'text') {
      if (block.text.trim()) items.push({ key: block.id, blockId: block.id, kind: 'text', caption: '', text: { style: block.style, value: block.text } });
    } else {
      const scope = selection.scopes[block.id] ?? 'each';
      const prefix = block.title?.trim() ? `${block.title.trim()} · ` : '';
      const positions = block.content.positions;
      if (scope === 'complete') {
        items.push({ key: `${block.id}:all`, blockId: block.id, kind: 'map', caption: `${prefix}Mapa completo`.replace(/ · Mapa completo$/, 'Mapa completo'), map: { content: block.content, positionIndex: 0, complete: true } });
      } else {
        const chosen = scope.startsWith('pos:') ? positions.filter((position) => position.id === scope.slice(4)) : positions;
        for (const position of chosen) {
          items.push({
            key: `${block.id}:${position.id}`,
            blockId: block.id,
            kind: 'map',
            caption: positions.length > 1 ? `${prefix}${position.name}` : (block.title?.trim() ?? ''),
            map: { content: block.content, position, positionIndex: positions.indexOf(position), complete: false },
          });
        }
      }
    }
  }
  return items;
}

export function slug(text: string) {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'guitarap'
  );
}

/** "do-jonico-mapa-posicion-1.png": the document, what was exported, the extension. */
export function exportFileName(title: string, notebook: NotebookContent, selection: ExportSelection, format: 'png' | 'pdf') {
  const included = notebook.blocks.filter((block) => selection.included.includes(block.id));
  const base = slug(title);
  let what = 'seleccion';
  if (included.length === notebook.blocks.length && included.length > 1) what = 'cuaderno';
  else if (included.length === 1) {
    const [block] = included;
    if (block.kind === 'tablature') what = 'tablatura';
    else if (block.kind === 'text') what = 'nota';
    else {
      const scope = selection.scopes[block.id] ?? 'each';
      if (scope === 'complete') what = 'escala-completa';
      else if (scope.startsWith('pos:')) {
        const position = block.content.positions.find((item) => item.id === scope.slice(4));
        what = `mapa-${slug(position?.name ?? 'posicion')}`;
      } else what = block.content.positions.length > 1 ? 'mapa-posiciones' : 'mapa';
    }
  }
  return `${base}-${what}.${format}`;
}
