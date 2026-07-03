import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { X, Undo2, CheckCircle2, AlertCircle } from 'lucide-react';

/*
 * Toast — הודעות קצרות בתחתית המסך, בסגנון Chatwoot (n-tokens, כרטיס מרחף).
 * המטרה העיקרית: פעולת "ביטול" (Undo) אחרי מחיקה — כך אפשר להחזיר בטעות בלי לאבד עבודה.
 *
 * שימוש:
 *   const { toast } = useToast();
 *   toast({ message: 'השלב נמחק', action: { label: 'ביטול', onClick: undo } });
 *   toast({ message: 'נשמר', variant: 'success' });
 *
 * ה-Provider עוטף את האפליקציה (main.jsx). ה-viewport מרונדר בתוך ה-iframe.
 */

const ToastContext = createContext(null);

let _seq = 0;
const nextId = () => (_seq += 1);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
    const tm = timers.current.get(id);
    if (tm) {
      clearTimeout(tm);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (opts) => {
      const id = nextId();
      const t = {
        id,
        message: opts.message || '',
        action: opts.action || null, // { label, onClick }
        variant: opts.variant || 'default', // default | success | error
        duration: opts.duration ?? 5000,
      };
      setToasts((cur) => [...cur, t]);
      if (t.duration > 0) {
        timers.current.set(id, setTimeout(() => dismiss(id), t.duration));
      }
      return id;
    },
    [dismiss]
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

const VARIANT = {
  default: { icon: null, color: '' },
  success: { icon: CheckCircle2, color: 'text-n-teal-11' },
  error: { icon: AlertCircle, color: 'text-n-ruby-11' },
};

function ToastViewport({ toasts, dismiss }) {
  if (!toasts.length) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4"
      dir="rtl"
      role="region"
      aria-live="polite"
      aria-label="התראות"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ t, onDismiss }) {
  const v = VARIANT[t.variant] || VARIANT.default;
  const Icon = v.icon;
  return (
    <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border border-n-weak bg-n-solid-1 px-4 py-3 shadow-2xl animate-[toastIn_.2s_ease-out]">
      {Icon ? (
        <Icon size={18} className={`shrink-0 ${v.color}`} aria-hidden="true" />
      ) : null}
      <span className="grow text-sm text-n-slate-12">{t.message}</span>
      {t.action ? (
        <button
          type="button"
          onClick={() => {
            t.action.onClick();
            onDismiss();
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-n-blue-11 transition-colors hover:bg-n-alpha-2"
        >
          <Undo2 size={14} aria-hidden="true" />
          {t.action.label}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="סגירת ההתראה"
        className="shrink-0 rounded-md p-1 text-n-slate-10 transition-colors hover:bg-n-alpha-2 hover:text-n-slate-12"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
