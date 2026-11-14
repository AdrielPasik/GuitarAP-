import type { LinkedTechnique, TabColumn, TabTechniqueLink, TablatureContent, Technique } from '@/core/model';
import { tuningPitch } from '@/core/music';

export type TabClipboard = { columns: TabColumn[]; links: TabTechniqueLink[] };

function absolutePitch(tuning: string, fret: number) {
  const octave = Number(tuning.match(/(-?\d+)$/)?.[1] ?? 0);
  return octave * 12 + tuningPitch(tuning) + fret;
}

export function blankColumn(): TabColumn { return { id: crypto.randomUUID(), cells: Array.from({ length: 6 }, () => ({})) }; }
export function insertColumn(tab: TablatureContent, index: number) { return { ...tab, columns: [...tab.columns.slice(0, index + 1), blankColumn(), ...tab.columns.slice(index + 1)] }; }
export function removeColumn(tab: TablatureContent, index: number) {
  if (tab.columns.length <= 1) return tab;
  const removedId = tab.columns[index]?.id;
  return { ...tab, columns: tab.columns.filter((_, item) => item !== index), techniqueLinks: (tab.techniqueLinks ?? []).filter((link) => link.from.columnId !== removedId && link.to.columnId !== removedId) };
}
export function setFret(tab: TablatureContent, column: number, string: number, fret: number | undefined) {
  if (fret !== undefined && (!Number.isInteger(fret) || fret < 0 || fret > 24)) return tab;
  const columnId = tab.columns[column]?.id;
  return { ...tab, columns: tab.columns.map((item, index) => index !== column ? item : { ...item, cells: item.cells.map((cell, row) => row !== string ? cell : { ...cell, fret }) }), techniqueLinks: fret === undefined ? (tab.techniqueLinks ?? []).filter((link) => !(link.from.columnId === columnId && link.from.string === string) && !(link.to.columnId === columnId && link.to.string === string)) : tab.techniqueLinks };
}
export function toggleTechnique(tab: TablatureContent, column: number, string: number, technique: Technique) { return { ...tab, columns: tab.columns.map((item, index) => index !== column ? item : { ...item, cells: item.cells.map((cell, row) => { if (row !== string) return cell; const techniques = new Set(cell.techniques ?? []); if (techniques.has(technique)) techniques.delete(technique); else techniques.add(technique); return { ...cell, techniques: [...techniques] }; }) }) }; }
export function copyColumns(tab: TablatureContent, start: number, end: number) { return structuredClone(tab.columns.slice(Math.max(0, start), Math.min(tab.columns.length, end + 1))); }
export function pasteColumns(tab: TablatureContent, at: number, columns: TabColumn[]) { return { ...tab, columns: [...tab.columns.slice(0, at), ...structuredClone(columns).map((column) => ({ ...column, id: crypto.randomUUID() })), ...tab.columns.slice(at)] }; }
export function copyTabFragment(tab: TablatureContent, start: number, end: number): TabClipboard {
  const columns = copyColumns(tab, start, end);
  const ids = new Set(columns.map((column) => column.id));
  return { columns, links: structuredClone((tab.techniqueLinks ?? []).filter((link) => ids.has(link.from.columnId) && ids.has(link.to.columnId))) };
}
export function pasteTabFragment(tab: TablatureContent, at: number, fragment: TabClipboard) {
  const columnIds = new Map(fragment.columns.map((column) => [column.id, crypto.randomUUID()]));
  const columns = structuredClone(fragment.columns).map((column) => ({ ...column, id: columnIds.get(column.id)! }));
  const links = fragment.links.map((link) => ({ ...link, id: crypto.randomUUID(), from: { ...link.from, columnId: columnIds.get(link.from.columnId)! }, to: { ...link.to, columnId: columnIds.get(link.to.columnId)! } }));
  return { ...tab, columns: [...tab.columns.slice(0, at), ...columns, ...tab.columns.slice(at)], techniqueLinks: [...(tab.techniqueLinks ?? []), ...links] };
}
export function linkTechnique(tab: TablatureContent, from: { column: number; string: number }, to: { column: number; string: number }, technique: LinkedTechnique) {
  const source = tab.columns[from.column]; const destination = tab.columns[to.column];
  if (!source || !destination || source.cells[from.string]?.fret === undefined || destination.cells[to.string]?.fret === undefined || (source.id === destination.id && from.string === to.string)) return tab;
  const sourcePitch = absolutePitch(tab.tuning[from.string], source.cells[from.string].fret!); const destinationPitch = absolutePitch(tab.tuning[to.string], destination.cells[to.string].fret!);
  if ((technique === 'hammer-on' || technique === 'slide-up') && destinationPitch <= sourcePitch) return tab;
  if ((technique === 'pull-off' || technique === 'slide-down') && destinationPitch >= sourcePitch) return tab;
  const same = (tab.techniqueLinks ?? []).find((link) => link.from.columnId === source.id && link.from.string === from.string && link.to.columnId === destination.id && link.to.string === to.string && link.technique === technique);
  if (same) return { ...tab, techniqueLinks: (tab.techniqueLinks ?? []).filter((link) => link.id !== same.id) };
  return { ...tab, techniqueLinks: [...(tab.techniqueLinks ?? []), { id: crypto.randomUUID(), technique, from: { columnId: source.id, string: from.string }, to: { columnId: destination.id, string: to.string } }] };
}
export function annotateColumn(tab: TablatureContent, columnIndex: number, text: string) {
  if (!text.trim() || !tab.columns[columnIndex]) return tab;
  return { ...tab, annotations: [...tab.annotations, text.trim()], columns: tab.columns.map((column, index) => index === columnIndex ? { ...column, section: text.trim() } : column) };
}
