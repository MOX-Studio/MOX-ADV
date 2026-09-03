import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";

import { buildP0PackageSelectionAcceptanceArtifact } from "../lib/p0-package-selection-acceptance.ts";

const sourceUrl = new URL("./evidence/p0-viable-campaign-real-business.json", import.meta.url);
const goldenUrl = new URL("./evidence/p0-package-selection-acceptance.json", import.meta.url);
const source = JSON.parse(await readFile(sourceUrl, "utf8"));

async function artifact(value = source) {
  return buildP0PackageSelectionAcceptanceArtifact(structuredClone(value));
}

test("feature 242 reproduces the recommendation shortlist and preserves owner-only order", async () => {
  const value = await artifact();
  assert.equal(value.feature_issue, 242);
  assert.deepEqual(value.implemented_tasks, [287, 288]);
  assert.equal(value.status, "READY_FOR_OWNER_CHECKPOINT");

  const shortlist = value.task_287_shortlist_management;
  assert.equal(shortlist.recommended_shortlist.reproducible, true);
  assert.ok(shortlist.recommended_shortlist.campaigns.length >= 2);
  assert.equal(shortlist.owner_actions.after_exclusion.length, shortlist.owner_actions.initial_order.length - 1);
  assert.deepEqual(shortlist.owner_actions.after_positional_restore, shortlist.owner_actions.initial_order);
  assert.deepEqual(shortlist.owner_actions.after_reorder, [...shortlist.owner_actions.initial_order].reverse());
  assert.equal(shortlist.owner_order_stored_separately_from_draft_versions, true);
});

test("BLOCKED and stale Drafts fail closed before they can enter an exact package", async () => {
  const value = await artifact();
  const shortlist = value.task_287_shortlist_management;
  assert.equal(shortlist.blocked_draft.selection_rejected, true);
  assert.ok(shortlist.blocked_draft.reason.length > 0);
  assert.equal(shortlist.stale_action_rejected, true);
  assert.equal(value.task_288_exact_package_review.material_change_invalidated, true);
  assert.equal(value.task_288_exact_package_review.normalization_only_preserved, true);
});

test("owner review keeps exact composition, budget, periods, auction protocol and all nine preflight areas free of internal IDs", async () => {
  const value = await artifact();
  const packageProof = value.task_288_exact_package_review;
  const ownerReview = packageProof.owner_review;
  assert.equal(packageProof.exact_owner_order_preserved, true);
  assert.match(packageProof.mandatory_preflight_checked, /^\d\/9$/u);
  assert.ok(["PASS", "BLOCKED"].includes(packageProof.mandatory_preflight_status));
  assert.ok(["ALIGNED", "LIMITED_TEST"].includes(packageProof.budget_classification));
  assert.equal(ownerReview.mandatory_preflight.length, 9);
  assert.deepEqual(ownerReview.composition_and_order.map((campaign) => campaign.order),
    ownerReview.composition_and_order.map((_, index) => index + 1));
  for (const campaign of ownerReview.composition_and_order) {
    assert.ok(campaign.campaign);
    assert.ok(campaign.budget_rub > 0);
    assert.match(campaign.period.start, /^\d{4}-\d{2}-\d{2}$/u);
    assert.match(campaign.period.end, /^\d{4}-\d{2}-\d{2}$/u);
    assert.ok(campaign.auction_protocol.comparison);
    assert.ok(campaign.auction_protocol.tested_change);
    assert.ok(campaign.auction_protocol.bidding_strategy);
    assert.ok(campaign.auction_protocol.measured_result);
    assert.ok(campaign.auction_protocol.success_condition);
    assert.ok(campaign.auction_protocol.stop_condition);
  }
  const serialized = JSON.stringify(ownerReview).toLowerCase();
  for (const forbidden of ["draft_id", "revision_id", "package_id", "snapshot_id", "content_hash", "publish_fingerprint", "sha256:"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("feature acceptance remains read-only and leaves checkpoint 245 to the owner", async () => {
  const value = await artifact();
  assert.deepEqual(value.no_write_proof.provider_mutations, []);
  assert.equal(value.no_write_proof.external_write_calls, 0);
  assert.equal(value.no_write_proof.production_write_attempts, 0);
  assert.equal(value.no_write_proof.live_authority_issued, false);
  assert.equal(value.no_write_proof.impressions_started, 0);
  assert.equal(value.no_write_proof.spend_started_rub, 0);
  assert.equal(value.no_write_proof.browser_cabinets_used, false);
  assert.equal(value.human_checkpoint.issue, 245);
  assert.equal(value.human_checkpoint.verdict, "PENDING_HUMAN_VERDICT");
  assert.equal(value.human_checkpoint.implementation_may_claim_acceptance, false);
});

test("matches the checked-in package-selection acceptance artifact", async () => {
  const actual = await artifact();
  if (process.env.UPDATE_P0_PACKAGE_SELECTION_ACCEPTANCE === "1") {
    await writeFile(goldenUrl, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
  }
  const expected = JSON.parse(await readFile(goldenUrl, "utf8"));
  assert.deepEqual(actual, expected);
});
