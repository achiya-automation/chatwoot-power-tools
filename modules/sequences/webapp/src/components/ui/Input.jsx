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

  // Input.vue הנייטיבי: outline בלבד (בלי ring/border), רקע alpha-black2, מעבר 500ms
  const inputClasses = [
    'block w-full bg-n-alpha-black2 border-none rounded-lg px-3 h-10',
    'outline outline-1 outline-offset-[-1px]',
    'text-sm text-n-slate-12 placeholder:text-n-slate-10',
    'transition-all duration-500 ease-in-out',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    error
      ? 'outline-n-ruby-8 hover:outline-n-ruby-9 focus:outline-n-ruby-9'
      : 'outline-n-weak hover:outline-n-slate-6 focus:outline-n-brand',
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
      {error ? <p className="mt-1 text-label-small text-n-ruby-9">{error}</p> : null}
    </div>
  );
});

export default Input;
