// StageDetail — the rich, READABLE dashboard for one agent on the stage.
//   • Hero: RoleRadarExplorer — interactive polygon + synced legend + big selected-metric card.
//   • Capability ratios → big stat tiles (large numbers) each with a plain-language meaning.
//   • Core 7-dim → readable cards (rating WORD + meaning), not bare colors.
//   • Plus team / manager note / sub-agents / timeline.

import type {
  CapabilitySample, DimensionRating, Evaluation, Judgment, NormalizedEvent, Review, SessionSummary,
} from '@/types/dashboard';
import { Card, Cluster, Row, Stack, Truncate } from '@/components/ui/layout';
import { CORE_DIM_INFO, CAPABILITY_INFO } from '@/lib/metricInfo';
import { RoleRadarExplorer } from './RoleRadarExplorer';
import { BucketOneScore } from './BucketOneScore';
import { CapabilityChart } from './CapabilityChart';
import { TeamRollup } from './TeamRollup';
import { ReviewerNote } from './ReviewerNote';
import { SubAgentRoster } from './SubAgentRoster';
import { JudgmentsPanel } from './JudgmentsPanel';
import { SwimlaneTimeline } from './SwimlaneTimeline';

export type StageDetailProps = {
  session: SessionSummary;
  events: NormalizedEvent[];
  capabilityHistory: CapabilitySample[];
  review?: Review;
  judgments?: Judgment[];
};

const RATING_COLOR: Record<DimensionRating, string> = {
  good: 'var(--neon-green)', ok: 'var(--neon-overlay)', concern: 'var(--neon-red)',
};
const RATING_WORD: Record<DimensionRating, string> = { good: 'Good', ok: 'OK', concern: 'Concern' };

function projName(p: string | undefined): string {
  if (!p) return 'project';
  const a = p.replace(/\/+$/, '').split('/');
  return a[a.length - 1] || p;
}

function SectionHeading({ title, hint, right }: { title: string; hint?: string; right?: React.ReactNode }) {
  return (
    <Row className="mb-3 justify-between">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
      </div>
      {right ? <span className="shrink-0 font-mono text-xs text-muted-foreground/80">{right}</span> : null}
    </Row>
  );
}

// Big-number tile for a capability ratio.
function CapabilityTiles({ evaluation }: { evaluation?: Evaluation }) {
  const cap = (evaluation?.capability ?? {}) as unknown as Record<string, number | null>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {CAPABILITY_INFO.map((c) => (
        <Card key={c.key} className="bg-secondary/30 p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{c.label}</div>
          <div className="font-mono text-3xl font-semibold text-foreground">{c.fmt(cap[c.key] ?? null)}</div>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">{c.what}</p>
        </Card>
      ))}
    </div>
  );
}

// Readable card for each generic 7-dim — rating WORD + colour + what it measures.
function CoreDimCards({ evaluation }: { evaluation?: Evaluation }) {
  const dims = evaluation?.dimensions ?? {};
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Object.keys(CORE_DIM_INFO).map((k) => {
        const info = CORE_DIM_INFO[k];
        const rating = (dims[k]?.rating as DimensionRating) ?? 'ok';
        return (
          <Card key={k} className="bg-secondary/30 p-3">
            <Row className="justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{info.label}</span>
              <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold uppercase tracking-wider" style={{ color: RATING_COLOR[rating] }}>
                <span className="inline-flex h-2 w-2 rounded-full" style={{ background: RATING_COLOR[rating] }} />
                {RATING_WORD[rating]}
              </span>
            </Row>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">{info.what}</p>
          </Card>
        );
      })}
    </div>
  );
}

export function StageDetail({ session, events, capabilityHistory, review, judgments }: StageDetailProps) {
  const ev = session.evaluation;
  const role = session.mainRole?.role;

  return (
    <Stack className="gap-5">
      {/* Identity */}
      <Cluster className="gap-x-3 gap-y-1">
        <span className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: session.status === 'live' ? 'var(--neon-green)' : 'var(--neon-overlay)' }} />
        <h1 className="min-w-0 truncate text-3xl font-semibold text-foreground">{projName(session.project)}</h1>
        {role && role !== 'unknown' ? (
          <span className="shrink-0 rounded bg-neon-mauve/12 px-2 py-0.5 font-mono text-sm uppercase tracking-wider text-[var(--neon-mauve)]">{role}</span>
        ) : null}
        <span className="shrink-0 font-mono text-xs text-muted-foreground/55">{session.sessionId.slice(0, 8)}</span>
        {session.gitBranch ? (
          <span className="inline-flex min-w-0 max-w-[18rem] items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
            <span className="shrink-0 text-muted-foreground/70">branch</span>
            <Truncate className="font-mono text-foreground/85" title={session.gitBranch}>{session.gitBranch}</Truncate>
          </span>
        ) : null}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">{session.agentsLive}/{session.agentTotal} sub-agents · {session.eventCount} events</span>
      </Cluster>

      {/* Hero — interactive role radar */}
      <Card className="p-4">
        <SectionHeading
          title={`Role metrics${role && role !== 'unknown' ? ` · ${role}` : ''}`}
          hint="Quality dimensions specific to this agent's role. The polygon and the list are linked — hover or click either."
          right={ev?.roleOverlay ? `${Object.keys(ev.roleOverlay).length} facet${Object.keys(ev.roleOverlay).length === 1 ? '' : 's'}` : undefined}
        />
        <RoleRadarExplorer evaluation={ev} role={role} />
      </Card>

      {/* Bucket① score (existing big tiles) */}
      <BucketOneScore evaluation={ev} tokens={session.tokens} />

      {/* Capability ratios — big numbers */}
      <Card className="p-4">
        <SectionHeading title="Capability ratios" hint="How this agent works, as rolling ratios — like judging a developer's habits." />
        <CapabilityTiles evaluation={ev} />
      </Card>

      {/* Core 7-dim — readable */}
      <Card className="p-4">
        <SectionHeading title="Core engineering signals (7-dim)" hint="Generic process signals every agent is scored on." right={ev ? `${ev.overall.concerns}/7 flagged` : undefined} />
        <CoreDimCards evaluation={ev} />
      </Card>

      {/* Trend + team + manager note */}
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <SectionHeading title="Capability trend" hint="First-pass rate over recent activity." />
          <CapabilityChart history={capabilityHistory} />
        </Card>
        <Stack className="gap-4">
          <TeamRollup team={session.team} />
          <ReviewerNote review={review} />
        </Stack>
      </div>

      {/* Sub-agents + judgments + timeline */}
      <SubAgentRoster sessionId={session.sessionId} agents={session.agents} agentTotal={session.agentTotal} agentsLive={session.agentsLive} events={events} />
      <JudgmentsPanel judgments={judgments} />
      <SwimlaneTimeline events={events} title="Main session lane" />
    </Stack>
  );
}
