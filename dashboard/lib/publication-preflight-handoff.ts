import { fingerprintDirectProjection } from "./campaign-fanout.ts";

export const PUBLICATION_PREFLIGHT_HANDOFF_SCHEMA = "publication-preflight-handoff-v1";

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;

export type PublicationReviewDraft = {
  draft_id: string;
  draft_revision_id: string;
  publish_fingerprint: string;
  publish_projection: Record<string, unknown>;
};

export type PublicationPreflightHandoff = {
  schema_version: typeof PUBLICATION_PREFLIGHT_HANDOFF_SCHEMA;
  source_module: "BASE_CAMPAIGN_PIPELINE";
  target_module: "PUBLICATION_MODULE";
  draft: {
    draft_id: string;
    draft_revision_id: string;
    publish_fingerprint: string;
  };
  required_sequence: {
    capability_snapshot: {
      freshness: "COLLECT_AFTER_HANDOFF";
      exact_account_binding: true;
      produced_by: "PUBLICATION_MODULE";
    };
    preflight: {
      freshness: "RUN_AFTER_FRESH_CAPABILITY_SNAPSHOT";
      exact_publish_fingerprint: string;
      produced_by: "PUBLICATION_MODULE";
    };
    human_decision_gate: {
      timing: "AFTER_PREFLIGHT";
      exact_publish_fingerprint: string;
      reusable_after_draft_change: false;
      produced_by: "PUBLICATION_MODULE";
    };
  };
  deferred_to_target_module: [
    "CAPABILITY_SNAPSHOT_REFRESH",
    "PREFLIGHT",
    "PUBLICATION",
    "MODERATION",
    "LAUNCH",
    "SPEND",
  ];
  base_pipeline_boundary: {
    external_write: "DENIED";
    publication_authority: "NOT_GRANTED";
    provider_identifiers: "ABSENT";
    moderation: "NOT_STARTED";
    launch: "NOT_STARTED";
    spend: "NOT_STARTED";
  };
  provider_identifier_policy: {
    values: [];
    may_appear: "ONLY_IN_PUBLICATION_MODULE_AFTER_AUTHORIZED_WRITE";
  };
};

export type FuturePublicationDecisionBinding = {
  publish_fingerprint: string;
  capability_snapshot_id: string;
  preflight_id: string;
  human_decision_id: string;
};

function requiredText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 255) {
    throw new Error(`${label} must be one exact non-empty identifier.`);
  }
  return value;
}

/**
 * Creates a zero-authority handoff for one exact current Campaign Draft.
 * The receiving module must perform every fresh check and decision in the
 * declared order before it can obtain publication authority.
 */
export async function buildPublicationPreflightHandoff(
  draft: PublicationReviewDraft,
): Promise<PublicationPreflightHandoff> {
  const draftId = requiredText(draft?.draft_id, "Campaign Draft");
  const draftRevisionId = requiredText(draft?.draft_revision_id, "Campaign Draft revision");
  if (!draft?.publish_projection || typeof draft.publish_projection !== "object" || Array.isArray(draft.publish_projection)) {
    throw new Error("Campaign Draft publish projection is required.");
  }
  if (!SHA256_DIGEST.test(String(draft.publish_fingerprint))) {
    throw new Error("Campaign Draft publish fingerprint must be one SHA-256 digest.");
  }
  const currentFingerprint = await fingerprintDirectProjection(draft.publish_projection);
  if (currentFingerprint !== draft.publish_fingerprint) {
    throw new Error("Campaign Draft publish fingerprint does not match the exact current projection.");
  }

  return {
    schema_version: PUBLICATION_PREFLIGHT_HANDOFF_SCHEMA,
    source_module: "BASE_CAMPAIGN_PIPELINE",
    target_module: "PUBLICATION_MODULE",
    draft: {
      draft_id: draftId,
      draft_revision_id: draftRevisionId,
      publish_fingerprint: currentFingerprint,
    },
    required_sequence: {
      capability_snapshot: {
        freshness: "COLLECT_AFTER_HANDOFF",
        exact_account_binding: true,
        produced_by: "PUBLICATION_MODULE",
      },
      preflight: {
        freshness: "RUN_AFTER_FRESH_CAPABILITY_SNAPSHOT",
        exact_publish_fingerprint: currentFingerprint,
        produced_by: "PUBLICATION_MODULE",
      },
      human_decision_gate: {
        timing: "AFTER_PREFLIGHT",
        exact_publish_fingerprint: currentFingerprint,
        reusable_after_draft_change: false,
        produced_by: "PUBLICATION_MODULE",
      },
    },
    deferred_to_target_module: [
      "CAPABILITY_SNAPSHOT_REFRESH",
      "PREFLIGHT",
      "PUBLICATION",
      "MODERATION",
      "LAUNCH",
      "SPEND",
    ],
    base_pipeline_boundary: {
      external_write: "DENIED",
      publication_authority: "NOT_GRANTED",
      provider_identifiers: "ABSENT",
      moderation: "NOT_STARTED",
      launch: "NOT_STARTED",
      spend: "NOT_STARTED",
    },
    provider_identifier_policy: {
      values: [],
      may_appear: "ONLY_IN_PUBLICATION_MODULE_AFTER_AUTHORIZED_WRITE",
    },
  };
}

/**
 * Describes exact-binding applicability only; it does not run preflight or
 * mint a Human Decision Gate in the base pipeline.
 */
export function futurePublicationDecisionApplies(
  handoff: PublicationPreflightHandoff,
  decision: FuturePublicationDecisionBinding,
) {
  return decision.publish_fingerprint === handoff.draft.publish_fingerprint
    && decision.publish_fingerprint === handoff.required_sequence.preflight.exact_publish_fingerprint
    && decision.publish_fingerprint === handoff.required_sequence.human_decision_gate.exact_publish_fingerprint
    && requiredDecisionReference(decision.capability_snapshot_id)
    && requiredDecisionReference(decision.preflight_id)
    && requiredDecisionReference(decision.human_decision_id);
}

function requiredDecisionReference(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value === value.trim() && value.length <= 255;
}
