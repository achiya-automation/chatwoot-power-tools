import { useCallback, useEffect, useState } from 'react';
import { Eye, MessageSquareDot, RefreshCw, RotateCcw, Save } from 'lucide-react';
import Button from './ui/Button.jsx';
import Switch from './ui/Switch.jsx';
import Dropdown from './ui/Dropdown.jsx';
import { SkeletonCard } from './ui/Skeleton.jsx';
import { useToast } from './ui/Toast.jsx';
import { getPresence, savePresence, resetPresence } from '../api/sequencesApi.js';
import useT from '../useT.js';

/*
 * PresenceView — שליטה ב"נקרא" (✓✓ כחול) וב"מקליד…" שנשלחים לוואטסאפ.
 *
 * Chatwoot עצמו לא שולח אף אחד מהשניים בערוצי Cloud API — המנוע משלים את זה
 * (engine/src/presence.js). כאן קובעים פר-חשבון ופר-תיבה: האם לסמן כנקרא, מתי
 * להציג "מקליד" (כבוי / רק כשנציג מקליד / אוטומטית לתיבת בוט), וכמה להשהות כדי
 * שזה ירגיש אנושי. שורת תיבה גוברת על ברירת המחדל של החשבון; "חזרה לירושה"
 * מוחקת את שורת התיבה.
 */

const M = {
  he: {
    intro: 'שליטה במה שהלקוח רואה בוואטסאפ כשהוא כותב לכם: ✓✓ כחול ("נקרא") ומחוון "מקליד…". ההשהיות קיימות כדי שהאישורים ירגישו אנושיים ולא מיידיים.',
    defaultsTitle: 'ברירת מחדל לחשבון',
    defaultsHelp: 'חלה על כל תיבה שאין לה הגדרה משלה.',
    inboxesTitle: 'תיבות וואטסאפ',
    readReceipts: 'סימון "נקרא" (✓✓ כחול)',
    typingMode: 'מחוון "מקליד…"',
    typingOff: 'כבוי',
    typingAgent: 'רק כשנציג מקליד',
    typingAuto: 'אוטומטי (תיבת בוט)',
    typingAutoHelp: '"אוטומטי" מציג "מקליד" מיד אחרי הקריאה — מתאים רק לתיבה שבוט עונה בה. אם אף אחד לא עונה בפועל, הלקוח רואה "מקליד" בלי תשובה — גרוע יותר מכלום.',
    readDelay: 'השהיית "נקרא" (שניות)',
    typingDelay: 'השהיית "מקליד" (שניות)',
    delayTo: 'עד',
    inherited: 'יורשת מברירת המחדל',
    custom: 'הגדרה משלה',
    save: 'שמירה',
    dirty: 'שינויים שלא נשמרו',
    reset: 'חזרה לירושה',
    saved: 'נשמר',
    resetDone: 'התיבה חזרה לברירת המחדל',
    errLoad: 'שגיאה בטעינת ההגדרות',
    errSave: 'השמירה נכשלה',
    refresh: 'רענון',
    noInboxes: 'אין בחשבון תיבות WhatsApp Cloud API.',
  },
  en: {
    intro: 'Controls what customers see in WhatsApp when they write to you: blue ✓✓ ("read") and the "typing…" indicator. The delays make the signals feel human instead of instant.',
    defaultsTitle: 'Account default',
    defaultsHelp: 'Applies to every inbox without its own override.',
    inboxesTitle: 'WhatsApp inboxes',
    readReceipts: 'Read receipts (blue ✓✓)',
    typingMode: '"Typing…" indicator',
    typingOff: 'Off',
    typingAgent: 'Only when an agent types',
    typingAuto: 'Automatic (bot inbox)',
    typingAutoHelp: '"Automatic" shows typing right after the read — only for inboxes a bot answers. If nothing replies, customers see typing with no answer, which is worse than nothing.',
    readDelay: 'Read delay (seconds)',
    typingDelay: 'Typing delay (seconds)',
    delayTo: 'to',
    inherited: 'Inherits account default',
    custom: 'Custom',
    save: 'Save',
    dirty: 'Unsaved changes',
    reset: 'Reset to inherited',
    saved: 'Saved',
    resetDone: 'Inbox reset to account default',
    errLoad: 'Failed to load settings',
    errSave: 'Save failed',
    refresh: 'Refresh',
    noInboxes: 'No WhatsApp Cloud API inboxes in this account.',
  },
};

/** עורך הגדרות של רשומה אחת (ברירת מחדל או תיבה). מוצג תמיד; שינוי → שמירה. */
function SettingsEditor({ t, value, onSave, saving }) {
  const [s, setS] = useState(value);
  // ⚠️ persist()/doReset() טוענים מחדש את כל עץ הנתונים, וכל כרטיס מקבל `value` חדש —
  // כך שמירה בכרטיס אחד דרסה בשקט עריכות שלא נשמרו בכרטיס אחר. כרטיס שהמשתמש כבר
  // ערך אינו מסונכרן מחדש מהשרת עד שהשמירה שלו מצליחה. (אותו דפוס כמו JourneyEditor.)
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setS(value); }, [value, dirty]);
  const edit = (next) => { setS(next); setDirty(true); };

  // רשת ביטחון לסגירת/רענון הלשונית עם עריכות פתוחות (כמו ב-JourneyEditor)
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // onSave מחזיר true רק כששמירת השרת הצליחה — שמירה שנכשלה משאירה את הכרטיס "מלוכלך"
  // כדי שהעריכות לא ייעלמו ברענון הבא.
  const submit = async () => { if (await onSave(s)) setDirty(false); };

  const num = (v) => Math.max(0, Number(v) || 0);
  const range = (minKey, maxKey, cap) => (
    <div className="flex items-center gap-1.5 text-sm">
      <input
        type="number" min="0" max={cap} step="0.5" value={s[minKey]}
        onChange={(e) => edit({ ...s, [minKey]: num(e.target.value) })}
        className="w-16 rounded-lg border border-n-weak bg-n-alpha-black1 px-2 py-1 text-n-slate-12"
      />
      <span className="text-n-slate-11">{t('delayTo')}</span>
      <input
        type="number" min="0" max={cap} step="0.5" value={s[maxKey]}
        onChange={(e) => edit({ ...s, [maxKey]: num(e.target.value) })}
        className="w-16 rounded-lg border border-n-weak bg-n-alpha-black1 px-2 py-1 text-n-slate-12"
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-n-slate-12">{t('readReceipts')}</span>
        <Switch checked={!!s.read_receipts} onChange={(v) => edit({ ...s, read_receipts: v })} aria-label={t('readReceipts')} />
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-n-slate-12">{t('typingMode')}</span>
        <Dropdown
          ariaLabel={t('typingMode')}
          value={s.typing_mode}
          onChange={(v) => edit({ ...s, typing_mode: v })}
          options={[
            { value: 'off', label: t('typingOff') },
            { value: 'agent', label: t('typingAgent') },
            { value: 'auto', label: t('typingAuto') },
          ]}
        />
      </div>
      {s.typing_mode === 'auto' ? (
        <p className="rounded-lg border border-n-amber-7 bg-n-amber-3 px-3 py-2 text-xs text-n-amber-12">{t('typingAutoHelp')}</p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-n-slate-11">{t('readDelay')}</span>
        {range('read_delay_min', 'read_delay_max', 60)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-n-slate-11">{t('typingDelay')}</span>
        {range('typing_delay_min', 'typing_delay_max', 20)}
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" icon={Save} disabled={saving} onClick={submit}>
          {t('save')}
        </Button>
        {dirty ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-n-amber-11">
            <span className="h-1.5 w-1.5 rounded-full bg-n-amber-9" aria-hidden="true" />
            {t('dirty')}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default function PresenceView({ accountId }) {
  const t = useT(M);
  const { toast } = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await getPresence(accountId));
    } catch (e) {
      setError(e.message || t('errLoad'));
    }
  }, [accountId, t]);
  useEffect(() => { load(); }, [load]);

  // מחזיר true/false — הכרטיס מנקה את סימון ה"לא נשמר" רק כששמירת השרת הצליחה.
  const persist = async (inboxId, s) => {
    setSaving(true);
    try {
      await savePresence(accountId, { ...s, inbox_id: inboxId });
      toast({ message: t('saved'), variant: 'success' });
      await load();
      return true;
    } catch (e) {
      toast({ message: e.message || t('errSave'), variant: 'error' });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const doReset = async (inboxId) => {
    setSaving(true);
    try {
      await resetPresence(accountId, inboxId);
      toast({ message: t('resetDone'), variant: 'success' });
      await load();
    } catch (e) {
      toast({ message: e.message || t('errSave'), variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-xl border border-n-ruby-7 bg-n-ruby-3 px-4 py-3 text-sm text-n-ruby-11">
        <span>{error}</span>
        <Button variant="ghost" color="slate" size="sm" icon={RefreshCw} onClick={load}>{t('refresh')}</Button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }

  return (
    <div>
      <p className="mb-4 text-sm text-n-slate-11">{t('intro')}</p>

      {/* ברירת המחדל של החשבון — נשמרת כ-inbox_id=0 */}
      <div className="mb-5 rounded-xl border border-n-weak bg-n-surface-1 p-4">
        <h2 className="mb-1 flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
          <Eye size={15} className="text-n-blue-11" aria-hidden="true" />
          {t('defaultsTitle')}
        </h2>
        <p className="mb-3 text-xs text-n-slate-11">{t('defaultsHelp')}</p>
        <SettingsEditor t={t} value={data.defaults} saving={saving} onSave={(s) => persist(0, s)} />
      </div>

      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
        <MessageSquareDot size={15} className="text-n-blue-11" aria-hidden="true" />
        {t('inboxesTitle')}
      </h2>
      {data.inboxes.length === 0 ? (
        <p className="text-sm text-n-slate-11">{t('noInboxes')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {data.inboxes.map((i) => (
            <div key={i.id} className="rounded-xl border border-n-weak bg-n-surface-1 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-n-slate-12">{i.name}</p>
                  <p className="text-xs text-n-slate-11" dir="ltr">{i.phone_number}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${i.inherited ? 'bg-n-alpha-2 text-n-slate-11' : 'bg-n-blue-3 text-n-blue-11'}`}>
                    {i.inherited ? t('inherited') : t('custom')}
                  </span>
                  {!i.inherited ? (
                    <Button
                      variant="ghost" color="slate" size="sm" iconOnly icon={RotateCcw}
                      aria-label={t('reset')} title={t('reset')}
                      disabled={saving} onClick={() => doReset(i.id)}
                    />
                  ) : null}
                </div>
              </div>
              <SettingsEditor t={t} value={i.settings} saving={saving} onSave={(s) => persist(i.id, s)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
