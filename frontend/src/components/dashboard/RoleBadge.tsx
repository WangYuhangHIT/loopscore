// RoleBadge — role chip with a manual-override dropdown (design §4.2 "manual selection").
// Picking a role POSTs to /api/sessions/:id/agents/:agentId/role; the server broadcasts
// a refreshed session summary so the badge updates via SSE. "Auto" clears the override
// (reverts to fingerprint/LLM). Manual choices win over auto and show a lock hint.

import type { Role } from '@/types/dashboard';

export type RoleBadgeProps = {
  sessionId: string;
  agentId: string; // 'main' for the main lane
  role?: Role;
  tone?: 'sky' | 'mauve';
};

// label → facet set the server maps back to a role name (must use the 6 atomic facets).
const ROLE_OPTIONS: { label: string; facets: string[] }[] = [
  { label: 'Auto', facets: [] },
  { label: 'frontend', facets: ['frontend'] },
  { label: 'backend', facets: ['backend'] },
  { label: 'database', facets: ['database'] },
  { label: 'fullstack', facets: ['frontend', 'backend'] },
  { label: 'backend+database', facets: ['backend', 'database'] },
  { label: 'algorithm', facets: ['algorithm'] },
  { label: 'test', facets: ['test'] },
  { label: 'pm', facets: ['pm'] },
];

function facetsFor(label: string): string[] {
  return ROLE_OPTIONS.find((o) => o.label === label)?.facets ?? [];
}

export function RoleBadge({ sessionId, agentId, role, tone = 'sky' }: RoleBadgeProps) {
  const current = role?.role && role.role !== 'unknown' ? role.role : 'Auto';
  // The server may report a role name that isn't one of our ROLE_OPTIONS labels
  // (e.g. a composite the dropdown doesn't enumerate). A controlled <select>
  // whose value matches no <option> renders blank + warns; surface it as an extra
  // (disabled) option so the badge shows the real current role.
  const isKnownOption = ROLE_OPTIONS.some((o) => o.label === current);
  const isManual = role?.source === 'manual';
  const color = tone === 'mauve' ? 'var(--neon-mauve)' : 'var(--neon-sky)';
  const bg = tone === 'mauve' ? 'rgba(203,166,247,0.15)' : 'rgba(137,220,235,0.15)';

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const facets = facetsFor(e.target.value);
    try {
      await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(agentId)}/role`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ facets }),
      });
    } catch { /* network error: leave UI as-is; next SSE will reconcile */ }
  }

  const title = role
    ? `role: ${role.role} · ${Math.round((role.confidence ?? 0) * 100)}% · ${role.source}${isManual ? ' (locked)' : ''} — pick to override`
    : 'pick a role to override';

  return (
    <span
      className="inline-flex min-w-0 max-w-[7rem] shrink items-center gap-0.5 rounded px-1 text-[14px] uppercase tracking-wider"
      style={{ color, background: bg }}
      title={title}
      onClick={(e) => e.stopPropagation()}
    >
      {isManual ? <span aria-label="manual override">🔒</span> : null}
      {/* A native select sizes to its WIDEST option ("backend+database"), which overflows
          narrow rows — cap its width and let the chosen value truncate; the dropdown still
          shows full labels. */}
      <select
        value={current}
        onChange={onChange}
        onClick={(e) => e.stopPropagation()}
        aria-label={`role for ${agentId}`}
        className="cursor-pointer truncate appearance-none bg-transparent text-[14px] uppercase tracking-wider focus:outline-none"
        style={{ color, maxWidth: '6rem' }}
      >
        {!isKnownOption ? (
          <option value={current} disabled className="bg-card text-foreground normal-case">
            {current}
          </option>
        ) : null}
        {ROLE_OPTIONS.map((o) => (
          <option key={o.label} value={o.label} className="bg-card text-foreground normal-case">
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}
