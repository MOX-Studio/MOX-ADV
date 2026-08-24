# Issue tracker: GitHub

Issues and specs for this repository live as GitHub issues in `ElJeskos/MOX-ADV`.
Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`.
  Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments with `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`.
- **Apply or remove labels**: `gh issue edit <number> --add-label "..."` or `gh issue edit <number> --remove-label "..."`.
- **Close an issue**: `gh issue close <number> --comment "..."`.

Infer the repository from `git remote -v`.
The `gh` CLI does this automatically when run inside the clone.

## Issue language

Write every issue title, section heading, description, checklist item, acceptance criterion, and human-checkpoint instruction in Russian. Keep only required structural prefixes and labels (`[MODULE]`, `[FEATURE]`, `[TASK]`, `[CHECKPOINT]`, `type:*`), proper product/API names, and exact code identifiers in their original form. Put exact code identifiers and enum values in backticks. Translate explanatory prose and technical concepts whenever a clear Russian term exists; mixed Russian-English prose is not ready for publication.

Before publishing or rebuilding a backlog, scan every generated issue—not only the parent Feature—for untranslated English headings or prose. A language violation blocks publication just like a missing child or dependency.

## Delivery type labels

Assign the structural type from the issue's product scope:

| Scope | Title prefix | GitHub label |
| --- | --- | --- |
| Application product module, such as P0–P3 | `[MODULE]` | `type:module` |
| User-testable delivery slice inside a module | `[FEATURE]` | `type:feature` |
| Executable implementation slice inside a feature | `[TASK]` | `type:task` |
| Integrated acceptance of a feature | `[CHECKPOINT]` | `type:checkpoint` |

An application module always receives `[MODULE]` and `type:module`, regardless of whether it is currently the parent of tasks or checkpoints. Use `[FEATURE]` and `type:feature` only for a user-testable slice within that module.

## Requirement-level Feature decomposition

When a checklist, audit, or accepted spec is converted into a GitHub backlog, first atomize it into owner-verifiable requirements. Every requirement whose status is incomplete or partial becomes its own `[FEATURE]`; do not group several checklist requirements under one Feature unless the owner explicitly approves that grouping.

For every Feature:

1. Derive the number of `[TASK]` children from the actual independently executable implementation seams. Each Task must fit one fresh context window. Never apply a fixed Tasks-per-Feature template, and do not invent cosmetic splits. If every Feature in a backlog has the same Task count, stop and either justify each count from distinct seams or reslice the backlog.
2. Create exactly one final `[CHECKPOINT]` child with `type:checkpoint` and `ready-for-human`. The owner personally verifies the completed Feature there.
3. Make the Checkpoint natively blocked by every implementation Task in that Feature.
4. Put the exact source requirement, current gap, target outcome, and a Markdown checklist linking every Task and the Checkpoint in the Feature body.
5. Link the hierarchy with native sub-issues: Module → Features; Feature → Tasks and Checkpoint.
6. Express cross-Feature ordering with native dependencies on the prerequisite Feature's Checkpoint. Downstream Tasks must carry the same blocker when needed so `/ready` cannot expose work before its prerequisite human verdict.
7. Close the Feature only after its Checkpoint receives an explicit human acceptance verdict. The `close-feature-after-checkpoint` workflow enforces this transition: a closed native `type:checkpoint` child closes its open `type:feature` parent only when the latest trusted verdict is `ACCEPTED` and every native child is closed.

Before publishing, verify exhaustive one-to-one traceability from every incomplete/partial source requirement to exactly one Feature. Record why each Task is an independent slice and verify that the resulting per-Feature Task counts come from those seams rather than a uniform template. A missing requirement, a cosmetic Task split, a Feature without all child links, or a Feature without its personal Checkpoint means the backlog is not ready.

## Pull requests as a triage surface

**PRs as a request surface: no.**

The `triage` skill must not pull external pull requests into the issue triage queue.
Collaborators may continue to manage pull requests through their normal workflow.

GitHub shares one number space across issues and pull requests, so a bare `#42` may be either.
Resolve ambiguity with `gh pr view 42`, then fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

The `wayfinder` skill uses one issue as a map and child issues as tickets.

- **Map**: Use one issue labelled `wayfinder:map` to hold Notes, Decisions-so-far, and Fog.
  Create it with `gh issue create --label wayfinder:map`.
- **Child ticket**: Link an issue to the map as a GitHub sub-issue through the sub-issues API.
  If sub-issues are unavailable, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body.
  Use a `wayfinder:<type>` label, where the type is `research`, `prototype`, `grilling`, or `task`.
  Assign the ticket to the driving developer after it is claimed.
- **Blocking**: Use GitHub's native issue dependencies as the canonical, UI-visible representation.
  Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`.
  Obtain `<blocker-db-id>` with `gh api repos/<owner>/<repo>/issues/<number> --jq .id`; it is not the issue number or `node_id`.
  If dependencies are unavailable, put `Blocked by: #<number>, #<number>` at the top of the child body.
  A ticket is unblocked when every blocker is closed.
- **Frontier query**: List the map's open children, discard assigned tickets and tickets with open blockers, then select the first remaining ticket in map order.
- **Claim**: Run `gh issue edit <number> --add-assignee @me`.
  Claiming is the session's first write.
- **Resolve**: Comment with the answer, close the ticket, and append a context pointer with its link to the map's Decisions-so-far section.

## Classical delivery handoff

Wayfinder is planning-only in this repository. Its map and children resolve decisions; they do not form the implementation backlog. A `wayfinder:task` is limited to prerequisite work that unblocks a decision.

When a map has no open in-scope decisions or fog:

1. Run `to-spec` on the map issue to publish one implementation-ready spec.
2. Run `to-tickets` on the accepted spec to publish approved vertical implementation slices with native blockers and `ready-for-agent`.
3. Run `/ready` and select one frontier ticket per fresh session.
4. Ready executes the ticket in a temporary local branch created through `/worktree`, verifies acceptance criteria, squash-lands an exact-reference commit on the originating branch, closes the worktree and temporary branch, and only then closes the issue so blocked tickets can enter the frontier.

Implementation tickets reference the spec, not the Wayfinder map, and never carry `wayfinder:*` labels. Do not put execution overrides in Wayfinder map Notes. See `docs/agents/delivery-workflow.md` for the complete stage boundaries and short paths.
