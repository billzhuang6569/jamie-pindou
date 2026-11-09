import { deltaE2000 } from './color';
import { EMPTY } from './generate';
import type { Bead } from './palette';

/** 0 leaves outlines alone. 1 is the default. 2 also closes wider breaks and repaints more of the ring. */
export type OutlineStrength = 0 | 1 | 2;

/** A real break in an outline is short; a longer run of filled cells is a gap between two objects. */
const MAX_BREAK_CELLS = 3;
const RING_WINDOW = 3;
const RING_THRESHOLD: Record<1 | 2, number> = { 1: 18, 2: 30 };

const NEIGHBORS_8 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/** Fills a one-cell hole in a line: a cell with subject on both opposite sides. */
function closeBreaks(fg: Uint8Array, w: number, h: number): Uint8Array {
  const out = fg.slice();
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && fg[y * w + x] === 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (fg[y * w + x]) continue;
      if (
        (at(x - 1, y) && at(x + 1, y)) ||
        (at(x, y - 1) && at(x, y + 1)) ||
        (at(x - 1, y - 1) && at(x + 1, y + 1)) ||
        (at(x + 1, y - 1) && at(x - 1, y + 1))
      ) {
        out[y * w + x] = 1;
      }
    }
  }
  return out;
}

/** Marks cells reachable from the image edge without crossing a wall. */
function floodFromEdge(wall: Uint8Array, w: number, h: number): Uint8Array {
  const reached = new Uint8Array(wall.length);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!reached[i] && !wall[i]) {
      reached[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < wall.length - w) push(i + w);
  }
  return reached;
}

/**
 * Finds the outside of the subject. `pale` marks near-white or transparent cells. Pale cells
 * enclosed by the subject stay in it, and small breaks in an outline can't let the flood in.
 */
export function findBackground(pale: Uint8Array, w: number, h: number, strength: OutlineStrength): Uint8Array {
  const fg = pale.map((v) => (v ? 0 : 1));
  if (strength === 0) return floodFromEdge(fg, w, h);
  let wall = closeBreaks(fg, w, h);
  if (strength === 2) wall = closeBreaks(wall, w, h);

  const seen = new Uint8Array(wall.length);
  for (let start = 0; start < wall.length; start++) {
    if (seen[start] || !wall[start] || fg[start]) continue;
    const run: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      run.push(i);
      const x = i % w;
      const y = Math.floor(i / w);
      for (const [dx, dy] of NEIGHBORS_8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (!seen[n] && wall[n] && !fg[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    if (run.length > MAX_BREAK_CELLS) for (const i of run) wall[i] = 0;
  }

  const bg = floodFromEdge(wall, w, h);
  const out = bg.slice();
  // A lone filled cell with background on two opposite sides closed nothing, so it isn't subject.
  for (let i = 0; i < wall.length; i++) {
    if (!wall[i] || fg[i]) continue;
    const x = i % w;
    const y = Math.floor(i / w);
    const lr = (x === 0 || bg[i - 1]) && (x === w - 1 || bg[i + 1]);
    const ud = (y === 0 || bg[i - w]) && (y === h - 1 || bg[i + w]);
    if (lr || ud) out[i] = 1;
  }
  return out;
}

/** Removes small floating islands such as watermarks and stray icons. Mutates and returns `bg`. */
export function dropSpecks(bg: Uint8Array, w: number, h: number): Uint8Array {
  const seen = new Uint8Array(bg.length);
  const islands: number[][] = [];
  for (let start = 0; start < bg.length; start++) {
    if (seen[start] || bg[start]) continue;
    const cells: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      cells.push(i);
      const x = i % w;
      const y = Math.floor(i / w);
      for (const [dx, dy] of NEIGHBORS_8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (!seen[n] && !bg[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    islands.push(cells);
  }
  if (islands.length < 2) return bg;
  const biggest = Math.max(...islands.map((c) => c.length));
  const minimum = Math.max(6, biggest * 0.03);
  for (const cells of islands) {
    if (cells.length < minimum) for (const i of cells) bg[i] = 1;
  }
  return bg;
}

/** Ring cells take the colour their neighbours along the ring agree on. Mutates `cells`. */
export function unifyOutline(
  cells: Int16Array,
  bg: Uint8Array,
  w: number,
  h: number,
  colors: Bead[],
  strength: OutlineStrength,
) {
  if (strength === 0 || bg.every((v) => !v)) return;
  const threshold = RING_THRESHOLD[strength];
  for (let pass = 0; pass < 2; pass++) {
    const src = cells.slice();
    const ring = new Uint8Array(cells.length);
    for (let i = 0; i < cells.length; i++) {
      if (bg[i] || src[i] === EMPTY) continue;
      const x = i % w;
      const y = Math.floor(i / w);
      if ((x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) || (y > 0 && bg[i - w]) || (y < h - 1 && bg[i + w])) ring[i] = 1;
    }
    const tally = new Map<number, number>();
    for (let i = 0; i < cells.length; i++) {
      if (!ring[i]) continue;
      const x = i % w;
      const y = Math.floor(i / w);
      tally.clear();
      for (let ny = Math.max(0, y - RING_WINDOW); ny <= Math.min(h - 1, y + RING_WINDOW); ny++) {
        for (let nx = Math.max(0, x - RING_WINDOW); nx <= Math.min(w - 1, x + RING_WINDOW); nx++) {
          const n = ny * w + nx;
          if (ring[n]) tally.set(src[n], (tally.get(src[n]) ?? 0) + 1);
        }
      }
      let top = src[i];
      let topN = 0;
      for (const [c, n] of tally) {
        if (n > topN) {
          top = c;
          topN = n;
        }
      }
      const v = src[i];
      if (v === top) continue;
      const a = colors[v].lab;
      const b = colors[top].lab;
      const lighter = a[0] > b[0] + 8;
      // A pale cell on the ring is a break in the line, and a filled break takes the line's colour.
      const isBreak = a[0] > 92 && Math.hypot(a[1], a[2]) < 8 && b[0] < 80;
      if (deltaE2000(a, b) < threshold || isBreak || (lighter && strength === 2)) cells[i] = top;
    }
  }
}
