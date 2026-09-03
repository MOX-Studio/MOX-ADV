import {
  AUCTION_PROTOCOL_EDITOR_FIELDS,
  DIRECT_V501_DRAFT_FIELD_REGISTRY,
} from "./campaign-draft-fields.ts";

export const CAMPAIGN_PAIR_EDIT_CONTRACT = "p0-campaign-pair-edit-v1";

export const CAMPAIGN_HYPOTHESIS_SEMANTIC_FIELDS = Object.freeze([
  "product",
  "audience",
  "offer",
  "qualified_result",
  "core_message",
] as const);

const directDraftFields = DIRECT_V501_DRAFT_FIELD_REGISTRY.fields
  .filter((field) => field.editable && field.input_name)
  .map((field) => String(field.input_name));
const auctionProtocolFields = AUCTION_PROTOCOL_EDITOR_FIELDS.map((field) => field.key);

export const CAMPAIGN_DRAFT_TECHNICAL_FIELDS = Object.freeze([
  ...directDraftFields,
  ...auctionProtocolFields,
] as const);

export type CampaignHypothesisSemanticField = (typeof CAMPAIGN_HYPOTHESIS_SEMANTIC_FIELDS)[number];
type DirectDraftTechnicalField = "campaign_name" | "group_name" | "negative_keywords" | "keyword" | "ad_title" | "ad_text";
type AuctionProtocolTechnicalField = (typeof AUCTION_PROTOCOL_EDITOR_FIELDS)[number]["key"];
export type CampaignDraftTechnicalField = DirectDraftTechnicalField | AuctionProtocolTechnicalField;
export type CampaignPairChangeClassification = "SEMANTIC" | "TECHNICAL";

type Changes<Field extends string> = Partial<Record<Field, unknown>>;

export type CampaignPairEditRequest = {
  pair_id: string;
  expected_hypothesis_revision_id: string;
  expected_draft_revision_id: string;
  semantic_changes?: Changes<CampaignHypothesisSemanticField>;
  technical_changes?: Changes<CampaignDraftTechnicalField>;
};

export type CampaignPairRebuildPlan = {
  schema_version: typeof CAMPAIGN_PAIR_EDIT_CONTRACT;
  pair_id: string;
  classification: CampaignPairChangeClassification;
  changed_fields: string[];
  rebuild_cone: {
    hypothesis: boolean;
    draft: true;
    independent_pairs: "PRESERVE_EXACT_REVISIONS";
  };
};

export type CampaignPairRevision<Hypothesis, Draft> = {
  pair_id: string;
  hypothesis_revision_id: string;
  draft_revision_id: string;
  hypothesis: Hypothesis;
  draft: Draft;
};

export class CampaignPairEditError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CampaignPairEditError";
    this.code = code;
  }
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredIdentifier(value: unknown, label: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized !== value || normalized.length > 255) {
    throw new CampaignPairEditError("CAMPAIGN_PAIR_EDIT_INVALID", `${label} must be one exact non-empty identifier.`);
  }
  return normalized;
}

function normalizedComparableText(value: unknown) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("ru-RU")
    : null;
}

function validateChanges(
  value: unknown,
  section: "semantic_changes" | "technical_changes",
  supportedFields: readonly string[],
) {
  if (value === undefined) return {};
  const changes = plainRecord(value);
  if (!changes) {
    throw new CampaignPairEditError("CAMPAIGN_PAIR_EDIT_INVALID", `${section} must be an object.`);
  }
  const unsupported = Object.keys(changes).find((field) => !supportedFields.includes(field));
  if (unsupported) {
    throw new CampaignPairEditError(
      "CAMPAIGN_PAIR_EDIT_FIELD_UNSUPPORTED",
      `${section}.${unsupported} is not supported by ${CAMPAIGN_PAIR_EDIT_CONTRACT}; no current Campaign pair was changed.`,
    );
  }
  const empty = Object.entries(changes).find(([, fieldValue]) => fieldValue === null
    || fieldValue === undefined
    || (typeof fieldValue === "string" && !fieldValue.normalize("NFKC").trim()));
  if (empty) {
    throw new CampaignPairEditError(
      "CAMPAIGN_PAIR_EDIT_VALUE_INVALID",
      `${section}.${empty[0]} must contain an explicit non-empty value; no current Campaign pair was changed.`,
    );
  }
  return changes;
}

function directDraftPointer(field: string) {
  return DIRECT_V501_DRAFT_FIELD_REGISTRY.fields.find((entry) => entry.input_name === field)?.pointer ?? null;
}

function technicalPointer(field: string) {
  return directDraftPointer(field) ?? `/auction_protocol/${field}`;
}

export function classifyCampaignPairEdit(value: unknown): CampaignPairRebuildPlan {
  const request = plainRecord(value);
  if (!request) {
    throw new CampaignPairEditError("CAMPAIGN_PAIR_EDIT_INVALID", "Campaign pair edit must be an object.");
  }
  const acceptedKeys = new Set([
    "pair_id",
    "expected_hypothesis_revision_id",
    "expected_draft_revision_id",
    "semantic_changes",
    "technical_changes",
  ]);
  const unsupportedKey = Object.keys(request).find((key) => !acceptedKeys.has(key));
  if (unsupportedKey) {
    throw new CampaignPairEditError(
      "CAMPAIGN_PAIR_EDIT_FIELD_UNSUPPORTED",
      `Campaign pair edit field ${unsupportedKey} is unsupported; no current Campaign pair was changed.`,
    );
  }

  const pairId = requiredIdentifier(request.pair_id, "Campaign pair");
  requiredIdentifier(request.expected_hypothesis_revision_id, "Expected Campaign Hypothesis revision");
  requiredIdentifier(request.expected_draft_revision_id, "Expected Campaign Draft revision");
  const semanticChanges = validateChanges(
    request.semantic_changes,
    "semantic_changes",
    CAMPAIGN_HYPOTHESIS_SEMANTIC_FIELDS,
  );
  const technicalChanges = validateChanges(
    request.technical_changes,
    "technical_changes",
    CAMPAIGN_DRAFT_TECHNICAL_FIELDS,
  );
  const semanticFields = CAMPAIGN_HYPOTHESIS_SEMANTIC_FIELDS.filter((field) => Object.hasOwn(semanticChanges, field));
  const technicalFields = CAMPAIGN_DRAFT_TECHNICAL_FIELDS.filter((field) => Object.hasOwn(technicalChanges, field));
  if (!semanticFields.length && !technicalFields.length) {
    throw new CampaignPairEditError(
      "CAMPAIGN_PAIR_EDIT_NO_CHANGE",
      "Campaign pair edit contains no supported semantic or technical changes; no current Campaign pair was changed.",
    );
  }

  if (Object.hasOwn(semanticChanges, "qualified_result") && Object.hasOwn(technicalChanges, "measurement_goal")) {
    const qualifiedResult = normalizedComparableText(semanticChanges.qualified_result);
    const measurementGoal = normalizedComparableText(technicalChanges.measurement_goal);
    if (qualifiedResult === null || measurementGoal === null || qualifiedResult !== measurementGoal) {
      throw new CampaignPairEditError(
        "CAMPAIGN_PAIR_EDIT_CONTRADICTORY",
        "semantic_changes.qualified_result conflicts with technical_changes.measurement_goal; the measured result must match the qualified result and no current Campaign pair was changed.",
      );
    }
  }

  const semantic = semanticFields.length > 0;
  return {
    schema_version: CAMPAIGN_PAIR_EDIT_CONTRACT,
    pair_id: pairId,
    classification: semantic ? "SEMANTIC" : "TECHNICAL",
    changed_fields: [
      ...semanticFields.map((field) => `/hypothesis/${field}`),
      ...technicalFields.map(technicalPointer),
    ],
    rebuild_cone: {
      hypothesis: semantic,
      draft: true,
      independent_pairs: "PRESERVE_EXACT_REVISIONS",
    },
  };
}

export async function prepareCampaignPairRebuild<Hypothesis, Draft>(input: {
  pairs: Array<CampaignPairRevision<Hypothesis, Draft>>;
  edit: CampaignPairEditRequest;
  rebuildHypothesis: (value: {
    previous: Hypothesis;
    semantic_changes: Changes<CampaignHypothesisSemanticField>;
  }) => Hypothesis | Promise<Hypothesis>;
  rebuildDraft: (value: {
    previous: Draft;
    hypothesis: Hypothesis;
    semantic_changes: Changes<CampaignHypothesisSemanticField>;
    technical_changes: Changes<CampaignDraftTechnicalField>;
  }) => Draft | Promise<Draft>;
}) {
  const plan = classifyCampaignPairEdit(input.edit);
  const matches = input.pairs.filter((pair) => pair.pair_id === plan.pair_id);
  if (matches.length !== 1) {
    throw new CampaignPairEditError(
      matches.length ? "CAMPAIGN_PAIR_EDIT_STATE_CONTRADICTORY" : "CAMPAIGN_PAIR_EDIT_PAIR_NOT_FOUND",
      matches.length
        ? `Campaign pair ${plan.pair_id} is duplicated in current state; no current Campaign pair was changed.`
        : `Campaign pair ${plan.pair_id} is not current; no current Campaign pair was changed.`,
    );
  }
  const current = matches[0];
  if (current.hypothesis_revision_id !== input.edit.expected_hypothesis_revision_id
    || current.draft_revision_id !== input.edit.expected_draft_revision_id) {
    throw new CampaignPairEditError(
      "CAMPAIGN_PAIR_EDIT_STALE",
      `Campaign pair ${plan.pair_id} no longer matches the expected Hypothesis and Draft revisions; no current Campaign pair was changed.`,
    );
  }

  const semanticChanges = structuredClone(input.edit.semantic_changes ?? {});
  const technicalChanges = structuredClone(input.edit.technical_changes ?? {});
  const hypothesis = plan.rebuild_cone.hypothesis
    ? await input.rebuildHypothesis({
        previous: structuredClone(current.hypothesis),
        semantic_changes: semanticChanges,
      })
    : current.hypothesis;
  if (hypothesis === null || hypothesis === undefined) {
    throw new CampaignPairEditError(
      "CAMPAIGN_PAIR_EDIT_REBUILD_INVALID",
      "Campaign Hypothesis rebuild returned no current content; no current Campaign pair was changed.",
    );
  }
  const draft = await input.rebuildDraft({
    previous: structuredClone(current.draft),
    hypothesis: structuredClone(hypothesis),
    semantic_changes: semanticChanges,
    technical_changes: technicalChanges,
  });
  if (draft === null || draft === undefined) {
    throw new CampaignPairEditError(
      "CAMPAIGN_PAIR_EDIT_REBUILD_INVALID",
      "Campaign Draft rebuild returned no current content; no current Campaign pair was changed.",
    );
  }

  return {
    plan,
    rebuild_candidate: {
      pair_id: current.pair_id,
      source_hypothesis_revision_id: current.hypothesis_revision_id,
      source_draft_revision_id: current.draft_revision_id,
      hypothesis,
      draft,
    },
    preserved_pairs: input.pairs.filter((pair) => pair !== current),
  };
}
