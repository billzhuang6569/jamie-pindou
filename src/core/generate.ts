import { deltaE2000, rgbToLab, type Lab, type RGB } from './color';
import type { Bead } from './palette';

export const EMPTY = -1;

/** Merge levels, as CIEDE2000 thresholds. Tuned against real photos and pixel art. */
export const MERGE_LEVELS = [
  { id: 0, label: '不合并', hint: '保留匹配到的所有颜色', threshold: 0 },
  { id: 1, label: '轻度', hint: '只合并几乎一样的颜色', threshold: 3 },
  { id: 2, label: '中度', hint: '明显减少颜色种类，保留眼睛、描边这类小而突出的颜色', threshold: 6 },
  { id: 3, label: '较强', hint: '颜色种类较少，细小的色差会被抹平', threshold: 10 },
  { id: 4, label: '强力', hint: '大幅减少颜色数量，适合简单的图案', threshold: 16 },
] as const;

/**
 * The "rich" colour setting, fitted to a hand-approved pattern: beads read duller than a
 * glowing screen, so darkening and saturating brings the finished piece closer to the picture.
 */
const RICH_GAMMA = 1.2;
const RICH_SATURATION = 1.2;

export function enrich([L, a, b]: Lab): Lab {
  return [100 * (Math.min(100, Math.max(0, L)) / 100) ** RICH_GAMMA, a * RICH_SATURATION, b * RICH_SATURATION];
}

/** How far a minority colour must be from the dominant one to count as a separate line. */
const LINE_MIN_CONTRAST = 25;
const LINE_MIN_DARKER = 12;
const LINE_PALE_FIELD = 70;
const LINE_MIN_SHARE: Record<1 | 2, number> = { 1: 0.22, 2: 0.14 };

type Bin = { n: number; r: number; g: number; b: number };

const binRgb = (bin: Bin): RGB => [Math.round(bin.r / bin.n), Math.round(bin.g / bin.n), Math.round(bin.b / bin.n)];

/** The most common colour among some bins, or a thin dark line against a pale field. */
function pickColor(bins: Map<number, Bin>, opaque: number, lineStrength: 0 | 1 | 2): RGB {
  let top: Bin | null = null;
  for (const bin of bins.values()) if (!top || bin.n > top.n) top = bin;
  const dominant = binRgb(top!);
  if (lineStrength === 0) return dominant;
  const field = rgbToLab(dominant);
  if (field[0] <= LINE_PALE_FIELD) return dominant;
  let farCount = 0;
  let line: Bin | null = null;
  for (const bin of bins.values()) {
    if (bin === top) continue;
    if (deltaE2000(rgbToLab(binRgb(bin)), field) <= LINE_MIN_CONTRAST) continue;
    farCount += bin.n;
    if (!line || bin.n > line.n) line = bin;
  }
  if (!line || farCount < LINE_MIN_SHARE[lineStrength] * opaque) return dominant;
  const lineRgb = binRgb(line);
  return rgbToLab(lineRgb)[0] < field[0] - LINE_MIN_DARKER ? lineRgb : dominant;
}

function addSample(bins: Map<number, Bin>, r: number, g: number, b: number) {
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

/**
 * Picks one colour per cell. Uses the most common colour in the cell rather than the average,
 * so edges stay crisp instead of turning into a muddy in-between. With `lineStrength` above
 * zero, a thin dark line can win a cell it doesn't fill. `samples` is RGBA at w*k by h*k.
 */
export function sampleCells(
  samples: Uint8ClampedArray,
  w: number,
  h: number,
  k: number,
  lineStrength: 0 | 1 | 2 = 0,
): (RGB | null)[] {
  const out: (RGB | null)[] = new Array(w * h);
  const bins = new Map<number, Bin>();
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
          addSample(bins, samples[p], samples[p + 1], samples[p + 2]);
        }
      }
      out[cy * w + cx] = opaque * 2 < k * k ? null : pickColor(bins, opaque, lineStrength);
    }
  }
  return out;
}

/** One colour from a rectangle of source pixels. Null when it is mostly transparent or off the image. */
export function sampleRect(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): RGB | null {
  const bins = new Map<number, Bin>();
  const left = Math.max(0, Math.round(x0));
  const top = Math.max(0, Math.round(y0));
  const right = Math.min(width, Math.max(left + 1, Math.round(x1)));
  const bottom = Math.min(height, Math.max(top + 1, Math.round(y1)));
  let opaque = 0;
  let total = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const p = (y * width + x) * 4;
      total++;
      if (data[p + 3] < 128) continue;
      opaque++;
      addSample(bins, data[p], data[p + 1], data[p + 2]);
    }
  }
  return total === 0 || opaque * 2 < total ? null : pickColor(bins, opaque, 0);
}

/** Nearest bead for each cell. CIE76 shortlists, CIEDE2000 decides, which keeps big grids fast. */
export function matchCells(cells: (RGB | null)[], colors: Bead[], allowed: number[], rich = false): Int16Array {
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
      const lab = rich ? enrich(rgbToLab(c)) : rgbToLab(c);
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

function countColors(cells: Int16Array, skip?: Uint8Array): Map<number, number> {
  const counts = new Map<number, number>();
  cells.forEach((v, i) => {
    if (v !== EMPTY && !skip?.[i]) counts.set(v, (counts.get(v) ?? 0) + 1);
  });
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

/**
 * Keeps at most `max` colours, each time folding the colour whose loss is least visible.
 * Cells in `skip`, such as a background about to be removed, don't count towards the limit.
 */
export function limitColors(cells: Int16Array, colors: Bead[], max: number, skip?: Uint8Array) {
  if (max <= 0) return;
  const counts = countColors(cells, skip);
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

export const isNearWhite = (lab: Lab) => lab[0] > 92 && Math.hypot(lab[1], lab[2]) < 8;
