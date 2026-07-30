import { useId, useRef, useState } from 'react';
import { Plus, Trash2, Upload, X } from 'lucide-react';
import Input, { Label } from '../ui/Input.jsx';
import Select from '../ui/Select.jsx';
import Switch from '../ui/Switch.jsx';
import Badge from '../ui/Badge.jsx';
import Button from '../ui/Button.jsx';
import TemplatePicker from '../ui/TemplatePicker.jsx';
import { uploadMedia } from '../../api/sequencesApi.js';
import useT from '../../useT.js';
import { MAX_BUTTON_OPTIONS, newOptionId } from './graphModel.js';

/*
 * Inspector — the editor's side panel (start side; on the right in RTL).
 * No node selected, or the trigger node selected → journey-level settings
 * (name + trigger). Any other node → that node's data form.
 * Every field patches node.data via patchNode(id, patch); serialization/coercion
 * happens once, in graphModel.toGraph.
 */

const M = {
  he: {
    journeyTitle: 'הגדרות הפלואו',
    nameLabel: 'שם הפלואו',
    namePh: 'למשל: קליטת ליד חדש',
    triggerTitle: 'טריגר — מתי הפלואו מתחיל?',
    inboxesLabel: 'תיבות מחוברות',
    noInboxes: 'לא נמצאו תיבות בחשבון.',
    allInboxesHint: 'בלי בחירה — הפלואו חל על כל התיבות.',
    officialButtons: 'כפתורים אמיתיים',
    numberedButtons: 'כפתורים ממוספרים (1/2/3)',
    keywordsLabel: 'מילות מפתח',
    keywordsPh: 'הוסיפו מילה ולחצו Enter',
    keywordsHint: 'הודעה נכנסת שמכילה אחת מהמילים מפעילה את הפלואו.',
    onNewConv: 'הפעלה על כל שיחה חדשה',
    manual: 'הפעלה ידנית ע"י נציג',
    nodeTitle: 'הגדרות הצומת',
    deleteNode: 'מחיקת הצומת',

    msgText: 'טקסט ההודעה',
    msgTextPh: 'אפשר לשלב {{שם}}, {{טלפון}} או {{answers.key}}',
    mediaUrl: 'קישור למדיה (אופציונלי)',
    mediaUrlPh: 'https://…',

    qText: 'טקסט השאלה',
    validation: 'ולידציה לתשובה',
    v_text: 'טקסט חופשי',
    v_number: 'מספר',
    v_email: 'מייל',
    v_phone: 'טלפון',
    retryMessage: 'הודעה כשהתשובה לא תקינה',
    retryPh: 'ריק = הודעת ברירת המחדל',

    saveToTitle: 'שמירת התשובה',
    saveKey: 'שם השדה (key)',
    saveKeyPh: 'למשל: budget',
    saveKeyHint: 'נשמר כשדה מותאם; ההגדרה תיווצר אוטומטית בשמירה.',
    saveScope: 'היכן לשמור',
    scope_contact: 'איש קשר',
    scope_conversation: 'שיחה',

    followUpTitle: 'פולואפ כשאין מענה',
    fuAfter: 'תזכורת אחרי (דקות)',
    fuMessage: 'הודעת התזכורת',
    fuMax: 'מספר תזכורות מרבי',
    fuGiveUp: 'כשמוותרים',
    gu_continue: 'ממשיכים בפלואו',
    gu_stop: 'עוצרים את הפלואו',
    gu_handoff: 'מעבירים לנציג',

    optionsTitle: 'אפשרויות ({n}/{max})',
    optTitlePh: 'כיתוב הכפתור',
    optValuePh: 'ערך (אופציונלי)',
    addOption: 'הוספת אפשרות',
    removeOption: 'הסרת אפשרות {n}',

    condField: 'שדה לבדיקה',
    condFieldPh: 'שם שדה שנשמר, או name/phone/email',
    condOp: 'תנאי',
    op_eq: 'שווה ל…',
    op_contains: 'מכיל…',
    op_exists: 'קיים (לא ריק)',
    condValue: 'ערך להשוואה',

    delayTitle: 'כמה זמן להמתין?',
    delayDays: 'ימים',
    delayHours: 'שעות',
    delayMinutes: 'דקות',
    delayHint: 'מינימום דקה; מכבד שעות שקט ושבת.',

    labelsLabel: 'תוויות להוספה',
    labelsPh: 'שם תווית + Enter',
    assignee: 'שיוך לנציג/ה',
    team: 'שיוך לצוות',
    noAssign: '— ללא —',
    convStatus: 'שינוי סטטוס שיחה',
    st_none: '— בלי שינוי —',
    st_open: 'פתוחה',
    st_pending: 'ממתינה',
    st_resolved: 'סגורה',
    st_snoozed: 'בנודניק',
    actionWebhook: 'Webhook URL (אופציונלי)',

    whUrl: 'כתובת ה-Webhook',
    whSave: 'שמירת התשובה לשדה (אופציונלי)',
    whSavePh: 'למשל: crm_id',
    whHint: 'נשלח POST עם השיחה, איש הקשר והתשובות.',

    hoMessage: 'הודעת סיום (אופציונלי)',
    hoMessagePh: 'למשל: נציג יחזור אליכם מיד',
    hoHint: 'הפלואו מסתיים והשיחה נפתחת לנציג.',

    removeChip: 'הסרת {v}',

    varInsert: '+ משתנה…',
    varAria: 'הוספת משתנה לטקסט',
    var_name: 'שם איש הקשר',
    var_phone: 'טלפון',
    var_email: 'מייל',

    tplPick: 'תבנית וואטסאפ',
    tplHint: 'תבנית מאושרת נשלחת גם מחוץ לחלון ה-24 שעות — זו הדרך לפתוח שיחה יזומה. עובד רק בתיבת וואטסאפ רשמית (Cloud API).',
    tplNoOfficial: 'לחשבון אין תיבת וואטסאפ רשמית — צומת תבנית ייכשל בשליחה.',
    tplParam: 'פרמטר {{{n}}}',
    tplParamsTitle: 'פרמטרים לתבנית',
    tplMedia: 'קישור מדיה לכותרת ({format})',
    tplMediaHint: 'לתבנית עם כותרת מדיה חובה קישור ציבורי — אפשר להעלות קובץ למטה בצומת הודעה ולהעתיק את הקישור.',
    tplPreview: 'תצוגה מקדימה',

    upload: 'העלאת קובץ',
    uploading: 'מעלה…',
    uploadErr: 'ההעלאה נכשלה',

    quietTitle: 'שעות פעילות',
    quietShabbat: 'לא לשלוח בשבת ובחג',
    quietStart: 'שקט מ-',
    quietEnd: 'עד',
    quietHint: 'חל על השהיות ותזכורות שהבוט יוזם. תשובה ללקוח שכתב עכשיו נשלחת תמיד, גם בלילה.',
  },
  en: {
    journeyTitle: 'Flow settings',
    nameLabel: 'Flow name',
    namePh: 'e.g. New lead intake',
    triggerTitle: 'Trigger — when does the flow start?',
    inboxesLabel: 'Connected inboxes',
    noInboxes: 'No inboxes found on this account.',
    allInboxesHint: 'No selection = the flow applies to all inboxes.',
    officialButtons: 'Real buttons',
    numberedButtons: 'Numbered buttons (1/2/3)',
    keywordsLabel: 'Keywords',
    keywordsPh: 'Type a word and press Enter',
    keywordsHint: 'An incoming message containing one of these words starts the flow.',
    onNewConv: 'Start on every new conversation',
    manual: 'Manual launch by an agent',
    nodeTitle: 'Node settings',
    deleteNode: 'Delete node',

    msgText: 'Message text',
    msgTextPh: 'You can use {{name}}, {{phone}} or {{answers.key}}',
    mediaUrl: 'Media URL (optional)',
    mediaUrlPh: 'https://…',

    qText: 'Question text',
    validation: 'Answer validation',
    v_text: 'Free text',
    v_number: 'Number',
    v_email: 'Email',
    v_phone: 'Phone',
    retryMessage: 'Message on invalid answer',
    retryPh: 'Empty = default message',

    saveToTitle: 'Save the answer',
    saveKey: 'Field key',
    saveKeyPh: 'e.g. budget',
    saveKeyHint: 'Saved as a custom attribute; the definition is created automatically on save.',
    saveScope: 'Save on',
    scope_contact: 'Contact',
    scope_conversation: 'Conversation',

    followUpTitle: 'Follow-up when no answer',
    fuAfter: 'Remind after (minutes)',
    fuMessage: 'Reminder message',
    fuMax: 'Max reminders',
    fuGiveUp: 'On give-up',
    gu_continue: 'Continue the flow',
    gu_stop: 'Stop the flow',
    gu_handoff: 'Hand off to an agent',

    optionsTitle: 'Options ({n}/{max})',
    optTitlePh: 'Button label',
    optValuePh: 'Value (optional)',
    addOption: 'Add option',
    removeOption: 'Remove option {n}',

    condField: 'Field to check',
    condFieldPh: 'A saved field key, or name/phone/email',
    condOp: 'Operator',
    op_eq: 'Equals…',
    op_contains: 'Contains…',
    op_exists: 'Exists (not empty)',
    condValue: 'Value to compare',

    delayTitle: 'How long to wait?',
    delayDays: 'Days',
    delayHours: 'Hours',
    delayMinutes: 'Minutes',
    delayHint: 'Minimum one minute; respects quiet hours and Shabbat.',

    labelsLabel: 'Labels to add',
    labelsPh: 'Label name + Enter',
    assignee: 'Assign to agent',
    team: 'Assign to team',
    noAssign: '— none —',
    convStatus: 'Change conversation status',
    st_none: '— no change —',
    st_open: 'Open',
    st_pending: 'Pending',
    st_resolved: 'Resolved',
    st_snoozed: 'Snoozed',
    actionWebhook: 'Webhook URL (optional)',

    whUrl: 'Webhook URL',
    whSave: 'Save response to field (optional)',
    whSavePh: 'e.g. crm_id',
    whHint: 'POSTs the conversation, contact and answers as JSON.',

    hoMessage: 'Closing message (optional)',
    hoMessagePh: 'e.g. An agent will be right with you',
    hoHint: 'The flow ends and the conversation opens for a human agent.',

    removeChip: 'Remove {v}',

    varInsert: '+ Variable…',
    varAria: 'Insert a variable into the text',
    var_name: 'Contact name',
    var_phone: 'Phone',
    var_email: 'Email',

    tplPick: 'WhatsApp template',
    tplHint: 'An approved template is deliverable outside the 24h window — the way to open a conversation proactively. Official (Cloud API) WhatsApp inboxes only.',
    tplNoOfficial: 'This account has no official WhatsApp inbox — a template node will fail to send.',
    tplParam: 'Param {{{n}}}',
    tplParamsTitle: 'Template parameters',
    tplMedia: 'Header media URL ({format})',
    tplMediaHint: 'A media-header template requires a public URL — upload a file in a message node and copy its link.',
    tplPreview: 'Preview',

    upload: 'Upload file',
    uploading: 'Uploading…',
    uploadErr: 'Upload failed',

    quietTitle: 'Active hours',
    quietShabbat: 'Do not send on Shabbat/holidays',
    quietStart: 'Quiet from',
    quietEnd: 'until',
    quietHint: 'Applies to bot-initiated delays and reminders. Replies to a customer who just wrote are always sent, even at night.',
  },
};

/*
 * VarPicker — בורר משתנים: <select> נטיבי שמתאפס אחרי כל בחירה, ולכן מתפקד כתפריט
 * "הוסף משתנה" נגיש בלי קוד מיקום. vars: [{ key, label }] — הבחירה קוראת onPick(key).
 */
function VarPicker({ vars = [], onPick }) {
  const t = useT(M);
  if (!vars.length) return null;
  return (
    <select
      value=""
      aria-label={t('varAria')}
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value);
        e.target.value = '';
      }}
      className="h-6 max-w-36 cursor-pointer rounded-md border border-n-weak bg-n-alpha-2 px-1.5 text-xs text-n-slate-11 outline-none hover:text-n-slate-12 focus:border-n-brand"
    >
      <option value="">{t('varInsert')}</option>
      {vars.map((v) => (
        <option key={v.key} value={v.key}>
          {v.label ? `${v.label} — {{${v.key}}}` : `{{${v.key}}}`}
        </option>
      ))}
    </select>
  );
}

// The ui kit has no Textarea — same look as Input, three rows.
// `vars` adds an inline variable picker that inserts {{key}} at the cursor.
function Textarea({ label, hint, vars, className = '', ...props }) {
  const id = useId();
  const ref = useRef(null);
  const insertVar = (key) => {
    const token = `{{${key}}}`;
    const el = ref.current;
    const v = String(props.value ?? '');
    const start = el?.selectionStart ?? v.length;
    const end = el?.selectionEnd ?? v.length;
    props.onChange?.({ target: { value: v.slice(0, start) + token + v.slice(end) } });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };
  return (
    <div>
      {label || (vars || []).length ? (
        <div className="flex items-center justify-between gap-2">
          {label ? <Label htmlFor={id}>{label}</Label> : <span />}
          {(vars || []).length ? <VarPicker vars={vars} onPick={insertVar} /> : null}
        </div>
      ) : null}
      <textarea
        id={id}
        ref={ref}
        rows={3}
        className={[
          'w-full bg-n-alpha-2 border border-n-weak rounded-lg px-3 py-2',
          'text-sm text-n-slate-12 placeholder:text-n-slate-10 resize-y',
          'outline-none transition-colors duration-150',
          'focus:border-n-brand focus:ring-1 focus:ring-n-brand/40',
          className,
        ].join(' ')}
        {...props}
      />
      {hint ? <p className="mt-1 text-xs text-n-slate-11">{hint}</p> : null}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="border-t border-n-weak pt-3 mt-3 flex flex-col gap-3">
      {title ? <h4 className="m-0 text-xs font-semibold text-n-slate-11 uppercase tracking-wide">{title}</h4> : null}
      {children}
    </div>
  );
}

/*
 * MediaField — שדה קישור מדיה + כפתור העלאה שמשתמש בספריית המדיה הקיימת של המנוע
 * (/drip-api/media). הפורמט נגזר מה-MIME; הקישור שחוזר הוא היחיד שהמנוע באמת יודע
 * לצרף (הוא קורא את הקובץ מהדיסק) — קישור חיצוני שרירותי יישלח כטקסט בלבד.
 */
function MediaField({ label, value, onChange, accountId }) {
  const t = useT(M);
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pick = async (file) => {
    if (!file) return;
    setErr('');
    setBusy(true);
    try {
      const format = file.type.startsWith('image/') ? 'IMAGE'
        : file.type.startsWith('video/') ? 'VIDEO' : 'DOCUMENT';
      const res = await uploadMedia(file, format, accountId);
      onChange(res.url);
    } catch (e) {
      setErr(e.message || t('uploadErr'));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  return (
    <div>
      <Input
        label={label}
        value={value || ''}
        placeholder="https://…"
        dir="ltr"
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="mt-1.5 flex items-center gap-2">
        <Button
          variant="faded"
          color="slate"
          size="sm"
          icon={Upload}
          loading={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? t('uploading') : t('upload')}
        </Button>
        {err ? <span className="text-xs text-n-ruby-11">{err}</span> : null}
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*,application/pdf"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}

// Chips input — Enter/comma adds, X removes; optional datalist suggestions.
function ChipsInput({ label, value = [], onChange, placeholder, hint, suggestions = [] }) {
  const t = useT(M);
  const [draft, setDraft] = useState('');
  const dlId = useId();
  const add = (raw) => {
    const s = String(raw || '').trim().replace(/,+$/, '');
    if (!s || value.includes(s)) return;
    onChange([...value, s]);
  };
  return (
    <div>
      {label ? <Label>{label}</Label> : null}
      {value.length ? (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {value.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded-md bg-n-alpha-2 px-2 py-0.5 text-xs text-n-slate-12">
              {v}
              <button
                type="button"
                aria-label={t('removeChip', { v })}
                onClick={() => onChange(value.filter((x) => x !== v))}
                className="text-n-slate-10 hover:text-n-ruby-11"
              >
                <X size={11} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <Input
        value={draft}
        placeholder={placeholder}
        list={suggestions.length ? dlId : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(draft);
            setDraft('');
          }
        }}
        onBlur={() => {
          if (draft.trim()) {
            add(draft);
            setDraft('');
          }
        }}
      />
      {suggestions.length ? (
        <datalist id={dlId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
      {hint ? <p className="mt-1 text-xs text-n-slate-11">{hint}</p> : null}
    </div>
  );
}

/*
 * TemplateSection — בחירת תבנית וואטסאפ מאושרת (מ-meta.templates, אותו מקור כמו
 * הרצפים), מילוי פרמטרים {{N}} עם משתני פלואו, ומדיה לכותרת כשנדרשת.
 */
function TemplateSection({ data, patch, meta, vars }) {
  const t = useT(M);
  const templates = meta.templates || [];
  const tpl = templates.find((x) => x.name === data.name) || null;
  const hasOfficial = (meta.inboxes || []).some((ib) => ib.channel_type === 'Channel::Whatsapp');
  const mediaHeader = tpl && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(tpl.header_format || '');
  const params = Array.isArray(data.params) ? data.params : [];

  const choose = (name) => {
    const next = templates.find((x) => x.name === name);
    patch({
      name,
      language: next?.language || '',
      category: next?.category || '',
      // מספר הפרמטרים נגזר מהתבנית; ערכים קיימים נשמרים עד כמה שאפשר.
      params: Array.from({ length: next?.params_count || 0 }, (_, i) => params[i] || ''),
      // זיכרון מדיה: קישור שכבר שימש את התבנית ברצפים מולא אוטומטית.
      mediaUrl: next?.media_url || '',
    });
  };

  const setParam = (i, v) => {
    const next = params.map((p, j) => (j === i ? v : p));
    patch({ params: next });
  };

  return (
    <>
      <div>
        <Label>{t('tplPick')}</Label>
        <TemplatePicker templates={templates} value={data.name || ''} onChange={choose} />
        <p className="mt-1 text-xs text-n-slate-11">{t('tplHint')}</p>
        {!hasOfficial ? <p className="mt-1 text-xs text-n-amber-11">{t('tplNoOfficial')}</p> : null}
      </div>
      {tpl?.body ? (
        <div>
          <Label>{t('tplPreview')}</Label>
          <p className="m-0 whitespace-pre-wrap rounded-lg bg-n-alpha-2 px-3 py-2 text-xs leading-relaxed text-n-slate-11">
            {tpl.body}
          </p>
        </div>
      ) : null}
      {params.length ? (
        <Section title={t('tplParamsTitle')}>
          {params.map((p, i) => (
            <div key={i}>
              <div className="flex items-center justify-between gap-2">
                <Label>{t('tplParam', { n: i + 1 })}</Label>
                <VarPicker vars={vars} onPick={(key) => setParam(i, `${p}{{${key}}}`)} />
              </div>
              <Input
                value={p}
                aria-label={t('tplParam', { n: i + 1 })}
                onChange={(e) => setParam(i, e.target.value)}
              />
            </div>
          ))}
        </Section>
      ) : null}
      {mediaHeader ? (
        <Input
          label={t('tplMedia', { format: tpl.header_format })}
          value={data.mediaUrl || ''}
          placeholder="https://…"
          dir="ltr"
          hint={t('tplMediaHint')}
          onChange={(e) => patch({ mediaUrl: e.target.value })}
        />
      ) : null}
    </>
  );
}

function SaveToEditor({ data, patch }) {
  const t = useT(M);
  const saveTo = data.saveTo || { scope: 'contact', key: '' };
  return (
    <Section title={t('saveToTitle')}>
      <Input
        label={t('saveKey')}
        value={saveTo.key || ''}
        placeholder={t('saveKeyPh')}
        hint={t('saveKeyHint')}
        dir="ltr"
        className="font-mono"
        onChange={(e) => patch({ saveTo: { ...saveTo, key: e.target.value } })}
      />
      <Select
        label={t('saveScope')}
        value={saveTo.scope || 'contact'}
        options={[
          { value: 'contact', label: t('scope_contact') },
          { value: 'conversation', label: t('scope_conversation') },
        ]}
        onChange={(e) => patch({ saveTo: { ...saveTo, scope: e.target.value } })}
      />
    </Section>
  );
}

function FollowUpEditor({ data, patch, vars }) {
  const t = useT(M);
  const fu = data.followUp || null;
  return (
    <Section>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-n-slate-12">{t('followUpTitle')}</span>
        <Switch
          checked={!!fu}
          aria-label={t('followUpTitle')}
          onChange={(on) =>
            patch({ followUp: on ? { afterMinutes: 60, message: '', maxRetries: 1, onGiveUp: 'continue' } : null })
          }
        />
      </div>
      {fu ? (
        <>
          <Input
            type="number"
            min="1"
            label={t('fuAfter')}
            value={fu.afterMinutes ?? 60}
            onChange={(e) => patch({ followUp: { ...fu, afterMinutes: e.target.value } })}
          />
          <Textarea
            label={t('fuMessage')}
            value={fu.message || ''}
            vars={vars}
            onChange={(e) => patch({ followUp: { ...fu, message: e.target.value } })}
          />
          <Input
            type="number"
            min="1"
            max="5"
            label={t('fuMax')}
            value={fu.maxRetries ?? 1}
            onChange={(e) => patch({ followUp: { ...fu, maxRetries: e.target.value } })}
          />
          <Select
            label={t('fuGiveUp')}
            value={fu.onGiveUp || 'continue'}
            options={[
              { value: 'continue', label: t('gu_continue') },
              { value: 'stop', label: t('gu_stop') },
              { value: 'handoff', label: t('gu_handoff') },
            ]}
            onChange={(e) => patch({ followUp: { ...fu, onGiveUp: e.target.value } })}
          />
        </>
      ) : null}
    </Section>
  );
}

function OptionsEditor({ data, patch }) {
  const t = useT(M);
  const options = Array.isArray(data.options) ? data.options : [];
  const set = (i, field, v) => {
    const next = options.map((o, j) => (j === i ? { ...o, [field]: v } : o));
    patch({ options: next });
  };
  return (
    <Section title={t('optionsTitle', { n: options.length, max: MAX_BUTTON_OPTIONS })}>
      {options.map((o, i) => (
        // Index keys are fine here: rows are only appended/removed, never reordered.
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={o.title || ''}
            placeholder={t('optTitlePh')}
            aria-label={`${t('optTitlePh')} ${i + 1}`}
            containerClassName="grow"
            onChange={(e) => set(i, 'title', e.target.value)}
          />
          <Input
            value={o.value || ''}
            placeholder={t('optValuePh')}
            aria-label={`${t('optValuePh')} ${i + 1}`}
            containerClassName="w-24 shrink-0"
            dir="ltr"
            onChange={(e) => set(i, 'value', e.target.value)}
          />
          <Button
            variant="ghost"
            color="ruby"
            size="sm"
            iconOnly
            icon={Trash2}
            aria-label={t('removeOption', { n: i + 1 })}
            disabled={options.length <= 1}
            onClick={() => patch({ options: options.filter((_, j) => j !== i) })}
          />
        </div>
      ))}
      <Button
        variant="faded"
        color="slate"
        size="sm"
        icon={Plus}
        disabled={options.length >= MAX_BUTTON_OPTIONS}
        onClick={() => patch({ options: [...options, { title: '', id: newOptionId(options) }] })}
      >
        {t('addOption')}
      </Button>
    </Section>
  );
}

// Agent/team pickers shared by action + handoff. Empty lists (fetch failed /
// no session) simply render a lone "none" option — best-effort by design.
function AssignPickers({ data, patch, meta }) {
  const t = useT(M);
  const idOpts = (list) => [
    { value: '', label: t('noAssign') },
    ...(list || []).map((a) => ({ value: String(a.id), label: a.name || a.title || `#${a.id}` })),
  ];
  return (
    <>
      <Select
        label={t('assignee')}
        value={data.assigneeId ? String(data.assigneeId) : ''}
        options={idOpts(meta.agents)}
        onChange={(e) => patch({ assigneeId: e.target.value || null })}
      />
      <Select
        label={t('team')}
        value={data.teamId ? String(data.teamId) : ''}
        options={idOpts(meta.teams)}
        onChange={(e) => patch({ teamId: e.target.value || null })}
      />
    </>
  );
}

function TriggerPanel({ name, onName, trigger, onTrigger, inboxes }) {
  const t = useT(M);
  const ids = (trigger.inbox_ids || []).map(Number);
  const toggleInbox = (id) => {
    const n = Number(id);
    onTrigger({
      ...trigger,
      inbox_ids: ids.includes(n) ? ids.filter((x) => x !== n) : [...ids, n],
    });
  };
  return (
    <div className="flex flex-col gap-3">
      <h3 className="m-0 text-sm font-semibold text-n-slate-12">{t('journeyTitle')}</h3>
      <Input label={t('nameLabel')} value={name} placeholder={t('namePh')} onChange={(e) => onName(e.target.value)} />
      <Section title={t('triggerTitle')}>
        <div>
          <Label>{t('inboxesLabel')}</Label>
          {(inboxes || []).length === 0 ? (
            <p className="m-0 text-xs text-n-slate-11">{t('noInboxes')}</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {inboxes.map((ib) => {
                const official = ib.channel_type === 'Channel::Whatsapp';
                return (
                  <label key={ib.id} className="flex cursor-pointer items-center gap-2 text-sm text-n-slate-12">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-n-brand"
                      checked={ids.includes(Number(ib.id))}
                      onChange={() => toggleInbox(ib.id)}
                    />
                    <span className="truncate">{ib.name}</span>
                    <Badge color={official ? 'teal' : 'slate'}>
                      {official ? t('officialButtons') : t('numberedButtons')}
                    </Badge>
                  </label>
                );
              })}
            </div>
          )}
          <p className="mt-1 text-xs text-n-slate-11">{t('allInboxesHint')}</p>
        </div>
        <ChipsInput
          label={t('keywordsLabel')}
          value={trigger.keywords || []}
          placeholder={t('keywordsPh')}
          hint={t('keywordsHint')}
          onChange={(keywords) => onTrigger({ ...trigger, keywords })}
        />
        <div className="flex items-center justify-between">
          <span className="text-sm text-n-slate-12">{t('onNewConv')}</span>
          <Switch
            checked={!!trigger.on_new_conversation}
            aria-label={t('onNewConv')}
            onChange={(v) => onTrigger({ ...trigger, on_new_conversation: v })}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-n-slate-12">{t('manual')}</span>
          <Switch
            checked={trigger.manual !== false}
            aria-label={t('manual')}
            onChange={(v) => onTrigger({ ...trigger, manual: v })}
          />
        </div>
      </Section>
      <Section title={t('quietTitle')}>
        <div className="flex items-center justify-between">
          <span className="text-sm text-n-slate-12">{t('quietShabbat')}</span>
          <Switch
            checked={(trigger.quiet?.skip_shabbat ?? true) !== false}
            aria-label={t('quietShabbat')}
            onChange={(v) => onTrigger({ ...trigger, quiet: { ...(trigger.quiet || {}), skip_shabbat: v } })}
          />
        </div>
        <div className="flex items-end gap-2">
          <Input
            type="time"
            label={t('quietStart')}
            value={trigger.quiet?.quiet_start || ''}
            containerClassName="grow"
            onChange={(e) => onTrigger({ ...trigger, quiet: { ...(trigger.quiet || {}), quiet_start: e.target.value } })}
          />
          <Input
            type="time"
            label={t('quietEnd')}
            value={trigger.quiet?.quiet_end || ''}
            containerClassName="grow"
            onChange={(e) => onTrigger({ ...trigger, quiet: { ...(trigger.quiet || {}), quiet_end: e.target.value } })}
          />
        </div>
        <p className="m-0 text-xs text-n-slate-11">{t('quietHint')}</p>
      </Section>
    </div>
  );
}

export default function Inspector({
  node,
  name,
  onName,
  trigger,
  onTrigger,
  patchNode,
  removeNode,
  meta,
  fieldSuggestions = [],
  vars = [],
  accountId,
}) {
  const t = useT(M);

  if (!node || node.type === 'trigger') {
    return (
      <TriggerPanel name={name} onName={onName} trigger={trigger} onTrigger={onTrigger} inboxes={meta.inboxes} />
    );
  }

  const d = node.data || {};
  const patch = (p) => patchNode(node.id, p);
  const dlId = `cond-fields-${node.id}`;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="m-0 text-sm font-semibold text-n-slate-12">{t('nodeTitle')}</h3>

      {node.type === 'message' ? (
        <>
          <Textarea
            label={t('msgText')}
            value={d.text || ''}
            placeholder={t('msgTextPh')}
            vars={vars}
            onChange={(e) => patch({ text: e.target.value })}
          />
          <MediaField
            label={t('mediaUrl')}
            value={d.mediaUrl || ''}
            accountId={accountId}
            onChange={(v) => patch({ mediaUrl: v })}
          />
        </>
      ) : null}

      {node.type === 'template' ? (
        <TemplateSection data={d} patch={patch} meta={meta} vars={vars} />
      ) : null}

      {node.type === 'question' ? (
        <>
          <Textarea label={t('qText')} value={d.text || ''} vars={vars} onChange={(e) => patch({ text: e.target.value })} />
          <Select
            label={t('validation')}
            value={d.validation || 'text'}
            options={[
              { value: 'text', label: t('v_text') },
              { value: 'number', label: t('v_number') },
              { value: 'email', label: t('v_email') },
              { value: 'phone', label: t('v_phone') },
            ]}
            onChange={(e) => patch({ validation: e.target.value })}
          />
          <Input
            label={t('retryMessage')}
            value={d.retryMessage || ''}
            placeholder={t('retryPh')}
            onChange={(e) => patch({ retryMessage: e.target.value })}
          />
          <SaveToEditor data={d} patch={patch} />
          <FollowUpEditor data={d} patch={patch} vars={vars} />
        </>
      ) : null}

      {node.type === 'buttons' ? (
        <>
          <Textarea label={t('qText')} value={d.text || ''} vars={vars} onChange={(e) => patch({ text: e.target.value })} />
          <OptionsEditor data={d} patch={patch} />
          <Input
            label={t('retryMessage')}
            value={d.retryMessage || ''}
            placeholder={t('retryPh')}
            onChange={(e) => patch({ retryMessage: e.target.value })}
          />
          <SaveToEditor data={d} patch={patch} />
          <FollowUpEditor data={d} patch={patch} vars={vars} />
        </>
      ) : null}

      {node.type === 'condition' ? (
        <>
          <Input
            label={t('condField')}
            value={d.field || ''}
            placeholder={t('condFieldPh')}
            dir="ltr"
            className="font-mono"
            list={fieldSuggestions.length ? dlId : undefined}
            onChange={(e) => patch({ field: e.target.value })}
          />
          {fieldSuggestions.length ? (
            <datalist id={dlId}>
              {fieldSuggestions.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          ) : null}
          <Select
            label={t('condOp')}
            value={d.op || 'eq'}
            options={[
              { value: 'eq', label: t('op_eq') },
              { value: 'contains', label: t('op_contains') },
              { value: 'exists', label: t('op_exists') },
            ]}
            onChange={(e) => patch({ op: e.target.value })}
          />
          {d.op !== 'exists' ? (
            <Input label={t('condValue')} value={d.value ?? ''} onChange={(e) => patch({ value: e.target.value })} />
          ) : null}
        </>
      ) : null}

      {node.type === 'delay' ? (
        <Section title={t('delayTitle')}>
          <div className="grid grid-cols-3 gap-2">
            <Input type="number" min="0" label={t('delayDays')} value={d.days ?? 0} onChange={(e) => patch({ days: e.target.value })} />
            <Input type="number" min="0" label={t('delayHours')} value={d.hours ?? 0} onChange={(e) => patch({ hours: e.target.value })} />
            <Input type="number" min="0" label={t('delayMinutes')} value={d.minutes ?? 0} onChange={(e) => patch({ minutes: e.target.value })} />
          </div>
          <p className="m-0 text-xs text-n-slate-11">{t('delayHint')}</p>
        </Section>
      ) : null}

      {node.type === 'action' ? (
        <>
          <ChipsInput
            label={t('labelsLabel')}
            value={d.labels || []}
            placeholder={t('labelsPh')}
            suggestions={(meta.labels || []).map((l) => l.title).filter(Boolean)}
            onChange={(labels) => patch({ labels })}
          />
          <AssignPickers data={d} patch={patch} meta={meta} />
          <Select
            label={t('convStatus')}
            value={d.status || ''}
            options={[
              { value: '', label: t('st_none') },
              { value: 'open', label: t('st_open') },
              { value: 'pending', label: t('st_pending') },
              { value: 'resolved', label: t('st_resolved') },
              { value: 'snoozed', label: t('st_snoozed') },
            ]}
            onChange={(e) => patch({ status: e.target.value })}
          />
          <Input
            label={t('actionWebhook')}
            value={d.webhookUrl || ''}
            placeholder={t('mediaUrlPh')}
            dir="ltr"
            onChange={(e) => patch({ webhookUrl: e.target.value })}
          />
        </>
      ) : null}

      {node.type === 'webhook' ? (
        <>
          <Input
            label={t('whUrl')}
            value={d.url || ''}
            placeholder={t('mediaUrlPh')}
            dir="ltr"
            hint={t('whHint')}
            onChange={(e) => patch({ url: e.target.value })}
          />
          <Input
            label={t('whSave')}
            value={d.saveResponseTo || ''}
            placeholder={t('whSavePh')}
            dir="ltr"
            className="font-mono"
            onChange={(e) => patch({ saveResponseTo: e.target.value })}
          />
        </>
      ) : null}

      {node.type === 'handoff' ? (
        <>
          <Textarea
            label={t('hoMessage')}
            value={d.message || ''}
            placeholder={t('hoMessagePh')}
            hint={t('hoHint')}
            vars={vars}
            onChange={(e) => patch({ message: e.target.value })}
          />
          <AssignPickers data={d} patch={patch} meta={meta} />
        </>
      ) : null}

      <div className="border-t border-n-weak pt-3 mt-1">
        <Button variant="outline" color="ruby" size="sm" icon={Trash2} onClick={() => removeNode(node.id)}>
          {t('deleteNode')}
        </Button>
      </div>
    </div>
  );
}
