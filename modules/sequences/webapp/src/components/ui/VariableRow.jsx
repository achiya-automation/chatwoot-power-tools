import Dropdown from './Dropdown.jsx';
import Input from './Input.jsx';
import useT from '../../useT.js';

/*
 * VariableRow — שורת משתנה של תבנית: בורר שדה (שם/טלפון/אימייל/מותאם) + קלט טקסט
 * שמופיע רק כשנבחר "ערך מותאם אישית". אחסון ב-params[i]:
 *   שדה מערכת → '@first_name' / '@name' / '@phone' / '@email'
 *   מותאם     → הטקסט המילולי (כולל ריק)
 *
 * משותף לעורך הרצפים (StepCard) ולשליחה מחדש של קמפיין (ResendDialog); MessageBubble
 * מציג את אותם טוקנים כצ'יפ בתצוגה המקדימה.
 */

// מילון co-located (he/en)
const M = {
  he: {
    sysFirstName: 'שם פרטי', sysFullName: 'שם מלא', sysPhone: 'טלפון', sysEmail: 'אימייל',
    sysCustom: 'ערך מותאם אישית',
    varRowLabel: 'משתנה {n} — ערך:', varSelectAria: 'ערך למשתנה {n}',
    varCustomAria: 'ערך מותאם למשתנה {n}', freeText: 'טקסט חופשי',
  },
  en: {
    sysFirstName: 'First name', sysFullName: 'Full name', sysPhone: 'Phone', sysEmail: 'Email',
    sysCustom: 'Custom value',
    varRowLabel: 'Variable {n} — value:', varSelectAria: 'Value for variable {n}',
    varCustomAria: 'Custom value for variable {n}', freeText: 'Free text',
  },
};

export const SYSTEM_FIELDS = [
  { value: '@first_name', labelKey: 'sysFirstName' },
  { value: '@name', labelKey: 'sysFullName' },
  { value: '@phone', labelKey: 'sysPhone' },
  { value: '@email', labelKey: 'sysEmail' },
  { value: '@custom', labelKey: 'sysCustom' },
];

// ערך מאוחסן הוא שדה מערכת אם ורק אם הוא בדיוק אחד מהטוקנים
export function isSystemField(v) {
  return v === '@first_name' || v === '@name' || v === '@phone' || v === '@email';
}

export default function VariableRow({ index, value, example, onChange }) {
  const t = useT(M);
  const custom = !isSystemField(value);
  // הערך לבורר: '@name'/'@phone'/'@email' או '@custom' כשזה ערך מותאם
  const selectValue = custom ? '@custom' : value;
  // תוויות שדות המערכת מתורגמות כאן (המזהים קבועים ב-SYSTEM_FIELDS)
  const options = SYSTEM_FIELDS.map((f) => ({ value: f.value, label: t(f.labelKey) }));

  const onSelect = (v) => {
    // מעבר לשדה מערכת → מאחסנים את הטוקן; מעבר ל"מותאם" → מתחילים מטקסט ריק
    onChange(v === '@custom' ? '' : v);
  };

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-n-slate-12">{t('varRowLabel', { n: index + 1 })}</label>
      <Dropdown
        options={options}
        value={selectValue}
        onChange={onSelect}
        ariaLabel={t('varSelectAria', { n: index + 1 })}
      />
      {custom ? (
        <Input
          className="mt-2"
          aria-label={t('varCustomAria', { n: index + 1 })}
          value={value}
          placeholder={example || t('freeText')}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : null}
    </div>
  );
}
