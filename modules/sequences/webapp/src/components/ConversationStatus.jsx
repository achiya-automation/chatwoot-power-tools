import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, Layers, Loader2, X, RotateCcw, CheckCircle2, XCircle, Circle, ChevronDown } from 'lucide-react';
import Badge from './ui/Badge.jsx';
import Dropdown from './ui/Dropdown.jsx';
import Button from './ui/Button.jsx';
import Skeleton from './ui/Skeleton.jsx';
import ChatBubble from './ui/ChatBubble.jsx';
import ConfirmDialog from './ui/ConfirmDialog.jsx';
import { deliveryErrorLabel, deliveryErrorAction } from '../lib/deliveryError.js';
import { formatOffset, formatWhen } from '../lib/timeline.js';
import {
  getEnrollmentStatus,
  getSentHistory,
  getProjectedSchedule,
  listSequences,
  listTemplates,
  setSequence as apiSetSequence,
} from '../api/sequencesApi.js';

/*
 * ConversationStatus — הפאנל המובנה של איש הקשר (Dashboard App בתוך שיחה).
 *
 * המקום היחיד שבו מחליטים אם הליד נכנס לסדרה ולאיזו, ורואים איפה הוא עומד
 * ומה כבר נשלח לו בפועל. בנוי כמקטעים (sections) בסגנון פאנלי הסיידבר של Chatwoot:
 *   • סדרת הודעות — בורר (כל הסדרות + "ללא") + סטטוס.
 *   • מסע ההודעות — שלב X/Y + ציר עם בועות מלאות (תוכן ההודעה כפי שהלקוח מקבל).
 *   • פעולות — הפעלה מחדש / הסרה.
 *
 * כל פעולה ששולחת/משנה הודעות ללקוח (התחלה, החלפה, הפעלה מחדש, הסרה) עוברת
 * דרך דיאלוג בטיחות (ConfirmDialog) — עם תצוגה מקדימה של ההודעה שתצא — כך שאף
 * הודעה לא נשלחת ללקוח בלי אישור מפורש.
 *
 * הבחירה נכתבת דרך set_sequence (token של ה-engine); ה-reconciler משייך/מעביר/
 * עוצר בטיק הבא (~דקה), ולכן ההתקדמות מתעדכנת מעט אחרי הבחירה.
 *
 * props: conversationId, accountId
 */

const STATUS = {
  active: { label: 'פעיל', color: 'teal' },
  completed: { label: 'הושלם', color: 'blue' },
  stopped: { label: 'נעצר', color: 'slate' },
  failed: { label: 'נתקע', color: 'ruby' },
};

// "2026-06-21 14:30" → "21/06 · 14:30" (תצוגה קומפקטית)
function fmtSent(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2})/);
  if (!m) return s || '';
  return `${m[3]}/${m[2]} · ${m[4]}`;
}

// [{ step_order, send_at }] → { [step_order]: send_at } (מועד השליחה הצפוי לכל שלב)
function scheduleMap(rows) {
  const out = {};
  for (const r of rows || []) out[Number(r.step_order)] = r.send_at;
  return out;
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

// תרגום טוקן-פרמטר לערך תצוגה-מקדימה (משקף את paramsResolve של המנוע)
function previewParam(p, name) {
  const clean = String(name || '').trim();
  if (p === '@first_name') return firstName(clean) || '[שם פרטי]';
  if (p === '@name') return clean || '[שם]';
  if (p === '@phone') return '[טלפון]';
  if (p === '@email') return '[אימייל]';
  return p || '';
}

// רינדור גוף התבנית עם הפרמטרים — "כך ההודעה תיראה" ללקוח הזה (תצוגה מקדימה)
function renderPreview(body, params, name) {
  return String(body || '').replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, k) => {
    const p = (params || [])[Number(k) - 1];
    return p != null && p !== '' ? previewParam(p, name) : `{{${k}}}`;
  });
}

export default function ConversationStatus({ conversationId, accountId }) {
  const [sequences, setSequences] = useState([]);
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [selected, setSelected] = useState(''); // ה-key שנבחר בתפריט ('' = ללא)
  const [templates, setTemplates] = useState([]); // לתצוגה מקדימה של תוכן ההודעות
  const [projected, setProjected] = useState({}); // step_order → מועד שליחה צפוי (שעון ישראל, כולל דחיית שבת/חג)
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null); // { tone, title, description, confirmLabel, preview, onConfirm }

  const loadStatus = useCallback(async () => {
    const [data, hist, proj] = await Promise.all([
      getEnrollmentStatus(conversationId, accountId),
      getSentHistory(conversationId, accountId).catch(() => []),
      getProjectedSchedule(conversationId, accountId).catch(() => []),
    ]);
    setStatus(data || null);
    setHistory(Array.isArray(hist) ? hist : []);
    setProjected(scheduleMap(proj));
    setSelected(data?.sequence_key || '');
    return data;
  }, [conversationId, accountId]);

  // טעינה ראשונית — סדרות (לתפריט) + מצב נוכחי + היסטוריה + תבניות, במקביל
  useEffect(() => {
    let cancelled = false;
    if (conversationId == null || accountId == null) return undefined;
    setLoading(true);
    setError('');
    Promise.all([
      listSequences(accountId), // כל הסדרות (כולל כבויות) — ניתן לשייך גם כבויה (תתחיל כשתופעל)
      getEnrollmentStatus(conversationId, accountId),
      getSentHistory(conversationId, accountId).catch(() => []),
      listTemplates(accountId).catch(() => []), // גוף התבניות — לתצוגה מקדימה
      getProjectedSchedule(conversationId, accountId).catch(() => []), // מועדי שליחה צפויים לשלבים הבאים
    ])
      .then(([seqs, st, hist, tmpls, proj]) => {
        if (cancelled) return;
        setSequences(seqs);
        setStatus(st || null);
        setHistory(Array.isArray(hist) ? hist : []);
        setSelected(st?.sequence_key || '');
        setTemplates(Array.isArray(tmpls) ? tmpls : []);
        setProjected(scheduleMap(proj));
      })
      .catch((e) => !cancelled && setError(e.message || 'שגיאה בטעינת מצב הליד'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [conversationId, accountId]);

  // ── תצוגה מקדימה של ההודעה הראשונה בסדרה (לדיאלוג הבטיחות) ──
  const firstStepPreview = useCallback((seqKey) => {
    const seq = sequences.find((s) => s.key === seqKey);
    const step = seq?.steps?.[0];
    if (!step) return null;
    const tmpl = templates.find((t) => t.name === step.template);
    return {
      text: renderPreview(tmpl?.body || '', step.params, status?.contact_name),
      template: tmpl || null,
      mediaUrl: step.mediaUrl || '',
    };
  }, [sequences, templates, status]);

  // ── ביצוע בפועל (אחרי אישור) — כתיבה דרך set_sequence + רענון ──
  const doSetSequence = useCallback(async (key) => {
    setSaving(true);
    setError('');
    try {
      await apiSetSequence(conversationId, key, accountId);
      setSelected(key);
      await loadStatus().catch(() => {});
      setTimeout(() => { loadStatus().catch(() => {}); }, 4000);
    } catch (e) {
      setError(e.message || 'הפעולה נכשלה');
    } finally {
      setSaving(false);
      setConfirm(null);
    }
  }, [conversationId, accountId, loadStatus]);

  const selectedSeq = sequences.find((s) => s.key === selected);
  // 'pending' = the sequence is assigned (attr written) but the reconciler hasn't enrolled yet.
  // Treat it as "assigned but not yet live" so the panel shows "being processed within a minute"
  // (not the full timeline, and not "no sequence") until the enrollment exists.
  const isPending = status?.status === 'pending' && status.sequence_key === selected;
  const statusMatchesSelection = status && status.sequence_key === selected && status.status !== 'pending';
  const cur = Number(status?.current_step) || 0;
  const tot = Number(status?.total_steps) || 0;
  const name = status?.contact_name;

  // ── בקשת שינוי דרך הבורר → דיאלוג בטיחות לפי סוג המעבר ──
  const requestAssign = (key) => {
    if (key === selected) return;
    const targetSeq = sequences.find((s) => s.key === key);
    const who = name ? firstName(name) : 'הליד';

    // הסרה מהסדרה
    if (!key) {
      setConfirm({
        tone: 'danger',
        title: 'להסיר את הליד מהסדרה?',
        description: `${who} יוסר מהסדרה «${selectedSeq?.name || status?.sequence_name || selected}» ולא יקבל ממנה הודעות נוספות.`,
        confirmLabel: 'הסר מהסדרה',
        onConfirm: () => doSetSequence(''),
      });
      return;
    }

    const isActive = statusMatchesSelection && status?.status === 'active';
    const preview = firstStepPreview(key);

    // החלפה בזמן רצף פעיל
    if (isActive && selected) {
      setConfirm({
        tone: 'warning',
        title: 'להחליף סדרה?',
        description: `הליד נמצא כעת בשלב ${cur} מתוך ${tot} בסדרה «${selectedSeq?.name || selected}». החלפה תעצור אותה ותתחיל את «${targetSeq?.name || key}» מההתחלה.`,
        confirmLabel: 'החלף סדרה',
        preview,
        onConfirm: () => doSetSequence(key),
      });
      return;
    }

    // התחלה (משיוך חדש, או אחרי השלמה/עצירה)
    const disabled = targetSeq && targetSeq.enabled === false;
    setConfirm({
      tone: 'info',
      title: 'להתחיל את הסדרה?',
      description: `${who} יתחיל לקבל את הודעות הסדרה «${targetSeq?.name || key}».${disabled ? ' הסדרה כבויה כרגע — השליחה תתחיל כשתופעל.' : ''}`,
      confirmLabel: 'התחל סדרה',
      preview,
      onConfirm: () => doSetSequence(key),
    });
  };

  // ── הפעלה מחדש (כפתור) — מאפס לשלב הראשון ושולח שוב הכול ──
  const requestRestart = () => {
    const completed = status?.status === 'completed';
    setConfirm({
      tone: 'warning',
      title: 'להתחיל את הסדרה מחדש?',
      description: completed
        ? `הליד כבר השלים את «${selectedSeq?.name || selected}». הפעלה מחדש תשלח לו שוב את כל ההודעות מהשלב הראשון.`
        : `הליד נמצא בשלב ${cur} מתוך ${tot}. התחלה מחדש תאפס אותו לשלב הראשון ותשלח שוב את כל ההודעות — כולל אלה שכבר נשלחו.`,
      confirmLabel: completed ? 'הפעל מחדש' : 'התחל מחדש',
      preview: firstStepPreview(selected),
      onConfirm: () => doSetSequence(selected),
    });
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-n-weak bg-n-surface-1 p-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-2 h-9 w-full rounded-lg" />
        <div className="mt-4 border-t border-n-weak pt-4">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="mt-2 h-1.5 w-full rounded-full" />
        </div>
      </div>
    );
  }

  const options = [
    { value: '', label: '— ללא סדרה —' },
    ...sequences.map((s) => ({
      value: s.key,
      label: s.name || s.key,
      description: s.enabled ? undefined : 'כבוי — יתחיל כשתופעל',
    })),
  ];
  // הסדרה שנבחרה אך עדיין אינה ברשימה — נוסיף כדי שלא "תיעלם"
  if (selected && !sequences.some((s) => s.key === selected)) {
    options.push({ value: selected, label: status?.sequence_name || selected });
  }

  const assigned = !!selected;
  const selectedDisabled = assigned && selectedSeq && !selectedSeq.enabled;
  const st = isPending
    ? { label: 'ממתין', color: 'amber' }
    : statusMatchesSelection
    ? STATUS[status.status] || { label: status.status || '—', color: 'slate' }
    : null;
  const pct = tot > 0 ? Math.min(100, Math.max(0, (cur / tot) * 100)) : 0;

  return (
    <div className="rounded-xl border border-n-weak bg-n-surface-1 p-4">
      {error ? (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-n-ruby-7 bg-n-ruby-3 px-3 py-2 text-xs text-n-ruby-11">
          <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {/* ── מקטע: בחירת סדרה — המקום להחליט ── */}
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-n-slate-12">סדרת הודעות</label>
        {saving ? (
          <span className="inline-flex items-center gap-1 text-xs text-n-slate-10">
            <Loader2 size={12} className="animate-spin" aria-hidden="true" /> שומר…
          </span>
        ) : st ? (
          <Badge color={st.color}>{st.label}</Badge>
        ) : null}
      </div>
      <Dropdown
        className="mt-1.5"
        value={selected}
        onChange={requestAssign}
        disabled={saving}
        options={options}
        placeholder="— ללא סדרה —"
        ariaLabel="בחירת סדרת הודעות לליד"
      />

      {!assigned ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-n-slate-11">
          <Layers size={13} className="text-n-blue-11" aria-hidden="true" />
          הליד לא משויך — בחרו סדרה כדי להתחיל.
        </p>
      ) : statusMatchesSelection ? (
        <>
          {/* ── התראת כשל מסירה — "נתקע", עם הסיבה ──*/}
          {status.status === 'failed' ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-n-ruby-7 bg-n-ruby-3 px-3 py-2 text-xs text-n-ruby-11">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-medium">
                  הרצף נתקע — ההודעה לא נמסרה{status.failed_step ? ` (שלב ${status.failed_step})` : ''}.
                </p>
                <p className="mt-0.5">{deliveryErrorLabel(status.last_error_code, status.last_error)}</p>
                <p className="mt-1 font-medium opacity-90">{deliveryErrorAction(status.last_error_code)}</p>
              </div>
            </div>
          ) : null}

          {/* ── מקטע: מסע ההודעות — מה נשלח, איפה הוא עומד, ומה צפוי, עם תוכן מלא ── */}
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-n-slate-12">מסע ההודעות</span>
              <span className="text-xs text-n-slate-11">שלב {cur} מתוך {tot}</span>
            </div>
            <StepTimeline
              steps={selectedSeq?.steps}
              history={history}
              templates={templates}
              contactName={status.contact_name}
              currentStep={status.current_step}
              status={status.status}
              nextSendAt={status.next_send_at}
              projected={projected}
              enrollmentId={status.enrollment_id}
              pct={pct}
            />
          </div>

          {status.phone ? (
            <div className="mt-3 flex items-center justify-between border-t border-n-weak pt-3">
              <span className="text-xs text-n-slate-11">טלפון</span>
              <span dir="ltr" className="font-mono text-xs text-n-slate-12">{status.phone}</span>
            </div>
          ) : null}
        </>
      ) : selectedDisabled ? (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-n-amber-7 bg-n-amber-3 px-3 py-2 text-xs text-n-amber-11">
          <AlertCircle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          הסדרה משויכת אך <strong>כבויה</strong> — הפעילו אותה בלשונית "רצפים" וההודעות יתחילו להישלח אוטומטית.
        </p>
      ) : (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-n-slate-11">
          <Loader2 size={13} className="animate-spin" aria-hidden="true" />
          השיוך יעובד תוך כדקה…
        </p>
      )}

      {/* ── מקטע: פעולות ── */}
      {statusMatchesSelection ? (
        <Button
          variant="faded"
          color="blue"
          size="sm"
          icon={RotateCcw}
          className="mt-3 w-full justify-center"
          disabled={saving}
          onClick={requestRestart}
        >
          {status.status === 'completed' ? 'הפעל מחדש' : 'התחל מחדש מהשלב הראשון'}
        </Button>
      ) : null}

      {assigned ? (
        <Button
          variant="ghost"
          color="ruby"
          size="sm"
          icon={X}
          className="mt-2 w-full justify-center"
          disabled={saving}
          onClick={() => requestAssign('')}
        >
          הסר מהרצף
        </Button>
      ) : null}

      {/* ── מנגנון בטיחות — אישור לפני כל פעולה קריטית ── */}
      <ConfirmDialog
        open={!!confirm}
        onClose={() => !saving && setConfirm(null)}
        onConfirm={confirm?.onConfirm}
        title={confirm?.title}
        description={confirm?.description}
        confirmLabel={confirm?.confirmLabel}
        tone={confirm?.tone}
        loading={saving}
      >
        {confirm?.preview ? (
          <>
            <p className="mb-1.5 text-xs font-medium text-n-slate-11">ההודעה הראשונה בסדרה:</p>
            <ChatBubble
              text={confirm.preview.text}
              template={confirm.preview.template}
              mediaUrl={confirm.preview.mediaUrl}
            />
          </>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

/*
 * StepTimeline — מסע ההודעות של הליד: שורה לכל הודעה, מלמעלה למטה, עם התוכן המלא.
 *   • נשלח  → ✓ ירוק (נמסר) / ✗ אדום (נתקע) + בועה עם התוכן שנשלח בפועל + זמן + טיקים
 *   • נוכחי → נקודת־מותג + בועה עם ההודעה הבאה שתישלח + זמן מתוזמן
 *   • צפוי  → נקודה אפורה + בועה עם תצוגה מקדימה + "כעבור X"
 * כל בועה מוצגת *מלאה* (כברירת מחדל), וניתן לכווץ כל שלב בנפרד (chevron). קו אנכי
 * מחבר את השלבים; השלב הנוכחי נגלל אוטומטית לתצוגה.
 */
function StepTimeline({ steps, history, templates, contactName, currentStep, status, nextSendAt, projected, enrollmentId, pct }) {
  const cur = Number(currentStep) || 0;
  const tmplByName = new Map((templates || []).map((t) => [t.name, t]));
  // ברירת מחדל: הכול סגור — רשימה קומפקטית; לוחצים על שלב כדי לפתוח את ההודעה המלאה.
  const [expanded, setExpanded] = useState(() => new Set());
  const toggle = (n) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(n)) next.delete(n); else next.add(n);
    return next;
  });

  // נפילה-לאחור: אם הגדרת השלבים לא נטענה — פס פשוט
  if (!steps || steps.length === 0) {
    return (
      <div className="mt-2 h-1.5 w-full rounded-full bg-n-alpha-3" aria-hidden="true">
        <div className="h-1.5 rounded-full bg-n-brand transition-[width] duration-500" style={{ width: `${pct || 0}%` }} />
      </div>
    );
  }

  const completed = status === 'completed';
  // היסטוריית השליחה של הריצה הנוכחית בלבד: מסננים לפי enrollment_id, אחרת שלב ברצף הנוכחי
  // עלול להיצבע בזמן-שליחה של רצף קודם שרץ על אותה שיחה (אותו step_order, ריצה אחרת) —
  // הבאג של "הודעה 2 לפני הודעה 1". בהיעדר מזהה-ריצה (גרסה ישנה/pending) — כל ההיסטוריה.
  const runHistory = enrollmentId
    ? (history || []).filter((h) => h.enrollment_id === enrollmentId)
    : (history || []);
  const byStep = new Map(runHistory.map((h) => [Number(h.step_order), h]));
  const allNums = steps.map((_, i) => i + 1);
  const allOpen = allNums.every((n) => expanded.has(n));
  const toggleAll = () => setExpanded(allOpen ? new Set() : new Set(allNums));

  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-end">
        <button
          type="button"
          onClick={toggleAll}
          className="rounded px-1.5 py-0.5 text-xs font-medium text-n-blue-11 transition-colors hover:bg-n-alpha-1"
        >
          {allOpen ? 'כווץ הכול' : 'הרחב הכול'}
        </button>
      </div>
      <ol className="space-y-0.5">
      {steps.map((s, i) => {
        const n = i + 1;
        const sent = byStep.get(n);
        const wasSent = !!sent || completed || n < cur;
        const isCurrent = !wasSent && n === cur && status === 'active';
        const failed = wasSent && sent?.delivery_status === 'failed';
        const last = i === steps.length - 1;
        const gap = formatOffset({ days: s.delayDays, hours: s.delayHours }); // נפילה-לאחור: "כעבור X"
        // מועד השליחה המחושב לשלב שטרם נשלח (הנוכחי + העתידיים) — תאריך+שעה אמיתיים, כולל דחיית שבת/חג.
        const projectedAt = isCurrent ? (projected?.[n] || nextSendAt) : projected?.[n];
        const isOpen = expanded.has(n);

        let marker;
        if (failed) marker = <XCircle size={17} className="text-n-ruby-11" aria-hidden="true" />;
        else if (wasSent) marker = <CheckCircle2 size={17} className="text-n-teal-11" aria-hidden="true" />;
        else if (isCurrent) marker = (
          <span className="flex h-[17px] w-[17px] items-center justify-center rounded-full bg-n-brand ring-4 ring-n-brand/20" aria-hidden="true">
            <span className="h-1.5 w-1.5 rounded-full bg-white" />
          </span>
        );
        else marker = <Circle size={17} className="text-n-slate-8" aria-hidden="true" />;

        // תווית-מצב קטנה ליד מספר ההודעה
        const pill = failed ? { t: 'נכשל', c: 'bg-n-ruby-3 text-n-ruby-11' }
          : wasSent ? { t: 'נשלח', c: 'bg-n-teal-3 text-n-teal-11' }
          : isCurrent ? { t: 'עכשיו', c: 'bg-n-brand/10 text-n-blue-11' }
          : { t: 'ממתין', c: 'bg-n-alpha-2 text-n-slate-10' };

        // תוכן הבועה: נשלח → הטקסט שנשלח בפועל; אחרת → תצוגה מקדימה עם השם
        const tmpl = tmplByName.get(s.template) || null;
        const previewText = renderPreview(tmpl?.body || '', s.params, contactName);
        const bodyText = (wasSent && sent?.content) ? sent.content : previewText;
        const mediaIcon = ({ IMAGE: '📷 ', VIDEO: '🎬 ', DOCUMENT: '📄 ' })[String(tmpl?.header_format || '').toUpperCase()] || '';

        // meta של הבועה (זמן + חיווי). שלב שטרם נשלח מציג את התאריך+שעה המחושב (fmtWhen),
        // ובהיעדר חישוב (אין רישום פעיל) נופל-לאחור ל"כעבור X".
        const meta = failed ? { time: fmtSent(sent?.sent_at), status: 'failed', ltr: true }
          : wasSent ? { time: fmtSent(sent?.sent_at), status: sent?.delivery_status === 'delivered' ? 'delivered' : 'pending', ltr: true }
          : projectedAt ? { time: formatWhen(projectedAt), status: 'scheduled', ltr: false }
          : isCurrent ? { time: 'בקרוב', status: 'scheduled', ltr: false }
          : { time: gap, status: 'scheduled', ltr: false };

        return (
          <li key={s.id || n} className="relative flex gap-3">
            {!last && (
              <span
                className={`absolute w-px ${wasSent ? 'bg-n-teal-6' : 'bg-n-alpha-5'}`}
                style={{ insetInlineStart: '8px', top: '26px', bottom: '-2px' }}
                aria-hidden="true"
              />
            )}
            <span className="relative z-10 mt-2.5 shrink-0">{marker}</span>
            <div className="min-w-0 grow pb-0.5">
              <button
                type="button"
                onClick={() => toggle(n)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start transition-colors hover:bg-n-alpha-1"
              >
                <span className="min-w-0 grow">
                  <span className="flex items-center gap-2">
                    <span className={`text-sm ${isCurrent || wasSent ? 'font-medium text-n-slate-12' : 'text-n-slate-11'}`}>
                      הודעה {n}
                    </span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${pill.c}`}>{pill.t}</span>
                  </span>
                  {!isOpen ? (
                    <span className="mt-1 block truncate text-xs text-n-slate-10">
                      {!wasSent && meta.status === 'scheduled' && meta.time
                        ? `🕐 ${meta.time}`
                        : `${mediaIcon}${bodyText || `תבנית ${s.template}`}`}
                    </span>
                  ) : null}
                </span>
                <ChevronDown
                  size={16}
                  aria-hidden="true"
                  className={`shrink-0 text-n-slate-9 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {isOpen ? (
                <div className="mt-1.5 px-2 pb-1.5">
                  {bodyText || tmpl ? (
                    <ChatBubble text={bodyText} template={tmpl} mediaUrl={s.mediaUrl} meta={meta} />
                  ) : (
                    <p className="text-xs italic text-n-slate-10">תבנית "{s.template}" לא נמצאה</p>
                  )}
                  {failed ? (
                    <p className="mt-1.5 text-[11px] text-n-ruby-11">
                      {deliveryErrorLabel(sent?.error_code, sent?.error_title)}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
      </ol>
    </div>
  );
}
