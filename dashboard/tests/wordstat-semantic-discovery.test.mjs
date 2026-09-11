import assert from "node:assert/strict";
import test from "node:test";

import { buildDemandCostResearchPlan } from "../lib/market-evidence.ts";
import {
  selectWordstatExpansionSeeds,
  selectWordstatVerificationSeeds,
  wordstatDiscoveryStopReason,
  wordstatOperatorVerificationSeeds,
} from "../lib/wordstat-semantic-discovery.ts";

async function plan() {
  return buildDemandCostResearchPlan({
    generatedAt: "2026-09-03T10:00:00.000Z",
    offerLanguage: "участие со стендом в международной промышленной выставке",
    customerProblems: ["найти новых оптовых покупателей", "выход на новые рынки"],
    highIntentActions: ["оставить заявку на участие"],
    brandTerms: ["ИННОПРОМ"],
    audienceTerms: ["руководители промышленных компаний"],
    exclusions: ["госзакупка"],
    regionIds: [225],
    regionNames: ["Россия"],
    device: "all",
    seasonality: "",
    dynamicsFromDate: "2024-09-01",
    dynamicsToDate: "2026-08-31",
    semanticExpansion: true,
  });
}

function discoveryBatch(seed, rows) {
  return {
    observations: [{ seed_id: seed.seed_id, surface: "TOP_POPULAR", rows }, {
      seed_id: seed.seed_id,
      surface: "TOP_SIMILAR",
      rows: [
        { phrase: "принял участие в промышленной выставке", count: 50_000 },
        { phrase: "заявка на участие в госзакупке", count: 40_000 },
        { phrase: "деловая промышленная выставка", count: 700 },
      ],
    }],
  };
}

test("builds a diversified initial seed matrix with explicit UI discovery budgets", async () => {
  const researchPlan = await plan();

  assert.ok(researchPlan.seeds.length > 8);
  assert.ok(researchPlan.seeds.length <= 20);
  assert.ok(researchPlan.seeds.every((seed) => seed.phrase.split(/\s+/u).length <= 7));
  assert.ok(researchPlan.seeds.some((seed) => seed.dimension === "AUDIENCE"));
  assert.ok(researchPlan.seeds.some((seed) => seed.dimension === "HIGH_INTENT_ACTION" && /стоимость|цена/iu.test(seed.phrase)));
  assert.ok(researchPlan.seeds.every((seed) => seed.collection_purpose === "DISCOVERY" && seed.discovery_depth === 0));
  assert.equal(researchPlan.quota.maximum_ui_surface_reads, 104);
});

test("selects relevant expansion phrases and rejects procurement and narrative noise", async () => {
  const researchPlan = await plan();
  const parent = researchPlan.seeds.find((seed) => seed.relevance_tokens.some((token) => /выстав/iu.test(token)));
  const batch = discoveryBatch(parent, [
    { phrase: parent.phrase, count: 2_000 },
    { phrase: "организация участия в промышленной выставке", count: 900 },
    { phrase: "международная промышленная выставка для бизнеса", count: 800 },
  ]);

  const expansion = selectWordstatExpansionSeeds(researchPlan, batch);

  assert.ok(expansion.length >= 2);
  assert.ok(expansion.length <= 20);
  assert.ok(expansion.some((seed) => seed.phrase === "организация участия в промышленной выставке"));
  assert.ok(expansion.some((seed) => seed.phrase === "деловая промышленная выставка"));
  assert.equal(expansion.some((seed) => /принял|госзакуп/iu.test(seed.phrase)), false);
  assert.ok(expansion.every((seed) => seed.cluster_id === parent.cluster_id));
  assert.ok(expansion.every((seed) => seed.discovery_depth === 1 && seed.parent_seed_id === parent.seed_id));
});

test("selects one high-demand verification representative per cluster and builds quoted checks", async () => {
  const researchPlan = await plan();
  const parents = researchPlan.seeds.filter((seed) => seed.relevance_tokens.length).slice(0, 2);
  const batch = {
    observations: parents.flatMap((seed, index) => [{
      seed_id: seed.seed_id,
      surface: "TOP_POPULAR",
      rows: [
        { phrase: seed.phrase, count: 100 + index },
        { phrase: `${seed.phrase.split(/\s+/u).slice(0, 5).join(" ")} 2026`, count: 200 + index },
      ],
    }]),
  };

  const verification = selectWordstatVerificationSeeds(researchPlan, [batch], []);
  const operator = wordstatOperatorVerificationSeeds(verification);

  assert.ok(verification.length > 0);
  assert.ok(verification.length <= 8);
  assert.equal(new Set(verification.map((seed) => seed.cluster_id)).size, verification.length);
  assert.ok(verification.every((seed) => seed.collection_purpose === "SEASONALITY_VERIFICATION"));
  assert.ok(operator.every((seed) => seed.operator_profile === "FIXED_WORD_COUNT"));
  assert.ok(operator.every((seed) => /^".*"$/u.test(seed.phrase)));
  assert.equal(wordstatDiscoveryStopReason(0), "NO_EXPANSION_CANDIDATES");
  assert.equal(wordstatDiscoveryStopReason(20), "EXPANSION_LIMIT_REACHED");
  assert.equal(wordstatDiscoveryStopReason(3), "SATURATED");
});
