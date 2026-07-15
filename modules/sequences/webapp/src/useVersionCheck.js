import { useEffect, useState } from 'react';
import { API_BASE } from './config.js';

/*
 * useVersionCheck — did the server ship a newer build than the one this tab is running?
 *
 * __BUILD_ID__ is compiled into this bundle at Vite build time (vite.config.js). The engine reads
 * the build id of the bundle it currently serves out of index.html and returns it on
 * /drip-api/health. When the two differ, a newer build is live and this tab is stale — the caller
 * shows a "refresh" banner. This matters most in Chatwoot's mobile WebView, which happily holds a
 * cached old bundle for a long time; without this the agent never learns an update exists.
 *
 * Checks on mount, every 60s, and whenever the tab becomes visible (catches "opened it an hour
 * later"). Network/engine errors are swallowed — a blip must never nag the user with a false
 * banner, and it re-checks on the next tick anyway.
 */
export default function useVersionCheck() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    const mine = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : '';
    if (!mine) return undefined; // dev server has no build id → feature simply off

    let alive = true;
    const check = async () => {
      try {
        const res = await fetch(`${API_BASE}/health`, { cache: 'no-store' });
        const data = await res.json();
        // Only fire on a real, different id — never on missing/empty (older engine, dev).
        if (alive && data && data.build && data.build !== mine) setUpdateAvailable(true);
      } catch {
        /* offline / engine restarting → ignore; next tick retries */
      }
    };

    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    const timer = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', onVisible);
    check();

    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return updateAvailable;
}
