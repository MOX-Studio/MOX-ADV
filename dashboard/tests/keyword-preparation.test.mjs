import test from "node:test";
import assert from "node:assert/strict";
import { formationEvidence } from "./fixtures/campaign-formation-fixture.mjs";
import { keywordResearchFixture, keywordReviewFixture } from "./fixtures/keyword-preparation-fixture.mjs";
import { keywordResearchSchema, keywordReviewSchema, literalNegativeEffect, literalKeywordCoverage, verifyKeywordResearch, verifyKeywordReview } from "../lib/keyword-preparation.ts";
import { validateFormationShape } from "../lib/campaign-formation-method.ts";
function fixture() {
  const research = formationEvidence("source").research;
  research.keyword_research = keywordResearchFixture(research, ["участие со стендом", "аренда экспоместа", "участие со стендом 2027"]);
  const portfolio = { campaigns: [{ id: "C1", channel: "SEARCH", autotargeting: "TARGETED", negative_keywords: ["вакансия"], groups: [{ id: "G1", keywords: [{ phrase: "участие со стендом" }, { phrase: "аренда экспоместа" }], negative_keywords: [] }] }] };
  portfolio.keyword_review = keywordReviewFixture(research, portfolio);
  portfolio.keyword_review.groups[0].examples.push({ query: "участие со стендом вакансия", keyword: "участие со стендом", desired: "EXCLUDE", basis: "LITERAL", negative: "вакансия", explanation: "Вакансия не соответствует намерению клиента." });
  return { research, portfolio };
}
const codes = (f) => verifyKeywordReview(f.research, f.portfolio).map(i => i.code);
test("complete candidate pool retains a meaningful synonym and separates unselected candidates", () => {
  const f = fixture();
  assert.deepEqual(validateFormationShape(keywordResearchSchema(["source"]), f.research.keyword_research), []);
  assert.deepEqual(validateFormationShape(keywordReviewSchema(), f.portfolio.keyword_review), []);
  assert.deepEqual(verifyKeywordResearch(f.research), []); assert.deepEqual(codes(f), []);
});
test("omitted candidates, unresearched selected words, stale negatives and duplicate axes cannot pass", () => {
  const f = fixture(); f.portfolio.keyword_review.decisions.pop(); assert.ok(codes(f).includes("KEYWORD_DECISION_MISSING"));
  f.portfolio.campaigns[0].groups[0].keywords.push({ phrase: "новый ключ" }); assert.ok(codes(f).includes("KEYWORD_UNRESEARCHED_SELECTION"));
  f.portfolio.campaigns[0].negative_keywords.push("работа"); assert.ok(codes(f).includes("KEYWORD_REVIEW_STALE"));
  f.research.keyword_research.coverage[1].axis = "PRODUCT"; assert.ok(verifyKeywordResearch(f.research).some(i => i.code === "KEYWORD_AXIS_MISSING"));
});
test("semantic assumption cannot erase a synonym as covered; literal coverage requires actual words", () => {
  const f = fixture(), row = f.portfolio.keyword_review.decisions[2];
  Object.assign(row, { disposition: "COVERED", group_id: "G1", keyword: "участие со стендом", coverage_basis: "SEMANTIC_ASSUMPTION" });
  assert.ok(codes(f).includes("KEYWORD_COVERAGE_ASSUMED")); row.coverage_basis = "LITERAL"; assert.deepEqual(codes(f), []);
  row.keyword = "аренда экспоместа"; assert.ok(codes(f).includes("KEYWORD_LITERAL_COVERAGE_INVALID"));
  assert.equal(literalKeywordCoverage('"участие со стендом"', 'участие со стендом 2027'), false);
});
test("full negative overlap is ignored; partial overlap can exclude a query", () => {
  assert.equal(literalNegativeEffect("купить розового слона", "купить слона", "купить розового слона"), "IGNORED_FULL_OVERLAP");
  assert.equal(literalNegativeEffect("купить розового слона", "купить недорого", "купить розового слона недорого"), "EXCLUDES");
  assert.equal(literalNegativeEffect("купить слона", "!слона", "купить слона"), "UNRESOLVED");
  const f = fixture(); f.portfolio.campaigns[0].negative_keywords.push("стендом"); f.portfolio.keyword_review.groups[0].campaign_negatives = ["вакансия", "стендом"];
  assert.ok(codes(f).includes("IGNORED_NEGATIVE_UNREVIEWED"));
  f.portfolio.keyword_review.groups[0].ignored_negatives.push({ keyword: "участие со стендом", negative: "стендом", reason: "Полное пересечение игнорируется для этого ключа." }); assert.deepEqual(codes(f), []);
});
test("desired query exclusion and an ignored negative presented as effective block acceptance", () => {
  const f = fixture(), group = f.portfolio.keyword_review.groups[0];
  group.examples[0].query += " вакансия"; assert.ok(codes(f).includes("DESIRED_QUERY_EXCLUDED"));
  group.examples[0].query = "участие со стендом";
  f.portfolio.campaigns[0].negative_keywords = group.campaign_negatives = ["стендом"];
  group.examples[1].negative = "стендом"; assert.ok(codes(f).includes("NEGATIVE_EXAMPLE_INEFFECTIVE"));
});
test("known exclusion invalidates literal candidate coverage and search autotargeting is reviewed separately", () => {
  const f = fixture(), row = f.portfolio.keyword_review.decisions[2];
  Object.assign(row, { disposition: "COVERED", group_id: "G1", keyword: "участие со стендом", coverage_basis: "LITERAL" });
  f.portfolio.campaigns[0].negative_keywords.push("2027"); assert.ok(codes(f).includes("KEYWORD_COVERAGE_EXCLUDED"));
  f.portfolio.campaigns[0].autotargeting = "OFF"; assert.ok(codes(f).includes("SEARCH_AUTOTARGETING_REQUIRED"));
});
test("curated candidates cannot acquire observed provenance without linked sources", () => {
  const f = fixture(), c = f.research.keyword_research.candidates[0]; c.origin = "SOURCE_QUERY"; c.evidence_refs = [];
  assert.ok(verifyKeywordResearch(f.research).some(i => i.code === "KEYWORD_PROVENANCE_INVALID"));
});
