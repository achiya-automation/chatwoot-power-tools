import { useCallback, useEffect, useState } from 'react';
import { Search, Loader2, Check, UserRound } from 'lucide-react';
import Modal from './ui/Modal.jsx';
import Button from './ui/Button.jsx';
import Input from './ui/Input.jsx';
import Dropdown from './ui/Dropdown.jsx';
import ConfirmDialog from './ui/ConfirmDialog.jsx';
import { searchContacts, setSequenceByContact } from '../api/sequencesApi.js';
import useT from '../useT.js';
import { translate } from '../i18n.js';

/*
 * AssignSequenceModal — שיוך / החלפה / הסרה של סדרה לליד, ישירות מהדשבורד.
 *
 * שני מצבים:
 *   • ליד קיים (contact מועבר) — מדלגים על החיפוש; בוחרים סדרה ומאשרים.
 *   • ליד חדש (contact=null) — מחפשים איש קשר (שם/טלפון/אימייל), בוחרים, ואז סדרה.
 *
 * הכתיבה דרך set_sequence לפי contact_id (אין צורך בשיחה ובלי membership בחשבון).
 * כל שינוי עובר דיאלוג אישור (ConfirmDialog) — כך שאף ליד לא נכנס/יוצא מסדרה בלי אישור.
 *
 * props: open, onClose, accountId, sequences:[{key,name,enabled}], contact|null, onDone()
 */

// מילון co-located (he/en) — כל המחרוזות מול-המשתמש במודאל שיוך הסדרה לליד.
const M = {
  he: {
    manageTitle: 'ניהול סדרה לליד',
    addTitle: 'הוספת ליד לסדרה',
    noSeqOption: 'ללא סדרה (הסרה)',
    noSeqOptionDesc: 'הליד לא יקבל הודעות סדרה',
    offParen: '(כבוי)',
    seqOffHint: 'הסדרה כבויה — השליחה תתחיל כשתופעל',
    actionFailed: 'הפעולה נכשלה',
    theLead: 'הליד',
    removeTitle: 'להסיר את הליד מהסדרה?',
    removeDesc: '{who} יוסר מהסדרה ולא יקבל ממנה הודעות נוספות.',
    removeConfirm: 'הסר',
    replaceTitle: 'להחליף סדרה?',
    replaceDesc: '{who} נמצא כעת בסדרה אחרת. החלפה תעצור אותה ותתחיל את «{name}» מההתחלה.',
    replaceConfirm: 'החלף סדרה',
    restartTitle: 'להתחיל את הסדרה מחדש?',
    restartDesc: '{who} כבר בסדרה «{name}». אישור יתחיל אותה מחדש מההתחלה.',
    restartConfirm: 'התחל מחדש',
    startTitle: 'להתחיל את הסדרה?',
    startDesc: '{who} יתחיל לקבל את הודעות הסדרה «{name}»{offNote}.',
    startConfirm: 'התחל סדרה',
    seqOffNote: ' (הסדרה כבויה — השליחה תתחיל כשתופעל)',
    change: 'שינוי',
    searchPlaceholder: 'חיפוש איש קשר לפי שם, טלפון או אימייל…',
    searchAria: 'חיפוש איש קשר',
    searching: 'מחפש…',
    noContactsFound: 'לא נמצאו אנשי קשר',
    noContacts: 'אין אנשי קשר',
    inSeqBadge: 'בסדרה',
    seqLabel: 'סדרה',
    seqPlaceholder: 'בחר סדרה…',
    seqSelectAria: 'בחירת סדרה',
    cancel: 'ביטול',
    continueLabel: 'המשך',
  },
  en: {
    manageTitle: 'Manage lead sequence',
    addTitle: 'Add lead to sequence',
    noSeqOption: 'No sequence (remove)',
    noSeqOptionDesc: 'The lead will not receive sequence messages',
    offParen: '(off)',
    seqOffHint: 'The sequence is off — sending will start once it is enabled',
    actionFailed: 'The action failed',
    theLead: 'the lead',
    removeTitle: 'Remove the lead from the sequence?',
    removeDesc: '{who} will be removed from the sequence and will no longer receive messages from it.',
    removeConfirm: 'Remove',
    replaceTitle: 'Replace sequence?',
    replaceDesc: '{who} is currently in another sequence. Replacing it will stop that sequence and start «{name}» from the beginning.',
    replaceConfirm: 'Replace sequence',
    restartTitle: 'Restart the sequence?',
    restartDesc: '{who} is already in «{name}». Confirming will restart it from the beginning.',
    restartConfirm: 'Restart',
    startTitle: 'Start the sequence?',
    startDesc: '{who} will start receiving messages from the sequence «{name}»{offNote}.',
    startConfirm: 'Start sequence',
    seqOffNote: ' (the sequence is off — sending will start once it is enabled)',
    change: 'Change',
    searchPlaceholder: 'Search contact by name, phone, or email…',
    searchAria: 'Search contact',
    searching: 'Searching…',
    noContactsFound: 'No contacts found',
    noContacts: 'No contacts',
    inSeqBadge: 'In sequence',
    seqLabel: 'Sequence',
    seqPlaceholder: 'Select sequence…',
    seqSelectAria: 'Select sequence',
    cancel: 'Cancel',
    continueLabel: 'Continue',
  },
};

function firstNameOf(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

// תצוגת שם נקייה (מסנן שמות-JID של WAHA כמו "972...@c.us")
function displayName(c) {
  const n = String(c?.name || '').trim();
  if (!n || n.includes('@')) return '';
  return n;
}

export default function AssignSequenceModal({ open, onClose, accountId, sequences = [], contact: fixedContact = null, onDone }) {
  const t = useT(M);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState(fixedContact);
  const [seqKey, setSeqKey] = useState(fixedContact?.sequence || '');
  const [confirm, setConfirm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // איפוס בכל פתיחה (וכשמחליפים את הליד הקבוע)
  useEffect(() => {
    if (!open) return;
    setPicked(fixedContact);
    setSeqKey(fixedContact?.sequence || '');
    setQ('');
    setResults([]);
    setError('');
    setConfirm(null);
  }, [open, fixedContact]);

  // חיפוש אנשי קשר (debounced) — רק במצב "ליד חדש"
  useEffect(() => {
    if (!open || fixedContact) return;
    let alive = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchContacts(q, accountId);
        if (alive) setResults(Array.isArray(r) ? r : []);
      } catch {
        if (alive) setResults([]);
      } finally {
        if (alive) setSearching(false);
      }
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, open, fixedContact, accountId]);

  const seqOptions = [
    { value: '', label: t('noSeqOption'), description: t('noSeqOptionDesc') },
    ...sequences.map((s) => ({
      value: s.key,
      label: s.enabled ? s.name : `${s.name} ${t('offParen')}`,
      description: s.enabled ? undefined : t('seqOffHint'),
    })),
  ];

  // ביצוע בפועל (אחרי אישור)
  const doAssign = useCallback(async () => {
    if (!picked) return;
    setSaving(true);
    setError('');
    try {
      await setSequenceByContact(picked.contact_id, seqKey, accountId);
      setConfirm(null);
      onDone?.();
      onClose?.();
    } catch (e) {
      setError(e.message || translate(M, 'actionFailed'));
      setConfirm(null);
    } finally {
      setSaving(false);
    }
  }, [picked, seqKey, accountId, onDone, onClose]);

  // בקשת אישור — נוסח לפי סוג הפעולה (שיוך / החלפה / הסרה)
  const requestAssign = () => {
    if (!picked) return;
    const who = displayName(picked) ? firstNameOf(displayName(picked)) : (picked.phone || translate(M, 'theLead'));
    const target = sequences.find((s) => s.key === seqKey);
    const current = picked.sequence;
    const name = target?.name || seqKey;

    if (!seqKey) {
      setConfirm({
        tone: 'danger',
        title: translate(M, 'removeTitle'),
        description: translate(M, 'removeDesc', { who }),
        confirmLabel: translate(M, 'removeConfirm'),
      });
      return;
    }
    if (current && current !== seqKey) {
      setConfirm({
        tone: 'warning',
        title: translate(M, 'replaceTitle'),
        description: translate(M, 'replaceDesc', { who, name }),
        confirmLabel: translate(M, 'replaceConfirm'),
      });
      return;
    }
    if (current && current === seqKey) {
      setConfirm({
        tone: 'warning',
        title: translate(M, 'restartTitle'),
        description: translate(M, 'restartDesc', { who, name }),
        confirmLabel: translate(M, 'restartConfirm'),
      });
      return;
    }
    const offNote = target && target.enabled === false ? translate(M, 'seqOffNote') : '';
    setConfirm({
      tone: 'info',
      title: translate(M, 'startTitle'),
      description: translate(M, 'startDesc', { who, name, offNote }),
      confirmLabel: translate(M, 'startConfirm'),
    });
  };

  return (
    <>
      <Modal open={open && !confirm} onClose={onClose} title={fixedContact ? t('manageTitle') : t('addTitle')}>
        <div className="flex flex-col gap-4">
          {/* בחירת ליד */}
          {picked ? (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-n-alpha-2 px-3.5 py-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-n-brand/10 text-n-blue-11">
                  <UserRound size={18} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  {displayName(picked) ? (
                    <span className="block truncate text-sm font-medium text-n-slate-12">{displayName(picked)}</span>
                  ) : null}
                  <span dir="ltr" className="block truncate font-mono text-xs text-n-slate-11">{picked.phone || '—'}</span>
                </div>
              </div>
              {!fixedContact ? (
                <Button variant="ghost" color="slate" size="sm" onClick={() => { setPicked(null); setSeqKey(''); }}>
                  {t('change')}
                </Button>
              ) : null}
            </div>
          ) : (
            <div>
              <div className="relative">
                <Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-3 text-n-slate-10" />
                <Input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t('searchPlaceholder')}
                  aria-label={t('searchAria')}
                  className="ps-9"
                  autoFocus
                />
              </div>
              <div className="mt-2 max-h-64 overflow-auto rounded-xl border border-n-weak">
                {searching ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-sm text-n-slate-11">
                    <Loader2 size={16} className="animate-spin" aria-hidden="true" /> {t('searching')}
                  </div>
                ) : results.length === 0 ? (
                  <div className="py-8 text-center text-sm text-n-slate-11">
                    {q ? t('noContactsFound') : t('noContacts')}
                  </div>
                ) : (
                  <ul className="divide-y divide-n-weak">
                    {results.map((c) => (
                      <li key={c.contact_id}>
                        <button
                          type="button"
                          onClick={() => { setPicked(c); setSeqKey(c.sequence || ''); }}
                          className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-start transition-colors hover:bg-n-alpha-2"
                        >
                          <div className="min-w-0">
                            {displayName(c) ? (
                              <span className="block truncate text-sm text-n-slate-12">{displayName(c)}</span>
                            ) : null}
                            <span dir="ltr" className="block truncate font-mono text-xs text-n-slate-11">{c.phone || '—'}</span>
                          </div>
                          {c.sequence ? (
                            <span className="shrink-0 rounded-full bg-n-alpha-3 px-2 py-0.5 text-xs text-n-slate-11">{t('inSeqBadge')}</span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* בחירת סדרה */}
          {picked ? (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-n-slate-12">{t('seqLabel')}</label>
              <Dropdown
                options={seqOptions}
                value={seqKey}
                onChange={setSeqKey}
                placeholder={t('seqPlaceholder')}
                ariaLabel={t('seqSelectAria')}
              />
            </div>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-n-ruby-7 bg-n-ruby-3 px-3 py-2 text-sm text-n-ruby-11">{error}</div>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" color="slate" onClick={onClose}>{t('cancel')}</Button>
            <Button color="brand" icon={Check} disabled={!picked} onClick={requestAssign}>
              {t('continueLabel')}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={doAssign}
        tone={confirm?.tone}
        title={confirm?.title}
        description={confirm?.description}
        confirmLabel={confirm?.confirmLabel}
        loading={saving}
      />
    </>
  );
}
