import { Loader2 } from 'lucide-react';

/*
 * Button — זהה לרכיב הכפתור של Chatwoot v4 (next design system).
 * משתמש אך ורק ב-n-tokens. מבנה המחלקות תואם 1:1 ל-Chatwoot.
 *
 * variant: solid | outline | faded | ghost | link
 * color:   blue | slate | ruby | amber | teal
 * size:    xs | sm | md | lg
 * loading: מציג ספינר (Loader2) במקום האייקון ומשבית את הכפתור — מצב טעינה אחיד.
 */

// בסיס משותף — זהה ל-Chatwoot (outline outline-1 + scale בלחיצה)
const base =
  'inline-flex items-center justify-center min-w-0 gap-2 transition-all duration-100 ease-out border-0 rounded-lg outline outline-1 disabled:opacity-50 font-medium select-none whitespace-nowrap active:enabled:scale-[0.98]';

// גדלים — וריאנט טקסט
const sizeClasses = {
  xs: 'h-6 px-2 text-xs',
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-5 text-base',
};

// אייקון-בלבד: ריבועי לפי הגובה
const iconOnlySizeClasses = {
  xs: 'h-6 w-6 p-0',
  sm: 'h-8 w-8 p-0',
  md: 'h-10 w-10 p-0',
  lg: 'h-12 w-12 p-0',
};

// solid — מילוי מלא לפי הצבע
const solidColor = {
  blue: 'bg-n-brand text-white hover:enabled:brightness-110 outline-transparent',
  ruby: 'bg-n-ruby-9 text-white hover:enabled:bg-n-ruby-10 outline-transparent',
  teal: 'bg-n-teal-9 text-white hover:enabled:bg-n-teal-10 outline-transparent',
  slate: 'bg-n-alpha-2 text-n-slate-12 hover:enabled:bg-n-alpha-3 outline-n-container',
  // amber — מילוי כפתור הענבר הייעודי של Chatwoot
  amber:
    'bg-n-solid-amber-button text-n-amber-12 hover:enabled:brightness-105 outline-transparent',
};

// faded — רקע עדין מאותו גוון
const fadedColor = {
  blue: 'bg-n-brand/10 text-n-blue-11 hover:enabled:bg-n-brand/20 outline-transparent',
  slate: 'bg-n-alpha-2 text-n-slate-12 hover:enabled:bg-n-alpha-3 outline-transparent',
  ruby: 'bg-n-ruby-3 text-n-ruby-11 hover:enabled:bg-n-ruby-4 outline-transparent',
  amber: 'bg-n-amber-3 text-n-amber-11 hover:enabled:bg-n-amber-4 outline-transparent',
  teal: 'bg-n-teal-3 text-n-teal-11 hover:enabled:bg-n-teal-4 outline-transparent',
};

// ghost — שקוף, hover עדין
const ghostColor = {
  blue: 'text-n-blue-11 hover:enabled:bg-n-alpha-2 outline-transparent',
  slate: 'text-n-slate-12 hover:enabled:bg-n-alpha-2 outline-transparent',
  ruby: 'text-n-ruby-11 hover:enabled:bg-n-alpha-2 outline-transparent',
  amber: 'text-n-amber-11 hover:enabled:bg-n-alpha-2 outline-transparent',
  teal: 'text-n-teal-11 hover:enabled:bg-n-alpha-2 outline-transparent',
};

// outline — מתאר בצבע
const outlineColor = {
  blue: 'text-n-blue-11 outline-n-brand hover:enabled:bg-n-brand/5',
  slate: 'text-n-slate-12 outline-n-strong hover:enabled:bg-n-alpha-2',
  ruby: 'text-n-ruby-11 outline-n-ruby-7 hover:enabled:bg-n-ruby-3',
  amber: 'text-n-amber-11 outline-n-amber-7 hover:enabled:bg-n-amber-3',
  teal: 'text-n-teal-11 outline-n-teal-7 hover:enabled:bg-n-teal-3',
};

// link — טקסט בלבד, קו תחתון ב-hover
const linkColor = {
  blue: 'text-n-blue-11 hover:underline outline-transparent px-0',
  slate: 'text-n-slate-11 hover:underline outline-transparent px-0',
  ruby: 'text-n-ruby-11 hover:underline outline-transparent px-0',
  amber: 'text-n-amber-11 hover:underline outline-transparent px-0',
  teal: 'text-n-teal-11 hover:underline outline-transparent px-0',
};

const variantMap = {
  solid: solidColor,
  faded: fadedColor,
  ghost: ghostColor,
  outline: outlineColor,
  link: linkColor,
};

export default function Button({
  children,
  variant = 'solid',
  color = 'blue',
  size = 'md',
  icon: Icon = null,
  trailingIcon: TrailingIcon = null,
  iconOnly = false,
  disabled = false,
  loading = false,
  type = 'button',
  className = '',
  ...props
}) {
  const colorClasses = (variantMap[variant] || solidColor)[color] || '';
  const dims = iconOnly ? iconOnlySizeClasses[size] : sizeClasses[size];

  const classes = [
    base,
    'focus-visible:outline-2 focus-visible:outline-n-brand focus-visible:outline-offset-1',
    'disabled:cursor-not-allowed disabled:pointer-events-none',
    iconOnly ? 'shrink-0' : '',
    dims,
    colorClasses,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  // גודל אייקון לפי גודל הכפתור
  const iconSize = size === 'xs' ? 14 : size === 'lg' ? 20 : 16;

  // בזמן טעינה: ספינר מחליף את האייקון המוביל, הכפתור מושבת (aria-busy לנגישות)
  const LeadingIcon = loading ? Loader2 : Icon;

  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes}
      {...props}
    >
      {LeadingIcon ? (
        <LeadingIcon
          size={iconSize}
          strokeWidth={2}
          aria-hidden="true"
          className={loading ? 'animate-spin' : undefined}
        />
      ) : null}
      {!iconOnly && children ? <span>{children}</span> : null}
      {iconOnly && !LeadingIcon && children ? children : null}
      {TrailingIcon && !loading ? (
        <TrailingIcon size={iconSize} strokeWidth={2} aria-hidden="true" />
      ) : null}
    </button>
  );
}
