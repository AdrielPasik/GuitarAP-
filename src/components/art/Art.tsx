import type { CSSProperties } from 'react';

/**
 * Original line illustrations for GuitarAP: two guitars, notes and a ring of fifths. Pure SVG paths drawn for
 * this app (nothing sampled or imported), coloured by `currentColor` so they follow the theme, hidden from
 * assistive technology (they are decoration) and animated only with transform/opacity.
 */
const strings = [94, 96.4, 98.8, 101.2, 103.6, 106];

function Neck({ top = 58, bottom = 290 }: { top?: number; bottom?: number }) {
  const frets = Array.from({ length: 11 }, (_, index) => top + 24 + index * 21).filter((y) => y < bottom);
  return (
    <>
      <path d={`M82 ${top - 48}Q100 ${top - 56} 118 ${top - 48}L121 ${top}H79Z`} />
      {[20, 34, 48].flatMap((y) => [
        <circle key={`l${y}`} cx="74" cy={y} r="3" />,
        <circle key={`r${y}`} cx="126" cy={y - 12 + top - 48 + 12 - (top - 48)} r="3" />,
      ])}
      <path d={`M92 ${top}V${bottom}M108 ${top}V${bottom}`} />
      {frets.map((y) => (
        <path key={y} d={`M92 ${y}H108`} strokeWidth="1" opacity="0.7" />
      ))}
    </>
  );
}

export function GuitarAcoustic({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 200 520" className={`art-guitar ${className}`} style={style} aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <Neck />
      <path fill="currentColor" fillOpacity="0.05" d="M100 250C132 250 156 270 156 300C156 322 140 334 138 350C136 364 164 376 164 414C164 462 136 500 100 500C64 500 36 462 36 414C36 376 64 364 62 350C60 334 44 322 44 300C44 270 68 250 100 250Z" />
      <circle cx="100" cy="322" r="22" strokeWidth="2.2" />
      <circle cx="100" cy="322" r="28" strokeWidth="0.9" opacity="0.6" />
      <path d="M76 446H124M80 452H120" />
      {strings.map((x, index) => (
        <path key={x} d={`M${x} 62L${86 + index * 5.6} 446`} strokeWidth="0.9" opacity="0.85" />
      ))}
    </svg>
  );
}

export function GuitarElectric({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 200 520" className={`art-guitar ${className}`} style={style} aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <Neck bottom={300} />
      <path fill="currentColor" fillOpacity="0.05" d="M100 296C112 276 132 262 150 272C166 282 164 302 156 316C150 328 156 342 164 356C176 378 170 416 150 446C134 470 112 484 92 484C66 484 44 464 38 436C34 416 40 400 48 388C56 376 50 364 44 352C36 336 38 312 54 296C68 282 86 284 100 296Z" />
      <rect x="84" y="340" width="32" height="8" rx="3" />
      <rect x="84" y="374" width="32" height="8" rx="3" />
      <path d="M80 428H120M84 436H116" />
      <circle cx="134" cy="440" r="5" />
      <circle cx="144" cy="420" r="5" />
      {strings.map((x, index) => (
        <path key={x} d={`M${x} 62L${88 + index * 4.8} 432`} strokeWidth="0.9" opacity="0.85" />
      ))}
    </svg>
  );
}

/** A handful of drifting musical glyphs (eighth, beamed pair, quarter, a sharp and a rest-like squiggle). */
export function NoteGlyph({ kind, className = '', style }: { kind: 'eighth' | 'pair' | 'quarter' | 'sharp' | 'wave'; className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 48 48" className={`art-note ${className}`} style={style} aria-hidden="true" focusable="false" fill="currentColor" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      {kind === 'eighth' && (
        <>
          <ellipse cx="17" cy="35" rx="7" ry="5" transform="rotate(-22 17 35)" stroke="none" />
          <path d="M23 33V8c0 0 12 2 12 14" fill="none" strokeWidth="3" />
        </>
      )}
      {kind === 'quarter' && (
        <>
          <ellipse cx="17" cy="35" rx="7" ry="5" transform="rotate(-22 17 35)" stroke="none" />
          <path d="M23 33V8" fill="none" strokeWidth="3" />
        </>
      )}
      {kind === 'pair' && (
        <>
          <ellipse cx="12" cy="36" rx="6" ry="4.4" transform="rotate(-22 12 36)" stroke="none" />
          <ellipse cx="34" cy="31" rx="6" ry="4.4" transform="rotate(-22 34 31)" stroke="none" />
          <path d="M17 34V11M39 29V6M17 11L39 6" fill="none" strokeWidth="3" />
        </>
      )}
      {kind === 'sharp' && <path d="M16 10v28M26 8v28M10 19l22-5M10 31l22-5" fill="none" strokeWidth="2.6" />}
      {kind === 'wave' && <path d="M3 24c5-14 8-14 11 0s8 14 11 0 8-14 11 0 5 8 9 0" fill="none" strokeWidth="2.6" />}
    </svg>
  );
}

/** A ring of twelve ticks and a few arcs: the circle of fifths as an ornament. */
export function FifthsRing({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 200 200" className={`art-ring ${className}`} style={style} aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.2">
      <circle cx="100" cy="100" r="92" />
      <circle cx="100" cy="100" r="62" strokeDasharray="2 6" />
      <circle cx="100" cy="100" r="32" />
      {Array.from({ length: 12 }, (_, index) => {
        const angle = (index * 30 * Math.PI) / 180;
        return <path key={index} d={`M${100 + 62 * Math.sin(angle)} ${100 - 62 * Math.cos(angle)}L${100 + 92 * Math.sin(angle)} ${100 - 92 * Math.cos(angle)}`} />;
      })}
      <path d="M100 8L151 54" strokeWidth="2" />
    </svg>
  );
}

/**
 * The scene behind the library header and the empty states. Everything is decorative: it never receives
 * focus, never blocks a click (pointer-events none) and disappears with "Efectos decorativos: apagados".
 */
export function StudioScene({ variant = 'hero' }: { variant?: 'hero' | 'compact' }) {
  return (
    <div className={`studio-scene ${variant}`} aria-hidden="true">
      <div className="scene-strings">
        {Array.from({ length: 6 }, (_, index) => (
          <i key={index} style={{ top: `${14 + index * 13}%`, animationDelay: `${index * -1.3}s` }} />
        ))}
      </div>
      <FifthsRing className="scene-ring art-float" style={{ ['--r' as string]: '0deg', ['--d' as string]: '40s' }} />
      <GuitarAcoustic className="scene-g1 art-float" style={{ ['--r' as string]: '16deg', ['--d' as string]: '17s' }} />
      <GuitarElectric className="scene-g2 art-float" style={{ ['--r' as string]: '-18deg', ['--d' as string]: '21s' }} />
      <NoteGlyph kind="eighth" className="scene-n1 art-drift" style={{ ['--d' as string]: '13s' }} />
      <NoteGlyph kind="pair" className="scene-n2 art-drift" style={{ ['--d' as string]: '17s' }} />
      <NoteGlyph kind="quarter" className="scene-n3 art-drift" style={{ ['--d' as string]: '19s' }} />
      <NoteGlyph kind="sharp" className="scene-n4 art-drift" style={{ ['--d' as string]: '15s' }} />
      <NoteGlyph kind="wave" className="scene-n5 art-drift" style={{ ['--d' as string]: '23s' }} />
    </div>
  );
}
