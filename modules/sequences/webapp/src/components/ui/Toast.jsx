import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import useT, { useLocale } from '../../useT.js';
import { dirFor } from '../../i18n.js';

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

// מילון co-located (he/en)
const M = {
  he: { notifications: 'התראות' },
  en: { notifications: 'Notifications' },
};

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

function ToastViewport({ toasts, dismiss }) {
  const t = useT(M);
  const locale = useLocale();
  if (!toasts.length) return null;
  return (
    <div
      className="pointer-events-none fixed top-4 left-1/2 -translate-x-1/2 z-[60] flex w-[calc(100%-2rem)] max-w-[25rem] flex-col items-center gap-0 px-0"
      dir={dirFor(locale)}
      role="region"
      aria-live="polite"
      aria-label={t('notifications')}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ t, onDismiss }) {
  return (
    // Snackbar.vue של המקור: גלולה כהה הפוכה (bg-n-slate-12 / דארק slate-7), טקסט לבן,
    // פעולה כקישור text-n-blue-10. אין אייקוני-וריאנט ואין כפתור X במקור — ה-Undo נשאר
    // (יכולת מכוונת), מעוצב כקישור הפעולה הנייטיבי. `variant` עדיין מתקבל מהקוראים
    // (success/error) אבל אינו משנה מראה — למקור אין הבחנה ויזואלית בין סוגי ההודעות.
    <div className="pointer-events-auto inline-flex items-center gap-3 rounded-lg bg-n-slate-12 dark:bg-n-slate-7 shadow-sm px-6 py-3 min-h-[1.875rem] min-w-[15rem] max-w-[25rem] mb-2 animate-[toastIn_.2s_ease-out]">
      <span className="grow text-sm font-medium text-white dark:text-white">{t.message}</span>
      {t.action ? (
        <button
          type="button"
          onClick={() => {
            t.action.onClick();
            onDismiss();
          }}
          className="shrink-0 cursor-pointer select-none text-sm font-medium text-n-blue-10 hover:text-n-brand"
        >
          {t.action.label}
        </button>
      ) : null}
    </div>
  );
}
