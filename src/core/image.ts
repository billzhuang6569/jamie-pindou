const MAX_SOURCE_SIDE = 2048;
const MAX_SAMPLES_PER_CELL = 16;
const MAX_SAMPLE_SIDE = 2400;

export type SourceImage = {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** The decoded pixels, read once and kept. */
  pixels: () => { data: Uint8ClampedArray; width: number; height: number };
};

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
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  if ('close' in img && typeof img.close === 'function') img.close();
  let cached: Uint8ClampedArray | null = null;
  return {
    canvas,
    width,
    height,
    pixels: () => {
      cached ??= ctx.getImageData(0, 0, width, height).data;
      return { data: cached, width, height };
    },
  };
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

/**
 * Draws the frame's contents at the given size, unsmoothed by default. Blending would mix a thin
 * line into its background before anyone could tell them apart. Outside the picture stays transparent.
 */
export function renderCrop(source: SourceImage, crop: Crop, outW: number, outH: number, smooth = false): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas unavailable');
  const { left, top, width, height } = placeImage(source, crop, outW, outH);
  ctx.imageSmoothingEnabled = smooth;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source.canvas, left, top, width, height);
  return canvas;
}

/** Samples per cell side: about one per source pixel, so a thin line is seen, capped for big grids. */
export function samplesPerCell(w: number, h: number, sourceW: number, sourceH: number): number {
  const perCell = Math.ceil(Math.max(sourceW / w, sourceH / h));
  const fits = Math.floor(MAX_SAMPLE_SIDE / Math.max(w, h));
  return Math.max(2, Math.min(MAX_SAMPLES_PER_CELL, perCell, fits));
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode image'))), type, quality);
  });
}
