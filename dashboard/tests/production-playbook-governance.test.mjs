import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { D1CampaignPlaybookKnowledgeStore } from "../lib/campaign-playbook-candidates-d1-store.ts";
import { D1CampaignPlaybookGovernanceStore } from "../lib/campaign-playbook-governance-d1-store.ts";
import { ProductionCampaignPlaybookGovernance } from "../lib/production-playbook-governance.ts";

function d1Shim(database) {
  const wrap = (statement, values = []) => ({
    bind(...nextValues) { return wrap(statement, nextValues); },
    async run() { const result = statement.run(...values); return { meta: { changes: Number(result.changes) } }; },
    async first() { return statement.get(...values) ?? null; },
    async all() { return { results: statement.all(...values) }; },
  });
  return { prepare(sql) { return wrap(database.prepare(sql)); } };
}

function service(database, methodology = { async propose() { throw new Error("not used"); } }) {
  const binding = d1Shim(database);
  return new ProductionCampaignPlaybookGovernance(
    new D1CampaignPlaybookKnowledgeStore(binding),
    new D1CampaignPlaybookGovernanceStore(binding),
    methodology,
    () => "2026-09-01T12:00:00.000Z",
  );
}

test("production bootstrap consumes only the exact governed curated release", async () => {
  const database = new DatabaseSync(":memory:");
  const governance = service(database);
  const snapshot = await governance.strategySnapshot();
  const projection = await governance.projection();

  assert.equal(snapshot.status, "ACTIVE_APPROVED");
  assert.equal(snapshot.release.release_id, "p0-curated-playbook-v1");
  assert.equal(projection.status, "ACTIVE_APPROVED");
  assert.equal(projection.latest_decision.action, "ACTIVATE_RELEASE");
  assert.deepEqual(projection.authority, {
    evidence_override: false,
    mandate_grant: false,
    campaign_execution: false,
    campaign_publication: false,
    spend: false,
  });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM p0_playbook_releases").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM p0_playbook_release_decisions").get().count, 1);
  database.close();
});

test("bounded Knowledge Steward stop is append-only and blocks later Strategy consumption", async () => {
  const database = new DatabaseSync(":memory:");
  const governance = service(database);
  const before = await governance.projection();
  const result = await governance.stewardDecision({
    action: "STOP_PLAYBOOK_USE",
    reason: "Pause new Playbook consumption pending governance review.",
    expected_release_digest: before.release.content_digest,
    expected_policy_digest: before.promotion_policy.content_digest,
    expected_delegation_digest: before.delegation.content_digest,
    expected_latest_decision_digest: before.latest_decision.content_digest,
  });

  assert.equal(result.projection.status, "STOPPED");
  assert.equal(result.decision.authority.campaign_execution, false);
  await assert.rejects(governance.strategySnapshot(), /not consumable: PLAYBOOK_USE_STOPPED_BY_STEWARD/u);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM p0_playbook_release_decisions").get().count, 2);
  assert.throws(() => database.prepare("DELETE FROM p0_playbook_release_decisions").run(), /immutable/u);
  database.close();
});

test("Methodology Agent output is persisted only as an authority-neutral immutable candidate", async () => {
  const database = new DatabaseSync(":memory:");
  const methodology = {
    async propose() {
      return {
        schema_version: "p0-methodology-agent-candidate-v1",
        candidate_id: "methodology-candidate:fixture",
        model_id: "fixture-model",
        proposed_at: "2026-09-01T12:00:00.000Z",
        summary: "Candidate only.",
        proposed_rules: [{ rule_key: "qualified-action", mechanism: "Name the action.", applicability: "Search only.", evidence_refs: ["evidence-1"] }],
        source_outcomes: ["outcome-1"],
        authority: { activate_playbook: false, mutate_policy: false, mutate_campaign: false, publish: false, spend: false },
      };
    },
  };
  const governance = service(database, methodology);
  const candidate = await governance.proposeMethodologyCandidate([{
    outcome_id: "outcome-1",
    observed_at: "2026-08-30T00:00:00.000Z",
    result_class: "MATURE_RESULT",
    evidence_ids: ["evidence-1"],
    summary: "Mature exact result.",
  }]);
  assert.equal(candidate.authority.activate_playbook, false);
  assert.equal((await governance.projection()).methodology_candidate_count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM p0_playbook_release_decisions").get().count, 1);
  database.close();
});
