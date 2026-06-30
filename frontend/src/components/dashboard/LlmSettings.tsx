// LlmSettings — full LLM configuration UI (judge / manager-note / role re-check).
// Edit everything from here: toggle judging on/off, add / edit / delete providers,
// switch the active one, and paste each provider's API key. Changes apply LIVE (the
// server hot-reapplies) and persist (non-secrets → gitignored loopscore.local.json).
//
// SECURITY: the API key is the one secret. It is sent to the server (POST setKey),
// written ONLY to the gitignored .env, and NEVER returned — so the key field shows
// presence (✅ set / ❌ none) but is never pre-filled with a value.

import { useEffect, useState } from 'react';

export type LlmProvider = {
  id: string; provider: string | null; model: string | null; baseUrl: string | null;
  temperature: number | null; userAgent: string | null; maxTokens: number | null;
  keyEnv: string; keyPresent: boolean; active: boolean;
};

export type LlmSettingsProps = { open: boolean; onClose: () => void };

type Draft = {
  id: string; provider: string; baseUrl: string; model: string;
  temperature: string; userAgent: string; apiKeyEnv: string;
};

const PROVIDER_KINDS = ['anthropic', 'anthropic-compatible', 'openai-compatible', 'openai'];
const EMPTY: Draft = { id: '', provider: 'anthropic', baseUrl: '', model: '', temperature: '0', userAgent: 'loopscore/1.0', apiKeyEnv: 'LOOPSCORE_JUDGE_KEY' };

export function LlmSettings({ open, onClose }: LlmSettingsProps) {
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Draft | null>(null); // open form (new or edit)
  const [isNew, setIsNew] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [note, setNote] = useState<string | null>(null);

  function load() {
    fetch('/api/config/llm').then((r) => r.json()).then((d) => {
      setProviders(d.providers ?? []);
      setActive(d.active ?? null);
      setEnabled(!!d.enabled);
    }).catch(() => {});
  }
  useEffect(() => { if (open) load(); }, [open]);

  async function post(body: unknown): Promise<Record<string, unknown> | null> {
    setBusy(true);
    try {
      const r = await fetch('/api/config/llm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setNote(typeof d.error === 'string' ? d.error : 'request failed'); return null; }
      return d;
    } catch { setNote('network error'); return null; } finally { setBusy(false); }
  }

  async function toggleEnabled() { if (await post({ enabled: !enabled })) { setNote(null); load(); } }
  async function pick(id: string) { if (id !== active && await post({ active: id })) { setNote(null); load(); } }
  async function del(id: string) { if (await post({ deleteProvider: id })) { setNote(null); load(); } }

  function openNew() { setEditing({ ...EMPTY }); setIsNew(true); setKeyInput(''); setNote(null); }
  function openEdit(p: LlmProvider) {
    setEditing({
      id: p.id, provider: p.provider ?? 'anthropic-compatible', baseUrl: p.baseUrl ?? '', model: p.model ?? '',
      temperature: p.temperature != null ? String(p.temperature) : '', userAgent: p.userAgent ?? '', apiKeyEnv: p.keyEnv,
    });
    setIsNew(false); setKeyInput(''); setNote(null);
  }

  async function saveProvider() {
    if (!editing) return;
    if (!editing.id.trim()) { setNote('id is required'); return; }
    const apiKeyEnv = editing.apiKeyEnv.trim() || 'LOOPSCORE_JUDGE_KEY';
    const body = {
      upsertProvider: {
        id: editing.id.trim(), provider: editing.provider, baseUrl: editing.baseUrl.trim() || undefined,
        model: editing.model.trim() || undefined, userAgent: editing.userAgent.trim() || undefined, apiKeyEnv,
        temperature: editing.temperature.trim() === '' ? undefined : Number(editing.temperature),
      },
    };
    if (await post(body)) {
      if (keyInput) await post({ setKey: { env: apiKeyEnv, value: keyInput } });
      setEditing(null); setKeyInput(''); setNote(null); load();
    }
  }

  async function saveKeyOnly(envName: string) {
    if (!keyInput) return;
    if (await post({ setKey: { env: envName, value: keyInput } })) { setKeyInput(''); setNote('key saved'); load(); }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6" onClick={onClose}>
      <div className="mt-12 flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold text-foreground">LLM configuration</h2>
          <button type="button" onClick={onClose} className="text-lg text-muted-foreground hover:text-foreground" aria-label="close">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
            Used by the bucket② judge, the manager note and role re-check. Without an active provider that has a
            key, LoopScore still runs fully on the deterministic metrics — only these LLM features sleep. The API key
            is written only to your gitignored <code className="mx-0.5 rounded bg-secondary px-1 py-0.5 text-xs">.env</code> and is never shown.
          </p>

          {/* enabled toggle */}
          <button
            type="button"
            onClick={toggleEnabled}
            disabled={busy}
            className={`mb-4 flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors ${
              enabled ? 'border-neon-green/50 bg-neon-green/10' : 'border-border hover:border-foreground/30'
            }`}
          >
            <span>
              <span className="block text-sm font-semibold text-foreground">LLM judging {enabled ? 'on' : 'off'}</span>
              <span className="block text-xs text-muted-foreground">{enabled ? 'Episodes, manager notes and ambiguous-role re-checks run on the active provider.' : 'All LLM-powered scoring is paused.'}</span>
            </span>
            <span className={`ml-3 inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${enabled ? 'bg-neon-green/70' : 'bg-secondary'}`}>
              <span className={`h-5 w-5 rounded-full bg-card shadow transition-transform ${enabled ? 'translate-x-5' : ''}`} />
            </span>
          </button>

          {/* provider list */}
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Providers</span>
            <button type="button" onClick={openNew} disabled={busy} className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:border-foreground/40">+ Add provider</button>
          </div>

          {providers.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No providers configured. Add one to start.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {providers.map((p) => (
                <li key={p.id} className={`rounded-lg border px-3 py-2.5 ${p.active ? 'border-neon-sky/50 bg-neon-sky/8' : 'border-border'}`}>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => pick(p.id)} disabled={busy} title="set active" className="shrink-0 text-base" style={{ color: p.active ? 'var(--neon-sky)' : 'var(--color-muted-foreground)' }}>
                      {p.active ? '●' : '○'}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-foreground">{p.id}</span>
                        <span className="shrink-0 font-mono text-xs" title={`key env: ${p.keyEnv}`}>
                          {p.keyPresent ? <span className="text-[var(--neon-green)]">✅ key</span> : <span className="text-[var(--neon-red)]">❌ no key</span>}
                        </span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{p.provider ?? '—'} · {p.model ?? 'no model'}{p.baseUrl ? ` · ${p.baseUrl}` : ''}</div>
                    </div>
                    <button type="button" onClick={() => openEdit(p)} disabled={busy} className="shrink-0 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:border-foreground/40 hover:text-foreground">Edit</button>
                    <button type="button" onClick={() => del(p.id)} disabled={busy} className="shrink-0 rounded border border-border px-2 py-1 text-xs text-[var(--neon-red)]/80 hover:border-[var(--neon-red)]/50">Delete</button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* add / edit form */}
          {editing ? (
            <div className="mt-4 rounded-lg border border-neon-mauve/40 bg-secondary/30 p-4">
              <div className="mb-3 text-sm font-semibold text-foreground">{isNew ? 'Add provider' : `Edit ${editing.id}`}</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="id">
                  <input value={editing.id} disabled={!isNew} onChange={(e) => setEditing({ ...editing, id: e.target.value })} className={inputCls} placeholder="e.g. anthropic" />
                </Field>
                <Field label="provider">
                  <select value={editing.provider} onChange={(e) => setEditing({ ...editing, provider: e.target.value })} className={inputCls}>
                    {PROVIDER_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </Field>
                <Field label="model" wide>
                  <input value={editing.model} onChange={(e) => setEditing({ ...editing, model: e.target.value })} className={inputCls} placeholder="e.g. claude-haiku-4-5-20251001" />
                </Field>
                <Field label="base URL" wide>
                  <input value={editing.baseUrl} onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })} className={inputCls} placeholder="https://api.anthropic.com/v1" />
                </Field>
                <Field label="temperature">
                  <input value={editing.temperature} onChange={(e) => setEditing({ ...editing, temperature: e.target.value })} className={inputCls} placeholder="1" />
                </Field>
                <Field label="user-agent">
                  <input value={editing.userAgent} onChange={(e) => setEditing({ ...editing, userAgent: e.target.value })} className={inputCls} placeholder="loopscore/1.0" />
                </Field>
                <Field label="API key env var" wide>
                  <input value={editing.apiKeyEnv} onChange={(e) => setEditing({ ...editing, apiKeyEnv: e.target.value })} className={inputCls} placeholder="LOOPSCORE_JUDGE_KEY" />
                </Field>
                <Field label="API key (write-only, saved to .env)" wide>
                  <input type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} className={inputCls} placeholder="paste key — never shown again" autoComplete="off" />
                </Field>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button type="button" onClick={saveProvider} disabled={busy} className="rounded-md bg-neon-sky/80 px-3 py-1.5 text-sm font-medium text-card hover:bg-neon-sky">Save provider</button>
                <button type="button" onClick={() => { setEditing(null); setKeyInput(''); }} className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
                {!isNew ? (
                  <button type="button" onClick={() => saveKeyOnly(editing.apiKeyEnv.trim() || 'LOOPSCORE_JUDGE_KEY')} disabled={busy || !keyInput} className="ml-auto rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:border-foreground/40 disabled:opacity-40">Save key only</button>
                ) : null}
              </div>
            </div>
          ) : null}

          {note ? <p className="mt-3 text-sm text-[var(--neon-red)]/90">{note}</p> : null}
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-neon-sky/60';

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-1 ${wide ? 'col-span-2' : ''}`}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
