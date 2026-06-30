# Contributing

Thanks for your interest in LoopScore.

## Principles

- **Zero runtime dependencies** in the backend. The Node process must run on the
  standard library alone — please don't add runtime `dependencies` to the root
  `package.json`. (The frontend is a build artifact and may use dev deps.)
- **Pure functions, tested.** The pipeline (tailer → adapter → sessionModel →
  scorer/evaluator/roleMetrics/teamMetrics) is pure and unit-tested. New logic
  comes with a `node:test` test.
- **Read-only on Claude Code data.** Nothing may write to or mutate the Claude
  Code config or transcript directory.

## Workflow

1. Fork and branch.
2. Write a failing test first, then the implementation (TDD).
3. Run the suite — it must stay green:

   ```bash
   node --test
   ```

4. If you touched the frontend, build it:

   ```bash
   npm --prefix frontend run build
   ```

5. Keep commits focused; describe the *why* in the message.

## Reporting bugs / ideas

Open an issue with steps to reproduce (for bugs) or the problem you're trying to
solve (for features). Never paste real API keys or secrets into an issue.
