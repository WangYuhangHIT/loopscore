// ProjectNav — top-level project switcher. LoopScore now watches the whole
// ~/.claude/projects root, so a session belongs to a project; this nav filters
// the grid to one project (or All). Hidden when there's only one project.

import type { ProjectSummary } from '@/types/dashboard';
import { cn } from '@/lib/utils';

export type ProjectNavProps = {
  projects: ProjectSummary[];
  active: string | null;
  onPick: (id: string | null) => void;
};

export function ProjectNav({ projects, active, onPick }: ProjectNavProps) {
  if (!projects || projects.length <= 1) return null;

  const Item = ({ id, label, live }: { id: string | null; label: string; live?: number }) => (
    <button
      type="button"
      onClick={() => onPick(id)}
      className={cn(
        'rounded px-2 py-1 text-xs font-mono whitespace-nowrap transition-colors',
        (active ?? null) === id
          ? 'bg-neon-sky/20 text-[var(--neon-sky)]'
          : 'text-muted-foreground hover:text-foreground hover:bg-background/50',
      )}
    >
      {label}
      {live ? <span className="ml-1 text-[var(--neon-green)]">●{live}</span> : null}
    </button>
  );

  return (
    <nav aria-label="projects" className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-1.5">
      <Item id={null} label="All projects" />
      {projects.map((p) => (
        <Item key={p.projectId} id={p.projectId} label={p.name} live={p.live} />
      ))}
    </nav>
  );
}
