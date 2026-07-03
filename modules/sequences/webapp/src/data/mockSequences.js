/*
 * יוצרי רצף/שלב ריקים לעורך (ערכי ברירת מחדל לרצף חדש ולשלב חדש).
 * הנתונים האמיתיים מגיעים מה-engine דרך src/api/sequencesApi.js — כאן רק תבניות ריקות.
 * (הקובץ הכיל בעבר גם נתוני דמה לפיתוח; הוסרו כשהחיבור ל-engine התייצב.)
 */

let _id = 100;
const nextId = () => `seq_${++_id}`;
let _stepId = 1000;
const nextStepId = () => `step_${++_stepId}`;

// יוצר שלב ריק חדש (params = מערך, ערך אחד לכל משתנה {{N}} בתבנית)
export const makeEmptyStep = () => ({
  id: nextStepId(),
  template: '',
  language: 'he',
  category: 'MARKETING',
  delayDays: 1,
  delayHours: 0,
  params: [],
  mediaUrl: '', // קישור מדיה ל-header (נדרש רק לתבניות עם header IMAGE/VIDEO/DOCUMENT)
  // ── תזמון מתקדם (בורר "שורה חכמה + מתקדם") ──
  sendHour: null,        // שעה מדויקת ביום 0-23 (null = בכל שעה)
  sendDate: '',          // תאריך מוחלט YYYY-MM-DD (שידור לכל הלידים); ריק = מרווח יחסי
  repeatInterval: null,  // חזרה: מספר מחזורים (null = חד-פעמי)
  repeatUnit: '',        // day | week | month
  allowedDow: [],        // ימי שבוע מותרים 0=ראשון..6=שבת ([] = כל הימים)
  sendCondition: 'always',
  onConditionFail: 'skip',
});

// יוצר רצף ריק חדש. key נוצר אוטומטית בשמירה (מוסתר מהמשתמש).
// enabled=false — כבוי כברירת מחדל (מפעילים ידנית כשמוכן); skipShabbat=true — בטוח לישראל.
// enrollEnabled/sendEnabled = שני מתגי הכיבוי הנפרדים — סדרה חדשה כבויה בשניהם עד הפעלה ידנית.
export const makeEmptySequence = () => ({
  id: nextId(),
  key: '',
  name: '',
  enabled: false,
  enrollEnabled: false,
  sendEnabled: false,
  stopOnReply: true,
  skipShabbat: true,
  quietHoursStart: '21:00',
  quietHoursEnd: '08:00',
  steps: [makeEmptyStep()],
});
