import assert from "node:assert/strict";
import test from "node:test";

import { projectAnalyticsEvidenceForOwner } from "../lib/analytics-owner-summary.ts";

const DOMAIN_ORDER = ["BUSINESS_MODEL", "DIRECT", "METRIKA", "WORDSTAT", "COST", "COMPETITORS", "FINANCIAL"];

function claim(subject, predicate, value) {
  return {
    claim_id: `claim-${predicate}`,
    claim_hash: `sha256:${"a".repeat(64)}`,
    subject,
    predicate,
    value,
    normalized: { value, datatype: "object" },
    classification: "observed",
    evidence_ids: [`evidence-${predicate}`],
    confidence: {
      quality: "A",
      freshness: "current",
      consistency: "single",
      coverage: "complete_for_scope",
      uncertainty: [],
      tier: "TIER_1_VERIFIED",
    },
  };
}

function fullSnapshot() {
  const claims = [
    claim("business_model", "product", "Участие в промышленной выставке"),
    claim("current_direct_account", "campaign_inventory", { campaigns_total: 3, campaign_summaries: [] }),
    claim("metrika_goal", "observed_performance", { visits: 42, goal_visits: 3, report: { period_start: "2026-08-01", period_end: "2026-08-20" } }),
    claim("market_demand", "scoped_frequency", { observed_unique_count: 67 }),
    claim("prelaunch_cost", "qualified_cost_range", { range: { low: 110, high: 170 } }),
    claim("competitor:alpha", "published_offer", "Пакет участия"),
    claim("financial:dossier", "confirmed_legal_history", { accepted_entities: 2 }),
  ];
  return {
    recommendation_status: "EVIDENCE_READY_WITH_GAPS",
    claims,
    gaps: [],
    conflicts: [],
    domain_manifest: {
      domains: DOMAIN_ORDER.map((domain, index) => ({
        domain,
        artifact_paths: [],
        status: "VERIFIED",
        source_ids: [],
        claim_indexes: [index],
        evidence_indexes: [],
        conflict_indexes: [],
        gap_indexes: [],
        freshness: { current: 1, aging: 0, stale: 0, unknown: 0 },
      })),
    },
    product_catalog: {
      offers: [{
        offer_id: "offer-main",
        label: "Участие со стендом",
        material_axes: { offer: "Участие со стендом", audience: "Руководители производственных компаний", qualified_outcome: "Заявка на участие" },
      }],
    },
    focus_opportunities: { recommended_offer_id: "offer-main" },
    market_evidence: { frequency: { status: "AVAILABLE", observed_unique_count: { value: 67 } } },
    prelaunch_cost: { status: "AVAILABLE", range: { low: 110, high: 170 }, currency: "RUB", sample_size: { value: 42 } },
    competitor_ad_observation: {
      status: "PARTIAL",
      approved_sample_count: 1,
    },
    competitor_matrix: {
      candidate_set: { candidates: [{ competitor: "Альфа" }, { competitor: "Бета" }] },
      rows: [{ competitor: "Альфа" }],
    },
    financial_competitor_intelligence: {
      coverage: { accepted_entities: 2, entities_with_records: 2 },
    },
  };
}

function domain(snapshot, name) {
  return snapshot.domain_manifest.domains.find((item) => item.domain === name);
}

test("complete evidence produces business findings and readiness without provider diagnostics", () => {
  const summary = projectAnalyticsEvidenceForOwner(fullSnapshot());

  assert.equal(summary.status, "Готово к стратегии");
  assert.equal(summary.findings.length, 7);
  assert.deepEqual(summary.findings.map((item) => item.area), [
    "Модель бизнеса",
    "Текущее продвижение",
    "Наблюдаемый результат",
    "Поисковый спрос",
    "Сопоставимая стоимость",
    "Публичные конкуренты",
    "Финансовая история юрлиц",
  ]);
  assert.equal(summary.findings.every((item) => item.status === "Подтверждено"), true);
  assert.match(summary.findings.find((item) => item.area === "Текущее продвижение").finding, /3 кампании/u);
  assert.match(summary.findings.find((item) => item.area === "Наблюдаемый результат").finding, /3 достижения/u);
  assert.match(summary.findings.find((item) => item.area === "Поисковый спрос").finding, /67 уникальных строк/u);
  assert.match(summary.findings.find((item) => item.area === "Сопоставимая стоимость").finding, /110–170 RUB/u);
  assert.deepEqual(summary.remediation, []);
  assert.doesNotMatch(JSON.stringify(summary), /snapshot|schema|provider|sha256|claim-|evidence-|_id|Campaigns\.get|Reports/iu);
});

test("competitor finding explicitly shows no approved ad source without claiming zero activity", () => {
  const snapshot = fullSnapshot();
  snapshot.competitor_matrix = null;
  snapshot.competitor_ad_observation = {
    status: "UNAVAILABLE_NO_APPROVED_SOURCE",
    approved_sample_count: 0,
  };
  const finding = projectAnalyticsEvidenceForOwner(snapshot).findings.find((item) => item.area === "Публичные конкуренты").finding;
  assert.match(finding, /Одобренный источник рекламных наблюдений отсутствует/u);
  assert.match(finding, /рекламная активность неизвестна/u);
  assert.doesNotMatch(finding, /рекламная активность равна нулю/u);
});

test("mixed evidence keeps partial and unavailable areas visible and orders repairs by strategic impact", () => {
  const snapshot = fullSnapshot();
  domain(snapshot, "DIRECT").status = "PARTIAL";
  domain(snapshot, "DIRECT").freshness = { current: 1, aging: 1, stale: 0, unknown: 0 };
  domain(snapshot, "WORDSTAT").status = "UNAVAILABLE";
  domain(snapshot, "WORDSTAT").claim_indexes = [];
  const gap = {
    gap_id: "gap-wordstat",
    gap_hash: `sha256:${"b".repeat(64)}`,
    code: "WORDSTAT_RESPONSE_PARTIAL",
    source_id: "wordstat",
    description: "provider response partial",
    material: true,
    status: "UNAVAILABLE",
    limitations: ["technical provider detail"],
  };
  snapshot.gaps.push(gap);
  domain(snapshot, "WORDSTAT").gap_indexes = [0];

  const summary = projectAnalyticsEvidenceForOwner(snapshot);

  assert.equal(summary.status, "Есть существенные пробелы");
  assert.equal(summary.findings.find((item) => item.area === "Текущее продвижение").status, "Частично");
  assert.equal(summary.findings.find((item) => item.area === "Текущее продвижение").freshness, "Смешанная свежесть");
  assert.equal(summary.findings.find((item) => item.area === "Поисковый спрос").status, "Недоступно");
  assert.equal(summary.remediation[0].impact, "Блокирует допустимость кампаний");
  assert.equal(summary.remediation[0].area, "Текущее продвижение");
  assert.equal(summary.remediation.some((item) => item.area === "Поисковый спрос" && item.impact === "Меняет стратегию"), true);
  assert.deepEqual(summary.remediation.map((item) => item.priority), summary.remediation.map((_, index) => index + 1));
  assert.doesNotMatch(JSON.stringify(summary), /WORDSTAT_|provider response|technical provider|gap-wordstat/iu);
});

test("insufficient evidence never claims readiness and puts blockers before optional confidence repairs", () => {
  const snapshot = fullSnapshot();
  snapshot.recommendation_status = "BLOCKED_UNKNOWN";
  domain(snapshot, "BUSINESS_MODEL").status = "PARTIAL";
  domain(snapshot, "DIRECT").status = "UNAVAILABLE";
  domain(snapshot, "DIRECT").claim_indexes = [];
  domain(snapshot, "COMPETITORS").status = "PARTIAL";
  snapshot.gaps.push({
    gap_id: "gap-direct",
    gap_hash: `sha256:${"c".repeat(64)}`,
    code: "CURRENT_DIRECT_INVENTORY_UNAVAILABLE",
    source_id: "direct",
    description: "Direct inventory unavailable",
    material: true,
    status: "UNAVAILABLE",
    limitations: [],
  });
  domain(snapshot, "DIRECT").gap_indexes = [0];
  snapshot.conflicts.push({
    conflict_id: "conflict-product",
    conflict_hash: `sha256:${"d".repeat(64)}`,
    claim_ids: [snapshot.claims[0].claim_id],
    predicate: "advertised product",
    left_value: "Участие",
    right_value: "Посещение",
    relation: "contradicts",
    material: true,
    resolution: "UNRESOLVED_OWNER_DECISION",
  });
  domain(snapshot, "BUSINESS_MODEL").conflict_indexes = [0];

  const summary = projectAnalyticsEvidenceForOwner(snapshot);

  assert.equal(summary.status, "Недостаточно доказательств");
  assert.match(summary.headline, /недостаточно/u);
  assert.match(summary.conclusion, /не должна считаться допустимой/u);
  assert.equal(summary.remediation[0].impact, "Блокирует допустимость кампаний");
  assert.equal(summary.remediation.findIndex((item) => item.impact === "Снижает уверенность") > summary.remediation.findIndex((item) => item.impact === "Блокирует допустимость кампаний"), true);
  assert.equal(summary.findings.find((item) => item.area === "Текущее продвижение").finding.includes("не означает отсутствие"), true);
  assert.notEqual(summary.status, "Готово к стратегии");
});
