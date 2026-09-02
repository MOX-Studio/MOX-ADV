import assert from "node:assert/strict";
import test from "node:test";

import {
  refreshCurrentPipelineCompetitorEvidence,
} from "../lib/pipeline-competitor-refresh.ts";

class MemoryStore {
  constructor(current) {
    this.current = structuredClone(current);
  }

  async loadCurrent(ownerKey) {
    return this.current?.owner_key === ownerKey ? structuredClone(this.current) : null;
  }

  async compareAndSwap(ownerKey, expectedRevision, next) {
    if (this.current?.owner_key !== ownerKey || this.current.state_revision !== expectedRevision) return false;
    this.current = structuredClone(next);
    return true;
  }
}

function currentProducts() {
  return {
    schema_version: "p0-pipeline-current-products-v1",
    owner_key: "owner-1",
    state_revision: 7,
    run_id: "run-1",
    run_version: 9,
    current_stage: "CAMPAIGNS",
    updated_at: "2026-09-01T10:00:00.000Z",
    historical_source: { schema_version: "p0-document-v1", revision: 1, digest: "sha256:history" },
    goal_revision: {
      schema_version: "p0-goal-revision-v1",
      goal_revision_id: "goal-1",
      version: 1,
      desired_outcome: "Получать заявки на участие со стендом в ИННОПРОМ",
      qualified_action: "Обсудить формат стенда и бюджет",
      evidence: [],
      known_constraints: [],
      owner_confirmation_required: false,
      digest: "sha256:goal",
    },
    analytics_evidence_snapshot: {
      schema_version: "p0-analytics-evidence-v7",
      snapshot_id: "sha256:old-evidence",
      generated_at: "2026-09-01T10:00:00.000Z",
    },
    competitor_evidence_refresh: null,
    campaign_strategy: {
      strategy: {
        dimensions: [
          { dimension_id: "advertised_offer", value: "Участие со стендом в выставке ИННОПРОМ" },
          { dimension_id: "target_audience", value: "Промышленные компании" },
          { dimension_id: "qualified_result", value: "Обсуждение формата, сроков и бюджета" },
          { dimension_id: "core_message", value: "Стенд под ключ" },
          { dimension_id: "exclusions", value: "Посетители выставки" },
          { dimension_id: "geography", value: "Россия" },
        ],
      },
    },
    campaign_pairs: [{
      pair_revision_id: "pair-1",
      draft: {
        publish_projection: {
          direct: { ad: { ResponsiveAd: { Href: "https://expo.innoprom.com/" } } },
        },
      },
    }],
    campaign_pair_checks: { status: "PASS", set_disposition: "VALID", pairs: [], violations: [] },
    campaign_playbook: { schema_version: "playbook-v1", revision_id: "playbook-1", digest: "sha256:playbook" },
    publication_review: {
      schema_version: "p0-publication-review-handoff-v1",
      status: "REVIEW_ONLY",
      run_id: "run-1",
      pair_count: 1,
      publish_fingerprints: ["sha256:draft"],
      external_write: "DENIED",
      publication: "NOT_AUTHORIZED",
      impressions: 0,
      spend_micros: 0,
    },
    authority: {
      external_write: "DENIED",
      publication: "NOT_AUTHORIZED",
      impressions: 0,
      spend_micros: 0,
    },
  };
}

test("refreshes only public competitor evidence while preserving current pipeline products and zero-write authority", async () => {
  const before = currentProducts();
  const store = new MemoryStore(before);
  let collectorInput;
  const next = await refreshCurrentPipelineCompetitorEvidence({
    store,
    ownerKey: "owner-1",
    expectedStateRevision: 7,
    refreshedAt: "2026-09-01T12:00:00.000Z",
    collector: async (input) => {
      collectorInput = input;
      return {
        evidencePackId: "innoprom-public-pack-v1",
        competitorMatrix: {
          status: "AVAILABLE",
          candidate_set: { candidates: [{ competitor: "MKE EXPO", exact_destinations: ["https://mkeexpo.ru/innoprom"] }] },
          rows: [{ competitor: "MKE EXPO", exact_landing: "https://mkeexpo.ru/innoprom" }],
        },
        financialCompetitorIntelligence: { capability_status: "AVAILABLE", profiles: [{ legal_name: "ООО «МКЕ»" }] },
      };
    },
    analyst: async ({ collection, businessGoal }) => ({
      schema_version: "p0-pipeline-competitor-assessment-v1",
      analyst: { actor_id: "evidence_analyst:test", actor_type: "AGENT", role: "EVIDENCE_ANALYST", model_id: "test" },
      objective: businessGoal.desiredOutcome,
      relations: [{
        competitor: collection.competitorMatrix.rows[0].competitor,
        relation: "DIRECT_COMPETITOR",
        evidence_url: collection.competitorMatrix.rows[0].exact_landing,
        rationale: "Точное публичное предложение сопоставимой услуги.",
      }],
      summary: "Evidence Analyst classified the exact observed offer.",
      authority: { external_write: "DENIED", publication: "NOT_AUTHORIZED", impressions: 0, spend_micros: 0 },
    }),
  });

  assert.equal(collectorInput.model.product, "Участие со стендом в выставке ИННОПРОМ");
  assert.equal(collectorInput.site.url, "https://expo.innoprom.com/");
  assert.equal(next.state_revision, 8);
  assert.equal(next.analytics_evidence_snapshot.snapshot_id, "sha256:old-evidence");
  assert.deepEqual(next.campaign_strategy, before.campaign_strategy);
  assert.deepEqual(next.campaign_pairs, before.campaign_pairs);
  assert.deepEqual(next.publication_review, before.publication_review);
  assert.equal(next.competitor_evidence_refresh.schema_version, "p0-pipeline-competitor-evidence-refresh-v1");
  assert.match(next.competitor_evidence_refresh.revision_id, /^competitor-evidence:/u);
  assert.equal(next.competitor_evidence_refresh.source_snapshot_id, "sha256:old-evidence");
  assert.equal(next.competitor_evidence_refresh.competitor_assessment.analyst.role, "EVIDENCE_ANALYST");
  assert.equal(next.competitor_evidence_refresh.competitor_assessment.relations[0].relation, "DIRECT_COMPETITOR");
  assert.deepEqual(next.competitor_evidence_refresh.authority, before.authority);
  assert.deepEqual(next.authority, before.authority);
});

test("bounds both public collection and Evidence Analyst time without persisting late results", async () => {
  for (const scenario of [
    {
      code: "COMPETITOR_COLLECTION_TIMEOUT",
      collector: async () => new Promise(() => undefined),
      analyst: async () => { throw new Error("Analyst must not run after collection timeout."); },
    },
    {
      code: "COMPETITOR_ANALYST_TIMEOUT",
      collector: async () => ({
        evidencePackId: "bounded-pack",
        competitorMatrix: {
          candidate_set: { candidates: [{ competitor: "MKE EXPO", exact_destinations: ["https://mkeexpo.ru/innoprom"] }] },
          rows: [{ competitor: "MKE EXPO", exact_landing: "https://mkeexpo.ru/innoprom" }],
        },
        competitorObservations: [],
        financialCompetitorIntelligence: { capability_status: "UNAVAILABLE", profiles: [] },
      }),
      analyst: async () => new Promise(() => undefined),
    },
  ]) {
    const store = new MemoryStore(currentProducts());
    await assert.rejects(
      refreshCurrentPipelineCompetitorEvidence({
        store,
        ownerKey: "owner-1",
        expectedStateRevision: 7,
        collectorTimeoutMs: 15,
        analystTimeoutMs: 15,
        collector: scenario.collector,
        analyst: scenario.analyst,
      }),
      (error) => error?.code === scenario.code,
    );
    assert.equal((await store.loadCurrent("owner-1")).state_revision, 7);
  }
});

test("fails closed on stale revision without calling the public collector", async () => {
  const store = new MemoryStore(currentProducts());
  let called = false;
  await assert.rejects(
    refreshCurrentPipelineCompetitorEvidence({
      store,
      ownerKey: "owner-1",
      expectedStateRevision: 6,
      collector: async () => {
        called = true;
        return null;
      },
    }),
    /данные изменились/u,
  );
  assert.equal(called, false);
  assert.equal((await store.loadCurrent("owner-1")).state_revision, 7);
});
