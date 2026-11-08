import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import hero from './assets/hero.png';
import { colorCounts, newDoc, type PatternDoc } from './core/doc';
import { buildCells, MERGE_LEVELS } from './core/generate';
import { canvasToBlob, INITIAL_CROP, loadSource, renderCrop, samplesPerCell, type Crop, type SourceImage } from './core/image';
import { brandById, matchableIndexes } from './core/palette';
import { BOARD, paintBeads } from './core/render';
import { loadPrefs, loadProject, savePrefs, saveProject, type Params, type SavedProject } from './storage';
import { ConfirmSheet, Icon } from './ui/parts';
import { Result } from './ui/Result';
import { Setup } from './ui/Setup';

type Screen = 'home' | 'setup' | 'result';
type Loaded = { blob: Blob; source: SourceImage; url: string };

const SOURCE_TYPE = 'image/webp'; // Browsers that can't encode WebP fall back to PNG. Both keep transparency.

function Thumb({ doc, brandId }: { doc: PatternDoc; brandId: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const cell = Math.max(1, Math.min(6, Math.floor(384 / Math.max(doc.w, doc.h))));
    el.width = doc.w * cell;
    el.height = doc.h * cell;
    ctx.fillStyle = BOARD;
    ctx.fillRect(0, 0, el.width, el.height);
    paintBeads(ctx, doc.cells, doc.w, brandById(brandId).colors, { x0: 0, y0: 0, x1: doc.w, y1: doc.h }, cell, 0, 0, null);
  }, [doc, brandId]);
  return <canvas ref={ref} className="resume-thumb" aria-hidden="true" />;
}

export function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [saved, setSaved] = useState<SavedProject | null>(null);
  const [image, setImage] = useState<Loaded | null>(null);
  const [crop, setCrop] = useState<Crop>(INITIAL_CROP);
  const [params, setParamsState] = useState<Params>(loadPrefs);
  const [doc, setDoc] = useState<PatternDoc | null>(null);
  const [docParams, setDocParams] = useState<Params>(params);
  const [cropped, setCropped] = useState<{ blob: Blob; url: string } | null>(null);
  const [edited, setEdited] = useState(false);
  const [resultKey, setResultKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ask, setAsk] = useState<null | { kind: 'pick' } | { kind: 'generate'; mine: string[] }>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadProject().then((p) => {
      if (p) setSaved(p);
    });
  }, []);

  const setParams = useCallback((p: Params) => {
    setParamsState(p);
    savePrefs(p);
  }, []);

  // Phones kill background tabs without warning, so work is kept after every change.
  useEffect(() => {
    if (!image) return;
    const t = setTimeout(() => {
      const project: SavedProject = {
        image: image.blob,
        crop,
        params: doc ? docParams : params,
        doc,
        cropped: cropped?.blob ?? null,
        edited,
      };
      saveProject(project);
      setSaved(project);
    }, 400);
    return () => clearTimeout(t);
  }, [image, crop, params, docParams, doc, cropped, edited]);

  const adoptImage = async (blob: Blob, nextCrop: Crop) => {
    const source = await loadSource(blob);
    const stored = await canvasToBlob(source.canvas, SOURCE_TYPE, 0.92);
    setImage((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return { blob: stored, source, url: URL.createObjectURL(stored) };
    });
    setCrop(nextCrop);
    return source;
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      const source = await adoptImage(file, INITIAL_CROP);
      setDoc(null);
      setEdited(false);
      setCropped((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return null;
      });
      setParamsState((p) => {
        if (p.ratioMode !== 'image') return p;
        const long = Math.max(p.w, p.h);
        const r = source.width / source.height;
        const next = r >= 1 ? { ...p, w: long, h: Math.max(2, Math.round(long / r)) } : { ...p, w: Math.max(2, Math.round(long * r)), h: long };
        savePrefs(next);
        return next;
      });
      setScreen('setup');
    } catch (e) {
      console.error(e);
      setError('这张图片打不开，换一张 JPG 或 PNG 试试');
    }
  };

  const pick = () => {
    if (edited || saved?.edited) setAsk({ kind: 'pick' });
    else fileInput.current?.click();
  };

  const resume = async () => {
    if (!saved) return;
    setError('');
    try {
      await adoptImage(saved.image, saved.crop);
      setParamsState(saved.params);
      setDocParams(saved.params);
      setDoc(saved.doc);
      setEdited(saved.edited);
      setCropped(saved.cropped ? { blob: saved.cropped, url: URL.createObjectURL(saved.cropped) } : null);
      setResultKey((k) => k + 1);
      setScreen(saved.doc ? 'result' : 'setup');
    } catch (e) {
      console.error(e);
      setError('上次的图纸打不开了，重新选一张图片吧');
    }
  };

  const generate = (mine: string[]) => {
    if (!image) return;
    setBusy(true);
    setError('');
    // Let the button show its busy state before the main thread gets occupied.
    setTimeout(async () => {
      try {
        const { w, h, brandId, spec, mergeLevel, maxColors } = params;
        const brand = brandById(brandId);
        const k = samplesPerCell(w, h);
        const canvas = renderCrop(image.source, crop, w * k, h * k);
        const samples = canvas.getContext('2d')!.getImageData(0, 0, w * k, h * k).data;
        const cells = buildCells(samples, w, h, k, brand.colors, matchableIndexes(brand, spec, mine), {
          mergeThreshold: MERGE_LEVELS[mergeLevel].threshold,
          maxColors,
        });
        const previewScale = Math.min(1, 900 / Math.max(w * k, h * k));
        const preview = renderCrop(image.source, crop, Math.round(w * k * previewScale), Math.round(h * k * previewScale));
        const blob = await canvasToBlob(preview, SOURCE_TYPE, 0.9);
        setCropped((old) => {
          if (old) URL.revokeObjectURL(old.url);
          return { blob, url: URL.createObjectURL(blob) };
        });
        setDoc(newDoc(w, h, cells));
        setDocParams(params);
        setEdited(false);
        setResultKey((key) => key + 1);
        setScreen('result');
      } catch (e) {
        console.error(e);
        setError('图纸没有生成出来，把尺寸调小一点再试试');
      } finally {
        setBusy(false);
      }
    }, 30);
  };

  const requestGenerate = (mine: string[]) => {
    if (doc && edited) setAsk({ kind: 'generate', mine });
    else generate(mine);
  };

  const onDocChange = useCallback((next: PatternDoc, wasEdited: boolean) => {
    setDoc(next);
    setEdited(wasEdited);
  }, []);

  const savedCounts = useMemo(() => (saved?.doc ? colorCounts(saved.doc.cells).length : 0), [saved]);

  return (
    <div className="app">
      <input
        ref={fileInput}
        className="file"
        type="file"
        accept="image/*"
        aria-label="选择图片"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={cameraInput}
        className="file"
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="拍照"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {screen === 'home' && (
        <div className="screen home">
          <div className="hero-board">
            <img className="hero" src={hero} alt="用彩色拼豆拼出的“拼豆台”三个字，放在透明豆板上" />
          </div>
          <main className="home-main">
            <div className="eyebrow">Jamie的拼豆台</div>
            <h1>选一张图，做一张照着拼的图纸</h1>
            <p>每格标好色号，每种颜色算好颗数。图片只在这台手机上处理，不会上传。</p>
            <div className="row-actions">
              <button type="button" className="btn btn-1 grow" onClick={pick}>
                <Icon name="image" />
                <span>选一张图片</span>
              </button>
              <button type="button" className="btn btn-2" onClick={() => cameraInput.current?.click()}>
                <Icon name="camera" size={20} />
                <span>拍照</span>
              </button>
            </div>
            {saved?.doc && (
              <button type="button" className="resume" onClick={resume}>
                <Thumb doc={saved.doc} brandId={saved.params.brandId} />
                <span className="resume-text">
                  <span className="resume-title">继续上次的图纸</span>
                  <span className="resume-sub">
                    {saved.doc.w} × {saved.doc.h} · {brandById(saved.params.brandId).name} · {savedCounts} 种颜色
                  </span>
                </span>
                <Icon name="chev" size={20} />
              </button>
            )}
            <a className="source-link" href="https://github.com/billzhuang6569/jamie-pindou" target="_blank" rel="noreferrer">
              开源项目（AGPL-3.0）· 查看源代码
            </a>
          </main>
        </div>
      )}

      {screen === 'setup' && image && (
        <Setup
          source={image.source}
          imageUrl={image.url}
          crop={crop}
          params={params}
          busy={busy}
          canReturn={!!doc}
          onCrop={setCrop}
          onParams={setParams}
          onChangeImage={pick}
          onGenerate={requestGenerate}
          onBack={() => setScreen(doc ? 'result' : 'home')}
        />
      )}

      {screen === 'result' && doc && (
        <Result
          key={resultKey}
          initial={doc}
          brand={brandById(docParams.brandId)}
          croppedUrl={cropped?.url ?? image?.url ?? ''}
          onChange={onDocChange}
          onBack={() => setScreen('setup')}
          onReupload={() => fileInput.current?.click()}
        />
      )}

      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button type="button" aria-label="关闭提示" onClick={() => setError('')}>
            <Icon name="close" size={18} />
          </button>
        </div>
      )}

      {ask?.kind === 'pick' && (
        <ConfirmSheet
          title="换一张图片？"
          body="选好新图片后，当前图纸和上面的修改都会被替换。"
          confirm="选择新图片"
          onClose={() => setAsk(null)}
          onConfirm={() => {
            setAsk(null);
            fileInput.current?.click();
          }}
        />
      )}
      {ask?.kind === 'generate' && (
        <ConfirmSheet
          title="重新生成图纸？"
          body="重新生成后，你手动做的修改会丢失。"
          confirm="重新生成"
          onClose={() => setAsk(null)}
          onConfirm={() => {
            const { mine } = ask;
            setAsk(null);
            generate(mine);
          }}
        />
      )}
    </div>
  );
}
