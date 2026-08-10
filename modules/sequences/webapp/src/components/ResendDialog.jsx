import { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, UploadCloud, Loader2, CheckCircle2, X } from 'lucide-react';
import Modal from './ui/Modal.jsx';
import Button from './ui/Button.jsx';
import Input from './ui/Input.jsx';
import Skeleton from './ui/Skeleton.jsx';
import TemplatePicker from './ui/TemplatePicker.jsx';
import VariableRow from './ui/VariableRow.jsx';
import MessageBubble from './ui/MessageBubble.jsx';
import { listTemplates, uploadMedia } from '../api/sequencesApi.js';
import { validateWhatsAppMedia, acceptFor, formatBytes, WA_MEDIA } from '../lib/waMedia.js';
import useT from '../useT.js';
import { translate } from '../i18n.js';

/*
 * ResendDialog — אישור "שליחה מחדש לנכשלים", עם אפשרות לשלוח בתבנית *אחרת*.
 *
 * זה העיקר: כשמטא חוסמת אצווה שלמה (131049 וחבריו), שליחה חוזרת של אותה תבנית בדיוק
 * תיחסם שוב. הערך הוא בניסוי — אותם נמענים, תבנית אחרת (ניסוח UTILITY, בלי קישור, וכו').
 * לכן הבורר כאן הוא של תבנית מלאה: התבנית עצמה, ערכי המשתנים שלה, ומדיה לכותרת.
 *
 * ⚠️ הקצאת המשתנים היא לפי הטוקנים של עורך הרצפים ('@name' וכו'), והמרה ל-Liquid
 * ({{contact.name}}) קורית רק ברגע השליחה — כך MessageBubble מציג בדיוק את מה שהמנוע
 * ישלח, וה-engine מקבל את אותה צורה שיש לתבנית של הקמפיין המקורי.
 *
 * props: open, onClose, onConfirm(template|null), campaign, failedCount, tier, loading
 */

const M = {
  he: {
    title: 'שליחה מחדש לנכשלים',
    desc: 'ההודעה תישלח שוב ל-{n} נמענים שנכשלו. ההודעות יוצאות מיד, אחת אחרי השנייה, והדוח יתעדכן תוך כדי.',
    sameTpl: 'אותה תבנית', otherTpl: 'תבנית אחרת',
    sameHint: 'בדיוק מה שנשלח בפעם הראשונה — כולל ערכי המשתנים של הקמפיין',
    otherHint: 'ניסוי חדש: אותם נמענים, תבנית אחרת. התוצאות של כל ניסוי נשמרות בנפרד בדוח',
    pickTpl: 'התבנית שתישלח', noTemplates: 'לא נמצאו תבניות מאושרות למספר הזה',
    tplLoadFailed: 'לא הצלחנו לטעון את התבניות',
    varsTitle: 'ערכי המשתנים', noVars: 'התבנית לא דורשת משתנים',
    mediaTitle: 'הקובץ שיופיע בראש ההודעה ({label})',
    mediaImage: 'תמונה', mediaVideo: 'וידאו', mediaDocument: 'מסמך',
    mediaUploaded: 'הקובץ הועלה', replace: 'החלפה', remove: 'הסרה',
    uploading: 'מעלה…', dropHere: 'גרירה או לחיצה להעלאת {label}',
    sizeLimit: 'עד {max}', uploadFailed: 'ההעלאה נכשלה',
    pasteLink: 'או הדבקת קישור https',
    tierWarn: '⚠️ בתקציב היומי של המספר נותרו {left} הודעות בלבד — חלק מהשליחות עלולות להיכשל שוב.',
    needTpl: 'צריך לבחור תבנית', needVars: 'צריך למלא ערך לכל משתנה', needMedia: 'צריך להעלות קובץ לכותרת',
    send: 'שליחה', cancel: 'ביטול', preview: 'כך ההודעה תיראה ללקוח',
  },
  en: {
    title: 'Resend to failed recipients',
    desc: 'The message will be sent again to {n} failed recipients. Messages go out immediately, one after another, and the report updates as it runs.',
    sameTpl: 'Same template', otherTpl: 'A different template',
    sameHint: 'Exactly what went out the first time — including the campaign’s variable values',
    otherHint: 'A new experiment: same recipients, different template. Each experiment’s results are kept separately in the report',
    pickTpl: 'Template to send', noTemplates: 'No approved templates found for this number',
    tplLoadFailed: 'Could not load the templates',
    varsTitle: 'Variable values', noVars: 'This template requires no variables',
    mediaTitle: 'The file at the top of the message ({label})',
    mediaImage: 'image', mediaVideo: 'video', mediaDocument: 'document',
    mediaUploaded: 'File uploaded', replace: 'Replace', remove: 'Remove',
    uploading: 'Uploading…', dropHere: 'Drag or click to upload {label}',
    sizeLimit: 'up to {max}', uploadFailed: 'Upload failed',
    pasteLink: 'Or paste an https link',
    tierWarn: "⚠️ Only {left} messages remain in the number's daily budget — some sends may fail again.",
    needTpl: 'Choose a template', needVars: 'Fill in every variable', needMedia: 'Upload a file for the header',
    send: 'Send', cancel: 'Cancel', preview: 'This is what the customer sees',
  },
};

const VAR_RE = /\{\{\s*\d+\s*\}\}/g;
const MEDIA_FORMATS = new Set(['IMAGE', 'VIDEO', 'DOCUMENT']);
const MEDIA_LABEL_KEY = { IMAGE: 'mediaImage', VIDEO: 'mediaVideo', DOCUMENT: 'mediaDocument' };

// טוקן שדה-מערכת → משתנה Liquid של Chatwoot. זו בדיוק הצורה שבה קמפיין שומר את
// template_params, ולכן ה-engine מחליף אותה per-contact באותו מסלול בלי מקרה מיוחד.
const LIQUID = {
  '@first_name': '{{contact.first_name}}',
  '@name': '{{contact.name}}',
  '@phone': '{{contact.phone_number}}',
  '@email': '{{contact.email}}',
};

const countVars = (t) => {
  if (!t) return 0;
  if (typeof t.params_count === 'number') return t.params_count;
  return (String(t.body || '').match(VAR_RE) || []).length;
};
const mediaFormat = (t) => {
  const f = String(t?.header_format || '').toUpperCase();
  return MEDIA_FORMATS.has(f) ? f : null;
};

export default function ResendDialog({ open, onClose, onConfirm, campaign, failedCount, tier, loading = false, accountId }) {
  const t = useT(M);
  const [mode, setMode] = useState('same');
  const [templates, setTemplates] = useState(null); // null = טרם נטען
  const [tplError, setTplError] = useState('');
  const [tplName, setTplName] = useState('');
  const [params, setParams] = useState([]);
  const [mediaUrl, setMediaUrl] = useState('');
  const [error, setError] = useState('');

  // פתיחה נקייה בכל פעם — דיאלוג ששומר בחירה מהפעם הקודמת שולח הודעה שלא התכוונו אליה.
  useEffect(() => {
    if (!open) return;
    setMode('same'); setTplName(''); setParams([]); setMediaUrl(''); setError('');
  }, [open]);

  // התבניות של המספר שהקמפיין נשלח ממנו (לא של המספר שנבחר לחשבון היום).
  useEffect(() => {
    if (!open || mode !== 'other' || templates !== null || accountId == null) return;
    let alive = true;
    listTemplates(accountId, campaign?.inbox_id)
      .then((list) => { if (alive) setTemplates(list); })
      .catch(() => { if (alive) { setTemplates([]); setTplError(translate(M, 'tplLoadFailed')); } });
    return () => { alive = false; };
  }, [open, mode, templates, accountId, campaign?.inbox_id]);

  const tpl = useMemo(() => (templates || []).find((x) => x.name === tplName) || null, [templates, tplName]);
  const varCount = countVars(tpl);
  const format = mediaFormat(tpl);
  const examples = Array.isArray(tpl?.examples) ? tpl.examples : [];

  const pickTemplate = (name) => {
    const next = (templates || []).find((x) => x.name === name);
    setTplName(name);
    setError('');
    // ברירת מחדל שימושית: המשתנה הראשון הוא כמעט תמיד השם הפרטי.
    setParams(Array.from({ length: countVars(next) }, (_, i) => (i === 0 ? '@first_name' : '')));
    // "זיכרון מדיה" — הקישור שכבר שימש את התבנית הזו בעבר, כדי לא להעלות שוב.
    setMediaUrl(mediaFormat(next) ? String(next?.media_url || '') : '');
  };

  const submit = () => {
    if (mode === 'same') { onConfirm(null); return; }
    if (!tpl) { setError(translate(M, 'needTpl')); return; }
    if (params.slice(0, varCount).some((v) => String(v || '').trim() === '')) {
      setError(translate(M, 'needVars')); return;
    }
    if (format && !/^https:\/\/\S+/i.test(String(mediaUrl).trim())) {
      setError(translate(M, 'needMedia')); return;
    }
    onConfirm({
      name: tpl.name,
      language: tpl.language,
      params: Object.fromEntries(
        params.slice(0, varCount).map((v, i) => [String(i + 1), LIQUID[v] ?? v])
      ),
      mediaUrl: format ? String(mediaUrl).trim() : null,
    });
  };

  const footer = (
    <div className="flex w-full items-center justify-between gap-3">
      <Button variant="faded" color="slate" className="w-full" onClick={onClose} disabled={loading}>{t('cancel')}</Button>
      <Button variant="solid" color="blue" className="w-full" icon={RotateCcw} onClick={submit} loading={loading}>{t('send')}</Button>
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title={t('title')} size="2xl" footer={footer} closeOnOverlay={!loading}>
      <p className="mt-0 text-sm leading-relaxed text-n-slate-11">{translate(M, 'desc', { n: failedCount })}</p>

      {/* בחירת מסלול — אותה תבנית או ניסוי חדש */}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {[
          { key: 'same', label: t('sameTpl'), hint: t('sameHint'), extra: campaign?.template_name },
          { key: 'other', label: t('otherTpl'), hint: t('otherHint') },
        ].map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => { setMode(o.key); setError(''); }}
            aria-pressed={mode === o.key}
            className={`rounded-xl px-3 py-2.5 text-start transition-colors ${
              mode === o.key ? 'bg-n-brand/10 ring-1 ring-n-brand' : 'bg-n-alpha-1 ring-1 ring-n-weak hover:bg-n-alpha-2'
            }`}
          >
            <span className="block text-sm font-medium text-n-slate-12">
              {o.label}{o.extra ? <span className="font-normal text-n-slate-11"> · {o.extra}</span> : null}
            </span>
            <span className="mt-0.5 block text-xs text-n-slate-11">{o.hint}</span>
          </button>
        ))}
      </div>

      {mode === 'other' ? (
        <div className="mt-4 flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-n-slate-12" htmlFor="resend-tpl">{t('pickTpl')}</label>
            {templates === null ? (
              <Skeleton className="h-10 w-full rounded-lg" />
            ) : templates.length === 0 ? (
              <p className="text-xs text-n-ruby-11">{tplError || t('noTemplates')}</p>
            ) : (
              <TemplatePicker id="resend-tpl" templates={templates} value={tplName} onChange={pickTemplate} />
            )}
          </div>

          {tpl ? (
            <>
              <div>
                <p className="mb-1.5 text-sm font-medium text-n-slate-12">{t('varsTitle')}</p>
                {varCount === 0 ? (
                  <p className="m-0 text-xs text-n-slate-11">{t('noVars')}</p>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {Array.from({ length: varCount }, (_, i) => (
                      <VariableRow
                        key={i}
                        index={i}
                        value={params[i] ?? ''}
                        example={examples[i] != null ? String(examples[i]) : ''}
                        onChange={(v) => setParams((p) => { const n = [...p]; n[i] = v; return n; })}
                      />
                    ))}
                  </div>
                )}
              </div>

              {format ? (
                <MediaField format={format} value={mediaUrl} accountId={accountId} onChange={setMediaUrl} />
              ) : null}

              <div>
                <p className="mb-1.5 text-xs text-n-slate-11">{t('preview')}</p>
                <MessageBubble template={tpl} params={params} mediaUrl={mediaUrl} />
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="mb-0 mt-3 text-xs font-medium text-n-ruby-11">{error}</p> : null}

      {tier && !tier.unlimited && tier.remaining < failedCount ? (
        <p className="mb-0 mt-3 rounded-lg bg-n-amber-3 px-3 py-2 text-xs text-n-amber-11">
          {translate(M, 'tierWarn', { left: tier.remaining })}
        </p>
      ) : null}
    </Modal>
  );
}

/*
 * MediaField — העלאת הקובץ לכותרת התבנית.
 * ponytail: בלי דחיסת וידאו בדפדפן (שיש בעורך הרצפים) — כאן בוחרים תבנית קיימת,
 * שברוב המקרים כבר מגיעה עם קישור מוכר מ"זיכרון המדיה". וידאו מעל התקרה של מטא ייחסם
 * בוולידציה עם הסבר; מי שצריך המרה יעלה אותו פעם אחת דרך עורך הרצפים.
 */
function MediaField({ format, value, accountId, onChange }) {
  const t = useT(M);
  const label = t(MEDIA_LABEL_KEY[format] || 'mediaDocument');
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const inputRef = useRef(null);
  const trimmed = String(value || '').trim();
  const valid = /^https:\/\/\S+/i.test(trimmed);

  const handleFile = async (file) => {
    if (!file) return;
    setErr('');
    const v = validateWhatsAppMedia({ format, mime: file.type, byteSize: file.size });
    if (!v.ok) { setErr(v.error); return; }
    setUploading(true);
    try {
      const res = await uploadMedia(file, format, accountId);
      onChange(res.url);
    } catch (e) {
      setErr(e.message || translate(M, 'uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="rounded-lg border border-n-amber-7 bg-n-amber-3 px-3 py-2.5">
      <p className="mb-2 text-sm font-medium text-n-amber-12">{translate(M, 'mediaTitle', { label })}</p>
      {valid ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-n-teal-7 bg-n-teal-3 px-3 py-2">
          <span className="flex min-w-0 items-center gap-2 text-sm text-n-teal-11">
            <CheckCircle2 size={16} className="shrink-0" aria-hidden="true" />
            <span className="truncate">{t('mediaUploaded')}</span>
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => inputRef.current?.click()} className="text-xs font-medium text-n-blue-11 hover:underline">{t('replace')}</button>
            <button type="button" onClick={() => onChange('')} aria-label={t('remove')} className="text-n-slate-10 hover:text-n-ruby-11"><X size={15} /></button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); if (!uploading) handleFile(e.dataTransfer?.files?.[0]); }}
          onClick={() => !uploading && inputRef.current?.click()}
          onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !uploading) inputRef.current?.click(); }}
          role="button"
          tabIndex={0}
          aria-disabled={uploading || undefined}
          className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-n-amber-7 bg-n-alpha-1 px-3 py-4 text-center outline-none focus-visible:border-n-brand ${uploading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-n-alpha-2'}`}
        >
          {uploading ? (
            <>
              <Loader2 size={20} className="animate-spin text-n-blue-11" aria-hidden="true" />
              <span className="text-sm text-n-slate-11">{t('uploading')}</span>
            </>
          ) : (
            <>
              <UploadCloud size={22} className="text-n-amber-11" aria-hidden="true" />
              <span className="text-sm font-medium text-n-slate-12">{translate(M, 'dropHere', { label })}</span>
              <span className="text-xs text-n-slate-10">{translate(M, 'sizeLimit', { max: formatBytes(WA_MEDIA[format]?.maxBytes || 0) })}</span>
            </>
          )}
        </div>
      )}
      <input ref={inputRef} type="file" accept={acceptFor(format)} className="hidden" onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }} />
      {err ? <p className="mb-0 mt-1.5 text-xs font-medium text-n-ruby-11">{err}</p> : null}
      {!valid ? (
        <Input
          className="mt-2"
          type="url"
          dir="ltr"
          value={value || ''}
          placeholder={t('pasteLink')}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : null}
    </div>
  );
}
