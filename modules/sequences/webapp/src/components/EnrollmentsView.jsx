import { useCallback, useEffect, useMemo, useState } from 'react';
import { Users, RefreshCw, AlertCircle, Search, AlertTriangle, UserPlus, Settings2 } from 'lucide-react';
import Badge from './ui/Badge.jsx';
import Button from './ui/Button.jsx';
import Input from './ui/Input.jsx';
import Skeleton, { SkeletonCard, SkeletonRows } from './ui/Skeleton.jsx';
import { Table, THead, TBody, TR, TH, TD } from './ui/Table.jsx';
import { listEnrollments, listSequences } from '../api/sequencesApi.js';
import { deliveryErrorLabel } from '../lib/deliveryError.js';
import AssignSequenceModal from './AssignSequenceModal.jsx';

/*
 * EnrollmentsView — לוח מצב "איפה כל ליד עומד ומי נתקע".
 * נטען לפי account ומציג כרטיסי סיכום (פעילים/נתקעו/הושלמו/נעצרו/סה״כ),
 * סינון לפי סטטוס בלחיצה על כרטיס, וטבלת התקדמות לכל ליד
 * (טלפון / רצף / שלב X/Y + פס התקדמות / סטטוס + סיבת כשל / שליחה הבאה).
 * הנתקעים מוצגים ראשונים כדי שיקפצו לעין.
 */

const STATUS = {
  active: { label: 'פעיל', color: 'teal' },
  completed: { label: 'הושלם', color: 'blue' },
  stopped: { label: 'נעצר', color: 'slate' },
  failed: { label: 'נתקע', color: 'ruby' },
};

// כרטיסי הסיכום — סדר התצוגה והצבע לכל מצב (כולל "סה״כ" שמנקה סינון).
// "נתקעו" שני וב-ruby כדי שייבלוט — זה מה שצריך לטפל בו.
const SUMMARY_CARDS = [
  { key: 'active', label: 'פעילים', text: 'text-n-teal-11' },
  { key: 'failed', label: 'נתקעו', text: 'text-n-ruby-11' },
  { key: 'completed', label: 'הושלמו', text: 'text-n-blue-11' },
  { key: 'stopped', label: 'נעצרו', text: 'text-n-slate-12' },
  { key: 'total', label: 'סה״כ', text: 'text-n-blue-11' },
];

// סדר מיון לפי "דחיפות": נתקעים ראשונים, אז פעילים, אז השאר.
const STATUS_RANK = { failed: 0, active: 1, completed: 2, stopped: 3 };

export default function EnrollmentsView({ accountId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  // סינון לפי סטטוס (active/completed/stopped) — null = הכל
  const [statusFilter, setStatusFilter] = useState(null);
  // סדרות (לבורר בחלון השיוך)
  const [sequences, setSequences] = useState([]);
  // יעד שיוך: null = סגור · {} = הוספת ליד חדש · שורת-ליד = ניהול הליד הזה
  const [assignTarget, setAssignTarget] = useState(null);

  const load = useCallback(() => {
    if (accountId == null) return;
    setLoading(true);
    setError('');
    listEnrollments(accountId)
      .then(setRows)
      .catch((e) => setError(e.message || 'שגיאה בטעינת אנשי הקשר'))
      .finally(() => setLoading(false));
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  // סדרות לבורר — נטענות פעם אחת לכל חשבון
  useEffect(() => {
    if (accountId == null) return;
    listSequences(accountId).then(setSequences).catch(() => setSequences([]));
  }, [accountId]);

  // יעד השיוך כ-contact עבור החלון (שורת-ליד → איש קשר; {} → חיפוש ליד חדש)
  const assignContact =
    assignTarget && assignTarget.contact_id
      ? {
          contact_id: assignTarget.contact_id,
          name: assignTarget.contact_name,
          phone: assignTarget.phone,
          sequence: assignTarget.sequence_key,
        }
      : null;

  // החלון עצמו — מרונדר פעם אחת, זמין מכל מצב (כולל "אין אנשי קשר")
  const assignModal = (
    <AssignSequenceModal
      open={assignTarget != null}
      onClose={() => setAssignTarget(null)}
      accountId={accountId}
      sequences={sequences}
      contact={assignContact}
      onDone={load}
    />
  );

  // ספירות לפי סטטוס (לכרטיסי הסיכום)
  const counts = useMemo(() => {
    const c = { active: 0, completed: 0, stopped: 0, failed: 0, total: rows.length };
    for (const r of rows) {
      if (c[r.status] != null) c[r.status] += 1;
    }
    return c;
  }, [rows]);

  // סינון: קודם לפי סטטוס (אם נבחר), אז לפי טלפון / שם הרצף / מזהה הרצף.
  // מיון: נתקעים ראשונים (לפי STATUS_RANK), בתוך אותו דירוג — לפי סדר המקור.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (statusFilter && r.status !== statusFilter) return false;
        if (!q) return true;
        return (
          (r.phone || '').toLowerCase().includes(q) ||
          (r.contact_name || '').toLowerCase().includes(q) ||
          (r.sequence_name || '').toLowerCase().includes(q) ||
          (r.sequence_key || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9));
  }, [rows, query, statusFilter]);

  // לחיצה על כרטיס: "סה״כ" או הכרטיס הפעיל → ניקוי הסינון; אחרת סינון לסטטוס
  const onCardClick = (key) => {
    if (key === 'total') return setStatusFilter(null);
    setStatusFilter((cur) => (cur === key ? null : key));
  };

  if (loading) {
    return (
      <>
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <Skeleton className="mb-3 h-9 w-full rounded-lg sm:max-w-xs" />
        <SkeletonRows rows={5} cols={5} />
      </>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-n-ruby-7 bg-n-ruby-3 px-4 py-3 text-sm text-n-ruby-11">
        <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>{error}</span>
      </div>
    );
  }

  // אין אף ליד בכלל — מצב ריק עם פעולת הוספה
  if (!rows.length) {
    return (
      <>
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-n-strong bg-n-solid-2 py-16 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-n-brand/10 text-n-blue-11">
            <Users size={24} aria-hidden="true" />
          </span>
          <div>
            <p className="text-base font-medium text-n-slate-12">אין עדיין לידים בסדרות</p>
            <p className="mt-1 text-sm text-n-slate-11">
              הוסיפו ליד ושייכו אותו לסדרה — אפשר לבחור איש קשר קיים מהחשבון.
            </p>
          </div>
          <Button color="brand" icon={UserPlus} onClick={() => setAssignTarget({})}>
            הוסף ליד לסדרה
          </Button>
        </div>
        {assignModal}
      </>
    );
  }

  return (
    <>
      {/* כרטיסי סיכום — לחיצה מסננת את הטבלה לסטטוס */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {SUMMARY_CARDS.map((card) => {
          const isActiveFilter =
            card.key === 'total' ? statusFilter === null : statusFilter === card.key;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => onCardClick(card.key)}
              aria-pressed={isActiveFilter}
              className={`flex flex-col items-start rounded-xl bg-n-alpha-1 px-4 py-3 text-start transition-shadow hover:bg-n-alpha-2 ${
                isActiveFilter ? 'ring-2 ring-n-brand' : 'ring-1 ring-n-weak'
              }`}
            >
              <span className={`text-2xl font-semibold leading-none ${card.text}`}>
                {counts[card.key]}
              </span>
              <span className="mt-1 text-xs text-n-slate-11">{card.label}</span>
            </button>
          );
        })}
      </div>

      {/* באנר נתקעים — קופץ לעין כשיש כשלי מסירה; לחיצה מסננת אליהם */}
      {counts.failed > 0 && statusFilter !== 'failed' ? (
        <button
          type="button"
          onClick={() => setStatusFilter('failed')}
          className="mb-3 flex w-full items-center gap-2.5 rounded-xl border border-n-ruby-7 bg-n-ruby-3 px-4 py-2.5 text-start text-sm text-n-ruby-11 transition-colors hover:bg-n-ruby-4"
        >
          <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
          <span>
            <span className="font-semibold">{counts.failed}</span>{' '}
            {counts.failed === 1 ? 'ליד נתקע' : 'לידים נתקעו'} — ההודעה לא נמסרה. לחצו לצפייה.
          </span>
        </button>
      ) : null}

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:max-w-xs sm:flex-1">
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-3 text-n-slate-10"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש לפי טלפון או רצף…"
            aria-label="חיפוש אנשי קשר"
            className="ps-9"
          />
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm text-n-slate-11">
            <span className="font-medium text-n-slate-12">{filtered.length}</span>{' '}
            מתוך {rows.length}
          </p>
          <Button color="brand" size="sm" icon={UserPlus} onClick={() => setAssignTarget({})}>
            הוסף ליד
          </Button>
          <Button variant="ghost" color="slate" size="sm" icon={RefreshCw} onClick={load}>
            רענון
          </Button>
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-n-strong bg-n-solid-2 py-12 text-center text-sm text-n-slate-11">
          {statusFilter ? 'אין תוצאות לסינון' : 'לא נמצאו אנשי קשר התואמים לחיפוש.'}
        </div>
      ) : (
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>איש קשר</TH>
              <TH>רצף</TH>
              <TH>התקדמות</TH>
              <TH>סטטוס</TH>
              <TH>שליחה הבאה</TH>
              <TH><span className="sr-only">פעולות</span></TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((r, i) => {
            const st = STATUS[r.status] || { label: r.status, color: 'slate' };
            return (
              <TR key={`${r.conversation_id}-${i}`}>
                <TD>
                  {r.contact_name && !r.contact_name.includes('@') ? (
                    <span className="block text-sm text-n-slate-12">{r.contact_name}</span>
                  ) : null}
                  <span dir="ltr" className="block font-mono text-xs text-n-slate-11">
                    {r.phone || '—'}
                  </span>
                </TD>
                <TD>
                  <span className="text-n-slate-12">{r.sequence_name}</span>
                  <span className="mt-0.5 block font-mono text-xs text-n-slate-10">
                    {r.sequence_key}
                  </span>
                </TD>
                <TD>
                  <StepProgress
                    current={r.current_step}
                    total={r.total_steps}
                  />
                </TD>
                <TD>
                  <Badge color={st.color}>{st.label}</Badge>
                  {r.status === 'failed' ? (
                    <span
                      className="mt-1 block max-w-[16rem] text-xs leading-snug text-n-ruby-11"
                      title={r.last_error || ''}
                    >
                      {r.failed_step ? `שלב ${r.failed_step}: ` : ''}
                      {deliveryErrorLabel(r.last_error_code, r.last_error)}
                    </span>
                  ) : null}
                </TD>
                <TD>
                  <span className="text-sm text-n-slate-11">
                    {r.status === 'active' ? r.next_send_at || '—' : '—'}
                  </span>
                </TD>
                <TD>
                  <Button
                    variant="ghost"
                    color="slate"
                    size="sm"
                    icon={Settings2}
                    onClick={() => setAssignTarget(r)}
                  >
                    נהל
                  </Button>
                </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
      {assignModal}
    </>
  );
}

/*
 * StepProgress — "שלב X/Y" עם פס התקדמות דק.
 * track ב-bg-n-alpha-3, מילוי ב-bg-n-brand לפי היחס current/total.
 */
function StepProgress({ current, total }) {
  const cur = Number(current) || 0;
  const tot = Number(total) || 0;
  const pct = tot > 0 ? Math.min(100, Math.max(0, (cur / tot) * 100)) : 0;
  return (
    <div className="w-20">
      <span className="block text-xs text-n-slate-11">
        שלב {cur}/{tot}
      </span>
      <div className="mt-1 h-1.5 w-full rounded-full bg-n-alpha-3" aria-hidden="true">
        <div
          className="h-1.5 rounded-full bg-n-brand"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
