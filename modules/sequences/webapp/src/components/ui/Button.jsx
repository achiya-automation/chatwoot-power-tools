import { Loader2 } from 'lucide-react';

/*
 * Button — זהה לרכיב הכפתור של Chatwoot v4 (components-next/button/Button.vue).
 * מפות הצבע/גודל/אנימציה הועתקו אחד-לאחד מ-STYLE_CONFIG של המקור (4.16.1).
 *
 * variant: solid | outline | faded | ghost | link
 * color:   blue | slate | ruby | amber | teal
 * size:    xs | sm | md | lg
 * loading: מציג ספינר במקום האייקון ומשבית את הכפתור — מצב טעינה אחיד.
 */

// base — זהה למקור, בתוספת justify-center (המקור מיישר דרך prop justify; center הוא
// ברירת המחדל שלו בפועל בכל השימושים הרלוונטיים כאן)
const base =
  'inline-flex items-center justify-center min-w-0 gap-2 transition-all duration-100 ease-out border-0 rounded-lg outline-1 outline disabled:opacity-50';

// sizes.regular / sizes.iconOnly / sizes.link — כמו במקור
const sizeClasses = {
  xs: 'h-6 px-2',
  sm: 'h-8 px-3',
  md: 'h-10 px-4',
  lg: 'h-12 px-5',
};
const iconOnlySizeClasses = {
  xs: 'h-6 w-6 p-0',
  sm: 'h-8 w-8 p-0',
  md: 'h-10 w-10 p-0',
  lg: 'h-12 w-12 p-0',
};

// fontSize — במקור רק md נושא font-medium
const fontSizeClasses = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-sm font-medium',
  lg: 'text-base',
};

// clickAnimation — xs/sm מתכווצים מעט יותר
const clickAnimation = {
  xs: 'active:enabled:scale-[0.97]',
  sm: 'active:enabled:scale-[0.97]',
  md: 'active:enabled:scale-[0.98]',
  lg: 'active:enabled:scale-[0.98]',
};

// COLOR MAP — העתק מדויק של STYLE_CONFIG.colors מהמקור
const COLORS = {
  blue: {
    solid: 'bg-n-brand text-white hover:enabled:brightness-110 focus-visible:brightness-110 outline-transparent',
    faded: 'bg-n-brand/10 text-n-blue-11 hover:enabled:bg-n-brand/20 focus-visible:bg-n-brand/20 outline-transparent',
    outline: 'text-n-blue-11 outline-n-brand',
    ghost: 'text-n-blue-11 hover:enabled:bg-n-alpha-2 focus-visible:bg-n-alpha-2 outline-transparent',
    link: 'text-n-blue-11 hover:enabled:underline focus-visible:underline outline-transparent',
  },
  ruby: {
    solid: 'bg-n-ruby-9 text-white hover:enabled:bg-n-ruby-10 focus-visible:bg-n-ruby-10 outline-transparent',
    faded: 'bg-n-ruby-9/10 text-n-ruby-11 hover:enabled:bg-n-ruby-9/20 focus-visible:bg-n-ruby-9/20 outline-transparent',
    outline: 'text-n-ruby-11 hover:enabled:bg-n-ruby-9/10 focus-visible:bg-n-ruby-9/10 outline-n-ruby-8',
    ghost: 'text-n-ruby-11 hover:enabled:bg-n-alpha-2 focus-visible:bg-n-alpha-2 outline-transparent',
    link: 'text-n-ruby-9 dark:text-n-ruby-11 hover:enabled:underline focus-visible:underline outline-transparent',
  },
  amber: {
    solid: 'bg-n-amber-9 text-white hover:enabled:bg-n-amber-10 focus-visible:bg-n-amber-10 outline-transparent',
    faded: 'bg-n-amber-9/10 text-n-slate-12 hover:enabled:bg-n-amber-9/20 focus-visible:bg-n-amber-9/20 outline-transparent',
    outline: 'text-n-amber-11 hover:enabled:bg-n-amber-9/10 focus-visible:bg-n-amber-9/10 outline-n-amber-9',
    ghost: 'text-n-amber-9 hover:enabled:bg-n-alpha-2 focus-visible:bg-n-alpha-2 outline-transparent',
    link: 'text-n-amber-9 hover:enabled:underline focus-visible:underline outline-transparent',
  },
  slate: {
    solid: 'bg-n-button-color dark:hover:enabled:bg-n-solid-2 dark:focus-visible:bg-n-solid-2 hover:enabled:bg-n-alpha-2 focus-visible:bg-n-alpha-2 text-n-slate-12 outline-n-container',
    faded: 'bg-n-slate-9/10 text-n-slate-12 hover:enabled:bg-n-slate-9/20 focus-visible:bg-n-slate-9/20 outline-transparent',
    outline: 'text-n-slate-11 outline-n-strong hover:enabled:bg-n-slate-9/10 focus-visible:bg-n-slate-9/10',
    ghost: 'text-n-slate-12 hover:enabled:bg-n-alpha-2 focus-visible:bg-n-alpha-2 outline-transparent',
    link: 'text-n-slate-11 hover:enabled:text-n-slate-12 focus-visible:text-n-slate-12 hover:enabled:underline focus-visible:underline outline-transparent',
  },
  teal: {
    solid: 'bg-n-teal-9 text-white hover:enabled:bg-n-teal-10 focus-visible:bg-n-teal-10 outline-transparent',
    faded: 'bg-n-teal-9/10 text-n-teal-11 hover:enabled:bg-n-teal-9/20 focus-visible:bg-n-teal-9/20 outline-transparent',
    outline: 'text-n-teal-11 hover:enabled:bg-n-teal-9/10 focus-visible:bg-n-teal-9/10 outline-n-teal-9',
    ghost: 'text-n-teal-9 hover:enabled:bg-n-alpha-2 focus-visible:bg-n-alpha-2 outline-transparent',
    link: 'text-n-teal-9 hover:enabled:underline focus-visible:underline outline-transparent',
  },
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
  href = null,
  download = null,
  className = '',
  ...props
}) {
  const colorMap = COLORS[color] || COLORS.blue;
  const colorClasses = colorMap[variant] || colorMap.solid;
  // link — במקור: p-0 בלבד (בלי h-/px-) + font-medium underline-offset-2
  const dims =
    variant === 'link'
      ? 'p-0 font-medium underline-offset-2'
      : iconOnly
        ? iconOnlySizeClasses[size]
        : sizeClasses[size];

  const classes = [
    base,
    fontSizeClasses[size],
    clickAnimation[size],
    // טבעת פוקוס אחידה — תוספת נגישות מכוונת (TI-5568), מעל ה-focus-visible של המקור
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

  // href → מרונדר כעוגן במקום כפתור. הורדת קובץ חייבת עוגן אמיתי שהמשתמש לוחץ עליו:
  // a.click() סינתטי מתוך onClick נחסם בשקט בחלק מהדפדפנים (Safari), ולחיצה ישירה על
  // <a download> היא המסלול היחיד שעובד בכולם. המראה נשאר זהה לכפתור.
  const Tag = href ? 'a' : 'button';
  const tagProps = href
    ? { href, download: download || undefined }
    : { type, disabled: disabled || loading, 'aria-busy': loading || undefined };

  return (
    <Tag
      className={classes}
      {...tagProps}
      {...props}
    >
      {LeadingIcon ? (
        <LeadingIcon
          size={iconSize}
          strokeWidth={2}
          aria-hidden="true"
          className={
            ['flex-shrink-0', loading ? 'animate-spin' : '']
              .filter(Boolean)
              .join(' ')
          }
        />
      ) : null}
      {!iconOnly && children ? (
        <span className="min-w-0 truncate">{children}</span>
      ) : null}
      {iconOnly && !LeadingIcon && children ? children : null}
      {TrailingIcon && !loading ? (
        <TrailingIcon size={iconSize} strokeWidth={2} aria-hidden="true" className="flex-shrink-0" />
      ) : null}
    </Tag>
  );
}
