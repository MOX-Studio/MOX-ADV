import assert from "node:assert/strict";
import test from "node:test";

import { projectDirectAuditForOwner } from "../lib/p0-owner-journey.ts";

const OBSERVED_AT = "2026-08-24T12:00:00.000Z";

function reportSummary(reportKey, rows, status = "COMPLETE") {
  return {
    report_key: reportKey,
    report_type: reportKey === "search-query-performance"
      ? "SEARCH_QUERY_PERFORMANCE_REPORT"
      : "CAMPAIGN_PERFORMANCE_REPORT",
    status,
    artifact_reference: status === "COMPLETE" ? { object_count: rows } : null,
  };
}

function completeAudit({ counts, campaigns = [], searchRows = 0, resultRows = 0, status = "COMPLETE" }) {
  return {
    status,
    object_counts: {
      campaigns: 0,
      adgroups: 0,
      ads: 0,
      keywords: 0,
      autotargetings: 0,
      ...counts,
    },
    campaign_summaries: campaigns,
    report_summaries: [
      reportSummary("campaign-performance", resultRows),
      reportSummary("search-query-performance", searchRows),
    ],
  };
}

function snapshot({ sourceStatus = "VERIFIED", directValue, performance = null }) {
  return {
    sources: [{ source_id: "direct", status: sourceStatus, observed_at: OBSERVED_AT }],
    claims: [
      ...(directValue ? [{
        predicate: Object.hasOwn(directValue, "complete_read_audit") ? "complete_account_audit" : "campaign_inventory",
        value: directValue,
        confidence: { freshness: "fresh", coverage: sourceStatus === "PARTIAL" ? "partial" : "complete_for_scope" },
      }] : []),
      ...(performance ? [{ predicate: "observed_performance", value: performance }] : []),
    ],
  };
}

test("owner Direct report shows a filled verified slice without provider identifiers or schema vocabulary", () => {
  const report = projectDirectAuditForOwner(snapshot({
    directValue: {
      campaigns_total: 2,
      campaign_summaries: [{
        campaign_id: "9007199254740993123",
        name: "Поиск · промышленная выставка",
        type: "UNIFIED_CAMPAIGN",
        state: "ON",
        status: "ACCEPTED",
      }],
      complete_read_audit: completeAudit({
        counts: { campaigns: 2, adgroups: 4, ads: 8, keywords: 20, autotargetings: 3 },
        campaigns: [{ campaign_id: "9007199254740993123", name: "Поиск · промышленная выставка", type: "UNIFIED_CAMPAIGN", state: "ON", status: "ACCEPTED" }],
        searchRows: 17,
        resultRows: 2,
      }),
    },
    performance: {
      visits: "30",
      goal_visits: "4",
      report: { period_start: "2026-08-01", period_end: "2026-08-20" },
    },
  }));

  assert.equal(report.state, "filled");
  assert.equal(report.status, "Данные получены");
  assert.equal(report.observedAt, "24 авг. 2026 г., 15:00 МСК");
  assert.equal(report.inventory.find((item) => item.label === "Объявления").value, "8");
  assert.equal(report.queries.value, "17 строк за период");
  assert.equal(report.results.value, "4 достижения цели");
  assert.deepEqual(report.campaigns, [{
    name: "Поиск · промышленная выставка",
    delivery: "Показы включены",
    review: "Принята рекламной системой",
  }]);
  assert.doesNotMatch(JSON.stringify(report), /9007199254740993123|UNIFIED_CAMPAIGN|direct-audit|schema_version|campaigns\.get|SEARCH_QUERY_PERFORMANCE_REPORT/iu);
  assert.match(report.summary, /не доказывает причинную эффективность/iu);
});

test("owner Direct report distinguishes a verified empty slice from unavailable activity", () => {
  const report = projectDirectAuditForOwner(snapshot({
    directValue: {
      campaigns_total: 0,
      campaign_summaries: [],
      complete_read_audit: completeAudit({ counts: {}, searchRows: 0, resultRows: 0 }),
    },
  }));

  assert.equal(report.state, "empty");
  assert.equal(report.status, "Пустой срез");
  assert.ok(report.inventory.every((item) => item.value === "0"));
  assert.match(report.summary, /нулевые значения подтверждены/iu);
});

test("owner Direct report keeps partial reads explicit and never turns missing collections into zero", () => {
  const report = projectDirectAuditForOwner(snapshot({
    sourceStatus: "PARTIAL",
    directValue: {
      campaigns_total: 2,
      campaign_summaries: [{ name: "Основная", state: "SUSPENDED", status: "ACCEPTED" }],
    },
  }));

  assert.equal(report.state, "partial");
  assert.equal(report.status, "Данные частичные");
  assert.equal(report.inventory.find((item) => item.label === "Кампании").value, "2");
  assert.equal(report.inventory.find((item) => item.label === "Объявления").value, "Недоступно");
  assert.equal(report.queries.status, "Недоступно");
  assert.match(report.limitations.join(" "), /нельзя считать нулевым/iu);
});

test("owner Direct report never fabricates zero goal results when Metrika observation is incomplete", () => {
  const report = projectDirectAuditForOwner(snapshot({
    directValue: {
      campaigns_total: 1,
      campaign_summaries: [],
      complete_read_audit: completeAudit({
        counts: { campaigns: 1, adgroups: 1, ads: 1, keywords: 1 },
        resultRows: 1,
      }),
    },
    performance: {
      visits: "30",
      report: { period_start: "2026-08-01", period_end: "2026-08-20" },
    },
  }));

  assert.equal(report.results.status, "Частично");
  assert.equal(report.results.value, "1 строка результата");
  assert.match(report.results.detail, /Достижения цели не подтверждены/iu);
  assert.doesNotMatch(`${report.results.value} ${report.results.detail}`, /0 достижен/iu);
});

test("owner Direct report represents unavailable evidence as unknown and provides a safe next action", () => {
  const report = projectDirectAuditForOwner(snapshot({
    sourceStatus: "UNAVAILABLE",
    directValue: null,
  }));

  assert.equal(report.state, "unavailable");
  assert.equal(report.status, "Данные недоступны");
  assert.ok(report.inventory.every((item) => item.value === "Недоступно"));
  assert.match(report.summary, /не подменяется нулевыми/iu);
  assert.match(report.nextActions.join(" "), /восстановить подтверждённый доступ/iu);
});

test("owner Direct report stays absent before an analytics snapshot exists", () => {
  assert.equal(projectDirectAuditForOwner(null), null);
});
