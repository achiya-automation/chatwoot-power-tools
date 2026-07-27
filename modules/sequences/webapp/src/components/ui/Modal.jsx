import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import Button from './Button.jsx';
import useT from '../../useT.js';

/*
 * Modal / Dialog — חלון מודאלי זהה לסגנון Chatwoot v4.
 * overlay כהה, כרטיס bg-n-solid-1, rounded-xl.
 * variant: 'center' (מודאל ממורכז) | 'drawer' (מגירה מהצד — RTL: נפתחת משמאל).
 * נגישות: role=dialog, aria-modal, סגירה ב-Escape, נעילת גלילת body, החזרת פוקוס.
 */

// מילון co-located (he/en)
const M = {
  he: { close: 'סגירה' },
  en: { close: 'Close' },
};

export default function Modal({
  open,
  onClose,
  title,
  children,
  footer = null,
  variant = 'center',
  size = 'md', // sm | md | lg | xl
  closeOnOverlay = true,
}) {
  const t = useT(M);
  const panelRef = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocused.current = document.activeElement;

    const handleKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handleKey);

    // נעילת גלילה ברקע
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // העברת פוקוס לפאנל
    const t = window.setTimeout(() => {
      panelRef.current?.focus();
    }, 0);

    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(t);
      // החזרת פוקוס לאלמנט הקודם
      if (previouslyFocused.current instanceof HTMLElement) {
        previouslyFocused.current.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  // רוחבי ה-Dialog של המקור. המידות הישנות (md=xl, lg=3xl, xl=5xl) נשמרות כאן כערכי
  // wide-* כי העורך ותצוגות רחבות אחרות באמת צריכים אותן — קריאה עם size רגיל מקבלת
  // את המידה הנייטיבית המדויקת.
  const widthMap = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    'wide-lg': 'max-w-3xl',
    'wide-xl': 'max-w-5xl',
  };

  const isDrawer = variant === 'drawer';

  const overlayClasses = isDrawer
    ? 'fixed inset-0 z-50 flex justify-start' // RTL: justify-start => הפאנל בצד שמאל המסך
    : 'fixed inset-0 z-50 flex items-center justify-center p-4';

  const panelClasses = isDrawer
    ? [
        'relative h-full w-full bg-n-solid-1 shadow-2xl flex flex-col',
        'border-e border-n-weak', // RTL: גבול בצד הפנימי
        widthMap[size] || widthMap.md,
        'animate-[slideIn_.2s_ease-out]',
      ].join(' ')
    : [
        // Dialog.vue: משטח מטושטש bg-n-alpha-3 + blur, בלי border, p-6 עם gap-6
        'relative w-full bg-n-alpha-3 backdrop-blur-[100px] rounded-xl shadow-xl flex flex-col gap-6 p-6',
        'max-h-[90vh]',
        widthMap[size] || widthMap.md,
        'animate-[modalIn_.2s_ease-out]', // כניסת fade+zoom (זהה לתחושת Dialog ב-Chatwoot)
      ].join(' ');

  return (
    <div className={overlayClasses} role="presentation">
      {/* overlay */}
      <div
        className="absolute inset-0 bg-n-alpha-black1 backdrop-blur-[4px] animate-[overlayIn_.15s_ease-out]"
        onClick={closeOnOverlay ? onClose : undefined}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={panelClasses}
      >
        {/* כותרת */}
        {title ? (
          <div className="flex items-center justify-between shrink-0">
            <h2 className="text-base font-medium leading-6 text-n-slate-12 m-0">{title}</h2>
            <Button
              variant="ghost"
              color="slate"
              size="sm"
              iconOnly
              icon={X}
              aria-label={t('close')}
              onClick={onClose}
            />
          </div>
        ) : null}

        {/* תוכן */}
        <div className="overflow-y-auto grow min-h-0">{children}</div>

        {/* פעולות */}
        {footer ? (
          <div className="flex items-center justify-between w-full gap-3 shrink-0 [&>*]:w-full">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// alias לפי הספֵק
export { Modal as Dialog };
