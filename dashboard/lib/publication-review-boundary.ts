import type { OwnerJourneyProjection } from "./p0-owner-journey.ts";
import type { OwnerPipelineProjection } from "./pipeline-owner-dashboard.ts";

export function isPublicationReviewHandoff(pipeline: OwnerPipelineProjection) {
  return pipeline.status === "COMPLETED" && pipeline.currentStage === "review";
}

/**
 * Keeps the post-run review separate from the legacy publication decision gate.
 * Draft editors remain visible, while no approval or package action is exposed.
 */
export function projectPublicationReviewBoundary(
  value: OwnerJourneyProjection,
  pipeline: OwnerPipelineProjection,
): OwnerJourneyProjection & { pipeline: OwnerPipelineProjection } {
  if (!isPublicationReviewHandoff(pipeline)) return { ...value, pipeline };
  return {
    ...value,
    pipeline,
    packageSummary: null,
    packageDecision: null,
    primaryAction: null,
  };
}

export function publicationReviewAcceptsDraftEdit(
  value: OwnerJourneyProjection,
  payload: Record<string, unknown>,
) {
  const handle = typeof payload.handle === "string" ? payload.handle : "";
  if (!handle) return false;
  return value.campaignOptions.some(({ editor }) =>
    editor.publicationHandle === handle || editor.protocolHandle === handle);
}
