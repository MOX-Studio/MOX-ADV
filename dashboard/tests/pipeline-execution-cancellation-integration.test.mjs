import assert from "node:assert/strict";
import test from "node:test";
import { OwnerPipelineController } from "../lib/pipeline-owner-dashboard.ts";

const clone = (value) => structuredClone(value);
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

class MemoryRunStore {
  runs = new Map();
  audits = new Map();

  async load(runId) { return clone(this.runs.get(runId) ?? null); }
  async loadCurrent(ownerKey) { return clone([...this.runs.values()].reverse().find((run) => run.owner_key === ownerKey) ?? null); }
  async loadActive(ownerKey) { return clone([...this.runs.values()].find((run) => run.owner_key === ownerKey && run.status === "ACTIVE") ?? null); }
  async loadAudit(runId) { return clone(this.audits.get(runId) ?? []); }
  async initialize(run, event) {
    if (this.runs.has(run.run_id) || await this.loadActive(run.owner_key)) return false;
    this.runs.set(run.run_id, clone(run));
    this.audits.set(run.run_id, [clone(event)]);
    return true;
  }
  async compareAndSwap(runId, expectedVersion, run, event) {
    if (this.runs.get(runId)?.version !== expectedVersion) return false;
    this.runs.set(runId, clone(run));
    this.audits.set(runId, [...(this.audits.get(runId) ?? []), clone(event)]);
    return true;
  }
}

class MemoryGoalStore {
  current = null;
  async loadCurrent(ownerKey) { return clone(this.current?.owner_key === ownerKey ? this.current : null); }
  async append(current, expectedVersion) {
    if ((this.current?.revision.version ?? null) !== expectedVersion) return false;
    this.current = clone(current);
    return true;
  }
}

class MemoryProductStore {
  current = null;
  writes = [];
  async loadCurrent(ownerKey) { return clone(this.current?.owner_key === ownerKey ? this.current : null); }
  async compareAndSwap(ownerKey, expectedRevision, next) {
    if (next.owner_key !== ownerKey || (this.current?.state_revision ?? null) !== expectedRevision) return false;
    this.current = clone(next);
    this.writes.push(clone(next));
    return true;
  }
}

async function harness(t, { cooperative = true } = {}) {
  // Unique normal runtime identities isolate admission without clearing or replacing production globals.
  const ownerKey = `cancellation-owner:${crypto.randomUUID()}`;
  const runId = `cancellation-run:${crypto.randomUUID()}`;
  const runs = new MemoryRunStore();
  const goals = new MemoryGoalStore();
  const products = new MemoryProductStore();
  const entered = deferred();
  const collected = deferred();
  const stageCalls = [];
  const collectors = [];
  const executions = [];
  const snapshot = { schema_version: "p0-analytics-evidence-v7", snapshot_id: "canceled-evidence", generated_at: "2026-09-05T12:00:00.000Z", observations: [] };
  const view = {
    revision: 1,
    state: { schema_version: "p0-application-document-v19", business_model: { product: "Настройка учёта магазина", qualified_result: "Квалифицированная заявка" } },
  };
  const settings = {
    goalStore: goals,
    productStore: products,
    now: () => "2026-09-05T12:00:00.000Z",
    newRunId: () => runId,
    evidenceCollector: async (input) => {
      collectors.push(input);
      assert.ok(input.signal instanceof AbortSignal);
      input.signal.throwIfAborted();
      if (cooperative) input.signal.addEventListener("abort", () => collected.reject(input.signal.reason), { once: true });
      entered.resolve();
      return collected.promise;
    },
    stageAgents: {
      model_id: "cancellation-integration-model",
      async analyzeEvidence() { stageCalls.push("EVIDENCE"); throw new Error("Canceled collection must not reach interpretation."); },
      async formStrategy() { stageCalls.push("STRATEGY"); throw new Error("Canceled collection must not reach Strategy."); },
      async designCampaigns() { stageCalls.push("CAMPAIGNS"); throw new Error("Canceled collection must not reach campaign generation."); },
    },
  };
  const controller = new OwnerPipelineController(runs, settings);
  const otherRequestController = new OwnerPipelineController(runs, settings);
  await controller.correctGoal(ownerKey, {
    customerGeography: "Россия",
    desiredOutcome: "Получать квалифицированные заявки",
    qualifiedAction: "Клиент подтвердил потребность и готов обсудить предложение",
    targetCount: 30,
    deadline: "2027-06-30",
    maxResultCostRub: 30_000,
  });
  await controller.start(ownerKey, view);
  const stop = async () => {
    const current = await runs.loadCurrent(ownerKey);
    return controller.stop(ownerKey, { runId: current.run_id, expectedVersion: current.version });
  };
  t.after(async () => {
    if ((await runs.loadCurrent(ownerKey))?.status === "ACTIVE") await stop();
    collected.resolve(snapshot);
    await Promise.allSettled(executions);
  });
  return {
    ownerKey, runId, controller, otherRequestController, runs, goals, products, entered, collected, snapshot, stageCalls, collectors, stop,
    execute(using = controller) {
      const execution = using.execute(ownerKey, runId, clone(view));
      executions.push(execution);
      // Cleanup observes failures even if an earlier test assertion fails.
      void execution.catch(() => undefined);
      return execution;
    },
  };
}

async function assertNoCanceledProducts(h) {
  assert.equal((await h.runs.loadCurrent(h.ownerKey)).status, "STOPPED");
  assert.deepEqual(h.stageCalls, []);
  assert.deepEqual(h.products.writes.map((product) => product.current_stage), ["CAMPAIGN_GOAL"]);
  assert.equal(h.products.current.analytics_evidence_snapshot, null);
  assert.equal(h.products.current.campaign_strategy, null);
  assert.deepEqual(h.products.current.campaign_pairs, []);
  assert.equal(h.products.current.publication_review, null);
  assert.deepEqual(h.products.current.authority, { external_write: "DENIED", publication: "NOT_AUTHORIZED", impressions: 0, spend_micros: 0 });
  const audit = await h.runs.loadAudit(h.runId);
  assert.deepEqual(audit.map((event) => event.event_kind), ["RUN_STARTED", "STAGE_VERIFIED", "RUN_STOPPED"]);
  assert.equal(audit.some((event) => event.stage === "EVIDENCE_COLLECTION" && event.event_kind === "STAGE_VERIFIED"), false);
}

test("owner STOP controller path aborts a pending collector and saves no Evidence or campaign pair", { timeout: 5_000 }, async (t) => {
  const h = await harness(t);
  const execution = h.execute();
  await h.entered.promise;
  assert.equal((await h.runs.loadCurrent(h.ownerKey)).current_stage, "EVIDENCE_COLLECTION");
  assert.equal(h.collectors[0].signal.aborted, false);

  // This is the controller method used by the UI STOP service action, not the cancellation helper.
  const stopped = await h.stop();
  assert.equal(stopped.status, "STOPPED");
  assert.equal(h.collectors[0].signal.aborted, true);
  assert.equal(h.collectors[0].signal.reason.name, "AbortError");
  assert.equal((await execution).status, "STOPPED");
  assert.equal(h.collectors.length, 1);
  await assertNoCanceledProducts(h);
});

test("a late collector response after STOP is discarded before interpretation and current-product acceptance", { timeout: 5_000 }, async (t) => {
  const h = await harness(t, { cooperative: false });
  const execution = h.execute();
  await h.entered.promise;
  await h.stop();
  assert.equal(h.collectors[0].signal.aborted, true);
  const stoppedProducts = clone(h.products.current);

  h.collected.resolve(h.snapshot);
  assert.equal((await execution).status, "STOPPED");
  assert.deepEqual(h.products.current, stoppedProducts);
  await assertNoCanceledProducts(h);
});

test("concurrent controller execute requests join the same pending collector instead of recollecting or returning stale ACTIVE", { timeout: 5_000 }, async (t) => {
  const h = await harness(t);
  const first = h.execute();
  await h.entered.promise;
  const duplicate = h.execute(h.otherRequestController);
  let duplicateSettled = false;
  void duplicate.finally(() => { duplicateSettled = true; }).catch(() => undefined);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.collectors.length, 1);
  assert.equal(duplicateSettled, false);

  await h.stop();
  const outcomes = await Promise.all([first, duplicate]);
  assert.deepEqual(outcomes.map((outcome) => [outcome.runId, outcome.status]), [[h.runId, "STOPPED"], [h.runId, "STOPPED"]]);
  assert.equal(h.collectors.length, 1);
  await assertNoCanceledProducts(h);
});
