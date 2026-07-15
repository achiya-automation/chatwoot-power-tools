import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { ToastProvider } from './components/ui/Toast.jsx';
import { applyDocumentDir, setLocale } from './i18n.js';
import './index.css';

// מזהה ה-build, מוטבע ע"י vite.config (define). מסומן על <html> כדי שאפשר יהיה לענות
// על "איזו גרסה רצה אצלך?" בלי לנחש — ומכריח hash חדש לקבצים בכל פריסה (ראה vite.config).
try { document.documentElement.setAttribute('data-build', __BUILD_ID__); } catch { /* noop */ }

/*
 * נושא (theme) כהה/בהיר — מתאים את עצמו אוטומטית לממשק Chatwoot.
 * האפליקציה מוטמעת ב-iframe same-origin בתוך Chatwoot, ולכן יכולה לקרוא את
 * מחלקת `dark` של עמוד-האב (מקור-האמת של נושא Chatwoot) ולעקוב אחרי שינוי חי.
 * סדר עדיפויות: ההורה (Chatwoot) → ?theme= ב-URL → העדפת מערכת ההפעלה.
 * כל הצבעים הם CSS-vars → מספיק להחליף את מחלקת `dark` על <html>.
 */

// קריאת הנושא מעמוד-האב של Chatwoot (same-origin). null אם לא מוטמע / חסום (sandbox).
function themeFromParent() {
  try {
    if (window.parent === window) return null; // לא ב-iframe
    const pdoc = window.parent.document;       // same-origin → נגיש; cross-origin זורק
    const dark = pdoc.documentElement.classList.contains('dark') || pdoc.body.classList.contains('dark');
    return dark ? 'dark' : 'light';
  } catch {
    return null; // cross-origin / sandboxed → לא ניתן לזהות
  }
}

function themeFromUrl() {
  try { return new URLSearchParams(window.location.search).get('theme'); } catch { return null; }
}

function prefersDark() {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { return 'light'; }
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'dark') root.classList.add('dark');
  else if (theme === 'light') root.classList.remove('dark');
  // ערך לא מוכר (null/auto) — לא נוגעים.
}

// ברירת המחדל כשאין הורה (Chatwoot) ואין ?theme= מפורש.
// בנייד ה-WebView של אפליקציית Chatwoot הוא top-level (אין injector שמסנכרן theme), וברירת
// המחדל שלו כהה — prefers-color-scheme מדווח כהה גם כשהמכשיר בהיר (ה-theme הפנימי של האפליקציה
// נעול). לכן ב-embed top-level מעדיפים בהיר במקום לרשת את הכהה השקרי. זה גם עוקף מטמון: גם אם
// האפליקציה מגישה URL ישן בלי theme=, הפאנל עדיין בהיר. במחשב הפאנל תמיד ב-iframe (themeFromParent
// גובר וזה לא נכנס), ובפיתוח עצמאי (בלי embed) שומרים על העדפת המערכת.
function defaultTheme() {
  try {
    if (new URLSearchParams(window.location.search).has('embed') && window.parent === window) {
      return 'light';
    }
  } catch { /* ignore */ }
  return prefersDark();
}

// הנושא האפקטיבי, לפי סדר העדיפויות
function resolveTheme() {
  return themeFromParent() || themeFromUrl() || defaultTheme();
}

// החלה סינכרונית לפני render — אין הבזק (flash) של נושא שגוי.
applyTheme(resolveTheme());

// שפה (he/en) — נגזרת מ-?locale= (מוזרק ע"י ה-injector). מחיל <html lang/dir>
// סינכרונית לפני render כדי שהכיוון (rtl/ltr) יהיה נכון כבר בפריים הראשון.
applyDocumentDir();

// מעקב חי אחרי שינוי נושא בעמוד-האב (כשהמשתמש מחליף כהה/בהיר ב-Chatwoot)
try {
  if (window.parent !== window) {
    const pdoc = window.parent.document;
    const obs = new MutationObserver(() => applyTheme(themeFromParent()));
    obs.observe(pdoc.documentElement, { attributes: true, attributeFilter: ['class'] });
    obs.observe(pdoc.body, { attributes: true, attributeFilter: ['class'] });
  }
} catch { /* sandboxed — אי אפשר לעקוב */ }

// נפילה-לאחור: שינוי נושא מערכת ההפעלה (כשאין גישה להורה)
try {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!themeFromParent()) applyTheme(resolveTheme());
  });
} catch { /* ignore */ }

// החלפת נושא/שפה חיה ששודרה מ-Chatwoot (postMessage מה-injector)
window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return; // same-origin embed בלבד
  const data = event?.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'drip-theme' && data.theme) {
    applyTheme(data.theme);
  } else if (data.type === 'drip-locale' && data.locale) {
    setLocale(data.locale); // מעדכן <html dir/lang> + מודיע ל-React (re-render)
  }
});

function render() {
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ToastProvider>
        <App />
      </ToastProvider>
    </React.StrictMode>
  );
}

// מצב תצוגה לפיתוח בלבד (?mock=1) — מזריק נתוני דמה ל-fetch כדי לראות את כל המסכים
// בלי engine מקומי. ה-mock מותקן *לפני* ה-render כדי שהבקשה הראשונה תיתפס.
// import.meta.env.DEV מבטיח שכל הענף (כולל ה-import הדינמי) נגזם מ-build של production.
async function boot() {
  if (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get('mock') === '1'
  ) {
    try {
      const { installMockFetch } = await import('./data/devFixtures.js');
      installMockFetch();
    } catch { /* ignore */ }
  }
  render();
}

boot();
