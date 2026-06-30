# Security

LoopScore is a **local-only** tool. It binds to `127.0.0.1`, is **read-only** on
the Claude Code transcript directory, and makes **no external network calls**
except to the LLM provider you explicitly configure for the optional judge.

## How secrets are handled

- The only secret is your LLM API key. It lives **only** in a gitignored `.env`
  file, written with `0600` (owner read/write only) permissions.
- The key is **never** committed, **never** written to any JSON config, **never**
  logged, and **never** returned by the API — the config endpoint reports key
  *presence* (`✅ / ❌`) only.
- Persisted UI settings (providers, active provider, judge on/off) go to a
  gitignored `loopscore.local.json` — **non-secret data only**.

## Hardening already in place

- State-changing requests (anything not `GET`/`HEAD`) are **localhost-only**: the
  `Host` header must be a loopback address (defeats DNS-rebinding) and any
  `Origin` present must also be loopback (defeats cross-site POST).
- The repo ships a `.env.example`, not a `.env`. Enabling GitHub
  **secret scanning + push protection** on your fork is recommended.

## Reporting a vulnerability

This is a personal project. Please open a GitHub issue describing the problem
(omit any real secret values). For sensitive reports, note that contact in the
issue and a private channel can be arranged.
