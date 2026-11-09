/** A picture's own pixel grid: where one "pixel" of pixel art starts and how wide it is. */
export type PixelGrid = {
  px: number;
  py: number;
  phaseX: number;
  phaseY: number;
  /** 0 to 1: how much of the picture's edge energy falls on this grid. */
  confidence: number;
  /** Trust it enough to act without being asked. */
  sure: boolean;
};

export type Pixels = { data: Uint8ClampedArray; width: number; height: number };

const MIN_PERIOD = 6;
const SURE_CONFIDENCE = 0.55;
const MAX_AXIS_MISMATCH = 0.04;
/** Periods this close to the best score count as ties; the largest of them is the real grid. */
const TIE = 0.04;

/** Per-position colour change along one axis, with transparent pixels treated as white. */
function edgeProfile({ data, width, height }: Pixels, axis: 'x' | 'y'): Float64Array {
  const n = axis === 'x' ? width - 1 : height - 1;
  const out = new Float64Array(Math.max(0, n));
  const step = axis === 'x' ? 4 : width * 4;
  const value = (i: number, c: number) => (data[i + 3] < 128 ? 255 : data[i + c]);
  // Every second row or column is plenty to find a grid, and halves the work on large photos.
  const stride = 2;
  if (axis === 'x') {
    for (let y = 0; y < height; y += stride) {
      for (let x = 0; x < width - 1; x++) {
        const i = (y * width + x) * 4;
        out[x] += Math.abs(value(i, 0) - value(i + step, 0)) + Math.abs(value(i, 1) - value(i + step, 1)) + Math.abs(value(i, 2) - value(i + step, 2));
      }
    }
  } else {
    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width; x += stride) {
        const i = (y * width + x) * 4;
        out[y] += Math.abs(value(i, 0) - value(i + step, 0)) + Math.abs(value(i, 1) - value(i + step, 1)) + Math.abs(value(i, 2) - value(i + step, 2));
      }
    }
  }
  return out;
}

/** Strong edges, with sub-pixel positions, since real grids are rarely whole numbers. */
function edgePeaks(g: Float64Array): { pos: number; weight: number }[] {
  if (g.length < 3) return [];
  const sorted = Float64Array.from(g).sort();
  const threshold = Math.max(sorted[Math.floor(sorted.length * 0.9)], sorted[sorted.length - 1] * 0.08);
  const peaks: { pos: number; weight: number }[] = [];
  for (let i = 1; i < g.length - 1; i++) {
    if (g[i] >= threshold && g[i] >= g[i - 1] && g[i] > g[i + 1]) {
      const denominator = g[i - 1] - 2 * g[i] + g[i + 1];
      const offset = denominator ? (0.5 * (g[i - 1] - g[i + 1])) / denominator : 0;
      // Index i is the boundary between pixels i and i + 1.
      peaks.push({ pos: i + 1 + offset, weight: Math.sqrt(g[i]) });
    }
  }
  return peaks;
}

/** Finds the period whose evenly spaced teeth catch the most edge energy. */
function fitPeriod(peaks: { pos: number; weight: number }[], size: number) {
  if (peaks.length < 6) return null;
  const total = peaks.reduce((sum, p) => sum + p.weight, 0);
  const scores: { score: number; period: number; phase: number }[] = [];
  for (let period = MIN_PERIOD; period < size / 8; period += 0.02) {
    const tolerance = Math.max(1, 0.07 * period);
    const chance = Math.min(0.95, (2 * tolerance) / period);
    let re = 0;
    let im = 0;
    for (const p of peaks) {
      const angle = (2 * Math.PI * p.pos) / period;
      re += p.weight * Math.cos(angle);
      im += p.weight * Math.sin(angle);
    }
    const center = (Math.atan2(im, re) / (2 * Math.PI)) * period;
    let hit = 0;
    for (const p of peaks) {
      const d = ((p.pos - center) % period + period * 1.5) % period - period / 2;
      if (Math.abs(d) <= tolerance) hit += p.weight;
    }
    scores.push({ score: (hit / total - chance) / (1 - chance), period, phase: ((center % period) + period) % period });
  }
  if (scores.length === 0) return null;
  const top = Math.max(...scores.map((s) => s.score));
  // A half period explains every edge too, so the true grid is the largest period that fits.
  return scores.filter((s) => s.score >= top - TIE).reduce((a, b) => (b.period > a.period ? b : a));
}

/** Small periods drown in compression noise, but crisp art can be checked block by block. */
function crispBlockSize({ data, width, height }: Pixels): number | null {
  for (const p of [5, 4, 3, 2]) {
    if (width % p !== 0 || height % p !== 0) continue;
    let same = 0;
    let total = 0;
    for (let y = 0; y < height; y++) {
      const by = y - (y % p);
      for (let x = 0; x < width; x++) {
        const bx = x - (x % p);
        const i = (y * width + x) * 4;
        const b = (by * width + bx) * 4;
        total++;
        if (data[i] === data[b] && data[i + 1] === data[b + 1] && data[i + 2] === data[b + 2] && data[i + 3] === data[b + 3]) same++;
      }
    }
    if (same / total >= 0.985) return p;
  }
  return null;
}

/** A tiny image with few colours is pixel art at one pixel per bead. */
function isTinyArt({ data, width, height }: Pixels): boolean {
  if (Math.max(width, height) > 200) return false;
  const seen = new Set<number>();
  for (let i = 0; i < data.length; i += 4) {
    seen.add((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | (data[i + 3] >> 7));
    if (seen.size > 256) return false;
  }
  return true;
}

/** Looks for a pixel grid. Returns the best guess even when unsure, or null if there is none. */
export function detectPixelGrid(image: Pixels): PixelGrid | null {
  if (isTinyArt(image)) return { px: 1, py: 1, phaseX: 0, phaseY: 0, confidence: 1, sure: true };
  const block = crispBlockSize(image);
  if (block) return { px: block, py: block, phaseX: 0, phaseY: 0, confidence: 1, sure: true };
  const fx = fitPeriod(edgePeaks(edgeProfile(image, 'x')), image.width);
  const fy = fitPeriod(edgePeaks(edgeProfile(image, 'y')), image.height);
  if (!fx || !fy) return null;
  const confidence = Math.min(fx.score, fy.score);
  const mismatch = Math.abs(fx.period - fy.period) / Math.max(fx.period, fy.period);
  return {
    px: fx.period,
    py: fy.period,
    phaseX: fx.phase,
    phaseY: fy.phase,
    confidence,
    sure: confidence > SURE_CONFIDENCE && mismatch < MAX_AXIS_MISMATCH,
  };
}
