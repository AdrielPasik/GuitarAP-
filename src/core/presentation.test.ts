import { describe, expect, it } from 'vitest';
import {
  applyToDescendants, DEFAULT_PRESENTATION, moveModule, normalizePresentation, presetPresentation, resolvePresentation, ROOT_KEY,
  toggleModule, type PresentationMap,
} from '@/core/presentation';

const tree: Record<string, string | null> = { canciones: null, rock: 'canciones', nacional: 'rock', escalas: null };
const parentOf = (id: string) => tree[id];
const childrenOf = (id: string) => Object.keys(tree).filter((key) => tree[key] === id);

describe('folder presentation inheritance', () => {
  it('folders without settings use the default', () => {
    expect(resolvePresentation({}, 'escalas', parentOf)).toEqual({ presentation: DEFAULT_PRESENTATION, source: 'default', fromId: null });
  });
  it('a subfolder inherits from its parent, and follows its changes', () => {
    const map: PresentationMap = { canciones: { mode: 'own', presentation: presetPresentation('collection') } };
    const resolved = resolvePresentation(map, 'nacional', parentOf);
    expect(resolved.source).toBe('inherited');
    expect(resolved.fromId).toBe('canciones');
    expect(resolved.presentation.modules).toContain('covers');
    map.canciones = { mode: 'own', presentation: presetPresentation('compact') };
    expect(resolvePresentation(map, 'nacional', parentOf).presentation.modules).toEqual(['list']);
  });
  it('a customised subfolder is independent of its parent', () => {
    const map: PresentationMap = {
      canciones: { mode: 'own', presentation: presetPresentation('collection') },
      rock: { mode: 'own', presentation: presetPresentation('notebook') },
    };
    expect(resolvePresentation(map, 'rock', parentOf).source).toBe('own');
    map.canciones = { mode: 'own', presentation: presetPresentation('compact') };
    expect(resolvePresentation(map, 'rock', parentOf).presentation.preset).toBe('notebook');
    expect(resolvePresentation(map, 'nacional', parentOf).presentation.preset).toBe('notebook');
  });
  it("'default' stops inheritance", () => {
    const map: PresentationMap = { canciones: { mode: 'own', presentation: presetPresentation('collection') }, rock: { mode: 'default' } };
    expect(resolvePresentation(map, 'nacional', parentOf).source).toBe('default');
  });
  it('survives a corrupt cycle', () => {
    const cyclic: Record<string, string> = { a: 'b', b: 'a' };
    expect(resolvePresentation({}, 'a', (id) => cyclic[id]).source).toBe('default');
  });
  it('the library root has its own entry', () => {
    const map: PresentationMap = { [ROOT_KEY]: { mode: 'own', presentation: presetPresentation('combined') } };
    expect(resolvePresentation(map, null, parentOf).presentation.preset).toBe('combined');
    // top-level folders do not inherit from the library home
    expect(resolvePresentation(map, 'escalas', parentOf).source).toBe('default');
  });
  it('apply to subfolders is explicit and resets descendants to inherit', () => {
    const map: PresentationMap = { rock: { mode: 'own', presentation: presetPresentation('notebook') } };
    const next = applyToDescendants(map, 'canciones', childrenOf);
    expect(next.rock).toEqual({ mode: 'inherit' });
    expect(next.nacional).toEqual({ mode: 'inherit' });
    expect(map.rock.mode).toBe('own'); // original untouched
  });
});

describe('presentation values', () => {
  it('repairs broken stored data without throwing', () => {
    const repaired = normalizePresentation({ modules: ['covers', 'nope', 'covers'], fields: { artist: true, bogus: 1 }, density: 'huge' });
    expect(repaired.modules).toEqual(['covers']);
    expect(repaired.fields.artist).toBe(true);
    expect(repaired.density).toBe('balanced');
    expect(normalizePresentation(null)).toEqual({ ...DEFAULT_PRESENTATION, description: undefined, featured: undefined });
  });
  it('modules combine and reorder', () => {
    let modules = toggleModule(['covers'], 'list', true);
    expect(modules).toEqual(['covers', 'list']);
    modules = moveModule(modules, 'list', -1);
    expect(modules).toEqual(['list', 'covers']);
    expect(moveModule(modules, 'list', -1)).toEqual(['list', 'covers']);
    expect(toggleModule(modules, 'covers', false)).toEqual(['list']);
  });
  it('presets are copies: editing one never edits the preset', () => {
    const one = presetPresentation('collection');
    one.fields.bpm = true;
    one.modules.push('list');
    expect(presetPresentation('collection').fields.bpm).toBe(false);
    expect(presetPresentation('collection').modules).not.toContain('list');
  });
});
