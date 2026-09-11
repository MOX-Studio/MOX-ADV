import assert from "node:assert/strict";
import test from "node:test";
import { projectResearchMaterials, researchSourceStatus } from "../lib/research-material-presentation.ts";

test("dated competitors and contractors are presented without promoting case metrics to campaign evidence", () => {
  const snapshot = { business_research: { supporting_materials: [{ id: "research-1", kind: "RESEARCH_SUMMARY", observed_at: "2026-09-09T08:00:00Z", content: {
    sources: [{ id: "s1", title: "Официальная страница", url: "https://example.com/" }, { id: "bad", title: "bad", url: "javascript:alert(1)" }],
    competitors: [{ id: "c1", name: "Выставка", classification: "Пересечение аудитории — вывод", offer: "Участие со стендом", source_ids: ["s1", "bad"] }],
    contractors: [{ id: "a1", name: "Агентство", case: "Выставка", reported: "Автор заявил 10 форм", limits: "Квалификация не раскрыта", takeaway: "Старая гипотеза не является текущим решением", source_ids: ["s1"] }],
  } }] } };
  const before = structuredClone(snapshot), view = projectResearchMaterials(snapshot);
  assert.deepEqual(snapshot, before);
  assert.equal(view.competitors.length, 1); assert.equal(view.contractors.length, 1);
  assert.equal(view.competitors[0].sources.length, 1);
  assert.equal(view.competitors[0].observedAt, "2026-09-09T08:00:00Z");
  assert(view.contractors[0].fields.some(f => f.label === "Заявлено автором кейса"));
  assert(view.contractors[0].fields.some(f => f.value === "Квалификация не раскрыта"));
  assert(!JSON.stringify(view).includes("Старая гипотеза"));
});

test("API access, campaign relevance and counter scope remain different facts", () => {
  const view = projectResearchMaterials({ business_research: { supporting_materials: [{ id: "api", kind: "RESEARCH_SUMMARY", content: {
    checked_at: "2026-09-09", direct_v5: { status: "AVAILABLE", campaign_count: 73, history_relevance: "NOT_ESTABLISHED" }, metrica: { status: "AVAILABLE", site: "other.example", relevance: "DIFFERENT_SITE" },
  } }] } });
  const source = { id: "direct", title: "Директ", status: "UNAVAILABLE" };
  assert.match(researchSourceStatus(source, view).status, /не подтверждена/);
  assert.match(researchSourceStatus(source, view).detail, /API доступен.*73/);
  assert.equal(source.status, "UNAVAILABLE");
  assert.equal(researchSourceStatus({ ...source, id: "metrika" }, view).status, "Счётчик другого сайта");
  assert.equal(researchSourceStatus(source).status, "Данные не получены");
});

test("missing supplemental material does not invent companies, successful access or zero metrics", () => {
  assert.deepEqual(projectResearchMaterials({}), { competitors: [], contractors: [], access: null });
  const view = projectResearchMaterials({ business_research: { supporting_materials: [{ kind: "RESEARCH_SUMMARY", content: { direct_v5: { status: "UNAVAILABLE" } } }] } });
  assert.equal(view.access.campaignCount, null); assert.equal(view.access.directAvailable, false);
});
