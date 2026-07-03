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
            'w-full appearance-none bg-n-alpha-2 border border-n-weak rounded-lg',
            'ps-3 pe-9 h-10 text-sm text-n-slate-12',
            'outline-none transition-colors duration-150',
            'focus:border-n-brand focus:ring-1 focus:ring-n-brand/40',
            'disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
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
          className="pointer-events-none absolute top-1/2 -translate-y-1/2 end-3 text-n-slate-10"
        />
      </div>
    </div>
  );
});

export default Select;
