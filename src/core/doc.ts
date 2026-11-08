import { EMPTY, isNearWhite } from './generate';
import type { Bead } from './palette';

/** Marks a cell in `bgRestore` as not removed. */
const NOT_REMOVED = -2;

/** One state of a pattern. Treated as immutable: every edit returns a new one. */
export type PatternDoc = {
  w: number;
  h: number;
  cells: Int16Array;
  mirrored: boolean;
  /** While the white background is off: each removed cell's old colour, else NOT_REMOVED. */
  bgRestore: Int16Array | null;
};

export const newDoc = (w: number, h: number, cells: Int16Array): PatternDoc => ({
  w,
  h,
  cells,
  mirrored: false,
  bgRestore: null,
});

function flipRows(src: Int16Array, w: number, h: number): Int16Array {
  const out = new Int16Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * w + x] = src[y * w + (w - 1 - x)];
  }
  return out;
}

export const toggleMirror = (doc: PatternDoc): PatternDoc => ({
  ...doc,
  cells: flipRows(doc.cells, doc.w, doc.h),
  bgRestore: doc.bgRestore && flipRows(doc.bgRestore, doc.w, doc.h),
  mirrored: !doc.mirrored,
});

/** Near-white cells connected to the image edge. Enclosed white, like a dog's face, stays. */
export function backgroundMask(doc: PatternDoc, colors: Bead[]): Uint8Array {
  const { w, h, cells } = doc;
  const mask = new Uint8Array(cells.length);
  const passable = (i: number) => cells[i] === EMPTY || isNearWhite(colors[cells[i]].lab);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!mask[i] && passable(i)) {
      mask[i] = 1;
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
    if (i < cells.length - w) push(i + w);
  }
  return mask;
}

export function toggleBackground(doc: PatternDoc, colors: Bead[]): PatternDoc {
  if (doc.bgRestore) {
    const cells = doc.cells.slice();
    doc.bgRestore.forEach((old, i) => {
      if (old !== NOT_REMOVED) cells[i] = old;
    });
    return { ...doc, cells, bgRestore: null };
  }
  const mask = backgroundMask(doc, colors);
  const cells = doc.cells.slice();
  const bgRestore = new Int16Array(cells.length).fill(NOT_REMOVED);
  mask.forEach((on, i) => {
    if (on && cells[i] !== EMPTY) {
      bgRestore[i] = cells[i];
      cells[i] = EMPTY;
    }
  });
  return { ...doc, cells, bgRestore };
}

/** Sets cells to one value. A hand edit also takes the cell out of the background restore. */
export function paintCells(doc: PatternDoc, indexes: Iterable<number>, value: number): PatternDoc {
  const cells = doc.cells.slice();
  const bgRestore = doc.bgRestore && doc.bgRestore.slice();
  for (const i of indexes) {
    cells[i] = value;
    if (bgRestore) bgRestore[i] = NOT_REMOVED;
  }
  return { ...doc, cells, bgRestore };
}

/** Commits cells edited on a copy, such as one finished brush stroke. */
export function commitCells(doc: PatternDoc, next: Int16Array): PatternDoc {
  const changed: number[] = [];
  const values: number[] = [];
  next.forEach((v, i) => {
    if (v !== doc.cells[i]) {
      changed.push(i);
      values.push(v);
    }
  });
  if (changed.length === 0) return doc;
  const cells = doc.cells.slice();
  const bgRestore = doc.bgRestore && doc.bgRestore.slice();
  changed.forEach((i, n) => {
    cells[i] = values[n];
    if (bgRestore) bgRestore[i] = NOT_REMOVED;
  });
  return { ...doc, cells, bgRestore };
}

export function replaceColor(doc: PatternDoc, from: number, to: number): PatternDoc {
  const hit: number[] = [];
  doc.cells.forEach((v, i) => {
    if (v === from) hit.push(i);
  });
  return paintCells(doc, hit, to);
}

export type ColorCount = { index: number; count: number };

/** Colours used, most common first. Empty cells don't count. */
export function colorCounts(cells: Int16Array): ColorCount[] {
  const counts = new Map<number, number>();
  for (const v of cells) if (v !== EMPTY) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .map(([index, count]) => ({ index, count }))
    .sort((a, b) => b.count - a.count || a.index - b.index);
}

export const beadTotal = (counts: ColorCount[]) => counts.reduce((sum, c) => sum + c.count, 0);

/** Beads are 2.6mm across, so a side's length follows from its cell count. */
export const BEAD_MM = 2.6;
export const finishedCm = (cells: number) => ((cells * BEAD_MM) / 10).toFixed(1);
