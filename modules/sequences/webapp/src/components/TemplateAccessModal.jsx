import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import Modal from './ui/Modal.jsx';
import Badge from './ui/Badge.jsx';
import Button from './ui/Button.jsx';
import Switch from './ui/Switch.jsx';
import Skeleton from './ui/Skeleton.jsx';
import { useToast } from './ui/Toast.jsx';
import { listTemplateAccess, saveTemplateAccess, listAccountAgents } from '../api/templatesApi.js';
import useT from '../useT.js';
import { translate } from '../i18n.js';

/*
 * TemplateAccessModal — who, besides the account's administrators, may open the Template
 * Studio. Rendered from TemplatesView's header and only for administrators (the engine
 * re-checks: tpl_access / tpl_set_access are administrator-only whatever the UI shows).
 *
 * Administrators are listed with a badge rather than a toggle: their access comes from their
 * Chatwoot role, not from a stored grant, so there is nothing here to switch off. Everyone
 * else gets a toggle; Save replaces the whole grant list in one call.
 */

const M = {
  he: {
    title: 'גישה לתבניות WhatsApp',
    intro: 'מנהלי החשבון תמיד יכולים לנהל תבניות. כאן אפשר לפתוח את הגישה גם לנציגים מסוימים.',
    admin: 'מנהל/ת',
    empty: 'אין נציגים בחשבון הזה.',
    save: 'שמירה',
    cancel: 'ביטול',
    saved: 'ההרשאות עודכנו',
    errLoad: 'טעינת הנציגים נכשלה',
    errSave: 'שמירת ההרשאות נכשלה',
    noSession: 'רשימת הנציגים זמינה רק מהדפדפן שבו מחוברים ל-Chatwoot.',
  },
  en: {
    title: 'WhatsApp Templates access',
    intro: 'Account administrators can always manage templates. Here you can open access to specific agents as well.',
    admin: 'Administrator',
    empty: 'No agents in this account.',
    save: 'Save',
    cancel: 'Cancel',
    saved: 'Access updated',
    errLoad: 'Failed to load agents',
    errSave: 'Failed to save access',
    noSession: 'The agent list is only available from the browser you are signed in to Chatwoot with.',
  },
};

export default function TemplateAccessModal({ open, accountId, onClose }) {
  const t = useT(M);
  const { toast } = useToast();

  const [agents, setAgents] = useState(null);   // null = not loaded yet
  const [granted, setGranted] = useState(() => new Set());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || accountId == null) return;
    setError('');
    setAgents(null);
    Promise.all([listAccountAgents(accountId), listTemplateAccess(accountId)])
      .then(([list, access]) => {
        setAgents(Array.isArray(list) ? list : []);
        setGranted(new Set(((access && access.user_ids) || []).map(Number)));
      })
      .catch((e) => {
        setAgents([]);
        setError(e.message === 'no-session' ? translate(M, 'noSession') : translate(M, 'errLoad'));
      });
  }, [open, accountId]);

  const toggle = (id) => {
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      // Administrators are never stored as grants — their access is their role. Sending them
      // would leave a stale row behind the day their role changes.
      const adminIds = new Set((agents || []).filter(isAdmin).map((a) => Number(a.id)));
      await saveTemplateAccess(accountId, [...granted].filter((id) => !adminIds.has(id)));
      toast({ message: t('saved'), variant: 'success' });
      onClose?.();
    } catch (e) {
      setError(e.message || translate(M, 'errSave'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title={t('title')}
      size="md"
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="ghost" color="slate" onClick={onClose} disabled={saving}>{t('cancel')}</Button>
          <Button variant="solid" color="blue" onClick={save} disabled={saving || agents === null}>
            {t('save')}
          </Button>
        </div>
      )}
    >
      <p className="mb-4 text-sm text-n-slate-11">{t('intro')}</p>

      {error ? (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-n-ruby-7 bg-n-ruby-3 px-4 py-3 text-sm text-n-ruby-11">
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          {error}
        </div>
      ) : null}

      {agents === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-11 w-full rounded-lg" />
          <Skeleton className="h-11 w-full rounded-lg" />
          <Skeleton className="h-11 w-full rounded-lg" />
        </div>
      ) : agents.length === 0 && !error ? (
        <p className="py-6 text-center text-sm text-n-slate-11">{t('empty')}</p>
      ) : (
        <ul className="flex max-h-[50vh] flex-col divide-y divide-n-weak overflow-y-auto">
          {sortAdminsFirst(agents).map((a) => {
            const admin = isAdmin(a);
            const id = Number(a.id);
            return (
              <li key={id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm text-n-slate-12">{a.name || a.email}</div>
                  <div className="truncate text-xs text-n-slate-11">{a.email}</div>
                </div>
                {/* An administrator's access comes from their Chatwoot role, so there is no
                    grant here to switch off — a disabled toggle would just read as broken. */}
                {admin ? (
                  <Badge color="blue" className="shrink-0">{t('admin')}</Badge>
                ) : (
                  <Switch
                    checked={granted.has(id)}
                    onChange={() => toggle(id)}
                    aria-label={a.name || a.email}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

// Chatwoot's /agents payload carries role: 'administrator' | 'agent'.
function isAdmin(a) {
  return a && a.role === 'administrator';
}

// Administrators first — they are the fixed part of the list, and the toggles below them are
// the only thing on this screen that actually does something.
function sortAdminsFirst(list) {
  return [...list].sort((a, b) => (isAdmin(b) ? 1 : 0) - (isAdmin(a) ? 1 : 0));
}
