// useNowMs — a single low-frequency clock tick shared across the app so relative
// "Nm ago" / "Ns ago" age labels keep advancing on an idle fleet (no SSE event
// required). Mount ONE of these high up (App) and thread the value down to every
// fmtAge call site instead of calling Date.now() during render — that keeps it
// cheap (one interval, not one per panel).

import { useEffect, useState } from 'react';

export function useNowMs(intervalMs = 20000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
