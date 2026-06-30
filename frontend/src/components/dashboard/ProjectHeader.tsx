// ProjectHeader — identity bar for the selected project (addresses "weak project/role identity").
// Shows the project name + path + session counts, and a role-composition row (which
// developer roles are active across this project's sessions) so the page reads as
// "a project and its team", not a wall of UUID cards.

import type { ProjectSummary, SessionSummary } from '@/types/dashboard';

export type ProjectHeaderProps = { project?: ProjectSummary; sessions: SessionSummary[] };

export function ProjectHeader({ project, sessions }: ProjectHeaderProps) {
  if (!project) return null;

  const roleCounts: Record<string, number> = {};
  for (const s of sessions) {
    const r = s.mainRole?.role;
    if (r && r !== 'unknown') roleCounts[r] = (roleCounts[r] ?? 0) + 1;
  }
  const roles = Object.entries(roleCounts).sort((a, b) => b[1] - a[1]);

  return (
    <header className="px-4 sm:px-6 pt-5 pb-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold text-foreground">{project.name}</h1>
        {project.path ? <span className="font-mono text-xs text-muted-foreground/80">{project.path}</span> : null}
        <span className="ml-auto text-sm text-muted-foreground">
          {project.sessions} session{project.sessions === 1 ? '' : 's'}
          {project.live > 0 ? <> · <span className="text-[var(--neon-green)]">{project.live} running</span></> : null}
        </span>
      </div>
      {roles.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs uppercase tracking-wider text-muted-foreground/70">Roles</span>
          {roles.map(([r, n]) => (
            <span key={r} className="rounded-md bg-neon-mauve/12 px-2 py-0.5 font-mono text-xs text-[var(--neon-mauve)]">
              {r}{n > 1 ? ` ×${n}` : ''}
            </span>
          ))}
        </div>
      ) : null}
    </header>
  );
}
