import {
  saveCampaignStrategyCorrection,
  CURRENT_CAMPAIGN_STRATEGY_SCHEMA,
  type CampaignLaunchStatus,
  type CampaignStrategyCorrectionChanges,
  type CampaignStrategyCorrectionModel,
  type CurrentCampaignStrategyState,
  type CurrentCampaignStrategyStore,
} from "./campaign-strategy-correction.ts";
import {
  classifyCampaignPairEdit,
  type CampaignPairEditRequest,
} from "./campaign-pair-edit.ts";
import { buildBrandClaimsContract } from "./campaign-creation-profile.ts";
import { fingerprintDirectProjection, type DirectCapabilitySnapshot } from "./campaign-fanout.ts";
import {
  compileDirectProjection,
  DirectProjectionCompilationError,
  type DirectFieldApplicabilityProof,
} from "./direct-projection-compiler.ts";
import type { DirectProjection } from "./direct-write.ts";
import { pipelineDigest, type PipelineRunStatus } from "./pipeline-orchestrator.ts";
import {
  PIPELINE_CAMPAIGN_PAIR_EDIT_CONTEXT_SCHEMA,
  PIPELINE_PUBLICATION_REVIEW_SCHEMA,
  type PipelineCurrentProducts,
  type PipelineCurrentProductStore,
  type PipelineJsonRecord,
} from "./pipeline-current-products.ts";
import { PRODUCTION_STRATEGY_STAGE_PRODUCT_SCHEMA } from "./production-stage-agents.ts";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function record(value: unknown): PipelineJsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Current pipeline edit requires one exact object.");
  return value as PipelineJsonRecord;
}

function text(value: unknown, maximum = 4_096) {
  const normalized = String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!normalized || normalized.length > maximum) throw new Error(`Edited value must contain 1-${maximum} normalized characters.`);
  return normalized;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function campaignPairEditContext(pair: PipelineJsonRecord) {
  if (!pair.edit_context || typeof pair.edit_context !== "object" || Array.isArray(pair.edit_context)) {
    throw new Error("Current Campaign pair has no exact compiler context; the edit was not saved.");
  }
  const context = pair.edit_context as PipelineJsonRecord;
  const capabilitySnapshot = record(context.capability_snapshot) as DirectCapabilitySnapshot;
  const allowedLandingHosts = list(context.allowed_landing_hosts).map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  const applicabilityProofs = list(context.applicability_proofs).map((item) => record(item) as DirectFieldApplicabilityProof);
  if (context.schema_version !== PIPELINE_CAMPAIGN_PAIR_EDIT_CONTEXT_SCHEMA
    || !String(capabilitySnapshot.snapshot_id ?? "").trim()
    || !allowedLandingHosts.length
    || !applicabilityProofs.length) {
    throw new Error("Current Campaign pair has no exact compiler context; the edit was not saved.");
  }
  return { capabilitySnapshot, allowedLandingHosts, applicabilityProofs };
}

function launchStatus(status: PipelineRunStatus | "NOT_STARTED"): CampaignLaunchStatus {
  return status === "FAILED" ? "STOPPED" : status;
}

function dependentPairs(current: PipelineCurrentProducts) {
  return current.campaign_pairs.map((value, index) => {
    const pair = record(value);
    const hypothesis = record(pair.hypothesis);
    const draft = record(pair.draft);
    return {
      pair_revision_id: text(pair.pair_revision_id ?? `pair-${index + 1}`, 255),
      hypothesis_revision_id: text(hypothesis.hypothesis_revision_id ?? hypothesis.hypothesis_id, 255),
      draft_revision_id: text(draft.draft_revision_id ?? pair.draft_revision_id ?? `draft-${index + 1}`, 255),
    };
  });
}

export async function saveCurrentPipelineStrategyCorrection(input: {
  store: PipelineCurrentProductStore;
  ownerKey: string;
  runStatus: PipelineRunStatus | "NOT_STARTED";
  expectedStateRevision: number;
  expectedStrategyRevisionId: string;
  changes: CampaignStrategyCorrectionChanges;
  model: CampaignStrategyCorrectionModel;
  correctedAt?: string;
}) {
  const initial = await input.store.loadCurrent(input.ownerKey);
  if (!initial) throw new Error("Current Campaign Strategy was not found.");
  const stageProduct = record(initial.campaign_strategy);
  if (stageProduct.schema_version !== PRODUCTION_STRATEGY_STAGE_PRODUCT_SCHEMA) {
    throw new Error("Current Campaign Strategy does not have exact Stage Agent inputs.");
  }
  const strategy = record(stageProduct.strategy) as CurrentCampaignStrategyState["strategy"];
  const inputs = record(stageProduct.inputs) as CurrentCampaignStrategyState["inputs"];
  const state: CurrentCampaignStrategyState = {
    schema_version: CURRENT_CAMPAIGN_STRATEGY_SCHEMA,
    owner_key: input.ownerKey,
    state_revision: initial.state_revision,
    updated_at: initial.updated_at,
    launch_status: launchStatus(input.runStatus),
    strategy: clone(strategy),
    inputs: clone(inputs),
    campaign_pairs: dependentPairs(initial),
    last_invalidation: null,
  };
  const adapter: CurrentCampaignStrategyStore = {
    async loadCurrent() { return clone(state); },
    async compareAndSwap(_ownerKey, expectedRevision, next) {
      if (expectedRevision !== initial.state_revision) return false;
      const products: PipelineCurrentProducts = {
        ...clone(initial),
        state_revision: next.state_revision,
        current_stage: "STRATEGY",
        updated_at: next.updated_at,
        campaign_strategy: {
          schema_version: PRODUCTION_STRATEGY_STAGE_PRODUCT_SCHEMA,
          strategy: clone(next.strategy),
          inputs: clone(next.inputs),
          last_invalidation: clone(next.last_invalidation),
        },
        campaign_pairs: [],
        publication_review: null,
      };
      return input.store.compareAndSwap(input.ownerKey, expectedRevision, products);
    },
  };
  return saveCampaignStrategyCorrection({
    store: adapter,
    owner_key: input.ownerKey,
    expected_state_revision: input.expectedStateRevision,
    expected_strategy_revision_id: input.expectedStrategyRevisionId,
    changes: input.changes,
    model: input.model,
    corrected_at: input.correctedAt ?? new Date().toISOString(),
  });
}

function pairIdentity(value: PipelineJsonRecord, index: number) {
  const hypothesis = record(value.hypothesis);
  const draft = record(value.draft);
  const lineage = record(record(draft.publish_projection).lineage);
  const fingerprint = String(draft.publish_fingerprint ?? value.publish_fingerprint ?? "");
  return {
    pairId: text(value.pair_revision_id ?? value.pair_id ?? `pair-${index + 1}`, 255),
    hypothesisRevisionId: text(hypothesis.hypothesis_revision_id ?? hypothesis.hypothesis_id, 255),
    draftRevisionId: text(draft.draft_revision_id ?? lineage.draft_revision_id ?? value.draft_revision_id ?? `draft:${fingerprint.slice(7, 31)}`, 255),
    fingerprint,
    hypothesis,
    draft,
  };
}

function setProjectionValue(projection: PipelineJsonRecord, pointer: string, value: unknown) {
  const segments = pointer.slice(1).split("/");
  let current = projection;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (!next || typeof next !== "object" || Array.isArray(next)) current[segment] = {};
    current = current[segment] as PipelineJsonRecord;
  }
  current[segments.at(-1)!] = value;
}

function currentProjectionValue(projection: PipelineJsonRecord, pointer: string) {
  return pointer.slice(1).split("/").reduce<unknown>((value, segment) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return (value as PipelineJsonRecord)[segment];
  }, projection);
}

function revisionBase(value: string) {
  return value.replace(/(?::r[0-9a-f]{24})+$/gu, "");
}

function multilineValues(value: unknown, maximumItems: number, maximumLength: number) {
  const items = String(value ?? "").normalize("NFKC").split(/\r?\n/gu).map((item) => item.trim()).filter(Boolean);
  if (!items.length || items.length > maximumItems) throw new Error(`Edited list must contain 1-${maximumItems} lines.`);
  const normalized = items.map((item) => text(item, maximumLength));
  if (new Set(normalized).size !== normalized.length) throw new Error("Edited list values must be unique.");
  return normalized;
}

function providerTextValues(current: unknown, values: string[]) {
  if (!Array.isArray(current)) return values[0];
  if (current.length && current[0] && typeof current[0] === "object") {
    return values.map((value, index) => ({ ...record(current[index] ?? current[0]), Text: value }));
  }
  return values;
}

function applyTechnicalChanges(draft: PipelineJsonRecord, changes: Record<string, unknown>) {
  const projection = clone(record(draft.publish_projection));
  const scalarPointers: Record<string, [string, number]> = {
    campaign_name: ["/direct/campaign/Name", 255],
    group_name: ["/direct/ad_group/Name", 255],
    keyword: ["/direct/keyword/Keyword", 4_096],
  };
  for (const [field, [pointer, maximum]] of Object.entries(scalarPointers)) {
    if (!Object.hasOwn(changes, field)) continue;
    setProjectionValue(projection, pointer, text(changes[field], maximum));
  }
  for (const [field, pointer, maximumItems, maximumLength] of [
    ["ad_title", "/direct/ad/ResponsiveAd/Titles", 15, 56],
    ["ad_text", "/direct/ad/ResponsiveAd/Texts", 3, 81],
  ] as const) {
    if (!Object.hasOwn(changes, field)) continue;
    const values = multilineValues(changes[field], maximumItems, maximumLength);
    setProjectionValue(projection, pointer, providerTextValues(currentProjectionValue(projection, pointer), values));
  }
  if (Object.hasOwn(changes, "negative_keywords")) {
    const items = String(changes.negative_keywords ?? "").normalize("NFKC").split(/[\n,]+/gu).map((item) => item.trim()).filter(Boolean);
    if (!items.length || items.length > 200 || items.some((item) => item.length > 4_096) || new Set(items).size !== items.length) {
      throw new Error("Negative keywords must contain 1-200 unique non-empty values.");
    }
    setProjectionValue(projection, "/direct/ad_group/NegativeKeywords/Items", items);
  }
  const protocol = clone(record(draft.auction_protocol ?? {}));
  const projectionFields = new Set([...Object.keys(scalarPointers), "ad_title", "ad_text", "negative_keywords"]);
  for (const [field, value] of Object.entries(changes)) {
    if (projectionFields.has(field)) continue;
    protocol[field] = typeof value === "string" ? text(value, 1_000) : value;
  }
  return { projection, protocol };
}

function applySemanticChanges(
  hypothesis: PipelineJsonRecord,
  draft: PipelineJsonRecord,
  semantic: Record<string, unknown>,
  technical: Record<string, unknown>,
) {
  const nextHypothesis = clone(hypothesis);
  if (semantic.core_message || semantic.offer) nextHypothesis.mechanism = text(semantic.core_message ?? semantic.offer, 2_000);
  if (semantic.qualified_result) nextHypothesis.primary_metric = text(semantic.qualified_result, 1_000);
  const derived = { ...technical };
  if (semantic.product || semantic.offer) {
    const label = text(semantic.offer ?? semantic.product, 255);
    derived.campaign_name ??= label;
    derived.ad_title ??= text(label, 56);
  }
  if (semantic.audience) derived.group_name ??= text(semantic.audience, 255);
  if (semantic.core_message) derived.ad_text ??= text(semantic.core_message, 81);
  if (semantic.qualified_result) derived.measurement_goal ??= text(semantic.qualified_result, 1_000);
  const rebuilt = applyTechnicalChanges(draft, derived);
  const business = record(rebuilt.projection.business);
  if (semantic.product) business.product = text(semantic.product, 2_000);
  if (semantic.audience) business.audience = text(semantic.audience, 2_000);
  if (semantic.qualified_result) business.qualified_result = text(semantic.qualified_result, 2_000);
  if (semantic.core_message || semantic.offer) business.value = text(semantic.core_message ?? semantic.offer, 2_000);
  rebuilt.projection.business = business;
  return { hypothesis: nextHypothesis, ...rebuilt };
}

function bindEditedProjection(input: {
  projection: PipelineJsonRecord;
  strategyRevisionId: string;
  hypothesisRevisionId: string;
  draftRevisionId: string;
  rebuildClaims: boolean;
}) {
  const projection = clone(input.projection);
  const lineage = record(projection.lineage);
  if (String(lineage.strategy_revision_id ?? "") !== input.strategyRevisionId || !String(lineage.draft_id ?? "").trim()) {
    throw new Error("Current Campaign pair lineage is incomplete; the edit was not saved.");
  }
  lineage.campaign_hypothesis_revision_id = input.hypothesisRevisionId;
  lineage.draft_revision_id = input.draftRevisionId;
  projection.lineage = lineage;
  if (input.rebuildClaims) {
    const responsive = record(record(record(projection.direct).ad).ResponsiveAd);
    const copy = (value: unknown, maximum: number) => list(value).map((item) => text(
      item && typeof item === "object" && !Array.isArray(item) ? record(item).Text : item,
      maximum,
    ));
    projection.brand_claims_contract = buildBrandClaimsContract({
      strategyRevisionId: input.hypothesisRevisionId,
      titles: copy(responsive.Titles, 56),
      texts: copy(responsive.Texts, 81),
    });
  }
  return projection;
}

export async function saveCurrentPipelineCampaignPairEdit(input: {
  store: PipelineCurrentProductStore;
  ownerKey: string;
  runStatus: PipelineRunStatus | "NOT_STARTED";
  expectedStateRevision: number;
  edit: CampaignPairEditRequest;
  editedAt?: string;
}) {
  if (input.runStatus === "ACTIVE") throw new Error("Campaign pair is editable only outside an active run.");
  const current = await input.store.loadCurrent(input.ownerKey);
  if (!current || current.state_revision !== input.expectedStateRevision) throw new Error("Campaign working set changed; no field merge was attempted.");
  const plan = classifyCampaignPairEdit(input.edit);
  const identities = current.campaign_pairs.map(pairIdentity);
  const index = identities.findIndex((pair) => pair.pairId === plan.pair_id);
  if (index < 0) throw new Error("Current Campaign pair was not found.");
  const identity = identities[index];
  if (identity.hypothesisRevisionId !== input.edit.expected_hypothesis_revision_id
    || identity.draftRevisionId !== input.edit.expected_draft_revision_id) {
    throw new Error("Campaign pair revisions are stale; no field merge was attempted.");
  }
  const semantic = clone(input.edit.semantic_changes ?? {});
  const technical = clone(input.edit.technical_changes ?? {});
  const rebuilt = plan.classification === "SEMANTIC"
    ? applySemanticChanges(identity.hypothesis, identity.draft, semantic, technical)
    : { hypothesis: clone(identity.hypothesis), ...applyTechnicalChanges(identity.draft, technical) };
  const material = {
    hypothesis: rebuilt.hypothesis,
    publish_projection: rebuilt.projection,
    auction_protocol: rebuilt.protocol,
  };
  const previousMaterial = {
    hypothesis: identity.hypothesis,
    publish_projection: record(identity.draft.publish_projection),
    auction_protocol: record(identity.draft.auction_protocol ?? {}),
  };
  const [materialDigest, previousMaterialDigest] = await Promise.all([
    pipelineDigest(material),
    pipelineDigest(previousMaterial),
  ]);
  if (materialDigest === previousMaterialDigest) {
    return { status: "NO_OP" as const, material_change: false, state_revision: current.state_revision, pair: clone(current.campaign_pairs[index]) };
  }
  const editedAt = input.editedAt ?? new Date().toISOString();
  const revisionDigest = await pipelineDigest({ material, edited_at: editedAt });
  const short = revisionDigest.slice(7, 31);
  const hypothesisRevisionId = plan.classification === "SEMANTIC"
    ? `${revisionBase(identity.hypothesisRevisionId)}:r${short}`
    : identity.hypothesisRevisionId;
  const draftRevisionId = `${revisionBase(identity.draftRevisionId)}:r${short}`;
  const hypothesis: PipelineJsonRecord = { ...rebuilt.hypothesis, hypothesis_revision_id: hypothesisRevisionId };
  const sourcePair = record(current.campaign_pairs[index]);
  const strategyRevisionId = text(sourcePair.strategy_revision_id ?? hypothesis.strategy_revision_id, 255);
  const previousProjection = record(identity.draft.publish_projection);
  const creativePointers = ["/direct/ad/ResponsiveAd/Titles", "/direct/ad/ResponsiveAd/Texts"];
  const creativeChanged = creativePointers.some((pointer) => JSON.stringify(currentProjectionValue(previousProjection, pointer))
    !== JSON.stringify(currentProjectionValue(rebuilt.projection, pointer)));
  const projection = bindEditedProjection({
    projection: rebuilt.projection,
    strategyRevisionId,
    hypothesisRevisionId,
    draftRevisionId,
    rebuildClaims: creativeChanged,
  });
  const context = campaignPairEditContext(sourcePair);
  let compiled: Awaited<ReturnType<typeof compileDirectProjection>>;
  try {
    compiled = await compileDirectProjection({
      projection: projection as unknown as DirectProjection,
      capability_snapshot: context.capabilitySnapshot,
      allowed_landing_hosts: context.allowedLandingHosts,
      applicability_proofs: context.applicabilityProofs,
    });
  } catch (error) {
    if (!(error instanceof DirectProjectionCompilationError)) throw error;
    const details = error.violations.map((item) => `${item.code}${item.pointer ? ` at ${item.pointer}` : ""}`).join(", ");
    throw new Error(`Edited Campaign Draft failed deterministic compilation: ${details}.`);
  }
  const publishFingerprint = compiled.publish_fingerprint;
  if (publishFingerprint !== await fingerprintDirectProjection(compiled.publish_projection as unknown as PipelineJsonRecord)) {
    throw new Error("Edited Campaign Draft compiler fingerprint is inconsistent.");
  }
  const draft = {
    ...identity.draft,
    ...compiled,
    draft_revision_id: draftRevisionId,
    auction_protocol: rebuilt.protocol,
  };
  const pair = {
    ...clone(sourcePair),
    pair_revision_id: `${hypothesisRevisionId}::${draftRevisionId}`,
    hypothesis,
    draft,
    publish_fingerprint: publishFingerprint,
  };
  const pairs = current.campaign_pairs.map((value, pairIndex) => pairIndex === index ? pair : clone(value));
  const fingerprints = pairs.map((value, pairIndex) => pairIdentity(record(value), pairIndex).fingerprint).filter(Boolean);
  const next: PipelineCurrentProducts = {
    ...clone(current),
    state_revision: current.state_revision + 1,
    current_stage: "CAMPAIGNS",
    updated_at: editedAt,
    campaign_pairs: pairs,
    publication_review: {
      schema_version: PIPELINE_PUBLICATION_REVIEW_SCHEMA,
      status: "REVIEW_ONLY",
      run_id: current.run_id,
      pair_count: pairs.length,
      publish_fingerprints: fingerprints,
      external_write: "DENIED",
      publication: "NOT_AUTHORIZED",
      impressions: 0,
      spend_micros: 0,
    },
  };
  if (!await input.store.compareAndSwap(input.ownerKey, current.state_revision, next)) {
    throw new Error("Campaign working set changed while the revision was prepared.");
  }
  return {
    status: "SAVED" as const,
    material_change: true,
    state_revision: next.state_revision,
    classification: plan.classification,
    changed_fields: plan.changed_fields,
    previous_publish_fingerprint: identity.fingerprint,
    current_publish_fingerprint: publishFingerprint,
    pair: clone(pair),
  };
}
