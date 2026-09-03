import type { GoalRevision } from "./goal-revision.ts";
import type { PipelineCompetitorEvidenceRefresh } from "./pipeline-competitor-refresh.ts";
import {
  type CampaignPairValidationResult,
} from "./campaign-pair-validation.ts";
import type {
  PipelineRunState,
  PipelineStageId,
  PipelineVersionReference,
} from "./pipeline-orchestrator.ts";

export const PIPELINE_CURRENT_PRODUCTS_SCHEMA = "p0-pipeline-current-products-v1";
export const PIPELINE_PUBLICATION_REVIEW_SCHEMA = "p0-publication-review-handoff-v1";
export const PIPELINE_CAMPAIGN_PAIR_EDIT_CONTEXT_SCHEMA = "p0-campaign-pair-edit-context-v1";

export type PipelineJsonRecord = Record<string, unknown>;

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
  competitor_evidence_refresh?: PipelineCompetitorEvidenceRefresh | null;
  campaign_strategy: PipelineJsonRecord | null;
  campaign_pairs: PipelineJsonRecord[];
  campaign_pair_checks: CampaignPairValidationResult;
  campaign_playbook: PipelineVersionReference;
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
  compareAndSwap(
    ownerKey: string,
    expectedStateRevision: number | null,
    current: PipelineCurrentProducts,
  ): Promise<boolean>;
}

export type PipelineVerifiedProduct =
  | { stage: "CAMPAIGN_GOAL"; value: GoalRevision }
  | { stage: "EVIDENCE_COLLECTION"; value: PipelineJsonRecord }
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

function publishFingerprint(pair: PipelineJsonRecord) {
  const draft = record(pair.draft ?? pair);
  return text(draft.publish_fingerprint ?? pair.publish_fingerprint);
}

function nextState(input: {
  current: PipelineCurrentProducts | null;
  run: PipelineRunState;
  product: PipelineVerifiedProduct;
  recordedAt: string;
}): PipelineCurrentProducts {
  const previousRevision = input.current?.state_revision ?? -1;
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
    base.competitor_evidence_refresh = null;
    base.campaign_strategy = null;
    base.campaign_pairs = [];
  } else if (input.product.stage === "EVIDENCE_COLLECTION") {
    base.analytics_evidence_snapshot = clone(input.product.value);
    base.competitor_evidence_refresh = null;
    base.campaign_strategy = null;
    base.campaign_pairs = [];
  } else if (input.product.stage === "STRATEGY") {
    base.campaign_strategy = clone(input.product.value);
    base.campaign_pairs = [];
  } else {
    base.campaign_pairs = clone(input.product.value);
    const fingerprints = base.campaign_pairs.map(publishFingerprint).filter(Boolean);
    base.publication_review = {
      schema_version: PIPELINE_PUBLICATION_REVIEW_SCHEMA,
      status: "REVIEW_ONLY",
      run_id: input.run.run_id,
      pair_count: base.campaign_pairs.length,
      publish_fingerprints: fingerprints,
      external_write: "DENIED",
      publication: "NOT_AUTHORIZED",
      impressions: 0,
      spend_micros: 0,
    };
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
  const next = nextState({
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
