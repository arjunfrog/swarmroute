import { useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ComponentPropsWithRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Small square "i" button. The explanation shows on hover, on keyboard focus, and on tap, so it
 * works for mouse, keyboard and touch. The bubble is portalled to <body> with fixed positioning,
 * so no scrolling panel or overflow container can clip it; it is clamped to the viewport and flips
 * above the icon when there is no room below.
 */
export function Info({ children, align = 'left', label = 'What does this do?' }: { children: ReactNode; align?: 'left' | 'right'; label?: string }) {
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const open = hover || focused || pinned;

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const btn = btnRef.current;
      const tip = tipRef.current;
      if (!btn || !tip) return;
      const b = btn.getBoundingClientRect();
      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      const m = 8;
      let left = align === 'right' ? b.right - w : b.left;
      left = Math.min(Math.max(m, left), window.innerWidth - m - w);
      let top = b.bottom + m;
      if (top + h > window.innerHeight - m && b.top - m - h >= m) top = b.top - m - h;
      setPos({ top, left });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, align]);

  return (
    <span className="inline-flex shrink-0 align-middle">
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setPinned(false);
        }}
        onClick={() => setPinned((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setPinned(false);
            setFocused(false);
            setHover(false);
          }
        }}
        className="grid h-[18px] w-[18px] place-items-center border-2 border-current font-mono text-[11px] leading-none font-medium hover:bg-ink hover:text-paper"
      >
        i
      </button>
      {open &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            id={id}
            style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            className="pointer-events-none z-[1000] w-64 max-w-[calc(100vw-16px)] border-2 border-ink bg-paper p-3 text-left text-sm leading-snug font-normal text-ink shadow-[4px_4px_0_0_var(--color-ink)]"
          >
            {children}
          </div>,
          document.body,
        )}
    </span>
  );
}

type Variant = 'primary' | 'dark' | 'outline';
const VARIANTS: Record<Variant, string> = {
  primary: 'border-ink bg-accent text-on-accent hover:bg-accent-hover',
  dark: 'border-ink bg-ink text-paper hover:bg-accent hover:text-on-accent',
  outline: 'border-ink bg-transparent text-ink hover:bg-ink hover:text-paper',
};
const SIZES = { sm: 'px-3 py-1.5 text-sm', md: 'px-5 py-2.5 text-base', lg: 'px-6 py-3 text-lg' };

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ComponentPropsWithRef<'button'> & { variant?: Variant; size?: keyof typeof SIZES }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center gap-2 border-2 font-bold transition-colors disabled:cursor-not-allowed disabled:border-muted disabled:bg-transparent disabled:text-muted ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    />
  );
}

/** A button that looks like a link: underlined, colour shift on hover. */
export function TextButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`font-bold underline decoration-2 underline-offset-4 hover:text-accent disabled:cursor-not-allowed disabled:text-muted ${className}`}
    />
  );
}

export function Slider({
  label,
  info,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  disabled,
}: {
  label: string;
  info?: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={disabled ? 'text-muted' : ''}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <label htmlFor={id} className="font-bold">
            {label}
          </label>
          {info && <Info>{info}</Info>}
        </span>
        <output htmlFor={id} className="font-mono text-sm">
          {format ? format(value) : value}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function Check({
  label,
  checked,
  onChange,
  info,
  disabled,
  swatch,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  info?: ReactNode;
  disabled?: boolean;
  swatch?: string;
}) {
  const id = useId();
  return (
    <div className={`flex items-center gap-3 ${disabled ? 'text-muted' : ''}`}>
      <input id={id} type="checkbox" className="check" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {swatch && <span className="h-3 w-3 shrink-0 border border-ink" style={{ background: swatch }} />}
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {info && <Info>{info}</Info>}
    </div>
  );
}

export function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex border-2 border-ink">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 text-sm font-bold ${i > 0 ? 'border-l-2 border-ink' : ''} ${value === o.value ? 'bg-ink text-paper' : 'hover:bg-paper-2'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type="number"
        className="w-24 border-2 border-ink bg-paper px-2 py-1 text-right font-mono text-sm outline-none focus:bg-paper-2"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
    </div>
  );
}

export function Bar({ value, color = 'var(--color-accent)', light }: { value: number; color?: string; light?: boolean }) {
  return (
    <div className={`h-2.5 w-full border ${light ? 'border-band-ink' : 'border-ink'}`}>
      <div className="h-full" style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, background: color }} />
    </div>
  );
}

export function Swatch({ color, className = '' }: { color: string; className?: string }) {
  return <span className={`inline-block h-3 w-3 shrink-0 border border-ink ${className}`} style={{ background: color }} />;
}
