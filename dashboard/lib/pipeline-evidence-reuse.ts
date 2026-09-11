import { verifyKeywordResearch } from "./keyword-preparation.ts";
import { formationResearchSchema, validateFormationShape, verifyFormationResearch, type FormationResearch } from "./campaign-formation-method.ts";
import { buildFindingsReport } from "./findings-research.ts";
import { verifyAnalyticsEvidenceSnapshot } from "./analytics-evidence.ts";
import { goalReadinessErrors, verifyGoalFormationResult, type GoalRevision } from "./goal-revision.ts";
import { verifyGoalRequirements } from "./goal-prelaunch.ts";
import {
  pipelineDigest,
  verifyPipelineAuditTrail,
  verifyPipelineRunState,
  type PipelineAuditEvent,
  type PipelineInputVersions,
  type PipelineRunState,
  type PipelineVersionReference,
} from "./pipeline-orchestrator.ts";
import type { ProductionEvidenceInterpretation } from "./production-stage-agents.ts";

export const PIPELINE_VERIFIED_EVIDENCE_SCHEMA = "p0-retained-verified-evidence-v1";
export const PIPELINE_EVIDENCE_REPLAY_POLICY = "historical-planning-replay-24h-v1";
const MAX_PLANNING_AGE_MS = 24 * 60 * 60 * 1000;

export type PipelineEvidenceReplayAssessment = {
  schema_version: "p0-evidence-planning-replay-v1";
  policy_version: "1.0.0";
  use: "HISTORICAL_PLANNING";
  evaluated_at: string;
  original_collected_at: string;
  original_verified_at: string;
  snapshot_id: string;
  source_run_id: string;
  source_event_digest: string;
  goal_revision_id: string;
  input_scope_digest: string;
  expired_operational_evidence_refs: string[];
  unknown_freshness_evidence_refs: string[];
  publication_freshness: "UNVERIFIED";
  current_operational_readiness: "UNVERIFIED";
};

export type PipelineVerifiedEvidenceInput = {
  schema_version: typeof PIPELINE_VERIFIED_EVIDENCE_SCHEMA;
  owner_key: string;
  source_run_id: string;
  source_run_version: number;
  source_state_revision: number;
  verified_at: string;
  collected_at: string;
  goal_reference: PipelineVersionReference;
  historical_source: PipelineInputVersions["historical_document"];
  research_scope_digest: string | null;
  evidence_reference: PipelineVersionReference;
  snapshot: Record<string, unknown>;
  interpretation: ProductionEvidenceInterpretation | null;
  digest: string;
};

export type PipelineEvidenceReusePlan = {
  evidence: PipelineVerifiedEvidenceInput;
  source_run: PipelineRunState;
  assessment: PipelineEvidenceReplayAssessment;
  expected_state_revision: number;
  reuse_token: string;
};

export type OwnerEvidenceReuse = {
  available: boolean;
  reason: string;
  collectedAt: string | null;
  verifiedAt: string | null;
  snapshotId: string | null;
  sourceRunId: string | null;
  strategyReusable: false;
  expectedStateRevision: number | null;
  goalRevisionId: string | null;
  reuseToken: string | null;
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const referenceEqual = (left: PipelineVersionReference | null | undefined, right: PipelineVersionReference | null | undefined) => Boolean(left && right
  && left.schema_version === right.schema_version && left.revision_id === right.revision_id && left.digest === right.digest);

export function unavailableEvidenceReuse(reason: string, input?: { evidence?: PipelineVerifiedEvidenceInput | null; stateRevision?: number | null; goal?: GoalRevision | null }): OwnerEvidenceReuse {
  return {
    available: false, reason, collectedAt: input?.evidence?.collected_at ?? null,
    verifiedAt: input?.evidence?.verified_at ?? null, snapshotId: input?.evidence?.evidence_reference.revision_id ?? null,
    sourceRunId: input?.evidence?.source_run_id ?? null, strategyReusable: false,
    expectedStateRevision: input?.stateRevision ?? null, goalRevisionId: input?.goal?.goal_revision_id ?? null, reuseToken: null,
  };
}

/** Generated recommendations do not change research scope; exact material owner corrections do. */
function ownerResearchCorrections(state: Record<string, unknown>): Record<string, unknown> {
  const current = record(state.current_pipeline_strategy);
  const output: Record<string, unknown> = {};
  const visit = (content: Record<string, unknown>, depth = 0) => {
    if (depth > 20) throw new Error("Evidence reuse correction lineage is too deep.");
    const base = record(record(content.base_business_input).content);
    if (Object.keys(base).length) visit(base, depth + 1);
    const correction = record(content.owner_strategy_correction);
    if (correction.precedence !== "PRIORITY_BUSINESS_INPUT") return;
    const changes = record(correction.changes);
    for (const key of ["geography", "advertised_offer", "campaign_focus", "qualified_result", "landing_page", "period"]) {
      if (Object.hasOwn(changes, key)) output[key] = structuredClone(changes[key]);
    }
  };
  visit(record(record(record(current.inputs).business_input).content));
  return output;
}

export async function pipelineEvidenceResearchScope(input: {
  versions: PipelineInputVersions;
  state: Record<string, unknown>;
}) {
  return pipelineDigest({
    historical_document: input.versions.historical_document,
    material_owner_corrections: ownerResearchCorrections(input.state),
  });
}

function validInterpretation(value: unknown, snapshot: Record<string, unknown>, reference: PipelineVersionReference): value is ProductionEvidenceInterpretation {
  const item = record(value);
  const formation = Object.hasOwn(item, "formation_research");
  const keys = ["schema_version", "source_snapshot", "summary", "findings", "evidence_refs", "gap_refs", ...(Object.hasOwn(item, "decision_support") ? ["decision_support"] : []), ...(formation ? ["formation_research"] : [])];
  if (Object.hasOwn(item, "decision_support") && JSON.stringify(item.decision_support) !== JSON.stringify(buildFindingsReport(snapshot))) return false;
  if (JSON.stringify(Object.keys(item).sort()) !== JSON.stringify(keys.sort())
    || item.schema_version !== "p0-evidence-stage-interpretation-v1"
    || !referenceEqual(item.source_snapshot as PipelineVersionReference, reference)
    || !text(item.summary) || String(item.summary).length > (formation ? 4000 : 2000)
    || !Array.isArray(item.findings) || item.findings.length > (formation ? 500 : 16)) return false;
  const allowed = new Set([
    text(snapshot.snapshot_id),
    ...list(snapshot.evidence).map((value) => text(record(value).evidence_id)),
    ...list(snapshot.evidence_records).map((value) => text(record(value).evidence_id ?? record(value).record_id)),
    ...list(snapshot.sources).map((value) => text(record(value).source_id)),
    ...list(snapshot.claims).map((value) => text(record(value).claim_id)),
    ...list(record(snapshot.business_research).supporting_materials).map(value => text(record(value).id)),
  ].filter(Boolean));
  const gaps = new Set(list(snapshot.gaps).map((value) => text(record(value).gap_id)).filter(Boolean));
  if (formation) {
    try {
      const hasGoalRequirements = Object.hasOwn(record(item.formation_research), "goal_requirements");
      const hasKeywords = Object.hasOwn(record(item.formation_research), "keyword_research");
      const schema = formationResearchSchema([...allowed], [...gaps], hasGoalRequirements, hasKeywords);
      if (validateFormationShape(schema, { summary: item.summary, evidence_refs: item.evidence_refs, gap_refs: item.gap_refs, research: item.formation_research }).length) return false;
      verifyFormationResearch(item.formation_research as FormationResearch);
      if (hasKeywords && verifyKeywordResearch(item.formation_research as FormationResearch).length) return false;
      if (hasGoalRequirements && (!snapshot.goal_context || verifyGoalRequirements(item.formation_research as FormationResearch, snapshot.goal_context as GoalRevision).length)) return false;
    } catch { return false; }
  }
  const refsValid = (refs: unknown, choices: Set<string>, minimum: number, maximum: number) => Array.isArray(refs)
    && refs.length >= minimum && refs.length <= maximum && new Set(refs).size === refs.length
    && refs.every((ref) => typeof ref === "string" && choices.has(ref));
  return refsValid(item.evidence_refs, allowed, 1, formation ? 500 : 100) && refsValid(item.gap_refs, gaps, 0, formation ? 500 : 100)
    && item.findings.every((value) => {
      const finding = record(value);
      return JSON.stringify(Object.keys(finding).sort()) === JSON.stringify(["implication", "finding", "evidence_refs"].sort())
        && ["OFFER", "AUDIENCE", "INTENT", "MESSAGE", "LANDING", "MEASUREMENT", "EXCLUSION"].includes(String(finding.implication))
        && text(finding.finding).length > 0 && String(finding.finding).length <= (formation ? 2000 : 1000)
        && refsValid(finding.evidence_refs, allowed, 1, formation ? 500 : 10);
    });
}

/** Retention alone is not reuse authorization; the original audit must match on every replay. */
export async function retainVerifiedPipelineEvidence(input: {
  run: PipelineRunState;
  snapshot: Record<string, unknown>;
  interpretation?: ProductionEvidenceInterpretation | null;
  stateRevision: number;
  researchScopeDigest?: string | null;
  sourceRunVersion?: number;
  verifiedAt?: string;
}): Promise<PipelineVerifiedEvidenceInput | null> {
  if (input.run.goal_formation.status !== "VERIFIED" || !await verifyAnalyticsEvidenceSnapshot(input.snapshot)) return null;
  const goal = input.run.goal_formation.revision;
  const reference = {
    schema_version: text(input.snapshot.schema_version), revision_id: text(input.snapshot.snapshot_id),
    digest: await pipelineDigest(input.snapshot),
  };
  const collectedAt = text(input.snapshot.generated_at);
  if (!Number.isFinite(Date.parse(collectedAt))) return null;
  const body = {
    schema_version: PIPELINE_VERIFIED_EVIDENCE_SCHEMA,
    owner_key: input.run.owner_key, source_run_id: input.run.run_id,
    source_run_version: input.sourceRunVersion ?? input.run.version,
    source_state_revision: input.stateRevision,
    verified_at: input.verifiedAt ?? input.run.updated_at, collected_at: collectedAt,
    goal_reference: { schema_version: goal.schema_version, revision_id: goal.goal_revision_id, digest: goal.digest },
    historical_source: structuredClone(input.run.input_versions.historical_document),
    research_scope_digest: input.researchScopeDigest ?? null,
    evidence_reference: reference,
    snapshot: structuredClone(input.snapshot),
    interpretation: validInterpretation(input.interpretation, input.snapshot, reference) ? structuredClone(input.interpretation) : null,
  };
  return { ...body, schema_version: PIPELINE_VERIFIED_EVIDENCE_SCHEMA, digest: await pipelineDigest(body) };
}

export async function verifyRetainedPipelineEvidence(value: PipelineVerifiedEvidenceInput): Promise<boolean> {
  if (value?.schema_version !== PIPELINE_VERIFIED_EVIDENCE_SCHEMA || !value.owner_key || !value.source_run_id
    || !Number.isSafeInteger(value.source_state_revision) || value.source_state_revision < 0
    || !Number.isSafeInteger(value.source_run_version) || value.source_run_version < 1) return false;
  const { digest, ...body } = value;
  return digest === await pipelineDigest(body) && await verifyAnalyticsEvidenceSnapshot(value.snapshot)
    && value.evidence_reference.revision_id === value.snapshot.snapshot_id
    && value.evidence_reference.schema_version === value.snapshot.schema_version
    && value.evidence_reference.digest === await pipelineDigest(value.snapshot)
    && value.collected_at === value.snapshot.generated_at
    && (value.interpretation === null || validInterpretation(value.interpretation, value.snapshot, value.evidence_reference));
}

/** Looks up real verification rather than treating a historical seed as an accepted snapshot. */
export async function verifiedEvidenceSourceEvent(input: {
  evidence: PipelineVerifiedEvidenceInput;
  run: PipelineRunState;
  audit: PipelineAuditEvent[];
}): Promise<PipelineAuditEvent | null> {
  const { evidence, run, audit } = input;
  if (!await verifyRetainedPipelineEvidence(evidence)) return null;
  await verifyPipelineRunState(run);
  await verifyPipelineAuditTrail(audit, run);
  if (run.owner_key !== evidence.owner_key || run.run_id !== evidence.source_run_id || run.goal_formation.status !== "VERIFIED"
    || !referenceEqual(evidence.goal_reference, { schema_version: run.goal_formation.revision.schema_version, revision_id: run.goal_formation.revision.goal_revision_id, digest: run.goal_formation.revision.digest })
    || JSON.stringify(evidence.historical_source) !== JSON.stringify(run.input_versions.historical_document)) return null;
  return audit.find((event) => event.run_version === evidence.source_run_version && event.stage === "EVIDENCE_COLLECTION"
    && event.event_kind === "STAGE_VERIFIED" && event.output.status === "VERIFIED"
    && event.recorded_at === evidence.verified_at
    && Number.isFinite(Date.parse(evidence.collected_at)) && Date.parse(evidence.collected_at) <= Date.parse(event.recorded_at)
    && referenceEqual(event.output.reference, evidence.evidence_reference)
    && event.checks.length > 0 && event.checks.every((check) => check.status === "PASSED")
    && event.inputs.some((reference) => referenceEqual(reference, evidence.goal_reference))) ?? null;
}

function policyAgeMs(policy: unknown): number | null {
  const match = text(policy).match(/\/(\d+)(m|h|d)(?:-|$)/u);
  return match ? Number(match[1]) * ({ m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]] ?? 0) : null;
}

/** The 24h planning window never extends an operational /5m or /24h freshness policy. */
export async function assessPipelineEvidenceReuse(input: {
  currentOwnerKey: string;
  evidence: PipelineVerifiedEvidenceInput;
  sourceRun: PipelineRunState;
  sourceAudit: PipelineAuditEvent[];
  currentGoal: GoalRevision;
  currentVersions: PipelineInputVersions;
  currentState: Record<string, unknown>;
  stateRevision: number;
  evaluatedAt: string;
}): Promise<{ availability: OwnerEvidenceReuse; plan: PipelineEvidenceReusePlan | null }> {
  const denied = (reason: string) => ({ availability: unavailableEvidenceReuse(reason, { evidence: input.evidence, stateRevision: input.stateRevision, goal: input.currentGoal }), plan: null });
  if (input.evidence.owner_key !== input.currentOwnerKey || input.sourceRun.owner_key !== input.currentOwnerKey) return denied("Проверенные данные относятся к другому владельцу. Обновите источники.");
  const source = await verifiedEvidenceSourceEvent({ evidence: input.evidence, run: input.sourceRun, audit: input.sourceAudit });
  if (!source) return denied("Подтверждение источников в истории запуска не найдено. Обновите источники.");
  await verifyGoalFormationResult({ status: "VERIFIED", revision: input.currentGoal });
  if (goalReadinessErrors(input.currentGoal).length) return denied(goalReadinessErrors(input.currentGoal).join(" "));
  const goalReference = { schema_version: input.currentGoal.schema_version, revision_id: input.currentGoal.goal_revision_id, digest: input.currentGoal.digest };
  if (!referenceEqual(input.evidence.goal_reference, goalReference)) return denied("Цель изменилась после проверки данных. Обновите источники для текущей цели.");
  if (JSON.stringify(input.evidence.historical_source) !== JSON.stringify(input.currentVersions.historical_document)) return denied("Бизнес, продукт или область источников изменились. Требуется обновление данных.");
  const scopeDigest = await pipelineEvidenceResearchScope({ versions: input.currentVersions, state: input.currentState });
  if (input.evidence.research_scope_digest !== null && input.evidence.research_scope_digest !== scopeDigest) return denied("География, предложение или посадочная страница изменены. Обновите источники.");
  if (input.evidence.research_scope_digest === null && Object.keys(ownerResearchCorrections(input.currentState)).length
    && !referenceEqual(input.sourceRun.input_versions.business_input, input.currentVersions.business_input)) return denied("Не удаётся подтвердить прежнюю область бизнес-правок. Обновите источники.");
  const lifecycle = record(input.currentState.analytics_evidence_lifecycle);
  if (lifecycle.pending_replacement) return denied("Предыдущие данные помечены для замены. Сначала обновите источники.");
  const now = Date.parse(input.evaluatedAt);
  const collected = Date.parse(input.evidence.collected_at);
  if (!Number.isFinite(now) || !Number.isFinite(collected) || collected > now || Date.parse(source.recorded_at) > now || now - collected > MAX_PLANNING_AGE_MS) return denied("Проверенным данным больше суток или дата сбора некорректна. Обновите источники.");
  const snapshot = input.evidence.snapshot;
  const sources = new Map(list(snapshot.sources).map((value) => [text(record(value).source_id), record(value)]));
  const expiredOperational: string[] = [];
  const unknownFreshness: string[] = [];
  let applicableFirstParty = false;
  for (const value of list(snapshot.evidence)) {
    const evidence = record(value);
    const source = sources.get(text(evidence.source_id));
    if (!source || source.status === "UNAVAILABLE") continue;
    const reference = text(evidence.evidence_id);
    const observed = Date.parse(text(evidence.observed_at));
    const age = now - observed;
    const policy = record(evidence.freshness);
    const maxAge = policyAgeMs(policy.policy_id);
    const known = Number.isFinite(observed) && age >= 0 && maxAge !== null && ["fresh", "aging"].includes(String(policy.status));
    const operational = ["DIRECT_OFFICIAL_API", "METRIKA_OFFICIAL_API", "WORDSTAT_OFFICIAL_API", "WORDSTAT_OFFICIAL_UI"].includes(String(source.provenance_class));
    if (!known) unknownFreshness.push(reference);
    if (operational && (!known || age > maxAge!)) expiredOperational.push(reference);
    if (["FIRST_PARTY_PUBLIC", "OWNER_CONFIRMED"].includes(String(source.provenance_class))) {
      if (known && age <= maxAge! && !list(evidence.conflicts).length && policy.status !== "stale") applicableFirstParty = true;
      else if (policy.status === "stale" || known && age > maxAge!) return denied("Факты предложения или посадочной страницы устарели. Обновите источники.");
    }
  }
  if (!applicableFirstParty) return denied("Нет применимых подтверждённых фактов предложения и сайта. Обновите источники.");
  const assessment: PipelineEvidenceReplayAssessment = {
    schema_version: "p0-evidence-planning-replay-v1", policy_version: "1.0.0", use: "HISTORICAL_PLANNING",
    evaluated_at: input.evaluatedAt, original_collected_at: input.evidence.collected_at,
    original_verified_at: source.recorded_at, snapshot_id: input.evidence.evidence_reference.revision_id,
    source_run_id: input.evidence.source_run_id, source_event_digest: source.event_digest,
    goal_revision_id: input.currentGoal.goal_revision_id, input_scope_digest: scopeDigest,
    expired_operational_evidence_refs: [...new Set(expiredOperational)], unknown_freshness_evidence_refs: [...new Set(unknownFreshness)],
    publication_freshness: "UNVERIFIED", current_operational_readiness: "UNVERIFIED",
  };
  const token = await pipelineDigest({
    policy: PIPELINE_EVIDENCE_REPLAY_POLICY, evidence_digest: input.evidence.digest,
    source_event_digest: source.event_digest, goal: goalReference,
    scope: scopeDigest, state_revision: input.stateRevision, business_input: input.currentVersions.business_input,
  });
  return {
    availability: {
      available: true, reason: "Проверенные данные можно использовать повторно. Стратегия и кампании будут проверены заново; готовность публикации не переносится.",
      collectedAt: input.evidence.collected_at, verifiedAt: input.evidence.verified_at,
      snapshotId: input.evidence.evidence_reference.revision_id, sourceRunId: input.evidence.source_run_id,
      strategyReusable: false, expectedStateRevision: input.stateRevision, goalRevisionId: input.currentGoal.goal_revision_id, reuseToken: token,
    },
    plan: { evidence: structuredClone(input.evidence), source_run: structuredClone(input.sourceRun), assessment, expected_state_revision: input.stateRevision, reuse_token: token },
  };
}
