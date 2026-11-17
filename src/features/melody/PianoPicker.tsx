import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { formatNote, isBlackKey, type NameStyle } from '@/core/theory/pitch';

/**
 * A small visual keyboard to choose a pitch. It is a picker (like a dropdown), not a piano editor:
 * it only reports the MIDI number that was pressed.
 */
export function PianoPicker({ onPick, style, selected }: { onPick: (midi: number) => void; style: NameStyle; selected?: number }) {
  const [octave, setOctave] = useState(4);
  const base = (octave + 1) * 12;
  const keys = Array.from({ length: 25 }, (_, index) => base + index);
  const whites = keys.filter((midi) => !isBlackKey(midi));
  const whiteWidth = 100 / whites.length;
  return (
    <div className="piano-picker" role="group" aria-label="Teclado para elegir la altura">
      <div className="piano-octaves">
        <button type="button" className="icon-btn" aria-label="Octava más grave" disabled={octave <= 1} onClick={() => setOctave(octave - 1)}>
          <Icon name="chevron-left" size={14} />
        </button>
        <span className="muted small">Octavas {octave}–{octave + 2}</span>
        <button type="button" className="icon-btn" aria-label="Octava más aguda" disabled={octave >= 6} onClick={() => setOctave(octave + 1)}>
          <Icon name="chevron-right" size={14} />
        </button>
      </div>
      <div className="piano-keys">
        {whites.map((midi, index) => (
          <button
            key={midi}
            type="button"
            className={`pkey white${selected === midi ? ' on' : ''}${midi % 12 === 0 ? ' c' : ''}`}
            style={{ left: `${index * whiteWidth}%`, width: `${whiteWidth}%` }}
            aria-label={formatNote(midi, style)}
            onClick={() => onPick(midi)}
          >
            {midi % 12 === 0 && <span aria-hidden="true">{formatNote(midi, style)}</span>}
          </button>
        ))}
        {keys.filter(isBlackKey).map((midi) => {
          const left = whites.findIndex((white) => white === midi - 1);
          return (
            <button
              key={midi}
              type="button"
              className={`pkey black${selected === midi ? ' on' : ''}`}
              style={{ left: `${(left + 1) * whiteWidth - whiteWidth * 0.3}%`, width: `${whiteWidth * 0.6}%` }}
              aria-label={formatNote(midi, style, 'sharp')}
              onClick={() => onPick(midi)}
            />
          );
        })}
      </div>
    </div>
  );
}
