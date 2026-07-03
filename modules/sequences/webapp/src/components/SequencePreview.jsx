import { MessageSquare, CalendarClock } from 'lucide-react';
import Modal from './ui/Modal.jsx';
import MessageBubble from './ui/MessageBubble.jsx';
import { formatOffset, formatDuration } from '../lib/timeline.js';

/*
 * SequencePreview — מציג את כל שלבי הרצף כשיחת WhatsApp רציפה אחת, כדי שאפשר
 * "לראות את כל הסיפור": כל בועה עם מפריד-זמן ("מיד" / "כעבור יום") מעליה,
 * בדיוק בסדר ובמרווחים שבהם הלקוח יקבל אותן.
 *
 * props: open, onClose, sequence (draft), templateByName, schedule (lib/timeline), duration
 */

export default function SequencePreview({
  open,
  onClose,
  sequence,
  templateByName = {},
  schedule = [],
  duration,
}) {
  const steps = sequence?.steps || [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`תצוגה מקדימה — ${sequence?.name || 'הרצף'} כשיחה`}
      variant="center"
      size="lg"
    >
      {/* רקע בסגנון חלון צ'אט — בועות מיושרות להתחלה (RTL: ימין) */}
      <div className="rounded-xl bg-n-alpha-1 p-4">
        {steps.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-n-slate-11">
            <MessageSquare size={22} className="text-n-slate-9" aria-hidden="true" />
            אין שלבים להצגה.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {steps.map((step, i) => {
              const t = templateByName[step.template];
              const offset = schedule[i] || { days: 0, hours: 0 };
              return (
                <div key={step.id} className="flex flex-col gap-1.5">
                  {/* מפריד-זמן ממורכז — מתי ההודעה תישלח מרגע ההרשמה */}
                  <div className="flex items-center justify-center">
                    <span className="inline-flex items-center gap-1 rounded-full bg-n-alpha-3 px-2.5 py-0.5 text-[11px] font-medium text-n-slate-11">
                      שלב {i + 1} · {formatOffset(offset)}
                    </span>
                  </div>
                  {/* הבועה — או חיווי "טרם נבחרה תבנית" */}
                  <div className="flex justify-start">
                    {t ? (
                      <MessageBubble template={t} params={step.params} mediaUrl={step.mediaUrl} />
                    ) : (
                      <div className="max-w-sm rounded-lg border border-dashed border-n-strong bg-n-solid-2 px-3 py-2 text-xs text-n-slate-10">
                        טרם נבחרה תבנית לשלב זה
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* סיכום משך בתחתית */}
      {steps.length > 0 && duration && duration.totalHours > 0 ? (
        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-n-slate-11">
          <CalendarClock size={13} className="text-n-blue-11" aria-hidden="true" />
          סך הרצף נמשך {formatDuration(duration)} — {steps.length} הודעות
        </p>
      ) : null}
    </Modal>
  );
}
