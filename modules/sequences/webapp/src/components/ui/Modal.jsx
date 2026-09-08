import { createContext, useContext, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
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

const ModalDepth = createContext(0);
const activeModals = [];
let bodyOverflow;
const topModal = () => activeModals.reduce((top, modal) => (
  !top || modal.depth >= top.depth ? modal : top
), null);

// Undo notifications render above dialogs. Their actions belong to the active
// operation and must remain reachable without exposing the rest of the page.
const notificationScopes = () => [...document.querySelectorAll('[data-modal-focus-scope]')];

function focusableElements(panel) {
  return [...panel.querySelectorAll('button, a[href], input, select, textarea, [tabindex], [contenteditable="true"]')]
    .filter((el) => el.tabIndex >= 0 && !el.matches(':disabled')
      && !el.closest('[hidden], [inert], [aria-hidden="true"]')
      && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden');
}

export default function Modal({
  open,
  onClose,
  title,
  children,
  footer = null,
  variant = 'center',
  size = 'md', // sm | md | lg | xl
  closeOnOverlay = true,
  'aria-label': ariaLabel,
}) {
  const t = useT(M);
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const depth = useContext(ModalDepth);
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;

    const previouslyFocused = document.activeElement;
    const modal = { panel: panelRef.current, depth };
    activeModals.push(modal);

    const handleKey = (e) => {
      if (topModal() !== modal || e.defaultPrevented) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current?.();
      } else if (e.key === 'Tab') {
        const items = [modal.panel, ...notificationScopes()].flatMap(focusableElements);
        const index = items.indexOf(document.activeElement);
        const next = index < 0 ? (e.shiftKey ? items.length - 1 : 0)
          : (index + (e.shiftKey ? -1 : 1) + items.length) % items.length;
        e.preventDefault();
        (items[next] || modal.panel).focus();
      }
    };
    const containFocus = (e) => {
      if (topModal() === modal && !modal.panel.contains(e.target)
        && !notificationScopes().some((scope) => scope.contains(e.target))) modal.panel.focus();
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('focusin', containFocus);

    // נעילת גלילה ברקע
    if (activeModals.length === 1) bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // העברת פוקוס לפאנל
    const t = window.setTimeout(() => {
      if (topModal() === modal) modal.panel.focus();
    }, 0);

    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('focusin', containFocus);
      activeModals.splice(activeModals.indexOf(modal), 1);
      if (!activeModals.length) document.body.style.overflow = bodyOverflow;
      window.clearTimeout(t);
      // החזרת פוקוס לאלמנט הקודם
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected
        && (!topModal() || topModal().panel.contains(previouslyFocused))) {
        previouslyFocused.focus();
      }
    };
  }, [open, depth]);

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
        'max-h-[90vh] min-w-0',
        widthMap[size] || widthMap.md,
        'animate-[modalIn_.2s_ease-out]', // כניסת fade+zoom (זהה לתחושת Dialog ב-Chatwoot)
      ].join(' ');

  return createPortal(
    <ModalDepth.Provider value={depth + 1}>
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
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
        tabIndex={-1}
        className={panelClasses}
      >
        {/* כותרת */}
        {title ? (
          <div className="flex items-start justify-between gap-3 shrink-0">
            <h2 id={titleId} className="min-w-0 break-words text-base font-medium leading-6 text-n-slate-12 m-0">{title}</h2>
            <Button
              variant="ghost"
              color="slate"
              size="sm"
              iconOnly
              icon={X}
              aria-label={t('close')}
              onClick={onClose}
              disabled={!onClose}
            />
          </div>
        ) : null}

        {/* תוכן */}
        <div className="overflow-y-auto grow min-h-0">{children}</div>

        {/* פעולות */}
        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-3 shrink-0">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
    </ModalDepth.Provider>,
    document.body
  );
}

// alias לפי הספֵק
export { Modal as Dialog };
