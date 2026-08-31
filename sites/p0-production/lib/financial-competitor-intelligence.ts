export const FINANCIAL_COMPETITOR_INTELLIGENCE_SCHEMA = "p0-financial-competitor-intelligence-v1";
export const FINANCIAL_COMPETITOR_INTELLIGENCE_CONTRACT_VERSION = "1.0.0";

export type FinancialCapabilityStatus = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
export type FinancialMetric = "REVENUE" | "NET_PROFIT" | "ASSETS" | "CAPITAL" | "LONG_TERM_LIABILITIES" | "SHORT_TERM_LIABILITIES";
export type FinancialMissingReason =
  | "NO_FILING_EXPECTED"
  | "ACCESS_RESTRICTED"
  | "FILING_NOT_FOUND"
  | "NOT_YET_DUE"
  | "AUTH_OR_SUBSCRIPTION_REQUIRED"
  | "FORMAT_UNSUPPORTED"
  | "ACTIVITY_REVENUE_UNALLOCATED"
  | "FILING_STATUS_UNKNOWN";

export type FrozenFinancialFrameInput = {
  product: {
    product_or_service: string;
    customer_need: string;
    included_offers: string[];
    excluded_offers: string[];
    evidence_refs: string[];
  };
  customer: {
    description: string;
    evidence_refs: string[];
  };
  geography: {
    kind: "SALES_AREA" | "DELIVERY_AREA" | "SERVICE_AREA" | "REGISTRATION_PROXY";
    regions: Array<{ official_id: string; name: string }>;
    evidence_refs: string[];
    limitation: string | null;
  };
  period: {
    period_start: string;
    period_end: string;
    reporting_years: number[];
    as_of_date: string;
  };
  okved: {
    classifier: "OK_029_2014_KDES_REV_2";
    classifier_version: string;
    codes: Array<{
      code: string;
      inclusion: "ANY_OF" | "REQUIRED_PRIMARY" | "EVIDENCED_ADDITIONAL";
      rationale: string;
    }>;
    activity_rule_version: string;
  };
  competitor_rule: {
    version: string;
    inclusion_rule: string;
  };
};

export type FinancialLegalEntityInput = {
  entity_id: string;
  role: "COMPANY" | "COMPETITOR";
  inn: string;
  ogrn: string;
  legal_name: string;
  relation: "OPERATOR" | "OWNER" | "SELLER" | "MANUFACTURER" | "LICENSEE" | "OTHER";
  resolution_status: "CONFIRMED" | "UNRESOLVED";
  evidence: Array<{
    evidence_ref: string;
    evidence_kind: "LEGAL_IDENTITY" | "BRAND_OR_PRODUCT_RELATION";
    source_kind: "EGRUL" | "OFFICIAL_REGISTRY" | "OFFICIAL_BRAND_DISCLOSURE" | "USER_PROVIDED_DOCUMENT";
    source_locator: string;
    observed_at: string;
    status: "VERIFIED" | "UNVERIFIED";
  }>;
};

export type GirBoFinancialRecordInput = {
  record_id: string;
  entity_id: string;
  reporting_year: number;
  period_start: string;
  period_end: string;
  statement_kind: "BALANCE" | "FINANCIAL_RESULTS";
  form_variant: "FULL" | "SIMPLIFIED" | "NONPROFIT" | "FINANCIAL_ORG" | "UNKNOWN";
  accounting_standard: string;
  format_version: string;
  column_role: "CURRENT" | "COMPARATIVE";
  metric: FinancialMetric;
  line_code: string;
  line_name_raw: string;
  value_raw: string;
  value_decimal: string;
  unit_raw: string;
  unit_multiplier: 1 | 1000 | 1000000;
  currency: "RUB";
  provenance: {
    source_system: "GIR_BO_FNS";
    access_channel: "OFFICIAL_SUBSCRIPTION_BULK" | "OFFICIAL_SIGNED_DOCUMENT";
    source_locator: string;
    source_file_name: string;
    source_hash_sha256: string;
    signature_present: boolean | null;
    signature_verified: boolean | null;
    fetched_at: string;
    resource_as_of_date: string;
    parser_name: string;
    parser_version: string;
  };
  revision: {
    correction_indicator: "ORIGINAL" | "CORRECTED" | "UNKNOWN";
    supersedes_record_id: string | null;
  };
  quality: {
    status: "ACCEPTED" | "ACCEPTED_WITH_WARNINGS" | "QUARANTINED" | "REJECTED";
    flags: string[];
    identity_match: "PASS" | "FAIL" | "UNKNOWN";
    period_valid: "PASS" | "FAIL" | "UNKNOWN";
    unit_known: "PASS" | "FAIL" | "UNKNOWN";
  };
};

export type FinancialMissingObservationInput = {
  entity_id: string;
  reporting_year: number;
  metric: FinancialMetric;
  reason: FinancialMissingReason;
  source_ref: string | null;
  limitation: string;
};

export type FinancialScopeMatch = {
  product_or_service: string;
  customer_need: string;
  geography_official_ids: string[];
  period_start: string;
  period_end: string;
  okved_codes: string[];
};

export type FinancialStrategicInterpretationInput = {
  interpretation_id: string;
  statement: string;
  financial_record_refs: string[];
  independent_nonfinancial_evidence: Array<{
    evidence_ref: string;
    family: "PRODUCT" | "CUSTOMER" | "POSITIONING" | "DEMAND" | "PUBLIC_AD_OBSERVATION";
    scope: FinancialScopeMatch;
  }>;
  competing_explanations: string[];
  limitations: string[];
  affected_strategy_fields: Array<"campaign_focus" | "advertised_offer" | "target_audience" | "geography" | "core_message">;
  falsifiable_consequence: string | null;
};

export type ObservedSegmentRevenueShareInput = {
  reporting_year: number;
  population_frame_complete: boolean;
  company_group_policy: "SINGLE_ENTITY" | "CONSOLIDATED";
  revenue_attributions: Array<{
    financial_record_ref: string;
    scope: FinancialScopeMatch;
    attribution_policy: "WHOLE_ENTITY_IF_SINGLE_ACTIVITY" | "DIRECT_SEGMENT_DISCLOSURE";
    evidence_refs: string[];
  }>;
};

export type FinancialCompetitorIntelligenceInput = {
  frame: FrozenFinancialFrameInput;
  legal_entities: FinancialLegalEntityInput[];
  financial_records: GirBoFinancialRecordInput[];
  missing_financial_data: FinancialMissingObservationInput[];
  strategic_interpretations: FinancialStrategicInterpretationInput[];
  observed_segment_revenue_share?: ObservedSegmentRevenueShareInput;
  generated_at: string;
};

export type FinancialCompetitorIntelligence = {
  schema_version: typeof FINANCIAL_COMPETITOR_INTELLIGENCE_SCHEMA;
  contract_version: typeof FINANCIAL_COMPETITOR_INTELLIGENCE_CONTRACT_VERSION;
  dossier_id: string;
  generated_at: string;
  capability_status: FinancialCapabilityStatus;
  frozen_frame: FrozenFinancialFrameInput & { frame_id: string };
  legal_perimeter: {
    accepted_entities: Array<FinancialLegalEntityInput & { perimeter_ref: string }>;
    excluded_entities: Array<{ entity_id: string; legal_name: string; reason: "ENTITY_UNRESOLVED" | "IDENTITY_EVIDENCE_INCOMPLETE" }>;
  };
  accepted_records: Array<GirBoFinancialRecordInput & { normalized_value_rub: string }>;
  excluded_records: Array<{ record_id: string; entity_id: string; reason: string }>;
  profiles: Array<{
    entity_id: string;
    legal_name: string;
    role: "COMPANY" | "COMPETITOR";
    observations: Array<{
      reporting_year: number;
      metric: FinancialMetric;
      status: "AVAILABLE" | "UNAVAILABLE";
      value_rub: string | null;
      record_id: string | null;
      missing_reason: FinancialMissingReason | null;
      limitation: string | null;
    }>;
    reporting_periods: number[];
    missing_reasons: FinancialMissingReason[];
  }>;
  strategy_claims: Array<{
    interpretation_id: string;
    statement: string;
    financial_record_refs: string[];
    independent_nonfinancial_evidence_refs: string[];
    affected_strategy_fields: FinancialStrategicInterpretationInput["affected_strategy_fields"];
    competing_explanations: string[];
    limitations: string[];
    falsifiable_consequence: string | null;
  }>;
  suppressed_strategy_claims: Array<{
    interpretation_id: string;
    reason: "FINANCIAL_RECORD_UNAVAILABLE" | "INDEPENDENT_NONFINANCIAL_EVIDENCE_REQUIRED" | "NONFINANCIAL_SCOPE_MISMATCH" | "PROHIBITED_FINANCIAL_INFERENCE";
  }>;
  observed_segment_revenue_share: {
    label: "Observed Segment Revenue Share";
    status: "AVAILABLE_COMPLETE_FOR_DECLARED_FRAME" | "AVAILABLE_PARTIAL_OBSERVED_COHORT" | "NUMERATOR_UNAVAILABLE" | "DENOMINATOR_UNAVAILABLE" | "SEMANTICS_MISMATCH";
    value_percent: string | null;
    metric: {
      semantic: "SEGMENT_ATTRIBUTABLE_ACCOUNTING_REVENUE";
      currency: "RUB";
      accounting_line: "2110";
      reporting_year: number;
      period_start: string;
      period_end: string;
    };
    scope: FinancialScopeMatch;
    numerator: { value_rub: string | null; entity_ids: string[]; financial_record_refs: string[] };
    denominator: { value_rub: string | null; entity_ids: string[]; financial_record_refs: string[] };
    coverage: {
      population_entities: number;
      accepted_entities: number;
      observed_entities: number;
      entity_observation_ratio: string | null;
      revenue_coverage_ratio: null;
      frame_state: "COMPLETE_FOR_DECLARED_FRAME" | "PARTIAL" | "UNKNOWN";
    };
    missing_entities: Array<{ entity_id: string; legal_name: string; reason: FinancialMissingReason | "ENTITY_UNRESOLVED" | "IDENTITY_EVIDENCE_INCOMPLETE" | "SEGMENT_ATTRIBUTION_MISSING" }>;
    excluded_attributions: Array<{ financial_record_ref: string; reason: "RECORD_UNAVAILABLE" | "SEMANTICS_MISMATCH" | "DUPLICATE_ENTITY_ATTRIBUTION" }>;
    limitation: string;
  };
  prohibited_inferences: string[];
  limitations: string[];
  coverage: {
    candidate_entities: number;
    accepted_entities: number;
    entities_with_records: number;
    entities_without_records: string[];
  };
};

export class FinancialCompetitorIntelligenceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FinancialCompetitorIntelligenceError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new FinancialCompetitorIntelligenceError(code, message);
}

function clean(value: unknown, maximum = 2_000) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, maximum);
}

function required(value: unknown, code: string, maximum = 2_000) {
  const result = clean(value, maximum);
  if (!result) fail(code, "Обязательное поле Financial Competitor Intelligence не заполнено.");
  return result;
}

function isoDate(value: unknown, code: string) {
  const result = required(value, code, 100);
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*Z)?$/u.test(result) || !Number.isFinite(Date.parse(result))) {
    fail(code, "Financial Competitor Intelligence требует ISO date или timestamp.");
  }
  return result.includes("T") ? new Date(result).toISOString() : result;
}

function sortedUnique(values: unknown[], code: string, maximum = 500) {
  const normalized = values.map((value) => required(value, code, maximum));
  const unique = [...new Set(normalized)].sort();
  if (!unique.length || unique.length !== normalized.length) fail(code, "Список должен быть непустым и не содержать дубликаты.");
  return unique;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function hash(value: unknown) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
  return `sha256:${[...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}

function normalizeFrame(input: FrozenFinancialFrameInput): FrozenFinancialFrameInput {
  if (!input || typeof input !== "object") fail("FINANCIAL_FRAME_REQUIRED", "Финансовый frame обязателен.");
  const product = input.product;
  const customer = input.customer;
  const geography = input.geography;
  const period = input.period;
  const okved = input.okved;
  const competitorRule = input.competitor_rule;
  if (!product || !customer || !geography || !period || !okved || !competitorRule) {
    fail("FINANCIAL_FRAME_INCOMPLETE", "Product, customer, geography, period, OKVED и competitor rule должны быть заморожены до финансовых значений.");
  }
  const periodStart = isoDate(period.period_start, "FINANCIAL_PERIOD_INVALID");
  const periodEnd = isoDate(period.period_end, "FINANCIAL_PERIOD_INVALID");
  const asOfDate = isoDate(period.as_of_date, "FINANCIAL_PERIOD_INVALID");
  if (Date.parse(periodStart) > Date.parse(periodEnd) || Date.parse(periodEnd) > Date.parse(asOfDate)) {
    fail("FINANCIAL_PERIOD_INVALID", "Период и дата среза не согласованы.");
  }
  const years = [...new Set(period.reporting_years)];
  if (!years.length || years.length !== period.reporting_years.length || years.some((year) => !Number.isSafeInteger(year) || year < 2019 || year > 9999)) {
    fail("FINANCIAL_REPORTING_YEARS_INVALID", "Отчётные годы ГИР БО должны быть уникальными целыми годами с 2019 года.");
  }
  if (!["SALES_AREA", "DELIVERY_AREA", "SERVICE_AREA", "REGISTRATION_PROXY"].includes(geography.kind)) {
    fail("FINANCIAL_GEOGRAPHY_INVALID", "Тип географии не поддерживается.");
  }
  const regions = geography.regions.map((region) => ({
    official_id: required(region.official_id, "FINANCIAL_GEOGRAPHY_INVALID", 100),
    name: required(region.name, "FINANCIAL_GEOGRAPHY_INVALID", 300),
  })).sort((left, right) => left.official_id.localeCompare(right.official_id));
  if (!regions.length || new Set(regions.map((region) => region.official_id)).size !== regions.length) {
    fail("FINANCIAL_GEOGRAPHY_INVALID", "География требует уникальные official IDs.");
  }
  const codes = okved.codes.map((item) => ({
    code: required(item.code, "FINANCIAL_OKVED_INVALID", 20),
    inclusion: item.inclusion,
    rationale: required(item.rationale, "FINANCIAL_OKVED_INVALID", 1_000),
  })).sort((left, right) => left.code.localeCompare(right.code));
  if (okved.classifier !== "OK_029_2014_KDES_REV_2" || !codes.length || new Set(codes.map((item) => item.code)).size !== codes.length
    || codes.some((item) => !/^\d{2}(?:\.\d{1,2}){0,2}$/u.test(item.code) || !["ANY_OF", "REQUIRED_PRIMARY", "EVIDENCED_ADDITIONAL"].includes(item.inclusion))) {
    fail("FINANCIAL_OKVED_INVALID", "OKVED frame не соответствует поддержанному версионированному классификатору.");
  }
  return {
    product: {
      product_or_service: required(product.product_or_service, "FINANCIAL_PRODUCT_INVALID"),
      customer_need: required(product.customer_need, "FINANCIAL_PRODUCT_INVALID"),
      included_offers: sortedUnique(product.included_offers, "FINANCIAL_PRODUCT_INVALID"),
      excluded_offers: [...new Set(product.excluded_offers.map((item) => required(item, "FINANCIAL_PRODUCT_INVALID")))].sort(),
      evidence_refs: sortedUnique(product.evidence_refs, "FINANCIAL_PRODUCT_INVALID"),
    },
    customer: {
      description: required(customer.description, "FINANCIAL_CUSTOMER_INVALID"),
      evidence_refs: sortedUnique(customer.evidence_refs, "FINANCIAL_CUSTOMER_INVALID"),
    },
    geography: {
      kind: geography.kind,
      regions,
      evidence_refs: sortedUnique(geography.evidence_refs, "FINANCIAL_GEOGRAPHY_INVALID"),
      limitation: geography.limitation === null ? null : required(geography.limitation, "FINANCIAL_GEOGRAPHY_INVALID"),
    },
    period: { period_start: periodStart, period_end: periodEnd, reporting_years: years.sort((a, b) => a - b), as_of_date: asOfDate },
    okved: {
      classifier: "OK_029_2014_KDES_REV_2",
      classifier_version: required(okved.classifier_version, "FINANCIAL_OKVED_INVALID", 200),
      codes,
      activity_rule_version: required(okved.activity_rule_version, "FINANCIAL_OKVED_INVALID", 200),
    },
    competitor_rule: {
      version: required(competitorRule.version, "FINANCIAL_COMPETITOR_RULE_INVALID", 200),
      inclusion_rule: required(competitorRule.inclusion_rule, "FINANCIAL_COMPETITOR_RULE_INVALID"),
    },
  };
}

function normalizeEntity(input: FinancialLegalEntityInput): FinancialLegalEntityInput {
  const evidence = input.evidence.map((item) => ({
    evidence_ref: required(item.evidence_ref, "FINANCIAL_ENTITY_EVIDENCE_INVALID", 500),
    evidence_kind: item.evidence_kind,
    source_kind: item.source_kind,
    source_locator: required(item.source_locator, "FINANCIAL_ENTITY_EVIDENCE_INVALID"),
    observed_at: isoDate(item.observed_at, "FINANCIAL_ENTITY_EVIDENCE_INVALID"),
    status: item.status,
  })).sort((left, right) => left.evidence_ref.localeCompare(right.evidence_ref));
  if (evidence.some((item) => !["LEGAL_IDENTITY", "BRAND_OR_PRODUCT_RELATION"].includes(item.evidence_kind)
    || !["EGRUL", "OFFICIAL_REGISTRY", "OFFICIAL_BRAND_DISCLOSURE", "USER_PROVIDED_DOCUMENT"].includes(item.source_kind)
    || !["VERIFIED", "UNVERIFIED"].includes(item.status))) {
    fail("FINANCIAL_ENTITY_EVIDENCE_INVALID", "Тип или статус legal identity evidence не поддерживается.");
  }
  const entity = {
    entity_id: required(input.entity_id, "FINANCIAL_ENTITY_INVALID", 200),
    role: input.role,
    inn: required(input.inn, "FINANCIAL_ENTITY_INVALID", 20),
    ogrn: required(input.ogrn, "FINANCIAL_ENTITY_INVALID", 20),
    legal_name: required(input.legal_name, "FINANCIAL_ENTITY_INVALID", 500),
    relation: input.relation,
    resolution_status: input.resolution_status,
    evidence,
  };
  if (!/^\d{10}$/u.test(entity.inn) || !/^\d{13}$/u.test(entity.ogrn) || !["COMPANY", "COMPETITOR"].includes(entity.role)
    || !["OPERATOR", "OWNER", "SELLER", "MANUFACTURER", "LICENSEE", "OTHER"].includes(entity.relation)
    || !["CONFIRMED", "UNRESOLVED"].includes(entity.resolution_status)) {
    fail("FINANCIAL_ENTITY_INVALID", "Юридическое лицо требует точные ИНН, ОГРН, роль, relation и resolution status.");
  }
  return entity;
}

function identityComplete(entity: FinancialLegalEntityInput) {
  const verified = entity.evidence.filter((item) => item.status === "VERIFIED");
  return verified.some((item) => item.evidence_kind === "LEGAL_IDENTITY" && item.source_kind === "EGRUL")
    && verified.some((item) => item.evidence_kind === "BRAND_OR_PRODUCT_RELATION" && item.source_kind !== "EGRUL");
}

function canonicalDecimal(value: string) {
  const normalized = required(value, "FINANCIAL_VALUE_INVALID", 200).replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/u.test(normalized)) fail("FINANCIAL_VALUE_INVALID", "Финансовое значение должно быть точной decimal-строкой.");
  const negative = normalized.startsWith("-");
  const [wholeRaw, fractionRaw = ""] = normalized.replace(/^-/, "").split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/u, "");
  const fraction = fractionRaw.replace(/0+$/u, "");
  const result = fraction ? `${whole}.${fraction}` : whole;
  return negative && result !== "0" ? `-${result}` : result;
}

function multiplyDecimal(value: string, multiplier: number) {
  const normalized = canonicalDecimal(value);
  const negative = normalized.startsWith("-");
  const [whole, fraction = ""] = normalized.replace(/^-/, "").split(".");
  const base = BigInt(`${whole}${fraction}` || "0") * BigInt(multiplier);
  if (!fraction.length) return `${negative && base !== BigInt(0) ? "-" : ""}${base}`;
  const padded = base.toString().padStart(fraction.length + 1, "0");
  const integerPart = padded.slice(0, -fraction.length);
  const decimalPart = padded.slice(-fraction.length).replace(/0+$/u, "");
  return `${negative && base !== BigInt(0) ? "-" : ""}${integerPart}${decimalPart ? `.${decimalPart}` : ""}`;
}

function decimalParts(value: string) {
  const normalized = canonicalDecimal(value);
  const negative = normalized.startsWith("-");
  const [whole, fraction = ""] = normalized.replace(/^-/, "").split(".");
  const units = BigInt(`${whole}${fraction}` || "0") * (negative ? BigInt(-1) : BigInt(1));
  return { units, scale: fraction.length };
}

function decimalFromUnits(units: bigint, scale: number) {
  const negative = units < BigInt(0);
  const absolute = (negative ? -units : units).toString().padStart(scale + 1, "0");
  const whole = scale ? absolute.slice(0, -scale) : absolute;
  const fraction = scale ? absolute.slice(-scale).replace(/0+$/u, "") : "";
  return `${negative && units !== BigInt(0) ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function sumDecimals(values: string[]) {
  const parts = values.map(decimalParts);
  const scale = Math.max(0, ...parts.map((item) => item.scale));
  const units = parts.reduce((total, item) => total + item.units * (BigInt(10) ** BigInt(scale - item.scale)), BigInt(0));
  return { value: decimalFromUnits(units, scale), units, scale };
}

function percentage(numerator: ReturnType<typeof sumDecimals>, denominator: ReturnType<typeof sumDecimals>) {
  const commonScale = Math.max(numerator.scale, denominator.scale);
  const numeratorUnits = numerator.units * (BigInt(10) ** BigInt(commonScale - numerator.scale));
  const denominatorUnits = denominator.units * (BigInt(10) ** BigInt(commonScale - denominator.scale));
  if (denominatorUnits <= BigInt(0)) return null;
  const hundredths = (numeratorUnits * BigInt(10_000) + denominatorUnits / BigInt(2)) / denominatorUnits;
  return decimalFromUnits(hundredths, 2);
}

const METRIC_LINE: Record<FinancialMetric, { statement: GirBoFinancialRecordInput["statement_kind"]; line: string }> = {
  REVENUE: { statement: "FINANCIAL_RESULTS", line: "2110" },
  NET_PROFIT: { statement: "FINANCIAL_RESULTS", line: "2400" },
  ASSETS: { statement: "BALANCE", line: "1600" },
  CAPITAL: { statement: "BALANCE", line: "1300" },
  LONG_TERM_LIABILITIES: { statement: "BALANCE", line: "1400" },
  SHORT_TERM_LIABILITIES: { statement: "BALANCE", line: "1500" },
};

function normalizeRecord(input: GirBoFinancialRecordInput, frame: FrozenFinancialFrameInput) {
  const expected = METRIC_LINE[input.metric];
  if (!expected || input.statement_kind !== expected.statement || input.line_code !== expected.line) {
    fail("FINANCIAL_METRIC_SEMANTICS_INVALID", "Метрика, форма и строка ГИР БО не совпадают.");
  }
  const year = input.reporting_year;
  const periodStart = isoDate(input.period_start, "FINANCIAL_RECORD_PERIOD_INVALID");
  const periodEnd = isoDate(input.period_end, "FINANCIAL_RECORD_PERIOD_INVALID");
  if (!frame.period.reporting_years.includes(year) || Number(periodEnd.slice(0, 4)) !== year || Date.parse(periodStart) > Date.parse(periodEnd)) {
    fail("FINANCIAL_RECORD_PERIOD_INVALID", "Financial Evidence Record находится вне замороженного периода.");
  }
  const provenance = input.provenance;
  if (provenance.source_system !== "GIR_BO_FNS" || !["OFFICIAL_SUBSCRIPTION_BULK", "OFFICIAL_SIGNED_DOCUMENT"].includes(provenance.access_channel)
    || !/^sha256:[a-f0-9]{64}$/u.test(provenance.source_hash_sha256)) {
    fail("FINANCIAL_PROVENANCE_INVALID", "Финансовая запись требует официальный канал ГИР БО и SHA-256 происхождение.");
  }
  if (!["ACCEPTED", "ACCEPTED_WITH_WARNINGS", "QUARANTINED", "REJECTED"].includes(input.quality.status)
    || !["PASS", "FAIL", "UNKNOWN"].includes(input.quality.identity_match)
    || !["PASS", "FAIL", "UNKNOWN"].includes(input.quality.period_valid)
    || !["PASS", "FAIL", "UNKNOWN"].includes(input.quality.unit_known)) {
    fail("FINANCIAL_QUALITY_INVALID", "Статус качества записи не поддерживается.");
  }
  if (input.currency !== "RUB" || ![1, 1000, 1000000].includes(input.unit_multiplier)
    || !["CURRENT", "COMPARATIVE"].includes(input.column_role)
    || !["FULL", "SIMPLIFIED", "NONPROFIT", "FINANCIAL_ORG", "UNKNOWN"].includes(input.form_variant)) {
    fail("FINANCIAL_VALUE_INVALID", "Единица, валюта, колонка или форма записи не поддерживается.");
  }
  if (provenance.access_channel === "OFFICIAL_SIGNED_DOCUMENT"
    && (provenance.signature_present !== true || provenance.signature_verified !== true)) {
    fail("FINANCIAL_PROVENANCE_INVALID", "Официальный подписанный документ требует подтверждённую подпись.");
  }
  return {
    ...structuredClone(input),
    record_id: required(input.record_id, "FINANCIAL_RECORD_INVALID", 300),
    entity_id: required(input.entity_id, "FINANCIAL_RECORD_INVALID", 200),
    reporting_year: year,
    period_start: periodStart,
    period_end: periodEnd,
    line_name_raw: required(input.line_name_raw, "FINANCIAL_RECORD_INVALID", 500),
    value_raw: required(input.value_raw, "FINANCIAL_VALUE_INVALID", 500),
    value_decimal: canonicalDecimal(input.value_decimal),
    unit_raw: required(input.unit_raw, "FINANCIAL_VALUE_INVALID", 100),
    provenance: {
      ...structuredClone(provenance),
      source_locator: required(provenance.source_locator, "FINANCIAL_PROVENANCE_INVALID"),
      source_file_name: required(provenance.source_file_name, "FINANCIAL_PROVENANCE_INVALID", 500),
      fetched_at: isoDate(provenance.fetched_at, "FINANCIAL_PROVENANCE_INVALID"),
      resource_as_of_date: isoDate(provenance.resource_as_of_date, "FINANCIAL_PROVENANCE_INVALID"),
      parser_name: required(provenance.parser_name, "FINANCIAL_PROVENANCE_INVALID", 200),
      parser_version: required(provenance.parser_version, "FINANCIAL_PROVENANCE_INVALID", 200),
    },
    normalized_value_rub: multiplyDecimal(input.value_decimal, input.unit_multiplier),
  };
}

function frameScope(frame: FrozenFinancialFrameInput): FinancialScopeMatch {
  return {
    product_or_service: frame.product.product_or_service,
    customer_need: frame.product.customer_need,
    geography_official_ids: frame.geography.regions.map((region) => region.official_id).sort(),
    period_start: frame.period.period_start,
    period_end: frame.period.period_end,
    okved_codes: frame.okved.codes.map((item) => item.code).sort(),
  };
}

const PROHIBITED_STRATEGIC_INFERENCE = /(?:advertising|ad)\s+(?:budget|effectiveness|performance)|brand\s+strength|entire\s+market|market\s+presence|рекламн\p{L}*\s+(?:бюджет|эффективност|результативност)|сил\p{L}*\s+бренд\p{L}*|присутстви\p{L}*\s+на\s+(?:вс[её]м|целом)\s+рынк\p{L}*/iu;

export async function buildFinancialCompetitorIntelligence(input: FinancialCompetitorIntelligenceInput): Promise<FinancialCompetitorIntelligence> {
  const generatedAt = isoDate(input.generated_at, "FINANCIAL_GENERATED_AT_INVALID");
  const frame = normalizeFrame(input.frame);
  const frameId = await hash(frame);
  const frozenFrame = { ...frame, frame_id: frameId };

  const entities = input.legal_entities.map(normalizeEntity);
  if (new Set(entities.map((entity) => entity.entity_id)).size !== entities.length
    || new Set(entities.map((entity) => `${entity.inn}:${entity.ogrn}`)).size !== entities.length) {
    fail("FINANCIAL_ENTITY_DUPLICATE", "Юридический perimeter не должен содержать дубликаты.");
  }
  const acceptedEntities: FinancialCompetitorIntelligence["legal_perimeter"]["accepted_entities"] = [];
  const excludedEntities: FinancialCompetitorIntelligence["legal_perimeter"]["excluded_entities"] = [];
  for (const entity of entities) {
    if (entity.resolution_status !== "CONFIRMED") {
      excludedEntities.push({ entity_id: entity.entity_id, legal_name: entity.legal_name, reason: "ENTITY_UNRESOLVED" });
    } else if (!identityComplete(entity)) {
      excludedEntities.push({ entity_id: entity.entity_id, legal_name: entity.legal_name, reason: "IDENTITY_EVIDENCE_INCOMPLETE" });
    } else {
      acceptedEntities.push({ ...entity, perimeter_ref: await hash({ frame_id: frameId, entity }) });
    }
  }
  acceptedEntities.sort((left, right) => left.entity_id.localeCompare(right.entity_id));
  excludedEntities.sort((left, right) => left.entity_id.localeCompare(right.entity_id));
  const acceptedEntityIds = new Set(acceptedEntities.map((entity) => entity.entity_id));

  const acceptedRecords: FinancialCompetitorIntelligence["accepted_records"] = [];
  const excludedRecords: FinancialCompetitorIntelligence["excluded_records"] = [];
  for (const rawRecord of input.financial_records) {
    if (!acceptedEntityIds.has(rawRecord.entity_id)) {
      excludedRecords.push({ record_id: clean(rawRecord.record_id, 300), entity_id: clean(rawRecord.entity_id, 200), reason: "ENTITY_NOT_IN_ACCEPTED_LEGAL_PERIMETER" });
      continue;
    }
    const financialRecord = normalizeRecord(rawRecord, frame);
    if (financialRecord.quality.status === "QUARANTINED" || financialRecord.quality.status === "REJECTED"
      || financialRecord.quality.identity_match !== "PASS" || financialRecord.quality.period_valid !== "PASS" || financialRecord.quality.unit_known !== "PASS") {
      excludedRecords.push({ record_id: financialRecord.record_id, entity_id: financialRecord.entity_id, reason: "FINANCIAL_RECORD_NOT_ACCEPTED" });
      continue;
    }
    acceptedRecords.push(financialRecord);
  }
  if (new Set(input.financial_records.map((record) => record.record_id)).size !== input.financial_records.length) {
    fail("FINANCIAL_RECORD_DUPLICATE", "Financial Evidence Record IDs должны быть уникальны.");
  }
  acceptedRecords.sort((left, right) => left.entity_id.localeCompare(right.entity_id)
    || left.reporting_year - right.reporting_year || left.metric.localeCompare(right.metric)
    || left.provenance.fetched_at.localeCompare(right.provenance.fetched_at));

  const missingReasons: FinancialMissingReason[] = [
    "NO_FILING_EXPECTED", "ACCESS_RESTRICTED", "FILING_NOT_FOUND", "NOT_YET_DUE",
    "AUTH_OR_SUBSCRIPTION_REQUIRED", "FORMAT_UNSUPPORTED", "ACTIVITY_REVENUE_UNALLOCATED", "FILING_STATUS_UNKNOWN",
  ];
  const missing = input.missing_financial_data.map((item) => ({
    entity_id: required(item.entity_id, "FINANCIAL_MISSING_INVALID", 200),
    reporting_year: item.reporting_year,
    metric: item.metric,
    reason: item.reason,
    source_ref: item.source_ref === null ? null : required(item.source_ref, "FINANCIAL_MISSING_INVALID", 1_000),
    limitation: required(item.limitation, "FINANCIAL_MISSING_INVALID"),
  }));
  if (missing.some((item) => !acceptedEntityIds.has(item.entity_id) || !frame.period.reporting_years.includes(item.reporting_year)
    || !METRIC_LINE[item.metric] || !missingReasons.includes(item.reason))) {
    fail("FINANCIAL_MISSING_INVALID", "Missing observation должна относиться к принятому perimeter, периоду и метрике.");
  }
  const latestByKey = new Map<string, typeof acceptedRecords[number]>();
  for (const item of acceptedRecords) {
    const key = `${item.entity_id}:${item.reporting_year}:${item.metric}`;
    const previous = latestByKey.get(key);
    if (previous && item.revision.supersedes_record_id !== previous.record_id) {
      fail("FINANCIAL_CORRECTION_CHAIN_INVALID", "Повторная запись должна явно supersede предыдущую Financial Evidence Record.");
    }
    latestByKey.set(key, item);
  }
  const missingByKey = new Map(missing.map((item) => [`${item.entity_id}:${item.reporting_year}:${item.metric}`, item]));
  if (missingByKey.size !== missing.length || [...missingByKey.keys()].some((key) => latestByKey.has(key))) {
    fail("FINANCIAL_MISSING_CONFLICT", "Одно наблюдение не может одновременно быть доступным и отсутствующим.");
  }

  const profiles = acceptedEntities.map((entity) => {
    const available = [...latestByKey.values()].filter((item) => item.entity_id === entity.entity_id).map((item) => ({
      reporting_year: item.reporting_year,
      metric: item.metric,
      status: "AVAILABLE" as const,
      value_rub: item.normalized_value_rub,
      record_id: item.record_id,
      missing_reason: null,
      limitation: null,
    }));
    const unavailable = missing.filter((item) => item.entity_id === entity.entity_id).map((item) => ({
      reporting_year: item.reporting_year,
      metric: item.metric,
      status: "UNAVAILABLE" as const,
      value_rub: null,
      record_id: null,
      missing_reason: item.reason,
      limitation: item.limitation,
    }));
    if (!available.length && !unavailable.length) {
      for (const reportingYear of frame.period.reporting_years) {
        unavailable.push({ reporting_year: reportingYear, metric: "REVENUE", status: "UNAVAILABLE", value_rub: null, record_id: null, missing_reason: "FILING_STATUS_UNKNOWN", limitation: "Статус отчётности не подтверждён; неизвестное значение не считается нулём." });
      }
    }
    const observations = [...available, ...unavailable].sort((left, right) => left.reporting_year - right.reporting_year || left.metric.localeCompare(right.metric));
    return {
      entity_id: entity.entity_id,
      legal_name: entity.legal_name,
      role: entity.role,
      observations,
      reporting_periods: [...new Set(available.map((item) => item.reporting_year))].sort((a, b) => a - b),
      missing_reasons: [...new Set(unavailable.map((item) => item.missing_reason))].sort() as FinancialMissingReason[],
    };
  });

  const acceptedRecordIds = new Set(acceptedRecords.map((record) => record.record_id));
  const expectedScope = frameScope(frame);
  const shareInput = input.observed_segment_revenue_share;
  const reportingYear = shareInput?.reporting_year ?? frame.period.reporting_years.at(-1)!;
  if (!frame.period.reporting_years.includes(reportingYear)
    || (shareInput && typeof shareInput.population_frame_complete !== "boolean")
    || (shareInput && !["SINGLE_ENTITY", "CONSOLIDATED"].includes(shareInput.company_group_policy))) {
    fail("OBSERVED_SEGMENT_SHARE_INPUT_INVALID", "Observed Segment Revenue Share требует год из замороженного frame, явную полноту population frame и group policy.");
  }
  const latestRecords = [...latestByKey.values()];
  const latestRecordById = new Map(latestRecords.map((record) => [record.record_id, record]));
  const includedShareRecords: typeof latestRecords = [];
  const excludedAttributions: FinancialCompetitorIntelligence["observed_segment_revenue_share"]["excluded_attributions"] = [];
  const attributedEntityIds = new Set<string>();
  let sharePeriodStart: string | null = null;
  let sharePeriodEnd: string | null = null;
  for (const attribution of shareInput?.revenue_attributions ?? []) {
    const recordRef = required(attribution.financial_record_ref, "OBSERVED_SEGMENT_SHARE_INPUT_INVALID", 300);
    const financialRecord = latestRecordById.get(recordRef);
    if (!financialRecord) {
      excludedAttributions.push({ financial_record_ref: recordRef, reason: "RECORD_UNAVAILABLE" });
      continue;
    }
    const normalizedScope = {
      ...attribution.scope,
      geography_official_ids: [...attribution.scope.geography_official_ids].sort(),
      okved_codes: [...attribution.scope.okved_codes].sort(),
    };
    const evidenceRefs = [...new Set(attribution.evidence_refs.map((item) => required(item, "OBSERVED_SEGMENT_SHARE_INPUT_INVALID", 500)))];
    const scopeMatches = canonical(normalizedScope) === canonical(expectedScope);
    const periodMatches = financialRecord.reporting_year === reportingYear
      && (!sharePeriodStart || sharePeriodStart === financialRecord.period_start)
      && (!sharePeriodEnd || sharePeriodEnd === financialRecord.period_end);
    if (financialRecord.metric !== "REVENUE" || financialRecord.line_code !== "2110" || !scopeMatches || !periodMatches
      || !["WHOLE_ENTITY_IF_SINGLE_ACTIVITY", "DIRECT_SEGMENT_DISCLOSURE"].includes(attribution.attribution_policy)
      || !evidenceRefs.length) {
      excludedAttributions.push({ financial_record_ref: recordRef, reason: "SEMANTICS_MISMATCH" });
      continue;
    }
    if (attributedEntityIds.has(financialRecord.entity_id)) {
      excludedAttributions.push({ financial_record_ref: recordRef, reason: "DUPLICATE_ENTITY_ATTRIBUTION" });
      continue;
    }
    sharePeriodStart = financialRecord.period_start;
    sharePeriodEnd = financialRecord.period_end;
    attributedEntityIds.add(financialRecord.entity_id);
    includedShareRecords.push(financialRecord);
  }
  const acceptedCompanies = acceptedEntities.filter((entity) => entity.role === "COMPANY");
  if (shareInput?.company_group_policy === "SINGLE_ENTITY" && acceptedCompanies.length > 1) {
    for (const recordItem of includedShareRecords.splice(0)) {
      attributedEntityIds.delete(recordItem.entity_id);
      excludedAttributions.push({ financial_record_ref: recordItem.record_id, reason: "SEMANTICS_MISMATCH" });
    }
  }
  const numeratorRecords = includedShareRecords.filter((recordItem) => acceptedCompanies.some((entity) => entity.entity_id === recordItem.entity_id));
  const numeratorTotal = numeratorRecords.length ? sumDecimals(numeratorRecords.map((recordItem) => recordItem.normalized_value_rub)) : null;
  const denominatorTotal = includedShareRecords.length ? sumDecimals(includedShareRecords.map((recordItem) => recordItem.normalized_value_rub)) : null;
  const valuePercent = numeratorTotal && denominatorTotal ? percentage(numeratorTotal, denominatorTotal) : null;
  const missingEntities: FinancialCompetitorIntelligence["observed_segment_revenue_share"]["missing_entities"] = acceptedEntities
    .filter((entity) => !attributedEntityIds.has(entity.entity_id))
    .map((entity) => ({
      entity_id: entity.entity_id,
      legal_name: entity.legal_name,
      reason: missingByKey.get(`${entity.entity_id}:${reportingYear}:REVENUE`)?.reason ?? "SEGMENT_ATTRIBUTION_MISSING",
    }));
  missingEntities.sort((left, right) => left.entity_id.localeCompare(right.entity_id));
  const shareHasSemanticsMismatch = excludedAttributions.some((item) => item.reason === "SEMANTICS_MISMATCH" || item.reason === "DUPLICATE_ENTITY_ATTRIBUTION");
  const shareFrameState = !shareInput ? "UNKNOWN" as const
    : shareInput.population_frame_complete && !missingEntities.length && !excludedAttributions.length ? "COMPLETE_FOR_DECLARED_FRAME" as const
      : "PARTIAL" as const;
  const observedSegmentRevenueShare: FinancialCompetitorIntelligence["observed_segment_revenue_share"] = {
    label: "Observed Segment Revenue Share",
    status: shareHasSemanticsMismatch ? "SEMANTICS_MISMATCH"
      : !numeratorRecords.length ? "NUMERATOR_UNAVAILABLE"
        : !denominatorTotal || denominatorTotal.units <= BigInt(0) ? "DENOMINATOR_UNAVAILABLE"
          : shareFrameState === "COMPLETE_FOR_DECLARED_FRAME" ? "AVAILABLE_COMPLETE_FOR_DECLARED_FRAME"
            : "AVAILABLE_PARTIAL_OBSERVED_COHORT",
    value_percent: shareHasSemanticsMismatch ? null : valuePercent,
    metric: {
      semantic: "SEGMENT_ATTRIBUTABLE_ACCOUNTING_REVENUE",
      currency: "RUB",
      accounting_line: "2110",
      reporting_year: reportingYear,
      period_start: sharePeriodStart ?? `${reportingYear}-01-01`,
      period_end: sharePeriodEnd ?? `${reportingYear}-12-31`,
    },
    scope: expectedScope,
    numerator: {
      value_rub: numeratorTotal?.value ?? null,
      entity_ids: numeratorRecords.map((recordItem) => recordItem.entity_id).sort(),
      financial_record_refs: numeratorRecords.map((recordItem) => recordItem.record_id).sort(),
    },
    denominator: {
      value_rub: denominatorTotal?.value ?? null,
      entity_ids: includedShareRecords.map((recordItem) => recordItem.entity_id).sort(),
      financial_record_refs: includedShareRecords.map((recordItem) => recordItem.record_id).sort(),
    },
    coverage: {
      population_entities: acceptedEntities.length,
      accepted_entities: acceptedEntities.length,
      observed_entities: attributedEntityIds.size,
      entity_observation_ratio: acceptedEntities.length ? percentage(sumDecimals([String(attributedEntityIds.size)]), sumDecimals([String(acceptedEntities.length)])) : null,
      revenue_coverage_ratio: null,
      frame_state: shareFrameState,
    },
    missing_entities: missingEntities,
    excluded_attributions: excludedAttributions.sort((left, right) => left.financial_record_ref.localeCompare(right.financial_record_ref)),
    limitation: "Observed Segment Revenue Share описывает только сопоставимую бухгалтерскую выручку наблюдаемых принятых юрлиц в указанном frame и не является долей рынка без отдельно квалифицированного полного знаменателя.",
  };
  const strategyClaims: FinancialCompetitorIntelligence["strategy_claims"] = [];
  const suppressedStrategyClaims: FinancialCompetitorIntelligence["suppressed_strategy_claims"] = [];
  const strategyFields = new Set(["campaign_focus", "advertised_offer", "target_audience", "geography", "core_message"]);
  const nonfinancialFamilies = new Set(["PRODUCT", "CUSTOMER", "POSITIONING", "DEMAND", "PUBLIC_AD_OBSERVATION"]);
  for (const interpretation of input.strategic_interpretations) {
    const interpretationId = required(interpretation.interpretation_id, "FINANCIAL_INTERPRETATION_INVALID", 300);
    if (interpretation.affected_strategy_fields.some((field) => !strategyFields.has(field))
      || interpretation.independent_nonfinancial_evidence.some((item) => !nonfinancialFamilies.has(item.family))) {
      fail("FINANCIAL_INTERPRETATION_INVALID", "Financial interpretation пытается изменить неподдержанное поле или использовать неизвестную evidence family.");
    }
    const statement = required(interpretation.statement, "FINANCIAL_INTERPRETATION_INVALID");
    const recordRefs = [...new Set(interpretation.financial_record_refs.map((item) => required(item, "FINANCIAL_INTERPRETATION_INVALID", 300)))].sort();
    if (!recordRefs.length || recordRefs.some((recordId) => !acceptedRecordIds.has(recordId))) {
      suppressedStrategyClaims.push({ interpretation_id: interpretationId, reason: "FINANCIAL_RECORD_UNAVAILABLE" });
      continue;
    }
    if (PROHIBITED_STRATEGIC_INFERENCE.test(statement)) {
      suppressedStrategyClaims.push({ interpretation_id: interpretationId, reason: "PROHIBITED_FINANCIAL_INFERENCE" });
      continue;
    }
    if (!interpretation.independent_nonfinancial_evidence.length) {
      suppressedStrategyClaims.push({ interpretation_id: interpretationId, reason: "INDEPENDENT_NONFINANCIAL_EVIDENCE_REQUIRED" });
      continue;
    }
    const independentRefs = interpretation.independent_nonfinancial_evidence.map((item) => required(item.evidence_ref, "FINANCIAL_INTERPRETATION_INVALID", 500));
    if (interpretation.independent_nonfinancial_evidence.some((item) => canonical({
      ...item.scope,
      geography_official_ids: [...item.scope.geography_official_ids].sort(),
      okved_codes: [...item.scope.okved_codes].sort(),
    }) !== canonical(expectedScope))) {
      suppressedStrategyClaims.push({ interpretation_id: interpretationId, reason: "NONFINANCIAL_SCOPE_MISMATCH" });
      continue;
    }
    strategyClaims.push({
      interpretation_id: interpretationId,
      statement,
      financial_record_refs: recordRefs,
      independent_nonfinancial_evidence_refs: [...new Set(independentRefs)].sort(),
      affected_strategy_fields: [...new Set(interpretation.affected_strategy_fields)],
      competing_explanations: interpretation.competing_explanations.map((item) => required(item, "FINANCIAL_INTERPRETATION_INVALID")),
      limitations: interpretation.limitations.map((item) => required(item, "FINANCIAL_INTERPRETATION_INVALID")),
      falsifiable_consequence: interpretation.falsifiable_consequence === null ? null : required(interpretation.falsifiable_consequence, "FINANCIAL_INTERPRETATION_INVALID"),
    });
  }

  const entitiesWithRecords = new Set(acceptedRecords.map((record) => record.entity_id));
  const capabilityStatus: FinancialCapabilityStatus = acceptedRecords.length === 0 ? "UNAVAILABLE"
    : excludedEntities.length || excludedRecords.length || acceptedEntities.some((entity) => !entitiesWithRecords.has(entity.entity_id)) || missing.length ? "PARTIAL" : "AVAILABLE";
  const body = {
    schema_version: FINANCIAL_COMPETITOR_INTELLIGENCE_SCHEMA as typeof FINANCIAL_COMPETITOR_INTELLIGENCE_SCHEMA,
    contract_version: FINANCIAL_COMPETITOR_INTELLIGENCE_CONTRACT_VERSION as typeof FINANCIAL_COMPETITOR_INTELLIGENCE_CONTRACT_VERSION,
    generated_at: generatedAt,
    capability_status: capabilityStatus,
    frozen_frame: frozenFrame,
    legal_perimeter: { accepted_entities: acceptedEntities, excluded_entities: excludedEntities },
    accepted_records: acceptedRecords,
    excluded_records: excludedRecords.sort((left, right) => left.record_id.localeCompare(right.record_id)),
    profiles,
    strategy_claims: strategyClaims.sort((left, right) => left.interpretation_id.localeCompare(right.interpretation_id)),
    suppressed_strategy_claims: suppressedStrategyClaims.sort((left, right) => left.interpretation_id.localeCompare(right.interpretation_id)),
    observed_segment_revenue_share: observedSegmentRevenueShare,
    prohibited_inferences: [
      "Рекламный бюджет, CPC, CPA, конверсии или эффективность рекламы конкурента.",
      "Сила бренда, качество продукта или причинность между рекламой и финансовой динамикой.",
      "Присутствие на всём рынке или доля рынка без отдельно квалифицированного полного знаменателя.",
    ],
    limitations: [
      "Финансовые значения описывают историческую бухгалтерскую динамику подтверждённого юридического периметра.",
      "Отсутствующие или ограниченные сведения остаются null и не означают нулевую деятельность или отсутствие организации.",
      "Общая выручка юридического лица не приписывается продукту, географии или ОКВЭД без отдельного сегментного доказательства.",
    ],
    coverage: {
      candidate_entities: entities.length,
      accepted_entities: acceptedEntities.length,
      entities_with_records: entitiesWithRecords.size,
      entities_without_records: acceptedEntities.filter((entity) => !entitiesWithRecords.has(entity.entity_id)).map((entity) => entity.entity_id),
    },
  };
  const dossierId = await hash(body);
  return deepFreeze({ ...body, dossier_id: dossierId });
}

export async function verifyFinancialCompetitorIntelligence(value: FinancialCompetitorIntelligence | unknown) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const dossier = value as FinancialCompetitorIntelligence;
    if (dossier.schema_version !== FINANCIAL_COMPETITOR_INTELLIGENCE_SCHEMA
      || dossier.contract_version !== FINANCIAL_COMPETITOR_INTELLIGENCE_CONTRACT_VERSION
      || !/^sha256:[a-f0-9]{64}$/u.test(dossier.dossier_id)
      || !/^sha256:[a-f0-9]{64}$/u.test(dossier.frozen_frame?.frame_id)) return false;
    const acceptedEntityIds = new Set(dossier.legal_perimeter.accepted_entities.map((entity) => entity.entity_id));
    const acceptedRecordIds = new Set(dossier.accepted_records.map((record) => record.record_id));
    if (acceptedEntityIds.size !== dossier.legal_perimeter.accepted_entities.length
      || acceptedRecordIds.size !== dossier.accepted_records.length
      || dossier.accepted_records.some((record) => !acceptedEntityIds.has(record.entity_id))) return false;
    if (dossier.profiles.some((profile) => !acceptedEntityIds.has(profile.entity_id)
      || profile.observations.some((observation) => observation.status === "UNAVAILABLE"
        ? observation.value_rub !== null || observation.missing_reason === null
        : observation.value_rub === null || observation.record_id === null))) return false;
    if (dossier.strategy_claims.some((claim) => !claim.financial_record_refs.length
      || !claim.independent_nonfinancial_evidence_refs.length
      || claim.financial_record_refs.some((recordId) => !acceptedRecordIds.has(recordId)))) return false;
    const share = dossier.observed_segment_revenue_share;
    if (share?.label !== "Observed Segment Revenue Share"
      || share.metric?.semantic !== "SEGMENT_ATTRIBUTABLE_ACCOUNTING_REVENUE"
      || share.metric?.currency !== "RUB"
      || share.metric?.accounting_line !== "2110"
      || share.denominator.financial_record_refs.some((recordId) => !acceptedRecordIds.has(recordId))
      || share.numerator.financial_record_refs.some((recordId) => !share.denominator.financial_record_refs.includes(recordId))
      || share.coverage.observed_entities !== share.denominator.entity_ids.length
      || (share.value_percent !== null && !share.status.startsWith("AVAILABLE_"))) return false;
    const body = structuredClone(dossier) as Record<string, unknown>;
    delete body.dossier_id;
    return dossier.dossier_id === await hash(body);
  } catch {
    return false;
  }
}
