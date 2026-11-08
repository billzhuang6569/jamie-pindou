import { useMemo, useState } from 'react';
import { beadTotal, colorCounts } from '../core/doc';
import { BRANDS, seriesList, seriesOf, type Brand } from '../core/palette';
import { BeadDot, Icon, Sheet } from './parts';

export function BrandSheet({
  value,
  onPick,
  onClose,
}: {
  value: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="选择色号标准" onClose={onClose}>
      <div className="sheet-scroll sheet-list">
        {BRANDS.map((b) => {
          const on = b.id === value;
          return (
            <button type="button" key={b.id} className="list-row" aria-pressed={on} onClick={() => onPick(b.id)}>
              <span className={on ? 'list-name on' : 'list-name'}>{b.name}</span>
              <span className="muted">{b.colors.length} 色</span>
              <span className="mark">{on && <i className="dot-on" />}</span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

export function LimitSheet({
  value,
  onPick,
  onClose,
}: {
  value: number;
  onPick: (n: number) => void;
  onClose: () => void;
}) {
  const options = [0, 8, 16, 24, 36, 48, 72];
  return (
    <Sheet title="颜色上限" sub="整张图最多用多少种颜色" onClose={onClose}>
      <div className="sheet-scroll sheet-list">
        {options.map((n) => {
          const on = n === value;
          return (
            <button type="button" key={n} className="list-row" aria-pressed={on} onClick={() => onPick(n)}>
              <span className={on ? 'list-name on' : 'list-name'}>{n === 0 ? '不限' : `${n} 种`}</span>
              <span className="mark">{on && <i className="dot-on" />}</span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

function useBrowse(brand: Brand, initial: string) {
  const series = useMemo(() => seriesList(brand), [brand]);
  const [group, setGroup] = useState(initial);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const items = useMemo(() => {
    const all = brand.colors.map((c, index) => ({ c, index }));
    if (q) return all.filter(({ c }) => c.code.toLowerCase().includes(q) || c.name?.toLowerCase().includes(q));
    return all.filter(({ c }) => seriesOf(c.code) === group);
  }, [brand, q, group]);
  return { series, group, setGroup, query, setQuery, items, searching: q.length > 0 };
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="search">
      <Icon name="search" size={18} />
      <input
        aria-label="搜索色号"
        placeholder="搜索色号，如 D10"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      />
    </div>
  );
}

const USED = '本图';

/** Pick one colour, for painting or for replacing cells. */
export function PickerSheet({
  brand,
  cells,
  current,
  sub,
  onPick,
  onClose,
}: {
  brand: Brand;
  cells: Int16Array;
  current: number | null;
  sub?: string;
  onPick: (index: number) => void;
  onClose: () => void;
}) {
  const used = useMemo(() => colorCounts(cells).map((c) => c.index), [cells]);
  const browse = useBrowse(brand, used.length ? USED : seriesOf(brand.colors[0].code));
  const items =
    !browse.searching && browse.group === USED
      ? used.map((index) => ({ c: brand.colors[index], index }))
      : browse.items;
  return (
    <Sheet title="选择颜色" sub={sub} onClose={onClose} height="min(600px, 78dvh)">
      <SearchBox value={browse.query} onChange={browse.setQuery} />
      <div className="chip-scroll" role="group" aria-label="色系">
        {[USED, ...browse.series].map((s) => (
          <button
            type="button"
            key={s}
            className="chip"
            aria-pressed={!browse.searching && s === browse.group}
            onClick={() => {
              browse.setQuery('');
              browse.setGroup(s);
            }}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="sheet-scroll">
        {items.length === 0 ? (
          <p className="empty">没有这个色号，换个写法试试</p>
        ) : (
          <div className="swatch-grid">
            {items.map(({ c, index }) => (
              <button
                type="button"
                key={c.code}
                className="swatch"
                aria-label={`颜色 ${c.code}${c.name ? ` ${c.name}` : ''}`}
                aria-pressed={index === current}
                onClick={() => onPick(index)}
              >
                <BeadDot rgb={c.rgb} size={36} />
                <span>{c.code}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** Tick the beads you own; only those are used when the pattern is generated. */
export function MyColorsSheet({
  brand,
  codes,
  onSave,
  onClose,
}: {
  brand: Brand;
  codes: string[];
  onSave: (codes: string[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState(() => new Set(codes));
  const browse = useBrowse(brand, seriesOf(brand.colors[0].code));
  const toggle = (code: string) => {
    const next = new Set(picked);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setPicked(next);
  };
  const tooFew = picked.size === 1;
  return (
    <Sheet title="我的色板" sub={`已选 ${picked.size} 色，只用这些颜色生成`} onClose={onClose} height="min(680px, 86dvh)">
      <SearchBox value={browse.query} onChange={browse.setQuery} />
      <div className="chip-scroll" role="group" aria-label="色系">
        {browse.series.map((s) => (
          <button
            type="button"
            key={s}
            className="chip"
            aria-pressed={!browse.searching && s === browse.group}
            onClick={() => {
              browse.setQuery('');
              browse.setGroup(s);
            }}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="sheet-scroll">
        {browse.items.length === 0 ? (
          <p className="empty">没有这个色号，换个写法试试</p>
        ) : (
          <div className="swatch-grid">
            {browse.items.map(({ c }) => (
              <button
                type="button"
                key={c.code}
                className="swatch"
                aria-label={`颜色 ${c.code}`}
                aria-pressed={picked.has(c.code)}
                onClick={() => toggle(c.code)}
              >
                <BeadDot rgb={c.rgb} size={36} />
                <span>{c.code}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {tooFew && <p className="sheet-note">至少选 2 个颜色，图才分得出层次</p>}
      <div className="row-actions sheet-actions">
        <button type="button" className="btn btn-2" onClick={() => setPicked(new Set())}>
          清空
        </button>
        <button type="button" className="btn btn-1 grow" disabled={tooFew} onClick={() => onSave([...picked])}>
          保存
        </button>
      </div>
    </Sheet>
  );
}

export function ColorsSheet({
  brand,
  cells,
  highlight,
  onHighlight,
  onReplace,
  onClose,
}: {
  brand: Brand;
  cells: Int16Array;
  highlight: number | null;
  onHighlight: (index: number | null) => void;
  onReplace: () => void;
  onClose: () => void;
}) {
  const counts = useMemo(() => colorCounts(cells), [cells]);
  return (
    <Sheet
      title="颜色清单"
      sub={`${counts.length} 种颜色 · 共 ${beadTotal(counts)} 颗 · 点一个颜色，图上只亮这个颜色`}
      onClose={onClose}
      height="56dvh"
      modal={false}
    >
      <div className="sheet-scroll sheet-list">
        {counts.map(({ index, count }) => {
          const c = brand.colors[index];
          const on = index === highlight;
          return (
            <div key={c.code} className={on ? 'color-row on' : 'color-row'}>
              <button
                type="button"
                className="color-pick"
                aria-pressed={on}
                onClick={() => onHighlight(on ? null : index)}
              >
                <BeadDot rgb={c.rgb} size={30} />
                <span className="color-code">{c.code}</span>
                <span className="color-count">{count} 颗</span>
              </button>
              {on && (
                <button type="button" className="btn-mini" onClick={onReplace}>
                  全部换成…
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
