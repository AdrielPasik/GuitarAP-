import { useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { formatNote, isBlackKey, octaveOf, type NameStyle } from '@/core/theory/pitch';

/**
 * The note keyboard of the melody editor: the main way to write a melody. Every press reports the MIDI number at once
 * (the editor plays it and writes it), so the person hears the phrase while building it.
 *
 * Input is pointer-based (one path for mouse, touch and pen, so a touch never fires twice); a keyboard activation of a
 * focused key arrives as a click with `detail === 0`. The computer keyboard plays the keys while this group has focus
 * (never anywhere else, so typing a lyric or a title is untouched): home row = white keys, row above = black keys,
 * Z / X = octave down / up.
 */
const KEY_MAP: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ñ: 16,
};
const SPAN = 25; // two octaves and the closing C
const FLASH_MS = 140;

export function PianoKeyboard({
  onPress,
  style,
  selected,
  playing,
  focusMidi,
}: {
  onPress: (midi: number) => void;
  style: NameStyle;
  /** The pitch of the selected note (outlined). */
  selected?: number;
  /** The pitch that is sounding right now while the melody plays (lit). */
  playing?: number;
  /** Where the view should be when it opens or when the selection leaves it. */
  focusMidi?: number;
}) {
  const [octave, setOctave] = useState(() => Math.max(1, Math.min(6, octaveOf(focusMidi ?? 60))));
  const [pressed, setPressed] = useState<ReadonlySet<number>>(new Set());
  const down = useRef(new Set<string>());
  const root = useRef<HTMLDivElement>(null);
  const base = (octave + 1) * 12;
  const keys = Array.from({ length: SPAN }, (_, index) => base + index);
  const whites = keys.filter((midi) => !isBlackKey(midi));
  const whiteWidth = 100 / whites.length;

  // A selected note outside the visible range brings the view to it (without moving it when it is already visible).
  const [seen, setSeen] = useState(selected);
  if (selected !== seen) {
    setSeen(selected);
    if (selected !== undefined && !(selected >= base && selected < base + SPAN)) setOctave(Math.max(1, Math.min(6, octaveOf(selected))));
  }

  function flash(midi: number, held: boolean) {
    setPressed((current) => new Set(current).add(midi));
    if (!held) window.setTimeout(() => release(midi), FLASH_MS);
  }
  function release(midi: number) {
    setPressed((current) => {
      if (!current.has(midi)) return current;
      const next = new Set(current);
      next.delete(midi);
      return next;
    });
  }
  function press(midi: number, held: boolean) {
    flash(midi, held);
    onPress(midi);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'z' || key === 'x') {
      if (!event.repeat) setOctave((value) => Math.max(1, Math.min(6, value + (key === 'x' ? 1 : -1))));
      event.preventDefault();
      return;
    }
    const offset = KEY_MAP[key];
    if (offset === undefined) return;
    event.preventDefault();
    if (event.repeat || down.current.has(key)) return; // holding a key plays one note, not a machine gun
    down.current.add(key);
    press(base + offset, true);
  }
  function onKeyUp(event: React.KeyboardEvent) {
    const key = event.key.toLowerCase();
    if (!down.current.delete(key)) return;
    const offset = KEY_MAP[key];
    if (offset !== undefined) window.setTimeout(() => release(base + offset), FLASH_MS);
  }

  const keyProps = (midi: number) => ({
    'data-midi': midi,
    'aria-label': formatNote(midi, style, 'sharp'),
    'aria-pressed': pressed.has(midi),
    onPointerDown: (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      root.current?.focus({ preventScroll: true });
      press(midi, false);
    },
    // A real click from a pointer was already handled on pointerdown; only a keyboard activation has detail 0.
    onClick: (event: React.MouseEvent) => {
      if (event.detail === 0) press(midi, false);
    },
    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
  });
  const state = (midi: number) => `${pressed.has(midi) ? ' down' : ''}${selected === midi ? ' on' : ''}${playing === midi ? ' lit' : ''}`;

  return (
    <div
      ref={root}
      className="piano-keyboard"
      role="group"
      aria-label="Teclado musical"
      aria-keyshortcuts="A S D F G H J K"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={() => down.current.clear()}
    >
      <div className="piano-octaves">
        <button type="button" className="icon-btn" aria-label="Octava más grave" disabled={octave <= 1} onClick={() => setOctave(octave - 1)}>
          <Icon name="chevron-left" size={14} />
        </button>
        <span className="piano-range" aria-live="polite">Octavas {octave} a {octave + 2}</span>
        <button type="button" className="icon-btn" aria-label="Octava más aguda" disabled={octave >= 6} onClick={() => setOctave(octave + 1)}>
          <Icon name="chevron-right" size={14} />
        </button>
        <span className="muted small piano-hint">Con el teclado de la computadora: A S D F G H J K · negras W E T Y U · Z / X cambian de octava</span>
      </div>
      <div className="piano-scroll">
        <div className="piano-keys">
          {whites.map((midi, index) => (
            <button
              key={midi}
              type="button"
              tabIndex={-1}
              className={`pkey white${midi % 12 === 0 ? ' c' : ''}${state(midi)}`}
              style={{ left: `${index * whiteWidth}%`, width: `${whiteWidth}%` }}
              {...keyProps(midi)}
            >
              <span aria-hidden="true">{formatNote(midi, style)}</span>
            </button>
          ))}
          {keys.filter(isBlackKey).map((midi) => {
            const left = whites.findIndex((white) => white === midi - 1);
            return (
              <button
                key={midi}
                type="button"
                tabIndex={-1}
                className={`pkey black${state(midi)}`}
                style={{ left: `${(left + 1) * whiteWidth - whiteWidth * 0.3}%`, width: `${whiteWidth * 0.6}%` }}
                {...keyProps(midi)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
