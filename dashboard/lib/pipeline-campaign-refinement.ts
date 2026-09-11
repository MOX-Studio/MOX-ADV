import { compilePipelineStageTask, preparePipelineStageTask, type PipelineStageTask } from "./pipeline-stage-tools.ts";
import { pipelineDigest } from "./pipeline-orchestrator.ts";
import { formationError, validateFormationShape } from "./campaign-formation-method.ts";
import { CAMPAIGN_REFINEMENT_VERSION, campaignDraftDigest, verifyCampaignCritique, verifyCampaignRevision, type CampaignCritique, type CampaignRefinementState } from "./campaign-refinement.ts";
import type { FormationPortfolio } from "./campaign-formation-portfolio.ts";

export type PipelineSubmission =
  | { kind: "PROGRESS"; refinement: CampaignRefinementState; summary: string }
  | { kind: "PRODUCT"; compiled: Awaited<ReturnType<typeof compilePipelineStageTask>>; portfolio?: FormationPortfolio; summary: string };

/** Workflow entry shared by the server and offline tools. Compilation alone cannot finalize a fresh draft. */
export async function evaluatePipelineSubmission(task: PipelineStageTask, candidate: unknown): Promise<PipelineSubmission> {
  const { input_digest: expected, ...body } = task;
  if (expected !== await pipelineDigest(body) || expected !== (await preparePipelineStageTask(task.source)).input_digest) throw new Error("Получите актуальные материалы этапа перед сохранением результата.");
  if (task.stage !== "CAMPAIGNS" || task.source.campaign_refinement_version !== CAMPAIGN_REFINEMENT_VERSION) {
    const compiled = await compilePipelineStageTask(task, candidate);
    return { kind: "PRODUCT", compiled, summary: compiled.summary, ...(task.stage === "CAMPAIGNS" ? { portfolio: candidate as FormationPortfolio } : {}) };
  }
  const state = task.source.campaign_refinement;
  if (state?.phase === "REVIEW") {
    const shape = validateFormationShape(task.output_schema, candidate);
    if (shape.length) formationError(shape);
    const critique = candidate as CampaignCritique;
    const violations = await verifyCampaignCritique(critique, state.draft, task.source.interpretation!.formation_research!);
    if (violations.length) formationError(violations);
    if (critique.recommendation === "REVISE") return { kind: "PROGRESS", summary: critique.summary, refinement: { ...structuredClone(state), phase: "REVISION", revision_request: structuredClone(critique), previous_reviews: [...state.previous_reviews, structuredClone(critique)] } };
    const portfolio: FormationPortfolio = { ...structuredClone(state.draft), refinement_review: { version: CAMPAIGN_REFINEMENT_VERSION, final_review: structuredClone(critique), previous_reviews: structuredClone(state.previous_reviews) } };
    // The critique has been validated against the frozen server draft above. Compile that draft, never a portfolio supplied in the critique.
    const compiled = await compilePipelineStageTask(task, portfolio);
    return { kind: "PRODUCT", compiled, portfolio, summary: critique.summary };
  }
  const portfolio = candidate as FormationPortfolio;
  if (portfolio?.refinement_review) formationError([{ code: "REFINEMENT_SELF_CERTIFIED", pointer: "/refinement_review", message: "Сначала сохраните проект. Итоговый разбор принимается отдельным следующим заданием." }]);
  await compilePipelineStageTask(task, candidate);
  if (state?.phase === "REVISION") {
    const violations = await verifyCampaignRevision(state, portfolio, task.source.strategy!.formation_plan!);
    if (violations.length) formationError(violations);
  }
  return { kind: "PROGRESS", summary: "Проект сохранён. Проведите критический разбор объявлений в следующем задании.",
    refinement: { phase: "REVIEW", round: state ? state.round + 1 : 1, draft: structuredClone(portfolio), draft_digest: await campaignDraftDigest(portfolio), previous_reviews: structuredClone(state?.previous_reviews ?? []), revision_request: null } };
}
