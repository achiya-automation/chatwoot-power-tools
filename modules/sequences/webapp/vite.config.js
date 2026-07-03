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
export default defineConfig({
  plugins: [react()],
  base: `${ADDONS_BASE}/`,
  build: {
    rollupOptions: {
      input: {
        // האפליקציה הראשית (HTML entry, hashed)
        main: resolve(dir, 'index.html'),
        // מודול דחיסה עצמאי ל-injector של Chatwoot — שם פלט יציב <addons-base>/sequences/compressor.js
        compressor: resolve(dir, 'src/compressor-entry.js'),
      },
      output: {
        // compressor → שם קבוע כדי שה-injector יוכל לייבא URL יציב; השאר hashed
        entryFileNames: (chunk) => (chunk.name === 'compressor' ? 'compressor.js' : 'assets/[name]-[hash].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
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
