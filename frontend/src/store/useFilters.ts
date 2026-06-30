// useFilters — owns the dashboard interaction state (status filter, search
// query, focused sessionId, density) and persists it to the URL so a reload
// or copy/paste preserves the view. Single source of truth for the four
// controls; consumers read state + setters and never call window.history
// directly.
//
// URL contract (all optional):
//   ?status=live|idle      — omitted = all
//   ?q=<text>              — case-insensitive contains match on sessionId/branch
//   ?focus=<sessionId>     — when set, StageView is mounted as the inline stage
//   ?density=compact       — omitted = comfortable (US-013)
//
// `popstate` listener keeps the in-memory state aligned with browser back/forward.

import { useCallback, useEffect, useState } from 'react';

export type StatusFilter = 'all' | 'live' | 'idle';
export type Density = 'comfortable' | 'compact';

export type FilterState = {
  status: StatusFilter;
  query: string;
  focusId: string | null;
  zoomId: string | null;
  projectId: string | null;
  density: Density;
};

const STATUS_VALUES: ReadonlyArray<StatusFilter> = ['all', 'live', 'idle'];
const DENSITY_VALUES: ReadonlyArray<Density> = ['comfortable', 'compact'];

function parseStatus(raw: string | null): StatusFilter {
  if (!raw) return 'all';
  return (STATUS_VALUES as readonly string[]).includes(raw) ? (raw as StatusFilter) : 'all';
}

function parseDensity(raw: string | null): Density {
  if (!raw) return 'comfortable';
  return (DENSITY_VALUES as readonly string[]).includes(raw) ? (raw as Density) : 'comfortable';
}

function readUrl(): FilterState {
  if (typeof window === 'undefined') {
    return { status: 'all', query: '', focusId: null, zoomId: null, projectId: null, density: 'comfortable' };
  }
  const sp = new URLSearchParams(window.location.search);
  return {
    status: parseStatus(sp.get('status')),
    query: sp.get('q') ?? '',
    focusId: sp.get('focus'),
    zoomId: sp.get('zoom'),
    projectId: sp.get('project'),
    density: parseDensity(sp.get('density')),
  };
}

function writeUrl(next: FilterState): void {
  if (typeof window === 'undefined') return;
  const sp = new URLSearchParams(window.location.search);
  if (next.status === 'all') sp.delete('status');
  else sp.set('status', next.status);
  if (next.query.trim() === '') sp.delete('q');
  else sp.set('q', next.query);
  if (!next.focusId) sp.delete('focus');
  else sp.set('focus', next.focusId);
  if (!next.zoomId) sp.delete('zoom');
  else sp.set('zoom', next.zoomId);
  if (!next.projectId) sp.delete('project');
  else sp.set('project', next.projectId);
  if (next.density === 'comfortable') sp.delete('density');
  else sp.set('density', next.density);
  const search = sp.toString();
  const url = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`;
  window.history.replaceState(null, '', url);
}

export type UseFiltersResult = FilterState & {
  setStatus: (s: StatusFilter) => void;
  setQuery: (q: string) => void;
  setFocus: (id: string | null) => void;
  clearFocus: () => void;
  setZoom: (id: string | null) => void;
  setProject: (id: string | null) => void;
  setDensity: (d: Density) => void;
  reset: () => void;
};

export function useFilters(): UseFiltersResult {
  const [state, setState] = useState<FilterState>(() => readUrl());

  // Sync URL whenever state changes.
  useEffect(() => {
    writeUrl(state);
  }, [state]);

  // Honor browser back/forward — pull state back from the URL.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPop = () => setState(readUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const setStatus = useCallback((s: StatusFilter) => {
    setState((prev) => (prev.status === s ? prev : { ...prev, status: s }));
  }, []);
  const setQuery = useCallback((q: string) => {
    setState((prev) => (prev.query === q ? prev : { ...prev, query: q }));
  }, []);
  const setFocus = useCallback((id: string | null) => {
    setState((prev) => (prev.focusId === id ? prev : { ...prev, focusId: id }));
  }, []);
  const clearFocus = useCallback(() => {
    setState((prev) => (prev.focusId === null ? prev : { ...prev, focusId: null }));
  }, []);
  const setZoom = useCallback((id: string | null) => {
    setState((prev) => (prev.zoomId === id ? prev : { ...prev, zoomId: id }));
  }, []);
  const setProject = useCallback((id: string | null) => {
    setState((prev) => (prev.projectId === id ? prev : { ...prev, projectId: id }));
  }, []);
  const setDensity = useCallback((d: Density) => {
    setState((prev) => (prev.density === d ? prev : { ...prev, density: d }));
  }, []);
  // Reset preserves density (it's a user preference, not a filter).
  const reset = useCallback(() => {
    setState((prev) => ({ status: 'all', query: '', focusId: null, zoomId: null, projectId: null, density: prev.density }));
  }, []);

  return { ...state, setStatus, setQuery, setFocus, clearFocus, setZoom, setProject, setDensity, reset };
}
