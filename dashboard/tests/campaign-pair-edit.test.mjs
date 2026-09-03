import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMPAIGN_DRAFT_TECHNICAL_FIELDS,
  CAMPAIGN_HYPOTHESIS_SEMANTIC_FIELDS,
  CampaignPairEditError,
  classifyCampaignPairEdit,
  prepareCampaignPairRebuild,
} from "../lib/campaign-pair-edit.ts";

function pair(id, hypothesisRevision = "h-r1", draftRevision = "d-r1") {
  return {
    pair_id: id,
    hypothesis_revision_id: hypothesisRevision,
    draft_revision_id: draftRevision,
    hypothesis: {
      product: "Выставка",
      audience: "Директор по маркетингу",
      offer: "Участие под ключ",
      qualified_result: "Заявка на участие",
      core_message: "Подготовим участие под ключ",
    },
    draft: {
      campaign_name: `Кампания ${id}`,
      group_name: `Группа ${id}`,
      negative_keywords: "вакансии, бесплатно",
      keyword: "участие в выставке",
      ad_title: "Участие в выставке",
      ad_text: "Оставьте заявку",
      measurement_goal: "Заявка на участие",
    },
  };
}

function edit(overrides = {}) {
  return {
    pair_id: "pair-a",
    expected_hypothesis_revision_id: "h-r1",
    expected_draft_revision_id: "d-r1",
    ...overrides,
  };
}

test("authoritative classification maps semantic dimensions to the Hypothesis plus Draft rebuild cone", () => {
  assert.deepEqual(CAMPAIGN_HYPOTHESIS_SEMANTIC_FIELDS, [
    "product",
    "audience",
    "offer",
    "qualified_result",
    "core_message",
  ]);
  assert.deepEqual(CAMPAIGN_DRAFT_TECHNICAL_FIELDS, [
    "campaign_name",
    "group_name",
    "negative_keywords",
    "keyword",
    "ad_title",
    "ad_text",
    "control",
    "tested_change",
    "bidding_strategy",
    "bid_ceiling_rub",
    "query_matching",
    "autotargeting_policy",
    "comparator_percent",
    "treatment_percent",
    "test_budget_rub",
    "start_date",
    "end_date",
    "measurement_goal",
    "success_threshold",
    "stop_condition",
  ]);

  assert.deepEqual(classifyCampaignPairEdit(edit({
    semantic_changes: { audience: "Коммерческий директор", core_message: "Стенд и сопровождение под ключ" },
    technical_changes: { campaign_name: "Выставка · коммерческие директора" },
  })), {
    schema_version: "p0-campaign-pair-edit-v1",
    pair_id: "pair-a",
    classification: "SEMANTIC",
    changed_fields: [
      "/hypothesis/audience",
      "/hypothesis/core_message",
      "/direct/campaign/Name",
    ],
    rebuild_cone: {
      hypothesis: true,
      draft: true,
      independent_pairs: "PRESERVE_EXACT_REVISIONS",
    },
  });

  assert.deepEqual(classifyCampaignPairEdit(edit({
    technical_changes: { negative_keywords: "вакансии, бесплатно, реферат", bid_ceiling_rub: 700 },
  })), {
    schema_version: "p0-campaign-pair-edit-v1",
    pair_id: "pair-a",
    classification: "TECHNICAL",
    changed_fields: [
      "/direct/ad_group/NegativeKeywords/Items",
      "/auction_protocol/bid_ceiling_rub",
    ],
    rebuild_cone: {
      hypothesis: false,
      draft: true,
      independent_pairs: "PRESERVE_EXACT_REVISIONS",
    },
  });
});

test("a semantic edit rebuilds the selected Hypothesis and its Draft while preserving independent pairs exactly", async () => {
  const selected = pair("pair-a");
  const independent = pair("pair-b", "h-b-r4", "d-b-r7");
  const pairs = [selected, independent];
  const before = structuredClone(pairs);
  let hypothesisBuilds = 0;
  let draftBuilds = 0;

  const result = await prepareCampaignPairRebuild({
    pairs,
    edit: edit({
      semantic_changes: {
        qualified_result: "Квалифицированная заявка",
        core_message: "Сопровождение участия под ключ",
      },
      technical_changes: { measurement_goal: "  квалифицированная   заявка " },
    }),
    rebuildHypothesis({ previous, semantic_changes: changes }) {
      hypothesisBuilds += 1;
      previous.core_message = "callback mutation remains isolated";
      return { ...previous, ...changes };
    },
    rebuildDraft({ previous, hypothesis, technical_changes: changes }) {
      draftBuilds += 1;
      return {
        ...previous,
        ad_text: hypothesis.core_message,
        measurement_goal: changes.measurement_goal,
      };
    },
  });

  assert.equal(result.plan.classification, "SEMANTIC");
  assert.equal(hypothesisBuilds, 1);
  assert.equal(draftBuilds, 1);
  assert.equal(result.rebuild_candidate.source_hypothesis_revision_id, "h-r1");
  assert.equal(result.rebuild_candidate.source_draft_revision_id, "d-r1");
  assert.equal(result.rebuild_candidate.hypothesis.qualified_result, "Квалифицированная заявка");
  assert.equal(result.rebuild_candidate.hypothesis.core_message, "Сопровождение участия под ключ");
  assert.equal(result.rebuild_candidate.draft.ad_text, "Сопровождение участия под ключ");
  assert.equal(result.preserved_pairs[0], independent);
  assert.equal(result.preserved_pairs[0].hypothesis_revision_id, "h-b-r4");
  assert.equal(result.preserved_pairs[0].draft_revision_id, "d-b-r7");
  assert.deepEqual(pairs, before);
});

test("a technical edit rebuilds only the selected Draft and preserves its Hypothesis and every independent pair", async () => {
  const selected = pair("pair-a");
  const independent = pair("pair-b", "h-b-r4", "d-b-r7");
  let hypothesisBuilds = 0;
  let draftBuilds = 0;

  const result = await prepareCampaignPairRebuild({
    pairs: [selected, independent],
    edit: edit({ technical_changes: { campaign_name: "Техническое имя кампании" } }),
    rebuildHypothesis() {
      hypothesisBuilds += 1;
      throw new Error("technical edits must not rebuild the Hypothesis");
    },
    rebuildDraft({ previous, hypothesis, technical_changes: changes }) {
      draftBuilds += 1;
      assert.deepEqual(hypothesis, selected.hypothesis);
      return { ...previous, ...changes };
    },
  });

  assert.equal(result.plan.classification, "TECHNICAL");
  assert.equal(hypothesisBuilds, 0);
  assert.equal(draftBuilds, 1);
  assert.equal(result.rebuild_candidate.hypothesis, selected.hypothesis);
  assert.equal(result.rebuild_candidate.draft.campaign_name, "Техническое имя кампании");
  assert.equal(result.preserved_pairs[0], independent);
});

test("unsupported, contradictory and stale edits fail before either current-state rebuild runs", async () => {
  assert.throws(
    () => classifyCampaignPairEdit(edit({ semantic_changes: { budget: 1_000 } })),
    (error) => error instanceof CampaignPairEditError
      && error.code === "CAMPAIGN_PAIR_EDIT_FIELD_UNSUPPORTED"
      && /semantic_changes\.budget/u.test(error.message)
      && /no current Campaign pair was changed/u.test(error.message),
  );
  assert.throws(
    () => classifyCampaignPairEdit(edit({
      semantic_changes: { qualified_result: "Заявка на участие" },
      technical_changes: { measurement_goal: "Просмотр страницы" },
    })),
    (error) => error instanceof CampaignPairEditError
      && error.code === "CAMPAIGN_PAIR_EDIT_CONTRADICTORY"
      && /measured result must match the qualified result/u.test(error.message),
  );

  const current = pair("pair-a");
  const before = structuredClone(current);
  let rebuildCalls = 0;
  await assert.rejects(
    prepareCampaignPairRebuild({
      pairs: [current],
      edit: edit({
        expected_draft_revision_id: "d-r0",
        technical_changes: { ad_text: "Устаревшая правка" },
      }),
      rebuildHypothesis() {
        rebuildCalls += 1;
        return {};
      },
      rebuildDraft() {
        rebuildCalls += 1;
        return {};
      },
    }),
    (error) => error instanceof CampaignPairEditError
      && error.code === "CAMPAIGN_PAIR_EDIT_STALE"
      && /no current Campaign pair was changed/u.test(error.message),
  );
  assert.equal(rebuildCalls, 0);
  assert.deepEqual(current, before);
});
