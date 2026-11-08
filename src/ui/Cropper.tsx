import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_ZOOM, MIN_ZOOM, placeImage, type Crop } from '../core/image';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** One finger moves the picture, two zoom it; the frame's shape follows the pattern's. */
export function Cropper({
  imageUrl,
  source,
  crop,
  aspect,
  onChange,
}: {
  imageUrl: string;
  source: { width: number; height: number };
  crop: Crop;
  aspect: number;
  onChange: (c: Crop) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(358);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const maxH = boxW;
  const frameH = Math.round(Math.min(maxH, boxW / aspect));
  const frameW = Math.round(Math.min(boxW, frameH * aspect));
  const place = useMemo(() => placeImage(source, crop, frameW, frameH), [source, crop, frameW, frameH]);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ crop: Crop; dist: number; mid: { x: number; y: number } } | null>(null);
  const cropRef = useRef(crop);
  cropRef.current = crop;

  const begin = () => {
    const pts = [...pointers.current.values()];
    const mid = pts.length === 2 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
    const dist = pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    gesture.current = { crop: cropRef.current, dist, mid };
  };

  const onDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    begin();
  };
  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const g = gesture.current;
    const mid = pts.length === 2 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
    const ratio = pts.length === 2 && g.dist > 0 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) / g.dist : 1;
    const zoom = clamp(g.crop.zoom * ratio, MIN_ZOOM, MAX_ZOOM);
    onChange({
      zoom,
      dx: g.crop.dx * (zoom / g.crop.zoom) + (mid.x - g.mid.x) / frameW,
      dy: g.crop.dy * (zoom / g.crop.zoom) + (mid.y - g.mid.y) / frameH,
    });
  };
  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) begin();
    else gesture.current = null;
  };

  const frameRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = cropRef.current;
      const zoom = clamp(c.zoom * Math.exp(-e.deltaY * 0.002), MIN_ZOOM, MAX_ZOOM);
      onChange({ zoom, dx: c.dx * (zoom / c.zoom), dy: c.dy * (zoom / c.zoom) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onChange]);

  return (
    <div className="crop-box" ref={box}>
      <div
        ref={frameRef}
        className="crop-frame"
        style={{ width: frameW, height: frameH }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <img
          src={imageUrl}
          alt="待裁剪的图片"
          draggable={false}
          style={{ left: place.left, top: place.top, width: place.width, height: place.height }}
        />
        <i className="tick tl" />
        <i className="tick tr" />
        <i className="tick bl" />
        <i className="tick br" />
      </div>
    </div>
  );
}
