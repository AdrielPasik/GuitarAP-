import { describe, expect, it } from 'vitest';
import { createFretboardContent, createTablatureContent, type NotebookContent } from '@/core/model';
import { addPosition } from '@/features/fretboard/operations';
import { everything, exportFileName, onlyBlock, planExport, slug } from '@/features/export/export-plan';

function notebook(): NotebookContent {
  const twoPositions = addPosition(createFretboardContent());
  return {
    kind: 'notebook',
    version: 1,
    blocks: [
      { id: 'map-1', kind: 'map', content: twoPositions },
      { id: 'tab-1', kind: 'tablature', content: createTablatureContent() },
      { id: 'text-1', kind: 'text', style: 'note', text: 'Alternate picking' },
      { id: 'map-2', kind: 'map', title: 'Tríada', content: createFretboardContent() },
    ],
  };
}

describe('export plan', () => {
  it('exports exactly the blocks that were selected, in notebook order', () => {
    const doc = notebook();
    expect(planExport(doc, onlyBlock('tab-1')).map((item) => item.kind)).toEqual(['tablature']);
    expect(planExport(doc, { included: ['map-2', 'map-1'], scopes: {} }).map((item) => item.blockId)).toEqual(['map-1', 'map-1', 'map-2']);
    expect(planExport(doc, everything(doc)).map((item) => item.kind)).toEqual(['map', 'map', 'tablature', 'text', 'map']);
    expect(planExport(doc, { included: [], scopes: {} })).toEqual([]);
  });

  it('lets a map export one position, each position, or the whole neck', () => {
    const doc = notebook();
    const second = (doc.blocks[0] as { content: { positions: Array<{ id: string }> } }).content.positions[1].id;
    expect(planExport(doc, { included: ['map-1'], scopes: { 'map-1': `pos:${second}` } }).map((item) => item.caption)).toEqual(['Posición 2']);
    expect(planExport(doc, { included: ['map-1'], scopes: {} })).toHaveLength(2);
    const complete = planExport(doc, { included: ['map-1'], scopes: { 'map-1': 'complete' } });
    expect(complete).toHaveLength(1);
    expect(complete[0].map?.complete).toBe(true);
  });

  it('skips empty text and carries a block title into the caption', () => {
    const doc = notebook();
    (doc.blocks[2] as { text: string }).text = '   ';
    const items = planExport(doc, everything(doc));
    expect(items.some((item) => item.kind === 'text')).toBe(false);
    expect(items.at(-1)?.caption).toBe('Tríada');
  });

  it('names files after the document and what they contain', () => {
    const doc = notebook();
    const second = (doc.blocks[0] as { content: { positions: Array<{ id: string }> } }).content.positions[1].id;
    expect(exportFileName('Do jónico', doc, { included: ['map-1'], scopes: { 'map-1': `pos:${second}` } }, 'png')).toBe('do-jonico-mapa-posicion-2.png');
    expect(exportFileName('Do jónico', doc, { included: ['map-1'], scopes: { 'map-1': 'complete' } }, 'pdf')).toBe('do-jonico-escala-completa.pdf');
    expect(exportFileName('Do jónico', doc, everything(doc), 'pdf')).toBe('do-jonico-cuaderno.pdf');
    expect(exportFileName('Do jónico', doc, onlyBlock('tab-1'), 'png')).toBe('do-jonico-tablatura.png');
    expect(exportFileName('Do jónico', doc, { included: ['map-1', 'tab-1'], scopes: {} }, 'png')).toBe('do-jonico-seleccion.png');
    expect(exportFileName('Do jónico', doc, onlyBlock('map-2'), 'png')).toBe('do-jonico-mapa.png');
  });

  it('builds safe slugs', () => {
    expect(slug('Pentatónica menor de La')).toBe('pentatonica-menor-de-la');
    expect(slug('  ¿¡?!  ')).toBe('guitarap');
  });
});
