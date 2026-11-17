/**
 * The GuitarAP mark: a G drawn as the soundhole ring of a guitar, six strings running through it,
 * and a note head where the G opens. One idea, three readings (instrument, writing, monogram).
 * It follows the text colour; the note head follows the accent, so it works on light and dark.
 */
export function LogoMark({ size = 28, strings = true }: { size?: number; strings?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false" className="logo-mark">
      {strings && (
        <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.42">
          <path d="M3 14h58M3 21.2h58M3 28.4h58M3 35.6h58M3 42.8h58M3 50h58" />
        </g>
      )}
      <path d="M45.4 18.6A19 19 0 1 0 51 32H34" fill="none" stroke="currentColor" strokeWidth="6.2" strokeLinecap="round" strokeLinejoin="round" />
      <g transform="rotate(-22 47 17)">
        <ellipse cx="47" cy="17" rx="6" ry="4.4" fill="var(--accent)" />
      </g>
      <path d="M52.6 15.6V4.5" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
