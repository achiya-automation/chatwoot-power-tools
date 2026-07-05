import React, { useMemo, useRef, useState } from 'react';
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
  const searchRef = useRef(null);

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

  const toggle = () => {
    setOpen((o) => {
      const next = !o;
      if (next) {
        setQuery('');
        // פוקוס לתיבת החיפוש כשנפתח
        window.setTimeout(() => searchRef.current?.focus(), 0);
      }
      return next;
    });
  };

  const select = (name) => {
    onChange?.(name);
    setOpen(false);
  };

  return (
    <div>
      <button
        type="button"
        id={id}
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-n-weak bg-n-alpha-1 px-3 text-start text-sm text-n-slate-12 outline-none transition-colors duration-150 focus:border-n-brand focus:ring-1 focus:ring-n-brand/40"
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
        <div className="mt-1 max-h-72 overflow-auto rounded-lg border border-n-weak bg-n-surface-1">
          {/* חיפוש */}
          <div className="sticky top-0 border-b border-n-weak bg-n-surface-1 p-2">
            <div className="relative">
              <Search
                size={15}
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-2.5 text-n-slate-10"
              />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('searchTemplate')}
                aria-label={t('searchTemplateAria')}
                className="h-9 w-full rounded-lg border border-n-weak bg-n-alpha-2 ps-8 pe-3 text-sm text-n-slate-12 placeholder:text-n-slate-10 outline-none focus:border-n-brand focus:ring-1 focus:ring-n-brand/40"
              />
            </div>
          </div>

          {/* רשימת אפשרויות */}
          <ul role="listbox" className="py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-center text-xs text-n-slate-11">
                {t('noTemplatesFound')}
              </li>
            ) : (
              filtered.map((t) => {
                const selected = t.name === value;
                return (
                  <li key={t.name} role="option" aria-selected={selected}>
                    <button
                      type="button"
                      onClick={() => select(t.name)}
                      className={`block w-full px-3 py-2 text-start transition-colors hover:bg-n-alpha-1 ${
                        selected ? 'bg-n-alpha-2' : ''
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
