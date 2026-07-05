import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  Copy,
  ArrowUp,
  ArrowDown,
  MessageSquare,
  Clock,
  AlertCircle,
  GripVertical,
  ChevronDown,
  CalendarClock,
  Eye,
  Image as ImageIcon,
  UploadCloud,
  Loader2,
  CheckCircle2,
  X,
  Film,
} from 'lucide-react';
import Modal from './ui/Modal.jsx';
import Button from './ui/Button.jsx';
import Input from './ui/Input.jsx';
import Dropdown from './ui/Dropdown.jsx';
import Switch from './ui/Switch.jsx';
import Card from './ui/Card.jsx';
import TemplatePicker from './ui/TemplatePicker.jsx';
import MessageBubble from './ui/MessageBubble.jsx';
import SequencePreview from './SequencePreview.jsx';
import { useToast } from './ui/Toast.jsx';
import { uploadMedia } from '../api/sequencesApi.js';
import { validateWhatsAppMedia, formatBytes, acceptFor, WA_MEDIA } from '../lib/waMedia.js';
import { needsTranscode } from '../lib/videoCompress.js';
import { compressVideo, isCompressionSupported, terminateCompression } from '../lib/videoCompressRunner.js';
import { makeEmptyStep } from '../data/mockSequences.js';
import {
  computeSchedule,
  sequenceDuration,
  formatOffset,
  formatDuration,
  estimateFinishDate,
} from '../lib/timeline.js';
import useT, { useLocale } from '../useT.js';
import { translate } from '../i18n.js';

/*
 * SequenceEditor — עורך רצף כמודאל ממורכז בסגנון Chatwoot v4 (Dialog).
 * עורך עותק מקומי של הרצף ושומר רק בלחיצה על "שמירה".
 *
 * props:
 *   templates — תבניות WhatsApp אמיתיות מ-Chatwoot:
 *     [{ name, language, category, params_count, body, header_text,
 *        footer_text, buttons:[...], examples:[...] }]
 *   onSave — async; נזרק בכישלון → מוצגת שגיאה והעורך נשאר פתוח.
 *
 * שיפורי נוחות: שכפול שלב, גרירה עם קו-יעד, ציר זמן מצטבר ("כעבור X"),
 * סיכום משך הרצף, קיפול שלבים (accordion), שמירה ב-Cmd/Ctrl+S.
 */

const VAR_RE = /\{\{\s*\d+\s*\}\}/g;

// מילון co-located (he/en) — משותף לכל רכיבי המשנה בקובץ.
const M = {
  he: {
    // בורר שדות מערכת (VariableRow)
    sysFirstName: 'שם פרטי', sysFullName: 'שם מלא', sysPhone: 'טלפון', sysEmail: 'אימייל', sysCustom: 'ערך מותאם אישית',
    // מרווחים מוכנים (StepCard)
    presetNow: 'מיד', presetHour: 'שעה', preset4h: '4 שעות', presetDay: 'יום', preset3d: '3 ימים', presetWeek: 'שבוע',
    // חזרה (TimingExtras)
    repeatDay: 'כל יום', repeatWeek: 'כל שבוע', repeatMonth: 'כל חודש',
    // מדיה
    mediaImage: 'תמונה', mediaVideo: 'וידאו', mediaDocument: 'מסמך', mediaGeneric: 'מדיה',
    // footer + modal
    tipSave: 'טיפ: ⌘S לשמירה מהירה', cancel: 'ביטול', save: 'שמירה',
    editTitle: 'עריכת רצף — {name}', newTitle: 'רצף חדש',
    // פרטי הרצף
    nameLabel: 'שם הרצף', namePlaceholder: 'למשל: רצף קבלת פנים',
    stopTitle: 'עצירה כשהנמען מגיב', stopDesc: 'הרצף ייעצר אוטומטית אם הנמען שולח הודעה',
    shabbatTitle: 'אל תשלח בשבת ובחגים', shabbatDesc: 'ההודעות יושהו אוטומטית בשבתות ובימי חג (שעון ישראל)',
    quietHours: 'שעות שקט (לא נשלחות הודעות)', quietStart: 'מתחילות', quietEnd: 'מסתיימות',
    // שלבים
    stepsHeading: 'שלבי הרצף ({count})', expandAll: 'הרחב הכול', collapseAll: 'כווץ הכול',
    fullPreview: 'תצוגה מלאה', addStep: 'הוסף שלב',
    durationPrefix: 'משך הרצף:', durationSuffix: 'מההרשמה ועד ההודעה האחרונה',
    finishHint: '· אם יתחיל היום, יסתיים בערך ב-{date}',
    noSteps: 'אין שלבים עדיין. הוסיפו שלב ראשון כדי להתחיל.',
    saveFailed: 'השמירה נכשלה', stepDeleted: 'השלב נמחק',
    // StepCard
    immediate: 'מיד',
    dragReorder: 'גרור לשינוי סדר', stepN: 'שלב {n}', noTemplate: 'ללא תבנית',
    dupStep: 'שכפול שלב', moveUp: 'הזז למעלה', moveDown: 'הזז למטה', delStep: 'מחיקת שלב',
    expandStep: 'הרחבת השלב', collapseStep: 'כיווץ השלב',
    templateLabel: 'תבנית הודעה', gapLabel: 'מרווח מהשלב הקודם:',
    waitDays: 'המתנה (ימים)', waitHours: 'המתנה (שעות)',
    whenToSend: 'מתי לשלוח את ההודעה',
    condAlways: 'תמיד', condNoReply: 'רק אם הנמען לא הגיב', condReplied: 'רק אם הנמען הגיב',
    ifNotMet: 'אם התנאי לא מתקיים', failSkip: 'דלג על ההודעה והמשך לבאה', failStop: 'עצור את הרצף',
    varValues: 'ערכי המשתנים', noVars: 'התבנית לא דורשת משתנים',
    // ולידציה
    errName: 'יש להזין שם לרצף', errNoStep: 'יש להוסיף לפחות שלב אחד', errStepTemplate: 'יש לבחור תבנית לכל שלב',
    errStepMedia: 'תבנית עם מדיה בכותרת — יש להזין קישור למדיה בכל שלב כזה',
    // TimingExtras
    unitDays: 'ימים', unitWeeks: 'שבועות', unitMonths: 'חודשים',
    timeOfDay: 'שעה ביום', fixedDateOverrides: '· תאריך קבוע גובר על המרווח', anyHour: 'כל שעה',
    advanced: 'אפשרויות מתקדמות', repeat: 'חזרה', none: 'ללא', every: 'כל',
    repeatNote: 'הודעה חוזרת נשלחת שוב במחזור קבוע — עד שמסירים את הליד מהרצף.',
    allowedDays: 'ימים מותרים לשליחה', dowAria: 'יום {day}',
    allowedDaysNote: 'אם נבחרו ימים — השליחה נדחית ליום המותר הקרוב. ריק = כל הימים.',
    fixedDate: 'תאריך קבוע (במקום מרווח יחסי)', clear: 'נקה',
    fixedDateNote: 'כל הלידים יקבלו הודעה זו בתאריך הזה (שידור), במקום מרווח אישי מההרשמה.',
    // MediaUrlField
    noAccountUpload: 'חסר חשבון — לא ניתן להעלות',
    compressedIn: 'כווץ בדפדפן: {before} ← {after}',
    compressFailed: 'דחיסת הסרטון נכשלה', uploadFailed: 'העלאה נכשלה', compressCancelled: 'הדחיסה בוטלה',
    stageProbe: 'בודק את הסרטון…', stageLoad: 'טוען מנוע דחיסה (פעם ראשונה)…', stageEncode: 'מכווץ סרטון…', stageRetry: 'משפר עוד קצת…', stageDefault: 'מעבד…',
    mediaHeader: '{label} בכותרת (header)',
    mediaUploaded: 'המדיה הועלתה — הקישור נוצר ונזכר אוטומטית ✓',
    replace: 'החלפה', remove: 'הסרה',
    localProcessing: 'הכל רץ במחשב שלך — אפס עומס על השרת. אפשר להמתין כמה שניות.',
    uploadAria: 'העלאת {label}', uploading: 'מעלה…',
    dropHere: 'גררו {label} לכאן או לחצו לבחירה',
    linkAuto: 'הקישור ייווצר אוטומטית · מקסימום {max}', videoAutoCompress: ' · סרטון גדול יכווץ אוטומטית בדפדפן',
    hideManualLink: 'הסתר קישור ידני', showManualLink: 'או הדבקת קישור ידני',
    invalidHttps: 'נדרש קישור https תקין',
    // VariableRow
    varRowLabel: 'משתנה {n} — ערך:', varSelectAria: 'ערך למשתנה {n}', varCustomAria: 'ערך מותאם למשתנה {n}', freeText: 'טקסט חופשי',
    // MessagePreview
    preview: 'תצוגה מקדימה',
  },
  en: {
    sysFirstName: 'First name', sysFullName: 'Full name', sysPhone: 'Phone', sysEmail: 'Email', sysCustom: 'Custom value',
    presetNow: 'Immediately', presetHour: '1 hour', preset4h: '4 hours', presetDay: '1 day', preset3d: '3 days', presetWeek: '1 week',
    repeatDay: 'Every day', repeatWeek: 'Every week', repeatMonth: 'Every month',
    mediaImage: 'Image', mediaVideo: 'Video', mediaDocument: 'Document', mediaGeneric: 'Media',
    tipSave: 'Tip: ⌘S to save quickly', cancel: 'Cancel', save: 'Save',
    editTitle: 'Edit sequence — {name}', newTitle: 'New sequence',
    nameLabel: 'Sequence name', namePlaceholder: 'e.g. Welcome sequence',
    stopTitle: 'Stop when the recipient replies', stopDesc: 'The sequence stops automatically if the recipient sends a message',
    shabbatTitle: "Don't send on Shabbat and holidays", shabbatDesc: 'Messages are paused automatically on Shabbat and holidays (Israel time)',
    quietHours: 'Quiet hours (no messages sent)', quietStart: 'Start', quietEnd: 'End',
    stepsHeading: 'Sequence steps ({count})', expandAll: 'Expand all', collapseAll: 'Collapse all',
    fullPreview: 'Full preview', addStep: 'Add step',
    durationPrefix: 'Sequence duration:', durationSuffix: 'from enrollment to the last message',
    finishHint: '· if it starts today, it will end around {date}',
    noSteps: 'No steps yet. Add a first step to get started.',
    saveFailed: 'Failed to save', stepDeleted: 'Step deleted',
    immediate: 'immediately',
    dragReorder: 'Drag to reorder', stepN: 'Step {n}', noTemplate: 'No template',
    dupStep: 'Duplicate step', moveUp: 'Move up', moveDown: 'Move down', delStep: 'Delete step',
    expandStep: 'Expand step', collapseStep: 'Collapse step',
    templateLabel: 'Message template', gapLabel: 'Gap from the previous step:',
    waitDays: 'Wait (days)', waitHours: 'Wait (hours)',
    whenToSend: 'When to send the message',
    condAlways: 'Always', condNoReply: "Only if the recipient hasn't replied", condReplied: 'Only if the recipient replied',
    ifNotMet: "If the condition isn't met", failSkip: 'Skip this message and continue to the next', failStop: 'Stop the sequence',
    varValues: 'Variable values', noVars: 'This template requires no variables',
    errName: 'Enter a name for the sequence', errNoStep: 'Add at least one step', errStepTemplate: 'Choose a template for every step',
    errStepMedia: 'Template with header media — enter a media link for each such step',
    unitDays: 'days', unitWeeks: 'weeks', unitMonths: 'months',
    timeOfDay: 'Time of day', fixedDateOverrides: '· a fixed date overrides the gap', anyHour: 'Any hour',
    advanced: 'Advanced options', repeat: 'Repeat', none: 'None', every: 'every',
    repeatNote: 'A recurring message is sent again on a fixed cycle — until the lead is removed from the sequence.',
    allowedDays: 'Allowed sending days', dowAria: '{day}',
    allowedDaysNote: 'If days are selected — sending is deferred to the nearest allowed day. Empty = all days.',
    fixedDate: 'Fixed date (instead of a relative gap)', clear: 'Clear',
    fixedDateNote: 'All leads receive this message on this date (broadcast), instead of a personal gap from enrollment.',
    noAccountUpload: 'No account — cannot upload',
    compressedIn: 'Compressed in the browser: {before} ← {after}',
    compressFailed: 'Video compression failed', uploadFailed: 'Upload failed', compressCancelled: 'Compression cancelled',
    stageProbe: 'Checking the video…', stageLoad: 'Loading the compression engine (first time)…', stageEncode: 'Compressing video…', stageRetry: 'Improving a bit more…', stageDefault: 'Processing…',
    mediaHeader: '{label} in the header',
    mediaUploaded: 'Media uploaded — the link was created and remembered automatically ✓',
    replace: 'Replace', remove: 'Remove',
    localProcessing: 'Everything runs on your computer — zero server load. It may take a few seconds.',
    uploadAria: 'Upload {label}', uploading: 'Uploading…',
    dropHere: 'Drag {label} here or click to choose',
    linkAuto: 'The link is created automatically · max {max}', videoAutoCompress: ' · a large video is compressed automatically in the browser',
    hideManualLink: 'Hide manual link', showManualLink: 'Or paste a manual link',
    invalidHttps: 'A valid https link is required',
    varRowLabel: 'Variable {n} — value:', varSelectAria: 'Value for variable {n}', varCustomAria: 'Custom value for variable {n}', freeText: 'Free text',
    preview: 'Preview',
  },
};

/*
 * משתני התבנית יכולים למפות לשדה מערכת (מוחלף בערך האמיתי של הליד בזמן שליחה)
 * או לערך מותאם אישית (טקסט חופשי). אחסון ב-step.params[i]:
 *   שדה מערכת → המחרוזת '@first_name' / '@name' / '@phone' / '@email'
 *   מותאם     → הטקסט המילולי (כולל ריק)
 * (התוויות מתורגמות ב-VariableRow דרך t; כאן נשמר רק מזהה השדה + מפתח התווית.)
 */
const SYSTEM_FIELDS = [
  { value: '@first_name', labelKey: 'sysFirstName' },
  { value: '@name', labelKey: 'sysFullName' },
  { value: '@phone', labelKey: 'sysPhone' },
  { value: '@email', labelKey: 'sysEmail' },
  { value: '@custom', labelKey: 'sysCustom' },
];

// ערך מאוחסן הוא שדה מערכת אם ורק אם הוא בדיוק אחד מהטוקנים (משמש את VariableRow)
function isSystemField(v) {
  return v === '@first_name' || v === '@name' || v === '@phone' || v === '@email';
}

// מרווחים נוחים מהשלב הקודם (צ'יפים) — גמיש, לצד הקלט המספרי המדויק. התווית מתורגמת ב-render.
const DELAY_PRESETS = [
  { labelKey: 'presetNow', days: 0, hours: 0 },
  { labelKey: 'presetHour', days: 0, hours: 1 },
  { labelKey: 'preset4h', days: 0, hours: 4 },
  { labelKey: 'presetDay', days: 1, hours: 0 },
  { labelKey: 'preset3d', days: 3, hours: 0 },
  { labelKey: 'presetWeek', days: 7, hours: 0 },
];

// בורר תזמון "שורה חכמה + מתקדם": שעה-ביום (גלוי תמיד) + חזרה / ימי-שבוע / תאריך מוחלט (מתקפל).
// תוויות ימי השבוע לפי שפה. JS getDay: 0=ראשון .. 6=שבת
const DOW_LABELS = {
  he: ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'],
  en: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
};
const REPEAT_UNITS = [
  { value: 'day', labelKey: 'repeatDay' },
  { value: 'week', labelKey: 'repeatWeek' },
  { value: 'month', labelKey: 'repeatMonth' },
];

// מספר המשתנים בתבנית — לפי params_count אם קיים, אחרת ספירת {{N}} בגוף
function countVars(t) {
  if (!t) return 0;
  if (typeof t.params_count === 'number') return t.params_count;
  return (String(t.body || '').match(VAR_RE) || []).length;
}

// תבנית עם header מדיה (IMAGE/VIDEO/DOCUMENT) דורשת קישור (media_url) בשליחה —
// ה-engine מצרף אותו כ-processed_params.header. מחזיר את הפורמט או null.
const MEDIA_FORMATS = new Set(['IMAGE', 'VIDEO', 'DOCUMENT']);
const MEDIA_LABEL_KEY = { IMAGE: 'mediaImage', VIDEO: 'mediaVideo', DOCUMENT: 'mediaDocument' };
function mediaHeaderFormat(t) {
  const f = String(t?.header_format || '').toUpperCase();
  return MEDIA_FORMATS.has(f) ? f : null;
}

export default function SequenceEditor({ open, sequence, templates = [], onSave, onClose, accountId }) {
  const { toast } = useToast();
  const t = useT(M);
  const locale = useLocale();
  // תאריך עברי/אנגלי קצר לתצוגת "אם יתחיל היום" (ללא שעה — אומדן)
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'he-IL', { day: 'numeric', month: 'long' }),
    [locale]
  );
  // עותק עבודה מקומי — לא נוגעים ב-state האב עד שמירה
  const [draft, setDraft] = useState(sequence);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [dragIndex, setDragIndex] = useState(null); // אינדקס השלב הנגרר
  const [dragOverIndex, setDragOverIndex] = useState(null); // אינדקס יעד הגרירה (לקו)
  const [collapsed, setCollapsed] = useState(() => new Set()); // stepIds מקופלים
  const [showPreview, setShowPreview] = useState(false); // תצוגת רצף מלא

  // סנכרון העותק כשנפתח רצף אחר
  useEffect(() => {
    setDraft(sequence);
    setSaveError('');
    setCollapsed(new Set());
    setShowPreview(false);
  }, [sequence]);

  // מפת תבניות לפי שם (לקטגוריה / שפה / גוף / משתנים)
  const templateByName = useMemo(() => {
    const m = {};
    for (const t of templates) m[t.name] = t;
    return m;
  }, [templates]);

  // ציר הזמן המצטבר + משך כולל — מחושב מהשלבים (טהור, lib/timeline)
  const schedule = useMemo(() => computeSchedule(draft?.steps || []), [draft]);
  const duration = useMemo(() => sequenceDuration(draft?.steps || []), [draft]);

  // שמירה ב-Cmd/Ctrl+S (Esc לסגירה מטופל ב-Modal). תלוי במצב העדכני דרך closure.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft, saving]);

  if (!draft) return null;

  const update = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const updateStep = (stepId, patch) =>
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
    }));

  const addStep = () =>
    setDraft((d) => ({ ...d, steps: [...d.steps, makeEmptyStep()] }));

  // שכפול שלב בודד — עותק מיד אחרי המקור (כולל תבנית, מרווח, ערכי משתנים)
  const duplicateStep = (stepId) =>
    setDraft((d) => {
      const i = d.steps.findIndex((s) => s.id === stepId);
      if (i < 0) return d;
      const copy = {
        ...structuredClone(d.steps[i]),
        id: makeEmptyStep().id, // מזהה חדש כדי שלא יתנגש
      };
      const steps = [...d.steps];
      steps.splice(i + 1, 0, copy);
      return { ...d, steps };
    });

  // מחיקת שלב עם אפשרות ביטול (Undo) — שומר את השלב ואת מיקומו, מחזיר ב-toast
  const removeStep = (stepId) => {
    setDraft((d) => {
      const i = d.steps.findIndex((s) => s.id === stepId);
      if (i < 0) return d;
      const removed = d.steps[i];
      const steps = d.steps.filter((s) => s.id !== stepId);
      toast({
        message: translate(M, 'stepDeleted'),
        action: {
          label: translate(M, 'cancel'),
          onClick: () =>
            setDraft((cur) => {
              if (cur.steps.some((s) => s.id === removed.id)) return cur; // כבר הוחזר
              const next = [...cur.steps];
              next.splice(Math.min(i, next.length), 0, removed);
              return { ...cur, steps: next };
            }),
        },
      });
      return { ...d, steps };
    });
  };

  const moveStep = (index, dir) => {
    const target = index + dir;
    setDraft((d) => {
      if (target < 0 || target >= d.steps.length) return d;
      const steps = [...d.steps];
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...d, steps };
    });
  };

  // גרירה לסידור מחדש — מעביר שלב מאינדקס מקור ליעד (drag & drop)
  const reorderStep = (from, to) => {
    setDraft((d) => {
      if (from == null || from === to || to < 0 || to >= d.steps.length) return d;
      const steps = [...d.steps];
      const [moved] = steps.splice(from, 1);
      steps.splice(to, 0, moved);
      return { ...d, steps };
    });
  };

  const onStepDrop = (toIndex) => {
    reorderStep(dragIndex, toIndex);
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const toggleCollapse = (stepId) =>
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });

  const allCollapsed = draft.steps.length > 0 && draft.steps.every((s) => collapsed.has(s.id));
  const toggleAll = () =>
    setCollapsed(allCollapsed ? new Set() : new Set(draft.steps.map((s) => s.id)));

  // בחירת תבנית — מסנכרן קטגוריה ושפה מהתבנית האמיתית (השפה נלקחת בשקט),
  // ומכווץ/מאפס את מערך הפרמטרים למספר המשתנים של התבנית.
  const onStepTemplate = (stepId, name) => {
    const t = templateByName[name];
    const n = countVars(t);
    const examples = Array.isArray(t?.examples) ? t.examples : [];
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s) => {
        if (s.id !== stepId) return s;
        const prev = Array.isArray(s.params) ? s.params : [];
        // ברירת מחדל לכל משתנה חדש: אם יש דוגמה (examples[i]) — ערך מותאם אישית
        // עם הדוגמה כטקסט; אחרת מחרוזת ריקה. ערכים קיימים נשמרים.
        const params = Array.from({ length: n }, (_, i) =>
          prev[i] !== undefined
            ? prev[i]
            : examples[i] != null
            ? String(examples[i])
            : ''
        );
        // מילוי אוטומטי של מדיה: לתבנית עם header מדיה, אם אין עדיין קישור בשלב,
        // נשתמש בקישור ש"נזכר" לתבנית הזו (t.media_url מהמנוע) — בלי צורך להזין שוב.
        const isMedia = mediaHeaderFormat(t);
        const mediaUrl =
          isMedia && !String(s.mediaUrl || '').trim() && t?.media_url
            ? t.media_url
            : s.mediaUrl;
        return {
          ...s,
          template: name,
          params,
          mediaUrl,
          ...(t ? { category: t.category, language: t.language } : {}),
        };
      }),
    }));
  };

  // עדכון ערך משתנה בודד לפי אינדקס
  const onStepParam = (stepId, index, value) =>
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s) => {
        if (s.id !== stepId) return s;
        const params = Array.isArray(s.params) ? [...s.params] : [];
        params[index] = value;
        return { ...s, params };
      }),
    }));

  const nameError = draft.name.trim() === '' ? t('errName') : '';
  const stepsError =
    draft.steps.length === 0
      ? t('errNoStep')
      : draft.steps.some((s) => !s.template)
      ? t('errStepTemplate')
      : draft.steps.some(
          (s) =>
            mediaHeaderFormat(templateByName[s.template]) &&
            !String(s.mediaUrl || '').trim()
        )
      ? t('errStepMedia')
      : '';
  const hasError = !!(nameError || stepsError);

  async function handleSave() {
    if (hasError || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      // מזהה השיוך (key) נוצר אוטומטית ומוסתר מהמשתמש; בעריכה שומרים את הקיים.
      const key =
        String(draft.key || '').trim() ||
        `seq_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      await onSave({ ...draft, name: draft.name.trim(), key });
    } catch (e) {
      setSaveError(e.message || translate(M, 'saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  // אומדן תאריך סיום אם הרצף יתחיל עכשיו (תצוגה בלבד)
  const finishHint =
    duration.totalHours > 0
      ? dateFmt.format(estimateFinishDate(draft.steps, new Date()))
      : null;

  const footer = (
    <>
      <span className="me-auto hidden text-xs text-n-slate-10 sm:inline">
        {t('tipSave')}
      </span>
      <Button variant="ghost" color="slate" onClick={onClose} disabled={saving}>
        {t('cancel')}
      </Button>
      <Button variant="solid" color="blue" onClick={handleSave} loading={saving} disabled={hasError}>
        {t('save')}
      </Button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={sequence?.name ? t('editTitle', { name: sequence.name }) : t('newTitle')}
      variant="center"
      size="2xl"
      footer={footer}
      closeOnOverlay={false}
    >
      <div className="flex flex-col gap-6">
        {/* פרטי הרצף */}
        <section className="flex flex-col gap-4">
          <Input
            label={t('nameLabel')}
            value={draft.name}
            placeholder={t('namePlaceholder')}
            onChange={(e) => update({ name: e.target.value })}
            error={nameError}
          />

          <div className="flex items-center justify-between rounded-lg bg-n-alpha-1 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-n-slate-12">
                {t('stopTitle')}
              </p>
              <p className="text-xs text-n-slate-11 mt-0.5">
                {t('stopDesc')}
              </p>
            </div>
            <Switch
              checked={draft.stopOnReply}
              onChange={(v) => update({ stopOnReply: v })}
              aria-label={t('stopTitle')}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg bg-n-alpha-1 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-n-slate-12">
                {t('shabbatTitle')}
              </p>
              <p className="text-xs text-n-slate-11 mt-0.5">
                {t('shabbatDesc')}
              </p>
            </div>
            <Switch
              checked={draft.skipShabbat}
              onChange={(v) => update({ skipShabbat: v })}
              aria-label={t('shabbatTitle')}
            />
          </div>

          {/* שעות שקט */}
          <div>
            <p className="text-sm font-medium text-n-slate-12 mb-1.5 flex items-center gap-1.5">
              <Clock size={14} className="text-n-slate-10" aria-hidden="true" />
              {t('quietHours')}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label={t('quietStart')}
                type="time"
                value={draft.quietHoursStart}
                onChange={(e) => update({ quietHoursStart: e.target.value })}
              />
              <Input
                label={t('quietEnd')}
                type="time"
                value={draft.quietHoursEnd}
                onChange={(e) => update({ quietHoursEnd: e.target.value })}
              />
            </div>
          </div>
        </section>

        {/* עורך השלבים */}
        <section>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-n-slate-12">
                {t('stepsHeading', { count: draft.steps.length })}
              </h3>
              {draft.steps.length > 1 ? (
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-xs font-medium text-n-blue-11 hover:underline"
                >
                  {allCollapsed ? t('expandAll') : t('collapseAll')}
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              {draft.steps.some((s) => s.template) ? (
                <Button
                  variant="ghost"
                  color="slate"
                  size="sm"
                  icon={Eye}
                  onClick={() => setShowPreview(true)}
                >
                  {t('fullPreview')}
                </Button>
              ) : null}
              <Button variant="faded" color="blue" size="sm" icon={Plus} onClick={addStep}>
                {t('addStep')}
              </Button>
            </div>
          </div>

          {/* סיכום משך הרצף — "מה ייקרה" במבט אחד */}
          {draft.steps.length > 0 && duration.totalHours > 0 ? (
            <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-n-alpha-1 px-3 py-2 text-xs text-n-slate-11">
              <CalendarClock size={14} className="text-n-blue-11" aria-hidden="true" />
              <span>
                {t('durationPrefix')}{' '}
                <span className="font-semibold text-n-slate-12">
                  {formatDuration(duration)}
                </span>{' '}
                {t('durationSuffix')}
              </span>
              {finishHint ? (
                <span className="text-n-slate-10">{t('finishHint', { date: finishHint })}</span>
              ) : null}
            </div>
          ) : null}

          {stepsError ? (
            <p className="mb-2 text-xs text-n-ruby-11">{stepsError}</p>
          ) : null}

          <div className="flex flex-col gap-3">
            {draft.steps.length === 0 ? (
              <Card className="border-dashed">
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <MessageSquare size={24} className="text-n-slate-9" aria-hidden="true" />
                  <p className="text-sm text-n-slate-11">
                    {t('noSteps')}
                  </p>
                </div>
              </Card>
            ) : (
              draft.steps.map((step, index) => (
                <StepCard
                  key={step.id}
                  step={step}
                  index={index}
                  total={draft.steps.length}
                  offset={schedule[index]}
                  templates={templates}
                  accountId={accountId}
                  templateInfo={templateByName[step.template]}
                  collapsed={collapsed.has(step.id)}
                  onToggleCollapse={() => toggleCollapse(step.id)}
                  onTemplate={(name) => onStepTemplate(step.id, name)}
                  onChange={(patch) => updateStep(step.id, patch)}
                  onParam={(i, v) => onStepParam(step.id, i, v)}
                  onRemove={() => removeStep(step.id)}
                  onDuplicate={() => duplicateStep(step.id)}
                  onMoveUp={() => moveStep(index, -1)}
                  onMoveDown={() => moveStep(index, 1)}
                  onDragStart={() => setDragIndex(index)}
                  onDragEnterCard={() => setDragOverIndex(index)}
                  onDrop={() => onStepDrop(index)}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setDragOverIndex(null);
                  }}
                  dragging={dragIndex === index}
                  dropTarget={
                    dragIndex != null && dragIndex !== index && dragOverIndex === index
                  }
                />
              ))
            )}
          </div>
        </section>

        {/* שגיאת שמירה */}
        {saveError ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-n-ruby-7 bg-n-ruby-3 px-3.5 py-2.5 text-sm text-n-ruby-11">
            <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{saveError}</span>
          </div>
        ) : null}
      </div>

      {/* תצוגת רצף מלא — כל ההודעות כשיחת WhatsApp רציפה */}
      <SequencePreview
        open={showPreview}
        onClose={() => setShowPreview(false)}
        sequence={draft}
        templateByName={templateByName}
        schedule={schedule}
        duration={duration}
      />
    </Modal>
  );
}

function StepCard({
  step,
  index,
  total,
  offset,
  templates,
  accountId,
  templateInfo,
  collapsed,
  onToggleCollapse,
  onTemplate,
  onChange,
  onParam,
  onRemove,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragEnterCard,
  onDrop,
  onDragEnd,
  dragging,
  dropTarget,
}) {
  const t = useT(M);
  const varCount = countVars(templateInfo);
  const examples = Array.isArray(templateInfo?.examples) ? templateInfo.examples : [];
  const params = Array.isArray(step.params) ? step.params : [];
  const offsetLabel = offset ? formatOffset(offset) : t('immediate');

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={onDragEnterCard}
      onDrop={onDrop}
      className={`relative transition-opacity ${dragging ? 'opacity-40' : ''}`}
    >
      {/* קו-יעד הגרירה — מסמן בדיוק לאן השלב ייפול */}
      {dropTarget ? (
        <div
          className="absolute -top-2 inset-x-2 z-10 h-0.5 rounded-full bg-n-brand animate-[dropPulse_1s_ease-in-out_infinite]"
          aria-hidden="true"
        />
      ) : null}

      <Card className={`overflow-visible ${dropTarget ? 'ring-2 ring-n-brand/40' : ''}`}>
        <div className="p-4">
          {/* כותרת השלב + ידית גרירה + תזמון + פעולות */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                draggable
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                className="cursor-grab text-n-slate-9 hover:text-n-slate-11 active:cursor-grabbing"
                aria-label={t('dragReorder')}
                title={t('dragReorder')}
              >
                <GripVertical size={16} aria-hidden="true" />
              </span>
              <span className="inline-flex items-center justify-center h-6 min-w-6 px-2 rounded-md bg-n-brand/10 text-n-blue-11 text-xs font-semibold">
                {t('stepN', { n: index + 1 })}
              </span>
              {/* חיווי תזמון מצטבר — "מתי יישלח מההרשמה" */}
              <span className="inline-flex items-center gap-1 rounded-md bg-n-alpha-2 px-2 py-0.5 text-xs text-n-slate-11">
                <Clock size={11} aria-hidden="true" />
                {offsetLabel}
              </span>
              {/* כשמקופל — מציגים תקציר התבנית כדי שעדיין רואים מה יש */}
              {collapsed ? (
                <span className="truncate text-xs text-n-slate-10">
                  · {step.template || t('noTemplate')}
                </span>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                color="slate"
                size="sm"
                iconOnly
                icon={Copy}
                aria-label={t('dupStep')}
                title={t('dupStep')}
                onClick={onDuplicate}
              />
              <Button
                variant="ghost"
                color="slate"
                size="sm"
                iconOnly
                icon={ArrowUp}
                aria-label={t('moveUp')}
                disabled={index === 0}
                onClick={onMoveUp}
              />
              <Button
                variant="ghost"
                color="slate"
                size="sm"
                iconOnly
                icon={ArrowDown}
                aria-label={t('moveDown')}
                disabled={index === total - 1}
                onClick={onMoveDown}
              />
              <Button
                variant="ghost"
                color="ruby"
                size="sm"
                iconOnly
                icon={Trash2}
                aria-label={t('delStep')}
                onClick={onRemove}
              />
              {/* קיפול/הרחבה */}
              <button
                type="button"
                onClick={onToggleCollapse}
                aria-label={collapsed ? t('expandStep') : t('collapseStep')}
                aria-expanded={!collapsed}
                className="ms-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg text-n-slate-10 transition-colors hover:bg-n-alpha-2 hover:text-n-slate-12"
              >
                <ChevronDown
                  size={16}
                  className={`transition-transform ${collapsed ? '-rotate-90' : ''}`}
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>

          {collapsed ? null : (
            <>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* בורר תבנית מותאם — מציג תוכן (לא רק שם), נפתח אינליין כאקורדיון */}
                <div className="sm:col-span-2">
                  <p className="block text-sm font-medium text-n-slate-12 mb-1.5">
                    {t('templateLabel')}
                  </p>
                  <TemplatePicker
                    templates={templates}
                    value={step.template}
                    onChange={onTemplate}
                  />
                </div>

                {/* מרווח מהשלב הקודם — צ'יפים מהירים מעל הקלט המספרי המדויק */}
                <div className="sm:col-span-2">
                  <p className="text-sm font-medium text-n-slate-12 mb-1.5">
                    {t('gapLabel')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {DELAY_PRESETS.map((p) => {
                      const active =
                        Number(step.delayDays) === p.days &&
                        Number(step.delayHours) === p.hours;
                      return (
                        <button
                          key={p.labelKey}
                          type="button"
                          aria-pressed={active}
                          onClick={() =>
                            onChange({ delayDays: p.days, delayHours: p.hours })
                          }
                          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                            active
                              ? 'bg-n-brand text-white'
                              : 'bg-n-alpha-2 text-n-slate-12 hover:bg-n-alpha-3'
                          }`}
                        >
                          {t(p.labelKey)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <Input
                  label={t('waitDays')}
                  type="number"
                  min={0}
                  value={step.delayDays}
                  onChange={(e) =>
                    onChange({ delayDays: Math.max(0, Number(e.target.value) || 0) })
                  }
                />
                <Input
                  label={t('waitHours')}
                  type="number"
                  min={0}
                  max={23}
                  value={step.delayHours}
                  onChange={(e) =>
                    onChange({
                      delayHours: Math.min(23, Math.max(0, Number(e.target.value) || 0)),
                    })
                  }
                />
              </div>

              {/* בורר תזמון מתקדם — שעה ביום (גלוי) + חזרה / ימי-שבוע / תאריך מוחלט (מתקפל) */}
              <TimingExtras step={step} onChange={onChange} />

              {/* תנאי שליחה — מתי לשלוח את ההודעה (לפי תגובת הנמען להודעה הקודמת),
                  ומה לעשות אם התנאי לא מתקיים. צ'יפים מוטמעים (כמו מרווח הזמן),
                  לא רשימה נפתחת צפה. לא רלוונטי לשלב הראשון (אין הודעה קודמת). */}
              {index > 0 ? (
                <div className="mt-4 rounded-lg bg-n-alpha-1 px-4 py-3 flex flex-col gap-3">
                  <div>
                    <p className="text-sm font-medium text-n-slate-12 mb-1.5">{t('whenToSend')}</p>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { value: 'always', label: t('condAlways') },
                        { value: 'no_reply', label: t('condNoReply') },
                        { value: 'replied', label: t('condReplied') },
                      ].map((opt) => {
                        const active = (step.sendCondition || 'always') === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            aria-pressed={active}
                            onClick={() => onChange({ sendCondition: opt.value })}
                            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                              active
                                ? 'bg-n-brand text-white'
                                : 'bg-n-alpha-2 text-n-slate-12 hover:bg-n-alpha-3'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {step.sendCondition && step.sendCondition !== 'always' ? (
                    <div>
                      <p className="text-sm font-medium text-n-slate-12 mb-1.5">{t('ifNotMet')}</p>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { value: 'skip', label: t('failSkip') },
                          { value: 'stop', label: t('failStop') },
                        ].map((opt) => {
                          const active = (step.onConditionFail || 'skip') === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              aria-pressed={active}
                              onClick={() => onChange({ onConditionFail: opt.value })}
                              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                                active
                                  ? 'bg-n-brand text-white'
                                  : 'bg-n-alpha-2 text-n-slate-12 hover:bg-n-alpha-3'
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* משתני התבנית — שדה אחד לכל {{N}} */}
              {step.template ? (
                <div className="mt-4">
                  <p className="text-xs font-semibold text-n-slate-12 mb-2">
                    {t('varValues')}
                  </p>
                  {varCount === 0 ? (
                    <p className="text-xs text-n-slate-11">{t('noVars')}</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {Array.from({ length: varCount }, (_, i) => (
                        <VariableRow
                          key={i}
                          index={i}
                          value={params[i] ?? ''}
                          example={examples[i] != null ? String(examples[i]) : ''}
                          onChange={(v) => onParam(i, v)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : null}

              {/* מדיה — גרירה/העלאה (יוצר קישור לבד) לתבניות עם header IMAGE/VIDEO/DOCUMENT */}
              {mediaHeaderFormat(templateInfo) ? (
                <MediaUrlField
                  format={mediaHeaderFormat(templateInfo)}
                  value={step.mediaUrl || ''}
                  accountId={accountId}
                  onChange={(v) => onChange({ mediaUrl: v })}
                />
              ) : null}

              {/* תצוגה מקדימה — בועת WhatsApp עם הגוף, ההדר, הפוטר והכפתורים */}
              {templateInfo ? (
                <MessagePreview template={templateInfo} params={params} mediaUrl={step.mediaUrl} />
              ) : null}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

/*
 * MediaUrlField — מדיה ל-header (IMAGE/VIDEO/DOCUMENT). גוררים/בוחרים קובץ → השרת
 * מאמת מול מגבלות WhatsApp, שומר, ומחזיר קישור ציבורי (אין צורך להדביק קישור).
 * fallback: הדבקת קישור ידני. הקישור גם נזכר אוטומטית לתבנית (templates.media_url).
 */
// בורר תזמון "שורה חכמה + מתקדם" — שעה ביום (גלוי תמיד) + אקורדיון "אפשרויות מתקדמות":
// חזרה (יום/שבוע/חודש), ימי-שבוע מותרים, ותאריך מוחלט. כותב sendHour / repeat* / allowedDow / sendDate.
function TimingExtras({ step, onChange }) {
  const t = useT(M);
  const locale = useLocale();
  const dowLabels = DOW_LABELS[locale === 'en' ? 'en' : 'he'];
  const hasAdvanced =
    !!step.sendDate ||
    !!step.repeatInterval ||
    (Array.isArray(step.allowedDow) && step.allowedDow.length > 0);
  const [open, setOpen] = useState(hasAdvanced);

  const dow = Array.isArray(step.allowedDow) ? step.allowedDow : [];
  const toggleDow = (d) =>
    onChange({
      allowedDow: dow.includes(d) ? dow.filter((x) => x !== d) : [...dow, d].sort((a, b) => a - b),
    });
  const unitNoun =
    step.repeatUnit === 'day' ? t('unitDays') : step.repeatUnit === 'week' ? t('unitWeeks') : t('unitMonths');

  return (
    <div className="mt-3">
      {/* שעה ביום — תמיד גלוי, חלק מ"השורה החכמה" */}
      <div>
        <p className="mb-1.5 inline-flex flex-wrap items-center gap-1.5 text-sm font-medium text-n-slate-12">
          <Clock className="h-4 w-4 text-n-slate-11" />
          {t('timeOfDay')}
          {step.sendDate ? (
            <span className="text-xs font-normal text-n-slate-11">{t('fixedDateOverrides')}</span>
          ) : null}
        </p>
        {/* צ'יפים מובנים (לא רשימה נפתחת צפה) — "כל שעה" + 00:00..23:00 */}
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-pressed={step.sendHour == null}
            onClick={() => onChange({ sendHour: null })}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              step.sendHour == null ? 'bg-n-brand text-white' : 'bg-n-alpha-2 text-n-slate-12 hover:bg-n-alpha-3'
            }`}
          >
            {t('anyHour')}
          </button>
          {Array.from({ length: 24 }, (_, h) => {
            const active = step.sendHour === h;
            return (
              <button
                key={h}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ sendHour: h })}
                className={`rounded-full px-2.5 py-1 text-xs font-medium tabular-nums transition-colors ${
                  active ? 'bg-n-brand text-white' : 'bg-n-alpha-2 text-n-slate-12 hover:bg-n-alpha-3'
                }`}
              >
                {String(h).padStart(2, '0')}:00
              </button>
            );
          })}
        </div>
      </div>

      {/* טריגר "אפשרויות מתקדמות" */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-n-brand hover:underline"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        {t('advanced')}
      </button>

      {open ? (
        <div className="mt-2 rounded-lg bg-n-alpha-1 px-4 py-3 flex flex-col gap-4">
          {/* חזרה — הודעה במחזור קבוע (יום/שבוע/חודש) */}
          <div>
            <p className="text-sm font-medium text-n-slate-12 mb-1.5">{t('repeat')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-pressed={!step.repeatInterval}
                onClick={() => onChange({ repeatInterval: null, repeatUnit: '' })}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  !step.repeatInterval ? 'bg-n-brand text-white' : 'bg-n-alpha-2 text-n-slate-12 hover:bg-n-alpha-3'
                }`}
              >
                {t('none')}
              </button>
              {REPEAT_UNITS.map((u) => {
                const active = !!step.repeatInterval && step.repeatUnit === u.value;
                return (
                  <button
                    key={u.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onChange({ repeatInterval: step.repeatInterval || 1, repeatUnit: u.value })}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      active ? 'bg-n-brand text-white' : 'bg-n-alpha-2 text-n-slate-12 hover:bg-n-alpha-3'
                    }`}
                  >
                    {t(u.labelKey)}
                  </button>
                );
              })}
              {step.repeatInterval ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-n-slate-11">
                  {t('every')}
                  <input
                    type="number"
                    min={1}
                    value={step.repeatInterval}
                    onChange={(e) => onChange({ repeatInterval: Math.max(1, Number(e.target.value) || 1) })}
                    className="w-14 rounded-lg border border-n-weak bg-n-alpha-2 px-2 py-1 text-sm text-n-slate-12"
                  />
                  {unitNoun}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-n-slate-11">
              {t('repeatNote')}
            </p>
          </div>

          {/* ימי שבוע מותרים — דוחה ליום המותר הקרוב */}
          <div>
            <p className="text-sm font-medium text-n-slate-12 mb-1.5">{t('allowedDays')}</p>
            <div className="flex flex-wrap gap-1.5">
              {dowLabels.map((lbl, d) => {
                const active = dow.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={active}
                    aria-label={t('dowAria', { day: lbl })}
                    onClick={() => toggleDow(d)}
                    className={`h-8 w-8 rounded-full text-xs font-medium transition-colors ${
                      active ? 'bg-n-brand text-white' : 'bg-n-alpha-2 text-n-slate-12 hover:bg-n-alpha-3'
                    }`}
                  >
                    {lbl}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-n-slate-11">
              {t('allowedDaysNote')}
            </p>
          </div>

          {/* תאריך מוחלט — שידור לכל הלידים בתאריך נתון (במקום מרווח יחסי) */}
          <div>
            <p className="text-sm font-medium text-n-slate-12 mb-1.5">{t('fixedDate')}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="date"
                value={step.sendDate || ''}
                onChange={(e) => onChange({ sendDate: e.target.value })}
                className="rounded-lg border border-n-weak bg-n-alpha-2 px-2 py-1 text-sm text-n-slate-12"
              />
              {step.sendDate ? (
                <button
                  type="button"
                  onClick={() => onChange({ sendDate: '' })}
                  className="text-xs text-n-brand hover:underline"
                >
                  {t('clear')}
                </button>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-n-slate-11">
              {t('fixedDateNote')}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MediaUrlField({ format, value, accountId, onChange }) {
  const t = useT(M);
  const label = t(MEDIA_LABEL_KEY[format] || 'mediaGeneric');
  const trimmed = String(value || '').trim();
  const invalid = trimmed !== '' && !/^https:\/\/\S+/i.test(trimmed);
  const maxBytes = WA_MEDIA[format]?.maxBytes || 0;
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1
  const [stage, setStage] = useState('');
  const [sizeNote, setSizeNote] = useState('');
  const inputRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    setErr('');
    setSizeNote('');
    if (accountId == null) { setErr(translate(M, 'noAccountUpload')); return; }

    let toUpload = file;

    // וידאו גדול מ-16MB (או פורמט לא-נתמך) → דוחסים/ממירים בדפדפן של הנציג לפני העלאה.
    // אפס עומס על השרת. אם הדפדפן לא תומך — נופלים לוולידציה הרגילה שתחסום קובץ לא תקין.
    if (needsTranscode({ format, mime: file.type, byteSize: file.size }) && isCompressionSupported()) {
      setCompressing(true);
      setProgress(0);
      setStage('probe');
      try {
        const r = await compressVideo(file, { onProgress: setProgress, onStage: setStage });
        toUpload = r.file;
        setSizeNote(translate(M, 'compressedIn', { before: formatBytes(r.before), after: formatBytes(r.after) }));
      } catch (e) {
        setCompressing(false);
        setErr(e.message || translate(M, 'compressFailed'));
        return;
      }
      setCompressing(false);
    }

    // ולידציה — גם על התוצאה הדחוסה (שכבת ביטחון; השרת מאמת שוב)
    const v = validateWhatsAppMedia({ format, mime: toUpload.type, byteSize: toUpload.size });
    if (!v.ok) { setErr(v.error); return; } // נחסם — פורמט/גודל לא תקין

    setUploading(true);
    try {
      const res = await uploadMedia(toUpload, format, accountId);
      onChange(res.url);
    } catch (e) {
      setErr(e.message || translate(M, 'uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const cancelCompress = () => {
    terminateCompression();
    setCompressing(false);
    setProgress(0);
    setErr(translate(M, 'compressCancelled'));
  };

  const stageLabel = {
    probe: t('stageProbe'),
    load: t('stageLoad'),
    encode: t('stageEncode'),
    'encode-retry': t('stageRetry'),
  }[stage] || t('stageDefault');
  const busy = uploading || compressing;

  return (
    <div className="mt-4 rounded-lg border border-n-amber-7 bg-n-amber-3 px-3 py-2.5">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-n-amber-12">
        <ImageIcon size={14} className="text-n-amber-11" aria-hidden="true" />
        {t('mediaHeader', { label })}
      </p>

      {trimmed && !invalid ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-n-teal-7 bg-n-teal-3 px-3 py-2">
          <span className="flex min-w-0 items-center gap-2 text-sm text-n-teal-11">
            <CheckCircle2 size={16} className="shrink-0" aria-hidden="true" />
            <span className="truncate">{t('mediaUploaded')}</span>
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => inputRef.current?.click()} className="text-xs font-medium text-n-blue-11 hover:underline">
              {t('replace')}
            </button>
            <button type="button" onClick={() => { onChange(''); setSizeNote(''); }} aria-label={t('remove')} className="text-n-slate-10 hover:text-n-ruby-11">
              <X size={15} />
            </button>
          </div>
        </div>
      ) : compressing ? (
        <div className="rounded-lg border-2 border-dashed border-n-blue-7 bg-n-blue-3 px-3 py-4">
          <div className="flex items-center gap-2">
            <Film size={18} className="shrink-0 text-n-blue-11" aria-hidden="true" />
            <span className="flex-1 text-sm font-medium text-n-blue-12">{stageLabel}</span>
            <span className="font-mono text-xs tabular-nums text-n-blue-11">{Math.round(progress * 100)}%</span>
            <button
              type="button"
              onClick={cancelCompress}
              className="text-xs font-medium text-n-slate-11 hover:text-n-ruby-11"
            >
              {t('cancel')}
            </button>
          </div>
          {/* פס התקדמות; בשלבי probe/load אין אחוזים אמיתיים → אינדיקציה זוחלת */}
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-n-blue-5" aria-hidden="true">
            <div
              className="h-full rounded-full bg-n-blue-9 transition-[width] duration-200"
              style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-n-blue-11">{t('localProcessing')}</p>
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer?.files?.[0]); }}
          onClick={() => !busy && inputRef.current?.click()}
          onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !busy) inputRef.current?.click(); }}
          role="button"
          tabIndex={0}
          aria-label={t('uploadAria', { label })}
          className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-3 py-5 text-center outline-none transition-colors focus-visible:border-n-brand ${
            dragOver ? 'border-n-brand bg-n-brand/5' : 'border-n-amber-7 bg-n-alpha-1 hover:bg-n-alpha-2'
          }`}
        >
          {uploading ? (
            <>
              <Loader2 size={20} className="animate-spin text-n-blue-11" aria-hidden="true" />
              <span className="text-sm text-n-slate-11">{t('uploading')}</span>
            </>
          ) : (
            <>
              <UploadCloud size={22} className="text-n-amber-11" aria-hidden="true" />
              <span className="text-sm font-medium text-n-slate-12">{t('dropHere', { label })}</span>
              <span className="text-xs text-n-slate-10">
                {t('linkAuto', { max: formatBytes(maxBytes) })}
                {format === 'VIDEO' ? t('videoAutoCompress') : ''}
              </span>
            </>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={acceptFor(format)}
        className="hidden"
        onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
      />

      {err ? <p className="mt-1.5 text-xs font-medium text-n-ruby-11">{err}</p> : null}
      {sizeNote ? (
        <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-n-teal-11">
          <CheckCircle2 size={12} aria-hidden="true" />
          {sizeNote}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => setShowUrl((s) => !s)}
        className="mt-2 text-xs text-n-slate-10 hover:underline"
      >
        {showUrl ? t('hideManualLink') : t('showManualLink')}
      </button>
      {showUrl ? (
        <Input
          className="mt-1.5"
          type="url"
          dir="ltr"
          value={value || ''}
          placeholder="https://example.com/media.jpg"
          onChange={(e) => onChange(e.target.value)}
          error={invalid ? t('invalidHttps') : ''}
        />
      ) : null}
    </div>
  );
}

/*
 * VariableRow — שורת משתנה: בורר שדה (שם/טלפון/אימייל/מותאם) + קלט טקסט
 * שמופיע רק כשנבחר "ערך מותאם אישית". אחסון ב-params[i]:
 *   שדה מערכת → '@name' / '@phone' / '@email'
 *   מותאם     → הטקסט המילולי
 */
function VariableRow({ index, value, example, onChange }) {
  const t = useT(M);
  const custom = !isSystemField(value);
  // הערך לבורר: '@name'/'@phone'/'@email' או '@custom' כשזה ערך מותאם
  const selectValue = custom ? '@custom' : value;
  // תוויות שדות המערכת מתורגמות כאן (המזהים קבועים ב-SYSTEM_FIELDS)
  const options = SYSTEM_FIELDS.map((f) => ({ value: f.value, label: t(f.labelKey) }));

  const onSelect = (v) => {
    // מעבר לשדה מערכת → מאחסנים את הטוקן; מעבר ל"מותאם" → מתחילים מטקסט ריק
    onChange(v === '@custom' ? '' : v);
  };

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-n-slate-12">{t('varRowLabel', { n: index + 1 })}</label>
      <Dropdown
        options={options}
        value={selectValue}
        onChange={onSelect}
        ariaLabel={t('varSelectAria', { n: index + 1 })}
      />
      {custom ? (
        <Input
          className="mt-2"
          aria-label={t('varCustomAria', { n: index + 1 })}
          value={value}
          placeholder={example || t('freeText')}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : null}
    </div>
  );
}

/*
 * MessagePreview — תווית "תצוגה מקדימה" + בועת ההודעה (MessageBubble המשותף).
 */
function MessagePreview({ template, params, mediaUrl }) {
  const t = useT(M);
  return (
    <div className="mt-4">
      <p className="text-xs text-n-slate-11 mb-1.5">{t('preview')}</p>
      <MessageBubble template={template} params={params} mediaUrl={mediaUrl} />
    </div>
  );
}
