import React from 'react';

/*
 * Badge — תווית סטטוס קטנה זהה ל-Chatwoot v4.
 * color: slate | blue | teal | amber | ruby
 */

const colorMap = {
  slate: 'bg-n-alpha-2 text-n-slate-11',
  blue: 'bg-n-brand/10 text-n-blue-11',
  teal: 'bg-n-teal-3 text-n-teal-11',
  amber: 'bg-n-amber-3 text-n-amber-11',
  ruby: 'bg-n-ruby-3 text-n-ruby-11',
};

export default function Badge({ children, color = 'slate', className = '' }) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium',
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
