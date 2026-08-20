import { useId } from 'react';

/*
 * Switch (toggle) — זהה למתג של Chatwoot v4.
 * track: bg-n-slate-6 כבוי / bg-n-brand דלוק. thumb לבן.
 * RTL-aware: ה-thumb זז לכיוון הנכון לפי dir.
 */

export default function Switch({
  checked = false,
  onChange,
  disabled = false,
  id,
  label,
  'aria-label': ariaLabel,
  className = '',
}) {
  const generatedId = useId();
  const switchId = id || generatedId;

  const handleToggle = () => {
    if (disabled) return;
    onChange?.(!checked);
  };

  const button = (
    <button
      type="button"
      role="switch"
      id={switchId}
      aria-checked={checked}
      aria-label={!label ? ariaLabel : undefined}
      disabled={disabled}
      onClick={handleToggle}
      className={[
        // זהה ל-Switch.vue של המקור: track h-4 w-7, פוקוס ring, תנועת צבע 200ms
        'group relative h-4 w-7 rounded-full flex-shrink-0 select-none',
        'transition-colors duration-200 ease-in-out',
        'focus:outline-none focus:ring-1 focus:ring-n-brand focus:ring-offset-2 focus:ring-offset-n-slate-2',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        checked ? 'bg-n-brand' : 'bg-n-slate-6',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* thumb — h-3 w-3 bg-n-background (מתכהה בדארק כמו במקור), תנועה קפיצית +
          מתיחה קלה בלחיצה (group-active) — הקלאסים מהמקור אחד-לאחד */}
      <span
        className={[
          'absolute top-1/2 -translate-y-1/2 ltr:left-0.5 rtl:right-0.5',
          'transition-transform duration-[350ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]',
          // בלחיצה ה-thumb נמתח (group-active:w-[18px] למטה) ובמקביל נמשך מעט אחורה,
          // אחרת הקצה המתוח חורג מה-track. שני הקלאסים מגיעים בזוג ב-Switch.vue.
          checked
            ? 'ltr:translate-x-3 rtl:-translate-x-3 group-active:ltr:translate-x-[6px] rtl:group-active:-translate-x-[6px]'
            : 'translate-x-0',
        ].join(' ')}
      >
        <span className="block h-3 w-3 rounded-full bg-n-background shadow-md transition-[width] duration-[180ms] ease-in-out group-active:w-[18px]" />
      </span>
    </button>
  );

  if (!label) return button;

  return (
    <div className="inline-flex items-center gap-2">
      {button}
      <label
        htmlFor={switchId}
        className="text-sm font-medium text-n-slate-12 cursor-pointer select-none"
      >
        {label}
      </label>
    </div>
  );
}
