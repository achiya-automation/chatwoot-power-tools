import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Megaphone,
  Wrench,
  ShieldCheck,
  Bold,
  Italic,
  Strikethrough,
  Code,
  PlusCircle,
  Trash2,
  ChevronUp,
  ChevronDown,
  Settings2,
  LayoutGrid,
  Timer,
  AlertTriangle,
  AlertCircle,
  UploadCloud,
  Loader2,
  CheckCircle2,
  Copy,
  Link as LinkIcon,
  Phone,
  CornerUpLeft,
  ClipboardList,
  ShoppingBag,
  Eye,
} from 'lucide-react';
import Card, { CardBody } from './ui/Card.jsx';
import Input, { Label } from './ui/Input.jsx';
import Select from './ui/Select.jsx';
import Button from './ui/Button.jsx';
import Dropdown from './ui/Dropdown.jsx';
import Switch from './ui/Switch.jsx';
import TemplatePreview from './TemplatePreview.jsx';
import { builderReducer } from '../lib/builderState.js';
import {
  emptyTemplate,
  CATEGORIES,
  HEADER_FORMATS,
  BUTTON_TYPES,
  CAROUSEL_CARD_BUTTON_TYPES,
  CAROUSEL_CARD_BUTTONS_MAX,
  LIMITS,
  LANGS,
  bodyVars,
  validateTemplate,
  warningsFor,
  serializeTemplate,
} from '../lib/templateRules.js';
import { createTemplate, editTemplate, uploadExample, listFlows } from '../api/templatesApi.js';
import useT, { useLocale } from '../useT.js';

/*
 * TemplateBuilder — the full Template Studio editor: a form (name/language/category, header,
 * body, footer, buttons, carousel, LTO, AUTH, advanced) plus a sticky live <TemplatePreview>.
 * State is a single templateRules.emptyTemplate()-shaped object driven by builderReducer
 * (lib/builderState.js, pure, tested on its own) — this file is rendering + dispatching only;
 * every rule (caps, required fields, Graph shape) lives in templateRules.js.
 *
 * Props: accountId, wabaCtx ({ inboxes, capabilities: { mediaUpload, flows, reason_he/en } }),
 * initial (uiTemplate|null), editTemplateId (string|null), existingTemplates, onDone, onCancel.
 */

// Co-located dictionary (he/en) — every user-facing string in the Builder.
const M = {
  he: {
    nameLabel: 'שם התבנית', nameHint: 'אותיות לועזיות קטנות, ספרות וקו תחתון בלבד',
    languageLabel: 'שפה',
    categoryLabel: 'קטגוריה',
    cat_MARKETING: 'שיווק', cat_UTILITY: 'שירות', cat_AUTHENTICATION: 'אימות',
    catPrice_MARKETING: 'תעריף גבוה יותר', catPrice_UTILITY: 'תעריף נמוך יותר', catPrice_AUTHENTICATION: 'תעריף ייעודי לאימות',

    headerLabel: 'כותרת',
    hdr_NONE: 'ללא', hdr_TEXT: 'טקסט', hdr_IMAGE: 'תמונה', hdr_VIDEO: 'וידאו', hdr_DOCUMENT: 'מסמך', hdr_LOCATION: 'מיקום',
    headerTextLabel: 'טקסט הכותרת', headerExampleLabel: 'דוגמה למשתנה בכותרת',
    mediaUploadUnavailable: 'העלאת מדיה אינה זמינה עבור חשבון וואטסאפ זה',

    bodyLabel: 'גוף ההודעה',
    boldTitle: 'מודגש', italicTitle: 'נטוי', strikeTitle: 'קו חוצה', monoTitle: 'מונוספייס',
    addVariable: '+ משתנה', namedVarPrompt: 'שם המשתנה (אותיות/ספרות/קו תחתון)',
    examplesLabel: 'דוגמאות למשתנים', exampleForVar: 'דוגמה עבור {var}',

    footerLabel: 'הערת שוליים', footerHint: 'לא תומכת במשתנים',

    buttonsLabel: 'כפתורים', addButton: 'הוספת כפתור ▾', noButtons: 'אין כפתורים עדיין',
    btn_QUICK_REPLY: 'מענה מהיר', btn_URL: 'קישור', btn_PHONE_NUMBER: 'טלפון', btn_VOICE_CALL: 'שיחת קול',
    btn_COPY_CODE: 'העתקת קוד', btn_FLOW: 'Flow', btn_CATALOG: 'קטלוג', btn_MPM: 'ריבוי מוצרים',
    btnDesc_QUICK_REPLY: 'תשובה מהירה בלחיצה', btnDesc_URL: 'קישור לאתר', btnDesc_PHONE_NUMBER: 'חיוג למספר טלפון',
    btnDesc_VOICE_CALL: 'שיחת קול בוואטסאפ', btnDesc_COPY_CODE: 'העתקת קוד קופון', btnDesc_FLOW: 'פתיחת טופס (Flow)',
    btnDesc_CATALOG: 'צפייה במוצר בקטלוג', btnDesc_MPM: 'צפייה במספר מוצרים',
    btnCapReached: 'הגעתם למכסה המותרת',
    buttonTextLabel: 'טקסט הכפתור', urlLabel: 'כתובת URL', urlExampleLabel: 'דוגמה לכתובת (משתנה דינמי)',
    phoneLabel: 'מספר טלפון', couponCodeLabel: 'קוד הקופון',
    ttlMinutesLabel: 'תוקף השיחה (דקות)', ttlMinutesHint: 'בין 1440 ל-43200 דקות (1–30 ימים), לא חובה',
    selectFlow: 'בחירת Flow', flowsUnavailable: 'WhatsApp Flows אינם זמינים לחשבון עסקי זה',
    noFlowsFound: 'לא נמצאו Flows בחשבון זה',
    moveUp: 'הזזה למעלה', moveDown: 'הזזה למטה', removeButton: 'הסרת כפתור',

    carouselLabel: 'קרוסלה', carouselHint: 'כמה כרטיסים נגללים, כל אחד עם מדיה, טקסט וכפתורים משלו',
    cardN: 'כרטיס {n}', addCard: '+ כרטיס', cardHeaderFormatLabel: 'סוג כותרת (משותף לכל הכרטיסים)',
    duplicateCard: 'שכפול', removeCard: 'מחיקה', cardBodyPlaceholder: 'טקסט הכרטיס…', cardButtonsLabel: 'כפתורי הכרטיס',

    ltoLabel: 'מבצע מוגבל בזמן (LTO)', ltoHint: 'זמין רק בקטגוריית שיווק',
    ltoTextLabel: 'טקסט ההצעה', ltoHasExpirationLabel: 'עם ספירה לאחור בוואטסאפ',

    otpTypeLabel: 'סוג קוד האימות', otp_copy_code: 'העתקת קוד',
    securityRecommendationLabel: 'הוספת שורת אבטחה ("אין לשתף קוד זה")',
    expirationMinutesLabel: 'תפוגת הקוד (דקות)', expirationMinutesHint: 'בין 1 ל-90 דקות',

    advancedLabel: 'מתקדם', parameterFormatLabel: 'משתנים בשם (NAMED)', parameterFormatHint: 'במקום {{1}} — {{first_name}}',
    ttlSecondsLabel: 'תוקף שליחה (שניות)', ttlSecondsHint: 'לא חובה — כמה זמן מטא תנסה לשלוח את ההודעה',

    previewLabel: 'תצוגה מקדימה',
    cancel: 'ביטול', submit: 'שליחה לאישור מטא',
    submitFailed: 'השליחה נכשלה',
    uploadFailed: 'ההעלאה נכשלה', uploading: 'מעלה…', dropHere: 'גררו קובץ לכאן או לחצו לבחירה',
    uploadAria: 'העלאת קובץ', replace: 'החלפה', mediaUploaded: 'הקובץ הועלה',
  },
  en: {
    nameLabel: 'Template name', nameHint: 'Lowercase letters, digits and underscore only',
    languageLabel: 'Language',
    categoryLabel: 'Category',
    cat_MARKETING: 'Marketing', cat_UTILITY: 'Utility', cat_AUTHENTICATION: 'Authentication',
    catPrice_MARKETING: 'Higher rate', catPrice_UTILITY: 'Lower rate', catPrice_AUTHENTICATION: 'Dedicated authentication rate',

    headerLabel: 'Header',
    hdr_NONE: 'None', hdr_TEXT: 'Text', hdr_IMAGE: 'Image', hdr_VIDEO: 'Video', hdr_DOCUMENT: 'Document', hdr_LOCATION: 'Location',
    headerTextLabel: 'Header text', headerExampleLabel: 'Example for the header variable',
    mediaUploadUnavailable: 'Media upload is unavailable for this WhatsApp account',

    bodyLabel: 'Message body',
    boldTitle: 'Bold', italicTitle: 'Italic', strikeTitle: 'Strikethrough', monoTitle: 'Monospace',
    addVariable: '+ Variable', namedVarPrompt: 'Variable name (letters/digits/underscore)',
    examplesLabel: 'Variable examples', exampleForVar: 'Example for {var}',

    footerLabel: 'Footer', footerHint: "Doesn't support variables",

    buttonsLabel: 'Buttons', addButton: 'Add button ▾', noButtons: 'No buttons yet',
    btn_QUICK_REPLY: 'Quick reply', btn_URL: 'URL', btn_PHONE_NUMBER: 'Phone', btn_VOICE_CALL: 'Voice call',
    btn_COPY_CODE: 'Copy code', btn_FLOW: 'Flow', btn_CATALOG: 'Catalog', btn_MPM: 'Multi-product',
    btnDesc_QUICK_REPLY: 'A tappable quick reply', btnDesc_URL: 'Opens a link', btnDesc_PHONE_NUMBER: 'Dials a phone number',
    btnDesc_VOICE_CALL: 'Starts a WhatsApp call', btnDesc_COPY_CODE: 'Copies a coupon code', btnDesc_FLOW: 'Opens a WhatsApp Flow form',
    btnDesc_CATALOG: 'Shows a catalog product', btnDesc_MPM: 'Shows multiple catalog products',
    btnCapReached: 'Limit reached',
    buttonTextLabel: 'Button text', urlLabel: 'URL', urlExampleLabel: 'URL example (dynamic variable)',
    phoneLabel: 'Phone number', couponCodeLabel: 'Coupon code',
    ttlMinutesLabel: 'Call TTL (minutes)', ttlMinutesHint: '1440–43200 minutes (1–30 days), optional',
    selectFlow: 'Select a Flow', flowsUnavailable: 'WhatsApp Flows are unavailable for this business account',
    noFlowsFound: 'No Flows found on this account',
    moveUp: 'Move up', moveDown: 'Move down', removeButton: 'Remove button',

    carouselLabel: 'Carousel', carouselHint: 'A few scrollable cards, each with its own media, text and buttons',
    cardN: 'Card {n}', addCard: '+ Card', cardHeaderFormatLabel: 'Header format (shared by every card)',
    duplicateCard: 'Duplicate', removeCard: 'Remove', cardBodyPlaceholder: 'Card text…', cardButtonsLabel: 'Card buttons',

    ltoLabel: 'Limited-Time Offer (LTO)', ltoHint: 'Only available for the Marketing category',
    ltoTextLabel: 'Offer text', ltoHasExpirationLabel: 'With a WhatsApp countdown',

    otpTypeLabel: 'Verification code type', otp_copy_code: 'Copy code',
    securityRecommendationLabel: 'Add a security line ("do not share this code")',
    expirationMinutesLabel: 'Code expiration (minutes)', expirationMinutesHint: 'Between 1 and 90 minutes',

    advancedLabel: 'Advanced', parameterFormatLabel: 'Named variables (NAMED)', parameterFormatHint: 'Use {{first_name}} instead of {{1}}',
    ttlSecondsLabel: 'Send TTL (seconds)', ttlSecondsHint: "Optional — how long Meta keeps trying to deliver the message",

    previewLabel: 'Preview',
    cancel: 'Cancel', submit: 'Submit for Meta review',
    submitFailed: 'Submission failed',
    uploadFailed: 'Upload failed', uploading: 'Uploading…', dropHere: 'Drag a file here or click to choose',
    uploadAria: 'Upload file', replace: 'Replace', mediaUploaded: 'File uploaded',
  },
};

const CATEGORY_ICON = { MARKETING: Megaphone, UTILITY: Wrench, AUTHENTICATION: ShieldCheck };
const BUTTON_ICON = {
  URL: LinkIcon, PHONE_NUMBER: Phone, VOICE_CALL: Phone, QUICK_REPLY: CornerUpLeft,
  COPY_CODE: Copy, FLOW: ClipboardList, CATALOG: ShoppingBag, MPM: ShoppingBag,
};
const ACCEPT_BY_FORMAT = { IMAGE: 'image/*', VIDEO: 'video/*', DOCUMENT: '.pdf,application/pdf' };

function segmentClass(active) {
  return `rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
    active ? 'bg-n-brand text-white' : 'bg-n-alpha-2 text-n-slate-11 hover:bg-n-alpha-3'
  }`;
}

function SectionLabel({ children, icon: Icon }) {
  return (
    <h3 className="flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
      {Icon ? <Icon size={15} className="text-n-blue-11" aria-hidden="true" /> : null}
      {children}
    </h3>
  );
}

function MessageStrip({ items, tone, icon: Icon, locale }) {
  if (!items || items.length === 0) return null;
  const toneCls = tone === 'ruby'
    ? 'border-n-ruby-7 bg-n-ruby-3 text-n-ruby-11'
    : 'border-n-amber-7 bg-n-amber-3 text-n-amber-12';
  return (
    <div className={`flex flex-col gap-1.5 rounded-xl border px-4 py-3 ${toneCls}`}>
      {items.map((item, i) => (
        <p key={i} className="flex items-start gap-2 text-sm">
          <Icon size={15} className={`mt-0.5 shrink-0 ${tone === 'amber' ? 'text-n-amber-11' : ''}`} aria-hidden="true" />
          {locale === 'he' ? item.msg_he : item.msg_en}
        </p>
      ))}
    </div>
  );
}

function CategoryCard({ cat, selected, onSelect, t }) {
  const Icon = CATEGORY_ICON[cat];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex flex-col items-start gap-1.5 rounded-lg border px-3 py-2.5 text-start transition-colors ${
        selected ? 'border-n-brand bg-n-brand/5' : 'border-n-weak bg-n-alpha-1 hover:bg-n-alpha-2'
      }`}
    >
      <Icon size={16} className={selected ? 'text-n-blue-11' : 'text-n-slate-10'} aria-hidden="true" />
      <span className="text-sm font-medium text-n-slate-12">{t(`cat_${cat}`)}</span>
      <span className="text-[11px] text-n-slate-10">{t(`catPrice_${cat}`)}</span>
    </button>
  );
}

// Shared header/example-media dropzone — used for the top-level header and for each
// carousel card. Uploads through templatesApi.uploadExample and hands the resulting
// opaque `handle` back to the caller (which stores it on header.mediaHandle / card.mediaHandle).
function MediaDropzone({ format, mediaHandle, accountId, inboxId, onUploaded }) {
  const t = useT(M);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const [fileName, setFileName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    setErr('');
    setUploading(true);
    try {
      const res = await uploadExample(accountId, inboxId, file);
      setFileName(file.name);
      onUploaded(res.handle);
    } catch (e) {
      setErr(e.message || t('uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      {mediaHandle ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-n-teal-7 bg-n-teal-3 px-3 py-2">
          <span className="flex min-w-0 items-center gap-2 text-sm text-n-teal-11">
            <CheckCircle2 size={16} className="shrink-0" aria-hidden="true" />
            <span className="truncate">{fileName || t('mediaUploaded')}</span>
          </span>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="shrink-0 text-xs font-medium text-n-blue-11 hover:underline"
          >
            {t('replace')}
          </button>
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer?.files?.[0]); }}
          onClick={() => !uploading && inputRef.current?.click()}
          onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !uploading) inputRef.current?.click(); }}
          role="button"
          tabIndex={0}
          aria-label={t('uploadAria')}
          className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-3 py-5 text-center outline-none transition-colors focus-visible:border-n-brand ${
            dragOver ? 'border-n-brand bg-n-brand/5' : 'border-n-weak bg-n-alpha-1 hover:bg-n-alpha-2'
          }`}
        >
          {uploading ? (
            <>
              <Loader2 size={20} className="animate-spin text-n-blue-11" aria-hidden="true" />
              <span className="text-sm text-n-slate-11">{t('uploading')}</span>
            </>
          ) : (
            <>
              <UploadCloud size={22} className="text-n-slate-10" aria-hidden="true" />
              <span className="text-sm font-medium text-n-slate-12">{t('dropHere')}</span>
            </>
          )}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_BY_FORMAT[format]}
        className="hidden"
        onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
      />
      {err ? <p className="mt-1.5 text-xs font-medium text-n-ruby-11">{err}</p> : null}
    </div>
  );
}

function HeaderSection({ tpl, dispatch, accountId, inboxId, wabaCtx, locale, t }) {
  const mediaUploadOk = wabaCtx?.capabilities?.mediaUpload !== false;
  const reason = locale === 'he' ? wabaCtx?.capabilities?.reason_he : wabaCtx?.capabilities?.reason_en;
  const isMedia = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(tpl.header.format);
  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <SectionLabel>{t('headerLabel')}</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {HEADER_FORMATS.map((fmt) => (
            <button
              key={fmt}
              type="button"
              onClick={() => dispatch({ type: 'set_header', field: 'format', value: fmt })}
              className={segmentClass(tpl.header.format === fmt)}
            >
              {t(`hdr_${fmt}`)}
            </button>
          ))}
        </div>

        {tpl.header.format === 'TEXT' ? (
          <>
            <Input
              label={t('headerTextLabel')}
              value={tpl.header.text}
              maxLength={LIMITS.headerText}
              onChange={(e) => dispatch({ type: 'set_header', field: 'text', value: e.target.value })}
            />
            {bodyVars(tpl.header.text).length > 0 ? (
              <Input
                label={t('headerExampleLabel')}
                value={tpl.header.example}
                onChange={(e) => dispatch({ type: 'set_header', field: 'example', value: e.target.value })}
              />
            ) : null}
          </>
        ) : null}

        {isMedia ? (
          mediaUploadOk ? (
            <MediaDropzone
              format={tpl.header.format}
              mediaHandle={tpl.header.mediaHandle}
              accountId={accountId}
              inboxId={inboxId}
              onUploaded={(handle) => dispatch({ type: 'set_header', field: 'mediaHandle', value: handle })}
            />
          ) : (
            <p className="rounded-lg border border-n-amber-7 bg-n-amber-3 px-3 py-2 text-xs text-n-amber-12">
              {reason || t('mediaUploadUnavailable')}
            </p>
          )
        ) : null}
      </CardBody>
    </Card>
  );
}

function BodySection({ tpl, dispatch, t }) {
  const textareaRef = useRef(null);
  const vars = bodyVars(tpl.body.text);
  const bodyCap = tpl.lto ? LIMITS.ltoBody : LIMITS.body;

  const wrapSelection = (mark) => {
    const el = textareaRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd, value } = el;
    const selected = value.slice(selectionStart, selectionEnd);
    const next = value.slice(0, selectionStart) + mark + selected + mark + value.slice(selectionEnd);
    dispatch({ type: 'set_body', text: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selectionStart + mark.length, selectionEnd + mark.length);
    });
  };

  const insertAtCursor = (token) => {
    const el = textareaRef.current;
    const pos = el ? el.selectionStart : tpl.body.text.length;
    dispatch({ type: 'set_body', text: tpl.body.text.slice(0, pos) + token + tpl.body.text.slice(pos) });
  };

  const insertVariable = () => {
    if (tpl.parameterFormat === 'NAMED') {
      const name = window.prompt(t('namedVarPrompt'));
      const clean = String(name || '').trim().replace(/[^a-zA-Z0-9_]/g, '_');
      if (clean) insertAtCursor(`{{${clean}}}`);
      return;
    }
    const nums = vars.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
    const nextN = (nums.length ? Math.max(...nums) : 0) + 1;
    insertAtCursor(`{{${nextN}}}`);
  };

  const exampleValueFor = (v) => {
    if (tpl.parameterFormat === 'NAMED') {
      const found = (tpl.body.examples || []).find((e) => e && e.param_name === v);
      return found?.example || '';
    }
    return tpl.body.examples?.[Number(v) - 1] || '';
  };

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <SectionLabel>{t('bodyLabel')}</SectionLabel>
          <span className="text-xs text-n-slate-10">{tpl.body.text.length}/{bodyCap}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" color="slate" size="xs" iconOnly icon={Bold} aria-label={t('boldTitle')} title={t('boldTitle')} onClick={() => wrapSelection('*')} />
          <Button variant="ghost" color="slate" size="xs" iconOnly icon={Italic} aria-label={t('italicTitle')} title={t('italicTitle')} onClick={() => wrapSelection('_')} />
          <Button variant="ghost" color="slate" size="xs" iconOnly icon={Strikethrough} aria-label={t('strikeTitle')} title={t('strikeTitle')} onClick={() => wrapSelection('~')} />
          <Button variant="ghost" color="slate" size="xs" iconOnly icon={Code} aria-label={t('monoTitle')} title={t('monoTitle')} onClick={() => wrapSelection('```')} />
          <span className="mx-1 h-4 w-px bg-n-weak" aria-hidden="true" />
          <Button variant="faded" color="slate" size="xs" icon={PlusCircle} onClick={insertVariable}>{t('addVariable')}</Button>
        </div>
        <textarea
          ref={textareaRef}
          value={tpl.body.text}
          onChange={(e) => dispatch({ type: 'set_body', text: e.target.value })}
          rows={4}
          dir="auto"
          className="w-full resize-y rounded-lg border border-n-weak bg-n-alpha-2 px-3 py-2 text-sm text-n-slate-12 outline-none transition-colors focus:border-n-brand focus:ring-1 focus:ring-n-brand/40"
        />
        {vars.length > 0 ? (
          <div className="flex flex-col gap-2">
            <Label className="mb-0">{t('examplesLabel')}</Label>
            {vars.map((v) => (
              <Input
                key={v}
                label={t('exampleForVar', { var: tpl.parameterFormat === 'NAMED' ? v : `{{${v}}}` })}
                value={exampleValueFor(v)}
                onChange={(e) => dispatch(
                  tpl.parameterFormat === 'NAMED'
                    ? { type: 'set_body_example', name: v, value: e.target.value }
                    : { type: 'set_body_example', index: Number(v) - 1, value: e.target.value }
                )}
              />
            ))}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function FooterSection({ tpl, dispatch, t }) {
  return (
    <Card>
      <CardBody>
        <Input
          label={t('footerLabel')}
          value={tpl.footer}
          maxLength={LIMITS.footer}
          hint={t('footerHint')}
          onChange={(e) => dispatch({ type: 'set_field', field: 'footer', value: e.target.value })}
        />
      </CardBody>
    </Card>
  );
}

function buttonTypeOptions(tpl, t) {
  const counts = {};
  for (const b of tpl.buttons || []) counts[b.type] = (counts[b.type] || 0) + 1;
  const totalAtCap = (tpl.buttons || []).length >= LIMITS.buttonsTotal;
  return Object.keys(BUTTON_TYPES).map((type) => {
    const spec = BUTTON_TYPES[type];
    const count = counts[type] || 0;
    const disabled = totalAtCap || count >= spec.max;
    return {
      value: type,
      label: `${t(`btn_${type}`)} (${count}/${spec.max})`,
      description: disabled ? t('btnCapReached') : t(`btnDesc_${type}`),
      disabled,
    };
  });
}

function ButtonRow({ index, total, button, isLto, dispatch, flows, flowsReason, t }) {
  const spec = BUTTON_TYPES[button.type] || {};
  const Icon = BUTTON_ICON[button.type] || CornerUpLeft;
  const patch = (p) => dispatch({ type: 'update_button', index, patch: p });
  const codeCap = isLto ? LIMITS.ltoCode : spec.codeMax;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-n-weak bg-n-alpha-1 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-n-slate-11">
          <Icon size={13} aria-hidden="true" />
          {t(`btn_${button.type}`)}
        </span>
        <span className="flex items-center gap-0.5">
          <Button variant="ghost" color="slate" size="xs" iconOnly icon={ChevronUp} disabled={index === 0}
            aria-label={t('moveUp')} onClick={() => dispatch({ type: 'move_button', index, dir: -1 })} />
          <Button variant="ghost" color="slate" size="xs" iconOnly icon={ChevronDown} disabled={index === total - 1}
            aria-label={t('moveDown')} onClick={() => dispatch({ type: 'move_button', index, dir: 1 })} />
          <Button variant="ghost" color="ruby" size="xs" iconOnly icon={Trash2}
            aria-label={t('removeButton')} onClick={() => dispatch({ type: 'remove_button', index })} />
        </span>
      </div>

      {button.type === 'COPY_CODE' ? (
        <Input label={t('couponCodeLabel')} value={button.code} dir="ltr" maxLength={codeCap}
          onChange={(e) => patch({ code: e.target.value })} />
      ) : (
        <Input label={t('buttonTextLabel')} value={button.text} maxLength={spec.textMax}
          onChange={(e) => patch({ text: e.target.value })} />
      )}

      {button.type === 'URL' ? (
        <>
          <Input label={t('urlLabel')} value={button.url} dir="ltr" onChange={(e) => patch({ url: e.target.value })} />
          {bodyVars(button.url).length > 0 ? (
            <Input label={t('urlExampleLabel')} value={button.urlExample} dir="ltr" onChange={(e) => patch({ urlExample: e.target.value })} />
          ) : null}
        </>
      ) : null}

      {button.type === 'PHONE_NUMBER' ? (
        <Input label={t('phoneLabel')} value={button.phone} dir="ltr" onChange={(e) => patch({ phone: e.target.value })} />
      ) : null}

      {button.type === 'VOICE_CALL' ? (
        <Input
          label={t('ttlMinutesLabel')} type="number" dir="ltr" hint={t('ttlMinutesHint')}
          value={button.ttlMinutes ?? ''}
          onChange={(e) => patch({ ttlMinutes: e.target.value === '' ? undefined : Number(e.target.value) })}
        />
      ) : null}

      {button.type === 'FLOW' ? (
        <Dropdown
          options={flows.map((f) => ({ value: f.id, label: f.name }))}
          value={button.flowId || null}
          onChange={(v) => patch({ flowId: v })}
          disabled={flows.length === 0}
          placeholder={flows.length === 0 ? flowsReason : t('selectFlow')}
          ariaLabel={t('selectFlow')}
        />
      ) : null}
    </div>
  );
}

function ButtonsSection({ tpl, dispatch, flows, flowsReason, t }) {
  const options = buttonTypeOptions(tpl, t);
  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel>{t('buttonsLabel')}</SectionLabel>
          <Dropdown
            options={options}
            value={null}
            onChange={(v) => dispatch({ type: 'add_button', btnType: v })}
            placeholder={t('addButton')}
            ariaLabel={t('addButton')}
            className="w-52"
          />
        </div>
        {tpl.buttons.length === 0 ? (
          <p className="text-xs text-n-slate-10">{t('noButtons')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {tpl.buttons.map((b, i) => (
              <ButtonRow
                key={i} index={i} total={tpl.buttons.length} button={b} isLto={!!tpl.lto}
                dispatch={dispatch} flows={flows} flowsReason={flowsReason} t={t}
              />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function CarouselCardEditor({ index, card, dispatch, accountId, inboxId, wabaCtx, canRemove, onRemove, onDuplicate, t }) {
  const vars = bodyVars(card.body);
  const mediaUploadOk = wabaCtx?.capabilities?.mediaUpload !== false;
  const patchCard = (p) => dispatch({ type: 'carousel_update_card', index, patch: p });
  const isMedia = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(card.headerFormat);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-n-weak bg-n-alpha-1 p-3">
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" color="slate" size="xs" icon={Copy} onClick={onDuplicate}>{t('duplicateCard')}</Button>
        <Button variant="ghost" color="ruby" size="xs" icon={Trash2} disabled={!canRemove} onClick={onRemove}>{t('removeCard')}</Button>
      </div>

      {isMedia ? (
        mediaUploadOk ? (
          <MediaDropzone
            format={card.headerFormat}
            mediaHandle={card.mediaHandle}
            accountId={accountId}
            inboxId={inboxId}
            onUploaded={(handle) => patchCard({ mediaHandle: handle })}
          />
        ) : (
          <p className="rounded-lg border border-n-amber-7 bg-n-amber-3 px-3 py-2 text-xs text-n-amber-12">
            {t('mediaUploadUnavailable')}
          </p>
        )
      ) : null}

      <textarea
        value={card.body}
        onChange={(e) => patchCard({ body: e.target.value })}
        rows={3}
        dir="auto"
        maxLength={LIMITS.carouselBody}
        placeholder={t('cardBodyPlaceholder')}
        className="w-full resize-y rounded-lg border border-n-weak bg-n-alpha-2 px-3 py-2 text-sm text-n-slate-12 outline-none transition-colors focus:border-n-brand focus:ring-1 focus:ring-n-brand/40"
      />

      {vars.length > 0 ? (
        <div className="flex flex-col gap-2">
          {vars.map((v) => (
            <Input
              key={v}
              label={t('exampleForVar', { var: `{{${v}}}` })}
              value={card.examples[Number(v) - 1] || ''}
              onChange={(e) => {
                const next = [...card.examples];
                while (next.length < Number(v)) next.push('');
                next[Number(v) - 1] = e.target.value;
                patchCard({ examples: next });
              }}
            />
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <Label className="mb-0">{t('cardButtonsLabel')}</Label>
        <Dropdown
          options={CAROUSEL_CARD_BUTTON_TYPES.map((type) => {
            const count = card.buttons.filter((b) => b.type === type).length;
            const max = Math.min(BUTTON_TYPES[type]?.max ?? 1, CAROUSEL_CARD_BUTTONS_MAX);
            const disabled = card.buttons.length >= CAROUSEL_CARD_BUTTONS_MAX || count >= max;
            return { value: type, label: `${t(`btn_${type}`)} (${count}/${max})`, disabled };
          })}
          value={null}
          onChange={(v) => dispatch({ type: 'card_add_button', index, btnType: v })}
          placeholder={t('addButton')}
          ariaLabel={t('addButton')}
          className="w-48"
        />
      </div>
      {card.buttons.length > 0 ? (
        <div className="flex flex-col gap-2">
          {card.buttons.map((b, bi) => (
            <div key={bi} className="flex flex-wrap items-center gap-2 rounded-lg border border-n-weak bg-n-solid-2 p-2">
              <span className="shrink-0 text-xs font-medium text-n-slate-11">{t(`btn_${b.type}`)}</span>
              <Input
                value={b.text}
                placeholder={t('buttonTextLabel')}
                containerClassName="min-w-[8rem] flex-1"
                onChange={(e) => dispatch({ type: 'card_update_button', index, buttonIndex: bi, patch: { text: e.target.value } })}
              />
              {b.type === 'URL' ? (
                <Input
                  value={b.url} dir="ltr" placeholder={t('urlLabel')} containerClassName="min-w-[8rem] flex-1"
                  onChange={(e) => dispatch({ type: 'card_update_button', index, buttonIndex: bi, patch: { url: e.target.value } })}
                />
              ) : null}
              {b.type === 'PHONE_NUMBER' ? (
                <Input
                  value={b.phone} dir="ltr" placeholder={t('phoneLabel')} containerClassName="min-w-[8rem] flex-1"
                  onChange={(e) => dispatch({ type: 'card_update_button', index, buttonIndex: bi, patch: { phone: e.target.value } })}
                />
              ) : null}
              <Button variant="ghost" color="ruby" size="xs" iconOnly icon={Trash2} aria-label={t('removeButton')}
                onClick={() => dispatch({ type: 'card_remove_button', index, buttonIndex: bi })} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CarouselSection({ tpl, dispatch, accountId, inboxId, wabaCtx, t }) {
  const isOn = !!tpl.carousel;
  const cards = tpl.carousel?.cards || [];
  const [activeCard, setActiveCard] = useState(0);
  const active = Math.min(activeCard, Math.max(cards.length - 1, 0));
  const sharedFormat = cards[0]?.headerFormat || 'NONE';

  const setSharedFormat = (fmt) => {
    // Re-clicking the already-active format must be a no-op — otherwise it re-dispatches
    // mediaHandle: '' for every card and silently wipes already-uploaded card media.
    if (fmt === sharedFormat) return;
    cards.forEach((_, i) => dispatch({ type: 'carousel_update_card', index: i, patch: { headerFormat: fmt, mediaHandle: '' } }));
  };

  const duplicateCard = (i) => {
    const src = cards[i];
    const newIndex = cards.length;
    dispatch({ type: 'carousel_add_card' });
    dispatch({
      type: 'carousel_update_card',
      index: newIndex,
      patch: { headerFormat: src.headerFormat, mediaHandle: src.mediaHandle, body: src.body, examples: [...src.examples], buttons: src.buttons.map((b) => ({ ...b })) },
    });
    setActiveCard(newIndex);
  };

  const toggle = () => {
    // Carousel and LTO don't combine in Meta's real product — clear LTO before turning
    // the carousel on so the two "special section" toggles stay mutually exclusive.
    if (!isOn && tpl.lto) dispatch({ type: 'toggle_lto' });
    dispatch({ type: 'toggle_carousel' });
  };

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <SectionLabel icon={LayoutGrid}>{t('carouselLabel')}</SectionLabel>
          <Switch checked={isOn} onChange={toggle} aria-label={t('carouselLabel')} />
        </div>
        <p className="text-xs text-n-slate-10">{t('carouselHint')}</p>

        {isOn ? (
          <div className="flex flex-col gap-3">
            <div>
              <Label className="mb-1.5">{t('cardHeaderFormatLabel')}</Label>
              <div className="flex flex-wrap gap-1.5">
                {HEADER_FORMATS.map((fmt) => (
                  <button key={fmt} type="button" onClick={() => setSharedFormat(fmt)} className={segmentClass(sharedFormat === fmt)}>
                    {t(`hdr_${fmt}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {cards.map((_, i) => (
                <button
                  key={i} type="button" onClick={() => setActiveCard(i)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    active === i ? 'bg-n-brand text-white' : 'bg-n-alpha-2 text-n-slate-11 hover:bg-n-alpha-3'
                  }`}
                >
                  {t('cardN', { n: i + 1 })}
                </button>
              ))}
              <Button
                variant="faded" color="slate" size="xs" icon={PlusCircle}
                disabled={cards.length >= LIMITS.carouselCards}
                onClick={() => { dispatch({ type: 'carousel_add_card' }); setActiveCard(cards.length); }}
              >
                {t('addCard')}
              </Button>
            </div>

            {cards[active] ? (
              <CarouselCardEditor
                index={active}
                card={cards[active]}
                dispatch={dispatch}
                accountId={accountId}
                inboxId={inboxId}
                wabaCtx={wabaCtx}
                canRemove={cards.length > LIMITS.carouselCardsMin}
                onRemove={() => { dispatch({ type: 'carousel_remove_card', index: active }); setActiveCard(0); }}
                onDuplicate={() => duplicateCard(active)}
                t={t}
              />
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function LtoSection({ tpl, dispatch, t }) {
  const isOn = !!tpl.lto;
  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <SectionLabel icon={Timer}>{t('ltoLabel')}</SectionLabel>
          <Switch checked={isOn} onChange={() => dispatch({ type: 'toggle_lto' })} aria-label={t('ltoLabel')} />
        </div>
        <p className="text-xs text-n-slate-10">{t('ltoHint')}</p>
        {isOn ? (
          <>
            <Input
              label={t('ltoTextLabel')} value={tpl.lto.text} maxLength={LIMITS.ltoTitle}
              onChange={(e) => dispatch({ type: 'set_field', field: 'lto', value: { ...tpl.lto, text: e.target.value } })}
            />
            <label className="flex items-center gap-2 text-sm text-n-slate-12">
              <input
                type="checkbox" checked={tpl.lto.hasExpiration}
                onChange={(e) => dispatch({ type: 'set_field', field: 'lto', value: { ...tpl.lto, hasExpiration: e.target.checked } })}
                className="h-4 w-4 rounded border-n-weak"
              />
              {t('ltoHasExpirationLabel')}
            </label>
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}

// one_tap/zero_tap need Android package_name+signature_hash collection that
// serializeAuthComponents doesn't emit yet — Meta rejects them without it.
// Add those fields (and re-add the types here) when a client needs OTP autofill.
const OTP_TYPES = ['copy_code'];

function AuthSection({ tpl, dispatch, t }) {
  const auth = tpl.auth || {};
  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <div>
          <Label className="mb-1.5">{t('otpTypeLabel')}</Label>
          <div className="flex flex-col gap-1.5">
            {OTP_TYPES.map((v) => (
              <label key={v} className="flex items-center gap-2 text-sm text-n-slate-12">
                <input
                  type="radio" name="otpType" checked={auth.otpType === v}
                  onChange={() => dispatch({ type: 'set_auth', patch: { otpType: v } })}
                  className="h-4 w-4"
                />
                {t(`otp_${v}`)}
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-n-slate-12">
          <input
            type="checkbox" checked={!!auth.securityRecommendation}
            onChange={(e) => dispatch({ type: 'set_auth', patch: { securityRecommendation: e.target.checked } })}
            className="h-4 w-4 rounded border-n-weak"
          />
          {t('securityRecommendationLabel')}
        </label>
        <Input
          label={t('expirationMinutesLabel')} type="number" min={1} max={90}
          value={auth.expirationMinutes ?? ''}
          hint={t('expirationMinutesHint')}
          onChange={(e) => dispatch({ type: 'set_auth', patch: { expirationMinutes: e.target.value === '' ? '' : Number(e.target.value) } })}
        />
      </CardBody>
    </Card>
  );
}

function AdvancedAccordion({ tpl, dispatch, t }) {
  const [open, setOpen] = useState(false);
  const isAuth = tpl.category === 'AUTHENTICATION';
  const showTtl = tpl.category !== 'MARKETING';
  const showParamFormat = !isAuth;

  return (
    <Card>
      <button
        type="button" onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-5 py-4 text-start"
      >
        {/* Plain span, not <SectionLabel> — its <h3> is heading content, invalid inside a button. */}
        <span className="flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
          <Settings2 size={15} className="text-n-blue-11" aria-hidden="true" />
          {t('advancedLabel')}
        </span>
        <ChevronDown size={16} className={`text-n-slate-10 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open ? (
        <CardBody className="flex flex-col gap-4 border-t border-n-weak">
          {showParamFormat ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-n-slate-12">{t('parameterFormatLabel')}</p>
                <p className="text-xs text-n-slate-10">{t('parameterFormatHint')}</p>
              </div>
              <Switch
                checked={tpl.parameterFormat === 'NAMED'}
                onChange={(v) => dispatch({ type: 'set_field', field: 'parameterFormat', value: v ? 'NAMED' : 'POSITIONAL' })}
                aria-label={t('parameterFormatLabel')}
              />
            </div>
          ) : null}
          {showTtl ? (
            <Input
              label={t('ttlSecondsLabel')} type="number" min={30} value={tpl.ttlSeconds ?? ''}
              hint={t('ttlSecondsHint')}
              onChange={(e) => dispatch({ type: 'set_field', field: 'ttlSeconds', value: e.target.value === '' ? null : Number(e.target.value) })}
            />
          ) : null}
        </CardBody>
      ) : null}
    </Card>
  );
}

export default function TemplateBuilder({
  accountId,
  wabaCtx,
  initial = null,
  editTemplateId = null,
  existingTemplates = [],
  onDone,
  onCancel,
}) {
  const t = useT(M);
  const locale = useLocale();
  const [tpl, dispatch] = useReducer(builderReducer, null, () => (initial ? structuredClone(initial) : emptyTemplate()));
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');
  const [flows, setFlows] = useState([]);

  const inboxId = wabaCtx?.inboxes?.[0]?.inboxId;

  useEffect(() => {
    if (accountId == null || inboxId == null) { setFlows([]); return undefined; }
    let cancelled = false;
    listFlows(accountId, inboxId)
      .then((list) => { if (!cancelled) setFlows(Array.isArray(list) ? list : []); })
      .catch(() => { if (!cancelled) setFlows([]); });
    return () => { cancelled = true; };
  }, [accountId, inboxId]);

  const flowsReason = useMemo(() => {
    if (wabaCtx?.capabilities?.flows === false) {
      return (locale === 'he' ? wabaCtx.capabilities.reason_he : wabaCtx.capabilities.reason_en) || t('flowsUnavailable');
    }
    return t('noFlowsFound');
  }, [wabaCtx, locale, t]);

  const errors = useMemo(() => validateTemplate(tpl), [tpl]);
  const warnings = useMemo(() => warningsFor(tpl, existingTemplates), [tpl, existingTemplates]);

  const isAuth = tpl.category === 'AUTHENTICATION';
  const isCarousel = !!tpl.carousel;

  const handleSubmit = async () => {
    if (errors.length > 0 || submitting) return;
    setSubmitting(true);
    setServerError('');
    try {
      const serialized = serializeTemplate(tpl);
      if (editTemplateId) {
        const changes = { components: serialized.components };
        if (initial && tpl.category !== initial.category) changes.category = tpl.category;
        if (serialized.message_send_ttl_seconds != null) {
          changes.message_send_ttl_seconds = serialized.message_send_ttl_seconds;
        } else if (initial?.ttlSeconds != null) {
          // The original template had a TTL and the user cleared it in this edit. Meta's
          // contract: omitting message_send_ttl_seconds leaves the existing value untouched
          // on PATCH, so removing a TTL requires explicitly sending null. Not independently
          // confirmed against Meta's docs — if this assumption is wrong, the Graph API call
          // errors and that error surfaces verbatim via setServerError below.
          changes.message_send_ttl_seconds = null;
        }
        await editTemplate(accountId, inboxId, editTemplateId, changes);
      } else {
        await createTemplate(accountId, inboxId, serialized);
      }
      onDone?.();
    } catch (e) {
      setServerError(e.message || t('submitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardBody className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label={t('nameLabel')} value={tpl.name} dir="ltr" hint={t('nameHint')}
                  onChange={(e) => dispatch({ type: 'set_field', field: 'name', value: e.target.value })}
                />
                <Select
                  label={t('languageLabel')} value={tpl.language} dir="ltr"
                  options={LANGS.map((l) => ({ value: l, label: l }))}
                  onChange={(e) => dispatch({ type: 'set_field', field: 'language', value: e.target.value })}
                />
              </div>
              <div>
                <Label className="mb-1.5">{t('categoryLabel')}</Label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {CATEGORIES.map((cat) => (
                    <CategoryCard
                      key={cat} cat={cat} selected={tpl.category === cat} t={t}
                      onSelect={() => dispatch({ type: 'set_field', field: 'category', value: cat })}
                    />
                  ))}
                </div>
              </div>
            </CardBody>
          </Card>

          {isAuth ? (
            <AuthSection tpl={tpl} dispatch={dispatch} t={t} />
          ) : (
            <>
              {!isCarousel ? (
                <HeaderSection tpl={tpl} dispatch={dispatch} accountId={accountId} inboxId={inboxId} wabaCtx={wabaCtx} locale={locale} t={t} />
              ) : null}
              <BodySection tpl={tpl} dispatch={dispatch} t={t} />
              {!isCarousel ? (
                <>
                  <FooterSection tpl={tpl} dispatch={dispatch} t={t} />
                  <ButtonsSection tpl={tpl} dispatch={dispatch} flows={flows} flowsReason={flowsReason} t={t} />
                </>
              ) : null}
              <CarouselSection tpl={tpl} dispatch={dispatch} accountId={accountId} inboxId={inboxId} wabaCtx={wabaCtx} t={t} />
              {!isCarousel ? <LtoSection tpl={tpl} dispatch={dispatch} t={t} /> : null}
            </>
          )}

          <AdvancedAccordion tpl={tpl} dispatch={dispatch} t={t} />
        </div>

        <div className="flex flex-col gap-2 lg:sticky lg:top-4">
          <SectionLabel icon={Eye}>{t('previewLabel')}</SectionLabel>
          <div className="rounded-xl bg-n-alpha-1 p-4">
            <TemplatePreview tpl={tpl} />
          </div>
        </div>
      </div>

      <MessageStrip items={warnings} tone="amber" icon={AlertTriangle} locale={locale} />
      <MessageStrip items={errors} tone="ruby" icon={AlertCircle} locale={locale} />
      {serverError ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-n-ruby-7 bg-n-ruby-3 px-4 py-3 text-sm text-n-ruby-11">
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="whitespace-pre-wrap">{serverError}</span>
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-n-weak pt-4">
        <Button type="button" variant="ghost" color="slate" onClick={onCancel}>{t('cancel')}</Button>
        <Button type="submit" variant="solid" color="blue" loading={submitting} disabled={errors.length > 0 || submitting}>
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}
