// Shared deterministic input preparation. No model calls or autonomous stage execution.
import { buildFindingsReport } from "./findings-research.ts";
import { CAMPAIGN_STRATEGY_DIMENSIONS, sealCampaignStrategyAgentArtifact, type CampaignStrategyAgentInput, type CampaignStrategyAgentProposal, type CampaignStrategyEvidenceRef } from "./campaign-strategy-agent.ts";
import { canonicalizeEvidence, redactSensitiveEvidenceText } from "./analytics-evidence.ts";
import { strategyAnswerValue } from "./campaign-strategy.ts";
import { goalResultCostCeiling, type GoalRevision } from "./goal-revision.ts";
import { readP0CuratedPlaybookV1 } from "./p0-curated-playbook-v1.ts";
import { campaignPlaybookStrategyRevisionId, PLAYBOOK_STRATEGY_SNAPSHOT_SCHEMA, type CampaignPlaybookStrategySnapshot } from "./campaign-playbook-governance.ts";
import { pipelineDigest, type PipelineVersionReference } from "./pipeline-orchestrator.ts";
import { buildCampaignStrategyGroundingCatalog } from "./campaign-design-content.ts";
import type { ProductionHistoricalView, ProductionEvidenceInterpretation } from "./production-stage-agents.ts";

const jsonValue = (value: unknown) => JSON.parse(JSON.stringify(value));

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, maximum = 2_000) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, maximum);
}


export function evidenceIndex(snapshot: Record<string, unknown>) {
  const ids = new Set<string>();
  for (const source of list(snapshot.sources).map(record)) {
    const id = text(source.source_id || source.manifest_id || source.source_manifest_id, 255);
    if (id) ids.add(id);
  }
  for (const evidence of [...list(snapshot.evidence), ...list(snapshot.evidence_records)].map(record)) {
    const id = text(evidence.evidence_id || evidence.record_id, 255);
    if (id) ids.add(id);
  }
  for (const claim of list(snapshot.claims).map(record)) {
    const id = text(claim.claim_id || claim.evidence_id, 255);
    if (id) ids.add(id);
  }
  const snapshotId = text(snapshot.snapshot_id || snapshot.revision_id, 255);
  if (snapshotId) ids.add(snapshotId);
  for (const material of list(record(snapshot.business_research).supporting_materials).map(record)) if (text(material.id)) ids.add(text(material.id, 255));
  return [...ids];
}

function stageEvidenceValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return null;
  if (typeof value === "string") return redactSensitiveEvidenceText(value, 1_500);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => stageEvidenceValue(item, depth + 1));
  return Object.fromEntries(Object.entries(record(value))
    .filter(([key]) => !/^(?:raw|provider_metadata|token|secret|password|email|phone|client_id|client_login)$/iu.test(key))
    .slice(0, 50).map(([key, item]) => [key, stageEvidenceValue(item, depth + 1)]));
}

export function evidenceProjection(snapshot: Record<string, unknown>) {
  const competitorNames = new Set(list(record(record(snapshot.competitor_matrix).candidate_set).candidates)
    .map((item) => text(record(item).competitor, 200)));
  const competitorAssessment = record(record(snapshot.competitor_research).assessment);
  const competitorRanking = record(record(snapshot.competitor_research).ranking);
  const observations = [...list(snapshot.evidence), ...list(snapshot.evidence_records)].map(record);
  const selected = observations.slice(0, 100);
  const claims = list(snapshot.claims).map(record).slice(0, 100);
  const gapCatalog = list(snapshot.gaps).slice(0, 100).map((item) => ({
    gap_id: text(record(item).gap_id, 255),
    description: text(record(item).description || record(item).message || item, 500),
  })).filter((item) => item.gap_id);
  return {
    schema_version: text(snapshot.schema_version, 255),
    snapshot_id: text(snapshot.snapshot_id || snapshot.revision_id, 255),
    evidence_ids: [...new Set([
      text(snapshot.snapshot_id || snapshot.revision_id, 255),
      ...selected.map((item) => text(item.evidence_id || item.record_id, 255)),
      ...claims.map((item) => text(item.claim_id || item.evidence_id, 255)),
      ...list(snapshot.sources).slice(0, 100).map((item) => text(record(item).source_id || record(item).manifest_id, 255)),
    ].filter(Boolean))],
    sources: list(snapshot.sources).slice(0, 100).map((item) => {
      const source = record(item);
      return {
        source_id: text(source.source_id || source.manifest_id, 255),
        source_kind: text(source.source_kind || source.kind, 255),
        status: text(source.status, 100),
        observed_at: text(source.observed_at || source.collected_at, 100),
        limitation: text(source.limitation, 500),
      };
    }),
    observations: selected.map((item) => ({
      evidence_id: text(item.evidence_id || item.record_id, 255),
      source_kind: text(item.source_kind, 255),
      observed_at: text(item.observed_at, 100),
      value: stageEvidenceValue(item.normalized),
      scope: stageEvidenceValue(item.scope),
      limitations: stageEvidenceValue(item.limitations),
      quality_flags: stageEvidenceValue(item.quality_flags),
    })),
    claims: claims.map((item) => ({
      claim_id: text(item.claim_id, 255),
      subject: text(item.subject, 255),
      predicate: text(item.predicate, 255),
      value: stageEvidenceValue(item.normalized ?? item.value),
      classification: text(item.classification, 100),
      evidence_ids: list(item.evidence_ids).map((value) => text(value, 255)),
      confidence: stageEvidenceValue(item.confidence),
    })),
    product_catalog: stageEvidenceValue(snapshot.product_catalog),
    competitor_matrix: stageEvidenceValue(snapshot.competitor_matrix),
    competitor_ranking: stageEvidenceValue({ method: competitorRanking.method, coverage: competitorRanking.coverage,
      candidates: list(competitorRanking.candidates).slice(0, 5) }),
    competitor_assessment: stageEvidenceValue({
      ...competitorAssessment,
      relations: list(competitorAssessment.relations).filter((item) => competitorNames.has(text(record(item).competitor, 200))),
    }),
    market_evidence: stageEvidenceValue(snapshot.market_evidence),
    first_party_history: stageEvidenceValue(snapshot.first_party_history),
    findings_report: jsonValue(buildFindingsReport(snapshot)),
    business_research: snapshot.business_research ? jsonValue({ ...record(snapshot.business_research), sources: undefined }) : null,
    omitted_observations: Math.max(0, observations.length - selected.length),
    gap_ids: [...new Set(gapCatalog.map((item) => item.gap_id))],
    gap_catalog: gapCatalog,
    gaps: list(snapshot.gaps).slice(0, 100).map((item) => text(record(item).description || record(item).message || item, 500)),
  };
}


function strategyValues(strategy: Record<string, unknown>) {
  return Object.fromEntries(CAMPAIGN_STRATEGY_DIMENSIONS.map((dimensionId) => {
    let value = strategyAnswerValue(strategy, dimensionId);
    if (dimensionId === "campaign_focus" && !text(value)) value = strategyAnswerValue(strategy, "advertised_offer");
    if (dimensionId === "weekly_budget") value = Number(value);
    if (dimensionId === "target_result_cost") value = value === null || value === undefined || value === "" ? null : Number(value);
    return [dimensionId, value];
  }));
}

export function strategyPlanningInput(view: ProductionHistoricalView, goal: GoalRevision, freshFormation = false) {
  const state = record(view.state);
  const previous = record(state.current_pipeline_strategy);
  const currentStrategy = record(previous.strategy ?? previous);
  const previousDimensions = list(currentStrategy.dimensions).map(record);
  const suggested = previousDimensions.length
    ? Object.fromEntries(previousDimensions.map((item) => [String(item.dimension_id), item.value]))
    : strategyValues(record(state.strategy));
  const locked: Record<string, unknown> = {};
  for (const dimension of ["weekly_budget", "geography", "period"] as const) {
    if (dimension === "period") {
      const period = record(suggested.period);
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(period.start_date))
        || !/^\d{4}-\d{2}-\d{2}$/u.test(String(period.end_date))
        || !Number.isFinite(Date.parse(String(period.start_date)))
        || !Number.isFinite(Date.parse(String(period.end_date)))
        || String(period.start_date) > String(period.end_date)) continue;
    }
    if (!freshFormation && hasPriorityMaterialValue(suggested[dimension])) locked[dimension] = structuredClone(suggested[dimension]);
  }
  const model = record(state.business_model);
  for (const [field, dimension] of Object.entries({ product: "advertised_offer", audience: "target_audience", value: "core_message", exclusions: "exclusions" })) {
    const source = record(record(model.field_evidence)[field]);
    if ((source.owner_edited === true || source.owner_confirmed === true) && hasPriorityMaterialValue(model[field])) {
      locked[dimension] = structuredClone(model[field]);
    }
  }
  const applyCorrections = (value: Record<string, unknown>, depth = 0) => {
    if (depth > 20) throw new Error("Strategy correction lineage exceeds the supported revision depth.");
    const base = record(record(value.base_business_input).content);
    if (Object.keys(base).length) applyCorrections(base, depth + 1);
    for (const [key, previous] of Object.entries(record(value.locked_business_constraints))) {
      if (!freshFormation && CAMPAIGN_STRATEGY_DIMENSIONS.includes(key as typeof CAMPAIGN_STRATEGY_DIMENSIONS[number])) locked[key] = structuredClone(previous);
    }
    const correction = record(value.owner_strategy_correction);
    if (correction.precedence === "PRIORITY_BUSINESS_INPUT") {
      for (const [key, value] of Object.entries(record(correction.changes))) {
        if (CAMPAIGN_STRATEGY_DIMENSIONS.includes(key as typeof CAMPAIGN_STRATEGY_DIMENSIONS[number])) locked[key] = structuredClone(value);
      }
    }
  };
  applyCorrections(record(record(record(previous.inputs).business_input).content));
  locked.business_goal = goal.desired_outcome;
  locked.qualified_result = goal.qualified_action;
  if (freshFormation) locked.geography = goal.customer_geography;
  const period = record(locked.period);
  if (goal.success_criterion?.deadline && text(period.end_date) > goal.success_criterion.deadline) {
    locked.period = { ...period, end_date: goal.success_criterion.deadline };
  }
  const target = Number(suggested.target_result_cost);
  const maximum = goalResultCostCeiling(goal.success_criterion);
  if (goal.success_criterion?.metric && maximum === null) {
    suggested.target_result_cost = null;
    locked.target_result_cost = null;
  }
  if (maximum) {
    suggested.target_result_cost = target > 0 && target <= maximum ? target : Math.floor(maximum) || null;
    if (Number(locked.target_result_cost) > maximum) locked.target_result_cost = Math.floor(maximum) || null;
  }
  return { suggested: { ...suggested, ...locked }, locked };
}

export async function playbookSnapshot(): Promise<CampaignPlaybookStrategySnapshot> {
  const release = readP0CuratedPlaybookV1();
  const attestation = release.approval_attestation;
  if (!attestation) throw new Error("Strategy Agent requires an exact curated Playbook approval attestation.");
  const snapshot: CampaignPlaybookStrategySnapshot = {
    schema_version: PLAYBOOK_STRATEGY_SNAPSHOT_SCHEMA,
    status: "ACTIVE_APPROVED",
    release: {
      release_id: release.release_id,
      release_version: release.release_version,
      content_digest: release.content_digest,
    },
    promotion_policy: structuredClone(release.promotion_policy),
    activation_decision: {
      decision_id: attestation.decision_id,
      content_digest: await pipelineDigest(attestation),
    },
    steward_delegation: {
      delegation_id: attestation.actor_id.replace(/[^A-Za-z0-9:._-]/gu, "-"),
      delegation_version: "1.0.0",
      content_digest: await pipelineDigest({
        actor_id: attestation.actor_id,
        actor_role: attestation.actor_role,
        approved_at: attestation.approved_at,
      }),
    },
    applicable_rules: release.rules.map((rule) => ({
      rule_id: rule.rule_id,
      rule_version: rule.rule_version,
      content_digest: rule.content_digest,
      changed_family: rule.changed_family,
      mechanism: rule.mechanism,
      changed_fields: structuredClone(rule.changed_fields),
      assessment_id: `curated-assessment-${rule.rule_id}`.slice(0, 255),
      assessment_digest: rule.content_digest,
    })),
    authority: {
      evidence_override: false,
      mandate_grant: false,
      campaign_execution: false,
      campaign_publication: false,
      spend: false,
    },
  };
  return snapshot;
}

export async function strategyInputs(
  view: ProductionHistoricalView,
  goal: PipelineVersionReference,
  goalRevision: GoalRevision,
  evidence: PipelineVersionReference,
  evidenceSnapshot: Record<string, unknown>,
  loadPlaybook: () => Promise<CampaignPlaybookStrategySnapshot>,
  interpretation?: ProductionEvidenceInterpretation,
  freshFormation = false,
  outcomeAware = false,
): Promise<CampaignStrategyAgentInput> {
  const state = record(view.state);
  const businessInput = {
    owner_goal_interview: state.owner_goal_interview ?? null,
    business_model: state.business_model ?? null,
    product_focus: state.product_focus ?? null,
    previous_strategy_recommendations: strategyPlanningInput(view, goalRevision, freshFormation).suggested,
    locked_business_constraints: strategyPlanningInput(view, goalRevision, freshFormation).locked,
  };
  const groundingCatalog = buildCampaignStrategyGroundingCatalog({ trustedBusinessValues: strategyPlanningInput(view, goalRevision, freshFormation).locked, evidenceSnapshot });
  const snapshot = { ...evidenceProjection(evidenceSnapshot), grounding_catalog: groundingCatalog, interpretation: interpretation ? structuredClone(interpretation) : null };
  const measurementReferences = outcomeAware ? interpretation?.formation_research?.goal_requirements?.measurements
    .map((m, index) => ({ evidence_id: m.source_ref, path: `/interpretation/formation_research/goal_requirements/measurements/${index}` }))
    .filter(m => m.evidence_id !== "analytics_snapshot" && !groundingCatalog.sources.some(s => s.source_ref === m.evidence_id)) ?? [] : [];
  const uniqueMeasurementReferences = [...new Map(measurementReferences.map(reference => [reference.evidence_id, reference])).values()];
  const playbook = await loadPlaybook();
  const artifact = async (
    kind: Parameters<typeof sealCampaignStrategyAgentArtifact>[0]["kind"],
    revisionId: string,
    evidenceId: string,
    content: Record<string, unknown>,
    additionalEvidence: Array<{ evidence_id: string; path: string }> = [],
  ) => sealCampaignStrategyAgentArtifact({
    kind,
    schema_version: `${kind.toLowerCase().replaceAll("_", "-")}-v1`,
    revision_id: revisionId,
    evidence: [{ evidence_id: evidenceId, path: `/${evidenceId}` }, ...additionalEvidence],
    content,
  });
  return {
    schema_version: "p0-campaign-strategy-agent-input-v1",
    goal_revision: await artifact("GOAL_REVISION", goal.revision_id, "goal_revision", structuredClone(goalRevision) as unknown as Record<string, unknown>),
    business_input: await artifact("BUSINESS_INPUT", `business-input:${view.revision}`, "business_input", businessInput),
    analytics_evidence_snapshot: await artifact("ANALYTICS_EVIDENCE_SNAPSHOT", evidence.revision_id, "analytics_snapshot", snapshot,
      [...groundingCatalog.sources.map((source, index) => ({ evidence_id: source.source_ref, path: `/grounding_catalog/sources/${index}` })), ...uniqueMeasurementReferences]),
    policies: [await artifact("MANDATORY_POLICY", "p0-no-external-write-policy:1.0.0", "mandatory_policy", {
      policy_id: "p0-no-external-write-policy",
      policy_version: "1.0.0",
      status: "MANDATORY",
      external_write: "DENIED",
      publication: "NOT_AUTHORIZED",
      spend: "NOT_AUTHORIZED",
    })],
    supported_draft_profile: await artifact("SUPPORTED_DRAFT_PROFILE", freshFormation ? "campaign-formation-local-v1:1.0.0" : "campaign-generation-search-local-v1:1.0.0", "supported_profile", freshFormation ? {
      profile_id: "campaign-formation-local-v1", profile_version: "1.0.0", status: "SUPPORTED",
      placements: ["SEARCH", "NETWORK", "RETARGETING"], content_preparation: "COMPLETE_LINKED_LOCAL_PLAN",
      publication: "UNAVAILABLE", provider_mapping: "REQUIRED_BEFORE_PUBLICATION", method: "evidence-to-campaign-v1",
    } : {
      profile_id: "campaign-generation-search-local-v1",
      profile_version: "1.0.0",
      status: "SUPPORTED",
      campaign_type: "UNIFIED_CAMPAIGN",
      placement: "SEARCH",
      bidding: ["WB_MAXIMUM_CLICKS", "WB_MAXIMUM_CONVERSION_RATE"],
      publication: "UNAVAILABLE",
      content_preparation: "SUPPORTED",
    }),
    campaign_playbook: await artifact("CAMPAIGN_PLAYBOOK", campaignPlaybookStrategyRevisionId(playbook), "campaign_playbook", playbook as unknown as Record<string, unknown>),
  };
}

export function evidenceRefMap(inputs: CampaignStrategyAgentInput) {
  const artifacts = [inputs.goal_revision, inputs.business_input, inputs.analytics_evidence_snapshot, ...inputs.policies, inputs.supported_draft_profile, inputs.campaign_playbook];
  return new Map(artifacts.flatMap((artifact) => artifact.evidence.map((item) => [item.evidence_id, {
    input_kind: artifact.kind,
    revision_id: artifact.revision_id,
    evidence_id: item.evidence_id,
  } satisfies CampaignStrategyEvidenceRef] as const)));
}

export function parseStrategyProposal(value: Record<string, import("./p0-agent-runtime.ts").JsonValue>, inputs: CampaignStrategyAgentInput): CampaignStrategyAgentProposal {
  const references = evidenceRefMap(inputs);
  const dimensions = Array.isArray(value.dimensions) ? value.dimensions.map(record) : [];
  return {
    dimensions: dimensions.map((dimension) => {
      let parsed: unknown;
      try { parsed = JSON.parse(String(dimension.value_json ?? "null")); } catch { parsed = null; }
      return {
        dimension_id: String(dimension.dimension_id ?? "") as CampaignStrategyAgentProposal["dimensions"][number]["dimension_id"],
        value: parsed as CampaignStrategyAgentProposal["dimensions"][number]["value"],
        ...strategyEvidenceLimits(dimension, inputs),
        evidence_refs: (Array.isArray(dimension.evidence_refs) ? dimension.evidence_refs : [])
          .map((item) => references.get(String(item)))
          .filter((item): item is CampaignStrategyEvidenceRef => Boolean(item)),
      };
    }),
    rationale: text(value.rationale),
    confidence: String(value.confidence ?? "LOW") as "HIGH" | "MEDIUM" | "LOW",
    conflicts: [],
  };
}

/** Evidence limits are retained even when a model omits them from its prose. */
export function strategyEvidenceLimits(dimension: Record<string, unknown>, inputs: CampaignStrategyAgentInput) {
  const report = record(inputs.analytics_evidence_snapshot.content.findings_report);
  const support = list(report.decisions).map(record).find(item => item.decision === dimension.dimension_id);
  const confidence = String(dimension.confidence ?? "LOW") as "HIGH" | "MEDIUM" | "LOW";
  const limit = support && support.status !== "SUPPORTED" ? list(support.limitations).map(item => text(item)).filter(Boolean).slice(0, 2).join(" ") : "";
  const suffix = limit ? ` Ограничения исследования: ${limit} Требуется проверка гипотезы по квалифицированным результатам.` : "";
  return { rationale: `${text(dimension.rationale).slice(0, Math.max(0, 2000 - suffix.length))}${suffix}`.slice(0, 2000),
    confidence: support?.status === "NEEDS_RESEARCH" ? "LOW" as const : limit && confidence === "HIGH" ? "MEDIUM" as const : confidence };
}

export function sameMaterialValue(left: unknown, right: unknown) {
  if (left !== null && typeof left === "object" || right !== null && typeof right === "object") {
    return canonicalizeEvidence(left) === canonicalizeEvidence(right);
  }
  return JSON.stringify(left) === JSON.stringify(right) || text(left) === text(right);
}

export function hasPriorityMaterialValue(value: unknown) {
  if (value === null || value === undefined || value === "") return false;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  if (typeof value === "string") return Boolean(text(value));
  return typeof value === "object" && Object.keys(record(value)).length > 0;
}
