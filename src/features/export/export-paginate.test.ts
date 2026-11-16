import { describe, expect, it } from 'vitest';
import { paginate } from '@/features/export/export-render';

describe('PDF pagination', () => {
  it('never splits a unit: a figure that does not fit moves whole to the next page', () => {
    const units = [
      { top: 0, bottom: 100 }, // title
      { top: 110, bottom: 400 }, // map 1
      { top: 410, bottom: 700 }, // map 2
      { top: 710, bottom: 1000 }, // map 3
    ];
    const pages = paginate(units, 720);
    expect(pages).toEqual([
      { top: 0, bottom: 700 },
      { top: 710, bottom: 1000 },
    ]);
    // Every unit lies completely inside exactly one page.
    for (const unit of units) {
      const holders = pages.filter((page) => unit.top >= page.top && unit.bottom <= page.bottom);
      expect(holders).toHaveLength(1);
    }
  });

  it('keeps everything on one page when it fits, and gives an oversized unit its own page', () => {
    expect(paginate([{ top: 0, bottom: 200 }, { top: 210, bottom: 400 }], 800)).toHaveLength(1);
    const pages = paginate([{ top: 0, bottom: 100 }, { top: 110, bottom: 1500 }, { top: 1510, bottom: 1600 }], 800);
    expect(pages).toHaveLength(3);
    expect(pages[1]).toEqual({ top: 110, bottom: 1500 });
  });
});
