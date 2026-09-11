import { compileCampaignCandidate, CAMPAIGN_HYPOTHESIS_SCHEMA } from "./campaign-design-agent.ts";
import { prepareCampaignPortfolio, type CampaignPortfolioInput } from "./pipeline-campaign-tools.ts";
import { FORMATION_PROFILE, FORMATION_PROJECTION_SCHEMA, formationDirectGraph, formationPortfolioSchema, verifyFormationPortfolio, type FormationBundle } from "./campaign-formation-portfolio.ts";
import { CAMPAIGN_FORMATION_METHOD, type FormationPlan, type FormationResearch } from "./campaign-formation-method.ts";
import type { LocalCampaignGenerationProjection } from "./campaign-generation-profile.ts";
import { pipelineDigest } from "./pipeline-orchestrator.ts";
import type { ProductionStageAgentResult } from "./production-stage-agents.ts";
import { PIPELINE_CAMPAIGN_PAIR_EDIT_CONTEXT_SCHEMA } from "./pipeline-current-products.ts";
import { DIRECT_PREPARATION_RULES } from "./direct-preparation-check.ts";

export async function prepareFormationPortfolio(input: CampaignPortfolioInput, plan: FormationPlan, research: FormationResearch, optimizationRequired = false, keywordRequired = false) {
  const prepared = await prepareCampaignPortfolio(input);
  return {
    ...prepared,
    context: { ...prepared.context, formation_plan: plan, formation_research: research, direct_preparation_rules: DIRECT_PREPARATION_RULES,
      content_context: { ...prepared.contentContext, limits: { titles: 7, texts: 3, keywords: 200, minimum_negative_keywords: 0 } },
      semantic_research_boundary: { source: "FROZEN_VERIFIED_SNAPSHOT", additional_research: "COLLECT_AND_IMPORT_UPDATED_EVIDENCE", unknown_frequency: null },
      portfolio_constraints: { campaignCount: "ALL_USEFUL_VIABLE_OPPORTUNITIES", campaignCountLimit: null, groupCountLimit: null, adCountLimit: null, maxKeywordsPerGroup: 200, limits_are_not_quotas: true },
    },
    toolSchema: formationPortfolioSchema(prepared.contentContext, prepared.allowedRefs, !!plan.goal_preparation, plan.goal_preparation?.version, optimizationRequired, keywordRequired || !!research.keyword_research),
  };
}

export async function compileFormationPortfolio(input: CampaignPortfolioInput, proposal: unknown, plan: FormationPlan, research: FormationResearch, optimizationRequired = false, keywordRequired = false): Promise<ProductionStageAgentResult<Record<string, unknown>[]>> {
  const prepared = await prepareFormationPortfolio(input, plan, research, optimizationRequired, keywordRequired);
  const portfolio = verifyFormationPortfolio({ proposal, plan, research, copy: prepared.contentContext, allowedRefs: prepared.allowedRefs, snapshot: input.evidenceSnapshot, checkTransfer: true, optimizationRequired, keywordRequired });
  const { values, strategy, capability } = prepared;
  const pairs: Record<string, unknown>[] = [];
  for (const campaign of portfolio.campaigns) {
    const direction = plan.directions.find(d => d.id === campaign.direction_id)!;
    const digest = await pipelineDigest({ run: input.run.run_id, strategy: input.strategy, research, plan, portfolio, campaign: campaign.id });
    const id = digest.slice(7, 39), hypothesisId = `campaign-hypothesis:${id}`, draftId = `campaign-draft:${id}`;
    const bundle: FormationBundle = { method: CAMPAIGN_FORMATION_METHOD, research, plan, portfolio, campaign_id: campaign.id };
    const baseline = structuredClone(prepared.baseline);
    baseline.lineage = { ...baseline.lineage, strategy_revision_id: strategy.strategy_revision_id,
      draft_id: draftId, draft_revision_id: `${draftId}:r1`, campaign_hypothesis_id: hypothesisId, campaign_hypothesis_revision_id: `${hypothesisId}:r1` };
    baseline.business = { ...baseline.business, audience: direction.audience, value: direction.message };
    const projection: LocalCampaignGenerationProjection = {
      ...baseline, schema_version: FORMATION_PROJECTION_SCHEMA, formation: structuredClone(bundle),
      creation_profile: { ...baseline.creation_profile, profile_id: FORMATION_PROFILE, profile_version: "1.0.0", delivery: campaign.channel, execution_support: "UNAVAILABLE", provider_mapping: "REQUIRED_BEFORE_PUBLICATION" },
      lineage: { ...baseline.lineage, capability_profile_id: FORMATION_PROFILE, capability_profile_version: "1.0.0" },
      safety: { must_end_non_serving: true, resume_allowed: false, network_serving: false },
      local_review: { publication: "UNAVAILABLE", external_write_implemented: false, strategy_weekly_budget_rub: Number(values.weekly_budget), allocated_weekly_budget_rub: campaign.weekly_budget_rub },
      direct: formationDirectGraph(bundle, values.period as { start_date: string; end_date: string }, String(values.geography)),
    };
    const refs = [...new Set(direction.finding_ids.flatMap(id => research.findings.find(f => f.id === id)?.evidence_refs ?? []))];
    const pair = await compileCampaignCandidate({ strategy, analytics_evidence: { snapshot_id: input.evidence.revision_id, evidence_ids: prepared.allowedRefs },
      confirmed_cost: { status: "UNAVAILABLE", evidence_ref: null }, capability_snapshot: capability, allowed_landing_hosts: prepared.allowedHosts, applicability_proofs: [],
      candidate: { projection, hypothesis: { schema_version: CAMPAIGN_HYPOTHESIS_SCHEMA, hypothesis_revision_id: `${hypothesisId}:r1`, strategy_revision_id: strategy.strategy_revision_id,
        analytics_evidence_snapshot_id: input.evidence.revision_id, mechanism: direction.intent + ". " + direction.message, primary_metric: String(values.qualified_result),
        baseline: research.mode === "TEST_SCENARIO" ? "Тестовый прогон. Фактические результаты рекламы не получены." : "Результаты нового содержания не измерены.",
        evidence_refs: refs.length ? refs : [input.evidence.revision_id], authority: { publication: "NOT_AUTHORIZED", spend: "NOT_AUTHORIZED", performance_promise: false } } },
    });
    pairs.push({ ...structuredClone(pair), design: { ...pair.design, methodology: CAMPAIGN_FORMATION_METHOD, selection_rationale: portfolio.selection_rationale, evidence_interpretation: input.evidenceInterpretation, formation_mode: research.mode },
      economics: { ...pair.economics, weekly_budget: campaign.weekly_budget_rub, strategy_weekly_budget: Number(values.weekly_budget) },
      edit_context: { schema_version: PIPELINE_CAMPAIGN_PAIR_EDIT_CONTEXT_SCHEMA, capability_snapshot: capability, allowed_landing_hosts: prepared.allowedHosts, applicability_proofs: [] },
    });
  }
  const digest = await pipelineDigest(pairs);
  return { actor: { actor_id: "codex", actor_type: "AGENT", role: "SINGLE_CODEX" },
    output: { schema_version: "p0-formation-pair-set-v1", revision_id: `formation-pair-set:${digest.slice(7, 39)}`, digest }, artifact: pairs,
    evidence: [input.strategy, input.evidence, input.pairSet], check_id: "FORMATION_RESEARCH_STRATEGY_CAMPAIGNS_VERIFIED",
    schema: { schema_version: "p0-formation-portfolio-v1", revision_id: "1.0.0", digest: await pipelineDigest(prepared.toolSchema) }, summary: portfolio.selection_rationale };
}
