import { buildPublishProjection } from "./campaign-draft.ts";
import {
  CAMPAIGN_HYPOTHESIS_SCHEMA,
  compileCampaignCandidate,
  type CampaignDesignViolation,
} from "./campaign-design-agent.ts";
import {
  buildCampaignDesignContentContext,
  campaignDesignContentToolSchema,
  validateCampaignDesignContentProposal,
  type CampaignDesignContentProposal,
  type CampaignDesignContentProvenance,
} from "./campaign-design-content.ts";
import { buildLocalCampaignGenerationProjection } from "./campaign-generation-profile.ts";
import { buildCampaignGenerationContext, campaignGenerationPortfolioConstraints } from "./campaign-generation-context.ts";
import type { CampaignMeasurementInput } from "./campaign-measurement.ts";
import type { DirectCapabilitySnapshot } from "./campaign-fanout.ts";
import type { ProductionStageAgents, ProductionStageAgentResult } from "./production-stage-agents.ts";
import type { JsonValue } from "./p0-agent-runtime.ts";
import { pipelineDigest } from "./pipeline-orchestrator.ts";
import { PIPELINE_CAMPAIGN_PAIR_EDIT_CONTEXT_SCHEMA } from "./pipeline-current-products.ts";
import { assessSearchCoverage, searchCoverageGroups, searchCoverageSchema } from "./campaign-search-semantics.ts";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown) => typeof value === "string" ? value.trim() : "";
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
const strictText = (value: unknown, maximum: number) => typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
const exactKeys = (value: unknown, keys: string[]) => JSON.stringify(Object.keys(record(value)).sort()) === JSON.stringify([...keys].sort());

function measurementInput(state: Record<string, unknown>, snapshot: Record<string, unknown>, values: Record<string, unknown>): CampaignMeasurementInput {
  if (record(state.pipeline_evidence_replay).publication_freshness === "UNVERIFIED") return {};
  const scope = record(snapshot.scope);
  const counterId = string(scope.metrika_counter_id);
  const goalId = string(scope.metrika_goal_id);
  const readiness = record(state.measurement_destination_readiness);
  const assessment = record(record(readiness.measurement).goal_assessment);
  const destination = record(readiness.destination);
  const hasCurrentSource = list(snapshot.sources).map(record).some((source) => source.provenance_class === "METRIKA_OFFICIAL_API" && source.status === "VERIFIED");
  if (!counterId || !goalId || !hasCurrentSource
    || record(readiness.measurement).status !== "READY"
    || string(assessment.business_result) !== string(values.qualified_result)
    || string(record(assessment.selected_goal).goal_id) !== goalId
    || string(destination.requested_url) !== string(values.landing_page)) return {};
  const candidates = list(record(state.recommendation_set).drafts).map(record);
  const verified = candidates.find((draft) => draft.metrika_registration_test_status === "PASSED"
    && String(draft.metrika_counter_id) === counterId && String(draft.metrika_goal_id) === goalId
    && String(draft.metrika_registration_test_goal_id) === goalId
    && draft.measurement_readiness_id === readiness.readiness_id);
  if (!verified) return {};
  return {
    counter_id: verified.metrika_counter_id,
    primary_goal_id: verified.metrika_goal_id,
    readiness_id: verified.measurement_readiness_id,
    counter_binding_matched: verified.metrika_counter_binding_matched,
    goal_binding_matched: verified.metrika_goal_binding_matched,
    registration_test_status: verified.metrika_registration_test_status,
    registration_test_goal_id: verified.metrika_registration_test_goal_id,
    registration_tested_at: verified.metrika_registration_tested_at,
  };
}


export type CampaignPortfolioInput = Parameters<ProductionStageAgents["designCampaigns"]>[0] & {
  now: () => string;
  allowedEvidenceIds: string[];
  trustedBusinessValues: Record<string, unknown>;
};

export async function prepareCampaignPortfolio(input: CampaignPortfolioInput) {
  const { autonomousStrategy: strategy, evidenceSnapshot } = input;
  if (input.run.goal_formation.status !== "VERIFIED") throw new Error("Campaign Design requires the exact verified business goal.");
  const state = record(input.view.state);
  const replayAssessment = record(state.pipeline_evidence_replay);
  const values = Object.fromEntries(strategy.dimensions.map((dimension) => [dimension.dimension_id, dimension.value]));
  const rawCapability = record(record(record(state.context_state).facts).direct).capability_snapshot;
  const capability = replayAssessment.current_operational_readiness === "UNVERIFIED"
    ? null : string(record(rawCapability).snapshot_id) ? rawCapability as DirectCapabilitySnapshot : null;
  const generationContext = await buildCampaignGenerationContext({
    strategy, evidenceSnapshot, evaluatedAt: input.now(),
    goalRevision: input.run.goal_formation.revision, businessModel: record(state.business_model),
  });
  const limit = (name: string) => {
    const value = Number(list(capability?.restrictions).map(record).find((item) => item.element === name)?.value);
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  };
  const clusters = list(record(record(evidenceSnapshot.market_evidence).frequency).clusters).map(record);
  const constraints = campaignGenerationPortfolioConstraints(generationContext, {
    candidateCount: Math.max(1, clusters.length, generationContext.history.choices.length),
    accountGroupLimit: limit("ADGROUPS_TOTAL_PER_CAMPAIGN"),
    accountKeywordLimit: limit("KEYWORDS_TOTAL_PER_ADGROUP"),
  });
  // Groups organize supported intent under one budget; they are not independent experiments.
  const distinctDemand = new Set(clusters.filter((cluster) => ["AVAILABLE", "PARTIAL"].includes(String(cluster.status)) && list(cluster.assigned_row_ids).length > 0)
    .map((cluster) => string(cluster.cluster_id)).filter(Boolean)).size;
  const maxGroups = Math.min(constraints.resourceCaps.groupsPerCampaign, limit("ADGROUPS_TOTAL_PER_CAMPAIGN") ?? 20, Math.max(constraints.maxGroupsPerCampaign, distinctDemand));
  const baseline = buildPublishProjection({
    product: values.advertised_offer, audience: values.target_audience,
    qualified_result: values.qualified_result, value: values.core_message,
  }, { answers: strategy.dimensions.map((dimension) => ({ field_id: dimension.dimension_id, value: dimension.value })) }, {
    campaign_name: "Подготовка кампании", group_name: "Подготовка группы",
    keyword: "подготовка", negative_keywords: string(values.exclusions) || "неподтверждённое исключение",
    ad_title: "Подготовка объявления", ad_text: "Подготовка объявления",
    strategy_revision_id: strategy.strategy_revision_id,
    draft_id: "generation-input", draft_revision_id: "generation-input",
    campaign_hypothesis_id: "generation-input", campaign_hypothesis_revision_id: "generation-input",
    advertiser_account: capability?.account ?? "", currency: capability?.currency ?? "",
    capability_snapshot_id: capability?.snapshot_id ?? "",
  });
  const contentContext = buildCampaignDesignContentContext({
    strategy, projection: baseline, evidenceSnapshot,
    trustedBusinessValues: input.trustedBusinessValues,
    allowedEvidenceRefs: input.allowedEvidenceIds,
    keywordMaximum: Math.max(1, Math.min(200, constraints.maxKeywordsPerGroup, (limit("KEYWORDS_TOTAL_PER_ADGROUP") ?? 201) - 1)),
    supportedBiddingSelections: ["WB_MAXIMUM_CLICKS", "WB_MAXIMUM_CONVERSION_RATE"],
    maximumBidCeilingMicros: 0,
    requiredNegatives: [], minimumNegativeKeywords: 0,
  });
  const allowedRefs = [...new Set([
    input.evidence.revision_id, strategy.strategy_revision_id, ...input.allowedEvidenceIds,
    ...contentContext.sources.flatMap((source) => source.evidence_refs),
    ...generationContext.history.evidence_refs,
  ])];
  const allowedHosts = [new URL(String(values.landing_page)).hostname.toLowerCase()];
  const groupSchema = campaignDesignContentToolSchema(contentContext);
  const campaignSchema = {
    type: "object",
    properties: {
      weekly_budget_rub: { type: "integer", minimum: 1, maximum: constraints.totalWeeklyBudgetRub },
      mechanism: { type: "string", minLength: 1, maxLength: 2000 },
      primary_metric: { type: "string", enum: [String(values.qualified_result)] },
      baseline: { type: "string", minLength: 1, maxLength: 2000 },
      evidence_refs: { type: "array", minItems: 1, maxItems: 30, uniqueItems: true, items: { type: "string", enum: allowedRefs } },
      groups: { type: "array", minItems: 1, maxItems: maxGroups, items: groupSchema },
      rationale: { type: "string", minLength: 1, maxLength: 2000 },
    },
    required: ["weekly_budget_rub", "mechanism", "primary_metric", "baseline", "evidence_refs", "groups", "rationale"],
    additionalProperties: false,
  };
  const semanticGroups = searchCoverageGroups(contentContext.sources);
  const portfolioFields = ["campaigns", "selection_rationale", ...(semanticGroups.length ? ["semantic_review"] : [])];
  const toolSchema = {
    type: "object", properties: {
      campaigns: { type: "array", minItems: 1, maxItems: constraints.maxCampaigns, items: campaignSchema },
      selection_rationale: { type: "string", minLength: 1, maxLength: 3000 },
      ...(semanticGroups.length ? { semantic_review: searchCoverageSchema(semanticGroups) } : {}),
    }, required: portfolioFields, additionalProperties: false,
  };
  const measurement = measurementInput(state, evidenceSnapshot, values);
  return {
    strategy, evidenceSnapshot, values, capability, generationContext, constraints, maxGroups, baseline,
    contentContext, allowedRefs, allowedHosts, campaignSchema, portfolioFields, semanticGroups, toolSchema, measurement,
    context: json({
        strategy, business_goal: input.run.goal_formation.revision,
        evidence_interpretation: input.evidenceInterpretation ?? null,
        evidence_replay: Object.keys(replayAssessment).length ? replayAssessment : null,
        evidence_usage: Object.keys(replayAssessment).length
          ? "Dated historical planning only; preserve source timestamps and limits. Current account capability and measurement are unverified, so publication remains blocked."
          : "Current source collection with explicit source limitations.",
        generation_context: generationContext,
        content_context: contentContext,
        semantic_coverage_groups: semanticGroups,
        semantic_research_boundary: { corpus: "EXACT_SAVED_OBSERVATIONS", maximum_reconsiderations: 1, external_reads: false,
          unresolved_action: "KEEP_NEEDS_RESEARCH_AND_REQUIRE_A_NEW_EVIDENCE_COLLECTION", overlapping_counts_are_additive: false },
        portfolio_constraints: { ...constraints, maxGroupsPerCampaign: maxGroups },
        measurement: { available: Boolean(measurement.readiness_id), registration_status: measurement.registration_test_status ?? "NOT_RUN" },
        allowed_evidence_refs: allowedRefs,
        authority: { publication: false, spend: false, external_write: false },
    }),
  };
}

export async function compileCampaignPortfolio(input: CampaignPortfolioInput, proposal: unknown): Promise<ProductionStageAgentResult<Record<string, unknown>[]>> {
  const { strategy, values, capability, generationContext, constraints, maxGroups, baseline, contentContext,
    allowedRefs, allowedHosts, campaignSchema, portfolioFields, toolSchema, measurement } = await prepareCampaignPortfolio(input);
  const raw = record(proposal);
  const violations: CampaignDesignViolation[] = [];
  const invalid = () => { throw Object.assign(new Error("Кампании не прошли проверку."), { code: "CAMPAIGN_PORTFOLIO_INVALID", violations: structuredClone(violations) }); };
    const reject = (code: string, pointer: string, message: string) => violations.push({ source: "CAMPAIGN_DESIGN_AGENT", code, pointer, message });
    const campaigns = list(raw.campaigns).map(record);
    if (!exactKeys(raw, portfolioFields) || !strictText(raw.selection_rationale, 3000)
      || campaigns.length < 1 || campaigns.length > constraints.maxCampaigns) {
      reject("PORTFOLIO_SHAPE_INVALID", "/", "Return the complete bounded campaign portfolio and explain its chosen scale.");
    }
    const allocations = campaigns.map((campaign) => campaign.weekly_budget_rub);
    if (allocations.some((amount) => !Number.isSafeInteger(amount) || Number(amount) <= 0)
      || allocations.reduce<number>((sum, amount) => sum + Number(amount), 0) > Number(constraints.totalWeeklyBudgetRub)) {
      reject("PORTFOLIO_BUDGET_EXCEEDED", "/campaigns", "Campaign budgets must be positive integers whose sum fits the single Strategy weekly budget.");
    }
    const validCandidates: Array<{ raw: Record<string, unknown>; groups: CampaignDesignContentProposal[]; provenance: CampaignDesignContentProvenance[][] }> = [];
    const seenCampaigns = new Set<string>();
    for (const [index, campaign] of campaigns.entries()) {
      const pointer = `/campaigns/${index}`;
      if (!exactKeys(campaign, Object.keys(campaignSchema.properties))
        || !strictText(campaign.mechanism, 2000) || campaign.primary_metric !== values.qualified_result
        || !strictText(campaign.baseline, 2000) || !strictText(campaign.rationale, 2000)
        || !list(campaign.evidence_refs).length || list(campaign.evidence_refs).length > 30
        || list(campaign.evidence_refs).some((ref) => !allowedRefs.includes(String(ref)))) {
        reject("CAMPAIGN_HYPOTHESIS_INVALID", pointer, "Every campaign needs the exact qualified outcome, supported evidence, mechanism and comparison limits.");
      }
      const proposals = list(campaign.groups);
      if (proposals.length < 1 || proposals.length > maxGroups) reject("CAMPAIGN_GROUP_COUNT_INVALID", `${pointer}/groups`, "Select the supported number of distinct intent groups.");
      const groups: CampaignDesignContentProposal[] = [];
      const provenance: CampaignDesignContentProvenance[][] = [];
      for (const [groupIndex, proposal] of proposals.entries()) {
        const checked = validateCampaignDesignContentProposal({ proposal, context: contentContext });
        if (checked.status === "INVALID") violations.push(...checked.violations.map((violation) => ({ ...violation, pointer: `${pointer}/groups/${groupIndex}${violation.pointer ?? ""}` })));
        else if (checked.status === "STRATEGY_DEFECT") {
          for (const defect of checked.strategy_defect.defects) reject(defect.code, `${pointer}/groups/${groupIndex}`, defect.description);
        } else { groups.push(checked.proposal); provenance.push(checked.provenance); }
      }
      if (!groups.length || groups.length !== proposals.length) continue;
      if (groups.some((group) => group.campaign_name !== groups[0].campaign_name
        || group.bidding.selection !== groups[0].bidding.selection
        || group.bidding.bid_ceiling_micros !== groups[0].bidding.bid_ceiling_micros)) {
        reject("CAMPAIGN_SHARED_SETTINGS_CONFLICT", pointer, "All groups in a campaign share one campaign name and bidding decision.");
      }
      const intents = groups.map((group) => JSON.stringify(group.keywords.map((item) => item.text.toLocaleLowerCase("ru-RU")).sort()));
      if (new Set(intents).size !== intents.length) reject("DUPLICATE_INTENT_GROUP", `${pointer}/groups`, "Identical keyword groups are not distinct hypotheses.");
      const signature = JSON.stringify(groups.map((group) => ({ keywords: group.keywords.map((item) => item.text).sort(), titles: group.titles.map((item) => item.text), texts: group.texts.map((item) => item.text), landing: group.landing_url })));
      if (seenCampaigns.has(signature)) reject("DUPLICATE_CAMPAIGN_CONTENT", pointer, "A second identical campaign is not a distinct supported hypothesis.");
      seenCampaigns.add(signature);
      validCandidates.push({ raw: campaign, groups, provenance });
    }
    if (violations.length) invalid();
    const semantics = assessSearchCoverage({
      sources: contentContext.sources, admission: contentContext.demand_evidence.admission,
      observed: contentContext.demand_evidence.observed_sources,
      keywords: validCandidates.flatMap((candidate) => candidate.groups.flatMap((group) => group.keywords)),
      decisions: raw.semantic_review ?? [],
    });
    const semanticViolations = semantics.violations.map((violation) => ({ ...violation, source: "CAMPAIGN_DESIGN_AGENT" as const }));
    // Unresolved research remains explicit. Only Codex can decide how to repair a proposal.
    const invalidReview = semanticViolations.some((violation) => !["SEMANTIC_RESEARCH_REQUIRED", "SEMANTIC_CAPACITY_INCOMPLETE", "SEMANTIC_DEMAND_UNAVAILABLE"].includes(violation.code));
    if (invalidReview) {
      violations.push(...semanticViolations);
      invalid();
    }
    const pairs: Record<string, unknown>[] = [];
    for (const [index, candidate] of validCandidates.entries()) {
      const contentDigest = await pipelineDigest({ strategy: strategy.strategy_revision_id, context: generationContext.context_id, run: input.run.run_id, index, candidate: candidate.raw });
      const suffix = contentDigest.slice(7, 39);
      const hypothesisId = `campaign-hypothesis:${suffix}`;
      const draftId = `campaign-draft:${suffix}`;
      const base = structuredClone(baseline);
      base.lineage = { ...base.lineage, draft_id: draftId, draft_revision_id: `${draftId}:r1`, campaign_hypothesis_id: hypothesisId, campaign_hypothesis_revision_id: `${hypothesisId}:r1` };
      const first = candidate.groups[0];
      base.business = { ...base.business, product: first.offer.text, audience: first.audience.text, value: first.core_message.text };
      const projection = buildLocalCampaignGenerationProjection({
        baselineProjection: base, measurement,
        content: {
          campaign_name: first.campaign_name, allocated_weekly_budget_rub: Number(candidate.raw.weekly_budget_rub),
          bidding_strategy: first.bidding.selection, bid_ceiling_micros: first.bidding.bid_ceiling_micros,
          groups: candidate.groups.map((group, groupIndex) => ({
            name: group.group_name, keywords: group.keywords.map((item) => item.text), negative_keywords: group.negative_keywords.map((item) => item.text),
            titles: group.titles.map((item) => item.text), texts: group.texts.map((item) => item.text), landing_page: group.landing_url,
            evidence_refs: [...new Set(candidate.provenance[groupIndex].flatMap((item) => item.evidence_refs))],
          })),
        },
      });
      const pair = await compileCampaignCandidate({
        strategy, analytics_evidence: { snapshot_id: input.evidence.revision_id, evidence_ids: allowedRefs },
        confirmed_cost: { status: "UNAVAILABLE", evidence_ref: null }, capability_snapshot: capability,
        allowed_landing_hosts: allowedHosts, applicability_proofs: [],
        candidate: {
            hypothesis: {
              schema_version: CAMPAIGN_HYPOTHESIS_SCHEMA, hypothesis_revision_id: `${hypothesisId}:r1`, strategy_revision_id: strategy.strategy_revision_id,
              analytics_evidence_snapshot_id: input.evidence.revision_id, mechanism: string(candidate.raw.mechanism), primary_metric: string(candidate.raw.primary_metric),
              baseline: string(candidate.raw.baseline), evidence_refs: [...new Set(list(candidate.raw.evidence_refs).map(String))],
              authority: { publication: "NOT_AUTHORIZED", spend: "NOT_AUTHORIZED", performance_promise: false },
            }, projection,
        },
      });
      {
          const savedPair = structuredClone(pair);
          if (semantics.audit.status !== "REVIEWED" && "publication_readiness" in savedPair.draft) {
            const readiness = savedPair.draft.publication_readiness;
            savedPair.draft.publication_readiness = { ...readiness, blockers: [...readiness.blockers, {
              code: "SEMANTIC_COVERAGE_UNVERIFIED", message: "Семантика требует дополнительного исследования: покрытие целевых намерений не подтверждено.",
            }] };
          }
          pairs.push({
            ...savedPair,
            design: { ...pair.design, attempts: 1, repair_violations: [], content_provenance: candidate.provenance, selection_rationale: raw.selection_rationale, rationale: candidate.raw.rationale, generation_context: generationContext, evidence_interpretation: input.evidenceInterpretation ?? null,
              search_semantics: semantics.audit, semantic_draft_fingerprint: pair.draft.publish_fingerprint,
              semantic_reconsiderations: 0 },
            economics: { ...pair.economics, weekly_budget: Number(candidate.raw.weekly_budget_rub), strategy_weekly_budget: Number(values.weekly_budget) },
            edit_context: { schema_version: PIPELINE_CAMPAIGN_PAIR_EDIT_CONTEXT_SCHEMA, capability_snapshot: capability, allowed_landing_hosts: allowedHosts, applicability_proofs: [] },
          });
      }
    }
    if (violations.length || pairs.length !== campaigns.length) invalid();
    const artifact = { schema_version: "p0-compiled-campaign-pair-set-v1", pairs };
    const digest = await pipelineDigest(artifact);
    return {
      actor: { actor_id: "codex", actor_type: "AGENT", role: "SINGLE_CODEX" },
      output: { schema_version: artifact.schema_version, revision_id: `compiled-campaign-pair-set:${digest.slice(7, 39)}`, digest },
      artifact: pairs,
      evidence: [input.strategy, input.evidence, input.pairSet],
      check_id: "CAMPAIGN_DESIGN_CONTENT_AND_PORTFOLIO_VERIFIED",
      schema: { schema_version: "p0-campaign-design-portfolio-v1", revision_id: "1.0.0", digest: await pipelineDigest(toolSchema) },
      summary: string(raw.selection_rationale),
    };
}
