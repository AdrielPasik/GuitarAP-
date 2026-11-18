import { useEffect, useRef, useState } from 'react';
import {
  clonePresentation, DENSITY_NAMES, FIELD_KEYS, FIELD_NAMES, GROUP_NAMES, MODULE_KEYS, MODULE_NAMES, moveModule, PRESETS, presetPresentation,
  SORT_NAMES, toggleModule, type Density, type GroupKey, type Presentation, type PresetId, type SortKey,
} from '@/core/presentation';
import { Icon } from '@/components/ui/Icon';
import { Segmented } from '@/components/ui/Segmented';

export type DraftMode = 'inherit' | 'default' | 'own';

/**
 * «Personalizar carpeta»: a side panel, not a modal, so the folder itself is the live preview behind it.
 * Nothing is stored until «Guardar»; «Cancelar» (or Escape) leaves everything as it was.
 */
export function CustomizePanel({
  folderName, parentName, isRoot, mode, setMode, draft, setDraft, available, folders, hasChildren, onSave, onCancel, onCopyTo, onApplyToChildren,
}: {
  folderName: string;
  /** Name of the folder an inheriting folder takes its look from, if any. */
  parentName: string | null;
  isRoot: boolean;
  mode: DraftMode;
  setMode: (mode: DraftMode) => void;
  draft: Presentation;
  setDraft: (presentation: Presentation) => void;
  available: { artist: boolean; key: boolean; tags: boolean; kinds: boolean };
  folders: Array<{ id: string; path: string }>;
  hasChildren: boolean;
  onSave: () => void;
  onCancel: () => void;
  onCopyTo: (id: string) => void;
  onApplyToChildren: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [copyTarget, setCopyTarget] = useState('');
  const [confirmChildren, setConfirmChildren] = useState(false);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('h2')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  /** Any edit makes the folder's look its own (an inheriting folder becomes independent, as the toggle says). */
  const edit = (change: (current: Presentation) => Presentation) => {
    const next = change(clonePresentation(draft));
    setDraft({ ...next, preset: 'custom' });
    if (mode !== 'own') setMode('own');
  };
  const editKeepPreset = (next: Presentation) => {
    setDraft(next);
    if (mode !== 'own') setMode('own');
  };
  const sortDisabled: Partial<Record<SortKey, boolean>> = { artist: !available.artist, key: !available.key, kind: !available.kinds };
  const groupDisabled: Partial<Record<GroupKey, boolean>> = { artist: !available.artist, tags: !available.tags, kind: !available.kinds };

  return (
    <aside ref={ref} className="customize-panel" role="dialog" aria-modal="false" aria-labelledby="customize-title">
      <header className="customize-head">
        <h2 id="customize-title" tabIndex={-1}><Icon name="palette" size={16} /> Personalizar «{folderName}»</h2>
        <button type="button" className="icon-btn" aria-label="Cancelar y cerrar" onClick={onCancel}><Icon name="close" size={16} /></button>
      </header>
      <p className="muted small">Lo que ves detrás es la vista previa. Solo cambia cómo se muestra esta carpeta: ningún material se modifica.</p>

      <div className="customize-body">
        {!isRoot && (
          <section className="cz-section" aria-label="Origen de la presentación">
            <h3>Origen</h3>
            <div className="cz-radio" role="radiogroup" aria-label="Origen de la presentación">
              {parentName && (
                <label><input type="radio" name="cz-mode" checked={mode === 'inherit'} onChange={() => setMode('inherit')} /> Heredar de «{parentName}»</label>
              )}
              <label><input type="radio" name="cz-mode" checked={mode === 'default'} onChange={() => setMode('default')} /> Predeterminada de GuitarAP</label>
              <label><input type="radio" name="cz-mode" checked={mode === 'own'} onChange={() => setMode('own')} /> Propia de esta carpeta</label>
            </div>
            {mode !== 'own' && <p className="muted small">Cualquier cambio de abajo la convierte en propia.</p>}
          </section>
        )}

        <section className="cz-section" aria-label="Presentación">
          <h3>A · Punto de partida</h3>
          <div className="cz-presets">
            {(Object.keys(PRESETS) as Array<Exclude<PresetId, 'custom'>>).map((id) => (
              <button key={id} type="button" className={`cz-preset${draft.preset === id ? ' on' : ''}`} aria-pressed={draft.preset === id} onClick={() => editKeepPreset(presetPresentation(id, { description: draft.description }))}>
                <span className={`cz-preset-art art-${id}`} aria-hidden="true"><i /><i /><i /><i /></span>
                <b>{PRESETS[id].name}</b>
                <small>{PRESETS[id].blurb}</small>
              </button>
            ))}
          </div>
          <p className="muted small">Son puntos de partida: después podés cambiar cualquier cosa.</p>
        </section>

        <section className="cz-section" aria-label="Módulos">
          <h3>B · Módulos de la carpeta</h3>
          <ol className="cz-modules">
            {[...draft.modules, ...MODULE_KEYS.filter((key) => !draft.modules.includes(key))].map((key) => {
              const on = draft.modules.includes(key);
              const index = draft.modules.indexOf(key);
              return (
                <li key={key} className={on ? 'on' : ''}>
                  <label className="check">
                    <input type="checkbox" checked={on} onChange={(event) => edit((current) => ({ ...current, modules: toggleModule(current.modules, key, event.target.checked) }))} />
                    <span><b>{MODULE_NAMES[key].name}</b><small>{MODULE_NAMES[key].blurb}</small></span>
                  </label>
                  {on && (
                    <span className="cz-order">
                      <button type="button" className="icon-btn" aria-label={`Subir ${MODULE_NAMES[key].name}`} disabled={index === 0} onClick={() => edit((current) => ({ ...current, modules: moveModule(current.modules, key, -1) }))}><Icon name="arrow-up" size={13} /></button>
                      <button type="button" className="icon-btn" aria-label={`Bajar ${MODULE_NAMES[key].name}`} disabled={index === draft.modules.length - 1} onClick={() => edit((current) => ({ ...current, modules: moveModule(current.modules, key, 1) }))}><Icon name="arrow-down" size={13} /></button>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          {draft.modules.includes('description') && (
            <label className="field">
              <span>Descripción de la carpeta</span>
              <textarea rows={3} maxLength={600} value={draft.description ?? ''} placeholder="Ej. Canciones para el ensayo del sábado" onChange={(event) => edit((current) => ({ ...current, description: event.target.value || undefined }))} />
            </label>
          )}
        </section>

        <section className="cz-section" aria-label="Información visible">
          <h3>C · Información visible</h3>
          <div className="cz-fields">
            {FIELD_KEYS.map((key) => (
              <label key={key} className="switch">
                <input type="checkbox" role="switch" checked={draft.fields[key]} onChange={(event) => edit((current) => ({ ...current, fields: { ...current.fields, [key]: event.target.checked } }))} />
                <span>{FIELD_NAMES[key]}</span>
              </label>
            ))}
          </div>
          <p className="muted small">Un dato que el material no tiene no se muestra ni se inventa.</p>
        </section>

        <section className="cz-section" aria-label="Densidad">
          <h3>D · Densidad</h3>
          <Segmented<Density> label="Densidad" value={draft.density} onChange={(density) => edit((current) => ({ ...current, density }))} options={(Object.keys(DENSITY_NAMES) as Density[]).map((value) => ({ value, label: DENSITY_NAMES[value] }))} />
        </section>

        <section className="cz-section" aria-label="Organización">
          <h3>E · Organización</h3>
          <div className="cz-row">
            <label className="field"><span>Orden</span>
              <select aria-label="Orden" value={draft.sort} onChange={(event) => edit((current) => ({ ...current, sort: event.target.value as SortKey }))}>
                {(Object.keys(SORT_NAMES) as SortKey[]).map((key) => (<option key={key} value={key} disabled={sortDisabled[key]}>{SORT_NAMES[key]}{sortDisabled[key] ? ' (sin datos)' : ''}</option>))}
              </select>
            </label>
            <label className="field"><span>Agrupar</span>
              <select aria-label="Agrupar" value={draft.group} onChange={(event) => edit((current) => ({ ...current, group: event.target.value as GroupKey }))}>
                {(Object.keys(GROUP_NAMES) as GroupKey[]).map((key) => (<option key={key} value={key} disabled={groupDisabled[key]}>{GROUP_NAMES[key]}{groupDisabled[key] ? ' (sin datos)' : ''}</option>))}
              </select>
            </label>
          </div>
        </section>

        <section className="cz-section" aria-label="Más acciones">
          <h3>F · Llevar esta configuración a otro lado</h3>
          <div className="cz-row">
            <label className="field"><span>Copiar a la carpeta</span>
              <select aria-label="Carpeta de destino de la copia" value={copyTarget} onChange={(event) => setCopyTarget(event.target.value)}>
                <option value="">Elegí una carpeta…</option>
                {folders.map((folder) => (<option key={folder.id} value={folder.id}>{folder.path}</option>))}
              </select>
            </label>
            <button type="button" className="btn" disabled={!copyTarget} onClick={() => { onCopyTo(copyTarget); setCopyTarget(''); }}>Copiar</button>
          </div>
          {hasChildren && (
            confirmChildren ? (
              <p className="cz-confirm" role="alert">
                Las subcarpetas van a heredar esta presentación y perder la suya propia.{' '}
                <button type="button" className="btn btn-danger" onClick={() => { onApplyToChildren(); setConfirmChildren(false); }}>Sí, aplicar</button>{' '}
                <button type="button" className="btn" onClick={() => setConfirmChildren(false)}>No</button>
              </p>
            ) : (
              <button type="button" className="btn btn-link" onClick={() => setConfirmChildren(true)}>Aplicar a las subcarpetas…</button>
            )
          )}
        </section>
      </div>

      <footer className="customize-foot">
        <button type="button" className="btn btn-link" onClick={() => setMode(isRoot || !parentName ? 'default' : 'inherit')}>Restaurar predeterminado</button>
        <span className="spacer" />
        <button type="button" className="btn" onClick={onCancel}>Cancelar</button>
        <button type="button" className="btn btn-primary" onClick={onSave}>Guardar</button>
      </footer>
    </aside>
  );
}
