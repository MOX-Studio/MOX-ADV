# Delivery workflow

This repository uses the classic planning and delivery sequence from the engineering skills.
`to-spec` is the current name of the former `to-prd` skill.

## Canonical sequence

For a large effort whose route is still unclear:

```text
Wayfinder → to-spec → to-tickets → /ready
```

1. **Wayfinder** resolves product, research, prototype, and prerequisite decisions until the map is clear.
2. **to-spec** collapses the cleared map into one implementation-ready spec issue.
3. **to-tickets** turns the accepted spec into approved tracer-bullet implementation tickets with native blocking edges.
4. **/ready** selects and claims one frontier ticket, creates a temporary local `ready/<issue-number>` branch through `/worktree`, executes and validates the ticket there, squash-lands one exact-reference commit on the originating branch, closes the worktree and local branch, and then closes the exact ticket automatically.

Run `to-spec` and `to-tickets` in the same context window when practical so a large spec does not need to be fetched again.

## Stage boundaries

### Wayfinder: decisions only

A Wayfinder map is complete when no in-scope decision remains open and no in-scope fog remains.
Its children are decision tickets:

- `wayfinder:research` establishes an external fact or recommendation;
- `wayfinder:grilling` resolves a product decision with the owner;
- `wayfinder:prototype` creates disposable evidence for a specific unresolved design question;
- `wayfinder:task` performs prerequisite work needed to make a decision.

A `wayfinder:task` does not implement the destination. Production code, integration, E2E delivery, and regression repair belong downstream.

Wayfinder maps in this repository are planning-only. Do not add an execution override to a map's Notes. Do not apply `wayfinder:*` labels to implementation tickets.

### to-spec: one buildable source

When a Wayfinder map clears, invoke `to-spec` on the map issue, not on an individual decision ticket. The spec gathers the distributed decisions, user stories, implementation decisions, test seams, and out-of-scope boundary into one parent issue.

For a settled change that spans several sessions but never needed Wayfinder, start directly at `to-spec`.

### to-tickets: implementation backlog

Invoke `to-tickets` only after the spec is accepted. Review and approve the proposed granularity and blockers before publication. Each published Task must be a complete, independently verifiable vertical slice sized for one fresh context window.

For a module checklist, audit, or accepted requirement set, `to-tickets` publishes a requirement-level hierarchy rather than one aggregate Feature:

1. map every incomplete or partial owner-verifiable requirement to exactly one `[FEATURE]`;
2. create all implementation `[TASK]` children for that Feature;
3. create one final owner-run `[CHECKPOINT]` child, blocked by every Task;
4. write the linked Task and Checkpoint checklist into the Feature body;
5. publish native Module → Feature → Task/Checkpoint sub-issue links and cross-Feature dependencies through prerequisite Checkpoints.

Before publication, produce and verify complete `source requirement → Feature → Tasks → Checkpoint` traceability. Derive each Feature's Task count from real independently executable seams sized for one fresh context window; a uniform Tasks-per-Feature template is invalid unless every count has a specific seam-based justification. Validate every generated issue against the Russian-language rule in `issue-tracker.md`. Collapsing several requirements into one Feature requires explicit owner approval. A Feature cannot be accepted or closed before its own human Checkpoint passes.

Implementation tickets reference their Feature and accepted source requirement. They are not children of the Wayfinder map and do not carry `wayfinder:*` labels. Native blockers define the frontier. Features and Checkpoints do not receive `ready-for-agent`; executable Tasks do. Once child tickets are published, remove `ready-for-agent` from any parent artifact that an automated runner might otherwise implement directly.

### /ready: one ticket per session

Invoke `/ready` and select one unblocked implementation ticket in a fresh session. Ready consumes accepted decisions and executes the ticket in its temporary worktree without another planning or execution handoff; it does not reopen product discovery or reslice the backlog. If the ticket is too large for one context window, leave it open and return it to `to-tickets` for a smaller vertical breakdown.

The branch active when `/ready` is invoked is the originating branch; in this repository it is normally `main`. Selecting a Ready ticket explicitly authorizes one temporary local `ready/<issue-number>` branch in a leased Treehouse worktree. Ready creates no remote branch, performs implementation, tests, final validation, and self-review only in that worktree, then squash-lands the verified tree as one commit with the exact issue reference on the unchanged originating branch. It returns the lease and deletes the temporary local branch before fail-closed automatic issue closure. Any landing or cleanup failure leaves the issue open and preserves recoverable work.

## Short paths

- **Small and already decided:** execute directly in the current session; skip Wayfinder, spec, and tickets.
- **Decided but multi-session:** `to-spec → to-tickets → /ready`.
- **Large with unresolved fog:** `Wayfinder → to-spec → to-tickets → /ready`.
- **Incoming external issue:** use `triage`; it joins the agent-ready frontier and is selected through `/ready`.

One artifact owns each stage. Never let a Wayfinder map and `to-tickets` create competing implementation backlogs for the same scope.
