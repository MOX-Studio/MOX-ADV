import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { buildAnalyticsEvidence, verifyAnalyticsEvidenceSnapshot, withFirstPartyGenerationHistory } from "../lib/analytics-evidence.ts";
import { buildDirectAuditReportDefinitions, DirectAccountAuditor } from "../lib/direct-audit.ts";
import { D1DirectAuditStore } from "../lib/p0-direct-audit-d1-store.ts";

const NOW = "2026-09-05T12:00:00.000Z";
const CAMPAIGN_ID = "9007199254740993123";
const ACCOUNT = "private-advertiser-login";

function d1(database) {
  const wrap = (statement, values = []) => ({
    bind(...next) { return wrap(statement, next); },
    async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; },
    async first() { return statement.get(...values) ?? null; },
  });
  return { prepare(sql) { return wrap(database.prepare(sql)); } };
}

async function fixture({ queryRows, metrika = true } = {}) {
  const database = new DatabaseSync(":memory:");
  const binding = d1(database);
  const store = new D1DirectAuditStore(binding);
  const definitions = buildDirectAuditReportDefinitions({ auditId: "history-audit", dateFrom: "2026-08-01", dateTo: "2026-09-02" });
  const queries = queryRows ?? [
    ["2026-09-01", CAMPAIGN_ID, "9007199254740993999", "заказать выставочный стенд", "участие в выставке", "9007199254740993888", "100", "12", "1800.00", "150", "0", "--"],
    ["2026-09-02", CAMPAIGN_ID, "9007199254740993999", "заказать участие контакт owner@example.com +7 999 111 22 33 https://example.com/?yclid=12345", "участие в выставке", "9007199254740993888", "60", "6", "900.00", "150", "--", "--"],
  ];
  const audit = await new DirectAccountAuditor({
    ownerKey: "owner",
    binding: {
      expected_account: ACCOUNT, api_account: ACCOUNT, client_id: "private-client-id", matched: true,
      restrictions: [], capability: { snapshot_id: "capability-1", fingerprint: `sha256:${"a".repeat(64)}` }, observed_at: NOW,
    },
    store,
    now: () => NOW,
    auditId: () => "history-audit",
    reportDefinitions: definitions,
    provider: {
      async getPage(input) {
        return { objects: input.collection === "campaigns" ? [{ Id: CAMPAIGN_ID, Name: "Campaign", Type: "UNIFIED_CAMPAIGN", State: "ON", Status: "ACCEPTED" }] : [], limited_by: null, warnings: [] };
      },
      async requestReport(definition) {
        const rows = definition.report_type === "SEARCH_QUERY_PERFORMANCE_REPORT" ? queries : [
          ["2026-09-01", CAMPAIGN_ID, "Campaign", "100", "12", "1800.00", "150", "0", "0", "--"],
        ];
        return { http_status: 200, retry_in_ms: null, warnings: [], body: [definition.request.params.FieldNames, ...rows].map((row) => row.join("\t")).join("\n") };
      },
    },
  }).run();
  const snapshot = await buildAnalyticsEvidence({
    generatedAt: NOW,
    site: { url: "https://owner.example/", fetched_at: NOW, text_excerpt: "Участие в выставке", pages: [], research: { pages_analyzed: 1 } },
    model: { product: "Участие в выставке", audience: "Компании", value: "Найти партнёров", qualified_result: "Заявка на участие", exclusions: "Вакансии", missing_questions: [] },
    context: {
      direct: {
        ready: true, inventory_ready: true, authority: "VERIFIED", access: "YANDEX_DIRECT_API_V501",
        account: ACCOUNT, client_id: "private-client-id", campaigns_total: 1, observed_at: NOW,
        binding: { expected_account: ACCOUNT, api_account: ACCOUNT, matched: true }, audit,
        read_limitations: { inventory_complete: true, methods_read: audit.methods_read, methods_not_read: audit.methods_not_read, statistics_provisional_days: 3 },
      },
      campaign_catalog: { total: 1, active: audit.campaign_summaries },
      metrika: metrika ? {
        ready: true, authority: "VERIFIED", access: "YANDEX_METRIKA_MANAGEMENT_AND_REPORTS_API", counter_id: "private-counter", goal_id: "private-goal", observed_at: NOW,
        binding: { expected_counter_id: "private-counter", api_counter_id: "private-counter", matched: true },
        goal_binding: { expected_goal_id: "private-goal", api_goal_id: "private-goal", matched: true },
      } : {},
      performance: metrika ? {
        period_start: "2026-08-28", period_end: "2026-09-04", display_metrics: { visits: "18", goal_visits: "3" },
        provenance: {
          source_kind: "METRIKA_REPORTS_API", observed_at: NOW, attribution: "last_direct_click_order_dimension", timezone: "Europe/Moscow",
          dimensions: ["ym:s:date", "ym:s:lastDirectClickOrder"], filters: `ym:s:lastDirectClickOrder=='${CAMPAIGN_ID}'`,
          sampling: { metadata_complete: true, sampled: false, contains_sensitive_data: false, sample_share: 1, sample_size: 18, sample_space: 18, data_lag: 0 },
        },
      } : null,
    },
  });
  return { database, binding, store, snapshot };
}

test("durable real-shaped Direct reports feed fresh generation evidence beyond CPC, survive restart, and preserve unknown versus zero", async () => {
  const { database, binding, store, snapshot } = await fixture();
  try {
    const enriched = await withFirstPartyGenerationHistory(snapshot, { ownerKey: "owner", store });
    const history = enriched.first_party_history;
    assert.equal(history.status, "AVAILABLE");
    assert.equal(history.query_observations.length, 2);
    assert.equal(history.campaign_observations.length, 1);
    const zero = history.query_observations.find((row) => row.date === "2026-09-01");
    const unknown = history.query_observations.find((row) => row.date === "2026-09-02");
    assert.equal(zero.reported_conversions, 0);
    assert.equal(unknown.reported_conversions, null);
    assert.equal(zero.query, "заказать выставочный стенд");
    assert.equal(zero.matched_keyword, "участие в выставке");
    assert.equal(zero.cost, 1800);
    assert.equal(zero.qualification, "DIAGNOSTIC_ONLY");
    assert.equal(zero.hypothesis_binding, "UNBOUND");
    assert.equal(history.metrika_observations[0].goal_visits, 3);
    assert.equal(history.metrika_observations[0].business_outcome_qualification, "UNKNOWN");
    assert.equal(history.metrika_observations[0].campaign_key, zero.campaign_key);
    assert.equal(history.metrika_observations[0].maturity, "UNKNOWN");
    assert.equal(enriched.prelaunch_cost.status, "UNAVAILABLE");
    assert.notEqual(enriched.snapshot_id, snapshot.snapshot_id);
    assert.equal(await verifyAnalyticsEvidenceSnapshot(enriched), true);
    const restarted = await withFirstPartyGenerationHistory(snapshot, { ownerKey: "owner", store: new D1DirectAuditStore(binding) });
    assert.deepEqual(restarted, enriched);
    assert.deepEqual(await withFirstPartyGenerationHistory(enriched, { ownerKey: "owner", store }), enriched);
    assert.equal(Object.isFrozen(enriched.first_party_history.query_observations), true);
    const evidenceIds = new Set(enriched.evidence.map((row) => row.evidence_id));
    for (const row of [...history.campaign_observations, ...history.query_observations, ...history.metrika_observations]) {
      assert.ok(row.evidence_ids.every((id) => evidenceIds.has(id)));
    }
    const serialized = JSON.stringify(history);
    for (const privateValue of [ACCOUNT, CAMPAIGN_ID, "private-client-id", "private-counter", "private-goal", "owner@example.com", "999 111", "yclid=12345", "9007199254740993999"]) {
      assert.equal(serialized.includes(privateValue), false, privateValue);
    }
    assert.match(unknown.query, /REDACTED/u);
    const tampered = structuredClone(enriched);
    tampered.first_party_history.query_observations[0].reported_conversions = 200;
    assert.equal(await verifyAnalyticsEvidenceSnapshot(tampered), false);
  } finally { database.close(); }
});

test("wrong owner and corrupted durable artifact cannot become first-party performance evidence", async () => {
  const { database, store, snapshot } = await fixture({ metrika: false });
  try {
    const wrongOwner = await withFirstPartyGenerationHistory(snapshot, { ownerKey: "another-owner", store });
    assert.equal(wrongOwner.first_party_history.status, "UNAVAILABLE");
    assert.equal(wrongOwner.first_party_history.query_observations.length, 0);
    const corrupt = await withFirstPartyGenerationHistory(snapshot, {
      ownerKey: "owner",
      store: {
        getSnapshot: (id) => store.getSnapshot(id),
        async getArtifact(id) {
          const artifact = await store.getArtifact(id);
          return { ...artifact, tsv: artifact.tsv.replace("1800.00", "1.00") };
        },
      },
    });
    assert.equal(corrupt.first_party_history.status, "UNAVAILABLE");
    assert.ok(corrupt.first_party_history.limitations.some((limitation) => limitation.includes("digest verification")));
    assert.equal(await verifyAnalyticsEvidenceSnapshot(corrupt), true);
  } finally { database.close(); }
});

test("a proven owner mismatch excludes Metrica too, and a mutable checkpoint cannot replace sealed report evidence", async () => {
  const { database, store, snapshot } = await fixture();
  try {
    const wrongOwner = await withFirstPartyGenerationHistory(snapshot, { ownerKey: "another-owner", store });
    assert.equal(wrongOwner.first_party_history.status, "UNAVAILABLE");
    assert.deepEqual(wrongOwner.first_party_history.metrika_observations, []);
    let artifactReads = 0;
    const drifted = await withFirstPartyGenerationHistory(snapshot, {
      ownerKey: "owner",
      store: {
        async getSnapshot(id) {
          const value = await store.getSnapshot(id);
          for (const report of value.checkpoint.reports) report.artifact_reference.digest = `sha256:${"0".repeat(64)}`;
          return value;
        },
        async getArtifact() { artifactReads += 1; throw new Error("untrusted reference"); },
      },
    });
    assert.equal(artifactReads, 0);
    assert.deepEqual(drifted.first_party_history.query_observations, []);
    assert.ok(drifted.first_party_history.limitations.some((limitation) => limitation.includes("sealed Analytics")));
  } finally { database.close(); }
});

test("history bounds report samples with explicit omitted coverage and does not infer missing Metrica zeroes", async () => {
  const queryRows = Array.from({ length: 150 }, (_, index) => [
    "2026-09-02", CAMPAIGN_ID, "2", `запрос ${index}`, "выставка", "3", "10", "1", "100", "100", "0", "--",
  ]);
  const { database, store, snapshot } = await fixture({ queryRows, metrika: false });
  try {
    const enriched = await withFirstPartyGenerationHistory(snapshot, { ownerKey: "owner", store });
    const history = enriched.first_party_history;
    assert.equal(history.status, "PARTIAL");
    assert.equal(history.query_observations.length, 120);
    assert.equal(history.coverage.direct_rows_available, 151);
    assert.equal(history.coverage.omitted_rows, 30);
    assert.deepEqual(history.metrika_observations, []);
    assert.ok(history.limitations.some((limitation) => limitation.includes("unknown, not zero")));
    assert.equal(await verifyAnalyticsEvidenceSnapshot(enriched), true);
  } finally { database.close(); }
});

test("production collector enriches the just-collected snapshot through the durable Direct audit store", async () => {
  const source = await readFile(new URL("../lib/p0.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export async function productionPipelineEvidenceCollector"), source.indexOf("async function coordinateOwnerAgent"));
  assert.match(body, /const snapshot = await application\.collectCurrentAnalyticsEvidence/u);
  assert.match(body, /const enriched = await withFirstPartyGenerationHistory\(snapshot,\s*\{\s*ownerKey: input\.ownerKey,\s*store: new D1DirectAuditStore\(runtimeEnv\(\)\.DB\)/u);
  assert.match(body, /input\.signal\?\.throwIfAborted\(\);\s*return enriched/u);
});
