import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { headerMedia, mediaFileName } from '../../lib/headerMedia.js';
import useT from '../../useT.js';

/*
 * HeaderMedia — כותרת המדיה של בועת התצוגה המקדימה: מציגה את התמונה או הווידאו האמיתיים
 * שהלקוח יקבל, במקום פס אפור עם המילה "תמונה". משותפת ל-ChatBubble, MessageBubble ו-
 * TemplatePreview כדי שכל מקום שמציג תבנית יתנהג אותו דבר.
 *
 * ⚠️ טעינה נכשלת היא מצב רגיל ולא תקלה: הקישור של מטא נושא תפוגה (oe=), וּוידאו חיצוני
 * עלול להיחסם ע"י ה-CSP של השרת. בכל כישלון נופלים ל-`fallback` — החיווי שהיה כאן קודם —
 * ולא משאירים אייקון תמונה שבורה או ריבוע ריק.
 *
 * props:
 *   format   — IMAGE / VIDEO / DOCUMENT (כל ערך אחר → מרונדר fallback בלבד)
 *   sources  — מקורות לפי סדר עדיפות; הראשון שניתן לטעינה מנצח (ראו lib/headerMedia.js)
 *   fallback — ה-JSX שיוצג כשאין מדיה להציג (לכל קורא יש נוסח משלו)
 */

// מילון co-located (he/en) — טקסט חלופי לקורא-מסך בלבד; שם הקובץ מגיע מהנתונים.
const M = {
  he: { altImage: 'תמונת הכותרת של ההודעה', altVideo: 'סרטון הכותרת של ההודעה', document: 'מסמך' },
  en: { altImage: 'Message header image', altVideo: 'Message header video', document: 'Document' },
};

// יחס הגובה-רוחב שוואטסאפ מציגה בו כותרת מדיה. שמור מראש כדי שהבועה לא תקפוץ
// כשהתמונה נטענת (וגם קובע גובה מקסימלי בפועל — הבועה עצמה לא רחבה מ-max-w-sm).
const BOX = 'overflow-hidden rounded-lg bg-n-alpha-2 aspect-[1.91/1] max-h-64';

export default function HeaderMedia({ format, sources = [], fallback = null, className = 'mb-2' }) {
  const t = useT(M);
  const { kind, url } = headerMedia(format, ...sources);
  const [failed, setFailed] = useState(false);

  // החלפת קובץ אחרי כישלון קודמת — מנסים שוב במקום להישאר תקועים על ה-fallback.
  useEffect(() => { setFailed(false); }, [url]);

  if (!kind || !url || failed) return fallback;

  if (kind === 'DOCUMENT') {
    // מסמך לא מוטמע — וואטסאפ מציגה צ'יפ עם שם הקובץ, וזה גם מה שהלקוח יראה.
    const name = mediaFileName(url);
    if (!name) return fallback;
    return (
      <div className={`flex items-center gap-2 rounded-lg bg-n-alpha-2 px-2.5 py-2.5 text-xs text-n-slate-11 ${className}`}>
        <FileText size={16} className="shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate" dir="ltr" title={name}>{name}</span>
      </div>
    );
  }

  if (kind === 'VIDEO') {
    return (
      <div className={`${BOX} ${className}`}>
        {/* ⛔ בלי autoplay — זו תצוגה מקדימה בתוך פאנל, לא נגן. preload=metadata מביא
            רק את הפריים הראשון ואת האורך. src ישירות על ה-<video> (ולא <source>) כדי
            שאירוע השגיאה יגיע לאלמנט עצמו וה-fallback יתפוס גם כשה-CSP חוסם. */}
        <video
          src={url}
          controls
          preload="metadata"
          playsInline
          aria-label={t('altVideo')}
          className="h-full w-full bg-black/20 object-contain"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }

  return (
    <div className={`${BOX} ${className}`}>
      <img
        src={url}
        alt={t('altImage')}
        loading="lazy"
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
