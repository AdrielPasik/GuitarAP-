import { useRef } from 'react';
import type { LyricsContent } from '@/core/model';
import { Icon } from '@/components/ui/Icon';
import { parseLyrics } from '@/features/lyrics/parse';

/** Reading view: section titles, and chords sitting above the word they belong to. */
export function LyricsReading({ content }: { content: LyricsContent }) {
  const lines = parseLyrics(content.text);
  const showChords = content.showChords !== false;
  if (!content.text.trim()) return <p className="muted lyrics-empty">Sin letra todavía.</p>;
  return (
    <div className="lyrics-read">
      {lines.map((line, index) => {
        if (line.kind === 'section') return <h4 key={index} className="lyric-section">{line.title}</h4>;
        if (line.kind === 'blank') return <div key={index} className="lyric-gap" aria-hidden="true" />;
        return (
          <p key={index} className={`lyric-line${line.hasChords && showChords ? ' with-chords' : ''}`}>
            {line.segments.map((segment, at) => (
              <span key={at} className="lyric-seg">
                {showChords && line.hasChords && <span className="lyric-chord" aria-label={segment.chord ? `acorde ${segment.chord}` : undefined}>{segment.chord ?? ' '}</span>}
                <span className="lyric-text">{segment.text || (segment.chord ? ' ' : '')}</span>
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

const STRUCTURE = ['Verso', 'Preestribillo', 'Estribillo', 'Puente', 'Outro'] as const;
/** «Verso» becomes «Verso 2» when the song already has a «Verso 1»: the structure numbers itself. */
function nextTitle(text: string, title: string) {
  if (title !== 'Verso') return title;
  const count = text.split('\n').filter((line) => /^#\s*Verso\b/i.test(line.trim())).length;
  return `Verso ${count + 1}`;
}

/**
 * A page of a songbook: serif type, comfortable measure, plain text underneath. Sections and chords are
 * just text conventions, so copy/paste, undo and autosave behave exactly like any text field.
 */
export function LyricsBlock({
  blockId,
  content,
  onChange,
  readOnly = false,
}: {
  blockId: string;
  content: LyricsContent;
  onChange: (update: (content: LyricsContent) => LyricsContent) => void;
  readOnly?: boolean;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  if (readOnly) return <LyricsReading content={content} />;

  function insert(text: string) {
    const element = area.current;
    const at = element?.selectionStart ?? content.text.length;
    const before = content.text.slice(0, at);
    const prefix = before && !before.endsWith('\n') ? '\n' : '';
    const next = `${before}${prefix}${text}${content.text.slice(at)}`;
    onChange((current) => ({ ...current, text: next }));
    requestAnimationFrame(() => {
      element?.focus();
      const position = before.length + prefix.length + text.length;
      element?.setSelectionRange(position, position);
    });
  }

  const chordCount = parseLyrics(content.text).filter((line) => line.kind === 'line' && line.hasChords).length;
  return (
    <div className="lyrics-block">
      <div className="lyrics-tools nb-chrome">
        <div className="structure-chips" role="group" aria-label="Estructura de la letra">
          {STRUCTURE.map((title) => (
            <button
              key={title}
              type="button"
              className="chip-btn"
              title={`Agregar «${title}» en el cursor`}
              onClick={() => insert(`# ${nextTitle(content.text, title)}\n`)}
            >
              <Icon name="plus" size={12} /> {title}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => insert('[]')} title="Escribí el acorde entre corchetes antes de la palabra: [Am]">
          Acorde […]
        </button>
        <label className="check">
          <input
            type="checkbox"
            checked={content.showChords !== false}
            onChange={(event) => onChange((current) => ({ ...current, showChords: event.target.checked }))}
          />
          Mostrar acordes sobre la letra
        </label>
      </div>
      <textarea
        ref={area}
        id={`lyrics-${blockId}`}
        className="lyrics-text"
        aria-label="Letra"
        placeholder={'# Verso 1\nEscribí tu letra acá…\n\n# Estribillo\nPodés poner acordes así: [C]Hoy [G]vuelvo'}
        spellCheck
        lang="es"
        rows={Math.max(6, content.text.split('\n').length + 1)}
        value={content.text}
        onChange={(event) => onChange((current) => ({ ...current, text: event.target.value }))}
      />
      {chordCount > 0 && content.showChords !== false && (
        <details className="lyrics-preview">
          <summary>Vista con acordes</summary>
          <LyricsReading content={content} />
        </details>
      )}
    </div>
  );
}
