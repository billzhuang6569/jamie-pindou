import type { PixelGrid } from '../core/pixelGrid';
import { treatAsPixelArt, usesRichColor, type Params } from '../core/pattern';
import { BeadFields, MergeField, SettingRow, SIZES, sizeFromLongSide } from './ParamFields';
import { Segmented, Sheet } from './parts';

/** Everything that changes how the pattern is generated. The pattern above updates as they change. */
export function AdjustSheet({
  params,
  grid,
  ratio,
  followSize,
  edited,
  onChange,
  onMyColors,
  onRecrop,
  onChangeImage,
  onClose,
}: {
  params: Params;
  grid: PixelGrid | null;
  ratio: number;
  followSize: { w: number; h: number } | null;
  edited: boolean;
  onChange: (p: Params) => void;
  onMyColors: () => void;
  onRecrop: () => void;
  onChangeImage: () => void;
  onClose: () => void;
}) {
  const pixelArt = treatAsPixelArt(params, grid);
  const canFollow = pixelArt && !!followSize;
  const following = canFollow && params.follow;
  const rich = usesRichColor(params, pixelArt);
  const activeSize = following ? null : params.ratioMode === 'board' ? (params.w === params.h ? params.w : null) : Math.max(params.w, params.h);

  const typeNote =
    params.imageType === 'photo'
      ? '按普通图片取色，格子不跟随原图'
      : pixelArt
        ? canFollow
          ? following
            ? '已识别为像素画，每一格对应原图的一个像素'
            : '已识别为像素画。选“跟随原图”时，每一格对应原图的一个像素'
          : '已识别为像素画，但格子太细，改用下面选的尺寸'
        : params.imageType === 'pixel'
          ? '这张图没找到像素网格，按普通图片处理'
          : '没有识别到像素网格，按普通图片处理';

  return (
    <Sheet
      title="调整图纸"
      sub={edited ? '调整后手动修改会丢失' : '改动后上方的图纸会马上更新'}
      onClose={onClose}
      height="62dvh"
      modal={false}
    >
      <div className="sheet-scroll adjust-body">
        <div className="field">
          <div className="label">图片类型</div>
          <Segmented
            label="图片类型"
            value={params.imageType}
            onChange={(imageType) => onChange({ ...params, imageType })}
            options={[
              { value: 'auto', label: '自动' },
              { value: 'pixel', label: '像素画', disabled: !grid },
              { value: 'photo', label: '普通图片' },
            ]}
          />
          <p className="note">{typeNote}</p>
        </div>

        <div className="field">
          <div className="label">尺寸</div>
          <div className="chip-scroll bleed" role="group" aria-label="尺寸">
            {canFollow && (
              <button type="button" className="chip" aria-pressed={following} onClick={() => onChange({ ...params, follow: true })}>
                跟随原图 {followSize!.w}×{followSize!.h}
              </button>
            )}
            {SIZES.map((s) => (
              <button
                type="button"
                key={s}
                className="chip"
                aria-pressed={s === activeSize}
                onClick={() =>
                  onChange({
                    ...params,
                    follow: false,
                    ...(params.ratioMode === 'board' ? { w: s, h: s } : sizeFromLongSide(s, ratio)),
                  })
                }
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <div className="label">轮廓</div>
          <Segmented
            label="轮廓"
            value={params.outline}
            onChange={(outline) => onChange({ ...params, outline })}
            options={[
              { value: 0, label: '关' },
              { value: 1, label: '标准' },
              { value: 2, label: '加强' },
            ]}
          />
          <p className="note">接上断开的轮廓线，并统一外圈颜色</p>
        </div>

        <div className="field">
          <div className="label">色彩</div>
          <Segmented
            label="色彩"
            value={rich ? 'rich' : 'natural'}
            onChange={(color) => onChange({ ...params, color })}
            options={[
              { value: 'natural', label: '原色' },
              { value: 'rich', label: '浓郁' },
            ]}
          />
          <p className="note">浓郁会加深并提高饱和度。像素画默认浓郁，普通图片默认原色</p>
        </div>

        <MergeField params={params} onChange={onChange} />

        <div className="adjust-rows">
          <BeadFields params={params} onChange={onChange} onMyColors={onMyColors} />
          <SettingRow name="重新裁剪" onClick={onRecrop} />
          <SettingRow name="更换图片" onClick={onChangeImage} />
        </div>
      </div>
    </Sheet>
  );
}
