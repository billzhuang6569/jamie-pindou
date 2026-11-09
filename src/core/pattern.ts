import { rgbToLab, type RGB } from './color';
import { newDoc, toggleBackground, type PatternDoc } from './doc';
import { EMPTY, MERGE_LEVELS, cleanStrays, isNearWhite, limitColors, matchCells, mergeSimilar, sampleCells, sampleRect } from './generate';
import { placeImage, renderCrop, samplesPerCell, type Crop, type SourceImage } from './image';
import { dropSpecks, findBackground, unifyOutline, type OutlineStrength } from './outline';
import { matchableIndexes, type Brand, type Spec } from './palette';
import type { PixelGrid } from './pixelGrid';

export type RatioMode = 'board' | 'image';
export type ImageType = 'auto' | 'pixel' | 'photo';
export type ColorMode = 'auto' | 'natural' | 'rich';

export type Params = {
  ratioMode: RatioMode;
  w: number;
  h: number;
  /** For pixel art: one cell per source pixel, ignoring w and h. */
  follow: boolean;
  imageType: ImageType;
  outline: OutlineStrength;
  color: ColorMode;
  brandId: string;
  spec: Spec;
  mergeLevel: number;
  maxColors: number;
};

export const DEFAULT_PARAMS: Params = {
  ratioMode: 'board',
  w: 52,
  h: 52,
  follow: true,
  imageType: 'auto',
  outline: 1,
  color: 'auto',
  brandId: 'mard',
  spec: 'base',
  mergeLevel: 2,
  maxColors: 0,
};

/** Past this, a detected grid is finer than anything worth beading. */
const MAX_NATIVE_SIDE = 200;
/** Auto background removal needs a mostly white edge and something to actually remove. */
const AUTO_BG_EDGE_SHARE = 0.6;
const AUTO_BG_MIN_AREA = 0.03;

export const treatAsPixelArt = (params: Params, grid: PixelGrid | null): boolean =>
  !!grid && (params.imageType === 'pixel' || (params.imageType === 'auto' && grid.sure));

/** Beads look duller than a screen, which suits pixel art's flat colour more than photos. */
export const usesRichColor = (params: Params, pixelArt: boolean): boolean =>
  params.color === 'rich' || (params.color === 'auto' && pixelArt);

type Sampled = { colors: (RGB | null)[]; w: number; h: number };

/** One colour per source pixel, from its centre where compression blur is least. */
function sampleNative(source: SourceImage, grid: PixelGrid, crop: Crop): Sampled | null {
  const { data, width, height } = source.pixels();
  // Which part of the source the crop frame shows, for a frame shaped like the image.
  const place = placeImage(source, crop, width, height);
  const scale = place.width / width;
  const fromX = -place.left / scale;
  const toX = (width - place.left) / scale;
  const fromY = -place.top / scale;
  const toY = (height - place.top) / scale;

  const starts = (phase: number, period: number, size: number, from: number, to: number) => {
    const out: number[] = [];
    const first = phase - Math.ceil(phase / period) * period;
    for (let v = first; v < size; v += period) {
      const center = v + period / 2;
      if (v + period > 0 && center >= from && center <= to) out.push(v);
    }
    return out;
  };
  const xs = starts(grid.phaseX, grid.px, width, fromX, toX);
  const ys = starts(grid.phaseY, grid.py, height, fromY, toY);
  if (xs.length === 0 || ys.length === 0 || xs.length > MAX_NATIVE_SIDE * 4 || ys.length > MAX_NATIVE_SIDE * 4) return null;

  const inset = grid.px >= 4 ? 0.25 : 0;
  const colors: (RGB | null)[] = new Array(xs.length * ys.length);
  ys.forEach((y, j) => {
    xs.forEach((x, i) => {
      colors[j * xs.length + i] = sampleRect(
        data,
        width,
        height,
        x + grid.px * inset,
        y + grid.py * inset,
        x + grid.px * (1 - inset),
        y + grid.py * (1 - inset),
      );
    });
  });
  return { colors, w: xs.length, h: ys.length };
}

function paleMask(colors: (RGB | null)[]): Uint8Array {
  const out = new Uint8Array(colors.length);
  colors.forEach((c, i) => {
    out[i] = !c || isNearWhite(rgbToLab(c)) ? 1 : 0;
  });
  return out;
}

type Bounds = { x0: number; y0: number; x1: number; y1: number };

function subjectBounds(bg: Uint8Array, w: number, h: number): Bounds | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let i = 0; i < bg.length; i++) {
    if (bg[i]) continue;
    const x = i % w;
    const y = Math.floor(i / w);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

function cropArray<T extends Int16Array | Uint8Array>(src: T, w: number, b: Bounds): T {
  const nw = b.x1 - b.x0;
  const out = src.slice(0, nw * (b.y1 - b.y0)) as T;
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) out[(y - b.y0) * nw + (x - b.x0)] = src[y * w + x];
  }
  return out;
}

/** The size following the picture's own grid would give, after trimming the empty margin. */
export function measureNative(source: SourceImage, grid: PixelGrid, crop: Crop, outline: OutlineStrength): { w: number; h: number } | null {
  const sampled = sampleNative(source, grid, crop);
  if (!sampled) return null;
  const bg = dropSpecks(findBackground(paleMask(sampled.colors), sampled.w, sampled.h, outline), sampled.w, sampled.h);
  const bounds = subjectBounds(bg, sampled.w, sampled.h);
  const size = bounds ? { w: bounds.x1 - bounds.x0, h: bounds.y1 - bounds.y0 } : { w: sampled.w, h: sampled.h };
  return Math.max(size.w, size.h) > MAX_NATIVE_SIDE ? null : size;
}

/** The subject's box in source pixels, or null when it already fills the picture. */
export type SubjectBox = { x0: number; y0: number; x1: number; y1: number };
const SUBJECT_GRID_SIDE = 96;
const SUBJECT_MARGIN = 1.04;

export function findSubjectBox(source: SourceImage): SubjectBox | null {
  const { data, width, height } = source.pixels();
  const cell = Math.max(1, Math.max(width, height) / SUBJECT_GRID_SIDE);
  const w = Math.max(1, Math.round(width / cell));
  const h = Math.max(1, Math.round(height / cell));
  const colors: (RGB | null)[] = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      colors[y * w + x] = sampleRect(data, width, height, (x * width) / w, (y * height) / h, ((x + 1) * width) / w, ((y + 1) * height) / h);
    }
  }
  const bg = dropSpecks(findBackground(paleMask(colors), w, h, 1), w, h);
  const b = subjectBounds(bg, w, h);
  if (!b) return null;
  if ((b.x1 - b.x0) / w > 0.92 && (b.y1 - b.y0) / h > 0.92) return null;
  return { x0: (b.x0 * width) / w, y0: (b.y0 * height) / h, x1: (b.x1 * width) / w, y1: (b.y1 * height) / h };
}

/** A crop that fills a frame of this shape with the subject. */
export function fitCropToSubject(source: { width: number; height: number }, box: SubjectBox, aspect: number): Crop {
  const frameW = aspect;
  const frameH = 1;
  const contain = Math.min(frameW / source.width, frameH / source.height);
  const fit = Math.min(frameW / ((box.x1 - box.x0) * SUBJECT_MARGIN), frameH / ((box.y1 - box.y0) * SUBJECT_MARGIN));
  return {
    zoom: Math.max(1, fit / contain),
    dx: ((source.width / 2 - (box.x0 + box.x1) / 2) * fit) / frameW,
    dy: ((source.height / 2 - (box.y0 + box.y1) / 2) * fit) / frameH,
  };
}

export type BuildInput = {
  source: SourceImage;
  grid: PixelGrid | null;
  crop: Crop;
  params: Params;
  brand: Brand;
  myColors: readonly string[];
};

/** Turns a picture and settings into a finished pattern. */
export function buildPattern({ source, grid, crop, params, brand, myColors }: BuildInput): PatternDoc {
  const colorsList = brand.colors;
  const pixelArt = treatAsPixelArt(params, grid);
  const rich = usesRichColor(params, pixelArt);
  const threshold = MERGE_LEVELS[params.mergeLevel].threshold;

  let sampled: Sampled | null = null;
  let native = false;
  if (pixelArt && params.follow && measureNative(source, grid!, crop, params.outline)) {
    sampled = sampleNative(source, grid!, crop);
    native = sampled !== null;
  }
  if (!sampled) {
    const { w, h } = params;
    const k = samplesPerCell(w, h, source.width, source.height);
    const samples = renderCrop(source, crop, w * k, h * k).getContext('2d')!.getImageData(0, 0, w * k, h * k).data;
    sampled = { colors: sampleCells(samples, w, h, k, params.outline), w, h };
  }

  const { colors, w, h } = sampled;
  let cells = matchCells(colors, colorsList, matchableIndexes(brand, params.spec, myColors), rich);
  mergeSimilar(cells, colorsList, threshold);
  cleanStrays(cells, w, h, colorsList, threshold);

  // Whiteness is judged on the original colours, so that darkening can't turn background into subject.
  const pale = paleMask(colors);
  let bg = dropSpecks(findBackground(pale, w, h, params.outline), w, h);
  unifyOutline(cells, bg, w, h, colorsList, params.outline);
  limitColors(cells, colorsList, params.maxColors, bg);
  // Decided before trimming, while the white margin is still there to be seen.
  const removeBackground = shouldRemoveBackground(colors, pale, bg, w, h);

  let outW = w;
  let outH = h;
  if (native) {
    const bounds = subjectBounds(bg, w, h);
    if (bounds) {
      cells = cropArray(cells, w, bounds);
      bg = cropArray(bg, w, bounds);
      outW = bounds.x1 - bounds.x0;
      outH = bounds.y1 - bounds.y0;
    }
  }

  const doc = newDoc(outW, outH, cells, bg);
  return removeBackground ? toggleBackground(doc, colorsList) : doc;
}

/**
 * Removing the background by default is right only when the picture clearly has a white one.
 * Empty cells, such as the bars around a wide photo in a square frame, say nothing either way.
 */
function shouldRemoveBackground(colors: (RGB | null)[], pale: Uint8Array, bg: Uint8Array, w: number, h: number): boolean {
  let edge = 0;
  let edgeWhite = 0;
  let white = 0;
  for (let i = 0; i < pale.length; i++) {
    if (!colors[i]) continue;
    if (bg[i] && pale[i]) white++;
    const x = i % w;
    const y = Math.floor(i / w);
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
      edge++;
      if (pale[i]) edgeWhite++;
    }
  }
  return edge > 0 && edgeWhite / edge >= AUTO_BG_EDGE_SHARE && white / pale.length >= AUTO_BG_MIN_AREA;
}

export const countCells = (cells: Int16Array) => cells.reduce((n, v) => n + (v === EMPTY ? 0 : 1), 0);
