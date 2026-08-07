import { useState } from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown, CornerDownLeft, Flag } from 'lucide-react';
import { NODE_META } from './JourneyNodes.jsx';
import { ADDABLE_TYPES } from './graphModel.js';
import useT from '../../useT.js';

/*
 * JourneyColumn — עריכת הפלואו כטור כרטיסים, בדיוק כמו בונה המאקרו של Chatwoot
 * (settings/macros/MacroNodes.vue): שבב "תחילת הפלואו", כרטיסים בטור, קו מקווקו
 * ביניהם. ההבדל היחיד: צומת מסתעף (תנאי / כפתורים) פותח את המסלולים שלו כרשימה
 * מוזחת מתחתיו, במקום לדרוש קנבס.
 *
 * הרכיב לא מכיר קשתות — הוא מקבל steps מוכן (lib/journeyOutline.js) ומדווח על
 * פעולות כלפי מעלה. כל הכתיבה חזרה לגרף קורית ב-JourneyEditor.
 *
 * הזחה: כל הסתעפות מוזחת ברמה אחת. במסך צר זה נשאר טור אחד — אין גלילה אופקית
 * של הדף, ולכן הטור עובד גם היכן שהקנבס לא.
 */

const M = {
  he: {
    start: 'תחילת הפלואו',
    end: 'סוף הפלואו',
    addStep: 'הוספת צעד',
    addHere: 'הוספת צעד כאן',
    addToBranch: 'הוספת צעד למסלול {branch}',
    cancel: 'ביטול',
    moveUp: 'העברה למעלה: {label}',
    moveDown: 'העברה למטה: {label}',
    del: 'מחיקה: {label}',
    edit: 'עריכת {label}',
    confirmFork: 'מחיקת "{label}" תמחק גם את כל הצעדים שבמסלולים שלה. להמשיך?',
    yes: 'כן',
    no: 'לא',
    optN: 'אפשרות {n}',
    emptyBranch: 'אין צעדים במסלול הזה',
    rejoin: 'ממשיך למסלול המשותף',
    branchEnds: 'הפלואו מסתיים כאן',
    empty: '(ריק)',
    noSteps: 'עוד אין צעדים בפלואו. לחצו + כדי להוסיף את הראשון.',
    hasError: 'יש בעיה בצומת הזה',
    node_message: 'הודעה',
    node_private_reply: 'הודעה פרטית למגיב',
    node_template: 'תבנית וואטסאפ',
    node_question: 'שאלה',
    node_buttons: 'כפתורים',
    node_condition: 'תנאי',
    node_delay: 'השהיה',
    node_action: 'פעולות',
    node_webhook: 'Webhook',
    node_handoff: 'העברה לנציג',
    node_trigger: 'טריגר',
    op_eq: 'שווה ל-',
    op_contains: 'מכיל',
    op_exists: 'קיים',
    days: 'ימים',
    hours: 'שעות',
    minutes: 'דקות',
    noTemplate: 'לא נבחרה תבנית',
    toAgent: 'פתיחת השיחה לנציג',
    nActions: '{n} פעולות',
  },
  en: {
    start: 'Flow start',
    end: 'Flow end',
    addStep: 'Add step',
    addHere: 'Add a step here',
    addToBranch: 'Add a step to the {branch} path',
    cancel: 'Cancel',
    moveUp: 'Move up: {label}',
    moveDown: 'Move down: {label}',
    del: 'Delete: {label}',
    edit: 'Edit {label}',
    confirmFork: 'Deleting “{label}” also deletes every step inside its paths. Continue?',
    yes: 'Yes',
    no: 'No',
    optN: 'Option {n}',
    emptyBranch: 'No steps on this path',
    rejoin: 'Continues on the shared path',
    branchEnds: 'The flow ends here',
    empty: '(empty)',
    noSteps: 'This flow has no steps yet. Press + to add the first one.',
    hasError: 'This node has a problem',
    node_message: 'Message',
    node_private_reply: 'Private reply',
    node_template: 'WhatsApp template',
    node_question: 'Question',
    node_buttons: 'Buttons',
    node_condition: 'Condition',
    node_delay: 'Delay',
    node_action: 'Actions',
    node_webhook: 'Webhook',
    node_handoff: 'Handoff',
    node_trigger: 'Trigger',
    op_eq: 'equals',
    op_contains: 'contains',
    op_exists: 'exists',
    days: 'd',
    hours: 'h',
    minutes: 'm',
    noTemplate: 'No template selected',
    toAgent: 'Open the conversation to an agent',
    nActions: '{n} actions',
  },
};

// שורה אחת שמסכמת מה הצומת עושה — אותם שדות שהכרטיס בקנבס מראה.
function summaryOf(node, t) {
  const d = node?.data || {};
  switch (node?.type) {
    case 'message':
    case 'private_reply':
    case 'question':
    case 'buttons':
      return String(d.text || '').trim();
    case 'template':
      return String(d.name || '').trim() || t('noTemplate');
    case 'condition': {
      if (!String(d.field || '').trim()) return '';
      const op = t(`op_${d.op || 'eq'}`);
      return d.op === 'exists' ? `${d.field} ${op}` : `${d.field} ${op} "${d.value ?? ''}"`;
    }
    case 'delay': {
      const parts = [
        Number(d.days) ? `${Number(d.days)} ${t('days')}` : '',
        Number(d.hours) ? `${Number(d.hours)} ${t('hours')}` : '',
        Number(d.minutes) ? `${Number(d.minutes)} ${t('minutes')}` : '',
      ].filter(Boolean);
      return parts.join(' · ');
    }
    case 'action': {
      const n = (d.labels || []).length + (d.assigneeId || d.teamId ? 1 : 0) + (d.status ? 1 : 0) + (d.webhookUrl ? 1 : 0);
      return n ? t('nActions', { n }) : '';
    }
    case 'webhook':
      return String(d.url || '').trim();
    case 'handoff':
      return String(d.message || '').trim() || t('toAgent');
    default:
      return '';
  }
}

const CHIP_CLS = {
  teal: 'bg-n-teal-3 text-n-teal-11',
  blue: 'bg-n-brand/10 text-n-blue-11',
  violet: 'bg-n-violet-3 text-n-violet-11',
  amber: 'bg-n-amber-3 text-n-amber-11',
  iris: 'bg-n-iris-3 text-n-iris-11',
  ruby: 'bg-n-ruby-3 text-n-ruby-11',
  slate: 'bg-n-alpha-2 text-n-slate-11',
};

const PALETTE_CLS = {
  teal: 'bg-n-teal-3 text-n-teal-11 hover:bg-n-teal-4',
  blue: 'bg-n-brand/10 text-n-blue-11 hover:bg-n-brand/20',
  violet: 'bg-n-violet-3 text-n-violet-11 hover:bg-n-violet-4',
  amber: 'bg-n-amber-3 text-n-amber-11 hover:bg-n-amber-4',
  iris: 'bg-n-iris-3 text-n-iris-11 hover:bg-n-iris-4',
  ruby: 'bg-n-ruby-3 text-n-ruby-11 hover:bg-n-ruby-4',
  slate: 'bg-n-alpha-2 text-n-slate-11 hover:bg-n-alpha-3',
};

// הקו המקווקו שמחבר בין כרטיסים — כמו ב-MacroNodes.vue.
function Wire() {
  return <span aria-hidden="true" className="ms-3 block h-4 w-0 border-s border-dashed border-n-blue-7 dark:border-n-blue-11" />;
}

function Chip({ children }) {
  return (
    <span className="inline-block rounded-md bg-n-solid-blue px-1.5 py-1 text-sm leading-none text-n-blue-11">
      {children}
    </span>
  );
}

/* שורת ה-+ : לחיצה פותחת פלטת סוגים מוטמעת (בלי תפריט צף — עובד גם בצר). */
function AddRow({ open, onToggle, onPick, label, t }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={label}
          aria-expanded={open}
          onClick={onToggle}
          className="ms-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-n-strong bg-n-background text-n-slate-11 outline-none transition-colors hover:border-n-brand hover:text-n-brand focus-visible:outline-2 focus-visible:outline-n-brand focus-visible:outline-offset-1 motion-reduce:transition-none"
        >
          <Plus size={13} aria-hidden="true" />
        </button>
        {open ? (
          <span className="text-xs text-n-slate-11">{label}</span>
        ) : null}
      </div>
      {open ? (
        <div className="flex flex-wrap gap-1.5 rounded-lg border border-n-weak bg-n-solid-2 p-2">
          {ADDABLE_TYPES.map((type) => {
            const Icon = NODE_META[type].icon;
            return (
              <button
                key={type}
                type="button"
                onClick={() => onPick(type)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:outline-2 focus-visible:outline-n-brand focus-visible:outline-offset-1 motion-reduce:transition-none ${PALETTE_CLS[NODE_META[type].color]}`}
              >
                <Icon size={13} aria-hidden="true" />
                {t(`node_${type}`)}
              </button>
            );
          })}
          <button
            type="button"
            onClick={onToggle}
            className="rounded-lg px-2.5 py-1.5 text-xs text-n-slate-11 outline-none hover:text-n-slate-12 focus-visible:outline-2 focus-visible:outline-n-brand focus-visible:outline-offset-1"
          >
            {t('cancel')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Card({ node, type, selected, invalid, canUp, canDown, onSelect, onMove, onDelete, t }) {
  const meta = NODE_META[type] || NODE_META.message;
  const Icon = meta.icon;
  const label = t(`node_${type}`);
  const summary = node ? summaryOf(node, t) : '';
  const actionCls =
    'inline-flex h-6 w-6 items-center justify-center rounded-md text-n-slate-11 outline-none transition-colors hover:bg-n-alpha-2 hover:text-n-slate-12 focus-visible:outline-2 focus-visible:outline-n-brand focus-visible:outline-offset-1 disabled:opacity-30 disabled:pointer-events-none motion-reduce:transition-none';

  return (
    <div className="group flex items-center gap-1">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={t('edit', { label })}
        className={[
          // bg זהה ל-MacroNode.vue של Chatwoot — כרטיס בהיר על רקע הדף, כהה על solid-1.
          'flex min-w-0 grow items-center gap-2 rounded-md bg-n-background p-2 text-start shadow-sm outline outline-1 transition-colors dark:bg-n-solid-1 motion-reduce:transition-none',
          'focus-visible:outline-2 focus-visible:outline-n-brand focus-visible:outline-offset-1',
          selected ? 'outline-2 outline-n-brand' : invalid ? 'outline-n-ruby-8 bg-n-ruby-3' : 'outline-n-weak hover:outline-n-strong',
        ].join(' ')}
      >
        <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${CHIP_CLS[meta.color]}`}>
          <Icon size={13} aria-hidden="true" />
        </span>
        <span className="min-w-0 grow">
          <span className="block text-sm font-medium text-n-slate-12">{label}</span>
          <span className={`block truncate text-xs ${summary ? 'text-n-slate-11' : 'italic text-n-slate-10'}`}>
            {summary || t('empty')}
          </span>
        </span>
        {invalid ? (
          <span className="shrink-0 text-xxs font-medium text-n-ruby-11" title={t('hasError')}>!</span>
        ) : null}
      </button>
      {/* במסך צר הפעולות תמיד גלויות; במסך רחב הן נחשפות ב-hover/פוקוס */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity motion-reduce:transition-none md:opacity-0 md:focus-within:opacity-100 md:group-hover:opacity-100">
        <button type="button" className={actionCls} disabled={!canUp} aria-label={t('moveUp', { label })} onClick={() => onMove(-1)}>
          <ChevronUp size={14} aria-hidden="true" />
        </button>
        <button type="button" className={actionCls} disabled={!canDown} aria-label={t('moveDown', { label })} onClick={() => onMove(1)}>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`${actionCls} hover:bg-n-ruby-3 hover:text-n-ruby-11`}
          aria-label={t('del', { label })}
          onClick={onDelete}
        >
          <Trash2 size={13} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export default function JourneyColumn({
  steps = [],
  nodes = [],
  selectedId = null,
  errorIds = null,
  onSelect,
  onInsert,
  onDelete,
  onMove,
}) {
  const t = useT(M);
  const [openAdd, setOpenAdd] = useState(null); // מפתח שורת ה-+ הפתוחה (אחת בכל רגע)
  const byId = new Map(nodes.map((n) => [String(n.id), n]));

  const keyOf = (path, index) => `${path.map((p) => `${p.id}:${p.handle}`).join('/')}#${index}`;

  const branchLabel = (forkNode, handle) => {
    if (handle === 'yes') return t('yes');
    if (handle === 'no') return t('no');
    const opts = forkNode?.data?.options || [];
    const i = opts.findIndex((o) => `opt:${o?.id}` === handle);
    return String(opts[i]?.title || '').trim() || t('optN', { n: i + 1 });
  };

  const addRow = (path, index, label) => {
    const k = keyOf(path, index);
    return (
      <AddRow
        key={`add-${k}`}
        t={t}
        open={openAdd === k}
        label={label}
        onToggle={() => setOpenAdd((cur) => (cur === k ? null : k))}
        onPick={(type) => {
          setOpenAdd(null);
          onInsert({ path, index }, type);
        }}
      />
    );
  };

  // מחיקת צומת מסתעף מוחקת גם את הצעדים שבמסלולים שלו — רק דרכו הם נגישים.
  const confirmDelete = (step, label) => {
    const hasInner = (step.branches || []).some((b) => b.steps.length);
    if (hasInner && !window.confirm(t('confirmFork', { label }))) return;
    onDelete(step.id);
  };

  // רשימת צעדים אחת. hasTail — האם אחרי הבלוק הזה יש המשך משותף להציג בענפים.
  const renderList = (list, path, hasTail, addLabel) => (
    <div className="flex flex-col">
      {addRow(path, 0, addLabel)}
      {list.map((s, i) => {
        const node = byId.get(String(s.id));
        const tailAfter = i + 1 < list.length || hasTail;
        return (
          <div key={s.id} className="flex flex-col">
            <Wire />
            <Card
              node={node}
              type={s.type}
              t={t}
              selected={String(selectedId) === String(s.id)}
              invalid={!!errorIds?.has(String(s.id))}
              canUp={i > 0}
              canDown={i < list.length - 1}
              onSelect={() => onSelect(s.id)}
              onMove={(d) => onMove(s.id, d)}
              onDelete={() => confirmDelete(s, t(`node_${s.type}`))}
            />
            {s.branches ? (
              <div className="ms-3 mt-1 flex flex-col gap-2 border-s-2 border-n-strong ps-3">
                {s.branches.map((b) => {
                  const label = branchLabel(node, b.handle);
                  const inner = [...path, { id: s.id, handle: b.handle }];
                  return (
                    <div key={b.handle} className="flex flex-col gap-1">
                      <span className="text-xxs font-medium uppercase tracking-wide text-n-slate-11">{label}</span>
                      {b.steps.length ? null : (
                        <p className="m-0 text-xs italic text-n-slate-10">{t('emptyBranch')}</p>
                      )}
                      {renderList(b.steps, inner, tailAfter && !b.ends, t('addToBranch', { branch: label }))}
                      {b.ends ? (
                        <span className="inline-flex items-center gap-1 text-xxs text-n-slate-10">
                          <Flag size={10} aria-hidden="true" />
                          {t('branchEnds')}
                        </span>
                      ) : tailAfter ? (
                        <span className="inline-flex items-center gap-1 text-xxs text-n-slate-10">
                          <CornerDownLeft size={10} aria-hidden="true" />
                          {t('rejoin')}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
            <Wire />
            {addRow(path, i + 1, addLabel)}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="flex max-w-3xl flex-col gap-1">
      <Chip>{t('start')}</Chip>
      {steps.length ? null : <p className="mt-2 mb-0 text-sm text-n-slate-11">{t('noSteps')}</p>}
      <div className="mt-1.5">{renderList(steps, [], false, t('addHere'))}</div>
      <div className="mt-1.5">
        <Chip>{t('end')}</Chip>
      </div>
    </div>
  );
}
