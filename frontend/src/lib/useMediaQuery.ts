// useMediaQuery — small wrapper around window.matchMedia for responsive layout
// decisions that the CSS layer can't express alone (e.g. "wrap secondary
// sections in <details> on narrow screens"). Pure read-only hook; consumers
// must NOT use it to drive critical SSR paint paths.

import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    setMatches(mq.matches);
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    // Safari <14 fallback
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, [query]);

  return matches;
}

// Narrow viewport convention used by AgentPanel to fold secondary sections.
export const NARROW_MAX_PX = 639;
export const NARROW_QUERY = `(max-width: ${NARROW_MAX_PX}px)`;
