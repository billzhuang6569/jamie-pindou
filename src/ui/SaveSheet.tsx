import { useEffect, useMemo, useState } from 'react';
import { beadTotal, colorCounts, type PatternDoc } from '../core/doc';
import { canvasToBlob } from '../core/image';
import type { Brand } from '../core/palette';
import { renderSheet } from '../core/render';
import { Icon, Sheet } from './parts';

const inWeChat = () => /MicroMessenger/i.test(navigator.userAgent);
const canShareFiles = (file: File) =>
  matchMedia('(pointer: coarse)').matches && !!navigator.canShare && navigator.canShare({ files: [file] });

export function SaveSheet({ doc, brand, onClose }: { doc: PatternDoc; brand: Brand; onClose: () => void }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [failed, setFailed] = useState(false);
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : ''), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  useEffect(() => {
    let dropped = false;
    (async () => {
      try {
        // The sheet is drawn on a canvas, which won't wait for the web font on its own.
        await Promise.all(['400 20px Rubik', '500 20px Rubik', '600 20px Rubik'].map((f) => document.fonts.load(f, 'A1')));
        const out = await canvasToBlob(renderSheet(doc, brand.colors, { brand: brand.name }));
        if (!dropped) setBlob(out);
      } catch (e) {
        console.error(e);
        if (!dropped) setFailed(true);
      }
    })();
    return () => {
      dropped = true;
    };
  }, [doc, brand]);

  const counts = useMemo(() => colorCounts(doc.cells), [doc]);
  const name = `拼豆图纸-${doc.w}x${doc.h}-${brand.name.replace(/\s+/g, '')}.png`;
  const wechat = inWeChat();

  const save = async () => {
    if (!blob) return;
    const file = new File([blob], name, { type: 'image/png' });
    if (canShareFiles(file)) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (e) {
        if ((e as DOMException).name === 'AbortError') return;
      }
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
  };

  return (
    <Sheet
      title={failed ? '图纸没有生成出来' : blob ? '图纸已生成' : '正在生成图纸…'}
      sub={`${doc.w} × ${doc.h} · 共 ${beadTotal(counts)} 颗 · ${counts.length} 种颜色`}
      onClose={onClose}
    >
      <div className="save-preview">
        {failed ? (
          <p className="empty">这台手机画不下这么大的图。请把尺寸调小后重新生成。</p>
        ) : url ? (
          <img src={url} alt="完整的拼豆图纸预览，含色号、坐标和颜色清单" />
        ) : (
          <p className="empty">正在把每一格写上色号…</p>
        )}
      </div>
      {!failed && !wechat && (
        <div className="row-actions sheet-actions">
          <button type="button" className="btn btn-1 grow" disabled={!blob} onClick={save}>
            <Icon name="download" />
            <span>保存到手机</span>
          </button>
        </div>
      )}
      {!failed && <p className="sheet-note center">{wechat ? '长按上面的图片保存到手机' : '在微信里打开时，长按图片保存'}</p>}
    </Sheet>
  );
}
