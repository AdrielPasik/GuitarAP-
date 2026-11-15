import { useEffect, useState } from 'react';
import { useLibrary } from '@/data/use-library';
import { TablatureEditor } from '@/features/tablature/TablatureEditor';
import { FretboardEditor } from '@/features/fretboard/FretboardEditor';

export function PracticeScreen() {
  const { documents } = useLibrary();
  const [selectedId, setSelectedId] = useState<string>('');
  const [zoom, setZoom] = useState(1);
  const [focus, setFocus] = useState(false);
  const selectedIndex = documents.findIndex((document) => document.id === selectedId);
  const selected = documents[selectedIndex] ?? documents[0];

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFocus(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);
  function navigate(offset: number) {
    if (!documents.length) return;
    const next = (Math.max(0, selectedIndex) + offset + documents.length) % documents.length;
    setSelectedId(documents[next].id);
  }

  const player = selected ? (
    <div style={{ zoom }} className="practice-player origin-top">
      <div>
        {selected.type === 'tablature' ? (
          <TablatureEditor document={selected} readOnly />
        ) : (
          <FretboardEditor document={selected} readOnly />
        )}
      </div>
    </div>
  ) : (
    <p className="rounded-xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">
      Creá una tablatura o un diapasón desde Biblioteca para practicarlo aquí.
    </p>
  );
  return (
    <section
      className={`${focus ? 'fixed inset-0 z-50 overflow-auto bg-[#f7faf9] p-5 dark:bg-[#101816]' : 'mx-auto max-w-6xl'} practice-shell`}
    >
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-5 dark:border-white/10">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-amber-700 dark:text-amber-300">
            Reproducción local
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Modo Práctica</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="control" onClick={() => navigate(-1)} disabled={!selected}>
            ← Anterior
          </button>
          <button className="control" onClick={() => navigate(1)} disabled={!selected}>
            Siguiente →
          </button>
          <button
            className="control"
            onClick={() => setZoom((value) => Math.max(0.7, Number((value - 0.1).toFixed(1))))}
          >
            A−
          </button>
          <button
            className="control"
            onClick={() => setZoom((value) => Math.min(1.6, Number((value + 0.1).toFixed(1))))}
          >
            A+
          </button>
          <button className="control-primary" onClick={() => setFocus((value) => !value)}>
            {focus ? 'Salir foco' : 'Modo foco'}
          </button>
        </div>
      </div>
      <div className="mt-5 grid gap-5 md:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="practice-sidebar">
          <label
            className="px-2 text-xs font-semibold uppercase tracking-wider text-stone-500"
            htmlFor="practice-document"
          >
            Material
          </label>
          <select
            id="practice-document"
            className="mt-2 w-full rounded border border-stone-300 bg-transparent p-2 text-sm"
            value={selected?.id ?? ''}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {documents.map((document) => (
              <option key={document.id} value={document.id}>
                {document.type === 'tablature' ? 'Tab' : 'Dia'} · {document.title}
              </option>
            ))}
          </select>
          <p className="mt-4 px-2 text-xs leading-5 text-stone-500">
            El metrónomo global permanece disponible en la barra superior. Esc cierra el modo foco.
          </p>
        </aside>
        <div className="min-w-0">{player}</div>
      </div>
    </section>
  );
}
