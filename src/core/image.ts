const MAX_SOURCE_SIDE = 2048;

export type SourceImage = { canvas: HTMLCanvasElement; width: number; height: number };

async function decode(blob: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Some browsers can only decode certain formats through an <img>.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Decodes a picked file and caps its size, so a 50-megapixel photo can't exhaust a phone. */
export async function loadSource(blob: Blob): Promise<SourceImage> {
  const img = await decode(blob);
  if (!img.width || !img.height) throw new Error('empty image');
  const s = Math.min(1, MAX_SOURCE_SIDE / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * s));
  const height = Math.max(1, Math.round(img.height * s));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  if ('close' in img && typeof img.close === 'function') img.close();
  return { canvas, width, height };
}

/** How the picture sits in the frame. zoom 1 shows it whole; dx, dy shift it in frame widths and heights. */
export type Crop = { zoom: number; dx: number; dy: number };
export const INITIAL_CROP: Crop = { zoom: 1, dx: 0, dy: 0 };
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 12;

/** Where the picture lands inside a frame of the given size. */
export function placeImage(source: { width: number; height: number }, crop: Crop, frameW: number, frameH: number) {
  const scale = Math.min(frameW / source.width, frameH / source.height) * crop.zoom;
  const width = source.width * scale;
  const height = source.height * scale;
  return {
    width,
    height,
    left: frameW / 2 + crop.dx * frameW - width / 2,
    top: frameH / 2 + crop.dy * frameH - height / 2,
  };
}

/** Draws the frame's contents at the given size. Anything outside the picture stays transparent. */
export function renderCrop(source: SourceImage, crop: Crop, outW: number, outH: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas unavailable');
  const { left, top, width, height } = placeImage(source, crop, outW, outH);
  // Blocky pixel art must stay blocky when enlarged; photos need smoothing when reduced.
  ctx.imageSmoothingEnabled = width < source.width;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source.canvas, left, top, width, height);
  return canvas;
}

/** Samples per cell side: high enough to see a cell's dominant colour, capped for huge grids. */
export const samplesPerCell = (w: number, h: number) => Math.max(2, Math.min(10, Math.floor(1200 / Math.max(w, h))));

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode image'))), type, quality);
  });
}
