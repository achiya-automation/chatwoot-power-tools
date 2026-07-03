import { useEffect, useState } from 'react';

/*
 * useChatwootContext — Dashboard App context hook.
 *
 * כשהאפליקציה רצה כ-Dashboard App בתוך iframe של Chatwoot:
 *  1. במאונט שולחים ל-parent בקשה לקבל מידע על השיחה:
 *       window.parent.postMessage('chatwoot-dashboard-app:fetch-info', '*')
 *  2. Chatwoot מחזיר postMessage עם JSON:
 *       { event: 'appContext', data: { conversation, contact, currentAgent } }
 *
 * ההודעה הנכנסת יכולה להגיע כ-string (JSON) או כ-object — מטפלים בשניהם.
 * מחזיר { conversation, contact, agent, isEmbedded }.
 *
 * הערה: כשרצים מחוץ ל-Chatwoot (פיתוח עצמאי) פשוט לא יגיע context —
 * האפליקציה עובדת כרגיל עם ערכי null.
 */

function parseEvent(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

// seed לפיתוח ויזואלי בלבד (?conv=) — נגזם מ-build של production (import.meta.env.DEV).
// מאפשר לראות את פאנל-השיחה בלי Chatwoot אמיתי: ?mock=1&conv=101&account_id=7
function devSeed() {
  try {
    if (!import.meta.env.DEV) return {};
    const p = new URLSearchParams(window.location.search);
    const conv = p.get('conv');
    if (!conv) return {};
    return {
      conversation: { id: Number(conv), account_id: Number(p.get('account_id') || 7) },
      contact: { name: 'דנה כהן' },
    };
  } catch { return {}; }
}

export default function useChatwootContext() {
  const [context, setContext] = useState({
    conversation: null,
    contact: null,
    agent: null,
    isEmbedded: window.parent !== window,
    ...devSeed(),
  });

  useEffect(() => {
    const handleMessage = (event) => {
      // אבטחה: מקבלים context רק מ-origin שלנו. Chatwoot מטמיע את /drip same-origin,
      // אז הודעה לגיטימית תגיע מ-window.location.origin. חוסם מטמיע חוצה-origin
      // מלזייף conversation/contact/agent (defense-in-depth — הבקשה ממילא 401 בלי סשן).
      if (event.origin !== window.location.origin) return;
      const payload = parseEvent(event.data);
      if (!payload || payload.event !== 'appContext') return;

      const data = payload.data || {};
      setContext((prev) => ({
        ...prev,
        conversation: data.conversation ?? null,
        contact: data.contact ?? null,
        agent: data.currentAgent ?? data.agent ?? null,
      }));
    };

    window.addEventListener('message', handleMessage);

    // בקשת המידע מ-Chatwoot ברגע הטעינה — יעד same-origin בלבד (ההורה הוא Chatwoot
    // באותו דומיין). אם ההורה אינו ה-origin שלנו ההודעה פשוט לא תימסר — התנהגות רצויה.
    try {
      window.parent.postMessage('chatwoot-dashboard-app:fetch-info', window.location.origin);
    } catch {
      // ignore — לא רצים בתוך iframe
    }

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return context;
}
