import Button from './ui/Button.jsx';
import useT from '../useT.js';

/*
 * UpdateBanner — shown when useVersionCheck detects the server is serving a newer build than the
 * one this tab loaded. A quiet amber strip with a Refresh button; the user stays in control (no
 * auto-reload that could interrupt work). The n-amber-* / n-* tokens are theme-aware, so it reads
 * correctly in light and dark.
 */
const M = {
  he: { updateAvailable: 'גרסה חדשה זמינה', refresh: 'רענן' },
  en: { updateAvailable: 'A new version is available', refresh: 'Refresh' },
};

export default function UpdateBanner() {
  const t = useT(M);
  return (
    <div
      role="status"
      className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-n-amber-7 bg-n-amber-3 px-4 py-2 text-sm text-n-amber-12"
    >
      <span className="flex items-center gap-2">
        <span aria-hidden="true">🔄</span>
        {t('updateAvailable')}
      </span>
      <Button variant="solid" color="blue" size="sm" onClick={() => window.location.reload()}>
        {t('refresh')}
      </Button>
    </div>
  );
}
