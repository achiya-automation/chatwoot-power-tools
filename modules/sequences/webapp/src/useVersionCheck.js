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
  // null means either an older engine (which did not publish module metadata) or that the
  // first health response has not arrived yet. modulesReady distinguishes those two cases.
  const [enabledModules, setEnabledModules] = useState(null);
  const [modulesReady, setModulesReady] = useState(false);

  useEffect(() => {
    const mine = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : '';

    let alive = true;
    const check = async () => {
      try {
        const res = await fetch(`${API_BASE}/health`, { cache: 'no-store' });
        const data = await res.json();
        if (!alive || res.ok === false || !data || data.ok !== true) return;
        // A successful response without `modules` is an older, sequence-capable engine. Keep
        // the backward-compatible null value, but mark discovery complete so the app may load.
        setEnabledModules(Array.isArray(data.modules) ? data.modules : null);
        setModulesReady(true);
        // Only fire on a real, different id — never on missing/empty (older engine, dev).
        if (mine && data.build && data.build !== mine) setUpdateAvailable(true);
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

  return { updateAvailable, enabledModules, modulesReady };
}
