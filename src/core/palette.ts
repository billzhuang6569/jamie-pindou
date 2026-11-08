import data from '../data/palettes.json';
import { rgbToLab, type Lab, type RGB } from './color';

export type Bead = {
  code: string;
  name?: string;
  rgb: RGB;
  lab: Lab;
  /** May the generator pick this bead on its own? False for transparent, neon and the like. */
  auto: boolean;
  /** Part of the brand's 221-colour base set. */
  base: boolean;
};

export type Brand = {
  id: string;
  name: string;
  colors: Bead[];
  baseCount: number;
  /** A brand with one set of colours has no 221/291 choice. */
  hasSpecs: boolean;
};

type RawBrand = {
  id: string;
  name: string;
  colors: { code: string; name?: string; rgb: number[]; auto: boolean; base: boolean }[];
};

export const BRANDS: Brand[] = (data.brands as RawBrand[]).map((b) => {
  const colors: Bead[] = b.colors.map((c) => {
    const rgb = c.rgb as unknown as RGB;
    return { code: c.code, name: c.name, rgb, lab: rgbToLab(rgb), auto: c.auto, base: c.base };
  });
  const baseCount = colors.filter((c) => c.base).length;
  return { id: b.id, name: b.name, colors, baseCount, hasSpecs: baseCount < colors.length };
});

export const brandById = (id: string): Brand => BRANDS.find((b) => b.id === id) ?? BRANDS[0];

export type Spec = 'base' | 'full';

/** Indexes into brand.colors that the generator may use. */
export function matchableIndexes(brand: Brand, spec: Spec, myCodes: readonly string[] = []): number[] {
  const mine = new Set(myCodes);
  const out: number[] = [];
  brand.colors.forEach((c, i) => {
    if (mine.size > 0) {
      if (mine.has(c.code)) out.push(i);
    } else if (c.auto && (spec === 'full' || !brand.hasSpecs || c.base)) {
      out.push(i);
    }
  });
  return out;
}

/** Colour-picker groups: the letter prefix where a brand has one, else ranges of 50. */
export function seriesOf(code: string): string {
  const letters = code.match(/^[A-Za-z]+/);
  if (letters) return letters[0].toUpperCase();
  const n = Number.parseInt(code, 10);
  if (Number.isNaN(n)) return '其他';
  const start = Math.floor((n - 1) / 50) * 50 + 1;
  return `${start}–${start + 49}`;
}

export function seriesList(brand: Brand): string[] {
  const seen: string[] = [];
  for (const c of brand.colors) {
    const s = seriesOf(c.code);
    if (!seen.includes(s)) seen.push(s);
  }
  return seen;
}
