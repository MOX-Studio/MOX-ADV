import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CAMPAIGN_HYPOTHESIS_SCHEMA,
  runCampaignDesignPipeline,
} from "../lib/campaign-design-agent.ts";
import { projectCampaignPairDossier } from "../lib/campaign-pair-dossier.ts";
import { buildPublishProjection } from "../lib/campaign-draft.ts";
import { projectCurrentPipelineContract } from "../lib/pipeline-current-contract.ts";
import { projectOwnerPipeline } from "../lib/pipeline-owner-dashboard.ts";

const strategyValues = {
  business_goal: "Получать квалифицированные заявки",
  campaign_focus: "Внедрение товарного учёта",
  advertised_offer: "Внедрение товарного учёта для магазинов",
  target_audience: "Владельцы розничных магазинов",
  qualified_result: "Заявка на расчёт",
  exclusions: "Бесплатно и вакансии",
  geography: "Москва",
  period: { start_date: "2026-09-10", end_date: "2026-10-31" },
  landing_page: "https://owner.example/accounting",
  weekly_budget: 50_000,
  target_result_cost: null,
  core_message: "Настройка учёта под процессы магазина",
};

const evidenceByDimension = {
  advertised_offer: "evidence:offer",
  target_audience: "evidence:audience",
  qualified_result: "evidence:goal",
  weekly_budget: "evidence:budget",
  period: "evidence:period",
  target_result_cost: "evidence:cost-unavailable",
};

function strategy() {
  return {
    schema_version: "p0-autonomous-campaign-strategy-v1",
    contract: { name: "mox-adv.p0.campaign-strategy-agent", version: "1.1.0" },
    strategy_revision_id: "campaign-strategy:1234567890abcdef12345678",
    digest: `sha256:${"a".repeat(64)}`,
    status: "AGENT_ACCEPTED",
    accepted_at: "2026-09-01T12:00:00.000Z",
    accepted_by: { kind: "STRATEGY_AGENT", model_id: "strategy-model" },
    input_lineage: {},
    dimensions: Object.entries(strategyValues).map(([dimension_id, value]) => ({
      dimension_id,
      value,
      rationale: `Проверенное основание для ${dimension_id}`,
      confidence: dimension_id === "target_result_cost" ? "LOW" : "HIGH",
      evidence_refs: evidenceByDimension[dimension_id] ? [{
        input_kind: "ANALYTICS_EVIDENCE_SNAPSHOT",
        revision_id: "analytics-snapshot:1",
        evidence_id: evidenceByDimension[dimension_id],
      }] : [],
    })),
    rationale: "Evidence-grounded strategy",
    confidence: "HIGH",
    conflicts: [],
    budget_boundary: { weekly_budget: 50_000, semantics: "RECOMMENDATION_ONLY", creates_mandate: false, authorizes_spend: false },
    authority: { mandate: "NOT_GRANTED", publication: "NOT_AUTHORIZED", spend: "NOT_AUTHORIZED", performance_promise: false },
  };
}

const capabilitySnapshot = {
  schema_version: "direct-account-capability-snapshot-v1",
  snapshot_id: "direct-capability:owner-account:1",
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

function hypothesis() {
  return {
    schema_version: CAMPAIGN_HYPOTHESIS_SCHEMA,
    hypothesis_revision_id: "campaign-hypothesis:1",
    strategy_revision_id: strategy().strategy_revision_id,
    analytics_evidence_snapshot_id: "analytics-snapshot:1",
    mechanism: "Точное сообщение о внедрении повысит долю квалифицированных переходов.",
    primary_metric: "Доля квалифицированных переходов",
    baseline: "Общее сообщение без уточнения внедрения",
    evidence_refs: ["evidence:offer-audience"],
    authority: { publication: "NOT_AUTHORIZED", spend: "NOT_AUTHORIZED", performance_promise: false },
  };
}

function projection() {
  return buildPublishProjection(
    {
      product: strategyValues.advertised_offer,
      audience: strategyValues.target_audience,
      qualified_result: strategyValues.qualified_result,
      value: strategyValues.core_message,
    },
    {
      geography: strategyValues.geography,
      weekly_budget_rub: String(strategyValues.weekly_budget),
      goal: strategyValues.business_goal,
      period_start: strategyValues.period.start_date,
      period_end: strategyValues.period.end_date,
      landing_page: strategyValues.landing_page,
      message: strategyValues.core_message,
      advertised_offer: strategyValues.advertised_offer,
      target_audience: strategyValues.target_audience,
      qualified_result: strategyValues.qualified_result,
    },
    {
      campaign_name: "Внедрение товарного учёта",
      group_name: "Владельцы магазинов",
      keyword: "внедрение товарного учета магазин",
      negative_keywords: "бесплатно, вакансии",
      ad_title: "Товарный учёт для магазина",
      ad_text: "Настроим товарный учёт для магазина.",
      strategy_revision_id: strategy().strategy_revision_id,
      campaign_hypothesis_id: "campaign-hypothesis:1",
      campaign_hypothesis_revision_id: hypothesis().hypothesis_revision_id,
      draft_id: "campaign-draft:1",
      draft_revision_id: "campaign-draft:1:r1",
      capability_profile_id: "p0-campaign-creation-profile-v1",
      capability_profile_version: "1.0.0",
      advertiser_account: capabilitySnapshot.account,
      currency: capabilitySnapshot.currency,
      capability_snapshot_id: capabilitySnapshot.snapshot_id,
    },
  );
}

async function completedResult() {
  return runCampaignDesignPipeline({
    strategy: strategy(),
    analytics_evidence: { snapshot_id: "analytics-snapshot:1", evidence_ids: ["evidence:offer-audience"] },
    confirmed_cost: { status: "UNAVAILABLE", evidence_ref: null },
    capability_snapshot: structuredClone(capabilitySnapshot),
    allowed_landing_hosts: ["owner.example"],
    applicability_proofs: structuredClone(applicabilityProofs),
    model: {
      model_id: "campaign-design-model-v1",
      async designCampaignPair() {
        return { kind: "CANDIDATE", candidate: { hypothesis: hypothesis(), projection: projection() } };
      },
    },
    store: { async saveCurrentCampaignPair() {} },
  });
}

test("projects the complete current pair as a business dossier, every creative combination and exact Strategy mapping", async () => {
  const result = await completedResult();
  const dossier = await projectCampaignPairDossier({ strategy: strategy(), result });

  assert.ok(dossier);
  assert.equal(dossier.state, "Полная текущая пара");
  assert.equal(dossier.profile, "ЕПК / Поиск / WB_MAXIMUM_CLICKS");
  assert.deepEqual(dossier.lineage.map((item) => item.kind), ["Campaign Strategy", "Campaign Hypothesis", "Campaign Draft"]);
  assert.deepEqual(dossier.clientPreview.titles, projection().direct.ad.ResponsiveAd.Titles);
  assert.deepEqual(dossier.clientPreview.texts, projection().direct.ad.ResponsiveAd.Texts);
  assert.equal(dossier.clientPreview.link, strategyValues.landing_page);
  assert.equal(dossier.clientPreview.combinations.length, 4);
  assert.deepEqual(dossier.strategyMapping.map((item) => item.dimension), ["Предложение", "Аудитория", "Целевое действие", "Экономические границы"]);
  assert.ok(dossier.strategyMapping.every((item) => item.evidence.length > 0 && item.exactDraftFields.length > 0));
  assert.match(dossier.strategyMapping.at(-1).decision, /стоимость результата недоступна/u);
  assert.ok(dossier.directProjection.fields.some((field) => field.pointer.endsWith("/WeeklySpendLimit") && field.value === "50000000000"));
  const currentContract = projectCurrentPipelineContract(projectOwnerPipeline(null, null, null, dossier));
  assert.equal(currentContract.pipeline.campaignDossier, dossier);
  assert.doesNotMatch(JSON.stringify(dossier), /comparativeScore|viability_score|rank|readiness/iu);
});

test("fails closed for compiler failures and for a corrupted persisted Draft", async () => {
  for (const result of [
    { status: "TECHNICAL_FAILURE", violations: [] },
    { status: "EVIDENCE_REQUEST", evidence_request: { kind: "EVIDENCE_REQUEST", requests: [{ code: "MISSING", description: "Missing evidence" }] } },
    { status: "STRATEGY_DEFECT", strategy_defect: { kind: "STRATEGY_DEFECT", defects: [{ code: "DEFECT", description: "Defective strategy" }] } },
  ]) {
    assert.equal(await projectCampaignPairDossier({ strategy: strategy(), result }), null);
  }

  const completed = await completedResult();
  const corrupted = structuredClone(completed);
  corrupted.pair.draft.publish_projection.direct.ad.ResponsiveAd.Titles = [];
  assert.equal(await projectCampaignPairDossier({ strategy: strategy(), result: corrupted }), null);

  const partialApplicability = structuredClone(completed);
  partialApplicability.pair.draft.applicability.pop();
  assert.equal(await projectCampaignPairDossier({ strategy: strategy(), result: partialApplicability }), null);
});

test("Dashboard renders the dossier only through the atomic pipeline property", async () => {
  const client = await readFile(new URL("../app/P0Client.tsx", import.meta.url), "utf8");

  assert.match(client, /projection\.pipeline\?\.campaignDossier/u);
  assert.match(client, /CAMPAIGN HYPOTHESIS \+ ПОЛНЫЙ CAMPAIGN DRAFT/u);
  assert.match(client, /Campaign Strategy → Campaign Hypothesis → Campaign Draft/u);
  assert.match(client, /Решение → evidence → точное поле/u);
  assert.match(client, /dossier\.clientPreview\.combinations\.map/u);
  assert.match(client, /dossier\.directProjection\.fields\.map/u);
  assert.doesNotMatch(client, /campaignDossier\?\.hypothesis|campaignDossier\?\.clientPreview/u);
});
