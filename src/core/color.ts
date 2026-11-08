export type RGB = readonly [number, number, number];
export type Lab = readonly [number, number, number];

const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** sRGB to CIE Lab under D65. */
export function rgbToLab([r, g, b]: RGB): Lab {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047);
  const y = f(0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb);
  const z = f((0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const DEG = Math.PI / 180;
const POW25_7 = 25 ** 7;

/** CIEDE2000 colour difference. Roughly: under 2 looks identical, over 10 looks clearly different. */
export function deltaE2000(a: Lab, b: Lab): number {
  const [L1, a1, b1] = a;
  const [L2, a2, b2] = b;
  const Cbar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const Cbar7 = Cbar ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + POW25_7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (y: number, x: number) => {
    if (x === 0 && y === 0) return 0;
    const h = Math.atan2(y, x) / DEG;
    return h < 0 ? h + 360 : h;
  };
  const h1 = hue(b1, a1p);
  const h2 = hue(b2, a2p);
  const dL = L2 - L1;
  const dC = C2p - C1p;
  const chromaless = C1p * C2p === 0;
  let dh = h2 - h1;
  if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  if (chromaless) dh = 0;
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh / 2) * DEG);
  const Lm = (L1 + L2) / 2;
  const Cm = (C1p + C2p) / 2;
  let hm = h1 + h2;
  if (!chromaless) {
    if (Math.abs(h1 - h2) <= 180) hm /= 2;
    else hm = hm < 360 ? (hm + 360) / 2 : (hm - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hm - 30) * DEG) +
    0.24 * Math.cos(2 * hm * DEG) +
    0.32 * Math.cos((3 * hm + 6) * DEG) -
    0.2 * Math.cos((4 * hm - 63) * DEG);
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Cm7 = Cm ** 7;
  const Rc = 2 * Math.sqrt(Cm7 / (Cm7 + POW25_7));
  const LmOff = (Lm - 50) ** 2;
  const Sl = 1 + (0.015 * LmOff) / Math.sqrt(20 + LmOff);
  const Sc = 1 + 0.045 * Cm;
  const Sh = 1 + 0.015 * Cm * T;
  const Rt = -Math.sin(2 * dTheta * DEG) * Rc;
  const tL = dL / Sl;
  const tC = dC / Sc;
  const tH = dH / Sh;
  return Math.sqrt(tL * tL + tC * tC + tH * tH + Rt * tC * tH);
}

export const rgbCss = ([r, g, b]: RGB) => `rgb(${r} ${g} ${b})`;

/** Dark text on light beads, white on dark ones. */
export const textOn = (lab: Lab) => (lab[0] < 58 ? '#FFFFFF' : '#180C24');
