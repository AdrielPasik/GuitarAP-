import type { Voicing } from '@/core/theory/voicings';

const ROLE_VAR: Record<string, string> = {
  root: 'var(--h-root)',
  third: 'var(--h-third)',
  fifth: 'var(--h-fifth)',
  seventh: 'var(--h-seventh)',
  other: 'var(--ink-2)',
};

/**
 * A classic vertical chord box: string 6 on the left, string 1 on the right, nut (or base fret) on top.
 * «×» = string not played, «○» = open string. Dots carry the interval, coloured by harmonic function.
 */
export function ChordDiagram({ voicing, label, size = 1 }: { voicing: Voicing; label: string; size?: number }) {
  const strings = voicing.frets.length;
  const fretted = voicing.frets.filter((fret): fret is number => fret !== null && fret > 0);
  const top = fretted.length && Math.max(...fretted) > 5 ? Math.min(...fretted) : 1;
  const rows = Math.max(4, (fretted.length ? Math.max(...fretted) : 0) - top + 1);
  const gap = 22;
  const rowH = 26;
  const left = 26;
  const head = 26;
  const width = left + gap * (strings - 1) + 18;
  const height = head + rowH * rows + 12;
  const x = (string: number) => left + gap * (strings - string); // string 6 → left
  const y = (fret: number) => head + rowH * (fret - top + 0.5);
  const byString = new Map(voicing.notes.map((note) => [note.string, note]));
  return (
    <svg className="chord-diagram" viewBox={`0 0 ${width} ${height}`} width={width * size} height={height * size} role="img" aria-label={label}>
      {top === 1 ? (
        <rect x={left - 1} y={head - 4} width={gap * (strings - 1) + 2} height={4} fill="var(--ink)" />
      ) : (
        <text x={4} y={head + rowH / 2 + 4} fontSize="11" fill="var(--ink-2)">{top}</text>
      )}
      {Array.from({ length: rows + 1 }, (_, row) => (
        <line key={`f${row}`} x1={left} x2={left + gap * (strings - 1)} y1={head + rowH * row} y2={head + rowH * row} stroke="var(--line-2)" />
      ))}
      {Array.from({ length: strings }, (_, index) => (
        <line key={`s${index}`} x1={left + gap * index} x2={left + gap * index} y1={head} y2={head + rowH * rows} stroke="var(--ink-3)" strokeWidth={1 + index * 0.18} />
      ))}
      {voicing.barre && (
        <rect
          x={x(voicing.barre.to) - 9}
          y={y(voicing.barre.fret) - 9}
          width={x(voicing.barre.from) - x(voicing.barre.to) + 18}
          height={18}
          rx={9}
          fill="color-mix(in srgb, var(--ink) 18%, transparent)"
        />
      )}
      {voicing.frets.map((fret, index) => {
        const string = index + 1;
        const cx = x(string);
        if (fret === null) return <text key={string} x={cx} y={head - 9} textAnchor="middle" fontSize="12" fill="var(--ink-3)" aria-hidden="true">×</text>;
        const note = byString.get(string)!;
        if (fret === 0) {
          return (
            <g key={string}>
              <circle cx={cx} cy={head - 13} r={6} fill="none" stroke={ROLE_VAR[note.role]} strokeWidth={2} />
            </g>
          );
        }
        return (
          <g key={string}>
            <circle cx={cx} cy={y(fret)} r={9.5} fill={ROLE_VAR[note.role]} />
            <text x={cx} y={y(fret) + 3.5} textAnchor="middle" fontSize={note.degree.length > 2 ? 7.5 : 9.5} fontWeight={700} fill="var(--h-ink)">{note.degree}</text>
          </g>
        );
      })}
    </svg>
  );
}
