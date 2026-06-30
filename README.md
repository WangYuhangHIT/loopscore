<p align="center">
  <img src=".github/assets/banner.png" alt="LoopScore — local monitoring &amp; evaluation for AI coding agents" width="100%">
</p>

# LoopScore

[![CI](https://github.com/WangYuhangHIT/loopscore/actions/workflows/ci.yml/badge.svg)](https://github.com/WangYuhangHIT/loopscore/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-20%2B-43853d)
![Runtime deps](https://img.shields.io/badge/runtime%20deps-0-blue)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)

Local AI-development monitoring & evaluation system. It `tail`s Claude Code's session-transcript directory and shows, live in the browser, what each session is doing (skill / hook / MCP / tools) — plus an evaluation.

<!-- Screenshot: save a dashboard capture to .github/assets/dashboard.png and it renders here. -->
<!-- ![LoopScore dashboard](.github/assets/dashboard.png) -->

- **Multi-agent side-by-side monitoring**: one `AgentPanel` per active session in a responsive auto-grid (comfortable / compact density). Focus view, filter by live/idle, search by sessionId/branch; shareable URL (`?status=live&q=main&density=compact&focus=<id>`).
- **Real-time visibility + bucket① deterministic score**: test discipline / stuck loops / autonomy / usage / tokens, one tile group per panel.
- **Capability chart**: Recharts rolling ratios (first-pass rate + stuck risk).
- **7-dimension performance radar + LLM manager note**: Delivery / Quality / Rigor / Debugging / Architecture / Autonomy / Recovery; radar tint driven by the worst dimension.
- **Bucket② LLM judge**: post-hoc root-cause attribution of failure snippets (5-class AgentErrorTaxonomy: memory / reflection / planning / action / system), one verdict strip per panel.
- **Sub-agent team view**: a roster embedded in each panel (live/total + a mini-lane per sub-agent). **The main-session score never mixes in sub-agent events**, so capability ratios stay clean.
- **Global overview bar**: live/total agents · aggregate tokens (in/out) · schema warnings · schema-warning banner.

**Read-only** on the Claude Code data directory; never changes CC config. The backend runs standalone with zero runtime dependencies; the frontend is a build artifact (no runtime npm deps inside the Node process).

## Requirements

- **Node.js ≥ 18** (uses the built-in `node:test` and `StringDecoder`; no backend runtime dependencies).
- **Claude Code** installed and used on the same machine. LoopScore reads its session
  transcripts from `~/.claude/projects` by default, and automatically follows
  `CLAUDE_CONFIG_DIR` if you've relocated Claude Code's config. To point it somewhere
  else, set `"projectsRoot"` in `loopscore.config.json`.
- **OS:** developed and verified on macOS; Linux works the same way (identical paths,
  pure-Node polling, no shell calls in the monitor). Windows should work (it reads
  `%USERPROFILE%\.claude\projects` via `os.homedir()`) but is not yet tested — please
  open an issue if you try it.
- The **LLM judge** (bucket ②) is optional: it stays off until you add your own provider
  key in the ⚙ settings. Everything else (live monitoring + deterministic scoring) needs
  no key and no network.

## Run

The frontend is a build artifact — build it first (on first run or after source changes):

```bash
npm --prefix frontend install   # first time / lockfile change
npm --prefix frontend run build # output goes to frontend/dist/
node src/server.js
# → LoopScore listening on http://127.0.0.1:4319
```

Open `http://127.0.0.1:4319` in the browser.

## Test

```bash
node --test
```

## Frontend development (React + Vite + Tailwind v4 + shadcn/ui + Recharts)

Source lives in `frontend/`.

```bash
# install deps (first time or on lockfile change)
npm --prefix frontend install

# production build (output to frontend/dist/, served directly by the Node server)
npm --prefix frontend run build

# local dev (standalone vite dev server, API proxied to the node server)
npm --prefix frontend run dev
```

The backend `src/server.js` stays zero-runtime-dependency: it serves `frontend/dist/` as the static root and falls back to `index.html` for unknown paths (SPA fallback). `/api/*` and `/events` take precedence over static matching.

## Config

`loopscore.config.json`: `projectsRoot` (the `~/.claude/projects` root to watch — every sub-directory is auto-discovered as a project), `port`, `idleSeconds`, loop thresholds, test-command pattern, `judge.*` (optional LLM judge).

### LLM provider (optional)

Everything above works with **no API key**. A key only enables the bucket-2 LLM
judge, the manager note, and ambiguous-role re-checks. Configure it two ways:

- **In-app**: the gear icon in the top bar opens an LLM settings panel — add /
  edit / delete providers, switch the active one, toggle judging, and paste the
  key. Changes apply live and persist across restarts.
- **By hand**: copy `.env.example` to `.env` and set `LOOPSCORE_JUDGE_KEY`; set
  the provider (any Anthropic-compatible endpoint) in `loopscore.config.json`.

The key is written only to the gitignored `.env` (mode `0600`), never committed,
never logged, and never returned by the API. See [SECURITY.md](SECURITY.md).

## Security

- Local-only: binds `127.0.0.1`; state-changing requests are rejected unless the
  `Host`/`Origin` are loopback (DNS-rebind / CSRF guard).
- Read-only on the Claude Code transcript directory; never mutates CC config.
- Secrets live only in a gitignored, `0600` `.env`; presence is surfaced, the
  value never is.

## Design & process

This repo doubles as a worked example of spec-driven, test-first development:

- **Zero runtime dependencies** in the backend (standard library only).
- A **pure-function pipeline** (tailer → adapter → sessionModel →
  scorer/evaluator/roleMetrics/teamMetrics) covered by `node --test`.
- TDD throughout: every unit of scoring logic ships with a test.

## License

[MIT](LICENSE) © Yuhang Wang
