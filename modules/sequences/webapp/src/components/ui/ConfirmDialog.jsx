import { AlertTriangle, ShieldAlert, Send } from 'lucide-react';
import Modal from './Modal.jsx';
import Button from './Button.jsx';
import useT from '../../useT.js';

/*
 * ConfirmDialog — מנגנון בטיחות לפני פעולה קריטית (התחלת סדרה, החלפה,
 * הפעלה מחדש, הסרה). מודאל קטן וברור: אייקון לפי חומרה, הסבר *מה יקרה*,
 * ואופציונלית תצוגה מקדימה (children) של ההודעה שתישלח — כדי שאף הודעה
 * לא תצא ללקוח בלי שראינו אותה ואישרנו.
 *
 * tone: 'info' (התחלה) | 'warning' (החלפה/הפעלה מחדש) | 'danger' (הסרה/בלתי-הפיך)
 * props: open, onClose, onConfirm, title, description, confirmLabel, cancelLabel,
 *        tone, loading, children
 */

// מילון co-located (he/en)
const M = {
  he: { confirm: 'אישור', cancel: 'ביטול' },
  en: { confirm: 'Confirm', cancel: 'Cancel' },
};

const TONES = {
  info: { color: 'blue', Icon: Send, badge: 'bg-n-brand/10 text-n-blue-11' },
  warning: { color: 'amber', Icon: AlertTriangle, badge: 'bg-n-amber-3 text-n-amber-11' },
  danger: { color: 'ruby', Icon: ShieldAlert, badge: 'bg-n-ruby-3 text-n-ruby-11' },
};

export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = null,
  cancelLabel = null,
  tone = 'warning',
  loading = false,
  icon: IconOverride = null,
  children,
}) {
  const t = useT(M);
  const _confirm = confirmLabel ?? t('confirm');
  const _cancel = cancelLabel ?? t('cancel');
  const toneCfg = TONES[tone] || TONES.warning;
  const Icon = IconOverride || toneCfg.Icon;

  const footer = (
    <>
      <Button variant="ghost" color="slate" onClick={onClose} disabled={loading}>
        {_cancel}
      </Button>
      <Button variant="solid" color={toneCfg.color} onClick={onConfirm} loading={loading}>
        {_confirm}
      </Button>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} variant="center" size="sm" footer={footer} closeOnOverlay={!loading}>
      <div className="flex gap-3.5">
        <span
          className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${toneCfg.badge}`}
          aria-hidden="true"
        >
          <Icon size={22} strokeWidth={2} />
        </span>
        <div className="min-w-0 grow pt-0.5">
          {title ? <h3 className="text-base font-semibold text-n-slate-12">{title}</h3> : null}
          {description ? (
            <p className="mt-1 text-sm leading-relaxed text-n-slate-11">{description}</p>
          ) : null}
          {children ? <div className="mt-3">{children}</div> : null}
        </div>
      </div>
    </Modal>
  );
}
