/*
 * Skeleton — placeholder טעינה זהה לסגנון Chatwoot (pulse עדין על n-alpha).
 * משמש בכל המסכים במקום טקסט "טוען…" — כך הפריסה לא "קופצת" כשהמידע מגיע
 * וההמתנה נראית כמו שאר המערכת. מכבד prefers-reduced-motion (index.css).
 *
 * <Skeleton className="h-4 w-32" />            — בלוק בודד
 * <SkeletonText lines={3} />                    — כמה שורות טקסט
 * <SkeletonCard />                              — כרטיס סטטיסטיקה
 * <SkeletonRows cols={5} rows={4} />            — שורות טבלה
 */

export default function Skeleton({ className = '', rounded = 'rounded-md' }) {
  return (
    <div
      className={`animate-pulse bg-n-alpha-2 ${rounded} ${className}`}
      aria-hidden="true"
    />
  );
}

// כמה שורות טקסט בגבהים אחידים; השורה האחרונה קצרה יותר (טבעי)
export function SkeletonText({ lines = 3, className = '' }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={`h-3.5 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`}
        />
      ))}
    </div>
  );
}

// כרטיס סטטיסטיקה (כמו כרטיסי הסקירה) — מספר גדול + תווית
export function SkeletonCard({ className = '' }) {
  return (
    <div
      className={`flex flex-col items-start rounded-xl bg-n-alpha-1 px-4 py-3 ring-1 ring-n-weak ${className}`}
      aria-hidden="true"
    >
      <Skeleton className="h-7 w-10" />
      <Skeleton className="mt-2 h-3 w-16" />
    </div>
  );
}

// שלד טבלה — כותרת דקה + N שורות, C עמודות
export function SkeletonRows({ rows = 4, cols = 5, className = '' }) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-n-weak ${className}`}
      aria-hidden="true"
    >
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          className={`flex items-center gap-4 px-4 py-3 ${
            r > 0 ? 'border-t border-n-weak' : ''
          }`}
        >
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton
              key={c}
              className={`h-3.5 ${c === 0 ? 'w-32' : 'flex-1'}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
