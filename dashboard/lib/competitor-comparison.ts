import { competitorRankingMatchesEvidence } from "./competitor-ranking.ts";
import type { PipelineCompetitorAssessment } from "./pipeline-competitor-refresh.ts";
export const COMPETITOR_ASSESSMENT_SCHEMA = "p0-pipeline-competitor-assessment-v2";

export type CompetitorComparisonScope = {
  goal_revision_id: string;
  desired_outcome: string;
  qualified_action: string;
  advertised_offer: string;
  target_audience: string;
  geography: string;
  first_party_host: string;
  planning_deadline?: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

export function goalCompetitorComparisonScope(goalValue: unknown, modelValue: unknown, siteValue: unknown): CompetitorComparisonScope {
  const goal = record(goalValue);
  const model = record(modelValue);
  let host = "";
  try { host = new URL(text(record(siteValue).url)).hostname.toLowerCase().replace(/^www\./u, ""); } catch { /* Invalid scope is rejected by source collection. */ }
  return {
    goal_revision_id: text(goal.goal_revision_id),
    desired_outcome: text(goal.desired_outcome),
    qualified_action: text(goal.qualified_action),
    advertised_offer: text(model.product) || text(goal.desired_outcome),
    target_audience: text(model.audience),
    geography: text(goal.customer_geography) || text(model.geography),
    first_party_host: host,
    ...(text(record(goal.success_criterion).deadline) ? { planning_deadline: text(record(goal.success_criterion).deadline) } : {}),
  };
}

/** Bind competitive relevance to the current purchase, rather than a company name or industry. */
export function pipelineCompetitorComparisonScope(currentValue: unknown): CompetitorComparisonScope {
  const current = record(currentValue);
  const goal = record(current.goal_revision);
  const product = record(current.campaign_strategy);
  const strategy = record(product.strategy ?? product);
  const dimensions = Array.isArray(strategy.dimensions) ? strategy.dimensions.map(record) : [];
  const dimension = (id: string) => text(dimensions.find((item) => item.dimension_id === id)?.value);
  const snapshot = record(current.analytics_evidence_snapshot);
  const researchScope = record(record(record(snapshot.competitor_research).discovery).comparison_scope);
  // Full collection precedes Strategy. Keep its studied offer/audience anchored to
  // the Goal; a later Strategy paraphrase must not invalidate the source research.
  if (researchScope.goal_revision_id) {
    return {
      goal_revision_id: text(goal.goal_revision_id),
      desired_outcome: text(goal.desired_outcome),
      qualified_action: text(goal.qualified_action),
      advertised_offer: text(researchScope.advertised_offer),
      target_audience: text(researchScope.target_audience),
      geography: text(goal.customer_geography) || text(researchScope.geography),
      first_party_host: text(record(snapshot.scope).company_host).toLowerCase().replace(/^www\./u, ""),
      ...(Object.hasOwn(researchScope, "planning_deadline") ? { planning_deadline: text(record(goal.success_criterion).deadline) } : {}),
    };
  }
  return {
    goal_revision_id: text(goal.goal_revision_id),
    desired_outcome: text(goal.desired_outcome),
    qualified_action: text(goal.qualified_action),
    advertised_offer: dimension("advertised_offer") || dimension("campaign_focus") || text(goal.desired_outcome),
    target_audience: dimension("target_audience"),
    geography: dimension("geography"),
    first_party_host: text(record(record(current.analytics_evidence_snapshot).scope).company_host).toLowerCase().replace(/^www\./u, ""),
  };
}

export function competitorAssessmentMatchesScope(assessmentValue: unknown, scope: CompetitorComparisonScope | undefined) {
  const assessment = record(assessmentValue);
  if (!scope?.goal_revision_id || !scope.desired_outcome || !scope.advertised_offer
    || assessment.schema_version !== COMPETITOR_ASSESSMENT_SCHEMA
    || record(assessment.analyst).actor_type !== "AGENT"
    || record(assessment.analyst).role !== "EVIDENCE_ANALYST") return false;
  const saved = record(assessment.comparison_scope);
  return Object.keys(saved).length === Object.keys(scope).length
    && Object.entries(scope).every(([key, value]) => saved[key] === value);
}

export function isFirstPartyCompetitorUrl(value: unknown, scope: CompetitorComparisonScope) {
  if (!scope.first_party_host) return false;
  try {
    const host = new URL(text(value)).hostname.toLowerCase().replace(/^www\./u, "");
    return host === scope.first_party_host || host.endsWith(`.${scope.first_party_host}`);
  } catch {
    return false;
  }
}

/** Only assessed public offers may become competitor facts in the shared Snapshot. */
export function competitorResearchMatchesSnapshot(researchValue: unknown, goalValue: unknown, host: string, matrixValue: unknown) {
  const research = record(researchValue);
  const discovery = record(research.discovery);
  const assessment = record(research.assessment);
  const scope = record(discovery.comparison_scope) as CompetitorComparisonScope;
  const goal = record(goalValue);
  if (research.schema_version !== "p0-pipeline-competitor-research-v1"
    || discovery.schema_version !== "p0-competitor-discovery-v1"
    || scope.goal_revision_id !== goal.goal_revision_id
    || scope.desired_outcome !== text(goal.desired_outcome)
    || scope.qualified_action !== text(goal.qualified_action)
    || scope.geography !== text(goal.customer_geography)
    || scope.first_party_host !== host.toLowerCase().replace(/^www\./u, "")
    || (Object.hasOwn(scope, "planning_deadline") && scope.planning_deadline !== text(record(goal.success_criterion).deadline))
    || !competitorAssessmentMatchesScope(assessment, scope)) return false;
  const candidates = record(discovery.candidate_set).candidates;
  const relations = assessment.relations;
  if (!Array.isArray(candidates) || !candidates.length || !Array.isArray(relations) || candidates.length !== relations.length) return false;
  const names = new Set(candidates.map((item) => text(record(item).competitor)));
  if (names.size !== candidates.length || new Set(relations.map((item) => text(record(item).competitor))).size !== names.size) return false;
  const included = new Map<string, string>();
  for (const value of relations) {
    const relation = record(value);
    const name = text(relation.competitor);
    if (!names.has(name)) return false;
    if (["DIRECT_COMPETITOR", "SUBSTITUTE_COMPETITOR"].includes(text(relation.relation))) {
      const urls = record(candidates.find((item) => text(record(item).competitor) === name)).exact_destinations;
      if (!Array.isArray(urls) || !urls.includes(relation.evidence_url) || isFirstPartyCompetitorUrl(relation.evidence_url, scope)) return false;
      included.set(name, text(relation.evidence_url));
    } else if (!["NOT_COMPETITOR", "UNAVAILABLE"].includes(text(relation.relation))) return false;
  }
  const matrix = record(matrixValue);
  const admitted = record(matrix.candidate_set).candidates ?? [];
  const rows = matrix.rows ?? [];
  if (research.ranking && !competitorRankingMatchesEvidence(research.ranking, scope, candidates.map((item) => {
    const candidate = record(item);
    return { competitor: text(candidate.competitor), exact_destinations: Array.isArray(candidate.exact_destinations) ? candidate.exact_destinations.map(text) : [] };
  }), assessment as PipelineCompetitorAssessment)) return false;
  return Array.isArray(admitted) && Array.isArray(rows) && admitted.length === included.size && new Set(rows.map((item) => text(record(item).competitor))).size === included.size
    && admitted.every((item) => included.has(text(record(item).competitor)))
    && [...included].every(([name, url]) => rows.some((item) => text(record(item).competitor) === name && record(item).exact_landing === url))
    && rows.every((item) => {
      const row = record(item);
      const urls = record(candidates.find((candidate) => text(record(candidate).competitor) === text(row.competitor))).exact_destinations;
      return included.has(text(row.competitor)) && Array.isArray(urls) && urls.includes(row.exact_landing) && text(row.observed_offer_message);
    });
}
