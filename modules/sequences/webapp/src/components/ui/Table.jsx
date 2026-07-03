import React from 'react';

/*
 * Table — זהה לטבלה של Chatwoot v4.
 * כותרת slate-11 קטנה, שורות עם border-n-weak, hover עדין.
 * עטוף ב-Card-like container.
 */

export function Table({ children, className = '' }) {
  return (
    <div className="w-full overflow-x-auto bg-n-solid-2 border border-n-weak rounded-xl shadow-sm">
      <table
        className={['w-full border-collapse text-sm', className]
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </table>
    </div>
  );
}

export function THead({ children }) {
  return <thead className="bg-n-alpha-1">{children}</thead>;
}

export function TBody({ children }) {
  return <tbody>{children}</tbody>;
}

export function TR({ children, className = '', ...props }) {
  return (
    <tr
      className={[
        'border-b border-n-weak last:border-b-0 transition-colors',
        'hover:bg-n-alpha-2',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {children}
    </tr>
  );
}

export function TH({ children, className = '', align = 'start' }) {
  return (
    <th
      scope="col"
      className={[
        'px-4 py-3 text-xs font-semibold text-n-slate-11 uppercase tracking-wide',
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
        'px-4 py-3 text-n-slate-12 align-middle',
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
