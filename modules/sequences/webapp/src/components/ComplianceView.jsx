import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  PlayCircle,
  Check,
  UserCheck,
  FileText,
  Ban,
  Save,
  Tag,
  Activity,
  Smartphone,
} from 'lucide-react';
import Badge from './ui/Badge.jsx';
import Button from './ui/Button.jsx';
import Input from './ui/Input.jsx';
import Switch from './ui/Switch.jsx';
import Modal from './ui/Modal.jsx';
import Dropdown from './ui/Dropdown.jsx';
import ConfirmDialog from './ui/ConfirmDialog.jsx';
import Skeleton, { SkeletonCard, SkeletonRows } from './ui/Skeleton.jsx';
import { Table, THead, TBody, TR, TH, TD } from './ui/Table.jsx';
import { useToast } from './ui/Toast.jsx';
import {
  getCompliance,
  listSuppressed,
  saveCompliance,
  setSuppression,
  consentByLabel,
  resumeAccount,
  ackAlert,
  listLabels,
  getWhatsappInboxes,
  setWhatsappInbox,
} from '../api/sequencesApi.js';
import useT, { useLocale } from '../useT.js';
import { translate } from '../i18n.js';

/*
 * ComplianceView — שכבת הציות של מטא: בריאות המספר (tier/דירוג/עצירה), התראות פתוחות,
 * כיסוי הסכמות, מדיניות השליחה, בריאות התבניות ואנשי הקשר החסומים לשיווק.
 *
 * כל הפעולות עוברות דרך api/sequencesApi.js (אותו `call` כמו שאר האפליקציה).
 * ⚠️ ביטול חסימה הוא פעולת-ציות — תמיד באישור מפורש (ConfirmDialog).
 */

// מילון co-located (he/en) — כל הטקסטים הגלויים של תצוגת הציות.
const M = {
  he: {
    inboxTitle: 'מספר הוואטסאפ של הרצפים',
    inboxHelp: 'לחשבון יש כמה מספרי וואטסאפ. הרצפים יוצאים מהמספר המסומן.',
    inboxNeedsChoice: 'לא נבחר מספר — והמנוע לא ינחש. שום הודעה לא תישלח עד שתבחרו מאיזה מספר לשלוח.',
    inboxActive: 'פעיל',
    inboxSaved: 'המספר נשמר',
    errLoad: 'שגיאה בטעינת נתוני הציות',
    errSave: 'שמירת המדיניות נכשלה',
    errResume: 'חידוש השליחה נכשל',
    errAck: 'סימון ההתראה נכשל',
    errUnblock: 'ביטול החסימה נכשל',
    errConsent: 'רישום ההסכמה נכשל',
    errLoadLabels: 'שגיאה בטעינת התוויות',
    refresh: 'רענון',

    // עצירה
    haltedTitle: 'השליחה נעצרה אוטומטית',
    haltedBody: 'המנוע הפסיק לשלוח הודעות כדי להגן על מספר הוואטסאפ שלכם. תקנו את הסיבה ואז חדשו את השליחה.',
    haltedAt: 'נעצר ב-',
    resume: 'חדש שליחה',
    resumed: 'השליחה חודשה',
    resumeConfirmTitle: 'לחדש את השליחה?',
    resumeConfirmBody: 'ודאו שהסיבה לעצירה טופלה. חידוש בזמן שהבעיה קיימת עלול להוביל להשבתת המספר על ידי מטא.',

    // בריאות
    healthTitle: 'בריאות המספר',
    quality: 'דירוג איכות',
    tier: 'רמת שליחה',
    cap: 'תקרה יומית',
    unlimited: 'ללא הגבלה',
    checkedAt: 'נבדק לאחרונה',
    qGREEN: 'ירוק',
    qYELLOW: 'צהוב',
    qRED: 'אדום',
    qUnknown: 'לא ידוע',
    sending: 'שולח',
    halted: 'עצור',

    // התראות
    alertsTitle: 'התראות פתוחות',
    ackAria: 'סימון ההתראה כטופלה',
    lv_critical: 'קריטי',
    lv_warning: 'אזהרה',
    lv_info: 'מידע',

    // הסכמות
    consentTitle: 'כיסוי הסכמות',
    consentCovered: '{n} מתוך {total} אנשי קשר עם רשומת הסכמה',
    consentCta: '{n} אנשי קשר משויכים לרצף בלי רשומת הסכמה — שיווק אליהם חסום.',
    consentBlanketCovered: 'הצהרת בעל המידע חלה על כל {total} אנשי הקשר',
    consentBlanketOk: 'הצהרת בעל המידע בתוקף — אף ליד אינו חסום בגלל הסכמה.',
    consentBlanketGlobal: 'תנאי ההתקשרות הסטנדרטיים',
    consentCtaBtn: 'רישום הסכמה לפי תווית',
    contactsKnown: 'אנשי קשר',
    contactsSuppressed: 'חסומים לשיווק',
    contactsStale: 'הסכמה שהתיישנה',

    // מודאל הסכמה
    consentModalTitle: 'רישום הסכמה לפי תווית',
    consentModalBody: 'כל אנשי הקשר שנושאים את התווית יקבלו רשומת הסכמה — ומאותו רגע מותר לשלוח אליהם שיווק.',
    labelField: 'תווית',
    selectLabel: 'בחרו תווית…',
    selectLabelAria: 'בחירת תווית',
    loadingLabels: 'טוען תוויות…',
    sourceField: 'מקור ההסכמה',
    selectSource: 'בחרו מקור…',
    selectSourceAria: 'בחירת מקור ההסכמה',
    sourceHint: 'מטא דורשת לדעת *איך* התקבלה ההסכמה — זו ההוכחה שלכם במקרה של תלונה.',
    detailField: 'פירוט (לא חובה)',
    detailPlaceholder: 'למשל: שם הקמפיין / הטופס',
    detailHint: 'תיעוד חופשי — שם הקמפיין, הטופס או האירוע שבו ניתנה ההסכמה.',
    record: 'רשום הסכמה',
    consentDone: 'נרשמה הסכמה ל-{count} אנשי קשר',
    close: 'סגירה',
    cancel: 'ביטול',
    src_lead_ad: 'טופס לידים (מודעה)',
    src_ctwa: 'מודעה עם כפתור וואטסאפ',
    src_website_form: 'טופס באתר',
    src_purchase: 'רכישה',
    src_phone: 'שיחת טלפון',
    src_manual: 'ידני',
    src_import: 'ייבוא',

    // מדיניות
    settingsTitle: 'מדיניות ציות',
    save: 'שמירת מדיניות',
    saved: 'המדיניות נשמרה',
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

    // תבניות
    templatesTitle: 'בריאות התבניות',
    colTemplate: 'תבנית',
    colLang: 'שפה',
    colCategory: 'קטגוריה',
    colStatus: 'סטטוס',
    colQuality: 'איכות',
    noTemplates: 'אין תבניות.',
    ts_APPROVED: 'מאושרת',
    ts_PENDING: 'ממתינה',
    ts_REJECTED: 'נדחתה',
    ts_PAUSED: 'מושהית',
    ts_DISABLED: 'מושבתת',

    // חסומים
    suppressedTitle: 'חסומים לשיווק',
    colContact: 'איש קשר',
    colPhone: 'טלפון',
    colReason: 'סיבה',
    colDetail: 'פירוט',
    colWhen: 'מתי',
    colAction: 'פעולה',
    unblock: 'בטל חסימה',
    unblocked: 'החסימה בוטלה',
    noSuppressed: 'אין אנשי קשר חסומים.',
    unblockTitle: 'ביטול חסימה',
    unblockBody: 'החסימה על {name} תוסר והשיווק אליו/אליה יתחדש. אם הוא/היא ביקש/ה הסרה — ביטול החסימה חושף אתכם לתלונה במטא.',
    rs_keyword: 'ביקש/ה הסרה',
    rs_meta_131050: 'סירב/ה לשיווק במטא',
    rs_meta_368: 'חסימת מדיניות',
    rs_saturated: 'מיצה/תה את המכסה האישית',
    rs_unengaged: 'לא פתח/ה הודעות',
    rs_invalid: 'מספר לא תקין',
    rs_manual: 'ידני',
  },
  en: {
    inboxTitle: 'WhatsApp number for sequences',
    inboxHelp: 'This account has several WhatsApp numbers. Sequences are sent from the selected one.',
    inboxNeedsChoice: 'No number selected — and the engine will not guess. Nothing will be sent until you choose which number to send from.',
    inboxActive: 'Active',
    inboxSaved: 'Number saved',
    errLoad: 'Failed to load compliance data',
    errSave: 'Failed to save policy',
    errResume: 'Failed to resume sending',
    errAck: 'Failed to dismiss alert',
    errUnblock: 'Failed to unblock',
    errConsent: 'Failed to record consent',
    errLoadLabels: 'Failed to load labels',
    refresh: 'Refresh',

    haltedTitle: 'Sending was halted automatically',
    haltedBody: 'The engine stopped sending to protect your WhatsApp number. Fix the cause, then resume sending.',
    haltedAt: 'Halted at ',
    resume: 'Resume sending',
    resumed: 'Sending resumed',
    resumeConfirmTitle: 'Resume sending?',
    resumeConfirmBody: 'Make sure the cause of the halt is resolved. Resuming while the problem persists can get your number disabled by Meta.',

    healthTitle: 'Number health',
    quality: 'Quality rating',
    tier: 'Messaging tier',
    cap: 'Daily cap',
    unlimited: 'Unlimited',
    checkedAt: 'Last checked',
    qGREEN: 'Green',
    qYELLOW: 'Yellow',
    qRED: 'Red',
    qUnknown: 'Unknown',
    sending: 'Sending',
    halted: 'Halted',

    alertsTitle: 'Open alerts',
    ackAria: 'Dismiss alert',
    lv_critical: 'Critical',
    lv_warning: 'Warning',
    lv_info: 'Info',

    consentTitle: 'Consent coverage',
    consentCovered: '{n} of {total} contacts have a consent record',
    consentCta: '{n} contacts are enrolled in a sequence without a consent record — marketing to them is blocked.',
    consentBlanketCovered: 'A data-owner declaration covers all {total} contacts',
    consentBlanketOk: 'Data-owner declaration in force — no lead is blocked for consent.',
    consentBlanketGlobal: 'standard contract terms',
    consentCtaBtn: 'Record consent by label',
    contactsKnown: 'Contacts',
    contactsSuppressed: 'Blocked for marketing',
    contactsStale: 'Stale consent',

    consentModalTitle: 'Record consent by label',
    consentModalBody: 'Every contact carrying this label gets a consent record — from that moment marketing to them is allowed.',
    labelField: 'Label',
    selectLabel: 'Select label…',
    selectLabelAria: 'Select label',
    loadingLabels: 'Loading labels…',
    sourceField: 'Consent source',
    selectSource: 'Select source…',
    selectSourceAria: 'Select consent source',
    sourceHint: 'Meta requires you to know *how* consent was obtained — it is your proof if a complaint is filed.',
    detailField: 'Detail (optional)',
    detailPlaceholder: 'e.g. campaign / form name',
    detailHint: 'Free text — the campaign, form or event where consent was given.',
    record: 'Record consent',
    consentDone: 'Consent recorded for {count} contacts',
    close: 'Close',
    cancel: 'Cancel',
    src_lead_ad: 'Lead ad form',
    src_ctwa: 'Click-to-WhatsApp ad',
    src_website_form: 'Website form',
    src_purchase: 'Purchase',
    src_phone: 'Phone call',
    src_manual: 'Manual',
    src_import: 'Import',

    settingsTitle: 'Compliance policy',
    save: 'Save policy',
    saved: 'Policy saved',
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

    templatesTitle: 'Template health',
    colTemplate: 'Template',
    colLang: 'Language',
    colCategory: 'Category',
    colStatus: 'Status',
    colQuality: 'Quality',
    noTemplates: 'No templates.',
    ts_APPROVED: 'Approved',
    ts_PENDING: 'Pending',
    ts_REJECTED: 'Rejected',
    ts_PAUSED: 'Paused',
    ts_DISABLED: 'Disabled',

    suppressedTitle: 'Blocked for marketing',
    colContact: 'Contact',
    colPhone: 'Phone',
    colReason: 'Reason',
    colDetail: 'Detail',
    colWhen: 'When',
    colAction: 'Action',
    unblock: 'Unblock',
    unblocked: 'Contact unblocked',
    noSuppressed: 'No blocked contacts.',
    unblockTitle: 'Unblock contact',
    unblockBody: 'The block on {name} will be removed and marketing will resume. If they asked to opt out, unblocking exposes you to a Meta complaint.',
    rs_keyword: 'Asked to opt out',
    rs_meta_131050: 'Opted out at Meta',
    rs_meta_368: 'Policy block',
    rs_saturated: 'Hit their personal cap',
    rs_unengaged: 'Never opened messages',
    rs_invalid: 'Invalid number',
    rs_manual: 'Manual',
  },
};

// ברירות מחדל — ה-API מחזיר settings:{} כשאין שורה לחשבון.
const DEFAULT_SETTINGS = {
  require_consent: true,
  max_marketing_per_day: 1,
  max_unengaged: 3,
  max_cap_failures: 2,
  consent_max_age_days: 30,
  block_us_marketing: true,
  halt_on_red: true,
  opt_out_keywords: [],
};

// שדות המדיניות המספריים — טופס אחיד (תווית + "למה זה קיים" + input)
const NUMBER_FIELDS = ['max_marketing_per_day', 'max_unengaged', 'max_cap_failures', 'consent_max_age_days'];
// שדות המדיניות הבוליאניים — מתגים
const BOOL_FIELDS = ['require_consent', 'block_us_marketing', 'halt_on_red'];

const CONSENT_SOURCES = ['lead_ad', 'ctwa', 'website_form', 'purchase', 'phone', 'manual', 'import'];

const QUALITY_COLOR = { GREEN: 'teal', YELLOW: 'amber', RED: 'ruby' };
const ALERT_COLOR = { critical: 'ruby', warning: 'amber', info: 'blue' };
// סטטוס תבנית: PAUSED/REJECTED/DISABLED = מסוכן (התבנית לא תישלח) → ruby + אייקון אזהרה.
const TSTATUS_COLOR = { APPROVED: 'teal', PENDING: 'amber', REJECTED: 'ruby', PAUSED: 'ruby', DISABLED: 'ruby' };
const ALARMING = ['PAUSED', 'REJECTED', 'DISABLED'];

export default function ComplianceView({ accountId }) {
  const t = useT(M);
  const locale = useLocale();
  const { toast } = useToast();

  // translate() נופל למפתח עצמו כשאין תרגום — כך ערך אֵנוּם חדש מהשרת (סטטוס/סיבה שלא
  // מוכרים ל-UI) מוצג כמו שהוא במקום להציג מפתח שבור.
  const tOr = (key, raw) => (t(key) === key ? raw : t(key));

  const [data, setData] = useState(null);
  const [suppressed, setSuppressed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // טופס המדיניות — opt_out_keywords מוחזק כטקסט מופרד-פסיקים (split/join בגבולות).
  const [form, setForm] = useState(DEFAULT_SETTINGS);
  const [keywordsText, setKeywordsText] = useState('');
  const [saving, setSaving] = useState(false);

  // מספרי הוואטסאפ של החשבון. count<=1 ⇒ אין מה לבחור והמקטע לא מוצג בכלל.
  const [inboxes, setInboxes] = useState(null);
  const [pickingInbox, setPickingInbox] = useState(false);

  // בחירת המספר שהרצפים יוצאים ממנו. אין כאן ConfirmDialog בכוונה: הבחירה משנה רק
  // מאיזה מספר יֵצאו ההודעות הבאות, ואינה שולחת דבר — לעומת ביטול חסימה, שהוא פעולת ציות.
  const chooseInbox = useCallback(
    (inboxId) => {
      setPickingInbox(true);
      setWhatsappInbox(inboxId, accountId)
        .then((res) => {
          setInboxes(res);
          toast({ title: t('inboxSaved'), variant: 'success' });
        })
        .catch((e) => setError(e.message))
        .finally(() => setPickingInbox(false));
    },
    [accountId, t, toast]
  );

  const [resumeOpen, setResumeOpen] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [unblockTarget, setUnblockTarget] = useState(null);
  const [unblocking, setUnblocking] = useState(false);

  // תאריך בפורמט המקומי (זהה ל-CampaignDetailView)
  const fmt = useCallback(
    (iso) => (iso ? new Date(iso).toLocaleString(locale === 'he' ? 'he-IL' : 'en-GB') : '—'),
    [locale]
  );

  const load = useCallback(() => {
    if (accountId == null) return;
    setLoading(true);
    setError('');
    Promise.all([
      getCompliance(accountId),
      listSuppressed(accountId).catch(() => []), // רשימת החסומים — לא קריטית, לא שוברת את התצוגה
      getWhatsappInboxes(accountId).catch(() => null),
    ])
      .then(([c, sup, boxes]) => {
        setData(c || {});
        setSuppressed(sup);
        setInboxes(boxes);
        const s = { ...DEFAULT_SETTINGS, ...(c?.settings || {}) };
        setForm(s);
        setKeywordsText((Array.isArray(s.opt_out_keywords) ? s.opt_out_keywords : []).join(', '));
      })
      .catch((e) => setError(e.message || translate(M, 'errLoad')))
      .finally(() => setLoading(false));
  }, [accountId]);

  useEffect(() => { load(); }, [load]);

  const health = data?.health || {};
  const contacts = data?.contacts || {};
  const alerts = data?.alerts || [];
  const templates = data?.templates || [];
  // `missing_consent` = מי שבאמת חסום, כפי ש-canSend מחשב אותו. כשקיימת הצהרת בעל המידע
  // (blanket_consent) — הלקוח חתם שכל הרשימה שלו הסכימה — אף אחד אינו חסום, והשרת מחזיר 0.
  // קודם הדשבורד ספר "מי שאין לו consent_at" והתריע "שיווק אליהם חסום" על לידים שקיבלו
  // הודעה באותו בוקר. ⚠️ הכיסוי מוצג 100% כשההצהרה בתוקף, כי זו האמת התפעולית.
  const blanket = data?.blanket_consent || null;
  const missing = Number(data?.missing_consent) || 0;
  const withConsent = Number(contacts.with_consent) || 0;
  const noRecord = Number(data?.without_consent_record) || 0;
  const consentTotal = withConsent + noRecord;
  const consentPct = blanket
    ? 100
    : (consentTotal > 0 ? Math.round((withConsent / consentTotal) * 100) : 100);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await saveCompliance(
        {
          ...form,
          ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, Number(form[k]) || 0])),
          opt_out_keywords: keywordsText.split(',').map((s) => s.trim()).filter(Boolean),
        },
        accountId
      );
      toast({ message: t('saved'), variant: 'success' });
      load();
    } catch (e) {
      setError(e.message || translate(M, 'errSave'));
    } finally {
      setSaving(false);
    }
  };

  const doResume = async () => {
    setResuming(true);
    setError('');
    try {
      await resumeAccount(accountId);
      setResumeOpen(false);
      toast({ message: t('resumed'), variant: 'success' });
      load();
    } catch (e) {
      setError(e.message || translate(M, 'errResume'));
    } finally {
      setResuming(false);
    }
  };

  const dismissAlert = async (id) => {
    setError('');
    setData((d) => ({ ...d, alerts: (d.alerts || []).filter((a) => a.id !== id) })); // אופטימי
    try {
      await ackAlert(id, accountId);
    } catch (e) {
      setError(e.message || translate(M, 'errAck'));
      load();
    }
  };

  const doUnblock = async () => {
    if (!unblockTarget) return;
    setUnblocking(true);
    setError('');
    try {
      await setSuppression(unblockTarget.contact_id, false, accountId);
      setUnblockTarget(null);
      toast({ message: t('unblocked'), variant: 'success' });
      load();
    } catch (e) {
      setError(e.message || translate(M, 'errUnblock'));
    } finally {
      setUnblocking(false);
    }
  };

  if (loading) {
    return (
      <>
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => <SkeletonCard key={i} />)}
        </div>
        <Skeleton className="mb-3 h-5 w-32" />
        <SkeletonRows rows={4} cols={5} />
      </>
    );
  }

  if (error && !data) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-n-ruby-7 bg-n-ruby-3 px-4 py-3 text-sm text-n-ruby-11">
        <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>{error}</span>
      </div>
    );
  }

  const qColor = QUALITY_COLOR[health.quality] || 'slate';

  return (
    <>
      {/* באנר שגיאה (פעולה שנכשלה — הנתונים עדיין מוצגים) */}
      {error ? (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-n-ruby-7 bg-n-ruby-3 px-4 py-3 text-sm text-n-ruby-11">
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {/* ⛔ עצירה אוטומטית — האלמנט הכי חשוב במסך. אי אפשר לפספס. */}
      {health.halted ? (
        <div
          role="alert"
          className="mb-5 rounded-xl border-2 border-n-ruby-9 bg-n-ruby-3 p-5 shadow-sm"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3.5">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-n-ruby-9 text-white" aria-hidden="true">
                <ShieldAlert size={24} strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <p className="text-base font-semibold text-n-ruby-12">{t('haltedTitle')}</p>
                {health.halt_reason ? (
                  <p className="mt-1 text-sm font-medium text-n-ruby-11">{health.halt_reason}</p>
                ) : null}
                <p className="mt-1 text-sm text-n-slate-11">{t('haltedBody')}</p>
                {health.halted_at ? (
                  <p className="mt-1 text-xs text-n-slate-10">{t('haltedAt')}{fmt(health.halted_at)}</p>
                ) : null}
              </div>
            </div>
            <Button
              variant="solid"
              color="ruby"
              icon={PlayCircle}
              className="shrink-0"
              onClick={() => setResumeOpen(true)}
            >
              {t('resume')}
            </Button>
          </div>
        </div>
      ) : null}

      {/* ── מספר הוואטסאפ ────────────────────────────────────────────────────
          מוצג רק כשיש באמת ממה לבחור (יותר ממספר אחד). לחשבון עם מספר יחיד אין כאן
          החלטה, ומקטע קבוע היה רק רעש. כשלא נבחר מספר — המנוע עצור, ולכן זה נראה
          כמו אזהרה ולא כמו הגדרה. */}
      {inboxes && inboxes.count > 1 ? (
        <div
          className={`mb-5 rounded-xl border p-4 ${
            inboxes.needs_choice
              ? 'border-2 border-n-ruby-9 bg-n-ruby-3'
              : 'border-n-strong bg-n-solid-1'
          }`}
          role={inboxes.needs_choice ? 'alert' : undefined}
        >
          <h2 className="mb-1 flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
            <Smartphone size={15} className={inboxes.needs_choice ? 'text-n-ruby-11' : 'text-n-blue-11'} aria-hidden="true" />
            {t('inboxTitle')}
          </h2>
          <p className={`mb-3 text-sm ${inboxes.needs_choice ? 'font-medium text-n-ruby-11' : 'text-n-slate-11'}`}>
            {inboxes.needs_choice ? t('inboxNeedsChoice') : t('inboxHelp')}
          </p>
          <div className="flex flex-col gap-2">
            {(inboxes.inboxes || []).map((box) => (
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
                  disabled={pickingInbox}
                  onChange={() => chooseInbox(box.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-n-slate-12">{box.name}</span>
                  {box.phone_number_id ? (
                    <span className="block truncate text-xs text-n-slate-10" dir="ltr">
                      phone_number_id: {box.phone_number_id}
                    </span>
                  ) : null}
                </span>
                {box.chosen ? <Badge color="blue">{t('inboxActive')}</Badge> : null}
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {/* בריאות המספר */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
          <Activity size={15} className="text-n-blue-11" aria-hidden="true" />
          {t('healthTitle')}
        </h2>
        <Button variant="ghost" color="slate" size="sm" icon={RefreshCw} onClick={load}>
          {t('refresh')}
        </Button>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col items-start rounded-xl bg-n-alpha-1 px-4 py-3 ring-1 ring-n-weak">
          <span className="flex items-center gap-2">
            <span className={`inline-block h-3 w-3 rounded-full ${
              health.quality === 'GREEN' ? 'bg-n-teal-9'
                : health.quality === 'YELLOW' ? 'bg-n-amber-9'
                  : health.quality === 'RED' ? 'bg-n-ruby-9' : 'bg-n-slate-8'
            }`} aria-hidden="true" />
            <span className={`text-2xl font-semibold leading-none ${
              qColor === 'teal' ? 'text-n-teal-11' : qColor === 'amber' ? 'text-n-amber-11' : qColor === 'ruby' ? 'text-n-ruby-11' : 'text-n-slate-12'
            }`}>
              {health.quality ? tOr(`q${health.quality}`, health.quality) : t('qUnknown')}
            </span>
          </span>
          <span className="mt-1 text-xs text-n-slate-11">{t('quality')}</span>
        </div>

        <div className="flex flex-col items-start rounded-xl bg-n-alpha-1 px-4 py-3 ring-1 ring-n-weak">
          <span className="text-2xl font-semibold leading-none text-n-slate-12">
            {health.cap === -1 ? t('unlimited') : (health.cap ?? '—')}
          </span>
          <span className="mt-1 text-xs text-n-slate-11">
            {t('cap')}
            {health.tier ? <> · <span className="font-mono text-n-slate-10">{health.tier}</span></> : null}
          </span>
        </div>

        <div className="flex flex-col items-start rounded-xl bg-n-alpha-1 px-4 py-3 ring-1 ring-n-weak">
          <span className="flex items-center gap-1.5">
            {health.halted ? (
              <Badge color="ruby"><ShieldAlert size={12} aria-hidden="true" />{t('halted')}</Badge>
            ) : (
              <Badge color="teal"><ShieldCheck size={12} aria-hidden="true" />{t('sending')}</Badge>
            )}
          </span>
          <span className="mt-2 text-xs text-n-slate-11">
            {t('checkedAt')}: <span className="text-n-slate-12">{fmt(health.checked_at)}</span>
          </span>
        </div>
      </div>

      {/* התראות פתוחות */}
      {alerts.length > 0 ? (
        <div className="mb-5 rounded-xl border border-n-weak bg-n-surface-1 p-4">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
            <AlertTriangle size={15} className="text-n-amber-11" aria-hidden="true" />
            {t('alertsTitle')}
          </h2>
          <div className="flex flex-col gap-2">
            {alerts.map((a) => {
              const c = ALERT_COLOR[a.level] || 'slate';
              return (
                <div
                  key={a.id}
                  className={`flex items-start justify-between gap-3 rounded-lg px-3 py-2.5 ${
                    c === 'ruby' ? 'border border-n-ruby-7 bg-n-ruby-3'
                      : c === 'amber' ? 'border border-n-amber-7 bg-n-amber-3'
                        : 'border border-n-weak bg-n-alpha-1'
                  }`}
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <Badge color={c}>{tOr(`lv_${a.level}`, a.level)}</Badge>
                    <div className="min-w-0">
                      <p className="text-sm text-n-slate-12">{a.message}</p>
                      <p className="mt-0.5 text-xs text-n-slate-10">
                        {a.code ? <span className="font-mono">{a.code}</span> : null}
                        {a.code && a.created_at ? ' · ' : null}
                        {a.created_at ? fmt(a.created_at) : null}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    color="slate"
                    size="sm"
                    iconOnly
                    icon={Check}
                    aria-label={t('ackAria')}
                    onClick={() => dismissAlert(a.id)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* כיסוי הסכמות */}
      <div className="mb-5 rounded-xl border border-n-weak bg-n-surface-1 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
            <UserCheck size={15} className="text-n-blue-11" aria-hidden="true" />
            {t('consentTitle')}
          </h2>
          <span className="text-xl font-semibold text-n-slate-12">{consentPct}%</span>
        </div>

        <p className="mt-2 text-xs text-n-slate-11">
          {blanket
            ? t('consentBlanketCovered', { total: contacts.known ?? 0 })
            : t('consentCovered', { n: withConsent, total: consentTotal })}
        </p>
        <div className="mt-1.5 h-2 w-full rounded-full bg-n-alpha-3" aria-hidden="true">
          <div
            className={`h-2 rounded-full ${missing > 0 ? 'bg-n-amber-9' : 'bg-n-teal-9'}`}
            style={{ width: `${consentPct}%` }}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-n-slate-11">
          <span>{t('contactsKnown')}: <span className="font-medium text-n-slate-12">{contacts.known ?? 0}</span></span>
          <span>{t('contactsSuppressed')}: <span className="font-medium text-n-ruby-11">{contacts.suppressed ?? 0}</span></span>
          <span>{t('contactsStale')}: <span className="font-medium text-n-amber-11">{contacts.stale ?? 0}</span></span>
        </div>

        {blanket ? (
          /* הצהרת בעל המידע בתוקף — אף ליד אינו חסום. זו האמת, וזו גם הראיה מול רגולטור. */
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-n-teal-7 bg-n-teal-3 px-3 py-2.5 text-sm text-n-teal-12">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-n-teal-11" aria-hidden="true" />
            <span>
              {t('consentBlanketOk')}
              {blanket.declared_at ? (
                <span className="text-n-slate-11">
                  {' · '}{new Date(blanket.declared_at).toLocaleDateString('he-IL')}
                  {blanket.account_id === 0 ? ` · ${t('consentBlanketGlobal')}` : ''}
                </span>
              ) : null}
            </span>
          </div>
        ) : missing > 0 ? (
          <div className="mt-3 flex flex-col gap-2.5 rounded-lg border border-n-amber-7 bg-n-amber-3 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-start gap-2 text-sm text-n-amber-12">
              <AlertCircle size={15} className="mt-0.5 shrink-0 text-n-amber-11" aria-hidden="true" />
              {t('consentCta', { n: missing })}
            </span>
            <Button
              variant="solid"
              color="amber"
              size="sm"
              icon={Tag}
              className="shrink-0"
              onClick={() => setConsentOpen(true)}
            >
              {t('consentCtaBtn')}
            </Button>
          </div>
        ) : null}
      </div>

      {/* מדיניות ציות */}
      <div className="mb-5 rounded-xl border border-n-weak bg-n-surface-1 p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
            <ShieldCheck size={15} className="text-n-blue-11" aria-hidden="true" />
            {t('settingsTitle')}
          </h2>
          <Button variant="solid" color="blue" size="sm" icon={Save} loading={saving} onClick={save}>
            {t('save')}
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

      {/* בריאות התבניות */}
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
        <FileText size={15} className="text-n-blue-11" aria-hidden="true" />
        {t('templatesTitle')}
      </h2>
      {templates.length === 0 ? (
        <div className="mb-5 rounded-xl border border-dashed border-n-strong bg-n-solid-2 py-10 text-center text-sm text-n-slate-11">
          {t('noTemplates')}
        </div>
      ) : (
        <div className="mb-5">
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>{t('colTemplate')}</TH>
                <TH>{t('colLang')}</TH>
                <TH>{t('colCategory')}</TH>
                <TH>{t('colStatus')}</TH>
                <TH>{t('colQuality')}</TH>
              </TR>
            </THead>
            <TBody>
              {templates.map((tp) => {
                const alarming = ALARMING.includes(tp.status);
                return (
                  <TR key={`${tp.template_name}_${tp.language}`} className={alarming ? 'bg-n-ruby-3 hover:bg-n-ruby-4' : ''}>
                    <TD><span className="font-mono text-xs text-n-slate-12">{tp.template_name}</span></TD>
                    <TD><span className="text-xs text-n-slate-11">{tp.language}</span></TD>
                    <TD><span className="text-xs text-n-slate-11">{tp.category}</span></TD>
                    <TD>
                      <Badge color={TSTATUS_COLOR[tp.status] || 'slate'}>
                        {alarming ? <AlertTriangle size={12} aria-hidden="true" /> : null}
                        {tOr(`ts_${tp.status}`, tp.status)}
                      </Badge>
                    </TD>
                    <TD>
                      <Badge color={QUALITY_COLOR[tp.quality] || 'slate'}>
                        {tp.quality ? tOr(`q${tp.quality}`, tp.quality) : t('qUnknown')}
                      </Badge>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}

      {/* חסומים לשיווק */}
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
        <Ban size={15} className="text-n-ruby-11" aria-hidden="true" />
        {t('suppressedTitle')}
      </h2>
      {suppressed.length === 0 ? (
        <div className="rounded-xl border border-dashed border-n-strong bg-n-solid-2 py-10 text-center text-sm text-n-slate-11">
          {t('noSuppressed')}
        </div>
      ) : (
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>{t('colContact')}</TH>
              <TH>{t('colPhone')}</TH>
              <TH>{t('colReason')}</TH>
              <TH>{t('colDetail')}</TH>
              <TH>{t('colWhen')}</TH>
              <TH align="end">{t('colAction')}</TH>
            </TR>
          </THead>
          <TBody>
            {suppressed.map((c) => (
              <TR key={c.contact_id}>
                <TD><span className="font-medium text-n-slate-12">{c.name || '—'}</span></TD>
                <TD><span className="font-mono text-xs text-n-slate-11">{c.phone || '—'}</span></TD>
                <TD>
                  <Badge color="ruby">{tOr(`rs_${c.suppressed_reason}`, c.suppressed_reason)}</Badge>
                </TD>
                <TD><span className="text-xs text-n-slate-11">{c.suppressed_detail || '—'}</span></TD>
                <TD><span className="text-xs text-n-slate-11">{fmt(c.suppressed_at)}</span></TD>
                <TD align="end">
                  <Button variant="faded" color="slate" size="sm" onClick={() => setUnblockTarget(c)}>
                    {t('unblock')}
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {/* אישור חידוש שליחה */}
      <ConfirmDialog
        open={resumeOpen}
        onClose={() => setResumeOpen(false)}
        onConfirm={doResume}
        title={t('resumeConfirmTitle')}
        description={t('resumeConfirmBody')}
        confirmLabel={t('resume')}
        cancelLabel={t('cancel')}
        tone="warning"
        loading={resuming}
      />

      {/* אישור ביטול חסימה — פעולת ציות, תמיד באישור מפורש */}
      <ConfirmDialog
        open={!!unblockTarget}
        onClose={() => setUnblockTarget(null)}
        onConfirm={doUnblock}
        title={t('unblockTitle')}
        description={t('unblockBody', { name: unblockTarget?.name || unblockTarget?.phone || '' })}
        confirmLabel={t('unblock')}
        cancelLabel={t('cancel')}
        tone="danger"
        loading={unblocking}
      />

      <ConsentByLabelModal
        open={consentOpen}
        onClose={() => setConsentOpen(false)}
        accountId={accountId}
        onDone={load}
      />
    </>
  );
}

/*
 * ConsentByLabelModal — רישום הסכמה לכל אנשי הקשר עם תווית Chatwoot מסוימת.
 * דפוס זהה ל-BulkEnrollModal (טעינת תוויות בכל פתיחה, מסך תוצאה עם ספירה).
 */
function ConsentByLabelModal({ open, onClose, accountId, onDone }) {
  const t = useT(M);
  const [labels, setLabels] = useState([]);
  const [label, setLabel] = useState('');
  const [source, setSource] = useState('');
  const [detail, setDetail] = useState('');
  const [loadingLabels, setLoadingLabels] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  // טעינת התוויות בכל פתיחה (איפוס מצב)
  useEffect(() => {
    if (!open || accountId == null) return;
    setLoadingLabels(true);
    setError('');
    setResult(null);
    setLabel('');
    setSource('');
    setDetail('');
    listLabels(accountId)
      .then(setLabels)
      .catch((e) => setError(e.message || translate(M, 'errLoadLabels')))
      .finally(() => setLoadingLabels(false));
  }, [open, accountId]);

  const labelOptions = useMemo(
    () => labels.map((l) => ({ value: l.label, label: `${l.label} (${l.count})` })),
    [labels]
  );
  const sourceOptions = CONSENT_SOURCES.map((s) => ({ value: s, label: t(`src_${s}`) }));

  const run = async () => {
    if (!label || !source) return;
    setRunning(true);
    setError('');
    try {
      const res = await consentByLabel(label, source, detail.trim(), accountId);
      setResult(res);
      onDone?.();
    } catch (e) {
      setError(e.message || translate(M, 'errConsent'));
    } finally {
      setRunning(false);
    }
  };

  const footer = result ? (
    <Button variant="solid" color="blue" onClick={onClose}>{t('close')}</Button>
  ) : (
    <>
      <Button variant="ghost" color="slate" onClick={onClose} disabled={running}>
        {t('cancel')}
      </Button>
      <Button
        variant="solid"
        color="blue"
        icon={UserCheck}
        onClick={run}
        loading={running}
        disabled={!label || !source}
      >
        {t('record')}
      </Button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('consentModalTitle')}
      variant="center"
      size="md"
      footer={footer}
    >
      {result ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-n-teal-3 text-n-teal-11">
            <UserCheck size={24} aria-hidden="true" />
          </span>
          <p className="text-base font-medium text-n-slate-12">
            {t('consentDone', { count: result?.count ?? 0 })}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {error ? (
            <div className="flex items-start gap-2 rounded-lg border border-n-ruby-7 bg-n-ruby-3 px-3 py-2 text-sm text-n-ruby-11">
              <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          <p className="text-sm text-n-slate-11">{t('consentModalBody')}</p>

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
              <Tag size={14} className="text-n-slate-10" aria-hidden="true" /> {t('labelField')}
            </p>
            <Dropdown
              value={label}
              onChange={setLabel}
              options={labelOptions}
              disabled={loadingLabels}
              placeholder={t('selectLabel')}
              ariaLabel={t('selectLabelAria')}
            />
            {loadingLabels ? <p className="mt-1 text-xs text-n-slate-11">{t('loadingLabels')}</p> : null}
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium text-n-slate-12">{t('sourceField')}</p>
            <Dropdown
              value={source}
              onChange={setSource}
              options={sourceOptions}
              placeholder={t('selectSource')}
              ariaLabel={t('selectSourceAria')}
            />
            <p className="mt-1 text-xs text-n-slate-11">{t('sourceHint')}</p>
          </div>

          <Input
            label={t('detailField')}
            placeholder={t('detailPlaceholder')}
            hint={t('detailHint')}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
          />
        </div>
      )}
    </Modal>
  );
}
