import type { MelodyEvent } from '@/core/model';

/** Copy/paste inside the app: notes without ids or syllables (a pasted note is a new note). */
export type ClipEvent = Omit<MelodyEvent, 'id' | 'lyric'>;
let held: ClipEvent[] = [];
export const copyEvents = (events: MelodyEvent[]) => {
  held = events.map((event) => {
    const clone: Partial<MelodyEvent> = { ...event };
    delete clone.id;
    delete clone.lyric;
    return clone as ClipEvent;
  });
};
export const pastedEvents = (): ClipEvent[] => held;
