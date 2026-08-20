import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Clock,
  Eye,
  RefreshCw,
  Save,
  ShieldCheck,
  Smartphone,
  Sunset,
  Zap,
} from 'lucide-react';
import Badge from './ui/Badge.jsx';
import Button from './ui/Button.jsx';
import Dropdown from './ui/Dropdown.jsx';
import Input from './ui/Input.jsx';
import Switch from './ui/Switch.jsx';
import Skeleton, { SkeletonCard } from './ui/Skeleton.jsx';
import { useToast } from './ui/Toast.jsx';
import PresenceView from './PresenceView.jsx';
import {
  getCompliance,
  getWhatsappInboxes,
  saveCompliance,
  setWhatsappInbox,
} from '../api/sequencesApi.js';
import useT from '../useT.js';
import { translate } from '../i18n.js';
import {
  BOOL_FIELDS,
  DEFAULT_SETTINGS,
  NUMBER_FIELDS,
  SETTINGS_SECTIONS,
  compliancePayload,
  quietWindow,
} from '../lib/settings.js';

/*
 * SettingsView — כל מה שאפשר *לשנות* במוצר, במקום אחד: המספר שממנו שולחים,
 * שעות השליחה של החשבון, מדיניות הציות והנוכחות ("נקרא"/"מקליד").
 *
 * הפיזור הקודם: המספר והמדיניות ישבו בתוך תצוגת הציות (מסך שכל השאר בו הוא
 * קריאה בלבד), והנוכחות קיבלה לשונית שלמה לשתי הגדרות. תצוגת הציות נשארה
 * מסך-מצב בלבד.
 *
 * ⚠️ שמירה: מקטע "שעות שליחה" ומקטע "מדיניות ציות" חולקים טופס אחד ושמירה אחת —
 * save_compliance הוא upsert של כל השורה (ראה lib/settings.js). הנוכחות שומרת
 * דרך ה-API שלה (prs_save) ומשמרת את מצב ה"לא נשמר" הפר-כרטיס — לכן PresenceView
 * מוטמע כאן כמו שהוא, בלי לגעת בו.
 */

const M = {
  he: {
    navAria: 'מקטעי ההגדרות',
    sec_inbox: 'מספר הוואטסאפ',
    sec_hours: 'שעות שליחה',
    sec_compliance: 'מדיניות ציות',
    sec_presence: 'נוכחות',
    errLoad: 'שגיאה בטעינת ההגדרות',
    errSave: 'שמירת המדיניות נכשלה',
    refresh: 'רענון',

    // מספר הוואטסאפ
    inboxTitle: 'מספר הוואטסאפ של הרצפים',
    inboxHelp: 'לחשבון יש כמה מספרי וואטסאפ. הרצפים יוצאים מהמספר המסומן.',
    inboxNeedsChoice: 'לא נבחר מספר — והמנוע לא ינחש. שום הודעה לא תישלח עד שתבחרו מאיזה מספר לשלוח.',
    inboxActive: 'פעיל',
    inboxSaved: 'המספר נשמר',
    inboxSingle: 'בחשבון יש מספר וואטסאפ אחד, וכל הרצפים יוצאים ממנו. אין כאן מה לבחור.',
    inboxNone: 'אין בחשבון תיבת וואטסאפ מחוברת — שום הודעה לא תישלח.',

    // שעות שליחה
    hoursTitle: 'שעות השקט של החשבון',
    hoursIntro: 'זו ברירת המחדל של כל המערכת: כל רצף וכל פלואו שאין לו שעות משלו יורש את החלון הזה. מי שכן הגדיר לעצמו — גובר עליו.',
    quietStart: 'לא שולחים מהשעה',
    quietEnd: 'ועד השעה',
    quietOffTitle: 'החלון כבוי',
    quietOffBody: 'התחלה וסיום זהים — לא נחסמת אף שעה. כדי להפעיל, בחרו שעות שונות.',
    quietOnBody: 'בין {start} ל-{end} לא יוצאות הודעות שיווק. שלב שהגיע זמנו בתוך החלון ממתין לסופו.',
    firstMsgTitle: 'ההודעה הראשונה לליד נשלחת מיד',
    firstMsgBody: 'גם בתוך שעות השקט. זו התשובה לטופס שהליד מילא לפני רגע — עיכוב שלה עד הבוקר הוא ליד שכבר פנה למישהו אחר.',
    shabbatTitle: 'עצירה בשבת ובחג',
    shabbatBody: 'דלוקה כברירת מחדל בכל רצף ובכל פלואו חדש, ונקבעת שם — בהגדרות הרצף או הפלואו, לא כאן. שבת אינה נעקפת אף פעם, גם לא בהודעה הראשונה.',
    save: 'שמירה',
    saved: 'ההגדרות נשמרו',

    // מדיניות ציות
    policyTitle: 'מדיניות ציות',
    policyIntro: 'הכללים שהמנוע אוכף לפני כל שליחת שיווק. המצב בפועל — דירוג המספר, ההתראות והחסומים — נמצא בלשונית "ציות".',
    savePolicy: 'שמירת מדיניות',
    f_require_consent: 'דרוש הסכמה לפני שיווק',
    w_require_consent: 'בלי רשומת הסכמה מטא רואה בהודעה השיווקית ספאם — וזו הסיבה מספר 1 להשבתת מספרים.',
    f_max_marketing_per_day: 'מקסימום הודעות שיווק ליום לאדם',
    w_max_marketing_per_day: 'מטא מענישה ריבוי הודעות שיווקיות לאותו אדם בזמן קצר.',
    f_max_unengaged: 'מקסימום הודעות ללא תגובה',
    w_max_unengaged: 'מי שלא מגיב שוב ושוב צפוי לחסום או לדווח — כל דיווח מוריד את דירוג האיכות.',
    f_max_cap_failures: 'מקסימום כשלי תקרה',
    w_max_cap_failures: 'אחרי כמה כשלי תקרה (131049) עוצרים את איש הקשר — ניסיונות חוזרים נספרים לרעתכם.',
    f_consent_max_age_days: 'תוקף ההסכמה (ימים)',
    w_consent_max_age_days: 'הסכמה מתיישנת: פנייה חודשים אחרי ההרשמה נתפסת כספאם. אחרי התקופה הזו צריך לרענן אותה.',
    f_block_us_marketing: 'חסימת שיווק לארה״ב',
    w_block_us_marketing: 'מטא חסמה הודעות שיווק לנמענים בארה״ב — שליחה לשם תיכשל ותפגע בדירוג.',
    f_halt_on_red: 'עצירה אוטומטית בדירוג אדום',
    w_halt_on_red: 'דירוג אדום הוא הצעד שלפני השבתת המספר — עצירה אוטומטית מצילה את החשבון.',
    f_opt_out_keywords: 'מילות הסרה',
    w_opt_out_keywords: 'כשלקוח כותב אחת מהן הוא נחסם מיידית לשיווק. מופרדות בפסיק.',
    keywordsPlaceholder: 'הסר, הסרה, stop',
  },
  en: {
    navAria: 'Settings sections',
    sec_inbox: 'WhatsApp number',
    sec_hours: 'Sending hours',
    sec_compliance: 'Compliance policy',
    sec_presence: 'Presence',
    errLoad: 'Failed to load settings',
    errSave: 'Failed to save policy',
    refresh: 'Refresh',

    inboxTitle: 'WhatsApp number for sequences',
    inboxHelp: 'This account has several WhatsApp numbers. Sequences are sent from the selected one.',
    inboxNeedsChoice: 'No number selected — and the engine will not guess. Nothing will be sent until you choose which number to send from.',
    inboxActive: 'Active',
    inboxSaved: 'Number saved',
    inboxSingle: 'This account has one WhatsApp number and every sequence sends from it. There is nothing to choose here.',
    inboxNone: 'No WhatsApp inbox is connected to this account — nothing will send.',

    hoursTitle: 'Account quiet hours',
    hoursIntro: 'This is the default for everything: every sequence and every flow without hours of its own inherits this window. One that sets its own overrides it.',
    quietStart: 'Do not send from',
    quietEnd: 'until',
    quietOffTitle: 'The window is off',
    quietOffBody: 'Start and end are identical, so no hour is blocked. Pick different hours to switch it on.',
    quietOnBody: 'No marketing goes out between {start} and {end}. A step that comes due inside the window waits for it to end.',
    firstMsgTitle: 'The first message to a lead sends immediately',
    firstMsgBody: 'Quiet hours included. It is the answer to the form the lead filled in a minute ago — holding it until morning means the lead already called someone else.',
    shabbatTitle: 'Pause on Shabbat and holidays',
    shabbatBody: 'On by default for every new sequence and flow, and set there — in the sequence or flow settings, not here. Shabbat is never bypassed, not even for the first message.',
    save: 'Save',
    saved: 'Settings saved',

    policyTitle: 'Compliance policy',
    policyIntro: 'The rules the engine enforces before every marketing send. The live state — number rating, alerts and blocked contacts — lives in the Compliance tab.',
    savePolicy: 'Save policy',
    f_require_consent: 'Require consent before marketing',
    w_require_consent: 'Without a consent record Meta treats marketing messages as spam — the #1 cause of disabled numbers.',
    f_max_marketing_per_day: 'Max marketing messages per person per day',
    w_max_marketing_per_day: 'Meta penalises multiple marketing messages to the same person in a short window.',
    f_max_unengaged: 'Max unanswered messages',
    w_max_unengaged: 'People who never reply tend to block or report you — every report lowers your quality rating.',
    f_max_cap_failures: 'Max cap failures',
    w_max_cap_failures: 'How many cap failures (131049) before the contact is stopped — repeated attempts count against you.',
    f_consent_max_age_days: 'Consent validity (days)',
    w_consent_max_age_days: 'Consent goes stale: reaching out months after sign-up reads as spam. After this period it must be refreshed.',
    f_block_us_marketing: 'Block US marketing',
    w_block_us_marketing: 'Meta blocked marketing messages to US recipients — sending there fails and hurts your rating.',
    f_halt_on_red: 'Auto-halt on red rating',
    w_halt_on_red: 'A red rating is one step before the number is disabled — an automatic halt saves the account.',
    f_opt_out_keywords: 'Opt-out keywords',
    w_opt_out_keywords: 'When a customer writes one of these they are blocked from marketing immediately. Comma-separated.',
    keywordsPlaceholder: 'stop, unsubscribe',
  },
};

const SECTION_ICON = { inbox: Smartphone, hours: Clock, compliance: ShieldCheck, presence: Eye };

// שעות שלמות לבחירה — drip.compliance שומר שעה שלמה, לא HH:MM
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: `${String(h).padStart(2, '0')}:00`,
}));
const hhmm = (h) => `${String(h).padStart(2, '0')}:00`;

/** כותרת מקטע — אותו סגנון של כותרות המשנה בשאר המסכים. */
function SectionTitle({ icon: Icon, children }) {
  return (
    <h2 className="mb-1 flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
      <Icon size={15} className="text-n-blue-11" aria-hidden="true" />
      {children}
    </h2>
  );
}

export default function SettingsView({ accountId, section = 'inbox', onSection }) {
  const t = useT(M);
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // טופס המדיניות — opt_out_keywords מוחזק כטקסט מופרד-פסיקים (split/join בגבולות).
  // אותו טופס משרת גם את "שעות שליחה" וגם את "מדיניות ציות": שורה אחת בשרת.
  const [form, setForm] = useState(DEFAULT_SETTINGS);
  const [keywordsText, setKeywordsText] = useState('');

  // מספרי הוואטסאפ של החשבון: { inboxes, count, needs_choice }
  const [inboxes, setInboxes] = useState(null);
  const [pickingInbox, setPickingInbox] = useState(false);

  const load = useCallback(() => {
    if (accountId == null) return;
    setLoading(true);
    setError('');
    Promise.all([
      getCompliance(accountId),
      getWhatsappInboxes(accountId).catch(() => null), // בחירת המספר לא שוברת את שאר הלשונית
    ])
      .then(([c, boxes]) => {
        setInboxes(boxes);
        const s = { ...DEFAULT_SETTINGS, ...(c?.settings || {}) };
        setForm(s);
        setKeywordsText((Array.isArray(s.opt_out_keywords) ? s.opt_out_keywords : []).join(', '));
      })
      .catch((e) => setError(e.message || translate(M, 'errLoad')))
      .finally(() => setLoading(false));
  }, [accountId]);

  useEffect(() => { load(); }, [load]);

  // שמירה אחת לכל טופס המדיניות (כולל שעות השקט) — ראה compliancePayload.
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await saveCompliance(compliancePayload(form, keywordsText), accountId);
      toast({ message: t('saved'), variant: 'success' });
      load();
    } catch (e) {
      setError(e.message || translate(M, 'errSave'));
    } finally {
      setSaving(false);
    }
  };

  // בחירת המספר שהרצפים יוצאים ממנו. אין כאן ConfirmDialog בכוונה: הבחירה משנה רק
  // מאיזה מספר יֵצאו ההודעות הבאות, ואינה שולחת דבר.
  const chooseInbox = (inboxId) => {
    setPickingInbox(true);
    setWhatsappInbox(inboxId, accountId)
      .then((res) => {
        setInboxes(res);
        toast({ title: t('inboxSaved'), variant: 'success' });
      })
      .catch((e) => setError(e.message))
      .finally(() => setPickingInbox(false));
  };

  const quiet = quietWindow(form);
  const setHour = (key, v) => setForm((f) => ({ ...f, [key]: Number(v) }));

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-6">
      {/* ניווט המקטעים — כפתורים רגילים (Tab/Enter) עם aria-current; במסך צר הם
          נערמים לשורות במקום להוסיף גלילה אופקית לעמוד. */}
      <nav aria-label={t('navAria')} className="flex flex-wrap gap-1 md:flex-col md:flex-nowrap">
        {SETTINGS_SECTIONS.map((key) => {
          const Icon = SECTION_ICON[key];
          const active = section === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSection?.(key)}
              aria-current={active ? 'page' : undefined}
              className={[
                'flex min-w-0 items-center gap-2 rounded-lg border-0 px-3 py-2 text-start text-sm',
                'transition-all duration-200 ease-out',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-n-brand',
                active
                  ? 'bg-n-solid-active text-n-blue-11 shadow-sm outline outline-1 outline-n-container'
                  : 'text-n-slate-11 hover:bg-n-alpha-1 hover:text-n-brand',
              ].join(' ')}
            >
              <Icon size={15} className="shrink-0" aria-hidden="true" />
              <span className="truncate">{t(`sec_${key}`)}</span>
            </button>
          );
        })}
      </nav>

      <div className="min-w-0">
        {/* באנר שגיאה (פעולה שנכשלה — ההגדרות עדיין מוצגות) */}
        {error ? (
          <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-n-ruby-7 bg-n-ruby-3 px-4 py-3 text-sm text-n-ruby-11">
            <span className="flex items-start gap-2.5">
              <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </span>
            <Button variant="ghost" color="slate" size="sm" icon={RefreshCw} onClick={load}>
              {t('refresh')}
            </Button>
          </div>
        ) : null}

        {loading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-5 w-40" />
            <SkeletonCard />
          </div>
        ) : section === 'inbox' ? (
          <InboxSection
            t={t}
            inboxes={inboxes}
            picking={pickingInbox}
            onChoose={chooseInbox}
          />
        ) : section === 'hours' ? (
          <div className="rounded-xl border border-n-weak bg-n-surface-1 p-4">
            <SectionTitle icon={Clock}>{t('hoursTitle')}</SectionTitle>
            <p className="mb-4 text-sm text-n-slate-11">{t('hoursIntro')}</p>

            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[8rem]">
                <p className="mb-1.5 text-sm font-medium text-n-slate-12">{t('quietStart')}</p>
                <Dropdown
                  ariaLabel={t('quietStart')}
                  value={Number(form.quiet_start_hour) || 0}
                  onChange={(v) => setHour('quiet_start_hour', v)}
                  options={HOUR_OPTIONS}
                />
              </div>
              <div className="min-w-[8rem]">
                <p className="mb-1.5 text-sm font-medium text-n-slate-12">{t('quietEnd')}</p>
                <Dropdown
                  ariaLabel={t('quietEnd')}
                  value={Number(form.quiet_end_hour) || 0}
                  onChange={(v) => setHour('quiet_end_hour', v)}
                  options={HOUR_OPTIONS}
                />
              </div>
            </div>

            <p className="mt-3 text-sm text-n-slate-11">
              {quiet
                ? t('quietOnBody', { start: hhmm(quiet.start), end: hhmm(quiet.end) })
                : t('quietOffBody')}
            </p>

            {/* שני דברים שהמשתמש חייב לדעת על החלון הזה — שניהם התנהגות מכוונת של המנוע */}
            <div className="mt-4 flex flex-col gap-2">
              <Note icon={Zap} title={t('firstMsgTitle')} body={t('firstMsgBody')} />
              <Note icon={Sunset} title={t('shabbatTitle')} body={t('shabbatBody')} />
            </div>

            <div className="mt-4 flex justify-end">
              <Button variant="solid" color="blue" size="sm" icon={Save} loading={saving} onClick={save}>
                {t('save')}
              </Button>
            </div>
          </div>
        ) : section === 'compliance' ? (
          <div className="rounded-xl border border-n-weak bg-n-surface-1 p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <SectionTitle icon={ShieldCheck}>{t('policyTitle')}</SectionTitle>
                <p className="text-sm text-n-slate-11">{t('policyIntro')}</p>
              </div>
              <Button
                variant="solid"
                color="blue"
                size="sm"
                icon={Save}
                loading={saving}
                onClick={save}
                className="shrink-0"
              >
                {t('savePolicy')}
              </Button>
            </div>

            <div className="flex flex-col gap-4">
              {/* מתגים */}
              {BOOL_FIELDS.map((k) => (
                <div key={k} className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-n-slate-12">{t(`f_${k}`)}</p>
                    <p className="mt-0.5 text-xs text-n-slate-11">{t(`w_${k}`)}</p>
                  </div>
                  <Switch
                    checked={!!form[k]}
                    onChange={(v) => setForm((f) => ({ ...f, [k]: v }))}
                    aria-label={t(`f_${k}`)}
                    className="mt-0.5 shrink-0"
                  />
                </div>
              ))}

              {/* מספרים */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {NUMBER_FIELDS.map((k) => (
                  <Input
                    key={k}
                    type="number"
                    min="0"
                    label={t(`f_${k}`)}
                    hint={t(`w_${k}`)}
                    value={form[k] ?? 0}
                    onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                  />
                ))}
              </div>

              {/* מילות הסרה — מופרדות בפסיק */}
              <Input
                label={t('f_opt_out_keywords')}
                hint={t('w_opt_out_keywords')}
                placeholder={t('keywordsPlaceholder')}
                value={keywordsText}
                onChange={(e) => setKeywordsText(e.target.value)}
              />
            </div>
          </div>
        ) : (
          <PresenceView accountId={accountId} />
        )}
      </div>
    </div>
  );
}

/** הערת-הסבר בתוך מקטע (התנהגות מכוונת של המנוע, לא הגדרה שאפשר לשנות כאן). */
function Note({ icon: Icon, title, body }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-n-weak bg-n-alpha-1 px-3 py-2.5">
      <Icon size={15} className="mt-0.5 shrink-0 text-n-slate-10" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-n-slate-12">{title}</p>
        <p className="mt-0.5 text-xs text-n-slate-11">{body}</p>
      </div>
    </div>
  );
}

/*
 * InboxSection — ההחלטה הכי כבדה במוצר: מאיזה מספר יוצאים הרצפים. כשלא נבחר,
 * המנוע עצור (הוא לא מנחש) — ולכן המקטע נראה כמו אזהרה ולא כמו הגדרה.
 */
function InboxSection({ t, inboxes, picking, onChoose }) {
  const list = inboxes?.inboxes || [];
  const needsChoice = !!inboxes?.needs_choice;

  return (
    <div
      className={`rounded-xl border p-4 ${
        needsChoice ? 'border-2 border-n-ruby-9 bg-n-ruby-3' : 'border-n-weak bg-n-surface-1'
      }`}
      role={needsChoice ? 'alert' : undefined}
    >
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
        <Smartphone size={15} className={needsChoice ? 'text-n-ruby-11' : 'text-n-blue-11'} aria-hidden="true" />
        {t('inboxTitle')}
      </h2>

      {list.length === 0 ? (
        <p className="text-sm text-n-slate-11">{t('inboxNone')}</p>
      ) : (
        <>
          <p className={`mb-3 text-sm ${needsChoice ? 'font-medium text-n-ruby-11' : 'text-n-slate-11'}`}>
            {needsChoice ? t('inboxNeedsChoice') : list.length > 1 ? t('inboxHelp') : t('inboxSingle')}
          </p>
          <div className="flex flex-col gap-2">
            {list.map((box) => {
              // מספר יחיד — אין החלטה, ולכן שורת מידע ולא רדיו שאפשר "לבחור" בו את הקיים.
              const row = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-n-slate-12">{box.name}</span>
                    {box.phone_number_id ? (
                      <span className="block truncate text-xs text-n-slate-10" dir="ltr">
                        phone_number_id: {box.phone_number_id}
                      </span>
                    ) : null}
                  </span>
                  {box.chosen || list.length === 1 ? <Badge color="blue">{t('inboxActive')}</Badge> : null}
                </>
              );

              if (list.length === 1) {
                return (
                  <div key={box.id} className="flex items-center gap-3 rounded-lg border border-n-weak px-3 py-2.5">
                    {row}
                  </div>
                );
              }

              return (
                <label
                  key={box.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition ${
                    box.chosen ? 'border-n-blue-9 bg-n-blue-3' : 'border-n-weak hover:bg-n-alpha-1'
                  }`}
                >
                  <input
                    type="radio"
                    name="drip-whatsapp-inbox"
                    className="h-4 w-4 accent-n-blue-9"
                    checked={!!box.chosen}
                    disabled={picking}
                    onChange={() => onChoose(box.id)}
                  />
                  {row}
                </label>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
