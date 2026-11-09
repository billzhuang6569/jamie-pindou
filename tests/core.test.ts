import { describe, expect, it } from 'vitest';
import { deltaE2000, rgbToLab, type Lab } from '../src/core/color';
import {
  beadTotal,
  colorCounts,
  commitCells,
  finishedCm,
  newDoc,
  paintCells,
  replaceColor,
  toggleBackground,
  toggleMirror,
} from '../src/core/doc';
import { EMPTY, cleanStrays, limitColors, matchCells, mergeSimilar, sampleCells } from '../src/core/generate';
import { placeImage } from '../src/core/image';
import { dropSpecks, findBackground, unifyOutline } from '../src/core/outline';
import { fitCropToSubject } from '../src/core/pattern';
import { detectPixelGrid } from '../src/core/pixelGrid';
import { BRANDS, brandById, matchableIndexes, seriesOf, type Bead } from '../src/core/palette';

const bead = (code: string, r: number, g: number, b: number): Bead => ({
  code,
  rgb: [r, g, b],
  lab: rgbToLab([r, g, b]),
  auto: true,
  base: true,
});
const WHITE = 0;
const BLACK = 1;
const RED = 2;
const NEAR_RED = 3;
const colors = [bead('W', 255, 255, 255), bead('K', 0, 0, 0), bead('R', 200, 30, 30), bead('r', 205, 35, 32)];

describe('CIEDE2000', () => {
  // Reference pairs from Sharma, Wu & Dalal (2005).
  const cases: [Lab, Lab, number][] = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ];
  it.each(cases)('matches the published value %#', (a, b, want) => {
    expect(deltaE2000(a, b)).toBeCloseTo(want, 3);
    expect(deltaE2000(b, a)).toBeCloseTo(want, 3);
  });
  it('is zero for identical colours', () => {
    expect(deltaE2000([40, 10, -5], [40, 10, -5])).toBe(0);
  });
});

describe('palettes', () => {
  it('has the eight brands', () => {
    expect(BRANDS.map((b) => b.id)).toEqual(['mard', 'coco', 'manman', 'panpan', 'mixiaowo', 'hama', 'perler', 'artkal']);
  });
  it('gives MARD 291 colours with a 221 base set', () => {
    const mard = brandById('mard');
    expect(mard.colors).toHaveLength(291);
    expect(mard.baseCount).toBe(221);
    expect(matchableIndexes(mard, 'full')).toHaveLength(290);
    expect(matchableIndexes(mard, 'base')).toHaveLength(220);
  });
  it('never auto-matches the transparent bead', () => {
    const mard = brandById('mard');
    const h1 = mard.colors.findIndex((c) => c.code === 'H1');
    expect(matchableIndexes(mard, 'full')).not.toContain(h1);
  });
  it('keeps codes unique within every brand', () => {
    for (const b of BRANDS) expect(new Set(b.colors.map((c) => c.code)).size).toBe(b.colors.length);
  });
  it('never auto-matches special beads', () => {
    const hama = brandById('hama');
    const allowed = matchableIndexes(hama, 'full').map((i) => hama.colors[i].name ?? '');
    expect(allowed.filter((n) => /transparent|clear|neon/i.test(n))).toEqual([]);
  });
  it('restricts matching to my colours when they are set', () => {
    const mard = brandById('mard');
    const got = matchableIndexes(mard, 'base', ['A1', 'P1']).map((i) => mard.colors[i].code);
    expect(got.sort()).toEqual(['A1', 'P1']);
  });
  it('groups codes for the picker', () => {
    expect(seriesOf('D10')).toBe('D');
    expect(seriesOf('ZG3')).toBe('ZG');
    expect(seriesOf('65')).toBe('51–100');
    expect(seriesOf('1')).toBe('1–50');
  });
});

describe('sampling', () => {
  const rgba = (rows: number[][]) => new Uint8ClampedArray(rows.flat());
  it('takes the dominant colour instead of averaging', () => {
    const red = [200, 30, 30, 255];
    const blue = [0, 0, 255, 255];
    const got = sampleCells(rgba([red, red, red, blue]), 1, 1, 2);
    expect(got[0]).toEqual([200, 30, 30]);
  });
  it('leaves mostly transparent cells empty', () => {
    const clear = [0, 0, 0, 0];
    const red = [200, 30, 30, 255];
    expect(sampleCells(rgba([clear, clear, clear, red]), 1, 1, 2)[0]).toBeNull();
  });
});

describe('merging', () => {
  it('folds a close colour into the more common one', () => {
    const cells = Int16Array.from([RED, RED, RED, NEAR_RED]);
    mergeSimilar(cells, colors, 7);
    expect([...cells]).toEqual([RED, RED, RED, RED]);
  });
  it('keeps a rare colour that is clearly different', () => {
    const cells = Int16Array.from([WHITE, WHITE, WHITE, BLACK]);
    mergeSimilar(cells, colors, 16);
    expect([...cells]).toEqual([WHITE, WHITE, WHITE, BLACK]);
  });
  it('does nothing at level zero', () => {
    const cells = Int16Array.from([RED, NEAR_RED]);
    mergeSimilar(cells, colors, 0);
    cleanStrays(cells, 2, 1, colors, 0);
    expect([...cells]).toEqual([RED, NEAR_RED]);
  });
  it('cleans a stray only when its colour is close', () => {
    const near = Int16Array.from([RED, RED, RED, RED, NEAR_RED, RED, RED, RED, RED]);
    cleanStrays(near, 3, 3, colors, 7);
    expect(near[4]).toBe(RED);
    const far = Int16Array.from([RED, RED, RED, RED, WHITE, RED, RED, RED, RED]);
    cleanStrays(far, 3, 3, colors, 7);
    expect(far[4]).toBe(WHITE);
  });
  it('caps the number of colours', () => {
    const cells = Int16Array.from([WHITE, WHITE, WHITE, BLACK, BLACK, RED, NEAR_RED]);
    limitColors(cells, colors, 3);
    expect(new Set(cells).size).toBe(3);
    limitColors(cells, colors, 1);
    expect(new Set(cells).size).toBe(1);
  });
  it('darkens and saturates only when asked', () => {
    const pale = [230, 150, 150] as const;
    const beads = [bead('pale', 230, 150, 150), bead('deep', 218, 125, 125)];
    expect(matchCells([pale], beads, [0, 1])[0]).toBe(0);
    expect(matchCells([pale], beads, [0, 1], true)[0]).toBe(1);
  });
});

describe('thin lines', () => {
  const red = [200, 30, 30, 255];
  const white = [255, 255, 255, 255];
  // One red column in a 4x4 cell of white: a quarter of the samples.
  const cell = new Uint8ClampedArray(
    Array.from({ length: 4 }, () => [red, white, white, white].flat()).flat(),
  );
  it('loses a thin line without line protection', () => {
    expect(sampleCells(cell, 1, 1, 4, 0)[0]).toEqual([255, 255, 255]);
  });
  it('keeps a thin line against a pale field', () => {
    expect(sampleCells(cell, 1, 1, 4, 1)[0]).toEqual([200, 30, 30]);
  });
  it('leaves a dark field alone', () => {
    const dark = [20, 20, 60, 255];
    const mixed = new Uint8ClampedArray(Array.from({ length: 4 }, () => [red, dark, dark, dark].flat()).flat());
    expect(sampleCells(mixed, 1, 1, 4, 1)[0]).toEqual([20, 20, 60]);
  });
});

/** Upscales a pixel-art grid with a possibly fractional scale, as an image editor would. */
function upscale(art: number[][], scale: number, ox = 0, oy = 0) {
  const width = Math.round(art[0].length * scale) + ox * 2;
  const height = Math.round(art.length * scale) + oy * 2;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const palette = [
    [255, 255, 255],
    [200, 30, 30],
    [20, 120, 60],
    [240, 200, 60],
    [40, 40, 140],
  ];
  for (let y = 0; y < height - oy * 2; y++) {
    for (let x = 0; x < width - ox * 2; x++) {
      const c = palette[art[Math.min(art.length - 1, Math.floor(y / scale))][Math.min(art[0].length - 1, Math.floor(x / scale))]];
      const p = ((y + oy) * width + x + ox) * 4;
      data[p] = c[0];
      data[p + 1] = c[1];
      data[p + 2] = c[2];
    }
  }
  return { data, width, height };
}

function randomArt(w: number, h: number) {
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  return Array.from({ length: h }, () => Array.from({ length: w }, () => next() % 5));
}

describe('pixel grid detection', () => {
  it('finds a fractional grid', () => {
    const g = detectPixelGrid(upscale(randomArt(40, 46), 15.4))!;
    expect(g.sure).toBe(true);
    expect(g.px).toBeCloseTo(15.4, 0);
    expect(g.py).toBeCloseTo(15.4, 0);
  });
  it('picks the real period, not half of it', () => {
    const g = detectPixelGrid(upscale(randomArt(30, 30), 17))!;
    expect(g.sure).toBe(true);
    expect(g.px).toBeGreaterThan(16);
    expect(g.px).toBeLessThan(18);
  });
  it('recognises crisp art at a small scale', () => {
    const g = detectPixelGrid(upscale(randomArt(60, 60), 4))!;
    expect(g.px).toBe(4);
    expect(g.sure).toBe(true);
  });
  it('treats a tiny image with few colours as one pixel per bead', () => {
    const g = detectPixelGrid(upscale(randomArt(32, 32), 1))!;
    expect(g.px).toBe(1);
  });
  it('is not fooled by a smooth gradient', () => {
    const width = 400;
    const height = 400;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 4;
        data[p] = (x * 255) / width;
        data[p + 1] = (y * 255) / height;
        data[p + 2] = 128 + 60 * Math.sin((x * y) / 3000);
        data[p + 3] = 255;
      }
    }
    expect(detectPixelGrid({ data, width, height })?.sure ?? false).toBe(false);
  });
});

/** Writes a mask as text: # is subject, . is pale. */
const paleOf = (rows: string[]) => Uint8Array.from(rows.join('').split('').map((c) => (c === '.' ? 1 : 0)));
const show = (bg: Uint8Array, w: number) => {
  const chars = [...bg].map((v) => (v ? '.' : '#')).join('');
  return Array.from({ length: bg.length / w }, (_, i) => chars.slice(i * w, (i + 1) * w));
};

describe('background', () => {
  const ringWithBreak = [
    '.......',
    '.#####.',
    '.#...#.',
    '.....#.',
    '.#...#.',
    '.#####.',
    '.......',
  ];
  it('leaks through a broken outline without protection', () => {
    const bg = findBackground(paleOf(ringWithBreak), 7, 7, 0);
    expect(bg[3 * 7 + 3]).toBe(1);
  });
  it('holds at a one-cell break and keeps the inside', () => {
    const bg = findBackground(paleOf(ringWithBreak), 7, 7, 1);
    expect(bg[3 * 7 + 3]).toBe(0);
    expect(bg[3 * 7 + 1]).toBe(0);
    expect(bg[0]).toBe(1);
  });
  it('does not bridge the gap between two objects', () => {
    const rows = [
      '.......',
      '.#####.',
      '.......',
      '.#####.',
      '.......',
    ];
    const bg = findBackground(paleOf(rows), 7, 5, 1);
    expect(show(bg, 7)[2]).toBe('.......');
  });
  it('removes small islands but keeps the subject', () => {
    const rows = [
      '##############',
      '##############',
      '##############',
      '.............#',
      '..............',
    ];
    const bg = Uint8Array.from(paleOf(rows));
    bg[13 + 14 * 3] = 1;
    bg[14 * 4 + 12] = 0;
    dropSpecks(bg, 14, 5);
    expect(bg[14 * 4 + 12]).toBe(1);
    expect(bg[0]).toBe(0);
  });
});

describe('outline', () => {
  it('repaints a close colour and fills a pale break along the ring', () => {
    const w = 7;
    const h = 5;
    const R = RED;
    const r = NEAR_RED;
    const W = WHITE;
    const K = BLACK;
    const cells = Int16Array.from([
      W, W, W, W, W, W, W,
      W, R, R, r, R, W, W,
      W, R, K, K, W, W, W,
      W, R, R, W, R, W, W,
      W, W, W, W, W, W, W,
    ]);
    const bg = paleOf(['.......', '.####..', '.###...', '.###.#.', '.......']);
    bg[3 * w + 3] = 0;
    unifyOutline(cells, bg, w, h, colors, 1);
    expect(cells[1 * w + 3]).toBe(R);
    expect(cells[3 * w + 3]).toBe(R);
    expect(cells[2 * w + 2]).toBe(K);
  });
  it('does nothing when switched off', () => {
    const cells = Int16Array.from([RED, NEAR_RED]);
    unifyOutline(cells, Uint8Array.from([0, 0]), 2, 1, colors, 0);
    expect([...cells]).toEqual([RED, NEAR_RED]);
  });
});

describe('pattern edits', () => {
  // A white frame, a black ring, and white enclosed inside it.
  const W = WHITE;
  const K = BLACK;
  const ring = () =>
    newDoc(
      5,
      5,
      Int16Array.from([
        W, W, W, W, W,
        W, K, K, K, W,
        W, K, W, K, W,
        W, K, K, K, W,
        W, W, W, W, W,
      ]),
    );

  it('mirrors and mirrors back', () => {
    const doc = newDoc(3, 1, Int16Array.from([WHITE, BLACK, RED]));
    const once = toggleMirror(doc);
    expect([...once.cells]).toEqual([RED, BLACK, WHITE]);
    expect(once.mirrored).toBe(true);
    const twice = toggleMirror(once);
    expect([...twice.cells]).toEqual([WHITE, BLACK, RED]);
    expect(twice.mirrored).toBe(false);
  });
  it('removes edge white and keeps enclosed white', () => {
    const off = toggleBackground(ring(), colors);
    expect(off.cells[0]).toBe(EMPTY);
    expect(off.cells[12]).toBe(WHITE);
    expect(colorCounts(off.cells).find((c) => c.index === WHITE)?.count).toBe(1);
  });
  it('restores the background exactly', () => {
    const doc = ring();
    const back = toggleBackground(toggleBackground(doc, colors), colors);
    expect([...back.cells]).toEqual([...doc.cells]);
    expect(back.bgRestore).toBeNull();
  });
  it('restores the background correctly after mirroring', () => {
    const doc = newDoc(3, 1, Int16Array.from([WHITE, BLACK, RED]));
    const off = toggleBackground(doc, colors);
    expect([...off.cells]).toEqual([EMPTY, BLACK, RED]);
    const flipped = toggleMirror(off);
    expect([...toggleBackground(flipped, colors).cells]).toEqual([RED, BLACK, WHITE]);
  });
  it('keeps a hand edit when the background comes back', () => {
    const off = toggleBackground(ring(), colors);
    const edited = paintCells(off, [0], RED);
    expect(toggleBackground(edited, colors).cells[0]).toBe(RED);
  });
  it('flows a transparent edge through the flood', () => {
    const doc = newDoc(3, 1, Int16Array.from([EMPTY, WHITE, BLACK]));
    expect(toggleBackground(doc, colors).cells[1]).toBe(EMPTY);
  });
  it('uses the background worked out at generation', () => {
    const doc = newDoc(3, 1, Int16Array.from([WHITE, WHITE, BLACK]), Uint8Array.from([1, 0, 0]));
    expect([...toggleBackground(doc, colors).cells]).toEqual([EMPTY, WHITE, BLACK]);
    expect([...toggleBackground(toggleMirror(doc), colors).cells]).toEqual([BLACK, WHITE, EMPTY]);
  });
  it('never mutates the old state', () => {
    const doc = ring();
    const before = [...doc.cells];
    paintCells(doc, [0, 1], RED);
    toggleMirror(doc);
    toggleBackground(doc, colors);
    replaceColor(doc, WHITE, RED);
    expect([...doc.cells]).toEqual(before);
  });
  it('replaces one colour everywhere', () => {
    const got = replaceColor(newDoc(3, 1, Int16Array.from([RED, BLACK, RED])), RED, WHITE);
    expect([...got.cells]).toEqual([WHITE, BLACK, WHITE]);
  });
  it('returns the same state when a stroke changed nothing', () => {
    const doc = ring();
    expect(commitCells(doc, doc.cells.slice())).toBe(doc);
  });
  it('counts match the non-empty cells', () => {
    const off = toggleBackground(ring(), colors);
    const nonEmpty = [...off.cells].filter((v) => v !== EMPTY).length;
    const counts = colorCounts(off.cells);
    expect(beadTotal(counts)).toBe(nonEmpty);
    expect(counts[0].count).toBeGreaterThanOrEqual(counts[counts.length - 1].count);
  });
  it('sizes the finished piece at 2.6mm a bead', () => {
    expect(finishedCm(52)).toBe('13.5');
    expect(finishedCm(104)).toBe('27.0');
  });
});

describe('framing the subject', () => {
  it('fills the frame with a subject off to one side', () => {
    const source = { width: 1000, height: 2000 };
    const crop = fitCropToSubject(source, { x0: 100, y0: 800, x1: 500, y1: 1200 }, 1);
    const place = placeImage(source, crop, 1000, 1000);
    const scale = place.width / source.width;
    expect(place.left + 100 * scale).toBeGreaterThanOrEqual(0);
    expect(place.left + 500 * scale).toBeLessThanOrEqual(1000);
    expect(place.top + 800 * scale).toBeGreaterThanOrEqual(0);
    expect(place.top + 1200 * scale).toBeLessThanOrEqual(1000);
    expect((400 * scale) / 1000).toBeGreaterThan(0.9);
  });
});
