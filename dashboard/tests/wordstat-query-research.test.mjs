import assert from "node:assert/strict";
import test from "node:test";
import { buildAnalyticsEvidence, verifyAnalyticsEvidenceSnapshot, withBusinessResearchMaterial } from "../lib/analytics-evidence.ts";
import { FINDINGS_POLICY, buildFindingsResearchPlan } from "../lib/findings-research.ts";
import { validateWordstatQueryResearch, collectAdditionalWordstatResearch } from "../lib/wordstat-query-research.ts";
import { createEvidenceReuseHarness, replaySnapshotInput } from "./fixtures/pipeline-evidence-reuse-fixture.mjs";

const request = { queries: ["участие в выставке", '"аренда стенда"'], region: { id: 225, name: "Россия" }, similar: false };
const runtime = { P0_WORDSTAT_BRIDGE_URL: "http://127.0.0.1:19246", P0_WORDSTAT_BRIDGE_TOKEN: "unit-test-token" };
async function snapshot() {
  const h = await createEvidenceReuseHarness(), input = replaySnapshotInput();
  const goal = h.goals.current.revision;
  input.model.goal_research_scope = goal;
  input.model.business_research = { schema_version: FINDINGS_POLICY, plan: buildFindingsResearchPlan(goal), sources: [], observations: [], attempts: [], gaps: [], observed_at: input.generatedAt, completion_reason: "Исходные материалы для дополнительного исследования." };
  return buildAnalyticsEvidence(input);
}
test("explicit Wordstat research validates scope, duplicates and phase limits", () => {
  assert.equal(validateWordstatQueryResearch(request, "Россия").queries.length, 2);
  for (const bad of [{ ...request, queries: [] }, { ...request, queries: Array.from({ length: 21 }, (_, i) => `фраза ${i}`) },
    { ...request, queries: ["стенд", "СТЕНД"] }, { ...request, queries: ["стенд\nцена"] }, { ...request, region: { id: 213, name: "Москва" } }, { ...request, endpoint: "https://other.example/" }]) {
    assert.throws(() => validateWordstatQueryResearch(bad, "Россия"));
  }
});
test("partial reads retain empty results and failures without promoting old source coverage", async () => {
  const before = await snapshot(), original = structuredClone(before);
  const batch = { schema_version: "wordstat-ui-observation-batch-v1", source: "YANDEX_WORDSTAT_UI", batch_id: `sha256:${"a".repeat(64)}`,
    batch_finished_at: "2026-09-09T10:00:00.000Z", status: "PARTIAL", observations: [{ exact_query: request.queries[0], rows: [], result_state: "NO_ROWS_RETURNED" }], failures: [{ exact_query: request.queries[1], code: "LOAD_TIMEOUT" }] };
  let sent;
  const after = await collectAdditionalWordstatResearch(before, request, runtime, { fetchImpl: async (url, init) => {
    assert.equal(url.href, "http://127.0.0.1:19246/collect"); sent = JSON.parse(init.body);
    return Response.json({ batch });
  } });
  assert.equal(sent.plan_input.seeds[1].operator_profile, "FIXED_WORD_COUNT");
  assert.deepEqual(sent.plan_input.surfaces, ["TOP_POPULAR"]);
  assert.deepEqual(before, original);
  assert.deepEqual(after.sources, before.sources);
  assert.deepEqual(after.goal_context, before.goal_context);
  assert.deepEqual(after.summary, before.summary);
  assert.deepEqual(after.business_research.supporting_materials.at(-1).content.batch, batch);
  assert.notEqual(after.snapshot_id, before.snapshot_id);
  assert.equal(await verifyAnalyticsEvidenceSnapshot(after), true);
  assert.doesNotMatch(JSON.stringify(after), /unit-test-token/);
  const corrupted = structuredClone(after); corrupted.business_research.supporting_materials[0].content.batch.observations[0].rows = [{ phrase: "выдумано", count: 100 }];
  assert.equal(await verifyAnalyticsEvidenceSnapshot(corrupted), false);
  await assert.rejects(withBusinessResearchMaterial(after, after.business_research.supporting_materials[0]), /уже добавлено/);
});
test("invalid source responses and cancelled reads cannot produce an extended snapshot", async () => {
  const before = await snapshot();
  await assert.rejects(collectAdditionalWordstatResearch(before, request, runtime, { fetchImpl: async () => Response.json({ batch: {} }) }), /пакет наблюдений/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(collectAdditionalWordstatResearch(before, request, runtime, { signal: controller.signal, fetchImpl: async () => { throw new Error("must not read"); } }), /ABORTED/);
});
