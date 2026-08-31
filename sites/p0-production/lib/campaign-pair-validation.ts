import { evaluateBrandClaimsContract } from "./campaign-creation-profile.ts";
import {
  DIRECT_V501_DRAFT_FIELD_REGISTRY,
  isCanonicalDirectV501DraftFieldRegistry,
  projectionFieldValue,
} from "./campaign-draft-fields.ts";
import { fingerprintDirectProjection } from "./campaign-fanout.ts";
import { strategyAnswerValue, strategyPeriod } from "./campaign-strategy.ts";

export const CAMPAIGN_PAIR_VALIDATION_SCHEMA = "campaign-pair-validation-v1";
export const CAMPAIGN_PAIR_VALIDATION_CONTRACT = "1.0.0";

export type CampaignPairViolationCategory =
  | "PAIR_COMPLETENESS"
  | "FIELD_APPLICABILITY"
  | "POLICY"
  | "EVIDENCE"
  | "DIRECT_CAPABILITY";

export type CampaignPairViolationExecutor =
  | "STRATEGY_AGENT"
  | "CAMPAIGN_DESIGN_AGENT"
  | "EVIDENCE_ANALYST"
  | "DIRECT_COMPILER";

export type CampaignPairViolation = {
  category: CampaignPairViolationCategory;
  code: string;
  executor: CampaignPairViolationExecutor;
  return_target: "STRATEGY" | "EVIDENCE_COLLECTION" | "CAMPAIGNS";
  pointer: string;
  message: string;
};

export type CampaignPairCheck = {
  pair_id: string;
  hypothesis_revision_id: string | null;
  draft_id: string | null;
  draft_revision_id: string | null;
  publish_fingerprint: string | null;
  included: boolean;
  violations: CampaignPairViolation[];
};

export type CampaignPairValidationResult = {
  schema_version: typeof CAMPAIGN_PAIR_VALIDATION_SCHEMA;
  contract_version: typeof CAMPAIGN_PAIR_VALIDATION_CONTRACT;
  strategy_revision_id: string | null;
  evidence_snapshot_id: string | null;
  field_registry_schema: string;
  pairs: CampaignPairCheck[];
};

type ValidationInput = {
  recommendationSet: Record<string, unknown>;
  strategy: Record<string, unknown>;
  analyticsEvidence: Record<string, unknown>;
};

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const CODE = /^[A-Z][A-Z0-9_]{1,79}$/u;
const text = (value: unknown) => String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

function exactKeys(value: object, keys: string[]) {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function violation(
  category: CampaignPairViolationCategory,
  code: string,
  executor: CampaignPairViolationExecutor,
  returnTarget: CampaignPairViolation["return_target"],
  pointer: string,
  message: string,
): CampaignPairViolation {
  return { category, code, executor, return_target: returnTarget, pointer, message };
}

function pairViolation(code: string, pointer: string, message: string) {
  return violation("PAIR_COMPLETENESS", code, "CAMPAIGN_DESIGN_AGENT", "CAMPAIGNS", pointer, message);
}

function compilerViolation(category: "FIELD_APPLICABILITY" | "DIRECT_CAPABILITY", code: string, pointer: string, message: string) {
  return violation(category, code, "DIRECT_COMPILER", "CAMPAIGNS", pointer, message);
}

function strategyAndPairMeaningAreComplete(
  strategy: Record<string, unknown>,
  projection: Record<string, unknown>,
  violations: CampaignPairViolation[],
) {
  const period = strategyPeriod(strategy);
  const strategyValues = {
    business_goal: strategyAnswerValue(strategy, "business_goal"),
    advertised_offer: strategyAnswerValue(strategy, "advertised_offer"),
    target_audience: strategyAnswerValue(strategy, "target_audience"),
    qualified_result: strategyAnswerValue(strategy, "qualified_result"),
    exclusions: strategyAnswerValue(strategy, "exclusions"),
    geography: strategyAnswerValue(strategy, "geography"),
    landing_page: strategyAnswerValue(strategy, "landing_page"),
    weekly_budget: strategyAnswerValue(strategy, "weekly_budget"),
    core_message: strategyAnswerValue(strategy, "core_message"),
    period_start: period.start_date,
    period_end: period.end_date,
  };
  const missing = Object.entries(strategyValues).filter(([, value]) => !text(value)).map(([name]) => name);
  if (missing.length > 0) {
    violations.push(violation(
      "PAIR_COMPLETENESS",
      "STRATEGY_CONTENT_INCOMPLETE",
      "STRATEGY_AGENT",
      "STRATEGY",
      `/strategy/${missing[0]}`,
      `Campaign Strategy не содержит обязательные поля: ${missing.join(", ")}.`,
    ));
  }
  const business = record(projection.business);
  const responsiveAd = record(record(record(projection.direct).ad).ResponsiveAd);
  const mismatches = [
    [business.product, strategyValues.advertised_offer, "/publish_projection/business/product"],
    [business.audience, strategyValues.target_audience, "/publish_projection/business/audience"],
    [business.qualified_result, strategyValues.qualified_result, "/publish_projection/business/qualified_result"],
    [business.goal, strategyValues.business_goal, "/publish_projection/business/goal"],
    [responsiveAd.Href, strategyValues.landing_page, "/publish_projection/direct/ad/ResponsiveAd/Href"],
  ].filter(([actual, expected]) => text(actual) !== text(expected));
  for (const [, , pointer] of mismatches) {
    violations.push(pairViolation(
      "PAIR_BUSINESS_MEANING_MISMATCH",
      String(pointer),
      "Campaign Hypothesis + Draft незаметно расходятся с текущим бизнес-смыслом Campaign Strategy.",
    ));
  }
}

function projectionIsComplete(projection: Record<string, unknown>, violations: CampaignPairViolation[]) {
  const direct = record(projection.direct);
  const campaign = record(direct.campaign);
  const unifiedCampaign = record(campaign.UnifiedCampaign);
  const bidding = record(unifiedCampaign.BiddingStrategy);
  const search = record(bidding.Search);
  const placements = record(search.PlacementTypes);
  const maximumClicks = record(search.WbMaximumClicks);
  const network = record(bidding.Network);
  const adGroup = record(direct.ad_group);
  const keyword = record(direct.keyword);
  const responsiveAd = record(record(direct.ad).ResponsiveAd);
  const required: Array<[unknown, string]> = [
    [campaign.Name, "/publish_projection/direct/campaign/Name"],
    [campaign.StartDate, "/publish_projection/direct/campaign/StartDate"],
    [campaign.EndDate, "/publish_projection/direct/campaign/EndDate"],
    [campaign.TimeZone, "/publish_projection/direct/campaign/TimeZone"],
    [unifiedCampaign.TrackingParams, "/publish_projection/direct/campaign/UnifiedCampaign/TrackingParams"],
    [adGroup.Name, "/publish_projection/direct/ad_group/Name"],
    [keyword.Keyword, "/publish_projection/direct/keyword/Keyword"],
    [responsiveAd.Href, "/publish_projection/direct/ad/ResponsiveAd/Href"],
  ];
  for (const [value, pointer] of required) {
    if (!text(value)) violations.push(pairViolation("DRAFT_PROJECTION_PARTIAL", pointer, "Direct Projection не содержит обязательное значение поддерживаемого профиля."));
  }
  for (const [values, pointer] of [
    [list(adGroup.RegionIds), "/publish_projection/direct/ad_group/RegionIds"],
    [list(record(adGroup.NegativeKeywords).Items), "/publish_projection/direct/ad_group/NegativeKeywords/Items"],
    [list(responsiveAd.Titles), "/publish_projection/direct/ad/ResponsiveAd/Titles"],
    [list(responsiveAd.Texts), "/publish_projection/direct/ad/ResponsiveAd/Texts"],
  ] as Array<[unknown[], string]>) {
    if (values.length === 0 || values.some((value) => !text(value))) {
      violations.push(pairViolation("DRAFT_PROJECTION_PARTIAL", pointer, "Direct Projection не содержит обязательный полный набор значений поддерживаемого профиля."));
    }
  }
  if (!record(adGroup.UnifiedAdGroup).OfferRetargeting) {
    violations.push(pairViolation("DRAFT_PROJECTION_PARTIAL", "/publish_projection/direct/ad_group/UnifiedAdGroup", "Direct Projection не содержит полный UnifiedAdGroup."));
  }
  if (search.BiddingStrategyType !== "WB_MAXIMUM_CLICKS"
    || placements.SearchResults !== "YES"
    || !(Number(maximumClicks.WeeklySpendLimit) > 0)
    || network.BiddingStrategyType !== "SERVING_OFF") {
    violations.push(compilerViolation(
      "DIRECT_CAPABILITY",
      "DIRECT_PROFILE_SEMANTICS_INVALID",
      "/publish_projection/direct/campaign/UnifiedCampaign/BiddingStrategy",
      "Профиль должен использовать ЕПК / Поиск / WB_MAXIMUM_CLICKS и отключённые сети.",
    ));
  }
  const safety = record(projection.safety);
  if (safety.must_end_non_serving !== true || safety.resume_allowed !== false || safety.network_serving !== false) {
    violations.push(compilerViolation(
      "DIRECT_CAPABILITY",
      "NON_SERVING_SAFETY_INVALID",
      "/publish_projection/safety",
      "Draft обязан оставаться непубликующим и не разрешать показы, расход или resume.",
    ));
  }
}

function leafPointers(value: unknown, pointer: string): string[] {
  if (Array.isArray(value)) return value.length
    ? value.flatMap((item, index) => leafPointers(item, `${pointer}/${index}`))
    : [pointer];
  if (!value || typeof value !== "object") return [pointer];
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length ? entries.flatMap(([key, item]) => leafPointers(item, `${pointer}/${key}`)) : [pointer];
}

function fieldApplicabilityIsComplete(
  recommendationSet: Record<string, unknown>,
  draft: Record<string, unknown>,
  projection: Record<string, unknown>,
  violations: CampaignPairViolation[],
) {
  if (!isCanonicalDirectV501DraftFieldRegistry(recommendationSet.field_registry)) {
    violations.push(compilerViolation(
      "FIELD_APPLICABILITY",
      "FIELD_REGISTRY_INVALID",
      "/recommendation_set/field_registry",
      "Нужен точный версионированный реестр применимости полей Direct v501.",
    ));
    return;
  }
  const selection = record(draft.capability_selection);
  const selectedFields = new Set(list(selection.selected_fields).map(text).filter(Boolean));
  const measurementPlan = record(record(projection.creation_profile).measurement_plan);
  for (const field of DIRECT_V501_DRAFT_FIELD_REGISTRY.fields) {
    const value = projectionFieldValue(projection, field.pointer);
    let expectedPresent = field.presence === "PRESENT";
    if (field.pointer === "/direct/campaign/UnifiedCampaign/CounterIds") {
      expectedPresent = /^\d+$/u.test(text(measurementPlan.counter_id));
    } else if (field.classification === "CONDITIONALLY_ELIGIBLE") {
      expectedPresent = selectedFields.has(field.pointer);
    }
    if (expectedPresent && value === undefined) {
      violations.push(compilerViolation(
        "FIELD_APPLICABILITY",
        "APPLICABLE_FIELD_MISSING",
        `/publish_projection${field.pointer}`,
        `Применимое поле «${field.label}» отсутствует в Direct Projection.`,
      ));
    }
    if (!expectedPresent && value !== undefined) {
      violations.push(compilerViolation(
        "FIELD_APPLICABILITY",
        "INAPPLICABLE_FIELD_PRESENT",
        `/publish_projection${field.pointer}`,
        `Поле «${field.label}» присутствует без доказанной применимости.`,
      ));
    }
  }
  for (const pointer of selectedFields) {
    const field = DIRECT_V501_DRAFT_FIELD_REGISTRY.fields.find((candidate) => candidate.pointer === pointer);
    if (!field || !field.capability) {
      violations.push(compilerViolation(
        "FIELD_APPLICABILITY",
        "SELECTED_FIELD_OUTSIDE_REGISTRY",
        `/capability_selection/selected_fields/${pointer}`,
        "Выбранное условное поле отсутствует в закрытом реестре применимости.",
      ));
    }
  }
  for (const pointer of leafPointers(projection.direct, "/direct")) {
    const registered = DIRECT_V501_DRAFT_FIELD_REGISTRY.fields.some((field) =>
      pointer === field.pointer || pointer.startsWith(`${field.pointer}/`));
    if (!registered) {
      violations.push(compilerViolation(
        "FIELD_APPLICABILITY",
        "FIELD_OUTSIDE_REGISTRY",
        `/publish_projection${pointer}`,
        "Direct Projection содержит поле вне закрытого реестра применимости.",
      ));
    }
  }
}

function policyIsSatisfied(
  recommendationSet: Record<string, unknown>,
  draft: Record<string, unknown>,
  hypothesis: Record<string, unknown>,
  projection: Record<string, unknown>,
  violations: CampaignPairViolation[],
) {
  const responsiveAd = record(record(record(projection.direct).ad).ResponsiveAd);
  for (const blocker of evaluateBrandClaimsContract(
    projection.brand_claims_contract,
    [...list(responsiveAd.Titles), ...list(responsiveAd.Texts)],
  )) {
    violations.push(violation("POLICY", blocker.code, "CAMPAIGN_DESIGN_AGENT", "CAMPAIGNS", "/publish_projection/brand_claims_contract", blocker.message));
  }
  if (text(draft.suppression_reason) || text(draft.duplicate_of)) {
    violations.push(violation(
      "POLICY",
      "PAIR_SUPPRESSED_OR_DUPLICATE",
      "CAMPAIGN_DESIGN_AGENT",
      "CAMPAIGNS",
      "/draft/suppression_reason",
      "Отброшенное или дублирующее направление не становится текущей парой.",
    ));
  }
  if (list(draft.unsupported_fields).length > 0) {
    violations.push(compilerViolation(
      "FIELD_APPLICABILITY",
      "UNSUPPORTED_FIELDS_SELECTED",
      "/draft/unsupported_fields",
      "Direct Projection содержит поля вне поддерживаемого профиля.",
    ));
  }
  const source = text(hypothesis.source);
  if (source === "ACTIVE_PLAYBOOK") {
    const release = record(recommendationSet.playbook_release);
    if (release.status !== "ACTIVE_APPROVED"
      || !text(draft.playbook_release_id)
      || text(draft.playbook_release_id) !== text(release.release_id)
      || !text(draft.playbook_rule_id)) {
      violations.push(violation(
        "POLICY",
        "PLAYBOOK_POLICY_LINEAGE_INVALID",
        "CAMPAIGN_DESIGN_AGENT",
        "CAMPAIGNS",
        "/draft/playbook_release_id",
        "Campaign Hypothesis должна ссылаться на точный активный и одобренный Campaign Playbook release.",
      ));
    }
  } else if (source !== "COMPETITOR_PUBLIC_WEB" && source !== "EVIDENCE_GROUNDED_DESIGN") {
    violations.push(violation(
      "POLICY",
      "HYPOTHESIS_SOURCE_UNSUPPORTED",
      "CAMPAIGN_DESIGN_AGENT",
      "CAMPAIGNS",
      "/variant/hypothesis/source",
      "Источник Campaign Hypothesis не разрешён текущей политикой.",
    ));
  }
}

function evidenceIsSufficient(
  recommendationSet: Record<string, unknown>,
  analyticsEvidence: Record<string, unknown>,
  hypothesis: Record<string, unknown>,
  violations: CampaignPairViolation[],
) {
  const snapshotId = text(analyticsEvidence.snapshot_id);
  if (!snapshotId || !text(analyticsEvidence.schema_version)
    || text(recommendationSet.analytics_evidence_snapshot_id) !== snapshotId) {
    violations.push(violation(
      "EVIDENCE",
      "EVIDENCE_SNAPSHOT_LINEAGE_INVALID",
      "EVIDENCE_ANALYST",
      "EVIDENCE_COLLECTION",
      "/analytics_evidence/snapshot_id",
      "Пара должна ссылаться на текущий неизменяемый Analytics Evidence Snapshot.",
    ));
  }
  const source = text(hypothesis.source);
  const hypothesisEvidence = list(hypothesis.evidence_refs).map(text).filter(Boolean);
  const competitorEvidence = list(hypothesis.evidence_ids).map(text).filter(Boolean);
  if ((source === "COMPETITOR_PUBLIC_WEB" && competitorEvidence.length === 0)
    || (source === "EVIDENCE_GROUNDED_DESIGN" && hypothesisEvidence.length === 0)) {
    violations.push(violation(
      "EVIDENCE",
      "HYPOTHESIS_EVIDENCE_MISSING",
      "EVIDENCE_ANALYST",
      "EVIDENCE_COLLECTION",
      "/variant/hypothesis/evidence_refs",
      "Evidence-grounded Campaign Hypothesis должна иметь точные evidence refs.",
    ));
  }
}

function directCapabilityIsSatisfied(
  recommendationSet: Record<string, unknown>,
  draft: Record<string, unknown>,
  projection: Record<string, unknown>,
  violations: CampaignPairViolation[],
) {
  const profile = record(projection.creation_profile);
  if (profile.profile_id !== "p0-campaign-creation-profile-v1"
    || profile.profile_version !== "1.0.0"
    || profile.endpoint_version !== "v501") {
    violations.push(compilerViolation(
      "DIRECT_CAPABILITY",
      "DIRECT_PROFILE_UNSUPPORTED",
      "/publish_projection/creation_profile",
      "Direct Compiler поддерживает только профиль ЕПК / Поиск / WB_MAXIMUM_CLICKS на API v501.",
    ));
  }
  const selection = record(draft.capability_selection);
  const selectedCapabilities = list(selection.selected_capabilities).map(text).filter(Boolean);
  const selectedFields = list(selection.selected_fields).map(text).filter(Boolean);
  const snapshotId = text(draft.direct_capability_snapshot_id);
  if ((selectedCapabilities.length > 0 || selectedFields.length > 0) && !snapshotId) {
    violations.push(compilerViolation(
      "DIRECT_CAPABILITY",
      "CONDITIONAL_CAPABILITY_EVIDENCE_MISSING",
      "/draft/direct_capability_snapshot_id",
      "Условная возможность требует точного снимка возможностей аккаунта.",
    ));
  }
  const advertiser = record(profile.advertiser);
  if (snapshotId && (text(recommendationSet.direct_capability_snapshot_id) !== snapshotId
    || text(selection.capability_snapshot_id) !== snapshotId
    || text(advertiser.capability_snapshot_id) !== snapshotId
    || selection.eligible !== true)) {
    violations.push(compilerViolation(
      "DIRECT_CAPABILITY",
      "DIRECT_CAPABILITY_SELECTION_INVALID",
      "/draft/capability_selection",
      "Выбранные поля не подтверждены тем же снимком возможностей Direct.",
    ));
  }
}

export async function validateCampaignPairs(input: ValidationInput): Promise<CampaignPairValidationResult> {
  const recommendationSet = record(input.recommendationSet);
  const strategy = record(input.strategy);
  const analyticsEvidence = record(input.analyticsEvidence);
  const drafts = list(recommendationSet.drafts).map(record);
  const hypothesisIds = drafts.map((draft) => text(record(record(draft.variant).hypothesis).hypothesis_id)).filter(Boolean);
  const draftIds = drafts.map((draft) => text(draft.draft_id)).filter(Boolean);
  const duplicateHypotheses = new Set(hypothesisIds.filter((id, index) => hypothesisIds.indexOf(id) !== index));
  const duplicateDrafts = new Set(draftIds.filter((id, index) => draftIds.indexOf(id) !== index));
  const strategyRevisionId = text(strategy.strategy_revision_id);
  const pairs: CampaignPairCheck[] = [];

  for (const [index, draft] of drafts.entries()) {
    const hypothesis = record(record(draft.variant).hypothesis);
    const hypothesisId = text(hypothesis.hypothesis_id);
    const draftId = text(draft.draft_id);
    const draftRevisionId = text(draft.draft_revision_id);
    const publishFingerprint = text(draft.publish_fingerprint);
    const pairId = hypothesisId && draftId ? `${hypothesisId}::${draftId}` : `campaign-pair-candidate:${index + 1}`;
    const violations: CampaignPairViolation[] = [];

    if (!strategyRevisionId) {
      violations.push(violation("PAIR_COMPLETENESS", "STRATEGY_REVISION_MISSING", "STRATEGY_AGENT", "STRATEGY", "/strategy/strategy_revision_id", "Нужна полная текущая Campaign Strategy revision."));
    }
    if (!hypothesisId || !text(hypothesis.mechanism)) {
      violations.push(pairViolation("HYPOTHESIS_INCOMPLETE", "/variant/hypothesis", "Campaign Hypothesis должна иметь точную редакцию и проверяемый механизм."));
    }
    if (!draftId || !draftRevisionId || !publishFingerprint) {
      violations.push(pairViolation("DRAFT_IDENTITY_INCOMPLETE", "/draft", "Campaign Draft должен иметь точные identity, revision и publish fingerprint."));
    }
    if (duplicateHypotheses.has(hypothesisId)) {
      violations.push(pairViolation("HYPOTHESIS_CARDINALITY_VIOLATION", "/variant/hypothesis/hypothesis_id", "Одна текущая Campaign Hypothesis не может определять несколько Draft."));
    }
    if (duplicateDrafts.has(draftId)) {
      violations.push(pairViolation("DRAFT_CARDINALITY_VIOLATION", "/draft/draft_id", "Один текущий Campaign Draft не может входить в несколько пар."));
    }
    const projection = record(draft.publish_projection);
    const lineage = record(projection.lineage);
    if (text(draft.strategy_revision_id) !== strategyRevisionId
      || text(lineage.strategy_revision_id) !== strategyRevisionId
      || text(lineage.draft_id) !== draftId
      || text(lineage.draft_revision_id) !== draftRevisionId) {
      violations.push(pairViolation("PAIR_LINEAGE_MISMATCH", "/publish_projection/lineage", "Hypothesis + Draft должны происходить из текущих точных редакций Strategy и Draft."));
    }

    strategyAndPairMeaningAreComplete(strategy, projection, violations);
    projectionIsComplete(projection, violations);
    fieldApplicabilityIsComplete(recommendationSet, draft, projection, violations);
    policyIsSatisfied(recommendationSet, draft, hypothesis, projection, violations);
    evidenceIsSufficient(recommendationSet, analyticsEvidence, hypothesis, violations);
    directCapabilityIsSatisfied(recommendationSet, draft, projection, violations);

    if (publishFingerprint && SHA256_DIGEST.test(publishFingerprint)) {
      if (await fingerprintDirectProjection(projection) !== publishFingerprint) {
        violations.push(pairViolation("PUBLISH_FINGERPRINT_MISMATCH", "/draft/publish_fingerprint", "Publish fingerprint не соответствует точной текущей Direct Projection."));
      }
    } else if (publishFingerprint) {
      violations.push(pairViolation("PUBLISH_FINGERPRINT_INVALID", "/draft/publish_fingerprint", "Publish fingerprint должен быть SHA-256 digest."));
    }

    violations.sort((left, right) => `${left.category}:${left.code}:${left.pointer}`.localeCompare(`${right.category}:${right.code}:${right.pointer}`));
    pairs.push({
      pair_id: pairId,
      hypothesis_revision_id: hypothesisId || null,
      draft_id: draftId || null,
      draft_revision_id: draftRevisionId || null,
      publish_fingerprint: publishFingerprint || null,
      included: violations.length === 0,
      violations,
    });
  }

  return {
    schema_version: CAMPAIGN_PAIR_VALIDATION_SCHEMA,
    contract_version: CAMPAIGN_PAIR_VALIDATION_CONTRACT,
    strategy_revision_id: strategyRevisionId || null,
    evidence_snapshot_id: text(analyticsEvidence.snapshot_id) || null,
    field_registry_schema: text(record(recommendationSet.field_registry).schema_version),
    pairs,
  };
}

export function assertCampaignPairValidationResult(value: unknown): asserts value is CampaignPairValidationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Campaign pair validation result is required.");
  const result = value as CampaignPairValidationResult;
  if (!exactKeys(result, ["schema_version", "contract_version", "strategy_revision_id", "evidence_snapshot_id", "field_registry_schema", "pairs"])
    || result.schema_version !== CAMPAIGN_PAIR_VALIDATION_SCHEMA
    || result.contract_version !== CAMPAIGN_PAIR_VALIDATION_CONTRACT
    || (result.strategy_revision_id !== null && !text(result.strategy_revision_id))
    || (result.evidence_snapshot_id !== null && !text(result.evidence_snapshot_id))
    || typeof result.field_registry_schema !== "string"
    || !Array.isArray(result.pairs)) {
    throw new Error("Campaign pair validation result does not match the closed schema.");
  }
  for (const pair of result.pairs) {
    if (!pair || !exactKeys(pair, ["pair_id", "hypothesis_revision_id", "draft_id", "draft_revision_id", "publish_fingerprint", "included", "violations"])
      || !text(pair.pair_id)
      || (pair.hypothesis_revision_id !== null && !text(pair.hypothesis_revision_id))
      || (pair.draft_id !== null && !text(pair.draft_id))
      || (pair.draft_revision_id !== null && !text(pair.draft_revision_id))
      || (pair.publish_fingerprint !== null && !SHA256_DIGEST.test(pair.publish_fingerprint))
      || typeof pair.included !== "boolean" || !Array.isArray(pair.violations)
      || pair.included !== (pair.violations.length === 0)
      || (pair.included && (!pair.hypothesis_revision_id || !pair.draft_id || !pair.draft_revision_id || !pair.publish_fingerprint))) {
      throw new Error("Campaign pair check is invalid.");
    }
    for (const item of pair.violations) {
      if (!item || !exactKeys(item, ["category", "code", "executor", "return_target", "pointer", "message"])
        || !["PAIR_COMPLETENESS", "FIELD_APPLICABILITY", "POLICY", "EVIDENCE", "DIRECT_CAPABILITY"].includes(item.category)
        || !["STRATEGY_AGENT", "CAMPAIGN_DESIGN_AGENT", "EVIDENCE_ANALYST", "DIRECT_COMPILER"].includes(item.executor)
        || !["STRATEGY", "EVIDENCE_COLLECTION", "CAMPAIGNS"].includes(item.return_target)
        || !CODE.test(item.code) || !text(item.pointer) || !text(item.message)) {
        throw new Error("Campaign pair violation is invalid.");
      }
    }
  }
}
