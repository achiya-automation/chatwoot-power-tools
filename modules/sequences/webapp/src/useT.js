/*
 * useT — ה-hook הריאקטיבי לתרגום (מייבא React; ראו i18n.js לליבה חסרת-React).
 *
 * useLocale()      → ה-locale הנוכחי כ-state ריאקטיבי (מנוי דרך useSyncExternalStore;
 *                    re-render אוטומטי כשמתקבל 'drip-locale' מ-Chatwoot).
 * useT(messages)   → פונקציית t(key, vars) קשורה למילון המקומי של הרכיב. קוראת
 *                    ל-useLocale פנימית → הרכיב נרשם לשינויי שפה ומתעדכן חי.
 *
 * דפוס שימוש (מילון co-located, כמו campaign-modal):
 *   const M = { he: { save: 'שמירה' }, en: { save: 'Save' } };
 *   function Foo() { const t = useT(M); return <button>{t('save')}</button>; }
 */
import { useSyncExternalStore } from 'react';
import { subscribe, getLocale, translate } from './i18n.js';

export function useLocale() {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}

export default function useT(messages) {
  useLocale(); // מנוי — re-render בהחלפת שפה
  return (key, vars) => translate(messages, key, vars);
}
