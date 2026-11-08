import { deltaE2000, rgbToLab, type Lab, type RGB } from './color';
import type { Bead } from './palette';

export const EMPTY = -1;

/** Merge levels, as CIEDE2000 thresholds. Tuned against real photos and pixel art. */
export const MERGE_LEVELS = [
  { id: 0, label: '不合并', hint: '保留匹配到的所有颜色', threshold: 0 },
  { id: 1, label: '轻度', hint: '只合并几乎一样的颜色', threshold: 3 },
  { id: 2, label: '中度', hint: '明显减少颜色种类，保留眼睛、描边这类小而突出的颜色', threshold: 7 },
  { id: 3, label: '较强', hint: '颜色种类较少，细小的色差会被抹平', threshold: 11 },
  { id: 4, label: '强力', hint: '大幅减少颜色数量，适合简单的图案', threshold: 16 },
] as const;

/**
 * Picks one colour per cell. Uses the most common colour in the cell rather than the
 * average, so edges stay crisp instead of turning into a muddy in-between colour.
 * `samples` is RGBA at w*k by h*k.
 */
export function sampleCells(samples: Uint8ClampedArray, w: number, h: number, k: number): (RGB | null)[] {
  const out: (RGB | null)[] = new Array(w * h);
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  const rowBytes = w * k * 4;
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      bins.clear();
      let opaque = 0;
      for (let sy = 0; sy < k; sy++) {
        let p = (cy * k + sy) * rowBytes + cx * k * 4;
        for (let sx = 0; sx < k; sx++, p += 4) {
          if (samples[p + 3] < 128) continue;
          opaque++;
          const r = samples[p];
          const g = samples[p + 1];
          const b = samples[p + 2];
          const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
          const bin = bins.get(key);
          if (bin) {
            bin.n++;
            bin.r += r;
            bin.g += g;
            bin.b += b;
          } else {
            bins.set(key, { n: 1, r, g, b });
          }
        }
      }
      if (opaque * 2 < k * k) {
        out[cy * w + cx] = null;
        continue;
      }
      let best: { n: number; r: number; g: number; b: number } | null = null;
      for (const bin of bins.values()) if (!best || bin.n > best.n) best = bin;
      out[cy * w + cx] = [Math.round(best!.r / best!.n), Math.round(best!.g / best!.n), Math.round(best!.b / best!.n)];
    }
  }
  return out;
}

/** Nearest bead for each cell. CIE76 shortlists, CIEDE2000 decides, which keeps big grids fast. */
export function matchCells(cells: (RGB | null)[], colors: Bead[], allowed: number[]): Int16Array {
  const out = new Int16Array(cells.length);
  const cache = new Map<number, number>();
  const SHORTLIST = 12;
  const dist = new Float64Array(allowed.length);
  const order = allowed.map((_, i) => i);
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (!c) {
      out[i] = EMPTY;
      continue;
    }
    const key = (c[0] << 16) | (c[1] << 8) | c[2];
    let idx = cache.get(key);
    if (idx === undefined) {
      const lab = rgbToLab(c);
      for (let a = 0; a < allowed.length; a++) {
        const l = colors[allowed[a]].lab;
        dist[a] = (l[0] - lab[0]) ** 2 + (l[1] - lab[1]) ** 2 + (l[2] - lab[2]) ** 2;
      }
      order.sort((p, q) => dist[p] - dist[q]);
      let bestD = Infinity;
      idx = allowed[order[0]];
      for (let s = 0; s < Math.min(SHORTLIST, order.length); s++) {
        const d = deltaE2000(lab, colors[allowed[order[s]]].lab);
        if (d < bestD) {
          bestD = d;
          idx = allowed[order[s]];
        }
      }
      cache.set(key, idx);
    }
    out[i] = idx;
  }
  return out;
}

function countColors(cells: Int16Array): Map<number, number> {
  const counts = new Map<number, number>();
  for (const v of cells) if (v !== EMPTY) counts.set(v, (counts.get(v) ?? 0) + 1);
  return counts;
}

function applyRemap(cells: Int16Array, remap: Map<number, number>) {
  const resolve = (i: number) => {
    let cur = i;
    while (remap.has(cur)) cur = remap.get(cur)!;
    return cur;
  };
  for (let i = 0; i < cells.length; i++) if (cells[i] !== EMPTY) cells[i] = resolve(cells[i]);
}

/**
 * Folds each colour into a more common one when they are closer than `threshold`.
 * Rarity alone never removes a colour, so a tiny eye highlight survives.
 */
export function mergeSimilar(cells: Int16Array, colors: Bead[], threshold: number) {
  if (threshold <= 0) return;
  const counts = countColors(cells);
  const ascending = [...counts.keys()].sort((a, b) => counts.get(a)! - counts.get(b)! || a - b);
  const remap = new Map<number, number>();
  for (const i of ascending) {
    let best = -1;
    let bestD = threshold;
    for (const j of ascending) {
      if (j === i || remap.has(j) || counts.get(j)! < counts.get(i)!) continue;
      const d = deltaE2000(colors[i].lab, colors[j].lab);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best !== -1) {
      remap.set(i, best);
      counts.set(best, counts.get(best)! + counts.get(i)!);
    }
  }
  applyRemap(cells, remap);
}

/** Replaces lone stray cells with their surroundings when the two colours are close. */
export function cleanStrays(cells: Int16Array, w: number, h: number, colors: Bead[], threshold: number) {
  if (threshold <= 0) return;
  const src = cells.slice();
  const tally = new Map<number, number>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = src[i];
      if (v === EMPTY) continue;
      tally.clear();
      let alone = true;
      for (let dy = -1; dy <= 1 && alone; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx === 0 && dy === 0) || x + dx < 0 || x + dx >= w || y + dy < 0 || y + dy >= h) continue;
          const n = src[(y + dy) * w + x + dx];
          if (n === v) {
            alone = false;
            break;
          }
          if (n !== EMPTY) tally.set(n, (tally.get(n) ?? 0) + 1);
        }
      }
      if (!alone) continue;
      let top = -1;
      let topN = 0;
      for (const [c, n] of tally) {
        if (n > topN) {
          top = c;
          topN = n;
        }
      }
      if (top !== -1 && deltaE2000(colors[v].lab, colors[top].lab) < threshold) cells[i] = top;
    }
  }
}

/** Keeps at most `max` colours, each time folding the colour whose loss is least visible. */
export function limitColors(cells: Int16Array, colors: Bead[], max: number) {
  if (max <= 0) return;
  const counts = countColors(cells);
  const remap = new Map<number, number>();
  const live = new Set(counts.keys());
  while (live.size > max) {
    let from = -1;
    let to = -1;
    let bestCost = Infinity;
    for (const i of live) {
      for (const j of live) {
        if (i === j || counts.get(i)! > counts.get(j)!) continue;
        const cost = counts.get(i)! * deltaE2000(colors[i].lab, colors[j].lab);
        if (cost < bestCost) {
          bestCost = cost;
          from = i;
          to = j;
        }
      }
    }
    if (from === -1) break;
    remap.set(from, to);
    counts.set(to, counts.get(to)! + counts.get(from)!);
    live.delete(from);
  }
  applyRemap(cells, remap);
}

export type GenerateOptions = {
  mergeThreshold: number;
  maxColors: number;
};

export function buildCells(
  samples: Uint8ClampedArray,
  w: number,
  h: number,
  k: number,
  colors: Bead[],
  allowed: number[],
  { mergeThreshold, maxColors }: GenerateOptions,
): Int16Array {
  const cells = matchCells(sampleCells(samples, w, h, k), colors, allowed);
  mergeSimilar(cells, colors, mergeThreshold);
  cleanStrays(cells, w, h, colors, mergeThreshold);
  limitColors(cells, colors, maxColors);
  return cells;
}

export const isNearWhite = (lab: Lab) => lab[0] > 92 && Math.hypot(lab[1], lab[2]) < 8;
