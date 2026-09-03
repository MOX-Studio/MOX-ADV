import assert from "node:assert/strict";
import test from "node:test";

import { projectEvidenceSnapshotForDashboard } from "../lib/pipeline-evidence-dashboard.ts";

const generatedAt = "2026-09-01T10:00:00.000Z";

function source(overrides) {
  return {
    source_id: "first-party-web",
    title: "Публичный сайт компании",
    source_kind: "first_party_web",
    provenance_class: "FIRST_PARTY_PUBLIC",
    status: "VERIFIED",
    observed_at: generatedAt,
    generated_at: generatedAt,
    scope: { host: "expomap.ru" },
    access: "public",
    collection_policy: { allowed_host: "expomap.ru" },
    versions: { schema: "v1", extractor: "site-v1", policy: "public-https-v1" },
    facts: ["Публичное предложение получено"],
    limitations: [],
    evidence_ids: ["evidence-site-product"],
    manifest_hash: "sha256:site",
    ...overrides,
  };
}

function evidence(overrides) {
  return {
    evidence_id: "evidence-site-product",
    source_id: "first-party-web",
    source_locator: { url: "https://expomap.ru/participation/" },
    freshness: { status: "fresh", age_seconds: 0, policy_id: "public/24h" },
    ...overrides,
  };
}

test("projects verified snapshot provenance without inventing unavailable integration facts", () => {
  const snapshot = {
    schema_version: "p0-analytics-evidence-v7",
    snapshot_id: "snapshot-current-1",
    generated_at: generatedAt,
    as_of: generatedAt,
    recommendation_status: "EVIDENCE_READY_WITH_GAPS",
    scope: {
      company_host: "expomap.ru",
      direct_client_login: "expomap-media",
      direct_client_id: "direct-client-1",
      metrika_counter_id: "12345678",
      metrika_goal_id: "87654321",
    },
    summary: {
      sources_total: 4,
      sources_verified: 1,
      sources_partial: 2,
      sources_unavailable: 1,
      claims_supported: 3,
      hard_blockers: ["Метрика не вернула отчёт за текущий scope."],
    },
    confidence: {
      quality: "MIXED_ALLOWED",
      freshness: "MIXED",
      consistency: "SINGLE_SOURCE",
      coverage: "PARTIAL",
      uncertainty: ["Wordstat вернул только часть формулировок."],
    },
    sources: [
      source({}),
      source({
        source_id: "direct",
        title: "Яндекс Директ",
        source_kind: "direct_management_api",
        provenance_class: "DIRECT_OFFICIAL_API",
        status: "PARTIAL",
        observed_at: "2026-09-01T09:55:00.000Z",
        scope: { client_login: "expomap-media", client_id: "direct-client-1" },
        access: "owner_authorized",
        collection_policy: { allowed_host: "api.direct.yandex.com" },
        facts: ["Campaigns.get прочитан"],
        limitations: ["Ads.get недоступен в этом snapshot."],
        evidence_ids: ["evidence-direct"],
      }),
      source({
        source_id: "metrika",
        title: "Яндекс Метрика",
        source_kind: "metrica_management_api_and_reports_api",
        provenance_class: "METRIKA_OFFICIAL_API",
        status: "UNAVAILABLE",
        observed_at: null,
        scope: { counter_id: "12345678", goal_id: "87654321" },
        access: "unavailable",
        collection_policy: { allowed_host: "api-metrika.yandex.net" },
        facts: [],
        limitations: ["Reports API недоступен."],
        evidence_ids: [],
      }),
      source({
        source_id: "wordstat",
        title: "Яндекс Wordstat",
        source_kind: "wordstat_ui",
        provenance_class: "WORDSTAT_OFFICIAL_UI",
        status: "PARTIAL",
        observed_at: "2026-09-01T09:50:00.000Z",
        scope: { regions: ["Москва"], device: "all" },
        access: "owner_authorized",
        collection_policy: { allowed_host: "wordstat.yandex.ru" },
        facts: ["1 из 6 формулировок получена"],
        limitations: ["Неполное покрытие формулировок."],
        evidence_ids: ["evidence-wordstat"],
      }),
    ],
    claims: [{
      claim_id: "claim-business-product",
      subject: "business_model",
      predicate: "product",
      value: "Участие в выставке ИННОПРОМ",
      classification: "observed",
      evidence_ids: ["evidence-site-product"],
      confidence: {
        quality: "A",
        freshness: "current",
        consistency: "single",
        coverage: "complete_for_scope",
        tier: "TIER_1_VERIFIED",
        uncertainty: [],
      },
    }],
    evidence: [
      evidence({}),
      evidence({
        evidence_id: "evidence-direct",
        source_id: "direct",
        source_locator: { endpoint: "https://api.direct.yandex.com/json/v501/campaigns" },
        freshness: { status: "aging", age_seconds: 300, policy_id: "direct/5m" },
      }),
      evidence({
        evidence_id: "evidence-wordstat",
        source_id: "wordstat",
        source_locator: { endpoint: "https://wordstat.yandex.ru/" },
        freshness: { status: "fresh", age_seconds: 600, policy_id: "wordstat/24h" },
      }),
    ],
    gaps: [{
      gap_id: "gap-metrika",
      code: "METRIKA_REPORT_UNAVAILABLE",
      source_id: "metrika",
      description: "Отчёт Метрики не получен.",
      material: true,
      status: "UNAVAILABLE",
      limitations: ["Недоступность нельзя трактовать как ноль конверсий."],
    }],
    material_uncertainties: ["Нет текущей статистики достижения цели Метрики."],
    domain_manifest: {
      domains: [
        { domain: "BUSINESS_MODEL", status: "VERIFIED", source_ids: ["first-party-web"], freshness: { current: 1, aging: 0, stale: 0, unknown: 0 } },
        { domain: "DIRECT", status: "PARTIAL", source_ids: ["direct"], freshness: { current: 0, aging: 1, stale: 0, unknown: 0 } },
        { domain: "METRIKA", status: "UNAVAILABLE", source_ids: ["metrika"], freshness: { current: 0, aging: 0, stale: 0, unknown: 0 } },
        { domain: "WORDSTAT", status: "PARTIAL", source_ids: ["wordstat"], freshness: { current: 1, aging: 0, stale: 0, unknown: 0 } },
      ],
    },
  };

  const projected = projectEvidenceSnapshotForDashboard(snapshot);

  assert.equal(projected.snapshotId, "snapshot-current-1");
  assert.equal(projected.generatedAt, generatedAt);
  assert.equal(projected.company.host, "expomap.ru");
  assert.deepEqual(projected.company.facts.map((fact) => [fact.field, fact.value]), [
    ["product", "Участие в выставке ИННОПРОМ"],
  ]);
  assert.equal(projected.company.facts[0].confidence.tier, "TIER_1_VERIFIED");
  assert.deepEqual(projected.company.facts[0].sourceUrls, ["https://expomap.ru/participation/"]);

  assert.deepEqual(projected.integrations.map((integration) => [integration.id, integration.status, integration.freshness]), [
    ["direct", "PARTIAL", "AGING"],
    ["metrika", "UNAVAILABLE", "UNKNOWN"],
  ]);
  assert.equal(projected.integrations[0].observedAt, "2026-09-01T09:55:00.000Z");
  assert.deepEqual(projected.integrations[0].sourceUrls, ["https://api.direct.yandex.com/json/v501/campaigns"]);
  assert.equal(projected.integrations[1].scope.counter_id, "12345678");
  assert.match(projected.integrations[1].limitations.join(" "), /нельзя трактовать как ноль конверсий/u);

  assert.equal(projected.sources.find((item) => item.id === "wordstat").freshness, "CURRENT");
  assert.deepEqual(projected.sources.find((item) => item.id === "wordstat").sourceUrls, ["https://wordstat.yandex.ru/"]);
  assert.deepEqual(projected.domains.find((item) => item.id === "WORDSTAT").freshness, { current: 1, aging: 0, stale: 0, unknown: 0 });
  assert.equal(projected.confidence.coverage, "PARTIAL");
  assert.deepEqual(projected.materialUncertainties, ["Нет текущей статистики достижения цели Метрики."]);
  assert.deepEqual(projected.hardBlockers, ["Метрика не вернула отчёт за текущий scope."]);
});
