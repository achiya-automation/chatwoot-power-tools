import React, { useId } from 'react';

/*
 * Input — זהה לשדה הקלט של Chatwoot v4.
 * תמיד עם label לנגישות. תומך type=text/number/time וכו'.
 */

export function Label({ htmlFor, children, className = '' }) {
  return (
    <label
      htmlFor={htmlFor}
      className={`block text-sm font-medium text-n-slate-12 mb-1.5 ${className}`}
    >
      {children}
    </label>
  );
}

const Input = React.forwardRef(function Input(
  {
    label,
    id,
    type = 'text',
    error = '',
    hint = '',
    className = '',
    containerClassName = '',
    ...props
  },
  ref
) {
  const generatedId = useId();
  const inputId = id || generatedId;

  const inputClasses = [
    'w-full bg-n-alpha-2 border border-n-weak rounded-lg px-3 h-10',
    'text-sm text-n-slate-12 placeholder:text-n-slate-10',
    'outline-none transition-colors duration-150',
    'focus:border-n-brand focus:ring-1 focus:ring-n-brand/40',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    error ? 'border-n-ruby-9 focus:border-n-ruby-9 focus:ring-n-ruby-9/30' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={containerClassName}>
      {label ? <Label htmlFor={inputId}>{label}</Label> : null}
      <input
        ref={ref}
        id={inputId}
        type={type}
        className={inputClasses}
        aria-invalid={error ? 'true' : undefined}
        {...props}
      />
      {hint && !error ? (
        <p className="mt-1 text-xs text-n-slate-11">{hint}</p>
      ) : null}
      {error ? <p className="mt-1 text-xs text-n-ruby-11">{error}</p> : null}
    </div>
  );
});

export default Input;
