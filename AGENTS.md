## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `ElJeskos/MOX-ADV`; external pull requests are not a triage surface.
See `docs/agents/issue-tracker.md`.

### Triage labels

The repository uses the canonical `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix` labels.
See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository with `CONTEXT.md` and `docs/adr/` at the repository root.
See `docs/agents/domain.md`.

### Delivery workflow

Use the planning-only sequence `Wayfinder → to-spec → to-tickets → /ready`; Ready executes one frontier ticket per fresh session in a temporary local `/worktree` branch, then lands it on the originating branch and closes the worktree.
See `docs/agents/delivery-workflow.md`.

### Development and publishing

Use local development by default. Publish only when the user explicitly requests it, and use the repository's existing Vercel configuration and project for that release.

### Integration interaction boundaries

- Work with Yandex Direct and Yandex Metrica exclusively through their APIs; their browser-based personal cabinets are out of bounds.
- Work with the local Dashboard at `http://127.0.0.1:8878/` exclusively through its UI using Playwright; direct Dashboard API calls and direct state manipulation are out of bounds.
