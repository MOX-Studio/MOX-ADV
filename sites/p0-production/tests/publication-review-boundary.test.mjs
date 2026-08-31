import assert from "node:assert/strict";
import test from "node:test";

import {
  isPublicationReviewHandoff,
  projectPublicationReviewBoundary,
  publicationReviewAcceptsDraftEdit,
} from "../lib/publication-review-boundary.ts";

function pipeline() {
  return {
    status: "COMPLETED",
    currentStage: "review",
  };
}

function ownerProjection() {
  return {
    campaignOptions: [{
      editor: {
        publicationHandle: "draft-publication-v3",
        protocolHandle: "draft-protocol-v3",
      },
    }],
    packageSummary: { campaignCount: 1 },
    packageDecision: {
      acceptHandle: "approve-package-v3",
      rejectHandle: "reject-package-v3",
    },
    primaryAction: { handle: "prepare-package-v3" },
  };
}

test("publication review exposes current Draft edits without exposing a publication verdict", () => {
  const currentPipeline = pipeline();
  const current = ownerProjection();

  assert.equal(isPublicationReviewHandoff(currentPipeline), true);
  const projected = projectPublicationReviewBoundary(current, currentPipeline);
  assert.equal(projected.packageSummary, null);
  assert.equal(projected.packageDecision, null);
  assert.equal(projected.primaryAction, null);
  assert.equal(projected.campaignOptions, current.campaignOptions);

  assert.equal(publicationReviewAcceptsDraftEdit(current, { handle: "draft-publication-v3", values: {} }), true);
  assert.equal(publicationReviewAcceptsDraftEdit(current, { handle: "draft-protocol-v3", values: {} }), true);
  assert.equal(publicationReviewAcceptsDraftEdit(current, { handle: "approve-package-v3", values: {} }), false);
  assert.equal(publicationReviewAcceptsDraftEdit(current, { handle: "prepare-package-v3", values: {} }), false);
  assert.equal(publicationReviewAcceptsDraftEdit(current, { values: {} }), false);
});
