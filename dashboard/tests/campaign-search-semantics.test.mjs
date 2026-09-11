import assert from "node:assert/strict";
import test from "node:test";
import { buildPublishProjection } from "../lib/campaign-draft.ts";
import { buildCampaignDesignContentContext } from "../lib/campaign-design-content.ts";
import { assessSearchCoverage, keywordFrequencyObservations, rankSearchSources, searchCoverageGroups, searchIntentHint } from "../lib/campaign-search-semantics.ts";
import { projectCampaignKeywords } from "../lib/campaign-keyword-presentation.ts";
import { searchEvidence } from "./fixtures/search-semantics-fixture.mjs";

function context(snapshot) {
  const values = { advertised_offer: "Внедрение товарного учёта для магазинов", target_audience: "Владельцы магазинов", qualified_result: "Заявка на расчёт", core_message: "Настройка учёта", geography: "Москва", weekly_budget: 21_000, landing_page: "https://owner.example/", period: { start_date: "2026-09-10", end_date: "2026-10-01" }, exclusions: "вакансии" };
  const strategy = { strategy_revision_id: "strategy:1", dimensions: Object.entries(values).map(([dimension_id, value]) => ({ dimension_id, value, evidence_refs: [] })) };
  const projection = buildPublishProjection({ product: values.advertised_offer, audience: values.target_audience, qualified_result: values.qualified_result, value: values.core_message }, { answers: strategy.dimensions.map((d) => ({ field_id: d.dimension_id, value: d.value })) }, { negative_keywords: "вакансии", keyword: "учёт", campaign_name: "Тестовая кампания", group_name: "Учёт", ad_title: "Учёт для магазинов", ad_text: "Узнайте подробности" });
  return buildCampaignDesignContentContext({ strategy, projection, evidenceSnapshot: snapshot, trustedBusinessValues: values, keywordMaximum: 100 });
}
function assessment(ctx, keywords, decisions, extra = {}) {
  return assessSearchCoverage({ sources: ctx.sources, observed: ctx.demand_evidence.observed_sources, admission: ctx.demand_evidence.admission, keywords, decisions, ...extra });
}
function demand(ctx) { return ctx.sources.filter((source) => source.purpose === "DEMAND"); }
function selected(source) { return { text: source.text, source_refs: [source.source_ref] }; }

test("every admitted phrase keeps measured frequency, scope, period and provenance", () => {
  const snapshot = searchEvidence();
  const before = structuredClone(snapshot);
  const ctx = context(snapshot);
  const source = demand(ctx)[0];
  assert.ok(source);
  assert.equal(source.demand.frequency.count, 123);
  assert.equal(source.demand.frequency.window, "06.08.2026 — 06.09.2026");
  assert.equal(source.demand.frequency.operator_profile, "BROAD_CONTAINING");
  assert.deepEqual(source.demand.frequency.region_ids, [213]);
  assert.deepEqual(source.evidence_refs, ["evidence:wordstat"]);
  assert.equal(source.demand.intent_hint, "COMMERCIAL");
  assert.deepEqual(snapshot, before);
});

test("all 434 observations survive the old first-320 boundary", () => {
  const ctx = context(searchEvidence(Array.from({ length: 434 }, (_, i) => ({ phrase: `учёт склада ${i}`, count: i + 1 }))));
  assert.equal(demand(ctx).length, 434);
  assert.equal(ctx.demand_evidence.admission.filter((row) => row.disposition === "FORWARDED").length, 434);
  assert.equal(ctx.demand_evidence.omitted_sources, 0);
  assert.ok(demand(ctx).some((row) => row.text === "учёт склада 433"));
});

test("admission trace separates unsafe, unrelated, zero and mismatched-scope observations", () => {
  const snapshot = searchEvidence([
    { phrase: "учёт склада", count: 10 }, { phrase: "учёт anna@example.com", count: 10 },
    { phrase: "купить автомобиль", count: 50_000 }, { phrase: "учёт склада стоимость", count: 0 },
    { phrase: "учёт магазина", count: 100 },
  ]);
  snapshot.market_evidence.frequency.canonical_observations[4].region_ids = [2];
  const ctx = context(snapshot);
  assert.equal(demand(ctx).length, 1);
  const rows = ctx.demand_evidence.admission;
  assert.equal(rows[1].phrase, null);
  assert.deepEqual(rows.map((row) => row.reason), ["CONFIRMED_SCOPED_OBSERVATION", "UNSAFE_PHRASE", "OUTSIDE_OFFER", "NO_POSITIVE_OBSERVATION", "PROVENANCE_OR_SCOPE_UNVERIFIED"]);
});

test("bounded catalog diversifies intent before frequency and never sums overlapping observations", () => {
  const sources = [
    { source_ref: "generic", demand: { cluster_id: "a", intent_hint: "GENERAL", frequency: { count: 999_999, scope_fingerprint: "one" } } },
    { source_ref: "rare-target", demand: { cluster_id: "a", intent_hint: "TARGET_ACTION", frequency: { count: 3, scope_fingerprint: "one" } } },
    { source_ref: "target", demand: { cluster_id: "a", intent_hint: "TARGET_ACTION", frequency: { count: 20, scope_fingerprint: "one" } } },
    { source_ref: "other-scope", demand: { cluster_id: "a", intent_hint: "TARGET_ACTION", frequency: { count: 1, scope_fingerprint: "two" } } },
  ];
  const ranked = rankSearchSources(sources, 3);
  assert.equal(ranked[0].source_ref, "target");
  assert.ok(ranked.some((source) => source.source_ref === "other-scope"));
  assert.equal(ranked.length, 3);
  assert.equal(sources[0].demand.frequency.count, 999_999);
});

test("catalog overflow is explicit and preserves a late rare commercial direction", () => {
  const snapshot = searchEvidence([
    ...Array.from({ length: 1_005 }, (_, i) => ({ phrase: `учёт склада ${i}`, count: 10_000 + i })),
    { phrase: "заказать учёт склада", count: 3 },
  ]);
  const ctx = context(snapshot);
  assert.equal(demand(ctx).length, 1_000);
  assert.ok(demand(ctx).some((source) => source.text === "заказать учёт склада"));
  assert.equal(ctx.demand_evidence.admission.filter((row) => row.disposition === "CAPACITY_OMITTED").length, 6);
});

test("upstream exclusions remain visible in the end-to-end admission trace", () => {
  const snapshot = searchEvidence();
  snapshot.market_evidence.frequency.excluded_rows = [{ phrase: "участие в школьной выставке", reason_code: "RELEVANCE_RULE_NO_MATCH" }];
  const ctx = context(snapshot);
  assert.equal(ctx.demand_evidence.observed_sources, 2);
  assert.equal(ctx.demand_evidence.admission[1].reason, "UPSTREAM_RELEVANCE_EXCLUSION");
  assert.equal(ctx.demand_evidence.admission[1].disposition, "EXCLUDED");
});

test("lexical hints do not treat accounting or visitor wording as stand-purchase evidence", () => {
  const action = "Участие компании со стендом";
  assert.equal(searchIntentHint("затраты на участие в выставке", action), "AMBIGUOUS");
  assert.equal(searchIntentHint("способы участия в выставке", action), "AMBIGUOUS");
  assert.equal(searchIntentHint("иннопром стенд", action, ["иннопром"]), "TARGET_ACTION");
  assert.equal(searchIntentHint("иннопром", action, ["иннопром"]), "BRAND");
  assert.equal(searchIntentHint("учёт затрат", "Заявка на бухгалтерские услуги"), "GENERAL");
});

test("coverage requires an explicit business rationale for each omitted direction", () => {
  const ctx = context(searchEvidence([{ phrase: "учёт склада стоимость", count: 123 }, { phrase: "заказать учёт склада", count: 10 }]));
  const groups = searchCoverageGroups(ctx.sources);
  const sources = demand(ctx);
  assert.equal(groups.length, 2);
  assert.equal(assessment(ctx, [selected(sources[0])], []).audit.status, "NEEDS_RESEARCH");
  const includedGroup = groups.find((group) => group.source_refs.includes(sources[0].source_ref));
  const decisions = groups.map((group) => ({ group_id: group.group_id, disposition: group === includedGroup ? "INCLUDED" : "EXCLUDED", rationale: "Направление сопоставлено с квалифицированным результатом и ограничениями предложения." }));
  const checked = assessment(ctx, [selected(sources[0])], decisions);
  assert.equal(checked.audit.status, "REVIEWED");
  assert.equal(checked.audit.keywords[0].frequency.count, sources[0].demand.frequency.count);
  decisions[0].rationale = "нет";
  assert.ok(assessment(ctx, [selected(sources[0])], decisions).violations.some((v) => v.code === "SEMANTIC_DECISION_INVALID"));
});

test("an INCLUDED label cannot certify a group with no actual selected phrase", () => {
  const ctx = context(searchEvidence());
  const groups = searchCoverageGroups(ctx.sources);
  const result = assessment(ctx, [], groups.map((group) => ({ group_id: group.group_id, disposition: "INCLUDED", rationale: "Наблюдаемое направление включено в кампанию для проверки целевого действия." })));
  assert.ok(result.violations.some((v) => v.code === "SEMANTIC_SELECTION_MISMATCH"));
});

test("partial selection is allowed under NEEDS_RESEARCH without falsely certifying completeness", () => {
  const ctx = context(searchEvidence());
  const groups = searchCoverageGroups(ctx.sources);
  const result = assessment(ctx, demand(ctx).map(selected), groups.map((group) => ({ group_id: group.group_id,
    disposition: "NEEDS_RESEARCH", rationale: "Подтверждённая фраза сохранена, но смежные коммерческие намерения требуют дополнительного исследования." })));
  assert.equal(result.audit.status, "NEEDS_RESEARCH");
  assert.equal(result.audit.trace.selected, 1);
  assert.ok(result.violations.some((v) => v.code === "SEMANTIC_RESEARCH_REQUIRED"));
  assert.ok(!result.violations.some((v) => v.code === "SEMANTIC_SELECTION_MISMATCH"));
});

test("unknown demand and exhausted catalog remain incomplete, without fabricating frequency", () => {
  const ctx = context(searchEvidence([]));
  const result = assessment(ctx, [{ text: "внедрение учёта", source_refs: ["strategy:advertised_offer"] }], []);
  assert.equal(result.audit.status, "NEEDS_RESEARCH");
  assert.equal(result.audit.keywords[0].frequency, null);
  const full = context(searchEvidence());
  full.demand_evidence.admission.push({ source_ref: "omitted", phrase: "учёт склада", disposition: "CAPACITY_OMITTED", reason: "EXPLICIT_CATALOG_CAPACITY" });
  const groups = searchCoverageGroups(full.sources);
  const capped = assessment(full, demand(full).map(selected), groups.map((g) => ({ group_id: g.group_id, disposition: "INCLUDED", rationale: "Проверить спрос на внедрение для магазинов по текущему предложению." })));
  assert.equal(capped.audit.status, "NEEDS_RESEARCH");
  assert.ok(capped.audit.gaps.includes("SEMANTIC_CAPACITY_INCOMPLETE"));
});

test("exact phrase lookup preserves zero and never borrows seed, operators or another geography", () => {
  const snapshot = searchEvidence([{ phrase: '"учёт склада"', count: 0 }]);
  assert.equal(keywordFrequencyObservations(snapshot, '"учёт склада"', [213])[0].count, 0);
  assert.deepEqual(keywordFrequencyObservations(snapshot, "учёт склада", [213]), []);
  assert.deepEqual(keywordFrequencyObservations(snapshot, '"учёт склада"', [2]), []);
  assert.deepEqual(keywordFrequencyObservations(snapshot, "неподтверждённый учёт", [213]), []);
});

test("stale, conflicted, unaudited and contradictory frequencies are unknown", () => {
  for (const mutate of [
    (s) => { s.evidence[0].freshness.status = "stale"; },
    (s) => { s.evidence[0].conflicts = ["conflict:1"]; },
    (s) => { s.evidence[0].provider_metadata.canonical_observation_ids = []; },
    (s) => { s.market_evidence.frequency.canonical_observations[0].provider_provenance.batch_id = "other"; },
  ]) {
    const snapshot = searchEvidence(); mutate(snapshot);
    assert.deepEqual(keywordFrequencyObservations(snapshot, "учёт склада стоимость", [213]), []);
  }
  const snapshot = searchEvidence([{ phrase: "учёт склада", count: 10 }, { phrase: "учёт склада", count: 20 }]);
  assert.deepEqual(keywordFrequencyObservations(snapshot, "учёт склада", [213]), []);
});

test("read-only projection attaches observations to every exact group keyword in old and edited drafts", () => {
  const snapshot = searchEvidence();
  const projection = { direct: { ad_groups: [{ local_ref: "group:1", provider_fields: { RegionIds: [213] } }], keywords: [
    { kind: "EXPLICIT_KEYWORD", ad_group_ref: "group:1", provider_fields: { Keyword: "учёт склада стоимость" } },
    { kind: "EXPLICIT_KEYWORD", ad_group_ref: "group:1", provider_fields: { Keyword: "новая фраза" } },
    { kind: "AUTOTARGETING", ad_group_ref: "group:1", provider_fields: { Keyword: "---autotargeting" } },
  ] } };
  const before = structuredClone(projection);
  const result = projectCampaignKeywords({ snapshot, projection, design: {}, fingerprint: "current" });
  assert.equal(result.keywords.length, 2);
  assert.equal(result.keywords[0].frequencies[0].count, 123);
  assert.deepEqual(result.keywords[1].frequencies, []);
  assert.equal(result.coverage.status, "NOT_REVIEWED");
  assert.deepEqual(projection, before);
  const ctx = context(snapshot);
  const groups = searchCoverageGroups(ctx.sources);
  const audit = assessment(ctx, demand(ctx).map(selected), groups.map((g) => ({ group_id: g.group_id, disposition: "INCLUDED", rationale: "Соответствует задаче магазина по внедрению товарного учёта." }))).audit;
  const design = { search_semantics: audit, semantic_draft_fingerprint: "old" };
  assert.equal(projectCampaignKeywords({ snapshot, projection, design, fingerprint: "current" }).coverage.status, "NOT_REVIEWED");
  assert.equal(projectCampaignKeywords({ snapshot, projection, design, fingerprint: "old" }).coverage.status, "REVIEWED");
});
