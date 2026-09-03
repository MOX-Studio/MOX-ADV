import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuctionProtocol,
  reviseAuctionProtocol,
  verifyAuctionProtocol,
} from "../lib/auction-protocol.ts";

function draft(overrides = {}) {
  return {
    draft_id: "draft-control",
    draft_revision_id: "draft-control-r1",
    strategy_revision_id: "strategy-r1",
    variant: { kind: "CONTROL", comparator_draft_id: null },
    treatment_delta: null,
    publish_projection: {
      creation_profile: { autotargeting_policy: { mode: "EXPLICIT_KEYWORDS_ONLY", selected: false } },
      direct: {
        campaign: {
          StartDate: "2026-09-01",
          EndDate: "2026-09-30",
          UnifiedCampaign: { BiddingStrategy: { Search: { BiddingStrategyType: "WB_MAXIMUM_CLICKS", WbMaximumClicks: { WeeklySpendLimit: 50_000_000_000, BidCeiling: 500_000_000 } } } },
        },
        keyword: { Keyword: "участие в выставке" },
      },
    },
    ...overrides,
  };
}

test("auction preregistration freezes every bounded hypothesis field and separates assumptions from provider facts", async () => {
  const protocol = await buildAuctionProtocol({
    draft: draft(),
    measurementGoal: "Квалифицированная заявка на участие",
    evidenceSnapshotId: "evidence-snapshot-1",
    registeredAt: "2026-08-21T10:00:00.000Z",
  });

  assert.equal(protocol.schema_version, "p0-auction-protocol-v1");
  assert.equal(protocol.control, "Текущая подтверждённая поисковая формулировка");
  assert.equal(protocol.tested_change, "Контроль без дополнительного изменения");
  assert.equal(protocol.bidding.strategy, "Максимум переходов в недельном бюджете");
  assert.equal(protocol.bidding.ceiling_rub, 500);
  assert.equal(protocol.query_matching, "Широкое соответствие заданной фразе");
  assert.equal(protocol.autotargeting_policy, "Только заданные ключевые фразы; автотаргетинг выключен");
  assert.deepEqual(protocol.traffic_split, { comparator_percent: 100, treatment_percent: 0 });
  assert.equal(protocol.test_budget_rub, 50_000);
  assert.deepEqual(protocol.test_period, { start_date: "2026-09-01", end_date: "2026-09-30" });
  assert.equal(protocol.measurement_goal, "Квалифицированная заявка на участие");
  assert.ok(protocol.success_threshold.length > 0);
  assert.ok(protocol.stop_condition.length > 0);
  assert.equal(protocol.attribution.status, "COMPARATOR_ONLY");
  assert.equal(protocol.knowledge_status, "PREREGISTERED_HYPOTHESIS_NOT_PROVIDER_FACT");
  assert.equal(protocol.provider_facts.source, "FROZEN_DRAFT_PROJECTION");
  assert.equal(protocol.test_assumptions.source, "OWNER_REVIEWED_HYPOTHESIS");
  assert.equal(protocol.p1_lineage.protocol_revision_id, protocol.protocol_revision_id);
  assert.match(protocol.content_hash, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(await verifyAuctionProtocol(protocol, draft()), true);
});

test("one-factor attribution is derived only from exactly one material family and all other hypotheses remain honest", async () => {
  const oneFactorDraft = draft({
    draft_id: "draft-treatment",
    draft_revision_id: "draft-treatment-r1",
    variant: { kind: "IMPROVEMENT", comparator_draft_id: "draft-control" },
    treatment_delta: {
      comparator_draft_id: "draft-control",
      changed_family: "QUALIFIED_ACTION",
      changed_fields: ["/direct/ad/ResponsiveAd/Texts"],
      expected_changed_fields: ["/direct/ad/ResponsiveAd/Texts"],
      material: true,
      exactly_one_hypothesis_family: true,
    },
  });
  const oneFactor = await buildAuctionProtocol({ draft: oneFactorDraft, measurementGoal: "Заявка", evidenceSnapshotId: "evidence-1", registeredAt: "2026-08-21T10:00:00.000Z" });
  assert.equal(oneFactor.attribution.status, "ONE_FACTOR");
  assert.deepEqual(oneFactor.attribution.material_families, ["QUALIFIED_ACTION"]);

  const multi = await buildAuctionProtocol({
    draft: { ...oneFactorDraft, treatment_delta: { ...oneFactorDraft.treatment_delta, exactly_one_hypothesis_family: false, changed_family: "MULTIPLE", changed_fields: ["/a", "/b"] } },
    measurementGoal: "Заявка",
    evidenceSnapshotId: "evidence-1",
    registeredAt: "2026-08-21T10:00:00.000Z",
  });
  assert.equal(multi.attribution.status, "MULTI_FACTOR");
  assert.equal(multi.attribution.one_factor_claim_allowed, false);
});

test("normalization-only owner edits are no-op while material edits create a content-addressed protocol revision", async () => {
  const sourceDraft = draft();
  const protocol = await buildAuctionProtocol({ draft: sourceDraft, measurementGoal: "Заявка", evidenceSnapshotId: "evidence-1", registeredAt: "2026-08-21T10:00:00.000Z" });
  const noOp = await reviseAuctionProtocol({
    previous: protocol,
    draft: sourceDraft,
    values: { ...protocol, control: `  ${protocol.control.replaceAll(" ", "   ")}  ` },
    registeredAt: "2026-08-21T10:01:00.000Z",
  });
  assert.equal(noOp.material_change, false);
  assert.equal(noOp.protocol.protocol_revision_id, protocol.protocol_revision_id);
  assert.equal(noOp.protocol.content_hash, protocol.content_hash);

  const changed = await reviseAuctionProtocol({
    previous: protocol,
    draft: { ...sourceDraft, draft_revision_id: "draft-control-r2" },
    values: { ...protocol, test_budget_rub: 45_000 },
    registeredAt: "2026-08-21T10:02:00.000Z",
  });
  assert.equal(changed.material_change, true);
  assert.notEqual(changed.protocol.protocol_revision_id, protocol.protocol_revision_id);
  assert.equal(changed.protocol.draft_revision_id, "draft-control-r2");
  assert.equal(changed.protocol.previous_protocol_revision_id, protocol.protocol_revision_id);
  assert.equal(await verifyAuctionProtocol(changed.protocol, { ...sourceDraft, draft_revision_id: "draft-control-r2" }), true);
});

test("protocol tampering and provider/model-shaped additions fail closed", async () => {
  const sourceDraft = draft();
  const protocol = await buildAuctionProtocol({ draft: sourceDraft, measurementGoal: "Заявка", evidenceSnapshotId: "evidence-1", registeredAt: "2026-08-21T10:00:00.000Z" });
  assert.equal(await verifyAuctionProtocol({ ...protocol, stop_condition: "Поставщик изменил правило после approval" }, sourceDraft), false);
  assert.equal(await verifyAuctionProtocol({ ...protocol, provider_campaign_id: "forbidden" }, sourceDraft), false);
});
