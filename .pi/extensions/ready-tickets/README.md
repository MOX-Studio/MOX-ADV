# Implementation frontier picker for Pi

This project extension runs against the GitHub repository in Pi's current working directory. After adding or changing it, run `/reload` once.

Run `/ready` to:

1. load open GitHub issues labelled `ready-for-agent`;
2. keep implementation tickets shaped by `/to-tickets` (`What to build`, `Acceptance criteria`, and `Blocked by`), excluding parent specs and Wayfinder issues;
3. show every ticket with no open native blocker, in issue-number order and with its assignee state;
4. create a fresh Pi session after selection, as required by this repository's one-ticket-per-session workflow;
5. immediately continue in that session by sending:

```text
/skill:implement возьми в работу задачу <issue-url>
```

The picker performs no GitHub writes. Claiming, implementation, tests, review, and commit remain the responsibility of the `implement` workflow started by that prompt.

## Requirements

- authenticated GitHub CLI (`gh`);
- a GitHub repository that uses the `ready-for-agent` label and native issue dependencies.

## Test

```sh
node --test .pi/extensions/ready-tickets/model.test.ts
```
