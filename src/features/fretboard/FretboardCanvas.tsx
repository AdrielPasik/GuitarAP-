import { useMemo, useState } from 'react';
import type { Role } from '@/core/harmony';
import { noteName, pitchClassAt, stringName } from '@/core/music';

export type MarkerTone = 'note' | 'root' | 'active' | 'ghost';
export type Marker = {
  string: number;
  fret: number;
  label?: string;
  /** Secondary label (the interval when notes and intervals are shown together). */
  sub?: string;
  tone: MarkerTone;
  /** Harmonic function: decides the color everywhere the same way. */
  role?: Role;
  /** Flat or sharp degree: drawn with a dashed outline besides the ♭/♯ in its label. */
  altered?: boolean;
  /** Outside the highlighted functions: still there, just softer. */
  dim?: boolean;
  /** Position index, used to tell positions apart in the combined view. */
  group?: number;
};

type Props = {
  tuning: string[];
  latin: boolean;
  from: number;
  to: number;
  markers: Marker[];
  /** Makes every cell of the neck a comfortable click and keyboard target. */
  onPick?: (string: number, fret: number) => void;
  label: string;
  testId?: string;
  /** Widest a single fret may grow, in CSS pixels, so a 5-fret neck does not become enormous. */
  maxCell?: number;
  /** Narrowest a fret may shrink before the neck scrolls sideways. */
  minCell?: number;
};

const CELL_W = 64;
const ROW_H = 38;
const NAME_W = 30;
const OPEN_W = 46;
const TOP = 26;
const BOTTOM = 10;
const RIGHT = 14;
const SINGLE_INLAYS = new Set([3, 5, 7, 9, 15, 17, 19, 21]);
const DOUBLE_INLAYS = new Set([12, 24]);

/**
 * The instrument itself. Six strings, nut, numbered frets, inlays, tuning names.
 * It draws what it is told and reports clicks; it knows nothing about tablature or maps.
 */
export function FretboardCanvas({
  tuning,
  latin,
  from,
  to,
  markers,
  onPick,
  label,
  testId,
  maxCell = 86,
  minCell = 46,
}: Props) {
  const [cursor, setCursor] = useState({ string: 0, fret: Math.max(from, 0) });
  const [focused, setFocused] = useState(false);
  const geometry = useMemo(() => {
    const hasOpen = from === 0;
    const startFret = hasOpen ? 1 : from;
    const frets = Array.from(
      { length: Math.max(0, to - startFret + 1) },
      (_, index) => startFret + index,
    );
    const nutX = NAME_W + (hasOpen ? OPEN_W : 8);
    const boardH = ROW_H * tuning.length;
    const width = nutX + frets.length * CELL_W + RIGHT;
    return { hasOpen, startFret, frets, nutX, boardH, width, height: TOP + boardH + BOTTOM };
  }, [from, to, tuning.length]);
  const { hasOpen, startFret, frets, nutX, boardH, width, height } = geometry;
  const fretX = (fret: number) =>
    fret === 0 ? NAME_W + OPEN_W / 2 : nutX + (fret - startFret + 0.5) * CELL_W;
  const stringY = (string: number) => TOP + ROW_H * (string + 0.5);
  const columns = hasOpen ? [0, ...frets] : frets;
  const maxWidth = Math.round(width * (maxCell / CELL_W));
  const minWidth = Math.round(NAME_W + OPEN_W + frets.length * minCell);
  const midY = TOP + boardH / 2;

  function describe(string: number, fret: number) {
    const pitch = pitchClassAt(tuning[string], fret);
    const marked = markers.some(
      (marker) => marker.string === string && marker.fret === fret && marker.tone !== 'ghost',
    );
    return `Cuerda ${string + 1}, ${stringName(tuning[string], latin)}, traste ${fret}: ${noteName(pitch, 0, latin)}${marked ? ', marcada' : ''}`;
  }
  function onKeyDown(event: React.KeyboardEvent) {
    if (!onPick) return;
    const first = hasOpen ? 0 : startFret;
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (moves[event.key]) {
      event.preventDefault();
      const [dString, dFret] = moves[event.key];
      setCursor((current) => ({
        string: Math.max(0, Math.min(tuning.length - 1, current.string + dString)),
        fret: Math.max(first, Math.min(to, current.fret + dFret)),
      }));
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      onPick(cursor.string, cursor.fret);
    }
  }

  return (
    <div className="fb-scroll">
      <div
        className={`fb${onPick ? ' interactive' : ''}`}
        data-testid={testId}
        role={onPick ? 'application' : 'group'}
        aria-roledescription={onPick ? 'mástil interactivo' : undefined}
        aria-label={
          onPick ? `${label}. Flechas para moverte, espacio para marcar o desmarcar.` : label
        }
        tabIndex={onPick ? 0 : undefined}
        onKeyDown={onKeyDown}
        // The cursor ring is for keyboard users: a mouse click should not leave a stray box behind.
        onFocus={(event) => setFocused(event.currentTarget.matches(':focus-visible'))}
        onBlur={() => setFocused(false)}
        style={{ maxWidth, minWidth }}
      >
        <svg viewBox={`0 0 ${width} ${height}`} className="fb-svg" role="presentation">
          <rect
            className="fb-board"
            x={nutX}
            y={TOP}
            width={width - nutX - RIGHT + 4}
            height={boardH}
            rx="3"
          />
          {hasOpen && (
            <rect className="fb-open" x={NAME_W} y={TOP} width={OPEN_W} height={boardH} />
          )}
          {columns.map((fret) => (
            <text key={`n-${fret}`} className="fb-num" x={fretX(fret)} y={16}>
              {fret}
            </text>
          ))}
          {frets.map((fret) =>
            SINGLE_INLAYS.has(fret) ? (
              <circle key={`i-${fret}`} className="fb-inlay" cx={fretX(fret)} cy={midY} r="6" />
            ) : DOUBLE_INLAYS.has(fret) ? (
              <g key={`i-${fret}`}>
                <circle className="fb-inlay" cx={fretX(fret)} cy={TOP + ROW_H} r="6" />
                <circle className="fb-inlay" cx={fretX(fret)} cy={TOP + boardH - ROW_H} r="6" />
              </g>
            ) : null,
          )}
          {frets.map((fret, index) => (
            <line
              key={`w-${fret}`}
              className="fb-fret"
              x1={nutX + (index + 1) * CELL_W}
              x2={nutX + (index + 1) * CELL_W}
              y1={TOP}
              y2={TOP + boardH}
            />
          ))}
          <line
            className={hasOpen ? 'fb-nut' : 'fb-edge'}
            x1={nutX}
            x2={nutX}
            y1={TOP - 1}
            y2={TOP + boardH + 1}
          />
          {tuning.map((open, string) => (
            <g key={`s-${string}`}>
              <text className="fb-name" x={NAME_W - 9} y={stringY(string)}>
                {stringName(open, latin)}
              </text>
              <line
                className="fb-string"
                x1={hasOpen ? NAME_W : nutX}
                x2={width - RIGHT + 4}
                y1={stringY(string)}
                y2={stringY(string)}
                strokeWidth={1 + string * 0.45}
              />
            </g>
          ))}
          {onPick &&
            tuning.flatMap((_, string) =>
              columns.map((fret) => {
                const x = fret === 0 ? NAME_W : nutX + (fret - startFret) * CELL_W;
                return (
                  <rect
                    key={`h-${string}-${fret}`}
                    className="fb-hit"
                    data-testid={`fret-${string}-${fret}`}
                    x={x}
                    y={TOP + ROW_H * string}
                    width={fret === 0 ? OPEN_W : CELL_W}
                    height={ROW_H}
                    onClick={() => {
                      setCursor({ string, fret });
                      onPick(string, fret);
                    }}
                  >
                    <title>{describe(string, fret)}</title>
                  </rect>
                );
              }),
            )}
          {markers
            .filter((marker) => marker.fret >= from && marker.fret <= to)
            .map((marker) => {
              const cx = fretX(marker.fret);
              const cy = stringY(marker.string);
              const group = marker.group === undefined ? '' : ` g${marker.group % 6}`;
              const radius = marker.sub
                ? 16
                : marker.tone === 'root' || marker.tone === 'active'
                  ? 14
                  : 13;
              return (
                <g
                  key={`m-${marker.string}-${marker.fret}-${marker.tone}`}
                  className={`fb-marker tone-${marker.tone}${group}${marker.role ? ` role-${marker.role}` : ''}${marker.altered ? ' altered' : ''}${marker.dim ? ' dim' : ''}`}
                  data-testid={`marker-${marker.string}-${marker.fret}`}
                  data-tone={marker.tone}
                  data-role={marker.role}
                  data-label={marker.label}
                  data-sub={marker.sub}
                >
                  {marker.tone === 'root' && (
                    <circle className="halo" cx={cx} cy={cy} r={radius + 4} />
                  )}
                  {marker.tone === 'active' && (
                    <circle className="halo" cx={cx} cy={cy} r={radius + 5} />
                  )}
                  {marker.altered && marker.tone !== 'root' && (
                    <circle className="alt" cx={cx} cy={cy} r={radius + 3.5} />
                  )}
                  <circle className="dot" cx={cx} cy={cy} r={radius} />
                  {marker.label && marker.sub ? (
                    <>
                      <text className="mark-label two" x={cx} y={cy - 4.5}>
                        {marker.label}
                      </text>
                      <text className="mark-sub" x={cx} y={cy + 8}>
                        {marker.sub}
                      </text>
                    </>
                  ) : (
                    marker.label && (
                      <text className="mark-label" x={cx} y={cy}>
                        {marker.label}
                      </text>
                    )
                  )}
                </g>
              );
            })}
          {onPick && focused && (
            <rect
              className="fb-cursor"
              x={(cursor.fret === 0 ? NAME_W : nutX + (cursor.fret - startFret) * CELL_W) + 2}
              y={TOP + ROW_H * cursor.string + 2}
              width={(cursor.fret === 0 ? OPEN_W : CELL_W) - 4}
              height={ROW_H - 4}
              rx="4"
            />
          )}
        </svg>
        {onPick && (
          <span className="sr-only" aria-live="polite">
            {focused ? describe(cursor.string, cursor.fret) : ''}
          </span>
        )}
      </div>
    </div>
  );
}
