import assert from "node:assert/strict";
import test from "node:test";
import { verifyAnalyticsEvidenceSnapshot } from "../lib/analytics-evidence.ts";
import { pipelineDigest } from "../lib/pipeline-orchestrator.ts";
import { QUALIFIED_REQUEST_COUNTING_POLICY } from "../lib/goal-revision.ts";
import { createEvidenceReuseHarness } from "./fixtures/pipeline-evidence-reuse-fixture.mjs";

test("verified Evidence and interpretation survive a failed downstream stage and regenerate with zero new provider reads", async () => {
  const harness = await createEvidenceReuseHarness();
  assert.equal(await verifyAnalyticsEvidenceSnapshot(harness.snapshot), true);
  harness.failures.design = true;
  await assert.rejects(harness.fullRun(), /Injected Design rejection/u);
  const before = await harness.products.loadCurrent();
  assert.ok(before.prior_verified_evidence);
  const available = await harness.controller.evidenceReuse("owner", harness.view);
  assert.equal(available.available, true, available.reason);
  assert.equal(available.collectedAt, harness.snapshot.generated_at);
  harness.failures.design = false;
  harness.failures.collection = true;
  const completed = await harness.regenerate();
  assert.equal(completed.status, "COMPLETED");
  assert.equal(harness.calls.collection, 1);
  assert.equal(harness.calls.evidence, 1);
  assert.equal(harness.calls.strategy, 2);
  assert.equal(harness.calls.design, 2);
  const current = await harness.products.loadCurrent();
  assert.deepEqual(current.analytics_evidence_snapshot, harness.snapshot);
  assert.equal(current.prior_verified_evidence.collected_at, harness.snapshot.generated_at);
  const replay = harness.calls.designInputs.at(-1).view.state.pipeline_evidence_replay;
  assert.equal(replay.use, "HISTORICAL_PLANNING");
  assert.equal(replay.current_operational_readiness, "UNVERIFIED");
  assert.ok(replay.expired_operational_evidence_refs.length > 0);
  const audit = await harness.runStore.loadAudit(completed.runId);
  const evidenceEvent = audit.find((event) => event.stage === "EVIDENCE_COLLECTION" && event.output.status === "VERIFIED");
  assert.equal(evidenceEvent.reason_code, "PRODUCTION_EVIDENCE_REUSED");
  assert.equal(evidenceEvent.actor.role, "EVIDENCE_REPLAY_VALIDATOR");
  assert.equal(current.authority.publication, "NOT_AUTHORIZED");
});

test("a fresh normal run preserves last verified Evidence even if its new collection fails", async () => {
  const harness = await createEvidenceReuseHarness();
  await harness.fullRun();
  const original = (await harness.products.loadCurrent()).prior_verified_evidence;
  harness.failures.collection = true;
  await assert.rejects(harness.fullRun(), /Injected collection failure/u);
  const current = await harness.products.loadCurrent();
  assert.equal(current.analytics_evidence_snapshot, null);
  assert.deepEqual(current.prior_verified_evidence, original);
  assert.equal((await harness.controller.evidenceReuse("owner", harness.view)).available, true);
  await harness.regenerate();
  assert.equal(harness.calls.collection, 2);
  assert.equal(harness.calls.evidence, 1);
});

test("upgrade recovery accepts only immutable product revisions with an authentic VERIFIED Evidence audit event", async () => {
  const harness = await createEvidenceReuseHarness();
  await harness.fullRun();
  for (const revision of harness.products.history) delete revision.prior_verified_evidence;
  delete harness.products.current.prior_verified_evidence;
  harness.products.current.analytics_evidence_snapshot = null;
  harness.products.current.evidence_interpretation = null;
  const available = await harness.controller.evidenceReuse("owner", harness.view);
  assert.equal(available.available, true, available.reason);
  harness.failures.collection = true;
  await harness.regenerate();
  assert.equal(harness.calls.collection, 1);
  assert.equal(harness.calls.evidence, 1);
  assert.ok((await harness.products.loadCurrent()).prior_verified_evidence);
});

test("a changed Goal or research scope requires explicit refresh without falling back to provider collection", async () => {
  const harness = await createEvidenceReuseHarness();
  await harness.fullRun();
  await harness.controller.correctGoal("owner", { desiredOutcome: "Получать продажи", qualifiedAction: "Оплаченный заказ", targetCount: 20, deadline: "2026-10-01", maxResultCostRub: 4_000,
    customerGeography: "Россия", countingPolicy: QUALIFIED_REQUEST_COUNTING_POLICY });
  const oldGoal = await harness.controller.evidenceReuse("owner", harness.view);
  assert.equal(oldGoal.available, false);
  assert.match(oldGoal.reason, /Цель изменилась/u);
  assert.equal(harness.calls.collection, 1);

  const scoped = await createEvidenceReuseHarness();
  await scoped.fullRun();
  scoped.view.state.context_state.facts.direct.account = "different-account";
  const changedScope = await scoped.controller.evidenceReuse("owner", scoped.view);
  assert.equal(changedScope.available, false);
  assert.match(changedScope.reason, /область|Бизнес/u);
  assert.equal(scoped.calls.collection, 1);
});

test("stale snapshots and stale action revisions cannot start regeneration", async () => {
  const harness = await createEvidenceReuseHarness();
  await harness.fullRun();
  const available = await harness.controller.evidenceReuse("owner", harness.view);
  const beforeRuns = harness.runStore.order.length;
  await assert.rejects(harness.controller.startFromEvidence("owner", harness.view, { expectedStateRevision: available.expectedStateRevision - 1, reuseToken: available.reuseToken }), /изменилась/u);
  await assert.rejects(harness.controller.startFromEvidence("owner", harness.view, { expectedStateRevision: available.expectedStateRevision, reuseToken: "wrong-token" }), /Область/u);
  assert.equal(harness.runStore.order.length, beforeRuns);
  harness.setNow("2026-09-06T20:00:00.000Z");
  const stale = await harness.controller.evidenceReuse("owner", harness.view);
  assert.equal(stale.available, false);
  assert.match(stale.reason, /больше суток/u);
  await assert.rejects(harness.controller.startFromEvidence("owner", harness.view, { expectedStateRevision: available.expectedStateRevision, reuseToken: available.reuseToken }), /больше суток/u);
  assert.equal(harness.calls.collection, 1);
});

test("historical seed snapshots alone never become reusable evidence", async () => {
  const harness = await createEvidenceReuseHarness();
  const available = await harness.controller.evidenceReuse("owner", harness.view);
  assert.equal(available.available, false);
  assert.equal(harness.calls.collection, 0);
  assert.equal(harness.runStore.order.length, 0);
});

async function removeLegacyInterpretation(products) {
  for (const value of [products.current, ...products.history]) {
    value.evidence_interpretation = null;
    if (!value.prior_verified_evidence) continue;
    const body = structuredClone(value.prior_verified_evidence);
    delete body.digest;
    body.interpretation = null;
    value.prior_verified_evidence = { ...body, digest: await pipelineDigest(body) };
  }
}

test("a true legacy source is analyzed only once across replay Design failures and retains its original collection time", async () => {
  const harness = await createEvidenceReuseHarness();
  await harness.fullRun();
  await removeLegacyInterpretation(harness.products);
  const original = structuredClone(harness.products.current.prior_verified_evidence);
  assert.equal(original.interpretation, null);
  harness.setNow("2026-09-05T21:00:00.000Z");
  harness.failures.collection = true;
  harness.failures.design = true;
  await assert.rejects(harness.regenerate(), /Injected Design rejection/u);
  assert.equal(harness.calls.collection, 1);
  assert.equal(harness.calls.evidence, 2);
  const current = await harness.products.loadCurrent();
  const enriched = current.prior_verified_evidence;
  assert.ok(enriched.interpretation);
  assert.equal(enriched.source_run_id, current.run_id);
  assert.notEqual(enriched.source_run_id, original.source_run_id);
  assert.equal(enriched.collected_at, original.collected_at);
  assert.equal(enriched.verified_at, "2026-09-05T21:00:00.000Z");
  const event = (await harness.runStore.loadAudit(enriched.source_run_id)).find((item) => item.run_version === enriched.source_run_version);
  assert.equal(event.actor.role, "EVIDENCE_ANALYST");
  assert.equal(event.recorded_at, enriched.verified_at);
  harness.setNow("2026-09-05T21:05:00.000Z");
  harness.failures.design = false;
  const completed = await harness.regenerate();
  assert.equal(completed.status, "COMPLETED");
  assert.equal(harness.calls.collection, 1);
  assert.equal(harness.calls.evidence, 2);
  assert.deepEqual(harness.products.current.analytics_evidence_snapshot, harness.snapshot);
});

test("already affected records recover the accepted new interpretation from its real audit without another model call", async () => {
  const harness = await createEvidenceReuseHarness();
  await harness.fullRun();
  await removeLegacyInterpretation(harness.products);
  const legacy = structuredClone(harness.products.current.prior_verified_evidence);
  harness.setNow("2026-09-05T21:00:00.000Z");
  harness.failures.design = true;
  await assert.rejects(harness.regenerate(), /Injected Design rejection/u);
  const affectedRunId = harness.products.current.run_id;
  // Model the former persistence bug: fresh accepted interpretation beside the old null anchor.
  for (const value of [harness.products.current, ...harness.products.history]) {
    if (value.run_id === affectedRunId) value.prior_verified_evidence = structuredClone(legacy);
  }
  assert.ok(harness.products.current.evidence_interpretation);
  assert.equal(harness.products.current.prior_verified_evidence.interpretation, null);
  const available = await harness.controller.evidenceReuse("owner", harness.view);
  assert.equal(available.available, true, available.reason);
  assert.equal(available.sourceRunId, affectedRunId);
  assert.equal(available.verifiedAt, "2026-09-05T21:00:00.000Z");
  assert.equal(available.collectedAt, legacy.collected_at);
  harness.failures.collection = true;
  harness.failures.design = false;
  await harness.regenerate();
  assert.equal(harness.calls.evidence, 2);
  assert.equal(harness.calls.collection, 1);
  assert.ok(harness.products.current.prior_verified_evidence.interpretation);
});

test("an accepted interpretation in immutable history survives a later cleared current pointer", async () => {
  const harness = await createEvidenceReuseHarness();
  await harness.fullRun();
  await removeLegacyInterpretation(harness.products);
  const legacy = structuredClone(harness.products.current.prior_verified_evidence);
  harness.failures.design = true;
  await assert.rejects(harness.regenerate(), /Injected Design rejection/u);
  const affectedRun = harness.products.current.run_id;
  for (const value of harness.products.history) if (value.run_id === affectedRun) value.prior_verified_evidence = structuredClone(legacy);
  harness.products.current.prior_verified_evidence = structuredClone(legacy);
  harness.products.current.analytics_evidence_snapshot = null;
  harness.products.current.evidence_interpretation = null;
  const available = await harness.controller.evidenceReuse("owner", harness.view);
  assert.equal(available.available, true, available.reason);
  assert.equal(available.sourceRunId, affectedRun);
  harness.failures.collection = true;
  harness.failures.design = false;
  await harness.regenerate();
  assert.equal(harness.calls.evidence, 2);
  assert.equal(harness.calls.collection, 1);
});
