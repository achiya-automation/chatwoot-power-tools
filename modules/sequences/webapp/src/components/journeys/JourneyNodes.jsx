import { Handle, Position } from '@xyflow/react';
import {
  Zap,
  MessageSquare,
  HelpCircle,
  MousePointerClick,
  GitFork,
  Clock,
  SlidersHorizontal,
  Webhook,
  UserRound,
  Paperclip,
} from 'lucide-react';
import useT, { useLocale } from '../../useT.js';
import { dirFor } from '../../i18n.js';

/*
 * JourneyNodes — the custom React Flow node components (canvas cards).
 * Flow direction is vertical (target handle on top, source on bottom) — the
 * canvas itself is LTR (React Flow coordinates), node content renders RTL.
 *
 * Header colors follow the approved design board, n-* tokens only.
 * NOTE: this webapp's token set has NO green scale (slate/iris/blue/ruby/amber/
 * teal/gray/violet only) — teal IS Chatwoot's success-green, so trigger uses
 * teal and action (teal on the board) moved to iris to stay distinct.
 */

const M = {
  he: {
    trigger: 'טריגר',
    message: 'הודעה',
    question: 'שאלה',
    buttons: 'כפתורים',
    condition: 'תנאי',
    delay: 'השהיה',
    action: 'פעולות',
    webhook: 'Webhook',
    handoff: 'העברה לנציג',
    triggerHint: 'נקודת ההתחלה — לחצו להגדרת הטריגר',
    empty: '(ריק)',
    yes: 'כן',
    no: 'לא',
    optionsCount: '{n} אפשרויות',
    saveToChip: 'שמירה אל: {key}',
    exists: 'קיים',
    contains: 'מכיל',
    eq: 'שווה ל-',
    days: 'ימים',
    hours: 'שעות',
    minutes: 'דקות',
    labelsChip: '{n} תוויות',
    assignChip: 'שיוך',
    statusChip: 'סטטוס: {status}',
    webhookChip: 'קריאת webhook',
    openConv: 'פתיחת השיחה לנציג',
  },
  en: {
    trigger: 'Trigger',
    message: 'Message',
    question: 'Question',
    buttons: 'Buttons',
    condition: 'Condition',
    delay: 'Delay',
    action: 'Actions',
    webhook: 'Webhook',
    handoff: 'Handoff',
    triggerHint: 'Start point — click to configure the trigger',
    empty: '(empty)',
    yes: 'Yes',
    no: 'No',
    optionsCount: '{n} options',
    saveToChip: 'Save to: {key}',
    exists: 'exists',
    contains: 'contains',
    eq: 'equals',
    days: 'd',
    hours: 'h',
    minutes: 'm',
    labelsChip: '{n} labels',
    assignChip: 'Assign',
    statusChip: 'Status: {status}',
    webhookChip: 'Webhook call',
    openConv: 'Open conversation to agent',
  },
};

// Palette metadata (shared with the editor toolbar). Color names are keys of HEADER_CLS.
export const NODE_META = {
  trigger: { icon: Zap, color: 'teal' },
  message: { icon: MessageSquare, color: 'blue' },
  question: { icon: HelpCircle, color: 'violet' },
  buttons: { icon: MousePointerClick, color: 'violet' },
  condition: { icon: GitFork, color: 'amber' },
  delay: { icon: Clock, color: 'slate' },
  action: { icon: SlidersHorizontal, color: 'iris' },
  webhook: { icon: Webhook, color: 'slate' },
  handoff: { icon: UserRound, color: 'ruby' },
};

// Static class strings so Tailwind's scanner sees every token.
const HEADER_CLS = {
  teal: 'bg-n-teal-3 text-n-teal-11',
  blue: 'bg-n-brand/10 text-n-blue-11',
  violet: 'bg-n-violet-3 text-n-violet-11',
  amber: 'bg-n-amber-3 text-n-amber-11',
  iris: 'bg-n-iris-3 text-n-iris-11',
  ruby: 'bg-n-ruby-3 text-n-ruby-11',
  slate: 'bg-n-alpha-2 text-n-slate-11',
};

const HANDLE_CLS = '!h-2.5 !w-2.5 !rounded-full !bg-n-slate-8 !border-2 !border-n-background';

// One-line preview of free text inside a node card.
function Snippet({ text, fallback }) {
  const s = String(text || '').trim();
  return s ? (
    <p className="m-0 truncate text-xs text-n-slate-11">{s.length > 70 ? `${s.slice(0, 70)}…` : s}</p>
  ) : (
    <p className="m-0 text-xs italic text-n-slate-10">{fallback}</p>
  );
}

function KeyChip({ children }) {
  return (
    <span className="inline-flex max-w-full items-center truncate rounded bg-n-alpha-2 px-1.5 py-0.5 font-mono text-[10px] text-n-slate-11">
      {children}
    </span>
  );
}

/*
 * Shared card shell. handles: 'both' (default) | 'source' (trigger) |
 * 'target' (handoff — terminal) | 'condition' (two labeled sources).
 */
function NodeShell({ type, selected, handles = 'both', children }) {
  const t = useT(M);
  const locale = useLocale();
  const meta = NODE_META[type] || NODE_META.message;
  const Icon = meta.icon;
  return (
    <div
      dir={dirFor(locale)}
      className={[
        'w-56 rounded-lg bg-n-background shadow-sm transition-shadow',
        selected ? 'border-2 border-n-brand shadow-md' : 'border border-n-strong',
      ].join(' ')}
    >
      {handles !== 'source' ? (
        <Handle type="target" position={Position.Top} className={HANDLE_CLS} />
      ) : null}
      <div
        className={`flex items-center gap-1.5 rounded-t-md px-2.5 py-1.5 text-xs font-semibold ${HEADER_CLS[meta.color]}`}
      >
        <Icon size={13} aria-hidden="true" />
        <span>{t(type)}</span>
      </div>
      <div className="flex flex-col gap-1 px-2.5 py-2">{children}</div>
      {handles === 'condition' ? (
        <>
          {/* LTR row so the labels sit under the fixed 25%/75% handle positions */}
          <div dir="ltr" className="flex justify-between px-6 pb-1.5 text-[10px] font-medium">
            <span className="text-n-teal-11">{t('yes')}</span>
            <span className="text-n-ruby-11">{t('no')}</span>
          </div>
          <Handle type="source" id="yes" position={Position.Bottom} style={{ left: '25%' }} className={HANDLE_CLS} />
          <Handle type="source" id="no" position={Position.Bottom} style={{ left: '75%' }} className={HANDLE_CLS} />
        </>
      ) : handles !== 'target' ? (
        <Handle type="source" position={Position.Bottom} className={HANDLE_CLS} />
      ) : null}
    </div>
  );
}

function TriggerNode({ selected }) {
  const t = useT(M);
  return (
    <NodeShell type="trigger" selected={selected} handles="source">
      <p className="m-0 text-xs text-n-slate-11">{t('triggerHint')}</p>
    </NodeShell>
  );
}

function MessageNode({ data, selected }) {
  const t = useT(M);
  return (
    <NodeShell type="message" selected={selected}>
      <Snippet text={data?.text} fallback={t('empty')} />
      {data?.mediaUrl ? (
        <span className="inline-flex items-center gap-1 text-[10px] text-n-slate-10">
          <Paperclip size={10} aria-hidden="true" />
          {String(data.mediaUrl).slice(0, 40)}
        </span>
      ) : null}
    </NodeShell>
  );
}

function QuestionNode({ data, selected }) {
  const t = useT(M);
  return (
    <NodeShell type="question" selected={selected}>
      <Snippet text={data?.text} fallback={t('empty')} />
      {data?.saveTo?.key ? <KeyChip>{t('saveToChip', { key: data.saveTo.key })}</KeyChip> : null}
    </NodeShell>
  );
}

function ButtonsNode({ data, selected }) {
  const t = useT(M);
  const n = (data?.options || []).length;
  return (
    <NodeShell type="buttons" selected={selected}>
      <Snippet text={data?.text} fallback={t('empty')} />
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[10px] text-n-slate-10">{t('optionsCount', { n })}</span>
        {data?.saveTo?.key ? <KeyChip>{data.saveTo.key}</KeyChip> : null}
      </div>
    </NodeShell>
  );
}

function ConditionNode({ data, selected }) {
  const t = useT(M);
  const op = data?.op === 'exists' ? t('exists') : data?.op === 'contains' ? t('contains') : t('eq');
  return (
    <NodeShell type="condition" selected={selected} handles="condition">
      {data?.field ? (
        <p className="m-0 truncate text-xs text-n-slate-11">
          <span className="font-mono">{data.field}</span> {op}
          {data?.op !== 'exists' ? <span className="font-mono"> "{String(data?.value ?? '')}"</span> : null}
        </p>
      ) : (
        <p className="m-0 text-xs italic text-n-slate-10">{t('empty')}</p>
      )}
    </NodeShell>
  );
}

function DelayNode({ data, selected }) {
  const t = useT(M);
  const parts = [
    Number(data?.days) ? `${Number(data.days)} ${t('days')}` : '',
    Number(data?.hours) ? `${Number(data.hours)} ${t('hours')}` : '',
    Number(data?.minutes) ? `${Number(data.minutes)} ${t('minutes')}` : '',
  ].filter(Boolean);
  return (
    <NodeShell type="delay" selected={selected}>
      <p className="m-0 text-xs text-n-slate-11">{parts.length ? parts.join(' · ') : t('empty')}</p>
    </NodeShell>
  );
}

function ActionNode({ data, selected }) {
  const t = useT(M);
  const chips = [
    (data?.labels || []).length ? t('labelsChip', { n: data.labels.length }) : '',
    data?.assigneeId || data?.teamId ? t('assignChip') : '',
    data?.status ? t('statusChip', { status: data.status }) : '',
    data?.webhookUrl ? t('webhookChip') : '',
  ].filter(Boolean);
  return (
    <NodeShell type="action" selected={selected}>
      {chips.length ? (
        <div className="flex flex-wrap gap-1">
          {chips.map((c) => (
            <KeyChip key={c}>{c}</KeyChip>
          ))}
        </div>
      ) : (
        <p className="m-0 text-xs italic text-n-slate-10">{t('empty')}</p>
      )}
    </NodeShell>
  );
}

function WebhookNode({ data, selected }) {
  const t = useT(M);
  return (
    <NodeShell type="webhook" selected={selected}>
      <Snippet text={data?.url} fallback={t('empty')} />
      {data?.saveResponseTo ? <KeyChip>{t('saveToChip', { key: data.saveResponseTo })}</KeyChip> : null}
    </NodeShell>
  );
}

function HandoffNode({ data, selected }) {
  const t = useT(M);
  return (
    <NodeShell type="handoff" selected={selected} handles="target">
      <Snippet text={data?.message} fallback={t('openConv')} />
    </NodeShell>
  );
}

// Registered once at module level — React Flow requires a stable reference.
export const nodeTypes = {
  trigger: TriggerNode,
  message: MessageNode,
  question: QuestionNode,
  buttons: ButtonsNode,
  condition: ConditionNode,
  delay: DelayNode,
  action: ActionNode,
  webhook: WebhookNode,
  handoff: HandoffNode,
};
