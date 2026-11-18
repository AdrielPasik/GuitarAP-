import type { CSSProperties } from 'react';
import type { CoverStyle } from '@/core/model';

export const COVER_STYLES: Array<{ id: CoverStyle; name: string }> = [
  { id: 'grooves', name: 'Surcos' },
  { id: 'bands', name: 'Franjas' },
  { id: 'sun', name: 'Sol' },
  { id: 'grid', name: 'Retícula' },
  { id: 'wave', name: 'Onda' },
  { id: 'type', name: 'Tipográfica' },
];

/**
 * An original abstract sleeve drawn with CSS only (no image file, nothing stored but a style name and a hue).
 * Each theme tints it through its own variables, so the same cover belongs to every universe.
 */
export function Cover({ title, style, hue, size = 'md', className = '' }: { title: string; style: CoverStyle; hue: number; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const initial = (title.trim()[0] ?? '♪').toLocaleUpperCase();
  return (
    <span className={`sleeve sleeve-${style} sleeve-${size} ${className}`} style={{ '--hue': hue } as CSSProperties} aria-hidden="true">
      {style === 'type' && <b className="sleeve-initial">{initial}</b>}
      {style === 'sun' && <i className="sleeve-disc" />}
      {style === 'grooves' && <i className="sleeve-label" />}
    </span>
  );
}
