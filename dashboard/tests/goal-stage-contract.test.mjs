import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createCurrentGoal, reviseCurrentGoal, goalDependencies } from "../lib/goal-revision-lifecycle.ts";
import { GOAL_CANDIDATE_SCHEMA, GOAL_CANDIDATE_SCHEMA_V2, QUALIFIED_REQUEST_COUNTING_POLICY, assertGoalReady, goalReadinessErrors, normalizeOwnerGoalInput, verifyGoalCandidate, verifyGoalFormationResult } from "../lib/goal-revision.ts";
import { verifyGoalEvidenceScope, goalMatchesProviderRegion } from "../lib/goal-evidence-scope.ts";
import { projectOwnerPipeline } from "../lib/pipeline-owner-dashboard.ts";
import { verifyAnalyticsEvidenceSnapshot } from "../lib/analytics-evidence.ts";
import { P0Application } from "../lib/p0-application.ts";

const at = "2026-09-07T10:00:00.000Z";
const input = () => ({
  owner_key: "goal-test-owner", created_at: at,
  desired_outcome: "Получать квалифицированные обращения компаний на участие со стендом",
  qualified_action: "Представитель компании подтвердил интерес и готов обсуждать формат, сроки и бюджет",
  customer_geography: "Россия",
  success_criterion: { target_count: 30, deadline: "2027-06-30", max_result_cost_rub: 30_000 },
});
const ref = (goal) => ({ schema_version: goal.schema_version, revision_id: goal.goal_revision_id, digest: goal.digest });

async function legacyGoal() {
  const result = await verifyGoalCandidate({
    candidate: {
      schema_version: GOAL_CANDIDATE_SCHEMA,
      desired_outcome: input().desired_outcome, qualified_action: input().qualified_action,
      success_criterion: input().success_criterion,
      used_input_ids: ["owner"],
      provenance: [
        { input_id: "owner", supports: "DESIRED_OUTCOME", locator: "owner.goal", evidence: input().desired_outcome },
        { input_id: "owner", supports: "QUALIFIED_ACTION", locator: "owner.qualification", evidence: input().qualified_action },
      ],
      known_constraints: [{ constraint: "Не считать обращения посетителей", input_ids: ["owner"] }],
      material_ambiguity: null,
    },
    exact_inputs: [{ input_id: "owner", schema_version: "owner-input-v1", revision_id: "owner:1", digest: `sha256:${"1".repeat(64)}` }],
    verified_at: at,
  });
  return { schema_version: "p0-current-goal-v1", owner_key: "goal-test-owner", source: "OWNER_INPUT", invalidation: null, revision: result.revision };
}

test("v2 owner Goal seals geography and request-level counting with exact provenance", async () => {
  const current = await createCurrentGoal(input());
  const goal = current.revision;
  assert.equal(goal.schema_version, "p0-goal-revision-v2");
  assert.equal(goal.customer_geography, "Россия");
  assert.deepEqual(goal.counting_policy, QUALIFIED_REQUEST_COUNTING_POLICY);
  assert.equal(goal.counting_policy.deduplication_key, "COMPANY_AND_REQUEST");
  assert.equal(goal.counting_policy.repeated_contacts, "DO_NOT_COUNT");
  assert.equal(goal.counting_policy.form_submission_alone, "DOES_NOT_QUALIFY");
  assert.ok(goal.provenance.some((item) => item.supports === "CUSTOMER_GEOGRAPHY"));
  assert.ok(goal.provenance.some((item) => item.supports === "COUNTING_POLICY"));
  assert.deepEqual(goalReadinessErrors(goal), []);
  await verifyGoalFormationResult({ status: "VERIFIED", revision: goal });
  await verifyGoalEvidenceScope({ goal: ref(goal), goalRevision: goal });
  for (const change of [{ customer_geography: "Москва" }, { counting_policy: { ...goal.counting_policy, repeated_contacts: "COUNT" } }]) {
    await assert.rejects(verifyGoalFormationResult({ status: "VERIFIED", revision: { ...structuredClone(goal), ...change } }));
  }
});

test("owner geography and cost are required, without coercion of booleans, arrays or objects", async () => {
  for (const geography of [undefined, null, "", "  ", false, 225, ["Россия"], { name: "Россия" }]) {
    await assert.rejects(createCurrentGoal({ ...input(), customer_geography: geography }), { code: "GOAL_GEOGRAPHY_REQUIRED" });
  }
  for (const amount of [undefined, null, 0, -1, true, "30000", [30000], {}, Infinity, 1.5]) {
    await assert.rejects(createCurrentGoal({ ...input(), success_criterion: { ...input().success_criterion, max_result_cost_rub: amount } }));
  }
  for (const count of [0, true, "30", [], NaN, 1.2]) {
    assert.throws(() => normalizeOwnerGoalInput({ ...input(), success_criterion: { ...input().success_criterion, target_count: count } }));
  }
  for (const deadline of ["2027-02-31", "2027-13-01", true, "", {}]) {
    assert.throws(() => normalizeOwnerGoalInput({ ...input(), success_criterion: { ...input().success_criterion, deadline } }));
  }
  for (const value of [true, {}, ["goal"], "   "]) {
    assert.throws(() => normalizeOwnerGoalInput({ ...input(), desired_outcome: value }));
    assert.throws(() => normalizeOwnerGoalInput({ ...input(), qualified_action: value }));
  }
});

test("v2 cannot declare geography without its linked provenance", async () => {
  const { revision: goal } = await createCurrentGoal(input());
  const candidate = {
    schema_version: GOAL_CANDIDATE_SCHEMA_V2,
    desired_outcome: goal.desired_outcome, qualified_action: goal.qualified_action,
    success_criterion: goal.success_criterion, customer_geography: goal.customer_geography, counting_policy: goal.counting_policy,
    used_input_ids: goal.exact_inputs.map((item) => item.input_id),
    provenance: goal.provenance.filter((item) => item.supports !== "CUSTOMER_GEOGRAPHY"), known_constraints: [], material_ambiguity: null,
  };
  await assert.rejects(verifyGoalCandidate({ candidate, exact_inputs: goal.exact_inputs, verified_at: at }), { code: "GOAL_PROVENANCE_INVALID" });
});

test("legacy revisions are readable but not ready; upgrade preserves constraints and invalidates dependent data", async () => {
  const legacy = await legacyGoal();
  await verifyGoalFormationResult({ status: "VERIFIED", revision: legacy.revision });
  const oldDigest = legacy.revision.digest;
  const before = projectOwnerPipeline(null, legacy);
  assert.equal(before.canStart, false);
  assert.equal(before.goalFormation.customerGeography, null);
  assert.equal(before.goalFormation.countingPolicy, null);
  assert.equal(before.goalFormation.criterionComplete, false);
  assert.equal(before.stages[0].status, "Требует уточнения");
  assert.throws(() => assertGoalReady(legacy.revision), { code: "GOAL_INCOMPLETE" });
  const dependencies = goalDependencies({ analytics_evidence_snapshot: { revision_id: "evidence:old" }, campaign_strategy_revision: { revision_id: "strategy:old" }, campaign_pairs: [{ hypothesis: { revision_id: "hypothesis:old" }, draft: { revision_id: "draft:old" } }] });
  const upgraded = await reviseCurrentGoal({ current: legacy, desired_outcome: legacy.revision.desired_outcome, qualified_action: legacy.revision.qualified_action,
    customer_geography: "Москва", success_criterion: { target_count: 30, deadline: "2027-06-30", total_budget_rub: 30000 }, counting_policy: QUALIFIED_REQUEST_COUNTING_POLICY, corrected_at: at, dependencies });
  assert.equal(upgraded.current.revision.schema_version, "p0-goal-revision-v3");
  assert.equal(upgraded.material_change, true);
  assert.deepEqual(upgraded.current.revision.known_constraints, legacy.revision.known_constraints);
  assert.deepEqual(upgraded.current.invalidation.dependencies, dependencies);
  assert.equal(legacy.revision.digest, oldDigest);
  assert.equal(legacy.revision.customer_geography, undefined);
  assert.equal(projectOwnerPipeline(null, upgraded.current).canStart, true);
  const costEdit = await reviseCurrentGoal({ current: upgraded.current, desired_outcome: legacy.revision.desired_outcome, qualified_action: legacy.revision.qualified_action,
    success_criterion: { ...input().success_criterion, max_result_cost_rub: 25000 }, corrected_at: at, dependencies });
  assert.deepEqual(costEdit.current.revision.known_constraints, legacy.revision.known_constraints);
});

test("geography changes are material; whitespace-only edits retain the same sealed Goal", async () => {
  const current = await createCurrentGoal(input());
  const update = { current, desired_outcome: current.revision.desired_outcome, qualified_action: current.revision.qualified_action, corrected_at: at, dependencies: [] };
  const same = await reviseCurrentGoal({ ...update, customer_geography: "  Россия  " });
  assert.equal(same.material_change, false);
  assert.equal(same.current.revision.digest, current.revision.digest);
  const changed = await reviseCurrentGoal({ ...update, customer_geography: "Москва" });
  assert.equal(changed.material_change, true);
  assert.notEqual(changed.current.revision.digest, current.revision.digest);
  assert.equal(changed.current.revision.customer_geography, "Москва");
});

function applicationHarness() {
  const reads = { context: 0, site: 0, market: [], competitors: [], financial: [] };
  let row = null;
  const store = { async load() { return structuredClone(row); }, async initialize(_key, value) { if (row) return false; row = structuredClone(value); return true; }, async compareAndSwap(_key, revision, value) { if (row?.revision !== revision) return false; row = structuredClone(value); return true; }, async history() { return row ? [structuredClone(row)] : []; } };
  const page = { url: "https://goal-owner.example/", title: "Участие со стендом", description: "Участие в промышленной выставке", headings: ["Участие со стендом"], forms_detected: 1, text_excerpt: "Участие со стендом для промышленных компаний. Оставьте заявку на участие через форму сайта." };
  const app = new P0Application({ store, adapters: {
    now: () => at,
    async readContext() { reads.context++; return { environment: "PRODUCTION", test_scenario: false,
      access_profile: { path: "NEW_ADVERTISER", account_history: "UNAVAILABLE", evidence_scope: { direct: "UNAVAILABLE", metrika: "UNAVAILABLE", wordstat: "UNAVAILABLE" }, limitation: "Test source boundary" },
      direct: { ready: false, account: "", client_id: "" }, metrika: { ready: false, counter_id: "", goal_id: "" }, performance: null, campaign_catalog: null }; },
    async researchSite() { reads.site++; return { ...page, fetched_at: at, pages: [page], research: { pages_analyzed: 1, links_discovered: 0, scope: "FIRST_PARTY_PUBLIC_HTTPS" } }; },
    async readMarketEvidence(value) { reads.market.push(structuredClone(value)); return null; },
    async readCompetitorResearch(value) { reads.competitors.push(structuredClone(value)); return null; },
    async readFinancialCompetitorIntelligence(value) { reads.financial.push(structuredClone(value)); return null; },
    async readCurrencyLimits() { return { minimum_weekly_budget_rub: null }; },
    externalWriteConfiguration() { return { ready: false, blockers: ["No writes in tests"], account: "" }; },
  } });
  return { app, reads };
}

test("full verified Goal shapes real application collector inputs and sealed snapshot, not website qualification", async () => {
  const goal = (await createCurrentGoal(input())).revision;
  const { app, reads } = applicationHarness();
  const snapshot = await app.collectCurrentAnalyticsEvidence("goal-test-owner", null, "https://goal-owner.example/", undefined, { goal: ref(goal), goalRevision: goal });
  assert.equal(reads.site, 1);
  for (const kind of ["market", "competitors", "financial"]) {
    assert.equal(reads[kind].length, 1);
    const model = reads[kind][0].model;
    assert.deepEqual(model.goal_research_scope, goal);
    assert.equal(model.geography, "Россия");
    assert.equal(model.qualified_result, goal.qualified_action);
    assert.equal(model.qualified_outcome, goal.qualified_action);
    assert.notEqual(model.product, goal.desired_outcome, "Business goal sentence must not replace the researched product.");
    assert.equal(model.field_evidence.qualified_result.source_url, "");
    assert.equal(model.field_evidence.qualified_result.owner_confirmed_at, goal.validation.verified_at);
    assert.equal(model.owner_contract.economics.target_result_cost_rub, null, "Owner limit is not a computed business-economics fact.");
    assert.match(model.key_constraints, /30000 ₽/u);
  }
  assert.deepEqual(snapshot.goal_context, goal);
  assert.equal(await verifyAnalyticsEvidenceSnapshot(snapshot), true);
  const claim = snapshot.claims.find((item) => item.subject === "business_model" && item.predicate === "qualified_result");
  assert.equal(claim.classification, "owner_confirmed");
  const records = snapshot.evidence.filter((item) => claim.evidence_ids.includes(item.evidence_id));
  assert.ok(records.every((item) => item.source_id === "owner-confirmed"));
  assert.ok(records.every((item) => item.source_locator.goal_revision_id === goal.goal_revision_id));
  const tampered = structuredClone(snapshot);
  tampered.goal_context.customer_geography = "Москва";
  assert.equal(await verifyAnalyticsEvidenceSnapshot(tampered), false);
});

test("mismatched or tampered Goal is rejected before the application reads any source", async () => {
  const goal = (await createCurrentGoal(input())).revision;
  for (const scope of [
    { goal: { ...ref(goal), digest: `sha256:${"0".repeat(64)}` }, goalRevision: goal },
    { goal: ref(goal), goalRevision: { ...goal, customer_geography: "Москва" } },
  ]) {
    const { app, reads } = applicationHarness();
    await assert.rejects(app.collectCurrentAnalyticsEvidence("goal-test-owner", null, "https://goal-owner.example/", undefined, scope));
    assert.equal(reads.context, 0);
    assert.equal(reads.site, 0);
    assert.equal(reads.market.length, 0);
  }
});

test("provider geography cannot silently widen or strip owner exclusions", async () => {
  const scope = { regionIds: [225], regionNames: ["Россия"] };
  assert.equal(goalMatchesProviderRegion("  РОССИЯ  ", scope), true);
  for (const value of ["Москва", "РФ", "Россия, кроме Москвы", "Россия; только промышленные города", "", "Россия и Казахстан"]) {
    assert.equal(goalMatchesProviderRegion(value, scope), false, value);
  }
  assert.equal(goalMatchesProviderRegion("Москва", { regionIds: [213], regionNames: ["Москва"] }), true);
  const source = await readFile(new URL("../lib/p0.ts", import.meta.url), "utf8");
  const market = source.slice(source.indexOf("async function readMarketEvidence("), source.indexOf("function coldStartContext("));
  assert.ok(market.indexOf("GOAL_PROVIDER_GEOGRAPHY_MISMATCH") < market.indexOf("await collectHeadlessWordstatUiBatch"));
  assert.match(market, /if \(goal && !goalMatchesProviderRegion[\s\S]+?return \{/u);
  assert.match(source, /goal: input\.goal, goalRevision: input\.goalRevision/u);
});

test("Goal field errors stay beside inputs without changing their accessible names", async () => {
  const source = await readFile(new URL("../app/P0Client.tsx", import.meta.url), "utf8");
  const component = source.slice(source.indexOf("function GoalStageSummary("), source.indexOf("function Header("));
  for (const name of ["desired_outcome", "qualified_action", "target_count", "deadline", "total_budget_rub"]) {
    assert.ok(component.includes(`id="goal-label-${name}"`));
    assert.ok(component.includes(`aria-labelledby="goal-label-${name}"`));
    assert.ok(component.includes(`id="goal-error-${name}"`));
  }
  assert.match(component, /onInvalid=\{showInvalidField\}/u);
  assert.match(component, /if \(!form\.reportValidity\(\)\) \{ event\.preventDefault\(\); return; \}/u);
  assert.match(component, /setFieldErrors\(\{\}\); setEditing\(false\)/u);
  const geography = await readFile(new URL("../app/GeographyAutocomplete.tsx", import.meta.url), "utf8");
  assert.match(geography, /aria-describedby=\{validationError/u);
  assert.match(geography, /role="alert"/u);
});
