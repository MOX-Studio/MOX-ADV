import assert from "node:assert/strict";
import test from "node:test";

import {
  P0_AGENT_TOOL_DEFINITIONS,
  P0Application,
} from "../lib/p0-application.ts";
import { P0AgentRuntime } from "../lib/p0-agent-runtime.ts";

class MemoryStore {
  constructor() {
    this.rows = new Map();
  }

  async load(key) {
    return this.rows.get(key) ?? null;
  }

  async initialize(key, row) {
    if (this.rows.has(key)) return false;
    this.rows.set(key, structuredClone(row));
    return true;
  }

  async compareAndSwap(key, expectedRevision, row) {
    if (this.rows.get(key)?.revision !== expectedRevision) return false;
    this.rows.set(key, structuredClone(row));
    return true;
  }

  async history() {
    return [];
  }
}

const NOW = "2026-08-22T20:00:00.000Z";

function context() {
  return {
    environment: "PRODUCTION",
    test_scenario: false,
    direct: {
      ready: true,
      inventory_ready: true,
      authority: "VERIFIED",
      access: "YANDEX_DIRECT_API_V501",
      account: "advertiser-login",
      client_id: "client-4242",
      binding: { expected_account: "advertiser-login", api_account: "advertiser-login", matched: true },
      campaigns_total: 2,
      minimum_weekly_budget_rub: 300,
      observed_at: NOW,
      capability_snapshot: {
        schema_version: "direct-account-capability-snapshot-v1",
        snapshot_id: "direct-capability:fixture",
        source: "YANDEX_DIRECT_API_V501",
        account: "advertiser-login",
        observed_at: NOW,
        api_version: "v501",
        archived: "NO",
        currency: "RUB",
        edit_campaigns_grant: "YES",
        available_campaign_types: ["UNIFIED_CAMPAIGN"],
        restrictions: [],
        conditional_capabilities: [],
      },
      read_limitations: {
        inventory_complete: true,
        limited_by: null,
        methods_read: ["Campaigns.get", "AdGroups.get", "Keywords.get", "Ads.get", "Reports.SEARCH_QUERY_PERFORMANCE_REPORT"],
        methods_not_read: [],
        statistics_provisional_days: 3,
      },
    },
    metrika: {
      ready: true,
      authority: "VERIFIED",
      access: "YANDEX_METRIKA_MANAGEMENT_AND_REPORTS_API",
      counter_id: "424242",
      goal_id: "1717",
      time_zone: "Europe/Moscow",
      binding: { expected_counter_id: "424242", api_counter_id: "424242", matched: true },
      goal_binding: { expected_goal_id: "1717", api_goal_id: "1717", matched: true },
      observed_at: NOW,
    },
    campaign_catalog: { total: 2, active: [] },
    performance: null,
  };
}

function auditSummary(status = "COMPLETE") {
  return {
    schema_version: "direct-read-audit-summary-v1",
    audit_id: "direct-audit-tool",
    status,
    graph_complete: true,
    observed_at: NOW,
    completed_at: status === "PENDING" ? null : NOW,
    account_binding: { expected_account: "advertiser-login", api_account: "advertiser-login", client_id: "client-4242", matched: true },
    provider_restrictions: [],
    object_counts: { campaigns: 2, adgroups: 4, audiencetargets: 2, keywords: 20, ads: 8, sitelinks: 2, adimages: 4, vcards: 0, creatives: 0, adextensions: 3, autotargetings: 4 },
    campaign_summaries: [{ campaign_id: "9007199254740993123", name: "Основная", type: "UNIFIED_CAMPAIGN", state: "ON", status: "ACCEPTED" }],
    report_summaries: [{
      report_key: "search",
      report_type: "SEARCH_QUERY_PERFORMANCE_REPORT",
      status: status === "PENDING" ? "QUEUED" : "COMPLETE",
      next_retry_at: status === "PENDING" ? "2026-08-22T20:00:30.000Z" : null,
      artifact_reference: null,
    }],
    methods_read: ["Campaigns.get", "AdGroups.get", "Keywords.get", "Ads.get"],
    methods_not_read: [],
    limitations: [],
    next_retry_at: status === "PENDING" ? "2026-08-22T20:00:30.000Z" : null,
    artifact_references: [{
      artifact_id: "direct-audit-tool:manifest",
      audit_id: "direct-audit-tool",
      kind: "DIRECT_AUDIT_MANIFEST",
      digest: "sha256:manifest",
      byte_length: 1000,
      object_count: 43,
      observed_at: NOW,
    }],
    browser_cabinet_used: false,
    provider_write_methods_reachable: false,
  };
}

function adapters(readDirectAudit) {
  return {
    now: () => NOW,
    async readContext() {
      return context();
    },
    readDirectAudit,
    externalWriteConfiguration() {
      return { ready: false, blockers: ["writes disabled in audit test"], account: "advertiser-login" };
    },
  };
}

test("trusted application publishes one bounded read-only Direct audit tool and validates its artifact summary", async () => {
  const auditCalls = [];
  const application = new P0Application({
    store: new MemoryStore(),
    adapters: adapters(async (input) => {
      auditCalls.push(structuredClone(input));
      return auditSummary();
    }),
  });
  const definition = P0_AGENT_TOOL_DEFINITIONS.find((tool) => tool.name === "p0_audit_direct_account");
  assert.equal(definition.permission, "P0_PROVIDER_READ");
  assert.deepEqual(definition.input_schema.required, ["expected_revision"]);
  assert.equal(definition.input_schema.additionalProperties, false);
  assert.ok(P0_AGENT_TOOL_DEFINITIONS.every((tool) => !/(add|update|delete|suspend|resume|moderate)/iu.test(tool.name)));

  const contract = await application.agentContract("owner", "COORDINATE_OWNER_JOURNEY");
  assert.ok(contract.policy.allowed_permissions.includes("P0_PROVIDER_READ"));
  const result = await application.executeAgentTool({
    owner_key: "owner",
    run_id: "agent-run-direct-audit",
    objective: contract.objective,
    authority: contract.authority,
    call: { id: "call-direct-audit", name: "p0_audit_direct_account", arguments: { expected_revision: 0 } },
    observation_sequence: 1,
  });

  assert.deepEqual(auditCalls, [{ owner_key: "owner" }]);
  assert.equal(result.observation.trust, "UNTRUSTED_EVIDENCE");
  assert.equal(result.observation.facts.direct_audit.status, "COMPLETE");
  assert.equal(result.observation.facts.direct_audit.object_counts.keywords, 20);
  assert.ok(JSON.stringify(result.observation.facts).length < 64_000);
  assert.ok(result.observation.source_references.some((reference) => reference.source_kind === "DIRECT_AUDIT_ARTIFACT"));
  assert.equal(result.observation.facts.direct_audit.provider_write_methods_reachable, false);
});

test("application context exposes only the validated bounded Direct audit summary", async () => {
  const summary = auditSummary();
  const inputContext = context();
  inputContext.direct.audit = summary;
  inputContext.direct.read_limitations.provider_limitations = [];
  const application = new P0Application({
    store: new MemoryStore(),
    adapters: {
      ...adapters(async () => summary),
      async readContext() {
        return inputContext;
      },
    },
  });

  const query = await application.query("owner");
  assert.deepEqual(query.context.direct.audit, summary);
  assert.deepEqual(query.context.direct.read_limitations.provider_limitations, []);
  assert.ok(!JSON.stringify(query.context.direct.audit).includes("raw provider payload"));
});

test("queued Direct report observation stops resumably at its durable retry time", async () => {
  const application = new P0Application({
    store: new MemoryStore(),
    adapters: adapters(async () => auditSummary("PENDING")),
  });
  const contract = await application.agentContract("owner", "COORDINATE_OWNER_JOURNEY");
  const result = await application.executeAgentTool({
    owner_key: "owner",
    run_id: "agent-run-direct-audit",
    objective: contract.objective,
    authority: contract.authority,
    call: { id: "call-direct-audit", name: "p0_audit_direct_account", arguments: { expected_revision: 0 } },
    observation_sequence: 1,
  });
  const evaluation = await application.evaluateAgentObjective({
    owner_key: "owner",
    run_id: "agent-run-direct-audit",
    objective: contract.objective,
    authority: contract.authority,
    observation_count: 1,
    last_observation: result.observation,
  });
  assert.equal(evaluation.status, "STOP");
  assert.equal(evaluation.stop_reason.code, "TEMPORARY_PROVIDER_FAILURE");
  assert.equal(evaluation.stop_reason.resumable, true);
  assert.equal(evaluation.stop_reason.resume_at, "2026-08-22T20:00:30.000Z");
});

test("durable coordinator resumes a queued Direct report after due time without owner controls", async () => {
  let auditCalls = 0;
  let runtimeNow = NOW;
  const application = new P0Application({
    store: new MemoryStore(),
    adapters: {
      ...adapters(async () => auditSummary(++auditCalls === 1 ? "PENDING" : "COMPLETE")),
      now: () => runtimeNow,
    },
  });
  const runs = new Map();
  const runStore = {
    async load(runId) { return structuredClone(runs.get(runId) ?? null); },
    async loadCurrent(ownerKey) {
      return structuredClone([...runs.values()].filter((run) => run.owner_key === ownerKey).at(-1) ?? null);
    },
    async initialize(state) {
      if (runs.has(state.run_id)) return false;
      runs.set(state.run_id, structuredClone(state));
      return true;
    },
    async compareAndSwap(runId, expectedVersion, state) {
      if (runs.get(runId)?.version !== expectedVersion) return false;
      runs.set(runId, structuredClone(state));
      return true;
    },
  };
  const authority = {
    contract: (ownerKey, kind) => application.agentContract(ownerKey, kind),
    executeTool: (input) => application.executeAgentTool(input),
    evaluate: (input) => application.evaluateAgentObjective(input),
  };
  const firstModel = {
    adapter_id: "queued-report-model",
    async turn() {
      return {
        kind: "TOOL_CALLS",
        calls: [{ id: "audit-1", name: "p0_audit_direct_account", arguments: { expected_revision: 0 } }],
        usage: { input_tokens: 50, output_tokens: 10, cost_microusd: 30 },
      };
    },
  };
  const budgets = {
    max_model_calls: 6,
    max_tool_calls: 6,
    max_input_tokens: 2_000,
    max_output_tokens: 1_000,
    max_elapsed_ms: 30_000,
    max_cost_microusd: 1_000,
  };
  const interrupted = await new P0AgentRuntime({
    application: authority,
    model: firstModel,
    store: runStore,
    now: () => runtimeNow,
    createId: () => "queued-report-run",
  }).coordinate({ owner_key: "owner", budgets });
  assert.equal(interrupted.stop_reason.code, "TEMPORARY_PROVIDER_FAILURE");
  assert.equal(auditCalls, 1);

  runtimeNow = "2026-08-22T20:00:20.000Z";
  let earlyModelCalls = 0;
  const early = await new P0AgentRuntime({
    application: authority,
    model: { adapter_id: "queued-report-model", async turn() { earlyModelCalls += 1; throw new Error("not due"); } },
    store: runStore,
    now: () => runtimeNow,
  }).coordinate({ owner_key: "owner", budgets });
  assert.equal(early.version, interrupted.version);
  assert.equal(earlyModelCalls, 0);

  runtimeNow = "2026-08-22T20:00:31.000Z";
  const turns = [
    {
      kind: "TOOL_CALLS",
      calls: [{ id: "audit-2", name: "p0_audit_direct_account", arguments: { expected_revision: 0 } }],
      usage: { input_tokens: 50, output_tokens: 10, cost_microusd: 30 },
    },
    {
      kind: "TOOL_CALLS",
      calls: [{
        id: "assessment",
        name: "p0_record_owner_journey_assessment",
        arguments: {
          expected_revision: 0,
          owner_question_required: false,
          next_boundary: "OWNER_REVIEW",
          summary: "The business entry point is ready for owner review.",
        },
      }],
      usage: { input_tokens: 60, output_tokens: 15, cost_microusd: 40 },
    },
  ];
  const resumed = await new P0AgentRuntime({
    application: authority,
    model: { adapter_id: "queued-report-model", async turn() { return turns.shift(); } },
    store: runStore,
    now: () => runtimeNow,
  }).coordinate({ owner_key: "owner", budgets });
  assert.equal(resumed.status, "COMPLETED");
  assert.equal(resumed.compaction.through_observation_sequence, 1);
  assert.equal(auditCalls, 2);
  assert.equal(resumed.budget.usage.cost_microusd, 100);
});
