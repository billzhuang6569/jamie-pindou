import { rgbCss, textOn, type RGB } from './color';
import { beadTotal, colorCounts, type PatternDoc } from './doc';
import { EMPTY } from './generate';
import type { Bead } from './palette';

export const INK = '#361B50';
export const INK2 = '#5F4F77';
export const BOARD = '#F7F5FC';
export const YELLOW = '#FFE953';
const PEG = '#D8D2E8';
const LINE_THIN = '#D6D0E2';
export const FONT_FAMILY = "Rubik, 'PingFang SC', 'Noto Sans SC', system-ui, sans-serif";

const mix = ([r, g, b]: RGB, [r2, g2, b2]: RGB, t: number) =>
  `rgb(${Math.round(r + (r2 - r) * t)} ${Math.round(g + (g2 - g) * t)} ${Math.round(b + (b2 - b) * t)})`;
const BOARD_RGB: RGB = [247, 245, 252];
const WHITE_RGB: RGB = [255, 255, 255];

export type Rect = { x0: number; y0: number; x1: number; y1: number };

export function visibleRange(w: number, h: number, cell: number, ox: number, oy: number, vw: number, vh: number): Rect {
  return {
    x0: Math.max(0, Math.floor(-ox / cell)),
    y0: Math.max(0, Math.floor(-oy / cell)),
    x1: Math.min(w, Math.ceil((vw - ox) / cell)),
    y1: Math.min(h, Math.ceil((vh - oy) / cell)),
  };
}

/**
 * Round beads with a hole, as they look on the board. Grouped by colour so one
 * path fill covers many beads. All arguments are in canvas pixels.
 */
export function paintBeads(
  ctx: CanvasRenderingContext2D,
  cells: Int16Array,
  w: number,
  colors: Bead[],
  { x0, y0, x1, y1 }: Rect,
  cell: number,
  ox: number,
  oy: number,
  highlight: number | null,
) {
  const groups = new Map<number, number[]>();
  const pegs: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = cells[y * w + x];
      if (v === EMPTY) {
        pegs.push(x, y);
        continue;
      }
      let g = groups.get(v);
      if (!g) groups.set(v, (g = []));
      g.push(x, y);
    }
  }
  if (cell >= 5) {
    ctx.fillStyle = PEG;
    ctx.beginPath();
    const r = Math.max(0.5, cell * 0.075);
    for (let i = 0; i < pegs.length; i += 2) {
      const cx = ox + (pegs[i] + 0.5) * cell;
      const cy = oy + (pegs[i + 1] + 0.5) * cell;
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  for (const [index, list] of groups) {
    const { rgb } = colors[index];
    const dim = highlight !== null && index !== highlight;
    const fill = dim ? mix(rgb, BOARD_RGB, 0.84) : rgbCss(rgb);
    if (cell < 3) {
      ctx.fillStyle = fill;
      for (let i = 0; i < list.length; i += 2) {
        ctx.fillRect(ox + list[i] * cell, oy + list[i + 1] * cell, Math.ceil(cell), Math.ceil(cell));
      }
      continue;
    }
    const r = cell * 0.485;
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (let i = 0; i < list.length; i += 2) {
      const cx = ox + (list[i] + 0.5) * cell;
      const cy = oy + (list[i + 1] + 0.5) * cell;
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
    }
    ctx.fill();
    const hole = cell * 0.15;
    ctx.fillStyle = dim ? mix(rgb, BOARD_RGB, 0.76) : mix(rgb, [0, 0, 0], 0.32);
    ctx.beginPath();
    for (let i = 0; i < list.length; i += 2) {
      const cx = ox + (list[i] + 0.5) * cell;
      const cy = oy + (list[i + 1] + 0.5) * cell;
      ctx.moveTo(cx + hole, cy);
      ctx.arc(cx, cy, hole, 0, Math.PI * 2);
    }
    ctx.fill();
  }
}

/** Scales a code's type down when it would overflow its cell. */
const codeFontPx = (cell: number, code: string) => Math.min(cell * 0.36, (cell * 0.9) / (code.length * 0.62));

/** The working pattern: flat cells, codes when there's room, thin grid, bold line every 5. */
export function paintPattern(
  ctx: CanvasRenderingContext2D,
  cells: Int16Array,
  w: number,
  h: number,
  colors: Bead[],
  { x0, y0, x1, y1 }: Rect,
  cell: number,
  ox: number,
  oy: number,
  highlight: number | null,
  showCodes: boolean,
  fontScale = 1,
) {
  const px = (x: number) => Math.round(ox + x * cell);
  const py = (y: number) => Math.round(oy + y * cell);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(px(x0), py(y0), px(x1) - px(x0), py(y1) - py(y0));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = cells[y * w + x];
      if (v === EMPTY) continue;
      const dim = highlight !== null && v !== highlight;
      ctx.fillStyle = dim ? mix(colors[v].rgb, WHITE_RGB, 0.86) : rgbCss(colors[v].rgb);
      ctx.fillRect(px(x), py(y), px(x + 1) - px(x), py(y + 1) - py(y));
    }
  }
  if (showCodes) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let lastFont = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const v = cells[y * w + x];
        if (v === EMPTY) continue;
        const { code, lab } = colors[v];
        const size = Math.round(codeFontPx(cell, code) * fontScale * 2) / 2;
        if (size !== lastFont) {
          ctx.font = `600 ${size}px ${FONT_FAMILY}`;
          lastFont = size;
        }
        ctx.fillStyle = highlight !== null && v !== highlight ? '#968EA4' : textOn(lab);
        ctx.fillText(code, ox + (x + 0.5) * cell, oy + (y + 0.5) * cell + cell * 0.02);
      }
    }
  }
  const thin = Math.max(1, Math.round(cell / 40));
  const bold = Math.max(thin + 1, Math.round(cell / 14));
  if (cell >= 4) {
    ctx.fillStyle = LINE_THIN;
    for (let x = x0; x <= x1; x++) if (x % 5 !== 0) ctx.fillRect(px(x), py(y0), thin, py(y1) - py(y0));
    for (let y = y0; y <= y1; y++) if (y % 5 !== 0) ctx.fillRect(px(x0), py(y), px(x1) - px(x0), thin);
  }
  ctx.fillStyle = INK;
  const stepX = cell < 3 ? 10 : 5;
  for (let x = x0; x <= x1; x++) if (x % stepX === 0 || x === w) ctx.fillRect(px(x) - (bold >> 1), py(y0), bold, py(y1) - py(y0));
  for (let y = y0; y <= y1; y++) if (y % stepX === 0 || y === h) ctx.fillRect(px(x0), py(y) - (bold >> 1), px(x1) - px(x0), bold);
}

/** Row and column numbers: 1, 6, 11... and the last one, skipping any that would collide. */
export function rulerLabels(n: number, cell: number, minGap: number): number[] {
  const step = cell * 5 >= minGap ? 5 : cell * 10 >= minGap ? 10 : 20;
  const out: number[] = [];
  for (let i = 0; i < n; i += step) out.push(i);
  const last = n - 1;
  const prev = out[out.length - 1];
  if (prev !== last) {
    if ((last - prev) * cell < minGap * 0.9 && out.length > 1) out.pop();
    out.push(last);
  }
  return out;
}

export type SheetMeta = { brand: string };

/** The largest canvas every phone browser we care about will still draw reliably. */
const MAX_SIDE = 4096;
const MAX_AREA = 16_000_000;

function layoutSheet(doc: PatternDoc, colorCount: number, cell: number) {
  const pad = Math.round(Math.max(28, cell));
  const ruler = Math.round(Math.max(40, cell * 1.3));
  const gridW = doc.w * cell;
  const gridH = doc.h * cell;
  const legendGap = 30;
  const metaH = 44;
  const rowH = 44;
  const colW = 196;
  const width = pad * 2 + ruler + Math.max(gridW, colW * 3);
  const cols = Math.max(1, Math.floor((width - pad * 2 - ruler) / colW));
  const rows = Math.ceil(colorCount / cols);
  const height = pad * 2 + ruler + gridH + legendGap + metaH + rows * rowH;
  return { pad, ruler, gridW, gridH, legendGap, metaH, rowH, colW, cols, width, height };
}

/** Sizes the cells so the sheet stays sharp but never exceeds what a phone can draw. */
export function sheetCellSize(doc: PatternDoc, colorCount: number): number {
  let cell = Math.min(56, Math.max(30, Math.floor(1900 / Math.max(doc.w, doc.h))));
  while (cell > 8) {
    const { width, height } = layoutSheet(doc, colorCount, cell);
    if (width <= MAX_SIDE && height <= MAX_SIDE && width * height <= MAX_AREA) break;
    cell--;
  }
  return cell;
}

/** The sheet a person prints or keeps on their phone and beads from. */
export function renderSheet(doc: PatternDoc, colors: Bead[], meta: SheetMeta): HTMLCanvasElement {
  const counts = colorCounts(doc.cells);
  const cell = sheetCellSize(doc, counts.length);
  const L = layoutSheet(doc, counts.length, cell);
  const canvas = document.createElement('canvas');
  canvas.width = L.width;
  canvas.height = L.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, L.width, L.height);
  const gx = L.pad + L.ruler;
  const gy = L.pad + L.ruler;
  paintPattern(ctx, doc.cells, doc.w, doc.h, colors, { x0: 0, y0: 0, x1: doc.w, y1: doc.h }, cell, gx, gy, null, true);

  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(L.ruler * 0.42)}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  for (const i of rulerLabels(doc.w, cell, L.ruler * 0.9)) ctx.fillText(String(i + 1), gx + (i + 0.5) * cell, L.pad + L.ruler * 0.5);
  ctx.textAlign = 'right';
  for (const i of rulerLabels(doc.h, cell, L.ruler * 0.5)) ctx.fillText(String(i + 1), gx - 10, gy + (i + 0.5) * cell);

  const total = beadTotal(counts);
  const legendX = gx;
  let y = gy + L.gridH + L.legendGap + L.metaH / 2 - 6;
  const parts = [`${doc.w} × ${doc.h}`, meta.brand, `共 ${total} 颗`, `${counts.length} 种颜色`];
  if (doc.mirrored) parts.push('已左右镜像');
  ctx.textAlign = 'left';
  ctx.fillStyle = INK;
  ctx.font = `600 26px ${FONT_FAMILY}`;
  ctx.fillText(parts.join(' · '), legendX, y);
  ctx.textAlign = 'right';
  ctx.fillStyle = INK2;
  ctx.font = `500 20px ${FONT_FAMILY}`;
  ctx.fillText('Jamie的拼豆台', gx + Math.max(L.gridW, L.colW * L.cols), y);
  y = gy + L.gridH + L.legendGap + L.metaH;
  ctx.textAlign = 'left';
  counts.forEach(({ index, count }, n) => {
    const x = legendX + (n % L.cols) * L.colW;
    const top = y + Math.floor(n / L.cols) * L.rowH;
    const c = colors[index];
    ctx.fillStyle = rgbCss(c.rgb);
    ctx.fillRect(x, top, 32, 32);
    ctx.strokeStyle = '#BEB8CC';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, top + 0.5, 31, 31);
    ctx.fillStyle = INK;
    ctx.font = `600 22px ${FONT_FAMILY}`;
    ctx.fillText(c.code, x + 42, top + 17);
    const codeW = ctx.measureText(c.code).width;
    ctx.fillStyle = INK2;
    ctx.font = `400 20px ${FONT_FAMILY}`;
    ctx.fillText(`${count} 颗`, x + 42 + Math.max(codeW + 10, 62), top + 17);
  });
  return canvas;
}
