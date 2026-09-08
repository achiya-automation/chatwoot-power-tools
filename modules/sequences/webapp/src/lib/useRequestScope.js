import { useCallback, useEffect, useRef } from 'react';

// A response may update the screen only while its account/entity/opening is current.
// Calling begin again also invalidates an older refresh of that same screen.
export default function useRequestScope(scope) {
  const state = useRef({ scope, version: 0, mounted: true });
  if (state.current.scope !== scope) {
    state.current.scope = scope;
    state.current.version += 1;
  }
  useEffect(() => {
    state.current.mounted = true;
    return () => { state.current.mounted = false; state.current.version += 1; };
  }, []);
  return useCallback(() => {
    const version = ++state.current.version;
    return () => state.current.mounted && state.current.version === version;
  }, []);
}
