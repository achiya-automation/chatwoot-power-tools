import React from 'react';

/*
 * Badge — תווית סטטוס קטנה זהה ל-Chatwoot v4.
 * color: slate | blue | teal | amber | ruby
 */

// COLOR_CLASSES — העתק מ-label/Label.vue של המקור (bg מדרגה 2 + outline מדרגה 4)
const colorMap = {
  slate: 'bg-n-label-color outline-n-label-border text-n-slate-12',
  blue: 'bg-n-blue-2 outline-n-blue-4 text-n-blue-11',
  teal: 'bg-n-teal-2 outline-n-teal-4 text-n-teal-11',
  amber: 'bg-n-amber-2 outline-n-amber-4 text-n-amber-11',
  ruby: 'bg-n-ruby-2 outline-n-ruby-4 text-n-ruby-11',
};

export default function Badge({ children, color = 'slate', className = '' }) {
  return (
    <span
      className={[
        // מעטפת Label.vue (מצב compact): rounded-md, outline פנימי, גובה קבוע
        'inline-flex items-center gap-1 rounded-md -outline-offset-1 outline outline-1 flex-shrink-0 px-1.5 h-6 text-label-small',
        colorMap[color] || colorMap.slate,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </span>
  );
}
