import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Pencil,
  Copy,
  Trash2,
  Layers,
  Users,
  MessageCircle,
  User,
  AlertCircle,
  Search,
  BarChart3,
  Tag,
  Megaphone,
} from 'lucide-react';
import Button from './components/ui/Button.jsx';
import Switch from './components/ui/Switch.jsx';
import Badge from './components/ui/Badge.jsx';
import Modal from './components/ui/Modal.jsx';
import Input from './components/ui/Input.jsx';
import Skeleton, { SkeletonRows } from './components/ui/Skeleton.jsx';
import {
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
} from './components/ui/Table.jsx';
import SequenceEditor from './components/SequenceEditor.jsx';
import EnrollmentsView from './components/EnrollmentsView.jsx';
import OverviewView from './components/OverviewView.jsx';
import ConversationStatus from './components/ConversationStatus.jsx';
import BulkEnrollModal from './components/BulkEnrollModal.jsx';
import CampaignsView from './components/CampaignsView.jsx';
import CampaignDetailView from './components/CampaignDetailView.jsx';
import useChatwootContext from './useChatwootContext.js';
import {
  listSequences,
  saveSequence,
  deleteSequence,
  listTemplates,
} from './api/sequencesApi.js';
import { makeEmptySequence } from './data/mockSequences.js';
import { resolveAccountId, isEmbedded, isSideNav } from './config.js';
import useT, { useLocale } from './useT.js';
import { dirFor, translate } from './i18n.js';

/*
 * App — ממשק ניהול רצפי drip ב-WhatsApp.
 * דו-לשוני (he/en), עיצוב זהה ל-Chatwoot v4 (n-tokens בלבד).
 *
 * הנתונים נטענים מ-n8n "Drip — API" (ראה src/api/sequencesApi.js) לפי
 * ה-account שמזוהה מה-Dashboard App context או מ-?account_id ב-URL.
 */

// מילון co-located (he/en) — משותף לרכיבי המשנה בקובץ (ContextBanner / EmptyState).
const M = {
  he: {
    tab_overview: 'סקירה',
    tab_sequences: 'רצפים',
    tab_contacts: 'אנשי קשר',
    tab_campaigns: 'קמפיינים',
    appTitle: 'רצפי WhatsApp',
    subtitle: 'ניהול רצפי הודעות אוטומטיים (drip)',
    subtitleFull: 'ניהול רצפי הודעות אוטומטיים (drip) ללקוחות',
    activeSuffix: 'פעילים מתוך {total}',
    assignByLabel: 'שיוך לפי תווית',
    newSequence: 'רצף חדש',
    waitingAccount: 'ממתין לזיהוי החשבון מ-Chatwoot…',
    searchPlaceholder: 'חיפוש לפי שם או מזהה…',
    searchAria: 'חיפוש רצפים',
    ofTotal: 'מתוך {total}',
    noMatch: 'לא נמצאו רצפים התואמים לחיפוש.',
    colName: 'שם הרצף',
    colStatus: 'סטטוס',
    colSteps: 'שלבים',
    colStop: 'עצירה בתגובה',
    colActions: 'פעולות',
    enrollTitle: 'צירוף לידים חדשים לרצף. כיבוי = לא נכנסים חדשים; מי שכבר ברצף ממשיך.',
    enrollAria: 'כניסות חדשות לרצף {name}',
    enrollLabel: 'כניסות',
    sendTitle: 'שליחת הודעות למי שכבר ברצף. כיבוי = הרצפים הפעילים נעצרים; הפעלה ממשיכה מאותו שלב.',
    sendAria: 'שליחת הודעות לרצף {name}',
    sendLabel: 'הודעות',
    on: 'מופעל',
    off: 'כבוי',
    editAria: 'עריכת {name}',
    duplicateAria: 'שכפול {name}',
    deleteAria: 'מחיקת {name}',
    deleteTitle: 'מחיקת רצף',
    cancel: 'ביטול',
    delete: 'מחיקה',
    deleteConfirmPrefix: 'למחוק את הרצף',
    deleteConfirmSuffix: '? פעולה זו אינה ניתנת לשחזור.',
    conversation: 'שיחה',
    contact: 'איש קשר',
    agentLabel: 'סוכן:',
    emptyTitle: 'אין רצפים עדיין',
    emptyBody:
      'רצף שולח סדרת הודעות וואטסאפ אוטומטית לאורך זמן. למשל: "תודה" מיד אחרי הצילום, שאלה כעבור יומיים, והפניה להמלצה כעבור שבוע — כל איש קשר שתשייכו מקבל אותן לפי הזמנים שתקבעו.',
    copySuffix: '(עותק)',
    errLoad: 'שגיאה בטעינת הרצפים',
    errStatus: 'עדכון הסטטוס נכשל',
    errDelete: 'המחיקה נכשלה',
  },
  en: {
    tab_overview: 'Overview',
    tab_sequences: 'Sequences',
    tab_contacts: 'Contacts',
    tab_campaigns: 'Campaigns',
    appTitle: 'WhatsApp Sequences',
    subtitle: 'Manage automated (drip) message sequences',
    subtitleFull: 'Manage automated (drip) message sequences for your customers',
    activeSuffix: 'active of {total}',
    assignByLabel: 'Assign by label',
    newSequence: 'New sequence',
    waitingAccount: 'Waiting for account detection from Chatwoot…',
    searchPlaceholder: 'Search by name or ID…',
    searchAria: 'Search sequences',
    ofTotal: 'of {total}',
    noMatch: 'No sequences match your search.',
    colName: 'Sequence name',
    colStatus: 'Status',
    colSteps: 'Steps',
    colStop: 'Stop on reply',
    colActions: 'Actions',
    enrollTitle: 'Enroll new leads into the sequence. Off = no new entries; anyone already in the sequence keeps going.',
    enrollAria: 'New enrollments for {name}',
    enrollLabel: 'Enrollments',
    sendTitle: 'Send messages to those already in the sequence. Off = active sequences pause; turning it on resumes from the same step.',
    sendAria: 'Send messages for {name}',
    sendLabel: 'Messages',
    on: 'On',
    off: 'Off',
    editAria: 'Edit {name}',
    duplicateAria: 'Duplicate {name}',
    deleteAria: 'Delete {name}',
    deleteTitle: 'Delete sequence',
    cancel: 'Cancel',
    delete: 'Delete',
    deleteConfirmPrefix: 'Delete the sequence',
    deleteConfirmSuffix: '? This action cannot be undone.',
    conversation: 'Conversation',
    contact: 'Contact',
    agentLabel: 'Agent:',
    emptyTitle: 'No sequences yet',
    emptyBody:
      'A sequence sends a series of WhatsApp messages automatically over time. For example: a "thank you" right after the shoot, a question two days later, and a review request a week later — every contact you enroll receives them on the schedule you set.',
    copySuffix: '(copy)',
    errLoad: 'Failed to load sequences',
    errStatus: 'Failed to update status',
    errDelete: 'Delete failed',
  },
};

export default function App() {
  const t = useT(M);
  const locale = useLocale(); // כיוון (rtl/ltr) ריאקטיבי
  const dir = dirFor(locale);

  const [sequences, setSequences] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // עורך
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSequence, setEditingSequence] = useState(null);

  // מחיקה — אישור
  const [deleteTarget, setDeleteTarget] = useState(null);

  // שיוך המוני לפי תווית
  const [bulkOpen, setBulkOpen] = useState(false);

  // חיפוש ברשימת הרצפים (שם / key)
  const [query, setQuery] = useState('');

  // טאב פעיל: סקירה (ברירת מחדל) / רצפים / אנשי קשר.
  // נשמר ב-localStorage כדי שריענון העמוד יישאר באותו טאב; ?tab= גובר (deep-link).
  const [view, setView] = useState(() => {
    const valid = (v) => v === 'contacts' || v === 'sequences' || v === 'overview' || v === 'campaigns';
    const t = new URLSearchParams(window.location.search).get('tab');
    if (valid(t)) return t;
    try {
      const saved = localStorage.getItem('drip_view');
      if (valid(saved)) return saved;
    } catch { /* ignore */ }
    return 'overview';
  });

  const [campaignId, setCampaignId] = useState(null); // קמפיין נבחר לצלילה (null = רשימה)

  // שמירת הטאב הפעיל — כדי שריענון לא יחזיר לסקירה
  useEffect(() => {
    try { localStorage.setItem('drip_view', view); } catch { /* ignore */ }
  }, [view]);

  // החלפת טאב מהסיידבר של Chatwoot (postMessage מה-injector) — מעבר חלק בלי reload
  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return; // same-origin embed בלבד
      const d = e?.data;
      if (d && typeof d === 'object' && d.type === 'drip-nav'
          && (d.tab === 'overview' || d.tab === 'sequences' || d.tab === 'contacts' || d.tab === 'campaigns')) {
        setView(d.tab);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // context מ-Chatwoot (כשרצים כ-Dashboard App)
  const { conversation, contact, agent, isEmbedded: inIframe } = useChatwootContext();
  const [accountId, setAccountId] = useState(() => resolveAccountId(null));

  // מצב מוטמע (?embed=1) — מציגים כותרת בסגנון Chatwoot במקום הכותרת הגדולה
  const embedded = isEmbedded();
  // ניווט מהסיידבר (?nav=side) — מסתירים את שורת הטאבים הפנימית; הניווט מגיע מ-Chatwoot
  const sideNav = isSideNav();
  // כותרת לפי הטאב הפעיל — בסגנון הכותרות הנייטיביות של Chatwoot (text-base font-medium)
  const viewTitle = view === 'sequences' ? t('tab_sequences') : view === 'contacts' ? t('tab_contacts') : view === 'campaigns' ? t('tab_campaigns') : t('tab_overview');

  // מצב "שיחה" — האפליקציה רצה כ-Dashboard App בתוך שיחה (סרגל צד צר).
  // אז מציגים תצוגת מצב קומפקטית לקריאה-בלבד של הליד הזה בלבד (בלי ניהול).
  const conversationMode = !!(conversation && conversation.id && accountId != null);

  // account_id מגיע אסינכרונית מ-context — נעדכן כשמופיע
  useEffect(() => {
    if (accountId == null) {
      const resolved = resolveAccountId(conversation);
      if (resolved != null) setAccountId(resolved);
    }
  }, [conversation, accountId]);

  const reload = useCallback(
    async (acc) => {
      if (acc == null) return;
      setLoading(true);
      setError('');
      try {
        const data = await listSequences(acc);
        setSequences(data);
      } catch (e) {
        setError(e.message || translate(M, 'errLoad'));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // טעינת רצפים + תבניות כשה-account ידוע
  useEffect(() => {
    if (accountId == null) return;
    reload(accountId);
    listTemplates(accountId)
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [accountId, reload]);

  const totalActive = useMemo(
    () => sequences.filter((s) => s.enabled).length,
    [sequences]
  );

  // סינון הרצפים לפי החיפוש — לפי שם או key (לא תלוי רישיות)
  const filteredSequences = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sequences;
    return sequences.filter(
      (s) =>
        (s.name || '').toLowerCase().includes(q) ||
        (s.key || '').toLowerCase().includes(q)
    );
  }, [sequences, query]);

  // --- פעולות ---

  const handleNew = () => {
    setEditingSequence(makeEmptySequence());
    setEditorOpen(true);
  };

  const handleEdit = (seq) => {
    setEditingSequence(structuredClone(seq));
    setEditorOpen(true);
  };

  // נזרק במקרה כישלון — ה-SequenceEditor תופס ומציג שגיאה ולא נסגר
  const handleSave = async (updated) => {
    const saved = await saveSequence(updated, accountId);
    setSequences((prev) => {
      const i = prev.findIndex((s) => s.id === saved.id || s.key === saved.key);
      if (i >= 0) {
        const next = [...prev];
        next[i] = saved;
        return next;
      }
      return [...prev, saved];
    });
    setEditorOpen(false);
    setEditingSequence(null);
  };

  // שני מתגי כיבוי נפרדים: 'enrollEnabled' (כניסות חדשות) ו-'sendEnabled' (שליחה לרצפים
  // שכבר התחילו). enabled נגזר משניהם (פעיל במשהו) ונשמר מסונכרן לתצוגה/ספירה.
  const handleToggleField = async (seq, field, value) => {
    setError('');
    const apply = (s, v) => {
      const next = { ...s, [field]: v };
      next.enabled = !!next.enrollEnabled || !!next.sendEnabled;
      return next;
    };
    setSequences((prev) => prev.map((s) => (s.id === seq.id ? apply(s, value) : s)));
    try {
      await saveSequence(apply(seq, value), accountId);
    } catch (e) {
      setError(e.message || translate(M, 'errStatus'));
      setSequences((prev) => prev.map((s) => (s.id === seq.id ? apply(s, !value) : s)));
    }
  };

  // שכפול — פותח את העורך מלא-מראש עם עותק (key חדש, כבוי), לכוונון לפני שמירה.
  // השמירה בפועל נעשית דרך handleSave (יצירה חדשה ב-DB).
  const handleDuplicate = (seq) => {
    setError('');
    setEditingSequence({
      ...structuredClone(seq),
      id: null,
      key: `${seq.key}_copy`,
      name: `${seq.name} ${translate(M, 'copySuffix')}`,
      enabled: false,
      enrollEnabled: false,
      sendEnabled: false,
    });
    setEditorOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setError('');
    setSequences((prev) => prev.filter((s) => s.id !== target.id));
    try {
      await deleteSequence(target.key, accountId);
    } catch (e) {
      setError(e.message || translate(M, 'errDelete'));
      reload(accountId);
    }
  };

  const noAccount = accountId == null;

  // ── מצב שיחה (סרגל צד צר) — רק כרטיס המצב של הליד, בלי כותרת/טאבים/חיפוש ──
  if (conversationMode) {
    return (
      <div dir={dir} className="min-h-screen bg-n-background font-inter text-n-slate-12">
        <div className="mx-auto w-full max-w-[360px] p-4">
          <ConversationStatus
            conversationId={conversation.id}
            accountId={accountId}
          />
        </div>
      </div>
    );
  }

  return (
    <div dir={dir} className="min-h-screen bg-n-background font-inter text-n-slate-12">
      <div
        className={`mx-auto max-w-5xl px-4 sm:px-6 ${
          embedded ? 'py-4' : 'py-6 sm:py-8'
        }`}
      >
        {/* כותרת — במצב sideNav הכותרת מגיעה מסרגל-הכותרת למטה (לפי טאב); במצב embed
            כותרת נקייה; אחרת הכותרת הגדולה עם האייקון. */}
        {sideNav ? null : embedded ? (
          <header className="flex items-center h-16 mb-4 -mt-1">
            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
              <h1 className="text-2xl font-medium text-n-slate-12 mb-0">
                {t('appTitle')}
              </h1>
              <p className="text-sm text-n-slate-11">
                {t('subtitle')}
              </p>
            </div>
          </header>
        ) : (
          <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-n-brand/10 text-n-blue-11">
                <Layers size={20} aria-hidden="true" />
              </span>
              <div>
                <h1 className="text-xl font-semibold text-n-slate-12">
                  {t('appTitle')}
                </h1>
                <p className="text-sm text-n-slate-11 mt-0.5">
                  {t('subtitleFull')}
                  {sequences.length > 0 ? (
                    <>
                      {' · '}
                      <span className="text-n-slate-12 font-medium">
                        {totalActive}
                      </span>{' '}
                      {t('activeSuffix', { total: sequences.length })}
                    </>
                  ) : null}
                </p>
              </div>
            </div>
          </header>
        )}

        {/* באנר context מ-Chatwoot — מוצג רק כשרצים מוטמע בשיחה, ולא במצב embed=1 */}
        {!embedded && inIframe && (conversation || contact) ? (
          <ContextBanner
            conversation={conversation}
            contact={contact}
            agent={agent}
          />
        ) : null}

        {/* באנר שגיאה */}
        {error ? (
          <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-n-ruby-7 bg-n-ruby-3 px-4 py-3 text-sm text-n-ruby-11">
            <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        {/* סרגל עליון: במצב sideNav זו כותרת-עמוד בסגנון Chatwoot (לפי טאב) + פעולות;
            אחרת שורת הטאבים הפנימית. */}
        <div className={`mb-6 flex items-center justify-between border-b border-n-weak ${sideNav ? 'pb-3' : ''}`}>
          {sideNav ? (
            <h1 className="m-0 text-base font-medium text-n-slate-12">{viewTitle}</h1>
          ) : (
            <div className="flex items-center gap-1">
              <TabButton active={view === 'overview'} onClick={() => setView('overview')} icon={BarChart3}>
                {t('tab_overview')}
              </TabButton>
              <TabButton active={view === 'sequences'} onClick={() => setView('sequences')} icon={Layers}>
                {t('tab_sequences')}
              </TabButton>
              <TabButton active={view === 'contacts'} onClick={() => setView('contacts')} icon={Users}>
                {t('tab_contacts')}
              </TabButton>
              <TabButton active={view === 'campaigns'} onClick={() => { setView('campaigns'); setCampaignId(null); }} icon={Megaphone}>
                {t('tab_campaigns')}
              </TabButton>
            </div>
          )}
          <div className="flex items-center gap-2">
            {!noAccount ? (
              <Button
                variant="faded"
                color="slate"
                size="sm"
                icon={Tag}
                onClick={() => setBulkOpen(true)}
              >
                {t('assignByLabel')}
              </Button>
            ) : null}
            {view === 'sequences' && !noAccount ? (
              <Button variant="solid" color="blue" size="sm" icon={Plus} onClick={handleNew}>
                {t('newSequence')}
              </Button>
            ) : null}
          </div>
        </div>

        {/* תוכן */}
        {noAccount ? (
          <div className="py-16 text-center text-sm text-n-slate-11">
            {t('waitingAccount')}
          </div>
        ) : view === 'overview' ? (
          <OverviewView accountId={accountId} />
        ) : view === 'campaigns' ? (
          campaignId != null
            ? <CampaignDetailView campaignId={campaignId} accountId={accountId} onBack={() => setCampaignId(null)} />
            : <CampaignsView accountId={accountId} onSelect={setCampaignId} />
        ) : view === 'contacts' ? (
          <EnrollmentsView accountId={accountId} />
        ) : loading ? (
          <div className="flex flex-col gap-4">
            {/* שלד טעינה — אותו מבנה כמו התוכן (חיפוש + טבלה) כדי שהפריסה לא תקפוץ */}
            <Skeleton className="h-9 w-full rounded-lg sm:max-w-xs" />
            <SkeletonRows rows={4} cols={5} />
          </div>
        ) : sequences.length === 0 ? (
          <EmptyState onNew={handleNew} />
        ) : (
          <>
            {/* חיפוש רצפים */}
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
                  placeholder={t('searchPlaceholder')}
                  aria-label={t('searchAria')}
                  className="ps-9"
                />
              </div>
              <p className="text-xs text-n-slate-11">
                <span className="font-medium text-n-slate-12">
                  {filteredSequences.length}
                </span>{' '}
                {t('ofTotal', { total: sequences.length })}
              </p>
            </div>

            {filteredSequences.length === 0 ? (
              <div className="rounded-xl border border-dashed border-n-strong bg-n-solid-2 py-12 text-center text-sm text-n-slate-11">
                {t('noMatch')}
              </div>
            ) : (
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>{t('colName')}</TH>
                    <TH>{t('colStatus')}</TH>
                    <TH>{t('colSteps')}</TH>
                    <TH>{t('colStop')}</TH>
                    <TH align="end">{t('colActions')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {filteredSequences.map((seq) => (
                <TR key={seq.id}>
                  <TD>
                    <span className="font-medium text-n-slate-12">
                      {seq.name}
                    </span>
                    {seq.key ? (
                      <span className="mt-0.5 block font-mono text-xs text-n-slate-10">
                        {seq.key}
                      </span>
                    ) : null}
                  </TD>
                  <TD>
                    <div className="flex flex-col gap-1.5">
                      <div
                        className="flex items-center gap-2"
                        title={t('enrollTitle')}
                      >
                        <Switch
                          checked={seq.enrollEnabled}
                          onChange={(v) => handleToggleField(seq, 'enrollEnabled', v)}
                          aria-label={t('enrollAria', { name: seq.name })}
                        />
                        <span className="text-xs text-n-slate-11">{t('enrollLabel')}</span>
                      </div>
                      <div
                        className="flex items-center gap-2"
                        title={t('sendTitle')}
                      >
                        <Switch
                          checked={seq.sendEnabled}
                          onChange={(v) => handleToggleField(seq, 'sendEnabled', v)}
                          aria-label={t('sendAria', { name: seq.name })}
                        />
                        <span className="text-xs text-n-slate-11">{t('sendLabel')}</span>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    <Badge color="blue">{seq.steps.length}</Badge>
                  </TD>
                  <TD>
                    {seq.stopOnReply ? (
                      <Badge color="teal">{t('on')}</Badge>
                    ) : (
                      <Badge color="slate">{t('off')}</Badge>
                    )}
                  </TD>
                  <TD align="end">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        color="slate"
                        size="sm"
                        iconOnly
                        icon={Pencil}
                        aria-label={t('editAria', { name: seq.name })}
                        onClick={() => handleEdit(seq)}
                      />
                      <Button
                        variant="ghost"
                        color="slate"
                        size="sm"
                        iconOnly
                        icon={Copy}
                        aria-label={t('duplicateAria', { name: seq.name })}
                        onClick={() => handleDuplicate(seq)}
                      />
                      <Button
                        variant="ghost"
                        color="ruby"
                        size="sm"
                        iconOnly
                        icon={Trash2}
                        aria-label={t('deleteAria', { name: seq.name })}
                        onClick={() => setDeleteTarget(seq)}
                      />
                    </div>
                  </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
            )}
          </>
        )}
      </div>

      {/* עורך הרצף (מודאל ממורכז) */}
      <SequenceEditor
        open={editorOpen}
        sequence={editingSequence}
        templates={templates}
        accountId={accountId}
        onSave={handleSave}
        onClose={() => {
          setEditorOpen(false);
          setEditingSequence(null);
        }}
      />

      {/* אישור מחיקה */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={t('deleteTitle')}
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              color="slate"
              onClick={() => setDeleteTarget(null)}
            >
              {t('cancel')}
            </Button>
            <Button variant="solid" color="ruby" onClick={confirmDelete}>
              {t('delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-n-slate-12">
          {t('deleteConfirmPrefix')}{' '}
          <span className="font-semibold">{deleteTarget?.name}</span>{t('deleteConfirmSuffix')}
        </p>
      </Modal>

      {/* שיוך המוני לפי תווית */}
      <BulkEnrollModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        accountId={accountId}
        sequences={sequences}
        onDone={() => reload(accountId)}
      />
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium transition-colors ${
        active ? 'text-n-blue-11' : 'text-n-slate-11 hover:text-n-slate-12'
      }`}
    >
      {Icon ? <Icon size={15} aria-hidden="true" /> : null}
      {children}
      {active ? (
        <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-n-brand" aria-hidden="true" />
      ) : null}
    </button>
  );
}

function ContextBanner({ conversation, contact, agent }) {
  const t = useT(M);
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-n-weak bg-n-solid-2 px-4 py-3 shadow-sm">
      <span className="inline-flex items-center gap-1.5 text-sm text-n-slate-11">
        <MessageCircle size={15} className="text-n-blue-11" aria-hidden="true" />
        {t('conversation')}
        <span className="font-medium text-n-slate-12">
          {conversation?.id ? `#${conversation.id}` : '—'}
        </span>
      </span>
      <span className="inline-flex items-center gap-1.5 text-sm text-n-slate-11">
        <User size={15} className="text-n-blue-11" aria-hidden="true" />
        {t('contact')}
        <span className="font-medium text-n-slate-12">
          {contact?.name || '—'}
        </span>
      </span>
      {agent?.name ? (
        <span className="text-sm text-n-slate-11">
          {t('agentLabel')} <span className="font-medium text-n-slate-12">{agent.name}</span>
        </span>
      ) : null}
    </div>
  );
}

function EmptyState({ onNew }) {
  const t = useT(M);
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-n-strong bg-n-solid-2 py-16 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-n-brand/10 text-n-blue-11">
        <Layers size={24} aria-hidden="true" />
      </span>
      <div>
        <p className="text-base font-medium text-n-slate-12">{t('emptyTitle')}</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-n-slate-11">
          {t('emptyBody')}
        </p>
      </div>
      <Button variant="solid" color="blue" icon={Plus} onClick={onNew}>
        {t('newSequence')}
      </Button>
    </div>
  );
}
