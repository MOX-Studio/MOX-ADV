import { fingerprintDirectProjection } from "./campaign-fanout.ts";
import {
  CampaignPairEditError,
  prepareCampaignPairRebuild,
  type CampaignPairEditRequest,
  type CampaignPairRevision,
} from "./campaign-pair-edit.ts";

export const CAMPAIGN_PAIR_REVISION_CONTRACT = "p0-campaign-pair-revision-v1";
export const CURRENT_CAMPAIGN_DASHBOARD_CONTRACT = "p0-current-campaign-dashboard-v1";
export const CAMPAIGN_PAIR_AUDIT_CONTRACT = "p0-campaign-pair-audit-v1";

type JsonRecord = Record<string, unknown>;

type CurrentArtifact<Value extends JsonRecord> = {
  revision_id: string;
  value: Value;
};

export type CurrentCampaignPairRevision<
  Hypothesis extends JsonRecord = JsonRecord,
  Draft extends JsonRecord = JsonRecord,
> = CampaignPairRevision<Hypothesis, Draft> & {
  publish_fingerprint: string;
};

export type CurrentCampaignWorkingSet<
  Goal extends JsonRecord = JsonRecord,
  Strategy extends JsonRecord = JsonRecord,
  Hypothesis extends JsonRecord = JsonRecord,
  Draft extends JsonRecord = JsonRecord,
> = {
  schema_version: typeof CAMPAIGN_PAIR_REVISION_CONTRACT;
  state_revision: number;
  updated_at: string;
  goal: CurrentArtifact<Goal>;
  strategy: CurrentArtifact<Strategy>;
  pairs: Array<CurrentCampaignPairRevision<Hypothesis, Draft>>;
};

export type CampaignPairRevisionAudit<
  Hypothesis extends JsonRecord = JsonRecord,
  Draft extends JsonRecord = JsonRecord,
> = {
  schema_version: typeof CAMPAIGN_PAIR_AUDIT_CONTRACT;
  audit_id: string;
  owner_key: string;
  pair_id: string;
  state_revision: number;
  changed_at: string;
  classification: "SEMANTIC" | "TECHNICAL";
  changed_fields: string[];
  source_hypothesis_revision_id: string;
  source_draft_revision_id: string;
  source_publish_fingerprint: string;
  current_hypothesis_revision_id: string;
  current_draft_revision_id: string;
  current_publish_fingerprint: string;
  superseded_pair: CurrentCampaignPairRevision<Hypothesis, Draft>;
};

export interface CampaignPairRevisionStore<
  Goal extends JsonRecord = JsonRecord,
  Strategy extends JsonRecord = JsonRecord,
  Hypothesis extends JsonRecord = JsonRecord,
  Draft extends JsonRecord = JsonRecord,
> {
  loadCurrent(ownerKey: string): Promise<CurrentCampaignWorkingSet<Goal, Strategy, Hypothesis, Draft> | null>;
  compareAndSwap(
    ownerKey: string,
    expectedStateRevision: number,
    current: CurrentCampaignWorkingSet<Goal, Strategy, Hypothesis, Draft>,
    audit: CampaignPairRevisionAudit<Hypothesis, Draft>,
  ): Promise<boolean>;
  technicalAudit(ownerKey: string): Promise<Array<CampaignPairRevisionAudit<Hypothesis, Draft>>>;
}

export type CampaignPairSaveResult<Hypothesis extends JsonRecord, Draft extends JsonRecord> = {
  schema_version: typeof CAMPAIGN_PAIR_REVISION_CONTRACT;
  status: "SAVED" | "NO_OP";
  material_change: boolean;
  state_revision: number;
  pair: CurrentCampaignPairRevision<Hypothesis, Draft>;
  previous_publish_fingerprint: string;
  current_publish_fingerprint: string;
  message: string;
};

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CampaignPairEditError(
      "CAMPAIGN_PAIR_REVISION_INVALID",
      "Campaign pair revision content must be an object; no current Campaign pair was changed.",
    );
  }
  return value as JsonRecord;
}

function exactIdentifier(value: unknown, label: string) {
  const result = String(value ?? "").trim();
  if (!result || result !== value || result.length > 255) {
    throw new CampaignPairEditError(
      "CAMPAIGN_PAIR_REVISION_INVALID",
      `${label} must be one exact non-empty identifier; no current Campaign pair was changed.`,
    );
  }
  return result;
}

function validStateRevision(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new CampaignPairEditError(
      "CAMPAIGN_PAIR_REVISION_INVALID",
      "Expected state revision must be a non-negative integer; no current Campaign pair was changed.",
    );
  }
  return Number(value);
}

function defaultRevisionId(kind: "hypothesis" | "draft" | "audit", pairId: string) {
  return `${pairId}:${kind}:${crypto.randomUUID()}`;
}

async function exactProjectionFingerprint(value: unknown) {
  return fingerprintDirectProjection(record(value));
}

/**
 * Saves one rebuilt current pair through a single compare-and-swap. Superseded
 * content is passed only to the store's immutable technical-audit boundary.
 */
export async function saveCurrentCampaignPairRevision<
  Goal extends JsonRecord,
  Strategy extends JsonRecord,
  Hypothesis extends JsonRecord,
  Draft extends JsonRecord,
>(input: {
  store: CampaignPairRevisionStore<Goal, Strategy, Hypothesis, Draft>;
  owner_key: string;
  expected_state_revision: number;
  edit: CampaignPairEditRequest;
  rebuildHypothesis: (value: {
    previous: Hypothesis;
    semantic_changes: Partial<Record<string, unknown>>;
  }) => Hypothesis | Promise<Hypothesis>;
  rebuildDraft: (value: {
    previous: Draft;
    hypothesis: Hypothesis;
    semantic_changes: Partial<Record<string, unknown>>;
    technical_changes: Partial<Record<string, unknown>>;
  }) => Draft | Promise<Draft>;
  publishProjection: (value: { hypothesis: Hypothesis; draft: Draft }) => JsonRecord | Promise<JsonRecord>;
  now?: () => string;
  newRevisionId?: (kind: "hypothesis" | "draft" | "audit", pairId: string) => string;
}): Promise<CampaignPairSaveResult<Hypothesis, Draft>> {
  const ownerKey = exactIdentifier(input.owner_key, "Owner key");
  const expectedStateRevision = validStateRevision(input.expected_state_revision);
  const current = await input.store.loadCurrent(ownerKey);
  if (!current) {
    throw new CampaignPairEditError(
      "CAMPAIGN_PAIR_REVISION_NOT_FOUND",
      "Current Campaign working set was not found; no current Campaign pair was changed.",
    );
  }
  if (current.state_revision !== expectedStateRevision) {
    throw new CampaignPairEditError(
      "CAMPAIGN_PAIR_EDIT_STALE",
      "Campaign working set no longer matches the expected revision; no field merge was attempted and no current Campaign pair was changed.",
    );
  }

  const prepared = await prepareCampaignPairRebuild({
    pairs: current.pairs,
    edit: input.edit,
    rebuildHypothesis: input.rebuildHypothesis,
    rebuildDraft: input.rebuildDraft,
  });
  const source = current.pairs.find((pair) => pair.pair_id === prepared.plan.pair_id);
  if (!source) {
    throw new CampaignPairEditError(
      "CAMPAIGN_PAIR_EDIT_PAIR_NOT_FOUND",
      "Current Campaign pair disappeared before revision preparation; no current Campaign pair was changed.",
    );
  }

  const sourceProjection = await input.publishProjection({
    hypothesis: clone(source.hypothesis),
    draft: clone(source.draft),
  });
  const sourceFingerprint = await exactProjectionFingerprint(sourceProjection);
  if (sourceFingerprint !== source.publish_fingerprint) {
    throw new CampaignPairEditError(
      "CAMPAIGN_PAIR_REVISION_STATE_CONTRADICTORY",
      "Stored publish_fingerprint does not match the current exact publish projection; no current Campaign pair was changed.",
    );
  }
  const candidateProjection = await input.publishProjection({
    hypothesis: clone(prepared.rebuild_candidate.hypothesis),
    draft: clone(prepared.rebuild_candidate.draft),
  });
  const candidateFingerprint = await exactProjectionFingerprint(candidateProjection);
  if (candidateFingerprint === sourceFingerprint) {
    return {
      schema_version: CAMPAIGN_PAIR_REVISION_CONTRACT,
      status: "NO_OP",
      material_change: false,
      state_revision: current.state_revision,
      pair: clone(source),
      previous_publish_fingerprint: sourceFingerprint,
      current_publish_fingerprint: sourceFingerprint,
      message: "Normalization did not change the exact publish projection; no Campaign pair revision was created.",
    };
  }

  const nextId = input.newRevisionId ?? defaultRevisionId;
  const hypothesisRevisionId = prepared.plan.classification === "SEMANTIC"
    ? exactIdentifier(nextId("hypothesis", source.pair_id), "New Campaign Hypothesis revision")
    : source.hypothesis_revision_id;
  const draftRevisionId = exactIdentifier(nextId("draft", source.pair_id), "New Campaign Draft revision");
  if (hypothesisRevisionId === source.hypothesis_revision_id && prepared.plan.classification === "SEMANTIC") {
    throw new CampaignPairEditError(
      "CAMPAIGN_PAIR_REVISION_ID_REUSED",
      "A semantic edit must receive a new Campaign Hypothesis revision identifier; no current Campaign pair was changed.",
    );
  }
  if (draftRevisionId === source.draft_revision_id) {
    throw new CampaignPairEditError(
      "CAMPAIGN_PAIR_REVISION_ID_REUSED",
      "A material edit must receive a new Campaign Draft revision identifier; no current Campaign pair was changed.",
    );
  }

  const hypothesis = {
    ...clone(prepared.rebuild_candidate.hypothesis),
    hypothesis_revision_id: hypothesisRevisionId,
  } as Hypothesis;
  const draftWithoutFingerprint = {
    ...clone(prepared.rebuild_candidate.draft),
    draft_revision_id: draftRevisionId,
  } as Draft;
  const publishProjection = clone(await input.publishProjection({ hypothesis, draft: draftWithoutFingerprint }));
  const publishFingerprint = await exactProjectionFingerprint(publishProjection);
  if (publishFingerprint === sourceFingerprint) {
    throw new CampaignPairEditError(
      "CAMPAIGN_PAIR_REVISION_MATERIALITY_INVALID",
      "The finalized material revision did not produce a new publish_fingerprint; no current Campaign pair was changed.",
    );
  }
  const draft = {
    ...draftWithoutFingerprint,
    publish_projection: publishProjection,
    publish_fingerprint: publishFingerprint,
  } as Draft;
  const nextPair: CurrentCampaignPairRevision<Hypothesis, Draft> = {
    pair_id: source.pair_id,
    hypothesis_revision_id: hypothesisRevisionId,
    draft_revision_id: draftRevisionId,
    publish_fingerprint: publishFingerprint,
    hypothesis,
    draft,
  };
  const changedAt = (input.now ?? (() => new Date().toISOString()))();
  if (!Number.isSafeInteger(current.state_revision) || current.state_revision < 0 || !String(changedAt).trim()) {
    throw new CampaignPairEditError(
      "CAMPAIGN_PAIR_REVISION_STATE_CONTRADICTORY",
      "Current Campaign working set has invalid revision metadata; no current Campaign pair was changed.",
    );
  }
  const next: CurrentCampaignWorkingSet<Goal, Strategy, Hypothesis, Draft> = {
    schema_version: CAMPAIGN_PAIR_REVISION_CONTRACT,
    state_revision: current.state_revision + 1,
    updated_at: changedAt,
    goal: clone(current.goal),
    strategy: clone(current.strategy),
    pairs: current.pairs.map((pair) => pair.pair_id === source.pair_id ? nextPair : clone(pair)),
  };
  const audit: CampaignPairRevisionAudit<Hypothesis, Draft> = {
    schema_version: CAMPAIGN_PAIR_AUDIT_CONTRACT,
    audit_id: exactIdentifier(nextId("audit", source.pair_id), "Campaign pair audit event"),
    owner_key: ownerKey,
    pair_id: source.pair_id,
    state_revision: next.state_revision,
    changed_at: changedAt,
    classification: prepared.plan.classification,
    changed_fields: [...prepared.plan.changed_fields],
    source_hypothesis_revision_id: source.hypothesis_revision_id,
    source_draft_revision_id: source.draft_revision_id,
    source_publish_fingerprint: sourceFingerprint,
    current_hypothesis_revision_id: hypothesisRevisionId,
    current_draft_revision_id: draftRevisionId,
    current_publish_fingerprint: publishFingerprint,
    superseded_pair: clone(source),
  };
  if (!await input.store.compareAndSwap(ownerKey, expectedStateRevision, next, audit)) {
    throw new CampaignPairEditError(
      "CAMPAIGN_PAIR_EDIT_STALE",
      "Campaign working set changed while the revision was prepared; no field merge was attempted and the newer current result was preserved.",
    );
  }
  return {
    schema_version: CAMPAIGN_PAIR_REVISION_CONTRACT,
    status: "SAVED",
    material_change: true,
    state_revision: next.state_revision,
    pair: clone(nextPair),
    previous_publish_fingerprint: sourceFingerprint,
    current_publish_fingerprint: publishFingerprint,
    message: "A new immutable current Campaign pair revision and publish_fingerprint were saved.",
  };
}

/** Owner projection intentionally has no history or technical-audit collection. */
export function projectCurrentCampaignArtifacts<
  Goal extends JsonRecord,
  Strategy extends JsonRecord,
  Hypothesis extends JsonRecord,
  Draft extends JsonRecord,
>(current: CurrentCampaignWorkingSet<Goal, Strategy, Hypothesis, Draft>) {
  return {
    schema_version: CURRENT_CAMPAIGN_DASHBOARD_CONTRACT,
    state_revision: current.state_revision,
    updated_at: current.updated_at,
    current_goal: clone(current.goal),
    current_strategy: clone(current.strategy),
    current_campaign_pairs: clone(current.pairs),
  };
}
