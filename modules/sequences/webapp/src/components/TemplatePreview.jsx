import {
  Image as ImageIcon,
  Video,
  FileText,
  MapPin,
  Link as LinkIcon,
  Phone,
  CornerUpLeft,
  Copy,
  ClipboardList,
  ShoppingBag,
  Timer,
} from 'lucide-react';
import useT from '../useT.js';

/*
 * TemplatePreview — live WhatsApp-style bubble render of the Builder's in-progress state
 * (the exact templateRules.emptyTemplate() shape — NOT the graph/API shape). Mirrors the
 * bubble tokens already used by SequencePreview.jsx (via MessageBubble/ChatBubble): teal
 * bubble, rounded-2xl, n-tokens only. Pure render — no dispatch, no editing here.
 */

// Co-located dictionary (he/en) — chrome only; template content itself is never translated.
const M = {
  he: {
    mediaImage: 'תמונה', mediaVideo: 'וידאו', mediaDocument: 'מסמך', mediaLocation: 'מיקום',
    mediaAttached: 'הועלה',
    emptyHint: 'ההודעה תוצג כאן',
    ltoPlaceholder: 'טקסט המבצע',
    ltoExpires: 'עם ספירה לאחור',
    authIsYourCode: 'הוא קוד האימות שלך.',
    authSecurityLine: 'מטעמי אבטחה, אין לשתף קוד זה עם אף אחד.',
    authExpiresIn: 'הקוד יפוג בעוד {n} דקות.',
    btnCopyCode: 'העתקת קוד',
    btnViewCatalog: 'צפייה בקטלוג',
  },
  en: {
    mediaImage: 'Image', mediaVideo: 'Video', mediaDocument: 'Document', mediaLocation: 'Location',
    mediaAttached: 'uploaded',
    emptyHint: 'Your message will appear here',
    ltoPlaceholder: 'Offer text',
    ltoExpires: 'with countdown',
    authIsYourCode: 'is your verification code.',
    authSecurityLine: 'For your security, do not share this code.',
    authExpiresIn: 'This code expires in {n} minutes.',
    btnCopyCode: 'Copy code',
    btnViewCatalog: 'View catalog',
  },
};

const BUBBLE_SHELL =
  'w-full max-w-sm rounded-2xl rounded-ss-md border border-n-teal-5/50 bg-n-teal-3 px-3.5 py-2.5 text-n-slate-12 shadow-sm';
const CARD_SHELL =
  'w-48 shrink-0 rounded-xl border border-n-teal-5/50 bg-n-teal-3 px-3 py-2.5 text-n-slate-12 shadow-sm';

const MEDIA_LABEL_KEY = { IMAGE: 'mediaImage', VIDEO: 'mediaVideo', DOCUMENT: 'mediaDocument' };
const MEDIA_ICON = { IMAGE: ImageIcon, VIDEO: Video, DOCUMENT: FileText };
const BUTTON_ICON = {
  URL: LinkIcon,
  PHONE_NUMBER: Phone,
  VOICE_CALL: Phone,
  QUICK_REPLY: CornerUpLeft,
  COPY_CODE: Copy,
  FLOW: ClipboardList,
  CATALOG: ShoppingBag,
  MPM: ShoppingBag,
};

// Replaces {{n}} / {{name}} with the matching example — falls back to the raw token when
// there's no example yet, so an unfinished template still previews legibly.
function fillVars(text, examples) {
  const ex = Array.isArray(examples) ? examples : [];
  return String(text || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (whole, token) => {
    if (/^\d+$/.test(token)) {
      const v = ex[Number(token) - 1];
      return v != null && String(v) !== '' ? String(v) : whole;
    }
    const found = ex.find((e) => e && e.param_name === token);
    const v = found?.example;
    return v != null && String(v) !== '' ? String(v) : whole;
  });
}

// Header supports at most one variable, filled from the single `example` string.
function fillHeaderVar(text, example) {
  return String(text || '').replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/, (whole) => (example ? example : whole));
}

// WhatsApp mini-markdown: *bold* _italic_ ~strike~ ```mono```. Single-pass, non-nested —
// matches WhatsApp's own renderer. Built as React nodes, never dangerouslySetInnerHTML.
const FORMAT_RE = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|```[^`\n]+```)/g;

function renderFormattedText(text) {
  const parts = String(text || '').split(FORMAT_RE).filter((p) => p !== '');
  return parts.map((part, i) => {
    if (part.startsWith('```') && part.endsWith('```') && part.length >= 6) {
      return (
        <code key={i} className="rounded bg-n-alpha-2 px-1 font-mono text-[0.9em]">
          {part.slice(3, -3)}
        </code>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      return <strong key={i} className="font-semibold">{part.slice(1, -1)}</strong>;
    }
    if (part.startsWith('_') && part.endsWith('_') && part.length >= 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('~') && part.endsWith('~') && part.length >= 2) {
      return <s key={i}>{part.slice(1, -1)}</s>;
    }
    return <span key={i}>{part}</span>;
  });
}

function HeaderBlock({ header, t }) {
  const h = header || { format: 'NONE' };
  if (!h.format || h.format === 'NONE') return null;
  if (h.format === 'TEXT') {
    if (!h.text) return null;
    return <p className="mb-1 whitespace-pre-wrap font-semibold leading-snug">{fillHeaderVar(h.text, h.example)}</p>;
  }
  if (h.format === 'LOCATION') {
    return (
      <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-n-alpha-2 px-2.5 py-3 text-xs text-n-slate-11">
        <MapPin size={16} aria-hidden="true" />
        {t('mediaLocation')}
      </div>
    );
  }
  const Icon = MEDIA_ICON[h.format];
  if (!Icon) return null;
  return (
    <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-n-alpha-2 px-2.5 py-3 text-xs text-n-slate-11">
      <Icon size={16} aria-hidden="true" />
      {t(MEDIA_LABEL_KEY[h.format])}
      {h.mediaHandle ? ` · ${t('mediaAttached')}` : ''}
    </div>
  );
}

function BodyText({ text, examples, emptyHint }) {
  if (!text) return emptyHint ? <p className="text-[13px] text-n-slate-10">{emptyHint}</p> : null;
  return (
    <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
      {renderFormattedText(fillVars(text, examples))}
    </p>
  );
}

function FooterText({ footer }) {
  if (!footer) return null;
  return <p className="mt-2 whitespace-pre-wrap text-[11px] leading-snug text-n-slate-10">{footer}</p>;
}

function LtoBanner({ lto, t }) {
  if (!lto) return null;
  return (
    <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-n-amber-7 bg-n-amber-3 px-2.5 py-2 text-xs font-medium text-n-amber-12">
      <Timer size={14} className="shrink-0 text-n-amber-11" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{lto.text || t('ltoPlaceholder')}</span>
      {lto.hasExpiration ? <span className="shrink-0 text-[10px] text-n-amber-11">{t('ltoExpires')}</span> : null}
    </div>
  );
}

function buttonLabel(b, t) {
  if (b.type === 'COPY_CODE') return t('btnCopyCode');
  if (b.type === 'CATALOG' || b.type === 'MPM') return b.text || t('btnViewCatalog');
  return b.text || '—';
}

function ButtonsList({ buttons, t }) {
  const list = Array.isArray(buttons) ? buttons : [];
  if (list.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-n-teal-6/40 pt-2">
      {list.map((b, i) => {
        const Icon = BUTTON_ICON[b.type] || CornerUpLeft;
        return (
          <span
            key={i}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-n-alpha-1 px-2 py-1.5 text-center text-xs font-medium text-n-blue-11"
          >
            <Icon size={13} aria-hidden="true" />
            {buttonLabel(b, t)}
          </span>
        );
      })}
    </div>
  );
}

function StandardBubble({ tpl, t }) {
  return (
    <div className={BUBBLE_SHELL}>
      <HeaderBlock header={tpl.header} t={t} />
      <BodyText text={tpl.body?.text} examples={tpl.body?.examples} emptyHint={t('emptyHint')} />
      <FooterText footer={tpl.footer} />
      <LtoBanner lto={tpl.lto} t={t} />
      <ButtonsList buttons={tpl.buttons} t={t} />
    </div>
  );
}

function CarouselRow({ carousel, t }) {
  const cards = (carousel && carousel.cards) || [];
  if (cards.length === 0) return null;
  return (
    <div className="mt-1.5 flex gap-2 overflow-x-auto pb-1">
      {cards.map((card, i) => (
        <div key={i} className={CARD_SHELL}>
          <HeaderBlock header={{ format: card.headerFormat, mediaHandle: card.mediaHandle }} t={t} />
          <BodyText text={card.body} examples={card.examples} />
          <ButtonsList buttons={card.buttons} t={t} />
        </div>
      ))}
    </div>
  );
}

function AuthBubble({ tpl, t }) {
  const auth = tpl.auth || {};
  return (
    <div className={BUBBLE_SHELL}>
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed">
        <strong className="font-mono font-semibold tracking-wider" dir="ltr">••••••</strong> {t('authIsYourCode')}
      </p>
      {auth.securityRecommendation ? (
        <p className="mt-1 text-[13px] leading-relaxed">{t('authSecurityLine')}</p>
      ) : null}
      <p className="mt-2 text-[11px] text-n-slate-10">
        {t('authExpiresIn', { n: auth.expirationMinutes ?? 10 })}
      </p>
      <div className="mt-2 flex flex-col gap-1 border-t border-n-teal-6/40 pt-2">
        <span className="flex items-center justify-center gap-1.5 rounded-lg bg-n-alpha-1 px-2 py-1.5 text-center text-xs font-medium text-n-blue-11">
          <Copy size={13} aria-hidden="true" />
          {t('btnCopyCode')}
        </span>
      </div>
    </div>
  );
}

export default function TemplatePreview({ tpl }) {
  const t = useT(M);
  if (!tpl) return null;

  if (tpl.category === 'AUTHENTICATION') return <AuthBubble tpl={tpl} t={t} />;

  if (tpl.carousel) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className={BUBBLE_SHELL}>
          <BodyText text={tpl.body?.text} examples={tpl.body?.examples} emptyHint={t('emptyHint')} />
        </div>
        <LtoBanner lto={tpl.lto} t={t} />
        <CarouselRow carousel={tpl.carousel} t={t} />
      </div>
    );
  }

  return <StandardBubble tpl={tpl} t={t} />;
}
