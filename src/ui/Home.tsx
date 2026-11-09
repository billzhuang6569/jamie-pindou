import { useEffect, useMemo, useRef, useState } from 'react';
import hero from '../assets/hero.png';
import { colorCounts, type PatternDoc } from '../core/doc';
import { brandById } from '../core/palette';
import { BOARD, paintBeads } from '../core/render';
import type { Project } from '../storage';
import { ConfirmSheet, GithubMark, Icon, Sheet } from './parts';

export const REPO_URL = 'https://github.com/billzhuang6569/jamie-pindou';

function ProjectThumb({ doc, brandId, image }: { doc: PatternDoc | null; brandId: string; image: Blob }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const url = useMemo(() => (doc ? '' : URL.createObjectURL(image)), [doc, image]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  useEffect(() => {
    const el = ref.current;
    const ctx = el?.getContext('2d');
    if (!doc || !el || !ctx) return;
    const side = Math.max(doc.w, doc.h) + 2;
    const cell = Math.max(1, Math.floor(420 / side));
    el.width = el.height = side * cell;
    ctx.fillStyle = BOARD;
    ctx.fillRect(0, 0, el.width, el.height);
    const ox = Math.floor((side - doc.w) / 2) * cell;
    const oy = Math.floor((side - doc.h) / 2) * cell;
    paintBeads(ctx, doc.cells, doc.w, brandById(brandId).colors, { x0: 0, y0: 0, x1: doc.w, y1: doc.h }, cell, ox, oy, null);
  }, [doc, brandId]);
  return doc ? <canvas ref={ref} className="thumb" aria-hidden="true" /> : <img className="thumb thumb-image" src={url} alt="" />;
}

function whenLabel(ms: number) {
  const now = new Date();
  const d = new Date(ms);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (Date.now() - ms < 60_000) return '刚刚';
  if (sameDay(d, now)) return `今天 ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return `昨天 ${time}`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function ProjectCard({ project, onOpen, onMenu }: { project: Project; onOpen: () => void; onMenu: () => void }) {
  const { doc, name, params, image, updatedAt } = project;
  const colors = useMemo(() => (doc ? colorCounts(doc.cells).length : 0), [doc]);
  return (
    <article className="project-card">
      <button type="button" className="project-open" aria-label={`打开 ${name}`} onClick={onOpen}>
        <ProjectThumb doc={doc} brandId={params.brandId} image={image} />
        <span className="project-text">
          <span className="project-name">{name}</span>
          <span className="project-meta">{doc ? `${doc.w} × ${doc.h} · ${colors} 种颜色` : '还没生成图纸'}</span>
          <span className="project-meta">{whenLabel(updatedAt)}</span>
        </span>
      </button>
      <button type="button" className="project-more" aria-label={`${name} 的更多操作`} onClick={onMenu}>
        <Icon name="more" size={20} />
      </button>
    </article>
  );
}

function ProjectMenu({
  project,
  onRename,
  onDelete,
  onClose,
}: {
  project: Project;
  onRename: (name: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(project.name);
  const trimmed = name.trim();
  const { doc } = project;
  return (
    <Sheet title={project.name} sub={doc ? `${doc.w} × ${doc.h}` : undefined} onClose={onClose}>
      <div className="menu-field">
        <label htmlFor="project-name">图纸名称</label>
        <input
          id="project-name"
          value={name}
          maxLength={30}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && trimmed) onRename(trimmed);
          }}
        />
      </div>
      <div className="row-actions sheet-actions">
        <button type="button" className="btn btn-2" onClick={onDelete}>
          删除图纸
        </button>
        <button type="button" className="btn btn-1 grow" disabled={!trimmed} onClick={() => onRename(trimmed)}>
          保存
        </button>
      </div>
    </Sheet>
  );
}

export function Home({
  projects,
  onNew,
  onCamera,
  onOpen,
  onRename,
  onDelete,
}: {
  projects: Project[];
  onNew: () => void;
  onCamera: () => void;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [menu, setMenu] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const menuProject = projects.find((p) => p.id === menu);
  const deletingProject = projects.find((p) => p.id === deleting);
  const github = (
    <a className="github-btn" href={REPO_URL} target="_blank" rel="noreferrer" aria-label="在 GitHub 上查看开源仓库">
      <GithubMark />
    </a>
  );
  const actions = (
    <div className="row-actions">
      <button type="button" className="btn btn-1 grow" onClick={onNew}>
        <Icon name="plus" />
        <span>新建图纸</span>
      </button>
      <button type="button" className="btn btn-2" onClick={onCamera}>
        <Icon name="camera" size={20} />
        <span>拍照</span>
      </button>
    </div>
  );
  const license = (
    <a className="source-link" href={REPO_URL} target="_blank" rel="noreferrer">
      开源项目（AGPL-3.0）· 查看源代码
    </a>
  );
  const heroAlt = '用彩色拼豆拼出的“拼豆台”三个字，放在透明豆板上';

  if (projects.length === 0) {
    return (
      <div className="screen home home-empty">
        <div className="hero-board">
          <img className="hero" src={hero} alt={heroAlt} />
          {github}
        </div>
        <main className="home-main">
          <div className="eyebrow">Jamie的拼豆台</div>
          <h1>选一张图，做一张照着拼的图纸</h1>
          <p>每格标好色号，每种颜色算好颗数。图片只在这台手机上处理，不会上传。</p>
          {actions}
          {license}
        </main>
      </div>
    );
  }

  return (
    <div className="screen home">
      <div className="hero-band">
        <img src={hero} alt={heroAlt} />
        {github}
      </div>
      <div className="pad-new">{actions}</div>
      <section className="projects" aria-label="我的图纸">
        <h1>我的图纸</h1>
        <div className="project-grid">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} onOpen={() => onOpen(p.id)} onMenu={() => setMenu(p.id)} />
          ))}
        </div>
        {license}
      </section>
      {menuProject && (
        <ProjectMenu
          project={menuProject}
          onClose={() => setMenu(null)}
          onRename={(name) => {
            onRename(menuProject.id, name);
            setMenu(null);
          }}
          onDelete={() => {
            setMenu(null);
            setDeleting(menuProject.id);
          }}
        />
      )}
      {deletingProject && (
        <ConfirmSheet
          title="删除这张图纸？"
          body={`“${deletingProject.name}”和上面的修改都会从这台手机上删除，无法恢复。`}
          confirm="删除"
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            onDelete(deletingProject.id);
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
}
