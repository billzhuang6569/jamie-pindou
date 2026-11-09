import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PatternDoc } from './core/doc';
import { canvasToBlob, INITIAL_CROP, loadSource, renderCrop, type Crop, type SourceImage } from './core/image';
import { brandById } from './core/palette';
import { buildPattern, findSubjectBox, fitCropToSubject, measureNative, treatAsPixelArt, type Params, type SubjectBox } from './core/pattern';
import { detectPixelGrid, type PixelGrid } from './core/pixelGrid';
import { deleteProject, listProjects, loadMyColors, loadPrefs, newProjectId, savePrefs, saveProject, type Project } from './storage';
import { Home } from './ui/Home';
import { canGoBack, pushRoute, readRoute, replaceRoute, resetToRoot, runBackGuards, type Route } from './ui/nav';
import { sizeFromLongSide } from './ui/ParamFields';
import { ConfirmSheet, Icon } from './ui/parts';
import { Result } from './ui/Result';
import { Setup } from './ui/Setup';

type Loaded = { blob: Blob; source: SourceImage; url: string; grid: PixelGrid | null; subject: SubjectBox | null };
type Ask = { kind: 'replace' } | { kind: 'generate' } | { kind: 'adjust'; next: Params } | null;

const SOURCE_TYPE = 'image/webp'; // Browsers that can't encode WebP fall back to PNG. Both keep transparency.
const REGENERATE_DELAY = 120;
const PREVIEW_SIDE = 900;

/** Phones name photos things like IMG_2041, which say nothing. Those get a dated name instead. */
function nameFromFile(file: File): string {
  const base = file.name.replace(/\.[^.]+$/, '').trim();
  if (base && !/^(image|img|photo|dsc|mmexport|wx_camera|screenshot|\d)/i.test(base)) return base.slice(0, 30);
  const d = new Date();
  return `图纸 ${d.getMonth() + 1}月${d.getDate()}日`;
}

export function App() {
  const [route, setRoute] = useState<Route>({ screen: 'home' });
  const [ready, setReady] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const createdAt = useRef(0);
  const [image, setImage] = useState<Loaded | null>(null);
  const [crop, setCrop] = useState<Crop>(INITIAL_CROP);
  const [params, setParamsState] = useState<Params>(loadPrefs);
  const [doc, setDoc] = useState<PatternDoc | null>(null);
  const [docParams, setDocParams] = useState<Params>(params);
  const [cropped, setCropped] = useState<{ blob: Blob; url: string } | null>(null);
  const [edited, setEdited] = useState(false);
  const [resultKey, setResultKey] = useState(0);
  const [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ask, setAsk] = useState<Ask>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const pickMode = useRef<'new' | 'replace'>('new');
  /** Set while the setup page sits on top of the result page it will return to. */
  const setupOverResult = useRef(false);
  const routeRef = useRef(route);
  routeRef.current = route;

  const go = useCallback((r: Route, how: 'push' | 'replace' = 'push') => {
    if (how === 'push') pushRoute(r);
    else replaceRoute(r);
    setRoute(r);
  }, []);

  const setParams = useCallback((p: Params) => {
    setParamsState(p);
    savePrefs(p);
  }, []);

  const adoptImage = async (blob: Blob, nextCrop: Crop, reencode: boolean) => {
    const source = await loadSource(blob);
    const stored = reencode ? await canvasToBlob(source.canvas, SOURCE_TYPE, 0.92) : blob;
    const grid = detectPixelGrid(source.pixels());
    const subject = findSubjectBox(source);
    setImage((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return { blob: stored, source, url: URL.createObjectURL(stored), grid, subject };
    });
    setCrop(nextCrop);
    return { source, grid, stored };
  };

  // ---------- Saving: phones kill background tabs without warning, so work is kept after every change.
  const lastSaved = useRef<Partial<Project>>({});
  useEffect(() => {
    if (!projectId || !image) return;
    const s = lastSaved.current;
    const effective = doc ? docParams : params;
    if (s.id === projectId && s.image === image.blob && s.crop === crop && s.params === effective && s.doc === doc && s.cropped === (cropped?.blob ?? null) && s.edited === edited && s.name === projectName) return;
    const t = setTimeout(() => {
      const project: Project = {
        id: projectId,
        name: projectName,
        createdAt: createdAt.current,
        updatedAt: Date.now(),
        image: image.blob,
        crop,
        params: effective,
        doc,
        cropped: cropped?.blob ?? null,
        edited,
      };
      lastSaved.current = project;
      saveProject(project);
      setProjects((list) => [project, ...list.filter((p) => p.id !== project.id)]);
    }, 400);
    return () => clearTimeout(t);
  }, [projectId, projectName, image, crop, params, docParams, doc, cropped, edited]);

  // ---------- Opening
  const openProject = useCallback(async (p: Project): Promise<boolean> => {
    setError('');
    try {
      await adoptImage(p.image, p.crop, false);
      lastSaved.current = p;
      createdAt.current = p.createdAt;
      setProjectId(p.id);
      setProjectName(p.name);
      setParamsState(p.params);
      setDocParams(p.params);
      setDoc(p.doc);
      setEdited(p.edited);
      setCropped((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return p.cropped ? { blob: p.cropped, url: URL.createObjectURL(p.cropped) } : null;
      });
      setResultKey((k) => k + 1);
      setupOverResult.current = false;
      return true;
    } catch (e) {
      console.error(e);
      setError('这张图纸打不开了，可以删除后重新新建');
      return false;
    }
  }, []);

  // The home page is always the root entry, so back from any page lands there.
  useEffect(() => {
    let dropped = false;
    (async () => {
      const list = await listProjects();
      if (dropped) return;
      setProjects(list);
      const start = readRoute();
      resetToRoot({ screen: 'home' });
      if (start.screen !== 'home') {
        const p = list.find((x) => x.id === start.id);
        if (p && (await openProject(p))) {
          const target: Route = p.doc ? { screen: 'result', id: p.id } : { screen: 'setup', id: p.id };
          pushRoute(target);
          setRoute(target);
        }
      }
      setReady(true);
    })();
    return () => {
      dropped = true;
    };
  }, [openProject]);

  useEffect(() => {
    const onPop = () => {
      if (runBackGuards()) {
        // Something on top handled back, so step forward again to stay on this page.
        pushRoute(routeRef.current);
        return;
      }
      setupOverResult.current = false;
      setRoute(readRoute());
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const goHome = useCallback(() => {
    const depth = (history.state as { depth?: number } | null)?.depth ?? 0;
    if (depth > 0) history.go(-depth);
    else go({ screen: 'home' }, 'replace');
    setupOverResult.current = false;
  }, [go]);

  const onOpenFromHome = async (id: string) => {
    const p = projects.find((x) => x.id === id);
    if (!p || !(await openProject(p))) return;
    go(p.doc ? { screen: 'result', id } : { screen: 'setup', id });
  };

  // ---------- Picking pictures
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    const replacing = pickMode.current === 'replace' && projectId;
    try {
      const { source } = await adoptImage(file, INITIAL_CROP, true);
      setDoc(null);
      setEdited(false);
      setCropped((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return null;
      });
      const ratio = source.width / source.height;
      setParamsState((p) => {
        const next = p.ratioMode === 'image' ? { ...p, ...sizeFromLongSide(Math.max(p.w, p.h), ratio) } : p;
        return { ...next, follow: true, imageType: 'auto', color: 'auto' };
      });
      if (replacing) {
        // The result page this came from no longer has anything to show.
        go({ screen: 'setup', id: projectId! }, 'replace');
      } else {
        const id = newProjectId();
        createdAt.current = Date.now();
        setProjectId(id);
        setProjectName(nameFromFile(file));
        go({ screen: 'setup', id });
      }
      setupOverResult.current = false;
    } catch (e) {
      console.error(e);
      setError('这张图片打不开，换一张 JPG 或 PNG 试试');
    }
  };

  const pickNew = () => {
    pickMode.current = 'new';
    fileInput.current?.click();
  };
  const pickCamera = () => {
    pickMode.current = 'new';
    cameraInput.current?.click();
  };
  const pickReplacement = () => {
    if (doc && edited) {
      setAsk({ kind: 'replace' });
      return;
    }
    pickMode.current = 'replace';
    fileInput.current?.click();
  };

  // ---------- Generating
  const followSize = useMemo(
    () => (image?.grid ? measureNative(image.source, image.grid, crop, params.outline) : null),
    [image, crop, params.outline],
  );

  /**
   * Until the picture has been framed by hand, the frame fits the subject, so a small subject in a
   * big white image doesn't come out tiny. Following the source grid needs no framing: it trims itself.
   */
  const frameFor = useCallback(
    (p: Params): Crop => {
      const untouched = crop.zoom === 1 && crop.dx === 0 && crop.dy === 0;
      if (!image?.subject || !untouched) return crop;
      if (treatAsPixelArt(p, image.grid) && p.follow && followSize) return crop;
      return fitCropToSubject(image.source, image.subject, p.w / p.h);
    },
    [image, crop, followSize],
  );

  const refreshPreview = useCallback(
    async (source: SourceImage, c: Crop, pattern: PatternDoc, native: boolean) => {
      const aspect = native ? source.width / source.height : pattern.w / pattern.h;
      const w = Math.round(aspect >= 1 ? PREVIEW_SIDE : PREVIEW_SIDE * aspect);
      const h = Math.round(aspect >= 1 ? PREVIEW_SIDE / aspect : PREVIEW_SIDE);
      const blob = await canvasToBlob(renderCrop(source, c, w, h, true), SOURCE_TYPE, 0.9);
      setCropped((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { blob, url: URL.createObjectURL(blob) };
      });
    },
    [],
  );

  const build = useCallback(
    (p: Params) => {
      if (!image) return null;
      const frame = frameFor(p);
      const pattern = buildPattern({
        source: image.source,
        grid: image.grid,
        crop: frame,
        params: p,
        brand: brandById(p.brandId),
        myColors: loadMyColors(p.brandId),
      });
      const native = treatAsPixelArt(p, image.grid) && p.follow;
      refreshPreview(image.source, frame, pattern, native);
      return pattern;
    },
    [image, frameFor, refreshPreview],
  );

  /** From the setup page: build, then show the result. */
  const generate = () => {
    if (!image || !projectId) return;
    setBusy(true);
    setError('');
    // Let the button show its busy state before the main thread gets occupied.
    setTimeout(() => {
      try {
        const pattern = build(params);
        if (!pattern) return;
        setDoc(pattern);
        setDocParams(params);
        setEdited(false);
        setResultKey((k) => k + 1);
        if (setupOverResult.current && canGoBack()) {
          setupOverResult.current = false;
          history.back();
        } else {
          go({ screen: 'result', id: projectId }, 'replace');
        }
      } catch (e) {
        console.error(e);
        setError('图纸没有生成出来，把尺寸调小一点再试试');
      } finally {
        setBusy(false);
      }
    }, 30);
  };

  /** From the adjust panel: rebuild in place, so the pattern above updates as settings change. */
  const regenTimer = useRef(0);
  const regenerate = useCallback(
    (p: Params) => {
      clearTimeout(regenTimer.current);
      regenTimer.current = window.setTimeout(() => {
        try {
          const pattern = build(p);
          if (!pattern) return;
          setDoc(pattern);
          setDocParams(p);
          setEdited(false);
          setGeneration((g) => g + 1);
        } catch (e) {
          console.error(e);
          setError('图纸没有生成出来，把尺寸调小一点再试试');
        }
      }, REGENERATE_DELAY);
    },
    [build],
  );

  const onAdjust = (next: Params) => {
    if (edited) {
      setAsk({ kind: 'adjust', next });
      return;
    }
    setParams(next);
    regenerate(next);
  };

  const onDocChange = useCallback((next: PatternDoc, wasEdited: boolean) => {
    setDoc(next);
    setEdited(wasEdited);
  }, []);

  // ---------- Project list actions
  const onRename = (id: string, name: string) => {
    if (id === projectId) setProjectName(name);
    setProjects((list) =>
      list.map((p) => {
        if (p.id !== id) return p;
        const next = { ...p, name };
        saveProject(next);
        return next;
      }),
    );
  };

  const onDelete = (id: string) => {
    deleteProject(id);
    setProjects((list) => list.filter((p) => p.id !== id));
    if (id === projectId) {
      setProjectId(null);
      setDoc(null);
      setImage(null);
    }
  };

  const showSetup = route.screen === 'setup' && image && projectId === route.id;
  const showResult = route.screen === 'result' && doc && image && projectId === route.id;
  // A page whose project is gone, reached through history, falls back to the project list.
  const showHome = route.screen === 'home' || (ready && !showSetup && !showResult);

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

      {ready && showHome && (
        <Home
          projects={projects}
          onNew={pickNew}
          onCamera={pickCamera}
          onOpen={onOpenFromHome}
          onRename={onRename}
          onDelete={onDelete}
        />
      )}

      {showSetup && (
        <Setup
          source={image.source}
          imageUrl={image.url}
          crop={frameFor(params)}
          params={params}
          grid={image.grid}
          followSize={followSize}
          busy={busy}
          canReturn={!!doc}
          onCrop={setCrop}
          onParams={setParams}
          onChangeImage={pickReplacement}
          onGenerate={() => {
            if (doc && edited) setAsk({ kind: 'generate' });
            else generate();
          }}
          onBack={() => {
            if (setupOverResult.current && canGoBack()) {
              setupOverResult.current = false;
              history.back();
            } else if (doc) {
              go({ screen: 'result', id: projectId! }, 'replace');
            } else {
              goHome();
            }
          }}
        />
      )}

      {showResult && (
        <Result
          key={resultKey}
          initial={doc}
          generation={generation}
          name={projectName}
          brand={brandById(docParams.brandId)}
          params={params}
          grid={image.grid}
          ratio={image.source.width / image.source.height}
          followSize={followSize}
          edited={edited}
          croppedUrl={cropped?.url ?? image.url}
          onChange={onDocChange}
          onBack={goHome}
          onAdjust={onAdjust}
          onMyColors={() => regenerate(params)}
          onRecrop={() => {
            setupOverResult.current = true;
            go({ screen: 'setup', id: projectId! });
          }}
          onChangeImage={pickReplacement}
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

      {ask?.kind === 'replace' && (
        <ConfirmSheet
          title="换一张图片？"
          body="选好新图片后，这张图纸和上面的修改都会被替换。"
          confirm="选择新图片"
          onClose={() => setAsk(null)}
          onConfirm={() => {
            setAsk(null);
            pickMode.current = 'replace';
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
            setAsk(null);
            generate();
          }}
        />
      )}
      {ask?.kind === 'adjust' && (
        <ConfirmSheet
          title="调整图纸？"
          body="调整后图纸会重新生成，你手动做的修改会丢失。"
          confirm="继续调整"
          onClose={() => setAsk(null)}
          onConfirm={() => {
            const { next } = ask;
            setAsk(null);
            setParams(next);
            regenerate(next);
          }}
        />
      )}
    </div>
  );
}
