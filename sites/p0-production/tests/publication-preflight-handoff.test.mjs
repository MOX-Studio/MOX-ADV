import assert from "node:assert/strict";
import test from "node:test";

import { fingerprintDirectProjection } from "../lib/campaign-fanout.ts";
import {
  buildPublicationPreflightHandoff,
  futurePublicationDecisionApplies,
} from "../lib/publication-preflight-handoff.ts";

function projection(name) {
  return {
    creation_profile: {
      profile_id: "p0-campaign-creation-profile-v1",
      advertiser: { account: "moxstudio", currency: "RUB" },
    },
    brand_claims_contract: { status: "VERIFIED" },
    direct: {
      campaign: { Name: name },
      ad_group: { Name: "Основной спрос" },
      keyword: { Keyword: "выставка москва" },
      ad: { ResponsiveAd: { Titles: ["Участие в выставке"] } },
    },
  };
}

async function draft(revision, name) {
  const publishProjection = projection(name);
  return {
    draft_id: "draft-1",
    draft_revision_id: `draft-1-r${revision}`,
    publish_fingerprint: await fingerprintDirectProjection(publishProjection),
    publish_projection: publishProjection,
  };
}

function decision(publishFingerprint) {
  return {
    publish_fingerprint: publishFingerprint,
    capability_snapshot_id: "capability-after-handoff-1",
    preflight_id: "preflight-after-capability-1",
    human_decision_id: "human-decision-after-preflight-1",
  };
}

test("handoff delegates every publication concern without authority or provider identifiers", async () => {
  const handoff = await buildPublicationPreflightHandoff(await draft(1, "Выставка · заявки"));

  assert.equal(handoff.source_module, "BASE_CAMPAIGN_PIPELINE");
  assert.equal(handoff.target_module, "PUBLICATION_MODULE");
  assert.match(handoff.draft.publish_fingerprint, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(handoff.required_sequence, {
    capability_snapshot: {
      freshness: "COLLECT_AFTER_HANDOFF",
      exact_account_binding: true,
      produced_by: "PUBLICATION_MODULE",
    },
    preflight: {
      freshness: "RUN_AFTER_FRESH_CAPABILITY_SNAPSHOT",
      exact_publish_fingerprint: handoff.draft.publish_fingerprint,
      produced_by: "PUBLICATION_MODULE",
    },
    human_decision_gate: {
      timing: "AFTER_PREFLIGHT",
      exact_publish_fingerprint: handoff.draft.publish_fingerprint,
      reusable_after_draft_change: false,
      produced_by: "PUBLICATION_MODULE",
    },
  });
  assert.deepEqual(handoff.deferred_to_target_module, [
    "CAPABILITY_SNAPSHOT_REFRESH",
    "PREFLIGHT",
    "PUBLICATION",
    "MODERATION",
    "LAUNCH",
    "SPEND",
  ]);
  assert.deepEqual(handoff.base_pipeline_boundary, {
    external_write: "DENIED",
    publication_authority: "NOT_GRANTED",
    provider_identifiers: "ABSENT",
    moderation: "NOT_STARTED",
    launch: "NOT_STARTED",
    spend: "NOT_STARTED",
  });
  assert.deepEqual(handoff.provider_identifier_policy, {
    values: [],
    may_appear: "ONLY_IN_PUBLICATION_MODULE_AFTER_AUTHORIZED_WRITE",
  });
});

test("a material Draft edit changes the fingerprint and makes an old exact decision inapplicable", async () => {
  const original = await buildPublicationPreflightHandoff(await draft(1, "Выставка · заявки"));
  const oldDecision = decision(original.draft.publish_fingerprint);
  const edited = await buildPublicationPreflightHandoff(await draft(2, "Выставка · квалифицированные заявки"));

  assert.equal(futurePublicationDecisionApplies(original, oldDecision), true);
  assert.notEqual(edited.draft.publish_fingerprint, original.draft.publish_fingerprint);
  assert.equal(futurePublicationDecisionApplies(edited, oldDecision), false);
  assert.equal(futurePublicationDecisionApplies(edited, decision(edited.draft.publish_fingerprint)), true);
});

test("handoff rejects a stored fingerprint that is not the exact current projection", async () => {
  const stale = await draft(2, "Выставка · квалифицированные заявки");
  stale.publish_projection.direct.campaign.Name = "Изменено после fingerprint";

  await assert.rejects(
    buildPublicationPreflightHandoff(stale),
    /does not match the exact current projection/u,
  );
});
