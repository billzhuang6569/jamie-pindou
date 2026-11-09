import { useEffect, useState } from 'react';
import { MERGE_LEVELS } from '../core/generate';
import { brandById } from '../core/palette';
import type { Params } from '../core/pattern';
import { loadMyColors, saveMyColors } from '../storage';
import { BrandSheet, LimitSheet, MyColorsSheet } from './ColorSheets';
import { Icon, Segmented } from './parts';

export const SIZES = [16, 26, 52, 78, 104, 128];
const MIN_SIDE = 2;
const MAX_SIDE = 200;
export const clampSide = (n: number) => Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.round(n)));

/** The picture's width over its height, used to keep "by image ratio" sizes in shape. */
export function sizeFromLongSide(long: number, ratio: number) {
  return ratio >= 1 ? { w: long, h: clampSide(long / ratio) } : { w: clampSide(long * ratio), h: long };
}

export function SettingRow({ name, value, onClick }: { name: string; value?: string; onClick: () => void }) {
  return (
    <button type="button" className="setting-row" onClick={onClick}>
      <span className="setting-name">{name}</span>
      {value && <span className="muted">{value}</span>}
      <Icon name="chev" size={18} />
    </button>
  );
}

export function MergeField({ params, onChange }: { params: Params; onChange: (p: Params) => void }) {
  return (
    <div className="field">
      <div className="label">颜色合并</div>
      <div className="merge" role="group" aria-label="颜色合并">
        <i aria-hidden="true" />
        {MERGE_LEVELS.map((m) => (
          <button
            type="button"
            key={m.id}
            aria-pressed={m.id === params.mergeLevel}
            onClick={() => onChange({ ...params, mergeLevel: m.id })}
          >
            <span className="merge-dot" />
            <span>{m.label}</span>
          </button>
        ))}
      </div>
      <p className="note">{MERGE_LEVELS[params.mergeLevel].hint}</p>
    </div>
  );
}

/** Brand, colour set, colour cap and owned colours: the settings about which beads get used. */
export function BeadFields({
  params,
  onChange,
  onMyColors,
}: {
  params: Params;
  onChange: (p: Params) => void;
  onMyColors?: () => void;
}) {
  const [sheet, setSheet] = useState<'brand' | 'limit' | 'mine' | null>(null);
  const brand = brandById(params.brandId);
  const [mine, setMine] = useState(() => loadMyColors(params.brandId));
  useEffect(() => setMine(loadMyColors(params.brandId)), [params.brandId]);
  const usingMine = mine.length > 0;
  return (
    <>
      <SettingRow name="色号标准" value={brand.name} onClick={() => setSheet('brand')} />
      {brand.hasSpecs && !usingMine && (
        <div className="field">
          <div className="label">色号规格</div>
          <Segmented
            label="色号规格"
            value={params.spec}
            onChange={(spec) => onChange({ ...params, spec })}
            options={[
              { value: 'base', label: `${brand.baseCount} 色` },
              { value: 'full', label: `${brand.colors.length} 色` },
            ]}
          />
        </div>
      )}
      <SettingRow name="颜色上限" value={params.maxColors ? `${params.maxColors} 种` : '不限'} onClick={() => setSheet('limit')} />
      <SettingRow name="我的色板" value={usingMine ? `${mine.length} 色` : '未设置'} onClick={() => setSheet('mine')} />
      {sheet === 'brand' && (
        <BrandSheet
          value={params.brandId}
          onClose={() => setSheet(null)}
          onPick={(brandId) => {
            onChange({ ...params, brandId });
            setSheet(null);
          }}
        />
      )}
      {sheet === 'limit' && (
        <LimitSheet
          value={params.maxColors}
          onClose={() => setSheet(null)}
          onPick={(maxColors) => {
            onChange({ ...params, maxColors });
            setSheet(null);
          }}
        />
      )}
      {sheet === 'mine' && (
        <MyColorsSheet
          brand={brand}
          codes={mine}
          onClose={() => setSheet(null)}
          onSave={(codes) => {
            saveMyColors(brand.id, codes);
            setMine(codes);
            setSheet(null);
            onMyColors?.();
          }}
        />
      )}
    </>
  );
}
