// BucketOneScore — deterministic bucket① readouts inside an AgentPanel (US-007).
//
// The shape is fully derived from `evaluator.js`:
//   verification.{testsRun, finishWithoutTest, rating}
//   debugging.{sameErrorStreak, editsSinceLastGreen, flagged, rating}
//   autonomy.{userTurns, interventions, toolCallsPerUserTurn, rating}
//   usage.{bySkill,byHook,byMcp,byTool}: Record<string, number>
//   session.tokens.{input,output,total}
//
// We only surface the headline number(s) + rating tone here. The full 7-dim
// readout lives in the future RadarPanel (US-009); the bucket① block is the
// "fast triage" view.

import type { Evaluation, SessionTokens } from '@/types/dashboard';
import { cn } from '@/lib/utils';

export type BucketOneScoreProps = {
  evaluation: Evaluation | undefined;
  tokens: SessionTokens | undefined;
};

type Rating = 'good' | 'ok' | 'concern';

type VerificationMetrics = { testsRun?: number; finishWithoutTest?: boolean; rating: Rating };
type DebuggingMetrics = { sameErrorStreak?: number; editsSinceLastGreen?: number; flagged?: boolean; rating: Rating };
type AutonomyMetrics = { userTurns?: number; interventions?: number; toolCallsPerUserTurn?: number; rating: Rating };
type UsageBuckets = { bySkill?: Record<string, number>; byHook?: Record<string, number>; byMcp?: Record<string, number>; byTool?: Record<string, number> };

const RATING_TONE: Record<Rating, string> = {
  good: 'text-[var(--neon-green)] border-[var(--neon-green)]/40 bg-[var(--neon-green)]/8',
  ok: 'text-foreground/85 border-border bg-secondary/40',
  concern: 'text-[var(--neon-red)] border-[var(--neon-red)]/45 bg-[var(--neon-red)]/10',
};

function fmt(n: number | undefined | null): string {
  if (n == null) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function fmtTokens(n: number | undefined): string {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function totalCount(buckets: Record<string, number> | undefined): number {
  if (!buckets) return 0;
  let t = 0;
  for (const v of Object.values(buckets)) t += v || 0;
  return t;
}

export function BucketOneScore({ evaluation, tokens }: BucketOneScoreProps) {
  if (!evaluation) {
    return (
      <div className="rounded-md border border-dashed border-border/70 bg-background/40 px-3 py-3 text-center text-xs text-muted-foreground">
        No bucket① evaluation yet — waiting for first output
      </div>
    );
  }

  const verification = evaluation.dimensions.verification as VerificationMetrics | undefined;
  const debugging = evaluation.dimensions.debugging as DebuggingMetrics | undefined;
  const autonomy = evaluation.dimensions.autonomy as AutonomyMetrics | undefined;
  const usage = (evaluation.usage as UsageBuckets) || {};

  const usageTotal =
    totalCount(usage.byTool) +
    totalCount(usage.bySkill) +
    totalCount(usage.byHook) +
    totalCount(usage.byMcp);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[14px] uppercase tracking-wider text-muted-foreground">
        <span>Bucket① score</span>
        <span className="font-mono normal-case text-[14px] text-muted-foreground/80">
          {evaluation.overall.label} · {evaluation.overall.concerns}/7 flagged
        </span>
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        <Tile
          tone={verification?.rating ?? 'ok'}
          label="test"
          primary={fmt(verification?.testsRun)}
          hint={verification?.finishWithoutTest ? 'untested⚠' : 'tested'}
        />
        <Tile
          tone={debugging?.rating ?? 'ok'}
          label="Loop"
          primary={fmt(debugging?.sameErrorStreak)}
          hint={debugging?.flagged ? 'looping⚠' : 'ok'}
        />
        <Tile
          tone={autonomy?.rating ?? 'ok'}
          label="Autonomy"
          primary={fmt(autonomy?.toolCallsPerUserTurn)}
          hint={`interventions ${autonomy?.interventions ?? 0}`}
        />
        <Tile
          tone="ok"
          label="Usage"
          primary={fmt(usageTotal)}
          hint={`tools ${Object.keys(usage.byTool ?? {}).length}`}
        />
        <Tile
          tone="ok"
          label="token"
          primary={fmtTokens(tokens?.total)}
          hint={`in ${fmtTokens(tokens?.input)} / out ${fmtTokens(tokens?.output)}`}
        />
      </div>
    </div>
  );
}

function Tile({
  tone,
  label,
  primary,
  hint,
}: {
  tone: Rating;
  label: string;
  primary: string;
  hint: string;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col items-stretch rounded border px-1.5 py-1',
        RATING_TONE[tone],
      )}
    >
      <span className="text-[13px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="truncate font-mono text-sm leading-tight">{primary}</span>
      <span className="truncate text-[13px] text-muted-foreground">{hint}</span>
    </div>
  );
}
