import { colors } from './src/theme-colors.js';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors,
      // זהה ל-tailwind.config.js של Chatwoot — מדרגת מיקרו לטקסטים קטנים
      fontSize: {
        xxs: '0.625rem',
      },
      fontFamily: {
        // זהה ל-Chatwoot: Inter כברירת מחדל
        inter: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        interDisplay: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontWeight: {
        420: '420',
        440: '440',
        460: '460',
        520: '520',
        620: '620',
      },
    },
  },
  plugins: [],
};
