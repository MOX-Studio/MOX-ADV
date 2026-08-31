import {
  GOAL_CANDIDATE_SCHEMA,
  verifyGoalCandidate,
  verifyGoalFormationResult,
  type GoalRevision,
} from "./goal-revision.ts";

export const CURRENT_GOAL_SCHEMA = "p0-current-goal-v1";
export const GOAL_INVALIDATION_SCHEMA = "p0-goal-invalidation-v1";

export type GoalDependencyReference = {
  kind: "ANALYTICS_EVIDENCE" | "CAMPAIGN_STRATEGY" | "CAMPAIGN_PAIR";
  revision_id: string;
  explanation: string;
};

export type CurrentGoal = {
  schema_version: typeof CURRENT_GOAL_SCHEMA;
  owner_key: string;
  revision: GoalRevision;
  source: "GOAL_AGENT" | "OWNER_CORRECTION";
  invalidation: null | {
    schema_version: typeof GOAL_INVALIDATION_SCHEMA;
    previous_goal_revision_id: string;
    current_goal_revision_id: string;
    invalidated_at: string;
    dependencies: GoalDependencyReference[];
  };
};

export type GoalRevisionSaveResult = {
  material_change: boolean;
  current: CurrentGoal;
};

export interface CurrentGoalStore {
  loadCurrent(ownerKey: string): Promise<CurrentGoal | null>;
  append(current: CurrentGoal, expectedVersion: number | null): Promise<boolean>;
}

function normalizedMeaning(value: unknown, maximum = 1_000) {
  const text = String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!text || text.length > maximum) throw new Error("Goal correction is required and exceeds no field limit.");
  return text;
}

function sameMeaning(left: GoalRevision, desiredOutcome: string, qualifiedAction: string) {
  return normalizedMeaning(left.desired_outcome) === desiredOutcome
    && normalizedMeaning(left.qualified_action) === qualifiedAction;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export async function reviseCurrentGoal(input: {
  current: CurrentGoal;
  desired_outcome: string;
  qualified_action: string;
  corrected_at: string;
  dependencies: GoalDependencyReference[];
}): Promise<GoalRevisionSaveResult> {
  await verifyGoalFormationResult({ status: "VERIFIED", revision: input.current.revision });
  const desiredOutcome = normalizedMeaning(input.desired_outcome);
  const qualifiedAction = normalizedMeaning(input.qualified_action);
  if (sameMeaning(input.current.revision, desiredOutcome, qualifiedAction)) {
    return { material_change: false, current: clone(input.current) };
  }

  const correctionInputId = `owner_goal_correction_v${input.current.revision.version + 1}`;
  const correctionMaterial = {
    previous_goal_revision_id: input.current.revision.goal_revision_id,
    desired_outcome: desiredOutcome,
    qualified_action: qualifiedAction,
  };
  const correctionDigest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(correctionMaterial)),
  );
  const correctionReference = {
    input_id: correctionInputId,
    schema_version: "p0-owner-goal-correction-v1",
    revision_id: `goal-correction:${input.current.revision.version + 1}`,
    digest: `sha256:${[...new Uint8Array(correctionDigest)].map((item) => item.toString(16).padStart(2, "0")).join("")}`,
  };
  const previousInputIds = input.current.revision.exact_inputs.map((reference) => reference.input_id);
  const result = await verifyGoalCandidate({
    candidate: {
      schema_version: GOAL_CANDIDATE_SCHEMA,
      desired_outcome: desiredOutcome,
      qualified_action: qualifiedAction,
      used_input_ids: [...previousInputIds, correctionInputId],
      provenance: [{
        supports: "DESIRED_OUTCOME",
        input_id: correctionInputId,
        locator: "owner_correction.desired_outcome",
        evidence: desiredOutcome,
      }, {
        supports: "QUALIFIED_ACTION",
        input_id: correctionInputId,
        locator: "owner_correction.qualified_action",
        evidence: qualifiedAction,
      }],
      known_constraints: clone(input.current.revision.known_constraints),
      material_ambiguity: null,
    },
    exact_inputs: [...clone(input.current.revision.exact_inputs), correctionReference],
    verified_at: input.corrected_at,
    previous_version: input.current.revision.version,
  });
  if (result.status !== "VERIFIED") throw new Error("An owner correction cannot produce a material decision packet.");
  const dependencies = clone(input.dependencies);
  const current: CurrentGoal = {
    schema_version: CURRENT_GOAL_SCHEMA,
    owner_key: input.current.owner_key,
    revision: result.revision,
    source: "OWNER_CORRECTION",
    invalidation: {
      schema_version: GOAL_INVALIDATION_SCHEMA,
      previous_goal_revision_id: input.current.revision.goal_revision_id,
      current_goal_revision_id: result.revision.goal_revision_id,
      invalidated_at: input.corrected_at,
      dependencies,
    },
  };
  return { material_change: true, current };
}

export function goalDependencies(input: {
  analytics_evidence_snapshot: { revision_id: string } | null;
  campaign_strategy_revision: { revision_id: string } | null;
  campaign_pairs: Array<{ hypothesis: { revision_id: string }; draft: { revision_id: string } }>;
}): GoalDependencyReference[] {
  const dependencies: GoalDependencyReference[] = [];
  if (input.analytics_evidence_snapshot) dependencies.push({
    kind: "ANALYTICS_EVIDENCE",
    revision_id: input.analytics_evidence_snapshot.revision_id,
    explanation: "Сведения были собраны для предыдущей Цели и требуют пересборки.",
  });
  if (input.campaign_strategy_revision) dependencies.push({
    kind: "CAMPAIGN_STRATEGY",
    revision_id: input.campaign_strategy_revision.revision_id,
    explanation: "Campaign Strategy зависит от предыдущей Цели и требует пересборки.",
  });
  for (const pair of input.campaign_pairs) dependencies.push({
    kind: "CAMPAIGN_PAIR",
    revision_id: `${pair.hypothesis.revision_id}::${pair.draft.revision_id}`,
    explanation: "Пара Campaign Hypothesis + Campaign Draft зависит от предыдущей Strategy и требует пересборки.",
  });
  return dependencies;
}
