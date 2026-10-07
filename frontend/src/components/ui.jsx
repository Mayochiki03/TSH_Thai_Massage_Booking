import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Loader2, X, CircleCheck, CircleAlert, Info } from 'lucide-react';
import { STATUS } from '../lib/format.js';

const cx = (...c) => c.filter(Boolean).join(' ');
export { cx };

// ---------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------
const BTN = {
  primary: 'bg-herb text-white hover:bg-herb-dark active:bg-herb-dark disabled:bg-line disabled:text-faint',
  soft: 'bg-leaf-soft text-herb hover:bg-leaf active:bg-leaf disabled:opacity-50',
  outline: 'border border-line bg-paper text-ink hover:border-herb hover:text-herb disabled:opacity-50',
  ghost: 'text-muted hover:bg-mist hover:text-ink disabled:opacity-50',
  danger: 'bg-rose-soft text-rose-ink hover:bg-[#f2d3ce] disabled:opacity-50',
};
const SIZE = { sm: 'h-9 px-3 text-[15px] rounded-lg gap-1.5', md: 'h-12 px-5 rounded-xl gap-2', lg: 'h-14 px-6 text-lg rounded-2xl gap-2' };

export function Button({ variant = 'primary', size = 'md', loading, icon: Icon, className, children, ...rest }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className={cx('inline-flex items-center justify-center whitespace-nowrap font-display font-medium transition-colors select-none', BTN[variant], SIZE[size], className)}
    >
      {loading ? <Loader2 className="size-5 animate-spin" aria-hidden /> : Icon && <Icon className="size-5 shrink-0" aria-hidden />}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------
// Form field
// ---------------------------------------------------------------------
export function Field({ label, hint, error, children, className }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-[15px] font-medium text-ink">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-sm text-rose-ink">{error}</span>
        : hint ? <span className="mt-1 block text-sm text-faint">{hint}</span> : null}
    </label>
  );
}

export const inputCls = 'w-full h-12 rounded-xl border border-line bg-paper px-4 text-[17px] placeholder:text-faint focus:border-herb focus:outline-none focus:ring-4 focus:ring-leaf transition';

export function Input({ className, ...rest }) {
  return <input {...rest} className={cx(inputCls, className)} />;
}

export function Textarea({ className, ...rest }) {
  return <textarea {...rest} className={cx(inputCls, 'h-auto min-h-24 py-3 leading-relaxed', className)} />;
}

// ---------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------
const TONE = {
  leaf: 'bg-leaf text-herb',
  herb: 'bg-herb text-white',
  sky: 'bg-sky-soft text-sky-ink',
  turmeric: 'bg-turmeric-soft text-[#7a5e0e]',
  rose: 'bg-rose-soft text-rose-ink',
  stone: 'bg-stone-soft text-stone-ink',
};

export function StatusBadge({ status, className }) {
  const s = STATUS[status] ?? { label: status, tone: 'stone' };
  return (
    <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-medium whitespace-nowrap', TONE[s.tone], className)}>
      {s.label}
    </span>
  );
}

export function Spinner({ label = 'กำลังโหลด' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted" role="status">
      <Loader2 className="size-7 animate-spin text-herb" aria-hidden />
      <span className="text-[15px]">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------
// Sheet (มือถือ: เลื่อนขึ้นจากล่าง / จอใหญ่: กลางจอ)
// ---------------------------------------------------------------------
export function Sheet({ open, onClose, title, children, footer, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector('input,textarea,select,button')?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="anim-fade absolute inset-0 bg-ink/40" onClick={onClose} />
      <div
        ref={ref}
        className={cx(
          'anim-sheet relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-paper sm:rounded-3xl',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-md',
        )}
      >
        <div className="flex items-center justify-between gap-4 px-5 pt-5 pb-3">
          <h2 className="text-xl font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-full text-muted hover:bg-mist" aria-label="ปิด">
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <div className="border-t border-line px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

/** หน้าต่างยืนยัน — คืน Promise<boolean> */
const ConfirmCtx = createContext(null);
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const confirm = useCallback((opts) => new Promise((resolve) => setState({ ...opts, resolve })), []);
  const close = (v) => { state?.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Sheet
        open={!!state}
        onClose={() => close(false)}
        title={state?.title}
        footer={
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => close(false)}>{state?.cancelText ?? 'กลับ'}</Button>
            <Button variant={state?.danger ? 'danger' : 'primary'} className="flex-1" onClick={() => close(true)}>{state?.okText ?? 'ยืนยัน'}</Button>
          </div>
        }
      >
        <div className="text-muted">{state?.body}</div>
      </Sheet>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

// ---------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------
const ToastCtx = createContext(null);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, type = 'success') => {
    const id = Math.random();
    setItems((s) => [...s, { id, message, type }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), type === 'error' ? 5000 : 3000);
  }, []);
  const icons = { success: CircleCheck, error: CircleAlert, info: Info };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((t) => {
          const Icon = icons[t.type];
          return (
            <div
              key={t.id}
              className={cx(
                'anim-rise pointer-events-auto flex max-w-md items-start gap-2.5 rounded-2xl px-4 py-3 text-[15px] shadow-lg shadow-ink/10',
                t.type === 'error' ? 'bg-rose-soft text-rose-ink' : t.type === 'info' ? 'bg-sky-soft text-sky-ink' : 'bg-herb text-white',
              )}
            >
              <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
              <span>{t.message}</span>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------
export function Empty({ icon: Icon, title, children, action }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {Icon && <Icon className="mb-3 size-10 text-faint" strokeWidth={1.5} aria-hidden />}
      <p className="font-display text-lg font-medium">{title}</p>
      {children && <p className="mt-1 max-w-xs text-[15px] text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
