import { useEffect, useMemo, useState } from 'react';
import { useDashboard } from '@/store/useDashboard';
import { useFilters } from '@/store/useFilters';
import { useNowMs } from '@/lib/useNowMs';
import { GlobalOverviewBar } from '@/components/dashboard/GlobalOverviewBar';
import { ProjectNav } from '@/components/dashboard/ProjectNav';
import { ProjectHeader } from '@/components/dashboard/ProjectHeader';
import { TrendsView } from '@/components/dashboard/TrendsView';
import { LlmSettings } from '@/components/dashboard/LlmSettings';
import { FilterBar } from '@/components/dashboard/FilterBar';
import { AgentGrid } from '@/components/dashboard/AgentGrid';
import { AgentPanel } from '@/components/dashboard/AgentPanel';
import { StageView } from '@/components/dashboard/StageView';

export function App() {
  const {
    sessionList,
    projects,
    totals,
    connection,
    schemaOk,
    schemaWarnings,
    events,
    capabilityHistory,
    reviews,
    judgments,
    lastEventTs,
  } = useDashboard();

  const { status, query, focusId, zoomId, projectId, density, setStatus, setQuery, setFocus, clearFocus, setZoom, setProject, setDensity, reset } =
    useFilters();

  // One shared low-frequency clock so relative "Nm ago" age labels keep advancing
  // even on an idle fleet (no SSE event needed). Threaded down to fmtAge call sites.
  const nowMs = useNowMs(20000);

  // Live grid vs per-project Trends view. Trends needs a selected project; if the
  // project filter clears, fall back to Live.
  const [view, setView] = useState<'live' | 'trends'>('live');
  const effectiveView = projectId ? view : 'live';
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Initial theme: prefer the persisted value (the index.html bootstrap already
  // applied the `dark` class before paint), falling back to the live class.
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof document === 'undefined') return 'light';
    try {
      const saved = localStorage.getItem('loopscore-theme');
      if (saved === 'dark' || saved === 'light') return saved;
    } catch { /* ignore */ }
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  });
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    try { localStorage.setItem('loopscore-theme', next); } catch { /* ignore */ }
  }

  // Density rides on <html data-density="..."> so CSS variables (US-013) cascade
  // everywhere without prop-drilling — including the StageView overlay.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.density = density;
  }, [density]);

  // Derive visible sessions + per-status counts in a single pass so the filter
  // bar's pill counters stay consistent with the grid render.
  const { visible, liveCount, idleCount } = useMemo(() => {
    const q = query.trim().toLowerCase();
    let live = 0;
    let idle = 0;
    const matched = [];
    for (const s of sessionList) {
      if (s.status === 'live') live += 1;
      else idle += 1;
      if (projectId && s.projectId !== projectId) continue;
      if (status !== 'all' && s.status !== status) continue;
      if (q) {
        const sid = s.sessionId.toLowerCase();
        const br = (s.gitBranch ?? '').toLowerCase();
        if (!sid.includes(q) && !br.includes(q)) continue;
      }
      matched.push(s);
    }
    return { visible: matched, liveCount: live, idleCount: idle };
  }, [sessionList, status, query, projectId]);

  const focusedSession = focusId ? sessionList.find((s) => s.sessionId === focusId) ?? null : null;
  // If the focus target ended (snapshot replace dropped it), clear focus so we
  // don't leave a phantom ?focus= in the URL. Filtered-out sessions are still
  // in sessionList, so the focused view stays visible — focus shouldn't be
  // tied to the FilterBar's current query.
  useEffect(() => {
    if (focusId && !focusedSession) clearFocus();
  }, [focusId, focusedSession, clearFocus]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <LlmSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <GlobalOverviewBar
        connection={connection}
        schemaOk={schemaOk}
        schemaWarnings={schemaWarnings}
        totals={totals}
        lastEventTs={lastEventTs}
        nowMs={nowMs}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <ProjectNav projects={projects} active={projectId} onPick={setProject} />

      {projectId && !focusedSession ? (
        <div className="flex items-center gap-5 border-b border-border px-4">
          {([['live', 'Now'], ['trends', 'Trends']] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`-mb-px border-b-2 px-1 py-2 text-sm font-medium transition-colors ${
                effectiveView === v
                  ? 'border-[var(--primary)] text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {focusedSession ? (
        <StageView
          staged={focusedSession}
          sessions={visible}
          events={events}
          capabilityHistory={capabilityHistory}
          reviews={reviews}
          judgments={judgments}
          onPick={setFocus}
          onExit={clearFocus}
        />
      ) : effectiveView === 'trends' && projectId ? (
        <main className="px-4 sm:px-6 py-6">
          <TrendsView projectId={projectId} />
        </main>
      ) : (
      <>
      {projectId ? (
        <ProjectHeader
          project={projects.find((p) => p.projectId === projectId)}
          sessions={visible}
        />
      ) : null}
      <FilterBar
        status={status}
        query={query}
        visibleCount={visible.length}
        totalCount={sessionList.length}
        liveCount={liveCount}
        idleCount={idleCount}
        density={density}
        onStatusChange={setStatus}
        onQueryChange={setQuery}
        onDensityChange={setDensity}
        onReset={reset}
      />

      <main className="px-4 sm:px-6 py-6">
        {sessionList.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No active sessions — they appear automatically once any Claude session runs.
          </p>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground space-y-2">
            <p>No sessions match the current filter / search.</p>
            <button
              type="button"
              onClick={reset}
              className="rounded-md border border-border px-3 py-1 font-mono text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground hover:border-foreground/30"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <AgentGrid
            maxColumns={density === 'compact' ? 4 : 3}
            minColumnPx={density === 'compact' ? 360 : 420}
          >
            {visible.map((s) => {
              const isZoomed = zoomId === s.sessionId;
              const dimmed = !!zoomId && !isZoomed;
              return (
                <div
                  key={s.sessionId}
                  className={`agent-cell${isZoomed ? ' agent-zoomed' : ''}${dimmed ? ' agent-dimmed' : ''}`}
                >
                  <AgentPanel
                    session={s}
                    events={events[s.sessionId] ?? []}
                    capabilityHistory={capabilityHistory[s.sessionId] ?? []}
                    review={reviews[s.sessionId]}
                    judgments={judgments[s.sessionId]}
                    nowMs={nowMs}
                    onFocus={setFocus}
                    onZoom={() => setZoom(isZoomed ? null : s.sessionId)}
                    zoomed={isZoomed}
                  />
                </div>
              );
            })}
          </AgentGrid>
        )}
      </main>
      </>
      )}
    </div>
  );
}
