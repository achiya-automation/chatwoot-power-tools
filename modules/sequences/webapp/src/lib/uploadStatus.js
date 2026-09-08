import { createContext, useContext, useEffect } from 'react';

export const UploadStatusContext = createContext(null);

export function useUploadStatus(busy) {
  const report = useContext(UploadStatusContext);
  useEffect(() => {
    if (!busy || !report) return undefined;
    report(1);
    return () => report(-1);
  }, [busy, report]);
}
