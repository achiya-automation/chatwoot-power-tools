// basepath — derives the smart-import module's vendor asset URL from the addons base
// injected by the dashboard-script (window.__CW_ADDONS_BASE). Zero hardcoded domain/path;
// falls back to the default single route (/chatwoot-addons) when no base is injected.
export const vendorUrl = (base) => (base || '/chatwoot-addons') + '/smart-import/xlsx.mini.min.js';
