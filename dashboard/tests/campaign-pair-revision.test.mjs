import assert from "node:assert/strict";
import test from "node:test";

import { fingerprintDirectProjection } from "../lib/campaign-fanout.ts";
import { CampaignPairEditError } from "../lib/campaign-pair-edit.ts";
import {
  projectCurrentCampaignArtifacts,
  saveCurrentCampaignPairRevision,
} from "../lib/campaign-pair-revision.ts";

function projection(campaignName) {
  return {
    creation_profile: { profile_id: "direct-v501" },
    brand_claims_contract: { status: "BOUND" },
    direct: {
      campaign: { Name: campaignName },
      ad_group: { Name: "Основная группа" },
      keyword: { Keyword: "участие в выставке" },
      ad: { ResponsiveAd: { Titles: ["Участие под ключ"], Texts: ["Оставьте заявку"] } },
    },
  };
}

async function pair(id, hypothesisRevision, draftRevision, campaignName) {
  const publishProjection = projection(campaignName);
  return {
    pair_id: id,
    hypothesis_revision_id: hypothesisRevision,
    draft_revision_id: draftRevision,
    publish_fingerprint: await fingerprintDirectProjection(publishProjection),
    hypothesis: {
      hypothesis_revision_id: hypothesisRevision,
      product: "Выставка",
      audience: "Директор по маркетингу",
      offer: "Участие под ключ",
      qualified_result: "Заявка на участие",
      core_message: "Подготовим участие под ключ",
    },
    draft: {
      draft_revision_id: draftRevision,
      campaign_name: campaignName,
      ad_text: "Оставьте заявку",
      publish_projection: publishProjection,
    },
  };
}

class MemoryRevisionStore {
  constructor(current) {
    this.current = structuredClone(current);
    this.audit = [];
    this.conflictNext = false;
  }

  async loadCurrent() {
    return structuredClone(this.current);
  }

  async compareAndSwap(_ownerKey, expectedRevision, current, audit) {
    if (this.conflictNext) {
      this.conflictNext = false;
      this.current = {
        ...this.current,
        state_revision: this.current.state_revision + 1,
        updated_at: "2026-08-31T10:00:30.000Z",
      };
      return false;
    }
    if (this.current.state_revision !== expectedRevision) return false;
    this.current = structuredClone(current);
    this.audit.push(structuredClone(audit));
    return true;
  }

  async technicalAudit() {
    return structuredClone(this.audit);
  }
}

async function fixture() {
  const selected = await pair("pair-a", "hypothesis-a-r1", "draft-a-r1", "Выставка");
  const independent = await pair("pair-b", "hypothesis-b-r4", "draft-b-r7", "Конференция");
  const current = {
    schema_version: "p0-campaign-pair-revision-v1",
    state_revision: 7,
    updated_at: "2026-08-31T10:00:00.000Z",
    goal: {
      revision_id: "goal-r3",
      value: { desired_outcome: "Получать заявки на участие" },
    },
    strategy: {
      revision_id: "strategy-r5",
      value: { business_goal: "Заявки на участие", weekly_budget_rub: 50_000 },
    },
    pairs: [selected, independent],
  };
  return { current, selected, independent, store: new MemoryRevisionStore(current) };
}

function ids() {
  const values = {
    hypothesis: "hypothesis-a-r2",
    draft: "draft-a-r2",
    audit: "campaign-pair-audit-8",
  };
  return (kind) => values[kind];
}

function saveInput(store, overrides = {}) {
  return {
    store,
    owner_key: "owner-1",
    expected_state_revision: 7,
    edit: {
      pair_id: "pair-a",
      expected_hypothesis_revision_id: "hypothesis-a-r1",
      expected_draft_revision_id: "draft-a-r1",
      technical_changes: { campaign_name: "Выставка для промышленности" },
    },
    rebuildHypothesis({ previous, semantic_changes }) {
      return { ...previous, ...semantic_changes };
    },
    rebuildDraft({ previous, technical_changes }) {
      return { ...previous, ...technical_changes };
    },
    publishProjection({ draft }) {
      return projection(draft.campaign_name);
    },
    now: () => "2026-08-31T10:01:00.000Z",
    newRevisionId: ids(),
    ...overrides,
  };
}

test("a material technical edit atomically creates a new Draft revision and fingerprint while keeping history audit-only", async () => {
  const { store, selected, independent } = await fixture();

  const result = await saveCurrentCampaignPairRevision(saveInput(store));
  const persisted = await store.loadCurrent("owner-1");
  const audit = await store.technicalAudit("owner-1");
  const dashboard = projectCurrentCampaignArtifacts(persisted);

  assert.equal(result.status, "SAVED");
  assert.equal(result.material_change, true);
  assert.equal(result.state_revision, 8);
  assert.equal(result.pair.hypothesis_revision_id, "hypothesis-a-r1");
  assert.equal(result.pair.draft_revision_id, "draft-a-r2");
  assert.notEqual(result.current_publish_fingerprint, selected.publish_fingerprint);
  assert.equal(
    result.current_publish_fingerprint,
    await fingerprintDirectProjection(result.pair.draft.publish_projection),
  );
  assert.deepEqual(persisted.goal, {
    revision_id: "goal-r3",
    value: { desired_outcome: "Получать заявки на участие" },
  });
  assert.deepEqual(persisted.strategy, {
    revision_id: "strategy-r5",
    value: { business_goal: "Заявки на участие", weekly_budget_rub: 50_000 },
  });
  assert.deepEqual(persisted.pairs[1], independent);
  assert.equal(audit.length, 1);
  assert.deepEqual(audit[0].superseded_pair, selected);
  assert.equal(audit[0].classification, "TECHNICAL");
  assert.equal(audit[0].source_draft_revision_id, "draft-a-r1");
  assert.equal(audit[0].current_draft_revision_id, "draft-a-r2");
  assert.deepEqual(Object.keys(dashboard), [
    "schema_version",
    "state_revision",
    "updated_at",
    "current_goal",
    "current_strategy",
    "current_campaign_pairs",
  ]);
  assert.equal(JSON.stringify(dashboard).includes("draft-a-r1"), false);
  assert.equal(JSON.stringify(dashboard).includes("campaign-pair-audit-8"), false);
  assert.equal(JSON.stringify(dashboard).includes("superseded_pair"), false);
});

test("a semantic edit issues both current revision identifiers and preserves independent pairs exactly", async () => {
  const { store, independent } = await fixture();
  const result = await saveCurrentCampaignPairRevision(saveInput(store, {
    edit: {
      pair_id: "pair-a",
      expected_hypothesis_revision_id: "hypothesis-a-r1",
      expected_draft_revision_id: "draft-a-r1",
      semantic_changes: { core_message: "Организуем участие в выставке под ключ" },
    },
    rebuildHypothesis({ previous, semantic_changes }) {
      return { ...previous, ...semantic_changes };
    },
    rebuildDraft({ previous, hypothesis }) {
      return {
        ...previous,
        campaign_name: hypothesis.core_message,
        ad_text: hypothesis.core_message,
      };
    },
  }));

  assert.equal(result.status, "SAVED");
  assert.equal(result.pair.hypothesis_revision_id, "hypothesis-a-r2");
  assert.equal(result.pair.draft_revision_id, "draft-a-r2");
  assert.equal(result.pair.hypothesis.core_message, "Организуем участие в выставке под ключ");
  assert.deepEqual((await store.loadCurrent("owner-1")).pairs[1], independent);
});

test("normalization-only input reports no-op without a revision or audit event", async () => {
  const { store, selected } = await fixture();
  let revisionIdsIssued = 0;
  const result = await saveCurrentCampaignPairRevision(saveInput(store, {
    edit: {
      pair_id: "pair-a",
      expected_hypothesis_revision_id: "hypothesis-a-r1",
      expected_draft_revision_id: "draft-a-r1",
      technical_changes: { campaign_name: "  Выставка  " },
    },
    rebuildDraft({ previous, technical_changes }) {
      return { ...previous, campaign_name: String(technical_changes.campaign_name).trim() };
    },
    newRevisionId() {
      revisionIdsIssued += 1;
      return "must-not-be-issued";
    },
  }));

  assert.equal(result.status, "NO_OP");
  assert.equal(result.material_change, false);
  assert.equal(result.state_revision, 7);
  assert.deepEqual(result.pair, selected);
  assert.equal(revisionIdsIssued, 0);
  assert.equal((await store.loadCurrent("owner-1")).state_revision, 7);
  assert.deepEqual(await store.technicalAudit("owner-1"), []);
});

test("a stale compare-and-swap rejects the whole edit without field merge or loss of the newer current result", async () => {
  const { store } = await fixture();
  store.conflictNext = true;

  await assert.rejects(
    saveCurrentCampaignPairRevision(saveInput(store)),
    (error) => error instanceof CampaignPairEditError
      && error.code === "CAMPAIGN_PAIR_EDIT_STALE"
      && /no field merge/u.test(error.message),
  );

  const persisted = await store.loadCurrent("owner-1");
  assert.equal(persisted.state_revision, 8);
  assert.equal(persisted.pairs[0].draft_revision_id, "draft-a-r1");
  assert.equal(persisted.pairs[0].draft.campaign_name, "Выставка");
  assert.deepEqual(await store.technicalAudit("owner-1"), []);
});
