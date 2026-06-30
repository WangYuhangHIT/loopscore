import type { ConnectionState } from '@/types/dashboard';
import type { DashboardTotals } from '@/store/useDashboard';
import { cn } from '@/lib/utils';

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connecting: 'Connecting',
  open: 'Connected',
  reconnecting: 'Reconnecting',
  closed: 'Disconnected',
  error: 'Connection error',
};

const CONNECTION_TONE: Record<ConnectionState, string> = {
  connecting: 'text-muted-foreground',
  open: 'text-[var(--neon-green)]',
  reconnecting: 'text-[var(--neon-yellow)]',
  closed: 'text-[var(--neon-red)]',
  error: 'text-[var(--neon-red)]',
};

// k/M token compact formatting — the aggregate easily reaches millions in long
// sessions, and a raw `5,789,234` reads worse than `5.8M` in the overview pill.
function fmtCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return n.toLocaleString();
}

function fmtAge(lastTs: number | null | undefined, nowMs: number): string {
  if (!lastTs) return '—';
  const s = Math.max(0, Math.round((nowMs - lastTs) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export type GlobalOverviewBarProps = {
  connection: ConnectionState;
  schemaOk: boolean;
  schemaWarnings: string[];
  totals: DashboardTotals;
  lastEventTs: number | null;
  nowMs: number;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onOpenSettings: () => void;
};

export function GlobalOverviewBar({
  connection,
  schemaOk,
  schemaWarnings,
  totals,
  lastEventTs,
  nowMs,
  theme,
  onToggleTheme,
  onOpenSettings,
}: GlobalOverviewBarProps) {
  // Overall posture: any session live → running (mauve pulse). Otherwise idle.
  // Distinct from the connection state on the right — connection reflects the
  // SSE socket; posture reflects whether agents are actively working.
  const systemLive = totals.sessionsLive > 0;
  // Concerns aggregate red when ≥1, dimmed otherwise.
  const concernsLive = totals.concernsTotal > 0;

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-card/40 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 sm:px-6 py-3 text-sm">
        <span className="inline-flex items-center gap-2">
          <span
            className="inline-flex h-5 w-5 shrink-0 rounded-md"
            style={{ background: 'linear-gradient(135deg, var(--neon-mauve), var(--neon-sky))' }}
            aria-hidden
          />
          <span className="text-lg font-bold tracking-tight text-foreground">LoopScore</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">Multi-agent monitor</span>
        </span>

        <PosturePill live={systemLive} liveCount={totals.sessionsLive} />

        <Pill
          label="Live / total sessions"
          value={`${totals.sessionsLive}/${totals.sessionsTotal}`}
          live={totals.sessionsLive > 0}
        />
        <Pill
          label="Live / total sub-agents"
          value={`${totals.agentsLive}/${totals.agentsTotal}`}
          live={totals.agentsLive > 0}
        />
        <TokenPill
          totalTokens={totals.tokensTotal}
          inputTokens={totals.tokensInput}
          outputTokens={totals.tokensOutput}
        />
        <ConcernsPill count={totals.concernsTotal} live={concernsLive} />
        <Pill
          label="Recent delta"
          value={lastEventTs ? fmtAge(lastEventTs, nowMs) : '—'}
        />

        {/* Right cluster: connection status + theme + settings, one tidy group (no
            more fixed overlay colliding with the status text). */}
        <div className="ml-auto flex items-center gap-1">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xs',
              CONNECTION_TONE[connection],
            )}
            title={CONNECTION_LABEL[connection]}
          >
            <span
              className={cn(
                'inline-flex h-2 w-2 rounded-full bg-current',
                connection === 'open' && 'shadow-[0_0_8px_var(--neon-green)]',
              )}
            />
            <span className="hidden sm:inline">{CONNECTION_LABEL[connection]}</span>
          </span>

          <span className="mx-1 h-5 w-px bg-border" aria-hidden />

          <IconButton
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
            label="toggle theme"
          >
            {theme === 'dark' ? '☀' : '🌙'}
          </IconButton>
          <IconButton onClick={onOpenSettings} title="LLM settings" label="LLM settings">
            ⚙
          </IconButton>
        </div>
      </div>

      {!schemaOk && schemaWarnings.length > 0 ? (
        <div
          role="alert"
          aria-live="polite"
          className="border-t border-[var(--neon-yellow)]/50 bg-[var(--neon-yellow)]/12 px-4 sm:px-6 py-2 text-xs text-[var(--neon-yellow)]"
        >
          <span className="font-semibold tracking-wide">⚠ format drift</span>
          <span className="ml-2 text-[var(--neon-yellow)]/85">
            {schemaWarnings.join(' / ')}
          </span>
          <span className="ml-2 text-[14px] uppercase tracking-widest text-[var(--neon-yellow)]/65">
            schema-warning · {schemaWarnings.length}
          </span>
        </div>
      ) : null}
    </header>
  );
}

// Consistent icon button for the header right cluster (theme / settings). Square,
// rounded hover background — replaces the old free-floating fixed-position buttons.
function IconButton({
  onClick, title, label, children,
}: { onClick: () => void; title: string; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={label}
      className="grid h-8 w-8 place-items-center rounded-md text-base text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      {children}
    </button>
  );
}

function Pill({
  label,
  value,
  live = false,
}: {
  label: string;
  value: string;
  live?: boolean;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          'font-mono text-sm',
          live ? 'text-[var(--neon-green)]' : 'text-foreground',
        )}
      >
        {value}
      </span>
    </span>
  );
}

// Overall live/idle posture — a chip with a pulsing mauve dot when at least one
// session is live, else a dimmed grey "idle" chip. Sits before the per-metric
// pills so the system-wide state is the first thing a user sees.
function PosturePill({ live, liveCount }: { live: boolean; liveCount: number }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs',
        live
          ? 'border-neon-mauve/40 bg-neon-mauve/10 text-[var(--neon-mauve)]'
          : 'border-border bg-card/30 text-muted-foreground',
      )}
      title={live ? `${liveCount} sessions working` : 'All sessions idle'}
    >
      <span
        className={cn(
          'inline-flex h-2 w-2 rounded-full',
          live ? 'bg-[var(--neon-mauve)] shadow-[0_0_8px_var(--neon-mauve)] animate-pulse' : 'bg-muted-foreground/60',
        )}
      />
      <span className="font-semibold tracking-wide uppercase">
        {live ? 'Live' : 'Idle'}
      </span>
    </span>
  );
}

// Aggregate token pill with a small input/output breakdown subtitle so users
// see cost composition without opening a panel.
function TokenPill({
  totalTokens,
  inputTokens,
  outputTokens,
}: {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
}) {
  return (
    <span className="inline-flex flex-col items-start leading-tight">
      <span className="inline-flex items-baseline gap-1.5">
        <span className="text-xs text-muted-foreground">Aggregate tokens</span>
        <span className="font-mono text-sm text-foreground">{fmtCompact(totalTokens)}</span>
      </span>
      <span className="font-mono text-[14px] text-muted-foreground">
        in {fmtCompact(inputTokens)} · out {fmtCompact(outputTokens)}
      </span>
    </span>
  );
}

// Surface aggregate dimension concerns from the 7-dim evaluator across every
// active panel. Tinted neon-red when ≥1 so a degrading fleet is unmistakable.
function ConcernsPill({ count, live }: { count: number; live: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-xs text-muted-foreground">Concerns</span>
      <span
        className={cn(
          'font-mono text-sm',
          live ? 'text-[var(--neon-red)]' : 'text-foreground/70',
        )}
      >
        {count}
      </span>
    </span>
  );
}
