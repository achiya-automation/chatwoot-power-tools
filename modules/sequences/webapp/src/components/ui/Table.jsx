import React from 'react';

/*
 * Table — זהה ל-BaseTable.vue של Chatwoot (components-next/table): טבלה שטוחה עם
 * divide-y, כותרות text-heading-3 slate-12, תאים text-body-main על slate-11 —
 * בלי מעטפת כרטיס, בלי צל, בלי hover על שורות (כמו במקור).
 */

export function Table({ children, className = '' }) {
  return (
    <div className="w-full overflow-x-auto">
      <table
        className={['min-w-full table-auto divide-y divide-n-weak', className]
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </table>
    </div>
  );
}

export function THead({ children }) {
  return <thead className="border-t border-n-weak">{children}</thead>;
}

export function TBody({ children }) {
  return <tbody className="divide-y divide-n-weak text-n-slate-11">{children}</tbody>;
}

export function TR({ children, className = '', ...props }) {
  return (
    <tr className={className || undefined} {...props}>
      {children}
    </tr>
  );
}

export function TH({ children, className = '', align = 'start' }) {
  return (
    <th
      scope="col"
      className={[
        'py-4 pe-4 first:ps-4 text-heading-3 text-n-slate-12',
        align === 'end' ? 'text-end' : 'text-start',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </th>
  );
}

export function TD({ children, className = '', align = 'start' }) {
  return (
    <td
      className={[
        'py-3 pe-4 first:ps-4 text-body-main align-middle',
        align === 'end' ? 'text-end' : 'text-start',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </td>
  );
}
