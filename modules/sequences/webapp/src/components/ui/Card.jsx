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
        // CardLayout.vue: outline שקוף בדארק (border-container) — בלי border ובלי צל
        'bg-n-solid-2 outline-1 outline outline-n-container -outline-offset-1 rounded-xl',
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
      className={['px-6 py-5', className]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}

export function CardBody({ children, className = '' }) {
  return (
    <div className={['px-6 py-5', className].filter(Boolean).join(' ')}>{children}</div>
  );
}
