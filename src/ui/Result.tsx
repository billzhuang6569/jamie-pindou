import { useEffect, useMemo, useRef, useState } from 'react';
import {
  beadTotal,
  colorCounts,
  commitCells,
  finishedCm,
  paintCells,
  replaceColor,
  toggleBackground,
  toggleMirror,
  type PatternDoc,
} from '../core/doc';
import { EMPTY } from '../core/generate';
import type { Brand } from '../core/palette';
import type { Params } from '../core/pattern';
import type { PixelGrid } from '../core/pixelGrid';
import { AdjustSheet } from './AdjustSheet';
import { BoardCanvas, type BoardHandle, type BoardMode, type BoardView, type BrushTool } from './BoardCanvas';
import { ColorsSheet, PickerSheet } from './ColorSheets';
import { useBackGuard } from './nav';
import { BeadDot, Header, Icon, IconButton, Segmented } from './parts';
import { SaveSheet } from './SaveSheet';

type Tab = 'source' | BoardView;
type Panel =
  | { kind: 'colors' }
  | { kind: 'picker'; purpose: 'paint' | 'selection' | 'replace' }
  | { kind: 'save' }
  | { kind: 'adjust' }
  | null;

const HISTORY_LIMIT = 60;

function useHistory(initial: PatternDoc) {
  const [state, setState] = useState({ past: [] as PatternDoc[], present: initial, future: [] as PatternDoc[] });
  return {
    doc: state.present,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    commit(next: PatternDoc) {
      setState((s) =>
        next === s.present ? s : { past: [...s.past, s.present].slice(-HISTORY_LIMIT), present: next, future: [] },
      );
    },
    undo() {
      setState((s) =>
        s.past.length === 0
          ? s
          : { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] },
      );
    },
    redo() {
      setState((s) =>
        s.future.length === 0 ? s : { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) },
      );
    },
    reset(next: PatternDoc) {
      setState({ past: [], present: next, future: [] });
    },
  };
}

function Tool({
  icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="tool" aria-pressed={active} disabled={disabled} onClick={onClick}>
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
}

export function Result({
  initial,
  generation,
  name,
  brand,
  params,
  grid,
  ratio,
  followSize,
  edited,
  croppedUrl,
  onChange,
  onBack,
  onAdjust,
  onMyColors,
  onRecrop,
  onChangeImage,
}: {
  initial: PatternDoc;
  /** Goes up when the pattern is rebuilt in place, which starts a fresh undo history. */
  generation: number;
  name: string;
  brand: Brand;
  params: Params;
  grid: PixelGrid | null;
  ratio: number;
  followSize: { w: number; h: number } | null;
  edited: boolean;
  croppedUrl: string;
  onChange: (doc: PatternDoc, edited: boolean) => void;
  onBack: () => void;
  onAdjust: (p: Params) => void;
  onMyColors: () => void;
  onRecrop: () => void;
  onChangeImage: () => void;
}) {
  const history = useHistory(initial);
  const { doc } = history;
  const colors = brand.colors;

  const [tab, setTab] = useState<Tab>('beads');
  const [mode, setMode] = useState<BoardMode>('view');
  const [tool, setTool] = useState<BrushTool>('brush');
  const [panel, setPanel] = useState<Panel>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [selection, setSelection] = useState<Uint8Array | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const board = useRef<BoardHandle>(null);

  const counts = useMemo(() => colorCounts(doc.cells), [doc]);
  const total = beadTotal(counts);
  const [chosenBrush, setBrush] = useState<number | null>(null);
  // Until a colour is chosen, paint with whatever this pattern uses most right now.
  const brush = chosenBrush ?? counts[0]?.index ?? 0;

  const reported = useRef(initial);
  useEffect(() => {
    if (doc === reported.current) return;
    reported.current = doc;
    onChange(doc, true);
  }, [doc, onChange]);

  // A colour that no longer exists on the board can't stay highlighted.
  useEffect(() => {
    if (highlight !== null && !counts.some((c) => c.index === highlight)) setHighlight(null);
  }, [counts, highlight]);

  const lastGeneration = useRef(generation);
  useEffect(() => {
    if (generation === lastGeneration.current) return;
    lastGeneration.current = generation;
    reported.current = initial;
    history.reset(initial);
    setSelection(null);
    setHighlight(null);
    setBrush(null);
    // Only a new generation may replace the history, not every edit reported back as `initial`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation]);

  const editing = mode !== 'view';
  useBackGuard(() => {
    if (mode === 'view') return false;
    setMode('view');
    setSelection(null);
    return true;
  });
  const view: BoardView = editing ? 'pattern' : tab === 'source' ? 'beads' : tab;
  const selectedCount = useMemo(() => (selection ? selection.reduce((n, v) => n + v, 0) : 0), [selection]);
  const selectedBreakdown = useMemo(() => {
    if (!selection || selectedCount === 0) return '';
    const picked = new Int16Array(doc.cells.length).fill(EMPTY);
    selection.forEach((on, i) => {
      if (on) picked[i] = doc.cells[i];
    });
    const used = colorCounts(picked);
    const empties = selectedCount - beadTotal(used);
    const shown = used.slice(0, 5).map((c) => `${colors[c.index].code} ${c.count} 格`);
    if (used.length > 5) shown.push('…');
    if (empties > 0) shown.push(`空格 ${empties} 格`);
    return shown.join(' · ');
  }, [selection, selectedCount, doc, colors]);

  const leaveEditing = () => {
    setMode('view');
    setSelection(null);
  };

  const applyPicked = (index: number) => {
    if (panel?.kind !== 'picker') return;
    if (panel.purpose === 'paint') {
      setBrush(index);
      setTool('brush');
    } else if (panel.purpose === 'selection' && selection) {
      const hit: number[] = [];
      selection.forEach((on, i) => {
        if (on) hit.push(i);
      });
      history.commit(paintCells(doc, hit, index));
      setSelection(null);
    } else if (panel.purpose === 'replace' && highlight !== null) {
      history.commit(replaceColor(doc, highlight, index));
      setHighlight(index);
      setPanel({ kind: 'colors' });
      return;
    }
    setPanel(null);
  };

  const undoRedo = (
    <>
      <IconButton name="undo" label="撤销" disabled={!history.canUndo} onClick={history.undo} />
      <IconButton name="redo" label="重做" disabled={!history.canRedo} onClick={history.redo} />
    </>
  );
  const doneButton = (
    <button type="button" className="text-btn" onClick={leaveEditing}>
      完成
    </button>
  );

  const usedSwatches = useMemo(() => {
    const list = counts.map((c) => c.index).slice(0, 20);
    return list.includes(brush) ? list : [brush, ...list];
  }, [counts, brush]);

  const title = mode === 'paint' ? '修豆块' : mode === 'select' ? '多选' : name;

  return (
    <div className={mode === 'select' ? 'screen result tall' : 'screen result'}>
      <Header
        title={title}
        left={editing ? doneButton : <IconButton name="back" label="返回项目页" onClick={onBack} />}
        right={undoRedo}
      />

      <div className="board">
        <BoardCanvas
          ref={board}
          doc={doc}
          colors={colors}
          view={view}
          highlight={highlight}
          mode={mode}
          tool={tool}
          brush={brush}
          selection={mode === 'select' ? selection : null}
          onStroke={(cells) => history.commit(commitCells(doc, cells))}
          onPick={(index) => {
            setBrush(index);
            setTool('brush');
          }}
          onSelection={setSelection}
          onZoomChange={setZoomed}
        />
        {tab === 'source' && !editing && (
          <div className="source-view">
            <img src={croppedUrl} alt="裁剪后的原图" />
          </div>
        )}
        <div className="board-tags">
          {doc.mirrored && <span className="tag">已左右镜像</span>}
          {highlight !== null && panel?.kind !== 'colors' && (
            <button type="button" className="tag tag-btn" onClick={() => setHighlight(null)}>
              只看 {colors[highlight].code}
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
        {zoomed && (tab !== 'source' || editing) && (
          <button type="button" className="fit-chip" onClick={() => board.current?.fit()}>
            <Icon name="fit" size={18} />
            <span>回到全图</span>
          </button>
        )}
      </div>

      {mode === 'view' && (
        <>
          <div className="pad">
            <Segmented
              label="视图"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'source', label: '原图' },
                { value: 'beads', label: '效果图' },
                { value: 'pattern', label: '图纸' },
              ]}
            />
          </div>
          <div className="pad tools">
            <Tool
              icon="mirror"
              label="左右镜像"
              active={doc.mirrored}
              disabled={tab === 'source'}
              onClick={() => history.commit(toggleMirror(doc))}
            />
            <Tool
              icon="bg"
              label="去除白底"
              active={doc.bgRestore !== null}
              disabled={tab === 'source'}
              onClick={() => history.commit(toggleBackground(doc, colors))}
            />
            <Tool icon="brush" label="修豆块" disabled={tab === 'source'} onClick={() => setMode('paint')} />
            <Tool icon="select" label="多选" disabled={tab === 'source'} onClick={() => setMode('select')} />
          </div>
          <button type="button" className="stats" aria-label="查看颜色清单" onClick={() => setPanel({ kind: 'colors' })}>
            <span className="stats-top">
              <span className="stats-text">
                <span className="stats-big">
                  {counts.length} 种颜色 <small>{brand.name}</small>
                </span>
                <span className="stats-sub">
                  {doc.w} × {doc.h} · 共 {total} 颗 · 成品约{' '}
                  {doc.w === doc.h ? `${finishedCm(doc.w)} cm` : `${finishedCm(doc.w)} × ${finishedCm(doc.h)} cm`}
                </span>
              </span>
              <Icon name="chev" size={20} />
            </span>
            <span className="stats-strip">
              {counts.slice(0, 7).map((c) => (
                <span key={c.index} className="stats-bead">
                  <BeadDot rgb={colors[c.index].rgb} size={26} />
                  <span>{colors[c.index].code}</span>
                </span>
              ))}
            </span>
          </button>
          <div className="cta">
            <button type="button" className="btn btn-2" onClick={() => setPanel({ kind: 'adjust' })}>
              <Icon name="sliders" size={20} />
              <span>调整图纸</span>
            </button>
            <button type="button" className="btn btn-1 grow" onClick={() => setPanel({ kind: 'save' })}>
              <Icon name="download" />
              <span>下载图纸</span>
            </button>
          </div>
        </>
      )}

      {mode === 'paint' && (
        <div className="pad edit-panel">
          <p className="note">单指涂色，双指移动和缩放</p>
          <Segmented
            label="修改工具"
            value={tool}
            onChange={setTool}
            options={[
              {
                value: 'brush',
                label: (
                  <>
                    <Icon name="brush" size={18} />
                    <span>涂色</span>
                  </>
                ),
              },
              {
                value: 'pick',
                label: (
                  <>
                    <Icon name="drop" size={18} />
                    <span>吸色</span>
                  </>
                ),
              },
              {
                value: 'erase',
                label: (
                  <>
                    <Icon name="erase" size={18} />
                    <span>清空</span>
                  </>
                ),
              },
            ]}
          />
          <div className="panel-head">
            <div className="label">这张图用到的颜色</div>
            <button type="button" className="link-btn" onClick={() => setPanel({ kind: 'picker', purpose: 'paint' })}>
              <span>全部色号</span>
              <Icon name="chev" size={16} />
            </button>
          </div>
          <div className="used-grid">
            {usedSwatches.map((index) => (
              <button
                type="button"
                key={index}
                className="swatch"
                aria-label={`颜色 ${colors[index].code}`}
                aria-pressed={index === brush && tool !== 'erase'}
                onClick={() => {
                  setBrush(index);
                  setTool('brush');
                }}
              >
                <BeadDot rgb={colors[index].rgb} size={30} />
                <span>{colors[index].code}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === 'select' && (
        <div className="pad edit-panel select-panel">
          {selectedCount > 0 ? (
            <>
              <div className="select-count">已选 {selectedCount} 格</div>
              <p className="note">{selectedBreakdown}</p>
            </>
          ) : (
            <>
              <div className="select-count">还没选格子</div>
              <p className="note">单指拖动选格子，双指移动和缩放</p>
            </>
          )}
          <div className="row-actions">
            <button type="button" className="btn btn-2" disabled={selectedCount === 0} onClick={() => setSelection(null)}>
              清除选择
            </button>
            <button
              type="button"
              className="btn btn-1 grow"
              disabled={selectedCount === 0}
              onClick={() => setPanel({ kind: 'picker', purpose: 'selection' })}
            >
              改选中
            </button>
          </div>
        </div>
      )}

      {panel?.kind === 'colors' && (
        <ColorsSheet
          brand={brand}
          cells={doc.cells}
          highlight={highlight}
          onHighlight={setHighlight}
          onReplace={() => setPanel({ kind: 'picker', purpose: 'replace' })}
          onClose={() => setPanel(null)}
        />
      )}
      {panel?.kind === 'picker' && (
        <PickerSheet
          brand={brand}
          cells={doc.cells}
          current={panel.purpose === 'paint' ? brush : null}
          sub={
            panel.purpose === 'selection'
              ? `点一个颜色，改好选中的 ${selectedCount} 格`
              : panel.purpose === 'replace' && highlight !== null
                ? `点一个颜色，替换全部 ${colors[highlight].code}`
                : undefined
          }
          onPick={applyPicked}
          onClose={() => setPanel(panel.purpose === 'replace' ? { kind: 'colors' } : null)}
        />
      )}
      {panel?.kind === 'save' && <SaveSheet doc={doc} brand={brand} onClose={() => setPanel(null)} />}
      {panel?.kind === 'adjust' && (
        <AdjustSheet
          params={params}
          grid={grid}
          ratio={ratio}
          followSize={followSize}
          edited={edited}
          onChange={onAdjust}
          onMyColors={onMyColors}
          onRecrop={() => {
            setPanel(null);
            onRecrop();
          }}
          onChangeImage={onChangeImage}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  );
}
