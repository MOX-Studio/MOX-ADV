import assert from "node:assert/strict";
import test from "node:test";

import { buildPublishProjection } from "../lib/campaign-draft.ts";
import { fingerprintDirectProjection } from "../lib/campaign-fanout.ts";
import { projectCampaignPairDossier } from "../lib/campaign-pair-dossier.ts";
import { compileDirectProjection } from "../lib/direct-projection-compiler.ts";
import { saveCurrentPipelineCampaignPairEdit } from "../lib/pipeline-current-edits.ts";

const STRATEGY_REVISION_ID = "campaign-strategy:edit-fixture";
const HYPOTHESIS_REVISION_ID = "campaign-hypothesis:edit-fixture";
const DRAFT_REVISION_ID = "campaign-draft:edit-fixture:r1";

const capabilitySnapshot = {
  schema_version: "direct-account-capability-snapshot-v1",
  snapshot_id: "direct-capability:owner-account:edit-fixture",
  observed_at: "2026-09-01T12:00:00.000Z",
  source: "YANDEX_DIRECT_API_V501",
  account: "owner-account",
  api_version: "v501",
  currency: "RUB",
  available_campaign_types: ["UNIFIED_CAMPAIGN"],
  edit_campaigns_grant: "YES",
  archived: "NO",
  restrictions: [
    { element: "ADGROUPS_TOTAL_PER_CAMPAIGN", value: 100 },
    { element: "KEYWORDS_TOTAL_PER_ADGROUP", value: 100 },
    { element: "ADS_TOTAL_PER_ADGROUP", value: 50 },
  ],
  conditional_capabilities: [],
};

const applicabilityProofs = [
  ["/direct/campaign/UnifiedCampaign/CounterIds", "NOT_APPLICABLE"],
  ["/direct/keyword/AutotargetingSettings", "PROVEN_ABSENCE"],
  ["/direct/keyword/Bid", "NOT_APPLICABLE"],
  ["/direct/keyword/ContextBid", "NOT_APPLICABLE"],
  ["/direct/ad/ResponsiveAd/SitelinkSetId", "NOT_APPLICABLE"],
  ["/direct/sitelink_sets", "NOT_APPLICABLE"],
].map(([pointer, disposition]) => ({ pointer, disposition, evidence_ref: "profile-proof-1", reason: "Explicit profile disposition." }));

class MemoryProducts {
  constructor(current) { this.current = structuredClone(current); }
  async loadCurrent() { return structuredClone(this.current); }
  async compareAndSwap(_ownerKey, expectedRevision, next) {
    if (this.current.state_revision !== expectedRevision) return false;
    this.current = structuredClone(next);
    return true;
  }
}

function projection() {
  return buildPublishProjection(
    {
      product: "Стенд ИННОПРОМ",
      audience: "Экспоненты",
      qualified_result: "Заявка на расчёт",
      value: "Стенд под ключ",
    },
    {
      geography: "Москва",
      weekly_budget_rub: "50000",
      goal: "Получать квалифицированные заявки",
      period_start: "2026-09-10",
      period_end: "2026-10-31",
      landing_page: "https://owner.example/stand",
      message: "Стенд под ключ",
      advertised_offer: "Проектирование стенда",
      target_audience: "Экспоненты",
      qualified_result: "Заявка на расчёт",
    },
    {
      campaign_name: "Initial campaign",
      group_name: "Initial audience",
      keyword: "иннопром стенд",
      negative_keywords: "бесплатно, вакансии",
      ad_title: "Initial title",
      ad_text: "Initial message",
      strategy_revision_id: STRATEGY_REVISION_ID,
      campaign_hypothesis_id: HYPOTHESIS_REVISION_ID,
      campaign_hypothesis_revision_id: HYPOTHESIS_REVISION_ID,
      draft_id: "campaign-draft:edit-fixture",
      draft_revision_id: DRAFT_REVISION_ID,
      capability_profile_id: "p0-campaign-creation-profile-v1",
      capability_profile_version: "1.0.0",
      advertiser_account: capabilitySnapshot.account,
      currency: capabilitySnapshot.currency,
      capability_snapshot_id: capabilitySnapshot.snapshot_id,
    },
  );
}

function acceptedStrategy() {
  const values = {
    advertised_offer: "Проектирование стенда",
    target_audience: "Экспоненты",
    qualified_result: "Заявка на расчёт",
    weekly_budget: 50_000,
    period: { start_date: "2026-09-10", end_date: "2026-10-31" },
    target_result_cost: null,
  };
  return {
    schema_version: "p0-autonomous-campaign-strategy-v1",
    strategy_revision_id: STRATEGY_REVISION_ID,
    status: "AGENT_ACCEPTED",
    dimensions: Object.entries(values).map(([dimension_id, value]) => ({
      dimension_id,
      value,
      rationale: `Проверенное основание для ${dimension_id}`,
      confidence: value === null ? "LOW" : "HIGH",
      evidence_refs: [{ input_kind: "BUSINESS_INPUT", revision_id: "business-input:1", evidence_id: `evidence:${dimension_id}` }],
    })),
  };
}

function hypothesis() {
  return {
    schema_version: "p0-campaign-hypothesis-v1",
    hypothesis_revision_id: HYPOTHESIS_REVISION_ID,
    strategy_revision_id: STRATEGY_REVISION_ID,
    analytics_evidence_snapshot_id: "analytics-snapshot:edit-fixture",
    mechanism: "Initial message",
    primary_metric: "Заявка на расчёт",
    baseline: "Исходное сообщение без точного предложения",
    evidence_refs: ["evidence:offer-audience"],
    authority: { publication: "NOT_AUTHORIZED", spend: "NOT_AUTHORIZED", performance_promise: false },
  };
}

async function currentProducts() {
  const compiled = await compileDirectProjection({
    projection: projection(),
    capability_snapshot: structuredClone(capabilitySnapshot),
    allowed_landing_hosts: ["owner.example"],
    applicability_proofs: structuredClone(applicabilityProofs),
  });
  return {
    schema_version: "p0-pipeline-current-products-v1",
    owner_key: "owner",
    state_revision: 4,
    run_id: "run-completed",
    run_version: 9,
    current_stage: "PUBLICATION_REVIEW",
    updated_at: "2026-09-01T10:00:00.000Z",
    historical_source: { schema_version: "p0-application-document-v19", revision_id: "historical-document:67", digest: `sha256:${"a".repeat(64)}` },
    goal_revision: { schema_version: "goal-v1", revision_id: "goal-r1", digest: `sha256:${"1".repeat(64)}` },
    analytics_evidence_snapshot: { schema_version: "evidence-v1", snapshot_revision_id: "evidence-r1", digest: `sha256:${"2".repeat(64)}` },
    campaign_strategy: {},
    campaign_pairs: [{
      schema_version: "p0-compiled-campaign-pair-v1",
      pair_revision_id: "pair-r1",
      hypothesis: hypothesis(),
      // Production compiler output carries the initial Draft revision in projection lineage.
      draft: { ...compiled, auction_protocol: { measurement_goal: "Заявка на расчёт" } },
      strategy_revision_id: STRATEGY_REVISION_ID,
      analytics_evidence_snapshot_id: "analytics-snapshot:edit-fixture",
      design: { model_id: "fixture-model", attempts: 1, repair_violations: [] },
      economics: { confirmed_cost_status: "UNAVAILABLE", budget_limited: true, weekly_budget: 50_000, effectiveness_forecast: false },
      edit_context: {
        schema_version: "p0-campaign-pair-edit-context-v1",
        capability_snapshot: structuredClone(capabilitySnapshot),
        allowed_landing_hosts: ["owner.example"],
        applicability_proofs: structuredClone(applicabilityProofs),
      },
      publish_fingerprint: compiled.publish_fingerprint,
    }],
    campaign_pair_checks: {
      schema_version: "p0-campaign-pair-validation-outcome-v1",
      status: "PASS",
      set_disposition: "CURRENT_MATERIAL_PAIRS",
      strategy_revision_id: STRATEGY_REVISION_ID,
      pair_count: 1,
      material_bucket_count: 1,
      pairs: [],
      violations: [],
    },
    campaign_playbook: { schema_version: "campaign-playbook-binding-v1", revision_id: "playbook-release:1", digest: `sha256:${"3".repeat(64)}` },
    publication_review: {
      schema_version: "p0-publication-review-handoff-v1",
      status: "REVIEW_ONLY",
      run_id: "run-completed",
      pair_count: 1,
      publish_fingerprints: [compiled.publish_fingerprint],
      external_write: "DENIED",
      publication: "NOT_AUTHORIZED",
      impressions: 0,
      spend_micros: 0,
    },
    authority: { external_write: "DENIED", publication: "NOT_AUTHORIZED", impressions: 0, spend_micros: 0 },
  };
}

function displayedText(value) {
  return typeof value === "object" && value !== null ? String(value.Text ?? "") : String(value ?? "");
}

function applicabilityValue(draft, pointer) {
  return draft.applicability.find((item) => item.pointer === pointer)?.value;
}

test("semantic Campaign Hypothesis edit rebinds lineage and deterministically recompiles one immutable pair revision", async () => {
  const store = new MemoryProducts(await currentProducts());
  const result = await saveCurrentPipelineCampaignPairEdit({
    store,
    ownerKey: "owner",
    runStatus: "COMPLETED",
    expectedStateRevision: 4,
    editedAt: "2026-09-02T10:00:00.000Z",
    edit: {
      pair_id: "pair-r1",
      expected_hypothesis_revision_id: HYPOTHESIS_REVISION_ID,
      expected_draft_revision_id: DRAFT_REVISION_ID,
      semantic_changes: { core_message: "Проектирование выставочного стенда под ваш результат" },
    },
  });

  assert.equal(result.status, "SAVED");
  assert.equal(result.classification, "SEMANTIC");
  const saved = await store.loadCurrent();
  const pair = saved.campaign_pairs[0];
  assert.equal(saved.state_revision, 5);
  assert.match(pair.hypothesis.hypothesis_revision_id, /^campaign-hypothesis:edit-fixture:r/u);
  assert.equal(pair.hypothesis.mechanism, "Проектирование выставочного стенда под ваш результат");
  assert.equal(Object.hasOwn(pair.hypothesis, "core_message"), false);
  assert.equal(pair.draft.publish_projection.business.value, "Проектирование выставочного стенда под ваш результат");
  assert.equal(displayedText(pair.draft.publish_projection.direct.ad.ResponsiveAd.Texts[0]), "Проектирование выставочного стенда под ваш результат");
  assert.equal(pair.draft.publish_projection.lineage.campaign_hypothesis_revision_id, pair.hypothesis.hypothesis_revision_id);
  assert.equal(pair.draft.publish_projection.lineage.draft_revision_id, pair.draft.draft_revision_id);
  assert.equal(pair.draft.validation.status, "VALID");
  assert.deepEqual(pair.draft.local_graph.ads[0].provider_fields, pair.draft.publish_projection.direct.ad);
  assert.deepEqual(applicabilityValue(pair.draft, "/direct/ad/ResponsiveAd/Texts"), pair.draft.publish_projection.direct.ad.ResponsiveAd.Texts);
  assert.equal(result.current_publish_fingerprint, await fingerprintDirectProjection(pair.draft.publish_projection));
  const dossier = await projectCampaignPairDossier({ strategy: acceptedStrategy(), result: { status: "COMPLETED", pair } });
  assert.ok(dossier);
  assert.equal(dossier.state, "Полная текущая пара");
  assert.deepEqual(saved.publication_review.publish_fingerprints, [result.current_publish_fingerprint]);
  assert.equal(saved.publication_review.external_write, "DENIED");
});

test("technical Draft edit preserves Hypothesis identity and recompiles the exact Direct graph", async () => {
  const store = new MemoryProducts(await currentProducts());
  const result = await saveCurrentPipelineCampaignPairEdit({
    store,
    ownerKey: "owner",
    runStatus: "COMPLETED",
    expectedStateRevision: 4,
    edit: {
      pair_id: "pair-r1",
      expected_hypothesis_revision_id: HYPOTHESIS_REVISION_ID,
      expected_draft_revision_id: DRAFT_REVISION_ID,
      technical_changes: { keyword: "выставочный стенд иннопром" },
    },
  });

  assert.equal(result.classification, "TECHNICAL");
  const saved = await store.loadCurrent();
  const pair = saved.campaign_pairs[0];
  assert.equal(pair.hypothesis.hypothesis_revision_id, HYPOTHESIS_REVISION_ID);
  assert.equal(pair.draft.publish_projection.direct.keyword.Keyword, "выставочный стенд иннопром");
  assert.match(pair.draft.draft_revision_id, /^campaign-draft:edit-fixture:r1:r/u);
  assert.equal(pair.draft.publish_projection.lineage.draft_revision_id, pair.draft.draft_revision_id);
  assert.deepEqual(pair.draft.local_graph.keywords[0].provider_fields, pair.draft.publish_projection.direct.keyword);
  assert.equal(result.current_publish_fingerprint, await fingerprintDirectProjection(pair.draft.publish_projection));
});

test("unchanged fields are a no-op, while protocol-only edits preserve the canonical publish surface", async () => {
  const initial = await currentProducts();
  const canonicalFingerprint = initial.campaign_pairs[0].draft.publish_fingerprint;
  const store = new MemoryProducts(initial);

  const noOp = await saveCurrentPipelineCampaignPairEdit({
    store,
    ownerKey: "owner",
    runStatus: "COMPLETED",
    expectedStateRevision: 4,
    edit: {
      pair_id: "pair-r1",
      expected_hypothesis_revision_id: HYPOTHESIS_REVISION_ID,
      expected_draft_revision_id: DRAFT_REVISION_ID,
      technical_changes: { keyword: "иннопром стенд" },
    },
  });
  assert.equal(noOp.status, "NO_OP");
  assert.equal((await store.loadCurrent()).state_revision, 4);

  const protocolEdit = await saveCurrentPipelineCampaignPairEdit({
    store,
    ownerKey: "owner",
    runStatus: "COMPLETED",
    expectedStateRevision: 4,
    edit: {
      pair_id: "pair-r1",
      expected_hypothesis_revision_id: HYPOTHESIS_REVISION_ID,
      expected_draft_revision_id: DRAFT_REVISION_ID,
      technical_changes: { measurement_goal: "Квалифицированная заявка" },
    },
  });
  const saved = await store.loadCurrent();
  assert.equal(protocolEdit.status, "SAVED");
  assert.equal(protocolEdit.current_publish_fingerprint, canonicalFingerprint);
  assert.equal(saved.campaign_pairs[0].draft.auction_protocol.measurement_goal, "Квалифицированная заявка");
  assert.match(saved.campaign_pairs[0].draft.draft_revision_id, /^campaign-draft:edit-fixture:r1:r/u);
});

test("multi-line creatives remain separate compiled values and missing compiler context fails closed", async () => {
  const store = new MemoryProducts(await currentProducts());
  await saveCurrentPipelineCampaignPairEdit({
    store,
    ownerKey: "owner",
    runStatus: "COMPLETED",
    expectedStateRevision: 4,
    edit: {
      pair_id: "pair-r1",
      expected_hypothesis_revision_id: HYPOTHESIS_REVISION_ID,
      expected_draft_revision_id: DRAFT_REVISION_ID,
      technical_changes: { ad_title: "Первый заголовок\nВторой заголовок" },
    },
  });
  const titles = (await store.loadCurrent()).campaign_pairs[0].draft.publish_projection.direct.ad.ResponsiveAd.Titles;
  assert.deepEqual(titles.map(displayedText), ["Первый заголовок", "Второй заголовок"]);

  const withoutContext = await currentProducts();
  delete withoutContext.campaign_pairs[0].edit_context;
  const blockedStore = new MemoryProducts(withoutContext);
  await assert.rejects(() => saveCurrentPipelineCampaignPairEdit({
    store: blockedStore,
    ownerKey: "owner",
    runStatus: "COMPLETED",
    expectedStateRevision: 4,
    edit: {
      pair_id: "pair-r1",
      expected_hypothesis_revision_id: HYPOTHESIS_REVISION_ID,
      expected_draft_revision_id: DRAFT_REVISION_ID,
      technical_changes: { keyword: "новая фраза" },
    },
  }), /no exact compiler context/u);
  assert.equal((await blockedStore.loadCurrent()).state_revision, 4);
});
