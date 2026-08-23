import { canonicalizeEvidence } from "./analytics-evidence.ts";

export const AUCTION_PROTOCOL_SCHEMA = "p0-auction-protocol-v1";
export const AUCTION_PROTOCOL_CONTRACT_VERSION = "1.0.0";

export type AuctionAttribution = {
  status: "ONE_FACTOR" | "MULTI_FACTOR" | "NON_COMPARABLE" | "COMPARATOR_ONLY";
  one_factor_claim_allowed: boolean;
  comparator_draft_id: string | null;
  material_families: string[];
  explanation: string;
};

export type AuctionProtocol = {
  schema_version: typeof AUCTION_PROTOCOL_SCHEMA;
  contract_version: typeof AUCTION_PROTOCOL_CONTRACT_VERSION;
  protocol_revision_id: string;
  previous_protocol_revision_id: string | null;
  draft_id: string;
  draft_revision_id: string;
  strategy_revision_id: string;
  evidence_snapshot_id: string;
  affected_draft_ids: string[];
  control: string;
  tested_change: string;
  bidding: { strategy: string; ceiling_rub: number };
  query_matching: string;
  autotargeting_policy: string;
  traffic_split: { comparator_percent: number; treatment_percent: number };
  test_budget_rub: number;
  test_period: { start_date: string; end_date: string };
  measurement_goal: string;
  success_threshold: string;
  stop_condition: string;
  attribution: AuctionAttribution;
  provider_facts: {
    source: "FROZEN_DRAFT_PROJECTION";
    bidding_strategy_code: string;
    weekly_spend_limit_micro_rub: number;
    bid_ceiling_micro_rub: number;
    keyword: string;
    autotargeting_selected: boolean;
  };
  test_assumptions: {
    source: "OWNER_REVIEWED_HYPOTHESIS";
    uncertainty: string;
  };
  knowledge_status: "PREREGISTERED_HYPOTHESIS_NOT_PROVIDER_FACT";
  registered_at: string;
  registered_by: "AGENT_PROPOSED_OWNER_REVIEWABLE" | "OWNER_EDITED";
  p1_lineage: {
    handoff_contract: "P1_MATURE_RESULT_EVIDENCE_V1";
    protocol_revision_id: string;
    draft_revision_id: string;
    evidence_snapshot_id: string;
    authority_effect: "NONE";
  };
  content_hash: string;
};

type DraftRecord = Record<string, unknown>;

const text = (value: unknown, maximum = 1_000) => String(value ?? "")
  .normalize("NFKC")
  .replace(/\s+/gu, " ")
  .trim()
  .slice(0, maximum);

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

const exactKeys = (value: unknown, keys: string[]) => Boolean(value && typeof value === "object" && !Array.isArray(value)
  && JSON.stringify(Object.keys(value as Record<string, unknown>).sort()) === JSON.stringify([...keys].sort()));

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(canonicalizeEvidence(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

function projectionFacts(draft: DraftRecord) {
  const projection = record(draft.publish_projection);
  const creationProfile = record(projection.creation_profile);
  const autotargeting = record(creationProfile.autotargeting_policy);
  const direct = record(projection.direct);
  const campaign = record(direct.campaign);
  const search = record(record(record(campaign.UnifiedCampaign).BiddingStrategy).Search);
  const maximumClicks = record(search.WbMaximumClicks);
  const keyword = record(direct.keyword);
  return {
    campaign,
    facts: {
      source: "FROZEN_DRAFT_PROJECTION" as const,
      bidding_strategy_code: text(search.BiddingStrategyType, 100),
      weekly_spend_limit_micro_rub: Number(maximumClicks.WeeklySpendLimit),
      bid_ceiling_micro_rub: Number(maximumClicks.BidCeiling),
      keyword: text(keyword.Keyword, 500),
      autotargeting_selected: autotargeting.selected === true,
    },
  };
}

function attributionFor(draft: DraftRecord): AuctionAttribution {
  const variant = record(draft.variant);
  const delta = record(draft.treatment_delta);
  const comparator = text(delta.comparator_draft_id ?? variant.comparator_draft_id, 255) || null;
  if (variant.kind === "CONTROL") {
    return {
      status: "COMPARATOR_ONLY",
      one_factor_claim_allowed: false,
      comparator_draft_id: null,
      material_families: [],
      explanation: "Контроль является comparator и сам по себе не заявляет причинную атрибуцию.",
    };
  }
  const family = text(delta.changed_family, 100);
  const fields = Array.isArray(delta.changed_fields) ? delta.changed_fields.map((item) => text(item, 500)).filter(Boolean) : [];
  const exactlyOne = delta.material === true && delta.exactly_one_hypothesis_family === true && Boolean(comparator && family && fields.length);
  if (exactlyOne) {
    return {
      status: "ONE_FACTOR",
      one_factor_claim_allowed: true,
      comparator_draft_id: comparator,
      material_families: [family],
      explanation: "Treatment отличается от comparator ровно одной подтверждённой material family; остальные publishable families удерживаются постоянными.",
    };
  }
  if (delta.material === true && fields.length) {
    return {
      status: "MULTI_FACTOR",
      one_factor_claim_allowed: false,
      comparator_draft_id: comparator,
      material_families: family ? [family] : [],
      explanation: "Treatment содержит material change, но exact one-factor contrast не доказан; результат нельзя приписывать одной family.",
    };
  }
  return {
    status: "NON_COMPARABLE",
    one_factor_claim_allowed: false,
    comparator_draft_id: comparator,
    material_families: family ? [family] : [],
    explanation: "Сопоставимый material contrast не зафиксирован; причинная one-factor атрибуция запрещена.",
  };
}

function positiveInteger(value: unknown, label: string, maximum = 1_000_000_000) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) throw new Error(`${label} должен быть положительным целым числом в разрешённой границе.`);
  return result;
}

function percent(value: unknown, label: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0 || result > 100) throw new Error(`${label} должен быть целым процентом от 0 до 100.`);
  return result;
}

function required(value: unknown, label: string, maximum = 1_000) {
  const result = text(value, maximum);
  if (!result) throw new Error(`${label} не заполнено.`);
  return result;
}

function isoDate(value: unknown, label: string) {
  const result = required(value, label, 10);
  const parsed = Date.parse(`${result}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(result) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== result) {
    throw new Error(`${label} должен быть календарной датой.`);
  }
  return result;
}

function businessValues(value: Record<string, unknown>) {
  const bidding = record(value.bidding);
  const split = record(value.traffic_split);
  const period = record(value.test_period);
  const comparatorPercent = percent(split.comparator_percent, "Доля comparator traffic");
  const treatmentPercent = percent(split.treatment_percent, "Доля treatment traffic");
  if (comparatorPercent + treatmentPercent !== 100) throw new Error("Traffic split должен суммироваться ровно в 100%.");
  const startDate = isoDate(period.start_date, "Начало теста");
  const endDate = isoDate(period.end_date, "Окончание теста");
  if (Date.parse(`${endDate}T00:00:00.000Z`) < Date.parse(`${startDate}T00:00:00.000Z`)) throw new Error("Окончание теста не может быть раньше начала.");
  return {
    control: required(value.control, "Control"),
    tested_change: required(value.tested_change, "Tested change"),
    bidding: {
      strategy: required(bidding.strategy, "Bidding strategy", 300),
      ceiling_rub: positiveInteger(bidding.ceiling_rub, "Bid ceiling"),
    },
    query_matching: required(value.query_matching, "Query matching", 500),
    autotargeting_policy: required(value.autotargeting_policy, "Autotargeting policy", 500),
    traffic_split: { comparator_percent: comparatorPercent, treatment_percent: treatmentPercent },
    test_budget_rub: positiveInteger(value.test_budget_rub, "Test budget"),
    test_period: { start_date: startDate, end_date: endDate },
    measurement_goal: required(value.measurement_goal, "Measurement goal"),
    success_threshold: required(value.success_threshold, "Success threshold"),
    stop_condition: required(value.stop_condition, "Stop condition"),
  };
}

function defaultValues(draft: DraftRecord, measurementGoal: string) {
  const { campaign, facts } = projectionFacts(draft);
  const oneFactor = attributionFor(draft).status === "ONE_FACTOR";
  const variant = record(draft.variant);
  const hypothesis = record(variant.hypothesis);
  return businessValues({
    control: oneFactor ? "Точная исходная кампания для сравнения" : "Текущая подтверждённая поисковая формулировка",
    tested_change: variant.kind === "CONTROL" ? "Контроль без дополнительного изменения" : hypothesis.mechanism || "Ограниченное изменение рекламной формулировки",
    bidding: {
      strategy: facts.bidding_strategy_code === "WB_MAXIMUM_CLICKS" ? "Максимум переходов в недельном бюджете" : facts.bidding_strategy_code,
      ceiling_rub: Math.floor(facts.bid_ceiling_micro_rub / 1_000_000),
    },
    query_matching: "Широкое соответствие заданной фразе",
    autotargeting_policy: facts.autotargeting_selected ? "Разрешён подтверждённый профиль автотаргетинга" : "Только заданные ключевые фразы; автотаргетинг выключен",
    traffic_split: oneFactor ? { comparator_percent: 50, treatment_percent: 50 } : { comparator_percent: 100, treatment_percent: 0 },
    test_budget_rub: Math.floor(facts.weekly_spend_limit_micro_rub / 1_000_000),
    test_period: { start_date: campaign.StartDate, end_date: campaign.EndDate },
    measurement_goal: measurementGoal,
    success_threshold: "К моменту окончания теста primary measurement goal достигается без нарушения stop condition; вывод остаётся scoped evidence, не прогнозом.",
    stop_condition: "Остановить treatment при исчерпании test budget, завершении периода, потере измеримости или любом нарушении non-serving safety/authority.",
  });
}

async function seal(input: Omit<AuctionProtocol, "protocol_revision_id" | "p1_lineage" | "content_hash">): Promise<AuctionProtocol> {
  const revisionDigest = await sha256(input);
  const protocolRevisionId = `auction-protocol:${revisionDigest.slice("sha256:".length)}`;
  const unsigned = {
    ...input,
    protocol_revision_id: protocolRevisionId,
    p1_lineage: {
      handoff_contract: "P1_MATURE_RESULT_EVIDENCE_V1" as const,
      protocol_revision_id: protocolRevisionId,
      draft_revision_id: input.draft_revision_id,
      evidence_snapshot_id: input.evidence_snapshot_id,
      authority_effect: "NONE" as const,
    },
  };
  return { ...unsigned, content_hash: await sha256(unsigned) };
}

export async function buildAuctionProtocol(input: {
  draft: DraftRecord;
  measurementGoal: string;
  evidenceSnapshotId: string;
  registeredAt: string;
}) {
  const draftId = required(input.draft.draft_id, "Campaign Draft", 255);
  const draftRevisionId = required(input.draft.draft_revision_id, "Campaign Draft revision", 255);
  const strategyRevisionId = required(input.draft.strategy_revision_id, "Campaign Strategy revision", 255);
  const evidenceSnapshotId = required(input.evidenceSnapshotId, "Analytics Evidence Snapshot", 255);
  const values = defaultValues(input.draft, required(input.measurementGoal, "Measurement goal"));
  return seal({
    schema_version: AUCTION_PROTOCOL_SCHEMA,
    contract_version: AUCTION_PROTOCOL_CONTRACT_VERSION,
    previous_protocol_revision_id: null,
    draft_id: draftId,
    draft_revision_id: draftRevisionId,
    strategy_revision_id: strategyRevisionId,
    evidence_snapshot_id: evidenceSnapshotId,
    affected_draft_ids: [draftId],
    ...values,
    attribution: attributionFor(input.draft),
    provider_facts: projectionFacts(input.draft).facts,
    test_assumptions: {
      source: "OWNER_REVIEWED_HYPOTHESIS",
      uncertainty: "До mature result неизвестно, улучшит ли treatment выбранный outcome; provider facts не подтверждают эту гипотезу.",
    },
    knowledge_status: "PREREGISTERED_HYPOTHESIS_NOT_PROVIDER_FACT",
    registered_at: required(input.registeredAt, "Registration time", 100),
    registered_by: "AGENT_PROPOSED_OWNER_REVIEWABLE",
  });
}

export async function reviseAuctionProtocol(input: {
  previous: AuctionProtocol;
  draft: DraftRecord;
  values: Record<string, unknown>;
  registeredAt: string;
}) {
  const values = businessValues(input.values);
  const previousValues = businessValues(input.previous as unknown as Record<string, unknown>);
  const lineageAndFactsUnchanged = input.previous.draft_id === input.draft.draft_id
    && input.previous.draft_revision_id === input.draft.draft_revision_id
    && input.previous.strategy_revision_id === input.draft.strategy_revision_id
    && JSON.stringify(input.previous.provider_facts) === JSON.stringify(projectionFacts(input.draft).facts)
    && JSON.stringify(input.previous.attribution) === JSON.stringify(attributionFor(input.draft));
  if (JSON.stringify(values) === JSON.stringify(previousValues) && lineageAndFactsUnchanged) return { material_change: false as const, protocol: structuredClone(input.previous) };
  const next = await seal({
    schema_version: AUCTION_PROTOCOL_SCHEMA,
    contract_version: AUCTION_PROTOCOL_CONTRACT_VERSION,
    previous_protocol_revision_id: input.previous.protocol_revision_id,
    draft_id: required(input.draft.draft_id, "Campaign Draft", 255),
    draft_revision_id: required(input.draft.draft_revision_id, "Campaign Draft revision", 255),
    strategy_revision_id: required(input.draft.strategy_revision_id, "Campaign Strategy revision", 255),
    evidence_snapshot_id: input.previous.evidence_snapshot_id,
    affected_draft_ids: [required(input.draft.draft_id, "Campaign Draft", 255)],
    ...values,
    attribution: attributionFor(input.draft),
    provider_facts: projectionFacts(input.draft).facts,
    test_assumptions: structuredClone(input.previous.test_assumptions),
    knowledge_status: "PREREGISTERED_HYPOTHESIS_NOT_PROVIDER_FACT",
    registered_at: required(input.registeredAt, "Registration time", 100),
    registered_by: "OWNER_EDITED",
  });
  return { material_change: true as const, protocol: next };
}

export function auctionProtocolBusinessCompletenessBlockers(protocol: unknown): string[] {
  const candidate = record(protocol);
  const blockers: string[] = [];
  try {
    businessValues(candidate);
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : "Auction Protocol incomplete.");
  }
  if (candidate.schema_version !== AUCTION_PROTOCOL_SCHEMA || candidate.contract_version !== AUCTION_PROTOCOL_CONTRACT_VERSION) blockers.push("Auction Protocol schema or contract is unsupported.");
  const attribution = record(candidate.attribution);
  if (!["ONE_FACTOR", "MULTI_FACTOR", "NON_COMPARABLE", "COMPARATOR_ONLY"].includes(String(attribution.status ?? ""))) blockers.push("Auction Protocol attribution status is missing.");
  if (attribution.one_factor_claim_allowed === true && (attribution.status !== "ONE_FACTOR" || !Array.isArray(attribution.material_families) || attribution.material_families.length !== 1)) blockers.push("One-factor claim requires exactly one named material family.");
  if (candidate.knowledge_status !== "PREREGISTERED_HYPOTHESIS_NOT_PROVIDER_FACT") blockers.push("Auction Protocol must remain a hypothesis, never a provider fact.");
  return blockers;
}

export function auctionProtocolCompletenessBlockers(protocol: unknown, draft: DraftRecord): string[] {
  const candidate = record(protocol);
  const blockers = auctionProtocolBusinessCompletenessBlockers(candidate);
  if (candidate.draft_id !== draft.draft_id || candidate.draft_revision_id !== draft.draft_revision_id || candidate.strategy_revision_id !== draft.strategy_revision_id) blockers.push("Auction Protocol immutable Campaign lineage mismatch.");
  const attribution = attributionFor(draft);
  if (JSON.stringify(candidate.attribution) !== JSON.stringify(attribution)) blockers.push("Auction Protocol attribution is not honest for the exact material treatment family.");
  const facts = projectionFacts(draft).facts;
  if (JSON.stringify(candidate.provider_facts) !== JSON.stringify(facts)) blockers.push("Auction Protocol provider facts do not match the frozen Draft projection.");
  return blockers;
}

export async function verifyAuctionProtocolContentHash(protocol: unknown) {
  const candidate = record(protocol);
  const contentHash = text(candidate.content_hash, 100);
  if (!/^sha256:[a-f0-9]{64}$/u.test(contentHash)) return false;
  const unsigned = { ...candidate };
  delete unsigned.content_hash;
  return contentHash === await sha256(unsigned);
}

export async function verifyAuctionProtocol(protocol: unknown, draft: DraftRecord) {
  const candidate = record(protocol) as AuctionProtocol;
  if (!exactKeys(candidate, [
    "schema_version", "contract_version", "protocol_revision_id", "previous_protocol_revision_id", "draft_id", "draft_revision_id",
    "strategy_revision_id", "evidence_snapshot_id", "affected_draft_ids", "control", "tested_change", "bidding", "query_matching",
    "autotargeting_policy", "traffic_split", "test_budget_rub", "test_period", "measurement_goal", "success_threshold", "stop_condition",
    "attribution", "provider_facts", "test_assumptions", "knowledge_status", "registered_at", "registered_by", "p1_lineage", "content_hash",
  ]) || !exactKeys(candidate.bidding, ["strategy", "ceiling_rub"])
    || !exactKeys(candidate.traffic_split, ["comparator_percent", "treatment_percent"])
    || !exactKeys(candidate.test_period, ["start_date", "end_date"])
    || !exactKeys(candidate.attribution, ["status", "one_factor_claim_allowed", "comparator_draft_id", "material_families", "explanation"])
    || !exactKeys(candidate.provider_facts, ["source", "bidding_strategy_code", "weekly_spend_limit_micro_rub", "bid_ceiling_micro_rub", "keyword", "autotargeting_selected"])
    || !exactKeys(candidate.test_assumptions, ["source", "uncertainty"])
    || !exactKeys(candidate.p1_lineage, ["handoff_contract", "protocol_revision_id", "draft_revision_id", "evidence_snapshot_id", "authority_effect"])
    || auctionProtocolCompletenessBlockers(candidate, draft).length
    || candidate.knowledge_status !== "PREREGISTERED_HYPOTHESIS_NOT_PROVIDER_FACT"
    || candidate.provider_facts.source !== "FROZEN_DRAFT_PROJECTION"
    || candidate.test_assumptions.source !== "OWNER_REVIEWED_HYPOTHESIS"
    || candidate.p1_lineage.protocol_revision_id !== candidate.protocol_revision_id
    || candidate.p1_lineage.draft_revision_id !== candidate.draft_revision_id
    || candidate.p1_lineage.evidence_snapshot_id !== candidate.evidence_snapshot_id
    || candidate.p1_lineage.authority_effect !== "NONE"
    || !Array.isArray(candidate.affected_draft_ids)
    || JSON.stringify(candidate.affected_draft_ids) !== JSON.stringify([candidate.draft_id])) return false;
  if (!await verifyAuctionProtocolContentHash(candidate)) return false;
  const unsigned = { ...candidate } as Record<string, unknown>;
  delete unsigned.content_hash;
  const revisionInput = { ...unsigned } as Record<string, unknown>;
  delete revisionInput.protocol_revision_id;
  delete revisionInput.p1_lineage;
  const revisionDigest = await sha256(revisionInput);
  return candidate.protocol_revision_id === `auction-protocol:${revisionDigest.slice("sha256:".length)}`;
}
