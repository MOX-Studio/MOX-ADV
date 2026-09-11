import type { GoalRevision } from "./goal-revision.ts";
import type { ProductionEvidenceInterpretation } from "./production-stage-agents.ts";
import {
  retainVerifiedPipelineEvidence,
  verifyRetainedPipelineEvidence,
  type PipelineVerifiedEvidenceInput,
} from "./pipeline-evidence-reuse.ts";
import type { PipelineCompetitorEvidenceRefresh } from "./pipeline-competitor-refresh.ts";
import {
  type CampaignPairValidationResult,
} from "./campaign-pair-validation.ts";
import {
  pipelineDigest,
  type PipelineRunState,
  type PipelineStageId,
  type PipelineVersionReference,
} from "./pipeline-orchestrator.ts";

export const PIPELINE_CURRENT_PRODUCTS_SCHEMA = "p0-pipeline-current-products-v1";
export const PIPELINE_PUBLICATION_REVIEW_SCHEMA = "p0-publication-review-handoff-v1";
export const PIPELINE_CAMPAIGN_PAIR_EDIT_CONTEXT_SCHEMA = "p0-campaign-pair-edit-context-v1";
export const PIPELINE_PRIOR_STRATEGY_INPUT_SCHEMA = "p0-prior-strategy-input-v1";

export type PipelineJsonRecord = Record<string, unknown>;

export type PipelinePriorStrategyInput = {
  schema_version: typeof PIPELINE_PRIOR_STRATEGY_INPUT_SCHEMA;
  owner_key: string;
  source_run_id: string;
  source_state_revision: number;
  reference: PipelineVersionReference;
  artifact: PipelineJsonRecord;
};

export type PipelinePublicationReviewHandoff = {
  schema_version: typeof PIPELINE_PUBLICATION_REVIEW_SCHEMA;
  status: "REVIEW_ONLY";
  run_id: string;
  pair_count: number;
  publish_fingerprints: string[];
  external_write: "DENIED";
  publication: "NOT_AUTHORIZED";
  impressions: 0;
  spend_micros: 0;
};

export type PipelineCurrentProducts = {
  schema_version: typeof PIPELINE_CURRENT_PRODUCTS_SCHEMA;
  owner_key: string;
  state_revision: number;
  run_id: string;
  run_version: number;
  current_stage: PipelineStageId;
  updated_at: string;
  historical_source: PipelineRunState["input_versions"]["historical_document"];
  goal_revision: GoalRevision | null;
  analytics_evidence_snapshot: PipelineJsonRecord | null;
  evidence_interpretation?: ProductionEvidenceInterpretation | null;
  prior_verified_evidence?: PipelineVerifiedEvidenceInput | null;
  competitor_evidence_refresh?: PipelineCompetitorEvidenceRefresh | null;
  campaign_strategy: PipelineJsonRecord | null;
  prior_strategy_input?: PipelinePriorStrategyInput | null;
  campaign_pairs: PipelineJsonRecord[];
  campaign_pair_checks: CampaignPairValidationResult;
  campaign_playbook: PipelineVersionReference;
  /** Historical handoff only; current preparation ends with campaign_pairs. */
  publication_review: PipelinePublicationReviewHandoff | null;
  authority: {
    external_write: "DENIED";
    publication: "NOT_AUTHORIZED";
    impressions: 0;
    spend_micros: 0;
  };
};

export interface PipelineCurrentProductStore {
  loadCurrent(ownerKey: string): Promise<PipelineCurrentProducts | null>;
  /** Historical candidates still require the original verified audit event before reuse. */
  loadEvidenceCandidates?(ownerKey: string): Promise<PipelineCurrentProducts[]>;
  compareAndSwap(
    ownerKey: string,
    expectedStateRevision: number | null,
    current: PipelineCurrentProducts,
  ): Promise<boolean>;
}

export type PipelineVerifiedProduct =
  | { stage: "CAMPAIGN_GOAL"; value: GoalRevision }
  | { stage: "EVIDENCE_COLLECTION"; value: PipelineJsonRecord; interpretation?: ProductionEvidenceInterpretation | null; researchScopeDigest?: string; reusedEvidence?: PipelineVerifiedEvidenceInput }
  | { stage: "STRATEGY"; value: PipelineJsonRecord }
  | { stage: "CAMPAIGNS"; value: PipelineJsonRecord[] };

function clone<T>(value: T): T {
  return structuredClone(value);
}

function record(value: unknown): PipelineJsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Verified pipeline product must be one exact object.");
  }
  return value as PipelineJsonRecord;
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}


/** Retains prior recommendations and exact owner-correction provenance as input only. */
export async function resolvePriorStrategyInput(current: PipelineCurrentProducts | null): Promise<PipelinePriorStrategyInput | null> {
  if (!current) return null;
  const prior = current.prior_strategy_input ?? null;
  if (prior && (prior.schema_version !== PIPELINE_PRIOR_STRATEGY_INPUT_SCHEMA
    || prior.owner_key !== current.owner_key || !text(prior.source_run_id)
    || !Number.isSafeInteger(prior.source_state_revision) || prior.source_state_revision < 0 || prior.source_state_revision > current.state_revision
    || !prior.artifact || typeof prior.artifact !== "object" || Array.isArray(prior.artifact)
    || !text(prior.reference?.schema_version) || !text(prior.reference?.revision_id)
    || await pipelineDigest(prior.artifact) !== prior.reference.digest)) {
    throw new Error("Prior Strategy input lost its exact source or immutable artifact reference.");
  }
  if (!current.campaign_strategy) return prior ? clone(prior) : null;
  const artifact = record(current.campaign_strategy);
  const digest = await pipelineDigest(artifact);
  if (prior?.reference.digest === digest) return clone(prior);
  const strategy = record(artifact.strategy ?? artifact);
  return {
    schema_version: PIPELINE_PRIOR_STRATEGY_INPUT_SCHEMA,
    owner_key: current.owner_key,
    source_run_id: current.run_id,
    source_state_revision: current.state_revision,
    reference: {
      schema_version: text(artifact.schema_version) || "p0-strategy-stage-product-v1",
      revision_id: text(strategy.strategy_revision_id) || `prior-strategy:${digest.slice(7, 31)}`,
      digest,
    },
    artifact: clone(artifact),
  };
}

async function nextState(input: {
  current: PipelineCurrentProducts | null;
  run: PipelineRunState;
  product: PipelineVerifiedProduct;
  recordedAt: string;
}): Promise<PipelineCurrentProducts> {
  const previousRevision = input.current?.state_revision ?? -1;
  const priorStrategyInput = await resolvePriorStrategyInput(input.current);
  const priorEvidence = input.current?.prior_verified_evidence ?? null;
  if (priorEvidence && !await verifyRetainedPipelineEvidence(priorEvidence)) throw new Error("Retained verified evidence lost its immutable lineage.");
  const base: PipelineCurrentProducts = input.current && input.current.run_id === input.run.run_id
    ? clone(input.current)
    : {
        schema_version: PIPELINE_CURRENT_PRODUCTS_SCHEMA,
        owner_key: input.run.owner_key,
        state_revision: previousRevision,
        run_id: input.run.run_id,
        run_version: input.run.version,
        current_stage: input.product.stage,
        updated_at: input.recordedAt,
        historical_source: clone(input.run.input_versions.historical_document),
        goal_revision: input.run.goal_formation.status === "VERIFIED"
          ? clone(input.run.goal_formation.revision)
          : null,
        analytics_evidence_snapshot: null,
        competitor_evidence_refresh: null,
        campaign_strategy: null,
        campaign_pairs: [],
        campaign_pair_checks: clone(input.run.input_versions.campaign_pair_checks),
        campaign_playbook: clone(input.run.input_versions.campaign_playbook),
        publication_review: null,
        authority: {
          external_write: "DENIED",
          publication: "NOT_AUTHORIZED",
          impressions: 0,
          spend_micros: 0,
        },
      };
  base.state_revision = previousRevision + 1;
  base.prior_strategy_input = priorStrategyInput;
  base.prior_verified_evidence = priorEvidence ? clone(priorEvidence) : null;
  base.run_version = input.run.version;
  base.current_stage = input.product.stage;
  base.updated_at = input.recordedAt;
  base.publication_review = null;
  if (input.run.goal_formation.status === "VERIFIED") {
    base.goal_revision = clone(input.run.goal_formation.revision);
  }

  if (input.product.stage === "CAMPAIGN_GOAL") {
    base.goal_revision = clone(input.product.value);
    base.analytics_evidence_snapshot = null;
    base.evidence_interpretation = null;
    base.competitor_evidence_refresh = null;
    base.campaign_strategy = null;
    base.campaign_pairs = [];
  } else if (input.product.stage === "EVIDENCE_COLLECTION") {
    base.analytics_evidence_snapshot = clone(input.product.value);
    base.evidence_interpretation = input.product.interpretation ? clone(input.product.interpretation) : null;
    if (input.product.reusedEvidence) {
      if (!await verifyRetainedPipelineEvidence(input.product.reusedEvidence)
        || input.product.reusedEvidence.owner_key !== input.run.owner_key
        || input.product.reusedEvidence.evidence_reference.digest !== await pipelineDigest(input.product.value)) {
        throw new Error("Evidence replay cannot replace its verified source snapshot.");
      }
      const verifiedInterpretation = input.product.reusedEvidence.interpretation === null && input.product.interpretation
        ? await retainVerifiedPipelineEvidence({
          run: input.run, snapshot: input.product.value, interpretation: input.product.interpretation,
          stateRevision: base.state_revision, researchScopeDigest: input.product.researchScopeDigest,
        })
        : null;
      // A fresh Analyst result belongs to this real verification event, not the legacy event.
      // The snapshot and its collection time remain the original immutable evidence.
      base.prior_verified_evidence = verifiedInterpretation?.interpretation
        ? verifiedInterpretation : clone(input.product.reusedEvidence);
    } else {
      const retained = await retainVerifiedPipelineEvidence({
        run: input.run, snapshot: input.product.value, interpretation: input.product.interpretation,
        stateRevision: base.state_revision, researchScopeDigest: input.product.researchScopeDigest,
      });
      if (retained) base.prior_verified_evidence = retained;
    }
    base.competitor_evidence_refresh = null;
    base.campaign_strategy = null;
    base.campaign_pairs = [];
  } else if (input.product.stage === "STRATEGY") {
    base.campaign_strategy = clone(input.product.value);
    base.prior_strategy_input = await resolvePriorStrategyInput(base);
    base.campaign_pairs = [];
  } else {
    base.campaign_pairs = clone(input.product.value);
  }
  return base;
}

/** Persists only deterministically verified stage products through one CAS. */
export async function saveVerifiedPipelineProduct(input: {
  store: PipelineCurrentProductStore;
  run: PipelineRunState;
  product: PipelineVerifiedProduct;
  recordedAt?: string;
}) {
  const current = await input.store.loadCurrent(input.run.owner_key);
  const next = await nextState({
    current,
    run: input.run,
    product: input.product,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  });
  const saved = await input.store.compareAndSwap(
    input.run.owner_key,
    current?.state_revision ?? null,
    next,
  );
  if (!saved) throw new Error("Current pipeline products changed before verified stage persistence.");
  return clone(next);
}

/** A research return invalidates downstream products while retaining the prior verified evidence history. */
export async function returnPipelineProductsToResearch(store: PipelineCurrentProductStore, run: PipelineRunState) {
  if (run.last_transition.kind !== "RETURN" || run.current_stage !== "EVIDENCE_COLLECTION") throw new Error("Нет подтверждённого возврата к исследованию.");
  const current = await store.loadCurrent(run.owner_key);
  if (!current || current.run_id !== run.run_id) throw new Error("Не найден текущий результат запуска.");
  if (current.run_version === run.version && current.current_stage === "CAMPAIGN_GOAL") return current;
  if (current.run_version !== run.version - 1) throw new Error("Результаты изменились до возврата к исследованию.");
  const next = clone(current);
  next.prior_strategy_input = await resolvePriorStrategyInput(current);
  next.state_revision++; next.run_version = run.version; next.current_stage = "CAMPAIGN_GOAL"; next.updated_at = run.updated_at;
  next.analytics_evidence_snapshot = null; next.evidence_interpretation = null; next.competitor_evidence_refresh = null;
  next.campaign_strategy = null; next.campaign_pairs = []; next.campaign_pair_checks = clone(run.input_versions.campaign_pair_checks);
  if (!await store.compareAndSwap(run.owner_key, current.state_revision, next)) throw new Error("Результаты изменились при возврате к исследованию.");
  return next;
}
