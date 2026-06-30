// JudgmentsPanel — bucket② LLM failure-verdict strip inside an AgentPanel (US-014).
//
// Source: dashboardReducer's `judgments[sessionId]`, fed by `{type:'judgment'}`
// SSE messages produced by `src/judgeRunner.js`. Each verdict carries the
// AgentErrorTaxonomy category (memory / reflection / planning / action /
// system / inconclusive), a one-line `rationale`, the model name, and an
// `episodeId` ("sessionId:signature").
//
// Parity note: this replaces the legacy `public/app.js#renderJudgments` panel.
// Empty-state mirrors that file's "no failure verdicts yet" placeholder so the panel always
// reserves room. Category palette is mapped onto the neon tokens used by the
// rest of the dashboard (no new colors introduced).
//
// Wire type stays open (`Judgment = { sessionId?, [k]: unknown }`) per the
// US-007/US-009 convention; we cast locally to a `VerdictShape` to read known
// fields, defaulting category to 'inconclusive' when missing.

import type { Judgment } from '@/types/dashboard';
import { cn } from '@/lib/utils';

export type JudgmentsPanelProps = {
  judgments: Judgment[] | undefined;
  maxVisible?: number;
};

type Category =
  | 'memory'
  | 'reflection'
  | 'planning'
  | 'action'
  | 'system'
  | 'inconclusive';

type VerdictShape = {
  episodeId?: string;
  category?: Category | string;
  rationale?: string;
  model?: string;
  ts?: string;
};

const CATEGORY_LABEL: Record<Category, string> = {
  memory: 'Memory',
  reflection: 'Reflection',
  planning: 'Planning',
  action: 'Action',
  system: 'System',
  inconclusive: 'Inconclusive',
};

// Map AgentErrorTaxonomy onto the dashboard's neon palette. Reuses the same
// CSS custom properties as eventChip so the visual language stays uniform.
const CATEGORY_TONE: Record<Category, { text: string; border: string; bg: string }> = {
  memory: {
    text: 'text-[var(--neon-blue)]',
    border: 'border-[var(--neon-blue)]/50',
    bg: 'bg-[var(--neon-blue)]/8',
  },
  reflection: {
    text: 'text-[var(--neon-mauve)]',
    border: 'border-[var(--neon-mauve)]/50',
    bg: 'bg-[var(--neon-mauve)]/8',
  },
  planning: {
    text: 'text-[var(--neon-teal)]',
    border: 'border-[var(--neon-teal)]/50',
    bg: 'bg-[var(--neon-teal)]/8',
  },
  action: {
    text: 'text-[var(--neon-peach)]',
    border: 'border-[var(--neon-peach)]/50',
    bg: 'bg-[var(--neon-peach)]/8',
  },
  system: {
    text: 'text-[var(--neon-red)]',
    border: 'border-[var(--neon-red)]/55',
    bg: 'bg-[var(--neon-red)]/10',
  },
  inconclusive: {
    text: 'text-muted-foreground',
    border: 'border-border',
    bg: 'bg-background/40',
  },
};

function asCategory(v: unknown): Category {
  if (typeof v === 'string' && v in CATEGORY_LABEL) return v as Category;
  return 'inconclusive';
}

function episodeSig(episodeId: string | undefined): string {
  if (!episodeId) return '';
  // Verdict episodeId is "<sessionId>:<signature>" — strip the sessionId for
  // display so the row stays readable inside a narrow panel.
  const parts = episodeId.split(':');
  return parts.length > 1 ? parts.slice(1).join(':') : episodeId;
}

export function JudgmentsPanel({ judgments, maxVisible = 6 }: JudgmentsPanelProps) {
  const list = (judgments ?? []) as VerdictShape[];

  if (list.length === 0) {
    return (
      <section
        aria-label="bucket two failure verdicts"
        className="rounded-md border border-dashed border-border/60 bg-background/40 px-3 py-2.5"
      >
        <div className="flex items-center justify-between text-[14px] uppercase tracking-wider text-muted-foreground">
          <span>Bucket② failure verdicts</span>
          <span className="font-mono normal-case text-[14px] text-muted-foreground/80">LLM · not factual</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground/80">No failure verdicts yet</p>
      </section>
    );
  }

  // Render most-recent first; cap at maxVisible so the panel doesn't blow up
  // when a stuck session accumulates many verdicts.
  const visible = list.slice(-maxVisible).reverse();
  const overflow = list.length - visible.length;

  return (
    <section
      aria-label="bucket two failure verdicts"
      className="rounded-md border border-border/60 bg-background/40 px-3 py-2.5"
    >
      <div className="flex items-center justify-between text-[14px] uppercase tracking-wider text-muted-foreground">
        <span>Bucket② failure verdicts</span>
        <span className="font-mono normal-case text-[14px] text-muted-foreground/80">
          LLM · not factual · {list.length}
        </span>
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {visible.map((v, i) => {
          const cat = asCategory(v.category);
          const tone = CATEGORY_TONE[cat];
          const sig = episodeSig(v.episodeId);
          const rationale = (v.rationale ?? '').trim();
          return (
            <li
              key={`${v.episodeId ?? ''}-${i}`}
              className={cn(
                'flex flex-col gap-1 rounded border-l-2 border border-border/40 px-2 py-1.5',
                tone.border,
                tone.bg,
              )}
            >
              <div className="flex items-center gap-2 text-[14px]">
                <span
                  className={cn(
                    'rounded-sm border px-1.5 font-mono uppercase tracking-wider',
                    tone.text,
                    tone.border,
                  )}
                >
                  {CATEGORY_LABEL[cat]}
                </span>
                <span className="truncate font-mono text-[14px] text-muted-foreground" title={sig}>
                  {sig}
                </span>
                {v.model ? (
                  <span className="ml-auto shrink-0 font-mono text-[14px] text-muted-foreground/70">
                    {v.model}
                  </span>
                ) : null}
              </div>
              {rationale ? (
                <p className="text-[15px] leading-relaxed text-foreground/85" title={rationale}>
                  {rationale}
                </p>
              ) : null}
            </li>
          );
        })}
        {overflow > 0 ? (
          <li className="px-1 text-[14px] uppercase tracking-wider text-muted-foreground/70">
            …{overflow} earlier verdicts
          </li>
        ) : null}
      </ul>
    </section>
  );
}
