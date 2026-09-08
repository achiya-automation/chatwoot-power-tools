import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import useT from '../../useT.js';

/*
 * TemplatePicker — בורר תבניות מותאם שמציג גם את *תוכן* התבנית, לא רק את השם.
 *
 * בניגוד ל-<select> מקורי, נפתח כפאנל אקורדיון *בזרימה רגילה* מתחת לכפתור
 * (לא overlay צף) — הוא דוחף את התוכן שמתחתיו כלפי מטה. כל שורה מציגה את שם
 * התבנית ומתחתיו תצוגה מקדימה מקוצרת של הגוף, כדי שאפשר לזהות לפי תוכן.
 *
 * props:
 *   templates — [{ name, body, ... }]
 *   value     — שם התבנית הנבחרת כרגע
 *   onChange(name) — נקרא בבחירה (ומכווץ את הפאנל)
 *   placeholder — טקסט כשאין בחירה
 */

// מילון co-located (he/en)
const M = {
  he: {
    selectTemplate: 'בחר תבנית…',
    searchTemplate: 'חיפוש תבנית…',
    searchTemplateAria: 'חיפוש תבנית',
    noTemplatesFound: 'לא נמצאו תבניות',
  },
  en: {
    selectTemplate: 'Select template…',
    searchTemplate: 'Search template…',
    searchTemplateAria: 'Search template',
    noTemplatesFound: 'No templates found',
  },
};

export default function TemplatePicker({
  templates = [],
  value = '',
  onChange,
  placeholder = null,
  id,
}) {
  const t = useT(M);
  const _placeholder = placeholder ?? t('selectTemplate');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const searchRef = useRef(null);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  const generatedId = useId();
  const pickerId = id || generatedId;
  const listId = `${pickerId}-list`;

  // סינון לפי שם או גוף (לא תלוי רישיות)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const seen = new Set();
    const out = [];
    for (const t of templates) {
      if (!t || seen.has(t.name)) continue;
      seen.add(t.name);
      if (
        !q ||
        (t.name || '').toLowerCase().includes(q) ||
        String(t.body || '').toLowerCase().includes(q)
      ) {
        out.push(t);
      }
    }
    return out;
  }, [templates, query]);

  useEffect(() => {
    if (open) searchRef.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    const panel = panelRef.current;
    const item = panel?.querySelector('[data-active="true"]');
    if (!item) return;
    const searchHeight = panel.firstElementChild?.offsetHeight || 0;
    if (item.offsetTop < panel.scrollTop + searchHeight) panel.scrollTop = item.offsetTop - searchHeight;
    else if (item.offsetTop + item.offsetHeight > panel.scrollTop + panel.clientHeight) {
      panel.scrollTop = item.offsetTop + item.offsetHeight - panel.clientHeight;
    }
  }, [open, active, query]);

  const toggle = () => {
    if (!open) { setQuery(''); setActive(0); }
    setOpen(!open);
  };

  const select = (name) => {
    onChange?.(name);
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div className="min-w-0"
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}
      onKeyDown={(e) => {
        if (open && e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation(); setOpen(false); buttonRef.current?.focus();
        }
      }}>
      <button
        ref={buttonRef}
        type="button"
        id={pickerId}
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border-none bg-n-alpha-black2 px-3 text-start text-sm text-n-slate-12 outline outline-1 outline-offset-[-1px] outline-n-weak hover:outline-n-slate-6 focus:outline-n-brand transition-all duration-200"
      >
        <span className={value ? 'truncate text-n-slate-12' : 'truncate text-n-slate-10'}>
          {value || _placeholder}
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`shrink-0 text-n-slate-10 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* פאנל אקורדיון בזרימה רגילה — דוחף את התוכן שמתחתיו */}
      {open ? (
        <div ref={panelRef} className="relative mt-1 max-h-72 overflow-auto rounded-xl bg-n-alpha-3 backdrop-blur-[100px] outline outline-1 outline-n-container">
          {/* חיפוש */}
          <div className="sticky top-0 border-b border-n-weak bg-n-solid-1 p-2">
            <div className="relative">
              <Search
                size={15}
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-2.5 text-n-slate-10"
              />
              <input
                ref={searchRef}
                type="search"
                role="combobox"
                aria-expanded={open}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={filtered[active] ? `${pickerId}-opt-${active}` : undefined}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(filtered.length - 1, i + 1)); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
                  else if (e.key === 'Enter') { e.preventDefault(); if (filtered[active]) select(filtered[active].name); }
                }}
                placeholder={t('searchTemplate')}
                aria-label={t('searchTemplateAria')}
                className="h-8 w-full rounded-lg border-none bg-n-alpha-black2 dark:bg-n-solid-1 ps-8 pe-3 text-sm text-n-slate-12 placeholder:text-n-slate-10 focus:outline-none"
              />
            </div>
          </div>

          {/* רשימת אפשרויות */}
          <ul id={listId} role="listbox" aria-label={t('selectTemplate')} className="py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-center text-xs text-n-slate-11">
                {t('noTemplatesFound')}
              </li>
            ) : (
              filtered.map((t, index) => {
                const selected = t.name === value;
                return (
                  <li key={t.name} id={`${pickerId}-opt-${index}`} role="option" aria-selected={selected} data-active={index === active}>
                    <button
                      type="button"
                      tabIndex={-1}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => select(t.name)}
                      className={`block w-full rounded-lg px-2 py-1.5 text-start transition-colors hover:bg-n-alpha-1 dark:hover:bg-n-alpha-2 ${
                        selected ? 'bg-n-alpha-1 dark:bg-n-solid-active' : index === active ? 'bg-n-alpha-1 dark:bg-n-alpha-2' : ''
                      }`}
                    >
                      <span className="block truncate text-sm font-medium text-n-slate-12">
                        {t.name}
                      </span>
                      {t.body ? (
                        <span className="mt-0.5 block text-xs text-n-slate-11 line-clamp-2">
                          {t.body}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
