import { useEffect, useRef, type ReactNode } from 'react';
import { rgbCss, type RGB } from '../core/color';

const PATHS: Record<string, ReactNode> = {
  back: <path d="M15 18l-6-6 6-6" />,
  chev: <path d="M9 18l6-6-6-6" />,
  undo: (
    <>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </>
  ),
  redo: (
    <>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </>
  ),
  mirror: (
    <>
      <path d="M12 3v18" />
      <path d="M8 7l-5 5 5 5z" />
      <path d="M16 7l5 5-5 5z" />
    </>
  ),
  bg: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" strokeDasharray="3 3" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  brush: <path d="M4 20l1-4L16 5a2.1 2.1 0 0 1 3 3L8 19z" />,
  select: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 16l-5-5L6 20" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11" />
      <path d="M7 11l5 5 5-5" />
      <path d="M5 20h14" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </>
  ),
  fit: (
    <>
      <path d="M4 9V4h5" />
      <path d="M20 9V4h-5" />
      <path d="M4 15v5h5" />
      <path d="M20 15v5h-5" />
    </>
  ),
  drop: (
    <>
      <path d="M14 4l6 6-2 2-6-6z" />
      <path d="M13 7l-8 8v4h4l8-8" />
    </>
  ),
  erase: (
    <>
      <path d="M8 20h12" />
      <path d="M5 15l9-9 5 5-8 9H8z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4-4" />
    </>
  ),
};

export function Icon({ name, size = 22 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

export function BeadDot({ rgb, size = 28 }: { rgb: RGB; size?: number }) {
  return (
    <span className="bead" aria-hidden="true" style={{ width: size, height: size, background: rgbCss(rgb) }}>
      <span />
    </span>
  );
}

export function IconButton({
  name,
  label,
  onClick,
  disabled,
}: {
  name: keyof typeof PATHS;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="icon-btn" aria-label={label} onClick={onClick} disabled={disabled}>
      <Icon name={name} />
    </button>
  );
}

export function Header({ title, left, right }: { title: string; left?: ReactNode; right?: ReactNode }) {
  return (
    <header className="top">
      <div className="top-side">{left}</div>
      <h1>{title}</h1>
      <div className="top-side top-right">{right}</div>
    </header>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          type="button"
          key={String(o.value)}
          aria-pressed={o.value === value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A bottom sheet. With `modal` off, the page above stays visible and usable. */
export function Sheet({
  title,
  sub,
  onClose,
  height,
  modal = true,
  children,
}: {
  title: string;
  sub?: ReactNode;
  onClose: () => void;
  height?: string;
  modal?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, []);
  return (
    <>
      {modal && <div className="backdrop" onClick={onClose} />}
      <section
        ref={ref}
        className="sheet"
        role="dialog"
        aria-modal={modal}
        aria-label={title}
        tabIndex={-1}
        style={height ? { height } : undefined}
      >
        <div className="sheet-head">
          <div className="sheet-title">
            <h2>{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          <IconButton name="close" label="关闭" onClick={onClose} />
        </div>
        {children}
      </section>
    </>
  );
}

export function ConfirmSheet({
  title,
  body,
  confirm,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirm: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <p className="sheet-body">{body}</p>
      <div className="row-actions sheet-actions">
        <button type="button" className="btn btn-2" onClick={onClose}>
          取消
        </button>
        <button type="button" className="btn btn-1 grow" onClick={onConfirm}>
          {confirm}
        </button>
      </div>
    </Sheet>
  );
}
