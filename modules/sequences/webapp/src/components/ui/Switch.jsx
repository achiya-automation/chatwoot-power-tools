import React, { useId } from 'react';

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
        'relative inline-flex items-center shrink-0 h-5 w-9 rounded-full',
        'transition-colors duration-200 ease-in-out',
        'focus-visible:outline-2 focus-visible:outline-n-brand focus-visible:outline-offset-2',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        checked ? 'bg-n-brand' : 'bg-n-slate-6',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* ה-thumb: ב-RTL "on" => זז שמאלה, "off" => ימינה */}
      <span
        className={[
          'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm',
          'transition-transform duration-200 ease-in-out',
          'absolute top-0.5',
          checked ? 'ltr:left-[18px] rtl:right-[18px]' : 'ltr:left-0.5 rtl:right-0.5',
        ].join(' ')}
      />
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
