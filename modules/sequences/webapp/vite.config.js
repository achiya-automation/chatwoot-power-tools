import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));

// route יחיד לכל התוספות: /chatwoot-addons/*. ניתן לעקוף עם VITE_ADDONS_BASE
// (למשל בזמן build על סביבה עם base אחר) — אפס דומיין/נתיב קשוח.
const ADDONS_BASE = process.env.VITE_ADDONS_BASE || '/chatwoot-addons';

// base: '<addons-base>/sequences/' → מוגש same-origin (reverse proxy handle_path
// מסיר את הקידומת לפני שמגיע ל-engine).
// מזהה build. נכנס אל תוך ה-bundle, ולכן ה-hash של הקבצים משתנה בכל build — גם כשהקוד
// עצמו לא זז. זה נראה מיותר עד שנתקעים: hash שלא משתנה פירושו שכתובת קובץ שנתקעה במטמון
// של דפדפן או CDN (למשל תשובת שגיאה שנשמרה בטעות) נשארת שם עד שהמטמון פג — יום שלם של
// דשבורד לבן, בלי דרך לדחוף תיקון. כתובת חדשה בכל פריסה = אין רשומה ישנה להיתקע בה.
// כבונוס, ה-build מסומן על <html data-build> לצורכי תמיכה ("איזו גרסה רצה אצלך?").
const BUILD_ID = process.env.VITE_BUILD_ID || new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

export default defineConfig({
  plugins: [react()],
  // base יחסי: index.html פולט ‎src="./assets/…"‎, שנפתר מול כתובת המסמך עצמו. כך אותו
  // build עובד בכל נתיב שבו מתקינים אותו — ‎/drip‎, ‎/chatwoot-addons‎, כל דבר — בלי
  // משתנה סביבה בזמן build. base מוחלט (מה שהיה כאן) חייב לדעת מראש איפה יגישו אותו,
  // ומי שבנה בלי VITE_ADDONS_BASE קיבל bundle שמצביע לנתיב לא קיים ודשבורד לבן.
  // (ה-API base נגזר באותה רוח בזמן ריצה — ראה src/config.js.)
  base: './',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  build: {
    rollupOptions: {
      input: {
        // האפליקציה הראשית (HTML entry, hashed)
        main: resolve(dir, 'index.html'),
        // מודול דחיסה עצמאי ל-injector של Chatwoot — שם פלט יציב <addons-base>/sequences/compressor.js
        compressor: resolve(dir, 'src/compressor-entry.js'),
      },
      output: {
        // כל שם קובץ נושא גם את מזהה ה-build, לא רק את ה-hash של התוכן.
        //
        // hash-תוכן בלבד נשמע נכון (אותו תוכן = אותה כתובת = פחות הורדות), אבל הוא משאיר
        // דלת פתוחה: chunk שהתוכן שלו לא זז שומר את הכתובת שלו לנצח, ואם משהו במטמון של
        // דפדפן או CDN נתקע עליה — למשל תשובת 401 שנשמרה בטעות — אין שום דרך לדחוף תיקון.
        // ה-import היחסי אל אותו chunk ייכשל בשקט, גרף המודולים לא ירוץ, והמסך יישאר לבן.
        // בדיוק זה קרה כאן. build חדש = כתובות חדשות לכל הקבצים = אין רשומה ישנה להיתקע בה.
        // המחיר (הורדה מחדש של ~350KB בכל פריסה) זניח לדשבורד פנימי.
        //
        // compressor יוצא דופן: ה-injector מייבא אותו מכתובת קבועה, אז השם שלו נשאר יציב.
        entryFileNames: (chunk) =>
          (chunk.name === 'compressor' ? 'compressor.js' : `assets/[name]-[hash]-${BUILD_ID}.js`),
        chunkFileNames: `assets/[name]-[hash]-${BUILD_ID}.js`,
        assetFileNames: `assets/[name]-[hash]-${BUILD_ID}[extname]`,
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    // proxy same-origin ל-API (מדמה את ה-reverse proxy ב-production) → אפס CORS.
    // target: ה-drip-engine המקומי (loopback בלבד — אפס דומיין קשוח). ניתן לעקוף
    // עם VITE_DEV_ENGINE_URL אם ה-engine המקומי רץ על פורט/host אחר.
    proxy: {
      [`${ADDONS_BASE}/drip-api`]: {
        target: process.env.VITE_DEV_ENGINE_URL || 'http://localhost:3100',
        changeOrigin: true,
        rewrite: (p) => p.replace(`${ADDONS_BASE}/drip-api`, '/drip-api'),
      },
    },
  },
});
