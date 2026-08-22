import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { DirectAccountAuditor } from "../lib/direct-audit.ts";
import { D1DirectAuditStore } from "../lib/p0-direct-audit-d1-store.ts";

function d1Shim(database) {
  const wrap = (statement, values = []) => ({
    bind(...nextValues) {
      return wrap(statement, nextValues);
    },
    async run() {
      const result = statement.run(...values);
      return { meta: { changes: Number(result.changes) } };
    },
    async first() {
      return statement.get(...values) ?? null;
    },
  });
  return {
    prepare(sql) {
      return wrap(database.prepare(sql));
    },
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

test("D1 Direct audit store reloads graph artifacts and exact report retry state after restart", async () => {
  const database = new DatabaseSync(":memory:");
  const binding = d1Shim(database);
  let currentTime = "2026-08-22T19:00:00.000Z";
  const reportResponses = [
    { http_status: 201, retry_in_ms: 10_000, body: null, warnings: [], request_id: "queued" },
    { http_status: 200, retry_in_ms: null, body: "CampaignId\tClicks\n9007199254740993123\t4\n", warnings: [], request_id: "ready" },
  ];
  const provider = {
    async getPage(input) {
      return {
        objects: input.collection === "campaigns"
          ? [{ Id: "9007199254740993123", Name: "Основная", Type: "UNIFIED_CAMPAIGN", State: "ON", Status: "ACCEPTED" }]
          : [],
        limited_by: null,
        warnings: [],
      };
    },
    async requestReport() {
      return reportResponses.shift();
    },
  };
  const reportDefinitions = [{
    report_key: "campaign",
    report_type: "CAMPAIGN_PERFORMANCE_REPORT",
    processing_mode: "auto",
    request: { params: { ReportName: "durable-campaign", ReportType: "CAMPAIGN_PERFORMANCE_REPORT" } },
  }];
  const auditor = (store) => new DirectAccountAuditor({
    ownerKey: "owner",
    binding: {
      expected_account: "advertiser-login",
      api_account: "advertiser-login",
      client_id: "client-4242",
      matched: true,
      restrictions: [],
      observed_at: "2026-08-22T19:00:00.000Z",
    },
    provider,
    store,
    now: () => currentTime,
    auditId: () => "direct-audit-d1",
    reportDefinitions,
  });

  const firstProcess = new D1DirectAuditStore(binding);
  const pending = await auditor(firstProcess).run();
  assert.equal(pending.status, "PENDING");
  assert.equal(pending.next_retry_at, "2026-08-22T19:00:10.000Z");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM p0_direct_audits").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM p0_direct_audit_artifacts").get().count, 5);
  const durableRow = database.prepare("SELECT status, next_retry_at, state_json FROM p0_direct_audits").get();
  assert.equal(durableRow.status, "PENDING");
  assert.equal(durableRow.next_retry_at, "2026-08-22T19:00:10.000Z");
  assert.deepEqual(JSON.parse(durableRow.state_json).reports[0].request, reportDefinitions[0].request);

  currentTime = "2026-08-22T19:00:10.000Z";
  const restartedProcess = new D1DirectAuditStore(binding);
  const completed = await auditor(restartedProcess).run();
  assert.equal(completed.status, "COMPLETE");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM p0_direct_audit_artifacts").get().count, 6);
  const reportReference = completed.artifact_references.find((reference) => reference.kind === "DIRECT_REPORT_TSV");
  const reportArtifact = await restartedProcess.getArtifact(reportReference.artifact_id);
  assert.equal(reportArtifact.tsv, "CampaignId\tClicks\n9007199254740993123\t4\n");
  database.close();
});
