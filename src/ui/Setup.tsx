import { useEffect, useState } from 'react';
import { finishedCm } from '../core/doc';
import { MERGE_LEVELS } from '../core/generate';
import { INITIAL_CROP, type Crop, type SourceImage } from '../core/image';
import { brandById } from '../core/palette';
import { loadMyColors, saveMyColors, type Params } from '../storage';
import { BrandSheet, LimitSheet, MyColorsSheet } from './ColorSheets';
import { Cropper } from './Cropper';
import { Header, Icon, IconButton, Segmented } from './parts';

const SIZES = [16, 26, 52, 78, 104, 128];
const MIN_SIDE = 2;
const MAX_SIDE = 200;
const clampSide = (n: number) => Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.round(n)));

function SideField({
  id,
  label,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number.parseInt(draft, 10);
    if (Number.isNaN(n)) setDraft(String(value));
    else {
      onCommit(clampSide(n));
      setDraft(String(clampSide(n)));
    }
  };
  return (
    <div className="side-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </div>
  );
}

function Row({ name, value, onClick }: { name: string; value: string; onClick: () => void }) {
  return (
    <button type="button" className="setting-row" onClick={onClick}>
      <span className="setting-name">{name}</span>
      <span className="muted">{value}</span>
      <Icon name="chev" size={18} />
    </button>
  );
}

export function Setup({
  source,
  imageUrl,
  crop,
  params,
  busy,
  canReturn,
  onCrop,
  onParams,
  onChangeImage,
  onGenerate,
  onBack,
}: {
  source: SourceImage;
  imageUrl: string;
  crop: Crop;
  params: Params;
  busy: boolean;
  canReturn: boolean;
  onCrop: (c: Crop) => void;
  onParams: (p: Params) => void;
  onChangeImage: () => void;
  onGenerate: (myColors: string[]) => void;
  onBack: () => void;
}) {
  const [sheet, setSheet] = useState<'brand' | 'limit' | 'mine' | null>(null);
  const brand = brandById(params.brandId);
  const [mine, setMine] = useState(() => loadMyColors(params.brandId));
  useEffect(() => setMine(loadMyColors(params.brandId)), [params.brandId]);

  const { w, h, ratioMode } = params;
  const ratio = source.width / source.height;
  const fromLongSide = (long: number) =>
    ratio >= 1 ? { w: long, h: clampSide(long / ratio) } : { w: clampSide(long * ratio), h: long };

  const setSize = (s: number) =>
    onParams({ ...params, ...(ratioMode === 'board' ? { w: s, h: s } : fromLongSide(s)) });
  const setW = (n: number) =>
    onParams({ ...params, w: n, h: ratioMode === 'image' ? clampSide(n / ratio) : h });
  const setH = (n: number) =>
    onParams({ ...params, h: n, w: ratioMode === 'image' ? clampSide(n * ratio) : w });
  const setRatioMode = (m: Params['ratioMode']) => {
    const long = Math.max(w, h);
    onParams({ ...params, ratioMode: m, ...(m === 'board' ? { w: long, h: long } : fromLongSide(long)) });
    onCrop(INITIAL_CROP);
  };
  const activeSize = ratioMode === 'board' ? (w === h ? w : null) : Math.max(w, h);
  const size = w === h ? `成品约 ${finishedCm(w)} cm` : `成品约 ${finishedCm(w)} × ${finishedCm(h)} cm`;
  const merge = MERGE_LEVELS[params.mergeLevel];
  const usingMine = mine.length > 0;

  return (
    <div className="screen setup">
      <Header title="设置图纸" left={<IconButton name="back" label={canReturn ? '返回图纸' : '返回首页'} onClick={onBack} />} />
      <Cropper imageUrl={imageUrl} source={source} crop={crop} aspect={w / h} onChange={onCrop} />
      <div className="crop-tools">
        <p>拖动和缩放，框内就是生成范围</p>
        <button type="button" className="btn btn-2 btn-s" onClick={() => onCrop(INITIAL_CROP)}>
          重置
        </button>
        <button type="button" className="btn btn-2 btn-s" onClick={onChangeImage}>
          更换
        </button>
      </div>

      <section className="card" aria-label="尺寸">
        <Segmented
          label="比例"
          value={ratioMode}
          onChange={setRatioMode}
          options={[
            { value: 'board', label: '按豆板比例' },
            { value: 'image', label: '按图片比例' },
          ]}
        />
        <div className="field">
          <div className="label">{ratioMode === 'board' ? '每边格数' : '长边格数'}</div>
          <div className="size-grid">
            {SIZES.map((s) => (
              <button type="button" key={s} className="size-chip" aria-pressed={s === activeSize} onClick={() => setSize(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="side-row">
          <SideField id="side-w" label="宽" value={w} onCommit={setW} />
          <span aria-hidden="true" className="muted">
            ×
          </span>
          <SideField id="side-h" label="高" value={h} onCommit={setH} />
        </div>
        <p className="note">
          {size}（2.6mm 豆）· 共 {w * h} 格
        </p>
      </section>

      <section className="card" aria-label="颜色">
        <Row name="色号标准" value={brand.name} onClick={() => setSheet('brand')} />
        {brand.hasSpecs && !usingMine && (
          <div className="field">
            <div className="label">色号规格</div>
            <Segmented
              label="色号规格"
              value={params.spec}
              onChange={(spec) => onParams({ ...params, spec })}
              options={[
                { value: 'base', label: `${brand.baseCount} 色` },
                { value: 'full', label: `${brand.colors.length} 色` },
              ]}
            />
          </div>
        )}
        <div className="field">
          <div className="label">颜色合并</div>
          <div className="merge" role="group" aria-label="颜色合并">
            <i aria-hidden="true" />
            {MERGE_LEVELS.map((m) => (
              <button
                type="button"
                key={m.id}
                aria-pressed={m.id === params.mergeLevel}
                onClick={() => onParams({ ...params, mergeLevel: m.id })}
              >
                <span className="merge-dot" />
                <span>{m.label}</span>
              </button>
            ))}
          </div>
          <p className="note">{merge.hint}</p>
        </div>
      </section>

      <section className="card card-rows" aria-label="更多">
        <Row name="颜色上限" value={params.maxColors ? `${params.maxColors} 种` : '不限'} onClick={() => setSheet('limit')} />
        <div className="divider" />
        <Row name="我的色板" value={usingMine ? `${mine.length} 色` : '未设置'} onClick={() => setSheet('mine')} />
      </section>

      <div className="cta">
        <button type="button" className="btn btn-1 grow" disabled={busy} onClick={() => onGenerate(mine)}>
          {busy ? '正在生成…' : '生成图纸'}
        </button>
      </div>

      {sheet === 'brand' && (
        <BrandSheet
          value={params.brandId}
          onClose={() => setSheet(null)}
          onPick={(brandId) => {
            onParams({ ...params, brandId });
            setSheet(null);
          }}
        />
      )}
      {sheet === 'limit' && (
        <LimitSheet
          value={params.maxColors}
          onClose={() => setSheet(null)}
          onPick={(maxColors) => {
            onParams({ ...params, maxColors });
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
          }}
        />
      )}
    </div>
  );
}
