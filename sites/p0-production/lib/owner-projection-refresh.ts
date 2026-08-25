import type { OwnerJourneyProjection } from "./p0-owner-journey.ts";

export function ownerProjectionNeedsRefresh(projection: OwnerJourneyProjection) {
  const ownerDecisionVisible = Boolean(
    projection.primaryAction
    || projection.goalInterview?.primaryAction
    || projection.packageDecision?.acceptHandle
    || projection.packageDecision?.rejectHandle,
  );
  if (ownerDecisionVisible) return false;
  const agentContinues = projection.agentActivity?.status === "working"
    || projection.agentActivity?.status === "waiting";
  const businessContinues = projection.businessOutcome.status === "working";
  return agentContinues || businessContinues;
}
