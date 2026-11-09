import { useEffect, useState } from 'react';
import { finishedCm } from '../core/doc';
import { INITIAL_CROP, type Crop, type SourceImage } from '../core/image';
import { treatAsPixelArt, type Params } from '../core/pattern';
import type { PixelGrid } from '../core/pixelGrid';
import { Cropper } from './Cropper';
import { BeadFields, MergeField, SIZES, clampSide, sizeFromLongSide } from './ParamFields';
import { Header, IconButton, Segmented } from './parts';

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

const finishedLabel = (w: number, h: number) => (w === h ? `成品约 ${finishedCm(w)} cm` : `成品约 ${finishedCm(w)} × ${finishedCm(h)} cm`);

export function Setup({
  source,
  imageUrl,
  crop,
  params,
  grid,
  followSize,
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
  grid: PixelGrid | null;
  followSize: { w: number; h: number } | null;
  busy: boolean;
  canReturn: boolean;
  onCrop: (c: Crop) => void;
  onParams: (p: Params) => void;
  onChangeImage: () => void;
  onGenerate: () => void;
  onBack: () => void;
}) {
  const { w, h, ratioMode } = params;
  const ratio = source.width / source.height;
  const canFollow = treatAsPixelArt(params, grid) && !!followSize;
  const following = canFollow && params.follow;

  const setSize = (s: number) =>
    onParams({ ...params, follow: false, ...(ratioMode === 'board' ? { w: s, h: s } : sizeFromLongSide(s, ratio)) });
  const setW = (n: number) => onParams({ ...params, follow: false, w: n, h: ratioMode === 'image' ? clampSide(n / ratio) : h });
  const setH = (n: number) => onParams({ ...params, follow: false, h: n, w: ratioMode === 'image' ? clampSide(n * ratio) : w });
  const setRatioMode = (m: Params['ratioMode']) => {
    const long = Math.max(w, h);
    onParams({ ...params, ratioMode: m, ...(m === 'board' ? { w: long, h: long } : sizeFromLongSide(long, ratio)) });
    onCrop(INITIAL_CROP);
  };
  const activeSize = following ? null : ratioMode === 'board' ? (w === h ? w : null) : Math.max(w, h);
  const aspect = following ? ratio : w / h;

  return (
    <div className="screen setup">
      <Header title="设置图纸" left={<IconButton name="back" label={canReturn ? '返回图纸' : '返回项目页'} onClick={onBack} />} />
      <Cropper imageUrl={imageUrl} source={source} crop={crop} aspect={aspect} onChange={onCrop} />
      <div className="crop-tools">
        <p>拖动和缩放，框内就是生成范围</p>
        <button type="button" className="btn btn-2 btn-s" onClick={() => onCrop(INITIAL_CROP)}>
          重置
        </button>
        <button type="button" className="btn btn-2 btn-s" onClick={onChangeImage}>
          更换
        </button>
      </div>

      {canFollow && (
        <div className="banner">
          <strong>识别到像素画</strong>
          <span>
            {following
              ? `按原图的格子生成 ${followSize!.w} × ${followSize!.h}，每一格对应原图的一个像素，轮廓不会断`
              : '选“跟随原图”时，每一格对应原图的一个像素，轮廓不会断'}
          </span>
        </div>
      )}

      <section className="card" aria-label="尺寸">
        {!following && (
          <Segmented
            label="比例"
            value={ratioMode}
            onChange={setRatioMode}
            options={[
              { value: 'board', label: '按豆板比例' },
              { value: 'image', label: '按图片比例' },
            ]}
          />
        )}
        <div className="field">
          <div className="label">{following || ratioMode === 'board' ? '尺寸' : '长边格数'}</div>
          {canFollow && (
            <button type="button" className="size-chip follow-chip" aria-pressed={following} onClick={() => onParams({ ...params, follow: true })}>
              跟随原图 {followSize!.w} × {followSize!.h}
            </button>
          )}
          <div className="size-grid">
            {SIZES.map((s) => (
              <button type="button" key={s} className="size-chip" aria-pressed={s === activeSize} onClick={() => setSize(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
        {!following && (
          <div className="side-row">
            <SideField id="side-w" label="宽" value={w} onCommit={setW} />
            <span aria-hidden="true" className="muted">
              ×
            </span>
            <SideField id="side-h" label="高" value={h} onCommit={setH} />
          </div>
        )}
        <p className="note">
          {following ? finishedLabel(followSize!.w, followSize!.h) : `${finishedLabel(w, h)}`}（2.6mm 豆）
          {!following && ` · 共 ${w * h} 格`}
        </p>
      </section>

      <section className="card" aria-label="颜色">
        <BeadFields params={params} onChange={onParams} />
        <MergeField params={params} onChange={onParams} />
      </section>

      <div className="cta">
        <button type="button" className="btn btn-1 grow" disabled={busy} onClick={onGenerate}>
          {busy ? '正在生成…' : '生成图纸'}
        </button>
      </div>
    </div>
  );
}
