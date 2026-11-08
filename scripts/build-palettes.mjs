// Builds src/data/palettes.json from the pinned files in data/sources.
// See data/sources/README.md for where each file comes from and its license.
import { readFileSync, writeFileSync } from 'node:fs';

const src = (name) => new URL(`../data/sources/${name}`, import.meta.url);

function readCsv(name) {
  return readFileSync(src(name), 'utf8')
    .trim()
    .split('\n')
    .map((line) => line.split(','))
    .map(([code, label, r, g, b]) => ({ code, label, rgb: [Number(r), Number(g), Number(b)] }));
}

// Beads whose real look a screen colour can't stand in for: usable by hand, never auto-matched.
const SPECIAL = /\b(transparent|clear|neon|glow|glitter|metallic)\b/i;
// H1 is MARD's transparent bead.
const MARD_TRANSPARENT = 'H1';
const isBaseSeries = (code) => /^[A-HM]\d+$/.test(code);

function sortByCode(colors) {
  const key = (code) => {
    const m = code.match(/^([A-Za-z-]*)(\d+)(.*)$/);
    return m ? [m[1], Number(m[2]), m[3]] : [code, 0, ''];
  };
  return [...colors].sort((a, b) => {
    const [as, an, at] = key(a.code);
    const [bs, bn, bt] = key(b.code);
    return as.localeCompare(bs) || an - bn || at.localeCompare(bt);
  });
}

const mard = readCsv('mard.csv');
const mardByCode = new Map(mard.map((c) => [c.code, c]));
const mapping = JSON.parse(readFileSync(src('colorSystemMapping.json'), 'utf8'));
const normalizeMard = (code) => code.replace(/^([A-Z]+)0*(\d+)$/, '$1$2');

const brands = [];

brands.push({
  id: 'mard',
  name: 'MARD',
  colors: sortByCode(mard).map((c) => ({
    code: c.code,
    rgb: c.rgb,
    auto: c.code !== MARD_TRANSPARENT,
    base: isBaseSeries(c.code),
  })),
});

// These brands' codes are mapped onto MARD beads, so they share MARD's colours and base set.
for (const [id, name, key] of [
  ['coco', 'COCO', 'COCO'],
  ['manman', '漫漫', '漫漫'],
  ['panpan', '盼盼', '盼盼'],
  ['mixiaowo', '咪小窝', '咪小窝'],
]) {
  const seen = new Set();
  const colors = [];
  for (const entry of Object.values(mapping)) {
    const m = mardByCode.get(normalizeMard(entry.MARD));
    if (!m) throw new Error(`mapping refers to unknown MARD code ${entry.MARD}`);
    // Two colours sharing one code can't be told apart on a pattern, so keep the first.
    if (seen.has(entry[key])) {
      console.warn(`${name}: code ${entry[key]} is shared, dropping MARD ${m.code}`);
      continue;
    }
    seen.add(entry[key]);
    colors.push({
      code: entry[key],
      rgb: m.rgb,
      auto: m.code !== MARD_TRANSPARENT,
      base: isBaseSeries(m.code),
    });
  }
  brands.push({ id, name, colors: sortByCode(colors) });
}

for (const [id, name, file] of [
  ['hama', 'Hama Mini', 'hama_mini.csv'],
  ['perler', 'Perler Mini', 'perler_mini.csv'],
  ['artkal', 'Artkal C', 'artkal_c.csv'],
]) {
  brands.push({
    id,
    name,
    colors: readCsv(file).map((c) => ({
      // Every Perler code starts with 80-, which would only crowd the pattern's small cells.
      code: c.code.replace(/^80-/, ''),
      name: c.label,
      rgb: c.rgb,
      auto: !SPECIAL.test(c.label),
      base: true,
    })),
  });
}

for (const b of brands) {
  const codes = new Set(b.colors.map((c) => c.code));
  if (codes.size !== b.colors.length) throw new Error(`${b.name}: duplicate codes`);
  for (const c of b.colors) {
    if (c.rgb.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) throw new Error(`${b.name} ${c.code}: bad rgb`);
  }
  const base = b.colors.filter((c) => c.base).length;
  const auto = b.colors.filter((c) => c.auto).length;
  console.log(`${b.name}: ${b.colors.length} colours, ${base} base, ${auto} auto-matched`);
}

writeFileSync(new URL('../src/data/palettes.json', import.meta.url), JSON.stringify({ brands }));
