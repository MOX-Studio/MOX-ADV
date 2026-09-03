import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProductFocusArtifacts,
  createProductFocusState,
  inferDecisionMakers,
  inferOffer,
  isUnprocessedAudience,
  isUnprocessedOffer,
  reviseProductFocusState,
  verifyProductFocusState,
} from "../lib/business-model.ts";

const innopromEvidence =
  "САУДОВСКАЯ АРАВИЯ Эр-Рияд, Саудовская Аравия ПОДРОБНЕЕ ИННОПРОМ Международная промышленная выставка, объединяющая на своей площадке производителей и байеров со всего мира.";

test("turns exhibition evidence into a concrete offer instead of a brand", () => {
  assert.equal(
    inferOffer(
      "ИННОПРОМ",
      "Международная промышленная выставка для участников и байеров",
      "Отправленная заявка на участие",
    ),
    "Участие в международной промышленной выставке ИННОПРОМ",
  );
  assert.equal(isUnprocessedOffer("ИННОПРОМ", "ИННОПРОМ", "ИННОПРОМ"), true);
});

test("does not invent an offer from a company name alone", () => {
  assert.equal(inferOffer("Компания", "Официальный сайт компании", "Заявка"), "");
});

test("extracts decision-maker roles instead of copying the page fragment", () => {
  assert.equal(
    inferDecisionMakers(innopromEvidence),
    "Байеры и руководители по закупкам и представители компаний-производителей",
  );
});

test("detects a raw evidence quote stored as the audience answer", () => {
  assert.equal(isUnprocessedAudience(innopromEvidence, innopromEvidence), true);
  assert.equal(isUnprocessedAudience("Байеры и руководители по закупкам", innopromEvidence), false);
});

test("returns no invented role when evidence has none", () => {
  assert.equal(inferDecisionMakers("Международная выставка состоится в октябре"), "");
});

const candidate = (overrides = {}) => ({
  label: "Участие со стендом",
  offer: "Участие со стендом в промышленной выставке",
  audience: "Руководители промышленных компаний",
  value: "Новые квалифицированные деловые контакты",
  qualified_outcome: "Отправленная заявка на участие",
  economics: "Пакет от 500 000 ₽",
  destination: "https://owner.example/exhibit",
  current_promotion: "NOT_OBSERVED",
  unresolved_facts: [],
  evidence_refs: [{ source_url: "https://owner.example/exhibit", quote: "Участие со стендом от 500 000 ₽" }],
  demand_cluster_ids: ["cluster-exhibit"],
  ...overrides,
});

const marketEvidence = (clusters) => ({
  frequency: {
    status: "AVAILABLE",
    clusters: clusters.map(([cluster_id, value]) => ({
      cluster_id,
      status: "AVAILABLE",
      semantic_key: { product: cluster_id, need: "commercial", intent: "application", offer: cluster_id },
      observed_unique_count: { value, semantics: "LOWER_BOUND_OBSERVED_TOP_ROWS" },
    })),
  },
});

test("builds one launch-now focus card for a single materially complete offer", async () => {
  const result = await buildProductFocusArtifacts({
    candidates: [candidate()],
    marketEvidence: marketEvidence([["cluster-exhibit", 120]]),
    generatedAt: "2026-08-22T10:00:00.000Z",
  });

  assert.equal(result.catalog.offers.length, 1);
  assert.equal(result.focus_opportunities.cards.length, 1);
  assert.equal(result.focus_opportunities.recommendation_status, "LAUNCH_NOW_RECOMMENDED");
  assert.equal(result.focus_opportunities.cards[0].disposition, "LAUNCH_NOW");
  assert.equal(result.focus_opportunities.cards[0].market_opportunity.status, "AVAILABLE");
  assert.equal(result.focus_opportunities.cards[0].launch_readiness.status, "READY");
  assert.equal(result.focus_opportunities.cards[0].evidence_coverage.status, "SUFFICIENT");
  assert.equal(result.focus_opportunities.prepared_human_decision_gate, null);
});

test("merges close SKUs when none of the five material axes changes", async () => {
  const result = await buildProductFocusArtifacts({
    candidates: [
      candidate({ label: "Стенд S", offer: "Комплект оборудования S", evidence_refs: [{ source_url: "https://owner.example/exhibit", quote: "Стенд S" }] }),
      candidate({ label: "Стенд M", offer: "Комплект оборудования M", evidence_refs: [{ source_url: "https://owner.example/exhibit", quote: "Стенд M" }] }),
    ],
    marketEvidence: marketEvidence([["cluster-exhibit", 120]]),
    generatedAt: "2026-08-22T10:00:00.000Z",
  });

  assert.equal(result.catalog.offers.length, 1);
  assert.deepEqual(result.catalog.offers[0].merged_labels, ["Стенд M", "Стенд S"]);
  assert.equal(result.catalog.offers[0].merged_candidate_count, 2);
});

test("keeps offers separate for material outcome, audience, economics, destination or offer differences", async () => {
  const variants = [
    candidate(),
    candidate({ label: "Посещение", offer: "Билет посетителя", demand_cluster_ids: ["cluster-visit"] }),
    candidate({ label: "Стенд для закупщиков", audience: "Директора по закупкам", demand_cluster_ids: ["cluster-buyers"] }),
    candidate({ label: "Премиальный стенд", economics: "Пакет от 1 500 000 ₽", demand_cluster_ids: ["cluster-premium"] }),
    candidate({ label: "Региональная посадочная", destination: "https://owner.example/regions", demand_cluster_ids: ["cluster-region"] }),
    candidate({ label: "Консультация", qualified_outcome: "Забронированная консультация", demand_cluster_ids: ["cluster-consult"] }),
  ];
  const result = await buildProductFocusArtifacts({
    candidates: variants,
    marketEvidence: marketEvidence(variants.map((item, index) => [item.demand_cluster_ids[0], 200 - index * 10])),
    generatedAt: "2026-08-22T10:00:00.000Z",
  });

  assert.equal(result.catalog.offers.length, 6);
  assert.deepEqual(result.catalog.materiality_dimensions, ["qualified_outcome", "audience", "economics", "destination", "offer"]);
});

test("preserves alternatives and creates exactly one prepared gate for a material tie", async () => {
  const result = await buildProductFocusArtifacts({
    candidates: [
      candidate({ label: "Стенд", demand_cluster_ids: ["cluster-a"] }),
      candidate({ label: "Партнёрство", offer: "Партнёрский пакет выставки", destination: "https://owner.example/partners", demand_cluster_ids: ["cluster-b"] }),
    ],
    marketEvidence: marketEvidence([["cluster-a", 100], ["cluster-b", 100]]),
    generatedAt: "2026-08-22T10:00:00.000Z",
  });

  assert.equal(result.focus_opportunities.recommendation_status, "HUMAN_DECISION_REQUIRED");
  assert.equal(result.focus_opportunities.recommended_offer_id, null);
  assert.equal(result.focus_opportunities.nearest_alternative_offer_ids.length, 2);
  assert.equal(result.focus_opportunities.prepared_human_decision_gate.reason_code, "MATERIAL_TIE");
  assert.equal(result.focus_opportunities.prepared_human_decision_gate.options.length, 2);
  assert.ok(result.focus_opportunities.prepared_human_decision_gate.recommendation);
  assert.ok(result.focus_opportunities.prepared_human_decision_gate.evidence.length > 0);
  assert.ok(result.focus_opportunities.prepared_human_decision_gate.consequences.length > 0);
  const unresolved = await createProductFocusState({
    artifacts: result,
    analyticsEvidenceSnapshotId: "sha256:evidence",
    selectedAt: "2026-08-22T10:00:00.000Z",
    ownerConfirmed: true,
  });
  assert.equal(unresolved.selected_offer_id, null);
  assert.equal(unresolved.decision_status, "HUMAN_DECISION_REQUIRED");
});

test("keeps unsupported options as insufficient instead of inventing opportunity", async () => {
  const result = await buildProductFocusArtifacts({
    candidates: [candidate({ economics: "", unresolved_facts: ["Экономика предложения не подтверждена"] })],
    marketEvidence: { frequency: { status: "UNAVAILABLE", clusters: [] } },
    generatedAt: "2026-08-22T10:00:00.000Z",
  });

  const card = result.focus_opportunities.cards[0];
  assert.equal(card.disposition, "INSUFFICIENT_EVIDENCE");
  assert.equal(card.market_opportunity.status, "UNAVAILABLE");
  assert.ok(card.reasons.some((reason) => reason.code === "MARKET_OPPORTUNITY_UNAVAILABLE"));
  assert.equal(result.focus_opportunities.blocked_or_insufficient_offer_ids.length, 1);
  assert.equal(result.focus_opportunities.prepared_human_decision_gate.reason_code, "UNSTABLE_RECOMMENDATION");
});

test("keeps a launch-blocked option visible but rejects it as an owner-selected focus", async () => {
  const artifacts = await buildProductFocusArtifacts({
    candidates: [candidate({ destination_status: "BLOCKED", unresolved_facts: ["Посадочная страница не относится к предложению"] })],
    marketEvidence: marketEvidence([["cluster-exhibit", 120]]),
    generatedAt: "2026-08-22T10:00:00.000Z",
  });
  const blocked = artifacts.focus_opportunities.cards[0];
  assert.equal(blocked.disposition, "BLOCKED");
  assert.ok(blocked.reasons.some((reason) => reason.code === "LAUNCH_READINESS_BLOCKED"));
  const previous = await createProductFocusState({
    artifacts,
    analyticsEvidenceSnapshotId: "sha256:evidence",
    selectedAt: "2026-08-22T10:00:00.000Z",
  });
  await assert.rejects(
    reviseProductFocusState({
      previous,
      artifacts,
      analyticsEvidenceSnapshotId: "sha256:evidence-2",
      selectedOfferId: artifacts.catalog.offers[0].offer_id,
      selectedAt: "2026-08-22T10:01:00.000Z",
    }),
    /launch-blocked focus/u,
  );
});

test("owner focus edit creates a verifiable immutable revision linked to the previous focus", async () => {
  const artifacts = await buildProductFocusArtifacts({
    candidates: [
      candidate({ label: "Стенд", demand_cluster_ids: ["cluster-a"] }),
      candidate({ label: "Партнёрство", offer: "Партнёрский пакет выставки", destination: "https://owner.example/partners", demand_cluster_ids: ["cluster-b"] }),
    ],
    marketEvidence: marketEvidence([["cluster-a", 120], ["cluster-b", 80]]),
    generatedAt: "2026-08-22T10:00:00.000Z",
  });
  const initial = await createProductFocusState({
    artifacts,
    analyticsEvidenceSnapshotId: "sha256:evidence",
    selectedAt: "2026-08-22T10:00:00.000Z",
  });
  const alternative = artifacts.catalog.offers.find((offer) => offer.offer_id !== initial.selected_offer_id);
  const revised = await reviseProductFocusState({
    previous: initial,
    artifacts,
    analyticsEvidenceSnapshotId: "sha256:evidence-2",
    selectedOfferId: alternative.offer_id,
    selectedAt: "2026-08-22T10:01:00.000Z",
  });

  assert.equal(revised.selection_source, "OWNER_EDITED");
  assert.equal(revised.previous_focus_revision_id, initial.focus_revision_id);
  assert.notEqual(revised.focus_revision_id, initial.focus_revision_id);
  assert.equal(revised.selected_offer_id, alternative.offer_id);
  assert.equal(await verifyProductFocusState(revised), true);
  const corrupted = structuredClone(revised);
  corrupted.selected_offer_id = initial.selected_offer_id;
  assert.equal(await verifyProductFocusState(corrupted), false);
});
