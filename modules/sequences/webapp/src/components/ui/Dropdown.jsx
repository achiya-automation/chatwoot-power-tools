import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import useT from '../../useT.js';

/*
 * Dropdown — בורר מותאם (לא <select> מקורי): נפתח כפאנל בזרימה רגילה מתחת לכפתור
 * ("מוטמע", לא תפריט-מערכת צף), בסגנון Chatwoot. נגיש למקלדת (חיצים/Enter/Esc),
 * נסגר בלחיצה בחוץ, ויכול להציג תיאור-משנה לכל אפשרות.
 *
 * props:
 *   options — [{ value, label, description?, disabled? }]
 *   value, onChange(value)
 *   placeholder, disabled, ariaLabel, id, className
 */

// מילון co-located (he/en)
const M = {
  he: { placeholder: 'בחר…', noOptions: 'אין אפשרויות' },
  en: { placeholder: 'Select…', noOptions: 'No options' },
};

export default function Dropdown({
  options = [],
  value,
  onChange,
  placeholder = null,
  disabled = false,
  ariaLabel,
  id,
  className = '',
}) {
  const t = useT(M);
  const _placeholder = placeholder ?? t('placeholder');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1); // אפשרות בפוקוס-מקלדת
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const listRef = useRef(null);

  const selected = options.find((o) => o.value === value) || null;
  const selectedIndex = options.findIndex((o) => o.value === value);

  // סגירה בלחיצה בחוץ
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // כשנפתח — מתחילים מהאפשרות הנבחרת, וגוללים אליה
  useEffect(() => {
    if (open) {
      setActive(selectedIndex >= 0 ? selectedIndex : 0);
      window.setTimeout(() => {
        listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
      }, 0);
    }
  }, [open, selectedIndex]);

  const choose = (opt) => {
    if (!opt || opt.disabled) return;
    onChange?.(opt.value);
    setOpen(false);
    btnRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btnRef.current?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(options[active]); }
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={btnRef}
        type="button"
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-n-weak bg-n-alpha-1 px-3 text-start text-sm outline-none transition-colors duration-150 focus:border-n-brand focus:ring-1 focus:ring-n-brand/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={`truncate ${selected ? 'text-n-slate-12' : 'text-n-slate-10'}`}>
          {selected ? selected.label : _placeholder}
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`shrink-0 text-n-slate-10 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <ul
          ref={listRef}
          role="listbox"
          aria-activedescendant={active >= 0 ? `${id || 'dd'}-opt-${active}` : undefined}
          className="mt-1 max-h-64 overflow-auto rounded-lg border border-n-weak bg-n-surface-1 py-1 shadow-lg shadow-black/10"
        >
          {options.length === 0 ? (
            <li className="px-3 py-3 text-center text-xs text-n-slate-11">{t('noOptions')}</li>
          ) : (
            options.map((opt, i) => {
              const sel = opt.value === value;
              const isActive = i === active;
              return (
                <li key={opt.value ?? i} role="option" aria-selected={sel}>
                  <button
                    type="button"
                    id={`${id || 'dd'}-opt-${i}`}
                    data-active={isActive}
                    disabled={opt.disabled}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(opt)}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-start transition-colors ${
                      opt.disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
                    } ${isActive && !opt.disabled ? 'bg-n-alpha-2' : ''}`}
                  >
                    <span className="min-w-0">
                      <span className={`block truncate text-sm ${sel ? 'font-medium text-n-slate-12' : 'text-n-slate-11'}`}>
                        {opt.label}
                      </span>
                      {opt.description ? (
                        <span className="mt-0.5 block truncate text-xs text-n-slate-10">{opt.description}</span>
                      ) : null}
                    </span>
                    {sel ? <Check size={15} className="shrink-0 text-n-brand" aria-hidden="true" /> : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
