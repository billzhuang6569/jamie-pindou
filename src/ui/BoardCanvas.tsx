import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import type { PatternDoc } from '../core/doc';
import { EMPTY } from '../core/generate';
import type { Bead } from '../core/palette';
import { BOARD, FONT_FAMILY, INK, YELLOW, paintBeads, paintPattern, rulerLabels, visibleRange } from '../core/render';

export type BoardView = 'beads' | 'pattern';
export type BoardMode = 'view' | 'paint' | 'select';
export type BrushTool = 'brush' | 'pick' | 'erase';
export type BoardHandle = { fit: () => void };

type Viewport = { cell: number; ox: number; oy: number };

const RULER = 24;
const MAX_CELL = 90;
/** Under this many CSS pixels a cell can't hold a readable code. */
const CODE_MIN_CELL = 14;
const OPEN_PATTERN_CELL = 26;

function fitViewport(doc: PatternDoc, view: BoardView, W: number, H: number): Viewport {
  const r = view === 'pattern' ? RULER : 0;
  const pad = view === 'pattern' ? 6 : 2;
  const cell = Math.min((W - r - pad * 2) / doc.w, (H - r - pad * 2) / doc.h);
  return { cell, ox: r + (W - r - cell * doc.w) / 2, oy: r + (H - r - cell * doc.h) / 2 };
}

function clampViewport(v: Viewport, doc: PatternDoc, view: BoardView, W: number, H: number): Viewport {
  const r = view === 'pattern' ? RULER : 0;
  const axis = (o: number, size: number, extent: number) => {
    const avail = extent - r;
    if (size <= avail) return r + (avail - size) / 2;
    return Math.min(r + 16, Math.max(extent - size - 16, o));
  };
  return { cell: v.cell, ox: axis(v.ox, v.cell * doc.w, W), oy: axis(v.oy, v.cell * doc.h, H) };
}

/** Opening the pattern at full size would hide the codes, so it opens on the picture's middle. */
function openPatternViewport(doc: PatternDoc, W: number, H: number): Viewport {
  const fit = fitViewport(doc, 'pattern', W, H);
  if (fit.cell >= CODE_MIN_CELL + 2) return fit;
  let x0 = doc.w;
  let x1 = 0;
  let y0 = doc.h;
  let y1 = 0;
  doc.cells.forEach((v, i) => {
    if (v === EMPTY) return;
    const x = i % doc.w;
    const y = Math.floor(i / doc.w);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  });
  const cx = x1 >= x0 ? (x0 + x1 + 1) / 2 : doc.w / 2;
  const cy = y1 >= y0 ? (y0 + y1 + 1) / 2 : doc.h / 2;
  const cell = OPEN_PATTERN_CELL;
  return clampViewport(
    { cell, ox: RULER + (W - RULER) / 2 - cx * cell, oy: RULER + (H - RULER) / 2 - cy * cell },
    doc,
    'pattern',
    W,
    H,
  );
}

function lineCells(x0: number, y0: number, x1: number, y1: number, visit: (x: number, y: number) => void) {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    visit(x, y);
    if (x === x1 && y === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

export const BoardCanvas = forwardRef<
  BoardHandle,
  {
    doc: PatternDoc;
    colors: Bead[];
    view: BoardView;
    highlight: number | null;
    mode: BoardMode;
    tool: BrushTool;
    brush: number;
    selection: Uint8Array | null;
    onStroke: (cells: Int16Array) => void;
    onPick: (index: number) => void;
    onSelection: (next: Uint8Array) => void;
    onZoomChange: (zoomed: boolean) => void;
  }
>(function BoardCanvas(props, ref) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useRef({ W: 0, H: 0 });
  const viewports = useRef<Partial<Record<BoardView, Viewport>>>({});
  const p = useRef(props);
  p.current = props;

  // Bead view at normal zoom draws from one cached picture, so pinching stays smooth at 128×128.
  const base = useRef<{ canvas: HTMLCanvasElement; cells: Int16Array; highlight: number | null; cell: number } | null>(null);
  const live = useRef<Int16Array | null>(null);
  const liveSel = useRef<Uint8Array | null>(null);
  const frame = useRef(0);

  const viewport = (): Viewport => {
    const { doc, view } = p.current;
    const { W, H } = size.current;
    return (viewports.current[view] ??= view === 'pattern' ? openPatternViewport(doc, W, H) : fitViewport(doc, view, W, H));
  };

  const emitZoom = () => {
    const { doc, view } = p.current;
    const { W, H } = size.current;
    if (!W || !H) return;
    p.current.onZoomChange(viewport().cell > fitViewport(doc, view, W, H).cell * 1.02);
  };

  const draw = useCallback(() => {
    frame.current = 0;
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    const { W, H } = size.current;
    if (!el || !ctx || !W || !H) return;
    const { doc, colors, view, highlight, selection } = p.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const pw = Math.round(W * dpr);
    const ph = Math.round(H * dpr);
    if (el.width !== pw || el.height !== ph) {
      el.width = pw;
      el.height = ph;
    }
    const v = viewport();
    const cell = v.cell * dpr;
    const ox = v.ox * dpr;
    const oy = v.oy * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BOARD;
    ctx.fillRect(0, 0, pw, ph);
    const cells = live.current ?? doc.cells;
    const range = visibleRange(doc.w, doc.h, cell, ox, oy, pw, ph);

    if (view === 'beads') {
      const baseCell = Math.min(24, Math.floor(4096 / Math.max(doc.w, doc.h)));
      if (cell <= baseCell * 1.15) {
        if (!base.current || base.current.cells !== cells || base.current.highlight !== highlight || base.current.cell !== baseCell) {
          const c = base.current?.cell === baseCell ? base.current.canvas : document.createElement('canvas');
          c.width = doc.w * baseCell;
          c.height = doc.h * baseCell;
          const bctx = c.getContext('2d')!;
          bctx.fillStyle = BOARD;
          bctx.fillRect(0, 0, c.width, c.height);
          paintBeads(bctx, cells, doc.w, colors, { x0: 0, y0: 0, x1: doc.w, y1: doc.h }, baseCell, 0, 0, highlight);
          base.current = { canvas: c, cells, highlight, cell: baseCell };
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(base.current.canvas, ox, oy, doc.w * cell, doc.h * cell);
      } else {
        paintBeads(ctx, cells, doc.w, colors, range, cell, ox, oy, highlight);
      }
      return;
    }

    paintPattern(ctx, cells, doc.w, doc.h, colors, range, cell, ox, oy, highlight, v.cell >= CODE_MIN_CELL);

    const sel = liveSel.current ?? selection;
    if (sel) {
      const inset = Math.max(1, Math.round(cell * 0.06));
      for (let y = range.y0; y < range.y1; y++) {
        for (let x = range.x0; x < range.x1; x++) {
          if (!sel[y * doc.w + x]) continue;
          const px = Math.round(ox + x * cell);
          const py = Math.round(oy + y * cell);
          const s = Math.ceil(cell);
          ctx.fillStyle = INK;
          ctx.fillRect(px, py, s, inset);
          ctx.fillRect(px, py + s - inset, s, inset);
          ctx.fillRect(px, py, inset, s);
          ctx.fillRect(px + s - inset, py, inset, s);
          ctx.fillStyle = YELLOW;
          const t = Math.max(1, inset * 2);
          ctx.fillRect(px + inset, py + inset, s - inset * 2, t);
          ctx.fillRect(px + inset, py + s - inset - t, s - inset * 2, t);
          ctx.fillRect(px + inset, py + inset, t, s - inset * 2);
          ctx.fillRect(px + s - inset - t, py + inset, t, s - inset * 2);
        }
      }
    }

    // Rulers stay put while the pattern moves under them.
    const r = RULER * dpr;
    ctx.fillStyle = BOARD;
    ctx.fillRect(0, 0, pw, r);
    ctx.fillRect(0, 0, r, ph);
    ctx.fillStyle = INK;
    ctx.font = `600 ${Math.round(10.5 * dpr)}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (const i of rulerLabels(doc.w, v.cell, 20)) {
      const x = ox + (i + 0.5) * cell;
      if (x > r && x < pw) ctx.fillText(String(i + 1), x, r / 2);
    }
    for (const i of rulerLabels(doc.h, v.cell, 14)) {
      const y = oy + (i + 0.5) * cell;
      if (y > r && y < ph) ctx.fillText(String(i + 1), r / 2, y);
    }
  }, []);

  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // A different grid size means the old zoom and position no longer mean anything.
  useEffect(() => {
    viewports.current = {};
    base.current = null;
    schedule();
  }, [props.doc.w, props.doc.h, schedule]);

  useEffect(() => {
    live.current = null;
    emitZoom();
    schedule();
  }, [props.doc, props.view, props.highlight, props.selection, props.colors, schedule]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (W === size.current.W && H === size.current.H) return;
      const had = size.current.W > 0;
      size.current = { W, H };
      if (had) {
        const { doc } = p.current;
        for (const key of Object.keys(viewports.current) as BoardView[]) {
          const old = viewports.current[key]!;
          viewports.current[key] = clampViewport(old, doc, key, W, H);
        }
      }
      emitZoom();
      draw();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);

  useImperativeHandle(
    ref,
    () => ({
      fit() {
        const { doc, view } = p.current;
        viewports.current[view] = fitViewport(doc, view, size.current.W, size.current.H);
        emitZoom();
        schedule();
      },
    }),
    [schedule],
  );

  const setViewport = (v: Viewport) => {
    const { doc, view } = p.current;
    const { W, H } = size.current;
    const min = fitViewport(doc, view, W, H).cell * 0.9;
    const cell = Math.min(MAX_CELL, Math.max(min, v.cell));
    viewports.current[view] = clampViewport({ ...v, cell }, doc, view, W, H);
    emitZoom();
    schedule();
  };

  const zoomAround = (mx: number, my: number, cell: number, v: Viewport) => {
    const ax = (mx - v.ox) / v.cell;
    const ay = (my - v.oy) / v.cell;
    setViewport({ cell, ox: mx - ax * cell, oy: my - ay * cell });
  };

  type Gesture =
    | { kind: 'pan'; x: number; y: number; start: Viewport }
    | { kind: 'pinch'; dist: number; mx: number; my: number; start: Viewport }
    | { kind: 'stroke'; lastX: number; lastY: number; value: number }
    | { kind: 'select'; lastX: number; lastY: number; add: boolean }
    | null;
  const gesture = useRef<Gesture>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  const local = (e: { clientX: number; clientY: number }) => {
    const b = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  const cellAt = (x: number, y: number) => {
    const v = viewport();
    const { doc } = p.current;
    const cx = Math.floor((x - v.ox) / v.cell);
    const cy = Math.floor((y - v.oy) / v.cell);
    return cx >= 0 && cy >= 0 && cx < doc.w && cy < doc.h ? { cx, cy } : null;
  };

  const beginPinchOrPan = () => {
    const pts = [...pointers.current.values()];
    if (pts.length >= 2) {
      gesture.current = {
        kind: 'pinch',
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        mx: (pts[0].x + pts[1].x) / 2,
        my: (pts[0].y + pts[1].y) / 2,
        start: viewport(),
      };
    } else if (pts.length === 1) {
      gesture.current = { kind: 'pan', x: pts[0].x, y: pts[0].y, start: viewport() };
    } else {
      gesture.current = null;
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const pos = local(e);
    pointers.current.set(e.pointerId, pos);
    if (pointers.current.size >= 2) {
      // A second finger means "move the view": undo whatever the first finger started.
      live.current = null;
      liveSel.current = null;
      beginPinchOrPan();
      schedule();
      return;
    }
    const { mode, tool, brush, doc } = p.current;
    const hit = mode === 'view' ? null : cellAt(pos.x, pos.y);
    if (mode === 'paint' && hit) {
      const index = hit.cy * doc.w + hit.cx;
      if (tool === 'pick') {
        if (doc.cells[index] !== EMPTY) p.current.onPick(doc.cells[index]);
        gesture.current = null;
        return;
      }
      const value = tool === 'erase' ? EMPTY : brush;
      live.current = doc.cells.slice();
      live.current[index] = value;
      gesture.current = { kind: 'stroke', lastX: hit.cx, lastY: hit.cy, value };
      schedule();
      return;
    }
    if (mode === 'select' && hit) {
      const index = hit.cy * doc.w + hit.cx;
      const next = p.current.selection ? p.current.selection.slice() : new Uint8Array(doc.cells.length);
      const add = !next[index];
      next[index] = add ? 1 : 0;
      liveSel.current = next;
      gesture.current = { kind: 'select', lastX: hit.cx, lastY: hit.cy, add };
      schedule();
      return;
    }
    beginPinchOrPan();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const pos = local(e);
    pointers.current.set(e.pointerId, pos);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pan') {
      setViewport({ cell: g.start.cell, ox: g.start.ox + pos.x - g.x, oy: g.start.oy + pos.y - g.y });
    } else if (g.kind === 'pinch') {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return;
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mx = (pts[0].x + pts[1].x) / 2;
      const my = (pts[0].y + pts[1].y) / 2;
      const cell = g.start.cell * (dist / g.dist);
      const ax = (g.mx - g.start.ox) / g.start.cell;
      const ay = (g.my - g.start.oy) / g.start.cell;
      setViewport({ cell, ox: mx - ax * cell, oy: my - ay * cell });
    } else {
      const hit = cellAt(pos.x, pos.y);
      if (!hit) return;
      const w = p.current.doc.w;
      if (g.kind === 'stroke' && live.current) {
        const target = live.current;
        lineCells(g.lastX, g.lastY, hit.cx, hit.cy, (x, y) => {
          target[y * w + x] = g.value;
        });
      } else if (g.kind === 'select' && liveSel.current) {
        const target = liveSel.current;
        lineCells(g.lastX, g.lastY, hit.cx, hit.cy, (x, y) => {
          target[y * w + x] = g.add ? 1 : 0;
        });
      }
      g.lastX = hit.cx;
      g.lastY = hit.cy;
      schedule();
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (e.type === 'pointerup' && g?.kind === 'stroke' && live.current) {
      p.current.onStroke(live.current);
      gesture.current = null;
    } else if (e.type === 'pointerup' && g?.kind === 'select' && liveSel.current) {
      p.current.onSelection(liveSel.current);
      liveSel.current = null;
      gesture.current = null;
    } else if (e.type === 'pointercancel') {
      live.current = null;
      liveSel.current = null;
      beginPinchOrPan();
      schedule();
    } else {
      beginPinchOrPan();
    }
  };

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const pos = local(e);
      const v = viewport();
      zoomAround(pos.x, pos.y, v.cell * Math.exp(-e.deltaY * 0.002), v);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // The handler reads everything it needs through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="board-canvas" ref={wrap}>
      <canvas
        ref={canvas}
        role="img"
        aria-label={props.view === 'pattern' ? '带色号的拼豆图纸，可以缩放和移动' : '拼豆效果图，可以缩放和移动'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  );
});
