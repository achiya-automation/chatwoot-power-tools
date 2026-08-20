import React, { useId } from 'react';
import { ChevronDown } from 'lucide-react';

/*
 * Select — בורר נפתח זהה לסגנון Chatwoot v4.
 * משתמש ב-<select> מקורי (נגיש) עם עיצוב n-tokens + אייקון chevron.
 */

const Select = React.forwardRef(function Select(
  {
    label,
    id,
    options = [], // [{ value, label }]
    children,
    className = '',
    containerClassName = '',
    ...props
  },
  ref
) {
  const generatedId = useId();
  const selectId = id || generatedId;

  return (
    <div className={containerClassName}>
      {label ? (
        <label
          htmlFor={selectId}
          className="block text-sm font-medium text-n-slate-12 mb-1.5"
        >
          {label}
        </label>
      ) : null}
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          className={[
            // select/Select.vue הנייטיבי: outline בלבד על bg-n-surface-1
            'w-full appearance-none bg-n-surface-1 border-none rounded-lg',
            'outline outline-1 -outline-offset-1 outline-n-weak hover:outline-n-slate-6 focus:outline-n-blue-9',
            // ⚠️ ריווח פיזי (px-3 pr-10) ולא לוגי: ב-Select.vue הנייטיבי החץ נשאר בצד ימין
            // גם בעברית, וכל שאר התפריטים של Chatwoot ליד הפאנל נראים כך.
            'px-3 pr-10 h-10 text-sm text-n-slate-12',
            'transition-all duration-200',
            'disabled:bg-n-slate-2 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
          {...props}
        >
          {children ||
            options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
        </select>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 -translate-y-1/2 right-3 text-n-slate-11"
        />
      </div>
    </div>
  );
});

export default Select;
