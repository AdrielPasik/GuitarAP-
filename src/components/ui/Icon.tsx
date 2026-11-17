import type { SVGProps } from 'react';

const paths = {
  library: 'M2.5 3.5h3.5v9H2.5zM7 3.5h3v9H7zM11.2 4.2l2.8 8.3',
  practice: 'M5.2 3.4v9.2l7.3-4.6z',
  settings: 'M2.5 5h11M2.5 11h11M6 3v4M10 9v4',
  undo: 'M5.5 3.8l-3 3 3 3M2.5 6.8H10a3.5 3.5 0 010 7H7',
  redo: 'M10.5 3.8l3 3-3 3M13.5 6.8H6a3.5 3.5 0 000 7h3',
  plus: 'M8 3v10M3 8h10',
  minus: 'M3 8h10',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  'chevron-left': 'M10 3.5L5.5 8l4.5 4.5',
  'chevron-right': 'M6 3.5L10.5 8 6 12.5',
  'chevron-down': 'M3.5 6l4.5 4.5L12.5 6',
  'arrow-up': 'M8 13V3.5M4 7l4-4 4 4',
  'arrow-down': 'M8 3v9.5M4 9l4 4 4-4',
  play: 'M5.2 3.4v9.2l7.3-4.6z',
  pause: 'M4.5 3.5h2.4v9H4.5zM9.1 3.5h2.4v9H9.1z',
  melody: 'M2 12.5h3v-3h3v-3h3v-3h2.5',
  lyrics: 'M3 3.8h10M3 7h6.5M3 10.2h10M3 13.2h5',
  chords: 'M3.5 2.5v11M7 2.5v11M10.5 2.5v11M2.5 6.2h9M9.2 9.7h.01',
  comment: 'M2.5 3.5h11v7H8.4l-3 2.8v-2.8H2.5z',
  circle: 'M8 2.2a5.8 5.8 0 100 11.6A5.8 5.8 0 008 2.2zM8 2.2v2.6M12.7 5l-2.2 1.3M12.7 11l-2.2-1.3M8 13.8v-2.6M3.3 11l2.2-1.3M3.3 5l2.2 1.3',
  stop: 'M4.5 4.5h7v7h-7z',
  user: 'M8 8a2.6 2.6 0 100-5.2A2.6 2.6 0 008 8zM2.8 13.8c.4-2.5 2.4-3.9 5.2-3.9s4.8 1.4 5.2 3.9',
  check: 'M3.5 8.5l3 3 6-7',
  cloud: 'M4.6 12.2a3 3 0 01-.5-5.9 4 4 0 017.7.4 2.8 2.8 0 01-.5 5.5z',
  'cloud-off': 'M4.6 12.2a3 3 0 01-.5-5.9M7 4.2a4 4 0 014.8 2.5 2.8 2.8 0 011.2 4.9M2.5 2.5l11 11',
  sync: 'M13 7a5 5 0 00-9-2M3 2.5V5h2.5M3 9a5 5 0 009 2M13 13.5V11h-2.5',
  alert: 'M8 2.6l5.9 10.4H2.1zM8 6.8v2.8M8 11.3h.01',
  sun: 'M8 10.8a2.8 2.8 0 100-5.6 2.8 2.8 0 000 5.6zM8 1.5v1.4M8 13.1v1.4M1.5 8h1.4M13.1 8h1.4M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1',
  moon: 'M13 9.4A5.5 5.5 0 116.6 3a4.3 4.3 0 006.4 6.4z',
  close: 'M4 4l8 8M12 4l-8 8',
  search: 'M7 11.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9zM10.3 10.3l3.2 3.2',
  folder: 'M2 4.3h4l1.4 1.5H14v6.7H2z',
  song: 'M6 11.7V3.4l7-1.4v8M6 11.7a1.7 1.7 0 11-3.4 0 1.7 1.7 0 013.4 0zM13 10a1.7 1.7 0 11-3.4 0A1.7 1.7 0 0113 10z',
  tab: 'M2 4.5h12M2 8h12M2 11.5h12M5.5 3.2v3M9.5 6.7v3M7 9.8v3',
  map: 'M2.5 3.5h11v9h-11zM6.2 3.5v9M9.8 3.5v9M4.4 8h.01M8 6h.01M11.6 10h.01',
  mixed: 'M2.5 3h11M2.5 5.2h11M2.5 7.4h11M2.5 9.4h11v4h-11zM6.2 9.4v4M9.8 9.4v4',
  text: 'M3 4h10M3 8h10M3 12h6',
  trash: 'M3 4.5h10M6.2 4.5V3h3.6v1.5M4.6 4.5l.5 8.5h5.8l.5-8.5',
  copy: 'M5.5 5.5h7v7h-7zM3.5 10.5v-7h7',
  focus: 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10',
  export: 'M8 10V2.5M5 5.2l3-2.7 3 2.7M3 9.5v4h10v-4',
  history: 'M2.7 8a5.3 5.3 0 101.7-3.9M2.5 2.8v3h3M8 5v3.2l2 1.3',
  pencil: 'M3 13l.6-3L10.5 3.1a1.4 1.4 0 012 2L5.6 12z',
  link: 'M6.5 9.5a2.5 2.5 0 003.5 0l2-2a2.5 2.5 0 00-3.5-3.5l-.7.7M9.5 6.5a2.5 2.5 0 00-3.5 0l-2 2a2.5 2.5 0 003.5 3.5l.7-.7',
  eye: 'M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8zM8 9.8a1.8 1.8 0 100-3.6 1.8 1.8 0 000 3.6z',
  'eye-off':
    'M2.5 2.5l11 11M6.6 6.6a1.8 1.8 0 002.6 2.6M4.3 4.5C2.9 5.5 1.8 8 1.8 8s2.2 4.2 6.2 4.2c1 0 1.9-.3 2.7-.7M13 10.5c.7-.9 1.2-2.5 1.2-2.5S12 3.8 8 3.8c-.4 0-.8 0-1.1.1',
  keyboard: 'M2 4.5h12v7H2zM4.5 7h.01M7 7h.01M9.5 7h.01M12 7h.01M5 9.5h6',
  fretboard: 'M2 3.5h12v9H2zM5.3 3.5v9M8.6 3.5v9M11.9 3.5v9M2 6.5h12M2 9.5h12',
  home: 'M2.5 7.5L8 2.8l5.5 4.7V13h-3.5V9.5H6V13H2.5z',
  signin: 'M6 3.5H3.5v9H6M7 8h6.5M11 5.5L13.5 8 11 10.5',
} as const;

export type IconName = keyof typeof paths | 'pick';

export function Icon({ name, size = 16, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  if (name === 'pick') {
    return (
      <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" {...rest}>
        <path d="M8 1.8c3.2 0 5.2 1.7 5.2 4.4 0 3.4-3.1 7.3-5.2 8.2-2.1-.9-5.2-4.8-5.2-8.2C2.8 3.5 4.8 1.8 8 1.8z" fill="currentColor" />
      </svg>
    );
  }
  const filled = name === 'play' || name === 'stop' || name === 'pause';
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 1 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  );
}
