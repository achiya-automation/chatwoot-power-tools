import { useEffect, useId, useRef, useState } from 'react';
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
  const generatedId = useId();
  const dropdownId = id || generatedId;
  const listId = `${dropdownId}-list`;

  const selected = options.find((o) => o.value === value) || null;
  const selectedIndex = options.findIndex((o) => o.value === value);

  // סגירה בלחיצה בחוץ
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // The list owns keyboard focus; opening it must not add every option to Tab order.
  useEffect(() => {
    if (open) listRef.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector('[data-active="true"]');
    if (!item) return;
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
    }
  }, [open, active]);

  const enabledIndices = options.flatMap((option, index) => option.disabled ? [] : [index]);
  const openList = (fromEnd = false) => {
    setActive(enabledIndices.includes(selectedIndex) ? selectedIndex
      : (fromEnd ? enabledIndices.at(-1) : enabledIndices[0]) ?? -1);
    setOpen(true);
  };

  const choose = (opt) => {
    if (!opt || opt.disabled) return;
    onChange?.(opt.value);
    setOpen(false);
    btnRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault(); openList(e.key === 'ArrowUp');
      }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); btnRef.current?.focus(); }
    else if (e.key === 'Tab') { setOpen(false); btnRef.current?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(enabledIndices.find((i) => i > active) ?? active); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive([...enabledIndices].reverse().find((i) => i < active) ?? active); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(enabledIndices[0] ?? -1); }
    else if (e.key === 'End') { e.preventDefault(); setActive(enabledIndices.at(-1) ?? -1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(options[active]); }
  };

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <button
        ref={btnRef}
        type="button"
        id={dropdownId}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => { if (!disabled) { if (open) setOpen(false); else openList(); } }}
        onKeyDown={onKeyDown}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border-none bg-n-alpha-black2 px-3 text-start text-sm outline outline-1 outline-offset-[-1px] outline-n-weak hover:outline-n-slate-6 focus:outline-n-brand transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50"
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
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label={ariaLabel || _placeholder}
          onKeyDown={onKeyDown}
          aria-activedescendant={active >= 0 && options[active] ? `${dropdownId}-opt-${active}` : undefined}
          className="relative mt-1 max-h-64 overflow-auto rounded-xl bg-n-alpha-3 backdrop-blur-[100px] outline outline-1 outline-n-container pt-2 pb-1 px-1 shadow-lg"
        >
          {options.length === 0 ? (
            <li className="px-3 py-3 text-center text-xs text-n-slate-11">{t('noOptions')}</li>
          ) : (
            options.map((opt, i) => {
              const sel = opt.value === value;
              const isActive = i === active;
              return (
                <li key={opt.value ?? i} id={`${dropdownId}-opt-${i}`} role="option" aria-selected={sel} aria-disabled={opt.disabled || undefined} data-active={isActive}>
                  <button
                    type="button"
                    tabIndex={-1}
                    disabled={opt.disabled}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => { if (!opt.disabled) setActive(i); }}
                    onClick={() => choose(opt)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 min-h-8 text-start transition-colors ${
                      opt.disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
                    } ${isActive && !opt.disabled ? 'bg-n-alpha-1 dark:bg-n-alpha-2' : ''} ${sel ? 'bg-n-alpha-1 dark:bg-n-solid-active' : ''}`}
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
