import { useMemo, useState } from 'react';
import {
  AlertCircle,
  Flag,
  GripVertical,
  PlusCircle,
  Route,
  Trash2,
} from 'lucide-react';
import Button from '../ui/Button.jsx';
import Select from '../ui/Select.jsx';
import Inspector from './Inspector.jsx';
import { ADDABLE_TYPES } from './graphModel.js';
import { forkHandlesOf } from '../../lib/journeyOutline.js';
import useT from '../../useT.js';

/*
 * JourneyColumn is deliberately built from Chatwoot's native macro grammar:
 * a start chip, inline action cards, dashed vertical connectors, a teal add
 * button, and an end chip. Journey-only abilities live inside that grammar:
 * conditions and button answers open nested macro paths; an old free-form
 * graph is edited as the same card list with explicit "continue to" fields.
 * There is no canvas and no alternate map view.
 */

const M = {
  he: {
    start: 'תחילת הפלואו',
    end: 'סוף הפלואו',
    addStep: 'הוספת צעד',
    addToBranch: 'הוספת צעד למסלול {branch}',
    moveHint: 'גרירה לשינוי סדר. אפשר להשתמש גם בחצים למעלה ולמטה.',
    del: 'מחיקת {label}',
    yes: 'כן',
    no: 'לא',
    optN: 'אפשרות {n}',
    path: 'מסלול: {branch}',
    branchEnds: 'הפלואו מסתיים במסלול הזה',
    branchContinuation: 'מה קורה בסוף המסלול',
    branchContinue: 'חזרה להמשך המשותף',
    branchStop: 'סיום הפלואו במסלול הזה',
    noSteps: 'עוד אין צעדים בפלואו.',
    hasError: 'יש בעיה בצעד הזה',
    routeTitle: 'המשך הפלואו',
    routeDefault: 'המשך רגיל',
    routeYes: 'אם כן',
    routeNo: 'אם לא',
    routeOption: 'בלחיצה על „{option}”',
    routeLegacy: 'חיבור ישן ({handle})',
    routeDuplicate: '{label} — חיבור {n}',
    routeUnknown: 'ללא שם',
    firstStep: 'הצעד הראשון',
    routeEnd: '— סוף הפלואו —',
    stepTarget: 'צעד {n}: {label}',
    stepType: 'סוג הצעד',
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
  },
  en: {
    start: 'Flow start',
    end: 'Flow end',
    addStep: 'Add step',
    addToBranch: 'Add a step to the {branch} path',
    moveHint: 'Drag to reorder. The up and down arrow keys work too.',
    del: 'Delete {label}',
    yes: 'Yes',
    no: 'No',
    optN: 'Option {n}',
    path: '{branch} path',
    branchEnds: 'The flow ends on this path',
    branchContinuation: 'End of path behavior',
    branchContinue: 'Return to the shared continuation',
    branchStop: 'End the flow on this path',
    noSteps: 'This flow has no steps yet.',
    hasError: 'This step has a problem',
    routeTitle: 'Flow continuation',
    routeDefault: 'Default continuation',
    routeYes: 'When yes',
    routeNo: 'When no',
    routeOption: 'When “{option}” is selected',
    routeLegacy: 'Legacy connection ({handle})',
    routeDuplicate: '{label} — connection {n}',
    routeUnknown: 'unnamed',
    firstStep: 'First step',
    routeEnd: '— End flow —',
    stepTarget: 'Step {n}: {label}',
    stepType: 'Step type',
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
  },
};

function Wire({ short = false }) {
  return (
    <span
      aria-hidden="true"
      className={`ms-6 block w-0 border-s border-dashed border-n-blue-7 dark:border-n-blue-11 ${short ? 'h-4' : 'h-8'}`}
    />
  );
}

function FlowChip({ children }) {
  return (
    <span className="inline-flex min-h-6 w-fit items-center rounded-md bg-n-solid-blue px-1.5 py-1 text-sm leading-none text-n-blue-11">
      {children}
    </span>
  );
}

function AddControl({ label, onAdd }) {
  return (
    <Button variant="solid" color="teal" size="sm" icon={PlusCircle} onClick={onAdd}>
      {label}
    </Button>
  );
}

function branchLabel(node, handle, t) {
  if (handle === 'yes') return t('yes');
  if (handle === 'no') return t('no');
  const options = node?.data?.options || [];
  const index = options.findIndex((option) => `opt:${option?.id}` === handle);
  return String(options[index]?.title || '').trim() || t('optN', { n: index + 1 });
}

function routeLabel(node, handle, t) {
  if (handle === 'yes') return t('routeYes');
  if (handle === 'no') return t('routeNo');
  if (handle == null) return t('routeDefault');
  return t('routeOption', { option: branchLabel(node, handle, t) });
}

function targetDetail(node) {
  const data = node?.data || {};
  const value = node?.type === 'template'
    ? data.name
    : node?.type === 'condition'
      ? data.field
      : node?.type === 'webhook'
        ? data.url
        : node?.type === 'delay'
          ? [data.days && `${data.days}d`, data.hours && `${data.hours}h`, data.minutes && `${data.minutes}m`].filter(Boolean).join(' ')
          : data.text || data.message;
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  return clean.length > 34 ? `${clean.slice(0, 33)}…` : clean;
}

function targetLabel(node, index, t) {
  const type = t(`node_${node.type}`);
  const detail = targetDetail(node);
  const identity = String(node.id || '').slice(-8);
  return `${t('stepTarget', { n: index + 1, label: type })}${detail ? ` — ${detail}` : ''} · #${identity}`;
}

function RouteEditor({ node, nodes, edges, onRoute, t }) {
  if (!node) return null;
  const handles = forkHandlesOf(node);
  const expected = node.type === 'handoff'
    ? []
    : handles
      ? (node.type === 'buttons' ? [null, ...handles] : handles)
      : [null];
  const outgoing = edges.filter((edge) => String(edge.source) === String(node.id));
  const rows = [];

  for (const handle of expected) {
    const matches = outgoing.filter(
      (edge) => String(edge.sourceHandle ?? '') === String(handle ?? '')
    );
    if (!matches.length) rows.push({ handle, edge: null, index: 1 });
    else matches.forEach((edge, index) => rows.push({ handle, edge, index: index + 1, duplicate: matches.length > 1 }));
  }
  const legacyEdges = outgoing.filter((edge) => !expected.some(
    (handle) => String(handle ?? '') === String(edge.sourceHandle ?? '')
  ));
  const legacyCounts = new Map();
  for (const edge of legacyEdges) {
    const signature = String(edge.sourceHandle ?? '');
    legacyCounts.set(signature, (legacyCounts.get(signature) || 0) + 1);
  }
  const legacySeen = new Map();
  for (const edge of legacyEdges) {
    const signature = String(edge.sourceHandle ?? '');
    const index = (legacySeen.get(signature) || 0) + 1;
    legacySeen.set(signature, index);
    rows.push({
      handle: edge.sourceHandle ?? null,
      edge,
      legacy: true,
      index,
      duplicate: legacyCounts.get(signature) > 1,
    });
  }
  if (!rows.length) return null;

  // Old map-built flows could contain self-routes. The runtime stops a repeated
  // node safely, so this editor keeps every such route visible and editable.
  const targets = nodes.filter((candidate) => candidate.type !== 'trigger');
  const options = [
    { value: '', label: t('routeEnd') },
    ...targets.map((target, index) => ({
      value: String(target.id),
      label: targetLabel(target, index, t),
    })),
  ];

  return (
    <div className="mt-4 border-t border-n-weak pt-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-n-slate-11">
        <Route size={13} aria-hidden="true" />
        {t('routeTitle')}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {rows.map(({ handle, edge, index, duplicate, legacy }) => {
          const baseLabel = legacy
            ? t('routeLegacy', { handle: handle ?? t('routeUnknown') })
            : routeLabel(node, handle, t);
          const label = duplicate ? t('routeDuplicate', { label: baseLabel, n: index }) : baseLabel;
          return (
            <Select
              key={edge?.id || `missing-${handle ?? 'default'}`}
              label={label}
              value={edge?.target || ''}
              options={options}
              onChange={(event) => onRoute({
                source: node.id,
                sourceHandle: handle,
                edgeId: edge?.id || null,
                target: event.target.value || null,
              })}
            />
          );
        })}
      </div>
    </div>
  );
}

function MacroNodeCard({
  node,
  index,
  total,
  invalid,
  dragging,
  dragTarget,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onMove,
  onDelete,
  onChangeType,
  patchNode,
  meta,
  fieldSuggestions,
  vars,
  accountId,
  routeEditor,
  typeOptions,
  t,
}) {
  const label = t(`node_${node?.type || 'message'}`);
  const canMove = total > 1;

  return (
    <div
      id={`journey-node-${node.id}`}
      className={`relative flex w-full min-w-0 items-start ${dragging ? 'opacity-45' : ''} ${dragTarget ? `before:absolute before:start-0 before:end-0 before:h-0.5 before:bg-n-brand ${dragTarget === 'after' ? 'before:-bottom-2' : 'before:-top-2'}` : ''}`}
      onDragOver={(event) => {
        if (!canMove) return;
        event.preventDefault();
        onDragOver();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
    >
      {canMove ? (
        <button
          type="button"
          draggable
          aria-label={t('moveHint')}
          title={t('moveHint')}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', String(node.id));
            onDragStart();
          }}
          onDragEnd={onDragEnd}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' && index > 0) {
              event.preventDefault();
              onMove(-1);
            }
            if (event.key === 'ArrowDown' && index < total - 1) {
              event.preventDefault();
              onMove(1);
            }
          }}
          className="me-1 inline-flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-md text-n-slate-11 outline-none hover:bg-n-alpha-2 hover:text-n-slate-12 focus-visible:outline-2 focus-visible:outline-n-brand focus-visible:outline-offset-1 active:cursor-grabbing lg:absolute lg:top-1 lg:-start-10 lg:me-0"
        >
          <GripVertical size={16} aria-hidden="true" />
        </button>
      ) : null}

      <div
        className={`min-w-0 grow rounded-md bg-n-background p-2 shadow-sm outline outline-1 dark:bg-n-solid-1 ${invalid ? 'bg-n-ruby-3 outline-n-ruby-8 dark:outline-n-ruby-8' : 'outline-n-weak'}`}
      >
        <div className="mb-3 flex items-center gap-2">
          <Select
            aria-label={t('stepType')}
            value={node.type}
            options={typeOptions}
            containerClassName="min-w-0 w-full sm:w-64"
            className="h-8 font-medium"
            onChange={(event) => onChangeType(event.target.value)}
          />
          {invalid ? (
            <AlertCircle size={15} className="ms-auto shrink-0 text-n-ruby-11" aria-label={t('hasError')} />
          ) : null}
        </div>
        <Inspector
          embedded
          node={node}
          patchNode={patchNode}
          removeNode={onDelete}
          meta={meta}
          fieldSuggestions={fieldSuggestions}
          vars={vars}
          accountId={accountId}
        />
        {routeEditor}
      </div>

      <Button
        variant="faded"
        color="ruby"
        size="sm"
        iconOnly
        icon={Trash2}
        className="ms-2"
        aria-label={t('del', { label })}
        onClick={onDelete}
      />
    </div>
  );
}

export default function JourneyColumn({
  steps = null,
  nodes = [],
  edges = [],
  errorIds = null,
  onInsert,
  onDelete,
  onMove,
  onMoveTo,
  onRawInsert,
  onRawDelete,
  onRawMove,
  onRoute,
  onChangeType,
  onSetBranchEnds,
  patchNode,
  meta,
  fieldSuggestions = [],
  vars = [],
  accountId,
}) {
  const t = useT(M);
  const [drag, setDrag] = useState(null);
  const [dragTarget, setDragTarget] = useState(null);
  const byId = useMemo(() => new Map(nodes.map((node) => [String(node.id), node])), [nodes]);
  const triggerNode = nodes.find((node) => node.type === 'trigger') || null;
  const typeOptions = useMemo(
    () => ADDABLE_TYPES.map((type) => ({ value: type, label: t(`node_${type}`) })),
    [t]
  );

  const keyOf = (path) => path.map((part) => `${part.id}:${part.handle}`).join('/') || 'root';

  const addControl = (path, index, label, raw = false) => {
    return (
      <AddControl
        label={label}
        onAdd={() => {
          // MacroForm appends one default action immediately; the type select in
          // the new card is where the user changes it.
          if (raw) onRawInsert('message');
          else onInsert({ path, index }, 'message');
        }}
      />
    );
  };

  const cardProps = (node, index, total, pathKey, handlers = {}) => ({
    node,
    index,
    total,
    invalid: !!errorIds?.has(String(node.id)),
    dragging: drag?.id === String(node.id) && drag?.pathKey === pathKey,
    dragTarget: dragTarget?.index === index && dragTarget?.pathKey === pathKey ? dragTarget.side : null,
    onDragStart: () => setDrag({ id: String(node.id), pathKey, index }),
    onDragEnd: () => {
      setDrag(null);
      setDragTarget(null);
    },
    onDragOver: () => {
      if (drag?.pathKey === pathKey && drag.id !== String(node.id)) {
        setDragTarget({ pathKey, index, side: drag.index < index ? 'after' : 'before' });
      }
    },
    onDrop: () => {
      if (drag?.pathKey === pathKey && drag.id !== String(node.id)) handlers.moveTo?.(drag.id, index);
      setDrag(null);
      setDragTarget(null);
    },
    onMove: handlers.move,
    onDelete: handlers.remove,
    onChangeType: (type) => onChangeType(node.id, type),
    patchNode,
    meta,
    fieldSuggestions,
    vars,
    accountId,
    routeEditor: handlers.routeEditor || null,
    typeOptions,
    t,
  });

  const renderStructuredList = (list, path = [], hasTail = false, addLabel = t('addStep')) => {
    const pathKey = keyOf(path);
    return (
      <div className="flex flex-col">
        {list.map((step, index) => {
          const node = byId.get(String(step.id));
          if (!node) return null;
          const tailAfter = index + 1 < list.length || hasTail;
          return (
            <div key={step.id}>
              <MacroNodeCard
                {...cardProps(node, index, list.length, pathKey, {
                  move: (delta) => onMove(step.id, delta),
                  moveTo: (id, targetIndex) => onMoveTo(id, targetIndex),
                  remove: () => onDelete(step.id),
                })}
              />
              {step.branches ? (
                <div className="ms-2 mt-5 flex flex-col gap-6 border-s border-dashed border-n-blue-7 ps-2 dark:border-n-blue-11 sm:ms-4 sm:ps-4 lg:ms-6 lg:ps-6">
                  {step.branches.map((branch) => {
                    const label = branchLabel(node, branch.handle, t);
                    const innerPath = [...path, { id: step.id, handle: branch.handle }];
                    return (
                      <section key={branch.handle} aria-label={t('path', { branch: label })}>
                        <FlowChip>{t('path', { branch: label })}</FlowChip>
                        <Wire short />
                        {renderStructuredList(
                          branch.steps,
                          innerPath,
                          tailAfter && !branch.ends,
                          t('addToBranch', { branch: label })
                        )}
                        <Wire short />
                        {tailAfter ? (
                          <Select
                            aria-label={t('branchContinuation')}
                            value={branch.ends ? 'end' : 'continue'}
                            options={[
                              { value: 'continue', label: t('branchContinue') },
                              { value: 'end', label: t('branchStop') },
                            ]}
                            containerClassName="w-full sm:max-w-xs"
                            className="h-8"
                            onChange={(event) => onSetBranchEnds(
                              step.id,
                              branch.handle,
                              event.target.value === 'end'
                            )}
                          />
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-n-slate-10">
                            <Flag size={11} aria-hidden="true" />
                            {t('branchEnds')}
                          </span>
                        )}
                      </section>
                    );
                  })}
                </div>
              ) : null}
              <Wire />
            </div>
          );
        })}
        {addControl(path, list.length, addLabel)}
      </div>
    );
  };

  const renderFreeRoutes = () => {
    const rawNodes = nodes.filter((node) => node.type !== 'trigger');
    const targetOptions = [
      { value: '', label: t('routeEnd') },
      ...rawNodes.map((node, index) => ({
        value: String(node.id),
        label: targetLabel(node, index, t),
      })),
    ];
    const triggerEdges = triggerNode
      ? edges.filter((edge) => String(edge.source) === String(triggerNode.id))
      : [];
    const startRows = triggerEdges.length ? triggerEdges : [null];

    return (
      <>
        <div className="mb-5 grid max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
          {startRows.map((edge, index) => (
            <Select
              key={edge?.id || 'missing-start'}
              label={startRows.length > 1
                ? t('routeDuplicate', { label: t('firstStep'), n: index + 1 })
                : t('firstStep')}
              value={edge?.target || ''}
              options={targetOptions}
              onChange={(event) => onRoute({
                source: triggerNode?.id || 'trigger',
                sourceHandle: edge?.sourceHandle ?? null,
                edgeId: edge?.id || null,
                target: event.target.value || null,
              })}
            />
          ))}
        </div>
        {rawNodes.map((node, index) => (
          <div key={node.id}>
            <MacroNodeCard
              {...cardProps(node, index, rawNodes.length, 'raw', {
                move: (delta) => onRawMove(node.id, index + delta),
                moveTo: (id, targetIndex) => onRawMove(id, targetIndex),
                remove: () => onRawDelete(node.id),
                routeEditor: (
                  <RouteEditor node={node} nodes={rawNodes} edges={edges} onRoute={onRoute} t={t} />
                ),
              })}
            />
            <Wire />
          </div>
        ))}
        {addControl([], rawNodes.length, t('addStep'), true)}
      </>
    );
  };

  return (
    <div className="w-full max-w-[800px]">
      <FlowChip>{t('start')}</FlowChip>
      <Wire />
      {nodes.filter((node) => node.type !== 'trigger').length ? null : (
        <p className="mb-3 mt-0 text-sm text-n-slate-11">{t('noSteps')}</p>
      )}
      {steps ? renderStructuredList(steps) : renderFreeRoutes()}
      <Wire />
      <FlowChip>{t('end')}</FlowChip>
    </div>
  );
}
