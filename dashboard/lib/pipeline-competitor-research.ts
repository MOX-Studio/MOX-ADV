import type { BusinessModel, SiteAnalysis } from "./p0-application.ts";
import type { CompetitorDiscovery } from "./competitor-discovery.ts";
import type { ProductionStageAgents } from "./production-stage-agents.ts";
import type { CompetitorCandidateSet } from "./competitor-research.ts";
import {
  researchPipelineCompetitors,
  type PipelineCompetitorAssessment,
  type PipelineCompetitorEvidenceCollector,
} from "./pipeline-competitor-refresh.ts";
import { goalCompetitorComparisonScope } from "./competitor-comparison.ts";
import type { CompetitorRanking } from "./competitor-ranking.ts";

export type PipelineCompetitorResearch = {
  schema_version: "p0-pipeline-competitor-research-v1";
  discovery: CompetitorDiscovery;
  assessment: PipelineCompetitorAssessment;
  ranking?: CompetitorRanking | null;
};

/** A fresh Goal-scoped source read; previous candidates are diagnostic context only. */
export async function collectPipelineCompetitorResearch(input: {
  ownerKey: string;
  model: BusinessModel;
  site: SiteAnalysis;
  generatedAt: string;
  candidateSet?: Record<string, unknown>;
  signal?: AbortSignal;
}, dependencies: {
  agents: Pick<ProductionStageAgents, "discoverCompetitorCandidates" | "assessCompetitorEvidence"> & Partial<Pick<ProductionStageAgents, "rankCompetitorEvidence">>;
  collector: PipelineCompetitorEvidenceCollector;
}) {
  const goal = input.model.goal_research_scope;
  if (!goal) throw new Error("Полный поиск конкурентов требует текущую проверенную Цель.");
  const comparisonScope = goalCompetitorComparisonScope(goal, input.model, input.site);
  const result = await researchPipelineCompetitors({
    comparisonScope,
    collectionInput: {
      ...input,
      candidateSet: input.candidateSet?.schema_version === "p0-bounded-competitor-research-v1"
        ? input.candidateSet as CompetitorCandidateSet : null,
    },
    discoverer: dependencies.agents.discoverCompetitorCandidates,
    analyst: dependencies.agents.assessCompetitorEvidence,
    rankingAgent: dependencies.agents.rankCompetitorEvidence,
    collector: dependencies.collector,
  });
  if (!result.discovery) throw new Error("Полный сбор сведений не выполнил поиск конкурентов.");
  const candidateSet = result.competitorMatrix.candidate_set as CompetitorCandidateSet;
  return {
    // Empty verified scope stays empty; old candidates never reappear downstream.
    competitor_candidate_set: candidateSet.candidates.length ? candidateSet : {},
    competitor_observations: result.competitorObservations,
    competitor_research: {
      schema_version: "p0-pipeline-competitor-research-v1",
      discovery: result.discovery,
      assessment: result.assessment,
      ranking: result.ranking,
    } satisfies PipelineCompetitorResearch,
  };
}
