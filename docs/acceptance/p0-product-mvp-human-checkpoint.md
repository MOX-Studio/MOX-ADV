# P0 Product MVP · human checkpoint script

This script prepares checkpoint [#176](https://github.com/ElJeskos/MOX-ADV/issues/176). It does **not** record or imply a human verdict.

## Safety boundary

- Product MVP is read-only/no-write: do not load production credentials, issue live authority, call provider mutations, deploy, or use Yandex browser cabinets.
- Use the local Dashboard only at `http://127.0.0.1:8878/` with a `1920×1080` viewport.
- Drive the Dashboard through its visible UI. Do not call its API directly or manipulate state.
- The localhost browser run is controlled fixture evidence. It proves deterministic interaction and must not be presented as either independent pilot.
- Independent pilot evidence is under `tests/fixtures/product-mvp/product-mvp-source.json`; the generated artifact keeps it in a separate `INDEPENDENT_PILOT_EVIDENCE` partition.

## Reproduce the prepared contour

From `sites/p0-production/` run:

```bash
npm run test:product-mvp
```

Review the generated golden:

```text
tests/fixtures/product-mvp/product-mvp-acceptance.json
```

The run must show:

1. all ten agent eval scenarios pass;
2. the positive real-business scenario contains at least one editable `VIABLE` Campaign Draft only after all eleven hard gates and complete Profile v1 projection;
3. each honesty case (economics, demand, measurement, destination, capability) contains no `VIABLE` Draft and starts with a matching prioritized repair action;
4. browser acceptance completes all five stages with no accessibility, hierarchy, overflow, console/page-error, unavailable-control, or technical-noise finding;
5. no-write proof remains exactly zero attempts, mutations, impressions, spend, credentials, live authority, cabinets, and deployments.

## Reviewer facilitation

Give the non-advertising specialist only the five-stage owner journey and the plain-language positive/honesty pilot sections. Do not explain advertising concepts first. Ask the following in order and record the response in #176 or its approved human evidence location:

1. **Business Model:** Who buys, what value and qualified outcome are sold, how is the acceptable result cost grounded, and what assumptions remain?
2. **Business goal:** What exact business result is the campaign intended to produce, and why is it not merely a click or form opening?
3. **Evidence quality:** Which evidence is available, which is limited or unavailable, and why does unavailable not mean zero?
4. **Budget alignment:** How does the selected test package relate to the Strategy budget, and why is that arithmetic not a CPA/profit forecast?
5. **Campaign differences:** What materially changes between the control and alternative Campaign Drafts?
6. **Auction Protocol:** What change, traffic split, budget, period, success signal, and stop condition are fixed before a test?
7. **Risks:** Which unresolved facts can change the decision, and what does pre-launch `VIABLE` explicitly not promise?
8. **Package confirmation:** What exact immutable campaign/protocol package would confirmation cover, and why does Product MVP issue no live authority?

Then present one honesty case chosen by the reviewer. Ask the specialist to identify the blocker, verify that no Draft is `VIABLE`, and explain the first repair action.

## Human verdict record

Only the named reviewer for #176 may set `PASS` or `FAIL`. The implementation artifact must remain:

```text
human_checkpoint.verdict = PENDING_HUMAN_VERDICT
implementation_may_claim_acceptance = false
```

If the specialist cannot explain any section without developer help, or if the reviewer finds a false `VIABLE`, production-write effect, missing repair priority, or fixture/pilot ambiguity, record `FAIL` and return the gap to implementation rather than accepting a promise.
