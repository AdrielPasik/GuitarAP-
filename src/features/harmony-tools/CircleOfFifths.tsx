import { CIRCLE_MAJOR, CIRCLE_MINOR, keyTitle, neighbors, relativeOf, sameKey, tonicName, tonicPc, type KeyRef } from '@/core/theory/keys';
import type { NameStyle } from '@/core/theory/pitch';

const CX = 160;
const CY = 160;
const polar = (radius: number, degrees: number) => {
  const angle = ((degrees - 90) * Math.PI) / 180;
  return [CX + radius * Math.cos(angle), CY + radius * Math.sin(angle)] as const;
};
function wedge(inner: number, outer: number, center: number) {
  const [x1, y1] = polar(outer, center - 14.2);
  const [x2, y2] = polar(outer, center + 14.2);
  const [x3, y3] = polar(inner, center + 14.2);
  const [x4, y4] = polar(inner, center - 14.2);
  return `M${x1},${y1} A${outer},${outer} 0 0 1 ${x2},${y2} L${x3},${y3} A${inner},${inner} 0 0 0 ${x4},${y4} Z`;
}

/**
 * The circle of fifths: major keys on the outside, their relative minors inside. A step clockwise is a fifth up.
 * Every wedge is a button (keyboard and screen reader friendly). Colours follow the harmonic roles used on the
 * fretboard: tonic blue, dominant/subdominant neighbours teal, relative violet — and each state also has a
 * shape/label cue, never colour alone.
 */
export function CircleOfFifths({
  selected,
  style,
  onSelect,
  documentKey,
  target,
}: {
  selected: KeyRef;
  style: NameStyle;
  onSelect: (key: KeyRef) => void;
  /** The key of the notebook, marked with a small ring. It never changes by exploring. */
  documentKey?: KeyRef;
  /** Destination of a modulation: drawn with an arc from the selected key. */
  target?: KeyRef;
}) {
  const positionOf = (key: KeyRef) => {
    const list = key.mode === 'major' ? CIRCLE_MAJOR : CIRCLE_MINOR;
    return list.findIndex((tonic) => tonicPc(tonic) === tonicPc(key.tonic));
  };
  const relative = relativeOf(selected);
  const near = [...neighbors(selected).slice(0, 2), ...neighbors(relative).slice(0, 2)].map((item) => item.key);
  const kinds = (key: KeyRef) => {
    const classes = ['cof-wedge'];
    if (sameKey(key, selected)) classes.push('sel');
    else if (sameKey(key, relative)) classes.push('rel');
    else if (near.some((item) => sameKey(item, key))) classes.push('near');
    if (target && sameKey(key, target)) classes.push('dest');
    if (documentKey && sameKey(key, documentKey)) classes.push('doc');
    return classes.join(' ');
  };
  const arc = target
    ? (() => {
        const from = polar(94, positionOf(selected.mode === 'major' ? selected : relativeOf(selected)) * 30);
        const to = polar(94, positionOf(target.mode === 'major' ? target : relativeOf(target)) * 30);
        return `M${from[0]},${from[1]} Q${CX},${CY} ${to[0]},${to[1]}`;
      })()
    : null;

  const ring = (list: readonly string[], mode: 'major' | 'minor', inner: number, outer: number, radius: number) =>
    list.map((tonic, index) => {
      const key: KeyRef = { tonic, mode };
      const [x, y] = polar(radius, index * 30);
      const label = tonicName(tonic, style);
      const sharpFlat = mode === 'major' && (tonic === 'F#' || tonic === 'Db') ? tonicName(tonic === 'F#' ? 'Gb' : 'C#', style) : null;
      return (
        <g
          key={`${mode}-${tonic}`}
          className={kinds(key)}
          role="button"
          tabIndex={0}
          aria-label={`${keyTitle(key, style)}${sameKey(key, selected) ? ', seleccionada' : ''}${documentKey && sameKey(key, documentKey) ? ', tonalidad del cuaderno' : ''}`}
          aria-pressed={sameKey(key, selected)}
          onClick={() => onSelect(key)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelect(key);
            }
          }}
        >
          <path d={wedge(inner, outer, index * 30)} />
          <text x={x} y={y - (sharpFlat ? 3 : 0)} textAnchor="middle" dominantBaseline="central" className={mode === 'major' ? 'cof-major' : 'cof-minor'}>
            {mode === 'minor' ? `${label}m` : label}
          </text>
          {sharpFlat && (
            <text x={x} y={y + 10} textAnchor="middle" dominantBaseline="central" className="cof-alt">
              {sharpFlat}
            </text>
          )}
        </g>
      );
    });

  return (
    <svg viewBox="0 0 320 320" className="cof" role="group" aria-label="Círculo de quintas">
      {ring(CIRCLE_MAJOR, 'major', 100, 150, 125)}
      {ring(CIRCLE_MINOR, 'minor', 62, 98, 80)}
      {arc && <path d={arc} className="cof-arc" fill="none" />}
      <circle cx={CX} cy={CY} r={56} className="cof-hub" />
      <text x={CX} y={CY - 8} textAnchor="middle" className="cof-hub-title">
        {tonicName(selected.tonic, style)}
      </text>
      <text x={CX} y={CY + 10} textAnchor="middle" className="cof-hub-sub">
        {selected.mode === 'major' ? 'mayor' : 'menor'}
      </text>
    </svg>
  );
}
