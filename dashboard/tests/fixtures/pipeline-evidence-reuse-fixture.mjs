import { buildAnalyticsEvidence } from "../../lib/analytics-evidence.ts";
import { OwnerPipelineController } from "../../lib/pipeline-owner-dashboard.ts";
import { pipelineDigest } from "../../lib/pipeline-orchestrator.ts";
import { QUALIFIED_REQUEST_COUNTING_POLICY } from "../../lib/goal-revision.ts";

export class ReuseRunStore {
  runs = new Map();
  events = new Map();
  order = [];
  async load(id) { return this.runs.has(id) ? structuredClone(this.runs.get(id)) : null; }
  async loadCurrent(owner) { const id = [...this.order].reverse().find((id) => this.runs.get(id).owner_key === owner); return id ? this.load(id) : null; }
  async loadActive(owner) { const run = [...this.runs.values()].find((run) => run.owner_key === owner && run.status === "ACTIVE"); return run ? structuredClone(run) : null; }
  async loadAudit(id) { return structuredClone(this.events.get(id) ?? []); }
  async initialize(run, event) {
    if (this.runs.has(run.run_id) || await this.loadActive(run.owner_key)) return false;
    this.runs.set(run.run_id, structuredClone(run)); this.events.set(run.run_id, [structuredClone(event)]); this.order.push(run.run_id); return true;
  }
  async compareAndSwap(id, revision, run, event) {
    if (this.runs.get(id)?.version !== revision) return false;
    this.runs.set(id, structuredClone(run)); this.events.set(id, [...this.events.get(id), structuredClone(event)]); return true;
  }
}

export class ReuseProductStore {
  current = null;
  history = [];
  async loadCurrent() { return structuredClone(this.current); }
  async loadEvidenceCandidates() { return structuredClone([...this.history].reverse().filter((value) => value.current_stage === "EVIDENCE_COLLECTION").slice(0, 8)); }
  async compareAndSwap(_owner, revision, next) {
    if ((this.current?.state_revision ?? null) !== revision) return false;
    this.current = structuredClone(next); this.history.push(structuredClone(next)); return true;
  }
}

export function replaySnapshotInput() {
  const observed = "2026-09-05T19:40:00.000Z";
  return {
    generatedAt: observed,
    site: { fetched_at: observed, url: "https://owner.example/", pages: [{ url: "https://owner.example/", title: "Промышленная выставка", headings: ["Участие со стендом"], text_excerpt: "Участие со стендом для промышленных компаний.", forms_detected: 1 }] },
    model: {
      product: "Участие со стендом", audience: "Промышленные компании", value: "Представить продукцию", qualified_result: "Заявка компании", exclusions: "Посетители", missing_questions: [],
      field_evidence: {
        product: { confidence: "HIGH", source_url: "https://owner.example/", quote: "Участие со стендом для промышленных компаний." },
        audience: { confidence: "HIGH", source_url: "https://owner.example/", quote: "Участие со стендом для промышленных компаний." },
      },
    },
    context: {
      direct: { ready: true, inventory_ready: true, authority: "VERIFIED", access: "YANDEX_DIRECT_API_V501", account: "owner-account", client_id: "123", binding: { matched: true, expected_account: "owner-account", api_account: "owner-account" }, campaigns_total: 1, observed_at: observed, read_limitations: { inventory_complete: true, methods_read: ["Campaigns.get"], methods_not_read: ["Ads.get"], statistics_provisional_days: 3 } },
      campaign_catalog: { total: 1, active: [{ campaign_id: "77", name: "Выставка", state: "ON", status: "ACCEPTED" }] },
      metrika: { ready: false, authority: "UNKNOWN", counter_id: "456", goal_id: "789", blockers: ["No qualified measurement"] },
      performance: {},
    },
  };
}

export async function createEvidenceReuseHarness({ snapshot, now = "2026-09-05T20:00:00.000Z", productStore } = {}) {
  const input = replaySnapshotInput();
  snapshot ??= await buildAnalyticsEvidence(input);
  const runStore = new ReuseRunStore();
  const products = productStore ?? new ReuseProductStore();
  const goals = {
    current: null,
    async loadCurrent() { return structuredClone(this.current); },
    async append(next, expected) { if ((this.current?.revision.version ?? null) !== expected) return false; this.current = structuredClone(next); return true; },
  };
  const view = {
    revision: 1,
    state: {
      schema_version: "p0-application-document-v19", context_state: { facts: structuredClone(input.context), material_fingerprint: "research-scope:1" },
      site_analysis: structuredClone(input.site), business_model: structuredClone(input.model),
      product_focus: { focus_revision_id: "focus:1", selected_offer_id: "offer:1" },
      analytics_evidence_snapshot: structuredClone(snapshot), analytics_evidence_lifecycle: { pending_replacement: null },
      strategy: { schema_version: "campaign-strategy-v4", strategy_revision_id: "strategy:seed", answers: [{ field_id: "geography", value: "Москва" }, { field_id: "weekly_budget", value: 30_000 }] },
      recommendation_set: { drafts: [] },
    },
  };
  const calls = { collection: 0, evidence: 0, strategy: 0, design: 0, designInputs: [], signals: [] };
  const failures = { collection: false, strategy: false, design: false };
  const ref = async (schema, id, value) => ({ schema_version: schema, revision_id: id, digest: await pipelineDigest(value) });
  const result = async (role, output, artifact, evidence) => ({ actor: { actor_id: role.toLowerCase(), actor_type: "AGENT", role }, output, artifact, evidence, check_id: `${role}_VERIFIED`, schema: await ref(`${role.toLowerCase()}-result-v1`, "1.0.0", {}), summary: `${role} completed.` });
  const agents = {
    model_id: "replay-fixture-model",
    async analyzeEvidence({ goal, evidence, snapshot }) {
      calls.evidence += 1;
      return { ...await result("EVIDENCE_ANALYST", evidence, structuredClone(snapshot), [goal, evidence]), interpretation: { schema_version: "p0-evidence-stage-interpretation-v1", source_snapshot: structuredClone(evidence), summary: "Исходные сведения проверены; качество заявок неизвестно.", findings: [], evidence_refs: [snapshot.snapshot_id], gap_refs: [] } };
    },
    async formStrategy({ goal, evidence }) {
      calls.strategy += 1;
      if (failures.strategy) throw new Error("Injected Strategy rejection");
      const strategy = { schema_version: "p0-autonomous-campaign-strategy-v1", strategy_revision_id: `strategy:${calls.strategy}`, status: "AGENT_ACCEPTED", dimensions: [] };
      const artifact = { schema_version: "p0-strategy-stage-product-v1", strategy, inputs: { business_input: { content: {} } } };
      return { ...await result("STRATEGY_AGENT", await ref(strategy.schema_version, strategy.strategy_revision_id, strategy), artifact, [goal, evidence]), autonomous_strategy: strategy };
    },
    async designCampaigns(input) {
      calls.design += 1; calls.designInputs.push(structuredClone(input));
      if (failures.design) throw new Error("Injected Design rejection");
      return result("CAMPAIGN_DESIGN_AGENT", input.pairSet, [], [input.strategy, input.evidence]);
    },
  };
  let counter = 0;
  let currentTime = now;
  const controller = new OwnerPipelineController(runStore, {
    goalStore: goals, productStore: products, stageAgents: agents,
    newRunId: () => `reuse-fixture:${++counter}`, now: () => currentTime,
    async evidenceCollector({ signal }) {
      calls.collection += 1; calls.signals.push(signal);
      if (failures.collection) throw new Error("Injected collection failure");
      return structuredClone(snapshot);
    },
  });
  await controller.correctGoal("owner", { desiredOutcome: "Получать заявки на участие", qualifiedAction: "Заявка компании", targetCount: 30, deadline: "2026-10-01", totalBudgetRub: 150_000,
    customerGeography: "Россия", countingPolicy: QUALIFIED_REQUEST_COUNTING_POLICY });
  return {
    snapshot, view, runStore, products, goals, controller, calls, failures,
    setNow(value) { currentTime = value; },
    async fullRun() { const started = await controller.start("owner", view); return controller.execute("owner", started.runId, view); },
    async regenerate() {
      const available = await controller.evidenceReuse("owner", view);
      const started = await controller.startFromEvidence("owner", view, { expectedStateRevision: available.expectedStateRevision, reuseToken: available.reuseToken });
      return controller.executeFromEvidence("owner", started.pipeline.runId, view, started.plan);
    },
  };
}
