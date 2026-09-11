import assert from "node:assert/strict";
import test from "node:test";
import { validateCompetitorDossiers, orderCompetitorDossiers, rankCompetitors } from "../lib/competitor-ranking.ts";
import { competitorDossier } from "./fixtures/competitor-ranking-fixture.mjs";

const names = ["Specialist Expo", "Famous Expo"];
const sources = names.map((competitor, index) => ({ competitor, url: `https://expo-${index}.example/participate`, observed_at: "2026-09-07T10:00:00Z", text: "Участие со стендом для производителей. Профессиональная выставка." }));

test("buyer overlap and substitution determine rank ahead of general fame and promotion", () => {
  const result = validateCompetitorDossiers([
    competitorDossier("Famous Expo", sources, { BUYER_OVERLAP: "LOW", ATTRACTION: "HIGH", PROMOTION: "HIGH" }),
    competitorDossier("Specialist Expo", sources, { BUYER_OVERLAP: "HIGH", ATTRACTION: "LOW", PROMOTION: "LOW" }),
  ], sources, names);
  assert.deepEqual(result.map((item) => [item.competitor, item.rank]), [["Specialist Expo", 1], ["Famous Expo", 2]]);
  assert.deepEqual(orderCompetitorDossiers(result.reverse()).map((item) => item.competitor), ["Specialist Expo", "Famous Expo"]);
});

test("unobserved URLs, invented quotes and duplicated competitors cannot enter the ranking", () => {
  for (const mutate of [
    (rows) => { rows[0].offer.evidence[0].url = sources[1].url; },
    (rows) => { rows[0].offer.evidence[0].quote = "Invented performance claim"; },
    (rows) => { rows[1].competitor = rows[0].competitor; },
    (rows) => { rows[0].criteria.pop(); },
  ]) {
    const rows = names.map((name) => structuredClone(competitorDossier(name, sources)));
    mutate(rows);
    assert.throws(() => validateCompetitorDossiers(rows, sources, names));
  }
});

test("unknown criteria stay explicit and do not acquire fake evidence or numeric metrics", () => {
  const rows = names.map((name) => competitorDossier(name, sources));
  rows[0].criteria[3] = { criterion: "TERMS", level: "UNKNOWN", explanation: "Условия не опубликованы", evidence: [] };
  const result = validateCompetitorDossiers(rows, sources, names);
  assert.equal(result.find((item) => item.competitor === names[0]).criteria[3].level, "UNKNOWN");
  rows[0].strengths[0].text = "CPA 500 ₽";
  assert.throws(() => validateCompetitorDossiers(rows, sources, names), /advertising metrics/u);
  const invented = names.map((name) => competitorDossier(name, sources));
  invented[0].terms = { text: "Участие стоит 100 000 ₽", evidence: [] };
  assert.throws(() => validateCompetitorDossiers(invented, sources, names), /information gap/u);
});

test("ranking repairs a citation once using the same independently observed source corpus", async () => {
  const requests = [];
  const input = {
    comparisonScope: { goal_revision_id: "goal", desired_outcome: "Участие", qualified_action: "Заявка", advertised_offer: "Выставка", target_audience: "Производители", geography: "Россия", first_party_host: "owner.example" },
    collection: { competitorMatrix: { candidate_set: { candidates: names.map((competitor) => ({ competitor })) } },
      competitorObservations: sources.map((item) => ({ observed_at: item.observed_at, raw_quote: item.text, matrix_row: { competitor: item.competitor, exact_landing: item.url, observed_offer_message: item.text } })) },
    assessment: { relations: [] }, coverage: { target_count: 5 }, generatedAt: "2026-09-07T10:00:00Z",
  };
  const result = await rankCompetitors({ model_id: "test", async generate(request) {
    requests.push(request);
    const candidates = request.input.candidates.map((name) => competitorDossier(name, request.input.sources));
    if (requests.length === 1) candidates[0].offer.evidence[0].quote = "not observed";
    return { candidates };
  } }, input);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].input.sources, requests[1].input.sources);
  assert.equal(result.candidates.length, 2);
  assert.match(requests[1].input.repair.error, /outside/u);
});

test("large candidate pools use bounded parallel batches and receive one global deterministic order", async () => {
  const allNames = Array.from({ length: 9 }, (_, index) => `Expo ${index + 1}`);
  const observed = allNames.map((competitor, index) => ({ competitor, url: `https://expo-${index}.example/`, observed_at: "2026-09-07T10:00:00Z", text: "Участие со стендом для производителей" }));
  let running = 0, maximum = 0;
  const requests = [];
  const result = await rankCompetitors({ model_id: "test", async generate(request) {
    requests.push(request); running += 1; maximum = Math.max(maximum, running);
    await new Promise((resolve) => setTimeout(resolve, 5)); running -= 1;
    return { candidates: request.input.candidates.map((name) => competitorDossier(name, request.input.sources, { BUYER_OVERLAP: name === "Expo 9" ? "HIGH" : "MEDIUM" })) };
  } }, { comparisonScope: {}, generatedAt: "2026-09-07T10:00:00Z", coverage: { target_count: 5 }, assessment: { relations: [] },
    collection: { competitorMatrix: { candidate_set: { candidates: allNames.map((competitor) => ({ competitor })) } },
      competitorObservations: observed.map((source) => ({ observed_at: source.observed_at, raw_quote: source.text, matrix_row: { competitor: source.competitor, exact_landing: source.url, observed_offer_message: source.text } })) } });
  assert.equal(requests.length, 3);
  assert.equal(maximum, 2);
  assert.ok(requests.every((request) => request.input.candidates.length <= 4));
  assert.ok(requests.every((request) => request.input.sources.every((source) => request.input.candidates.includes(source.competitor))));
  assert.equal(result.candidates[0].competitor, "Expo 9");
  assert.deepEqual(result.candidates.map((item) => item.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("stopping ranking prevents later batches and discards late model results", async () => {
  const controller = new AbortController();
  const allNames = Array.from({ length: 9 }, (_, index) => `Expo ${index + 1}`);
  let release, started;
  const gate = new Promise((resolve) => { release = resolve; });
  const begun = new Promise((resolve) => { started = resolve; });
  let calls = 0;
  const pending = rankCompetitors({ model_id: "test", async generate(request) {
    calls += 1; if (calls === 2) started(); await gate;
    return { candidates: request.input.candidates.map((name) => competitorDossier(name, request.input.sources)) };
  } }, { comparisonScope: {}, generatedAt: "2026-09-07T10:00:00Z", coverage: {}, assessment: { relations: [] }, signal: controller.signal,
    collection: { competitorMatrix: { candidate_set: { candidates: allNames.map((competitor) => ({ competitor })) } },
      competitorObservations: allNames.map((competitor, index) => ({ raw_quote: "Участие со стендом для производителей", observed_at: "2026-09-07T10:00:00Z",
        matrix_row: { competitor, exact_landing: `https://expo-${index}.example/`, observed_offer_message: "Участие со стендом для производителей" } })) } });
  await begun; const reason = new Error("Owner stopped research"); controller.abort(reason); release();
  await assert.rejects(pending, (error) => error === reason);
  assert.equal(calls, 2);
});
