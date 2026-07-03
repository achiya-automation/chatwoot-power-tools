import React from 'react';

/*
 * Card — מכל זהה לכרטיס של Chatwoot v4.
 * bg-n-solid-1/2, border-n-weak, rounded-xl, צל עדין.
 */

export default function Card({
  children,
  className = '',
  as: Tag = 'div',
  ...props
}) {
  return (
    <Tag
      className={[
        'bg-n-solid-2 border border-n-weak rounded-xl shadow-sm',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({ children, className = '' }) {
  return (
    <div
      className={['px-5 py-4 border-b border-n-weak', className]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}

export function CardBody({ children, className = '' }) {
  return (
    <div className={['p-5', className].filter(Boolean).join(' ')}>{children}</div>
  );
}
