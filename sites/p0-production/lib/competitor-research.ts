import { normalizePublicHttpsUrl } from "./site-url.ts";
import { cleanText } from "./text.ts";
import {
  researchAllowlistedPublicCompetitorPage,
  type PublicCompetitorPageObservation,
  type SiteResearchDependencies,
} from "./site-research.ts";

export const BOUNDED_COMPETITOR_RESEARCH_SCHEMA = "p0-bounded-competitor-research-v1";
const MAXIMUM_CANDIDATES = 6;
const MAXIMUM_DESTINATIONS_PER_CANDIDATE = 3;

export type CompetitorCandidateSet = {
  schema_version: typeof BOUNDED_COMPETITOR_RESEARCH_SCHEMA;
  competitor_set_rule: string;
  candidates: Array<{
    competitor: string;
    rationale: string;
    exact_destinations: string[];
  }>;
};

export type CompetitorMatrixRowInput = {
  competitor: string;
  productsServices: string[];
  observedOfferMessage: string;
  publishedPrice: { status: "PUBLISHED"; value: string } | { status: "NOT_PUBLISHED"; value: null };
  exactLanding: string;
  source: { label: string; url: string };
  geography: string;
  device: string;
  observedAt: string;
  adVisibilitySample: {
    status: "OBSERVED" | "NOT_OBSERVED" | "UNAVAILABLE";
    query: string | null;
    source: string;
    geography: string;
    device: string;
    observedAt: string;
  };
};

export type CompetitorMatrix = {
  schema_version: typeof BOUNDED_COMPETITOR_RESEARCH_SCHEMA;
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  candidate_set: CompetitorCandidateSet;
  rows: Array<{
    competitor: string;
    products_services: string[];
    observed_offer_message: string;
    published_price: { status: "PUBLISHED" | "NOT_PUBLISHED"; value: string | null };
    exact_landing: string;
    source: { label: string; url: string };
    geography: string;
    device: string;
    observation_date: string;
    ad_visibility_sample: {
      status: "OBSERVED" | "NOT_OBSERVED" | "UNAVAILABLE";
      query: string | null;
      source: string;
      geography: string;
      device: string;
      observation_date: string;
    };
  }>;
  coverage: Array<{ competitor: string; status: "OBSERVED" | "UNAVAILABLE" }>;
  aggregate_claims: Array<{
    claim: string;
    competitor_set_rule: string;
    denominator: number;
    observed_count: number | null;
    evidence_status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
    limitation: string;
  }>;
  limitations: string[];
};

export class BoundedCompetitorResearchError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BoundedCompetitorResearchError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new BoundedCompetitorResearchError(code, message);
}

function requiredText(value: unknown, code: string, maximum = 1_000) {
  const normalized = cleanText(String(value ?? ""), maximum);
  if (!normalized) fail(code, "Обязательное поле bounded competitor research не заполнено.");
  return normalized;
}

function exactPublicUrl(value: unknown) {
  try {
    const url = normalizePublicHttpsUrl(String(value ?? ""));
    url.hash = "";
    return url.toString();
  } catch {
    fail("COMPETITOR_DESTINATION_UNSAFE", "Competitor destination должен быть точным публичным HTTPS URL без credentials.");
  }
}

function validObservationDate(value: unknown) {
  const normalized = requiredText(value, "COMPETITOR_OBSERVATION_DATE_REQUIRED", 100);
  if (!Number.isFinite(Date.parse(normalized))) {
    fail("COMPETITOR_OBSERVATION_DATE_INVALID", "Дата competitor observation должна быть ISO timestamp.");
  }
  return new Date(Date.parse(normalized)).toISOString();
}

const PROMPT_INJECTION = /(?:ignore|disregard|override|forget)\s+(?:all\s+)?(?:previous|prior|system|developer)\s+(?:instructions?|prompts?)|(?:system|developer)\s+prompt|reveal\s+(?:the\s+)?(?:prompt|secrets?|credentials?)|игнорир\p{L}*\s+(?:предыдущ\p{L}*|системн\p{L}*)\s+(?:инструкц\p{L}*|промпт\p{L}*)|раскрой\p{L}*\s+(?:системн\p{L}*\s+)?(?:промпт|секрет|уч[её]тн\p{L}*\s+данн\p{L}*)/iu;
const HIDDEN_PERFORMANCE = /(?:\b(?:advertising\s+budget|budget|spend|cpc|cpa|roi|roas|conversions?|profitability|performance|effectiveness|account\s+state|internal\s+strategy|bids?)\b|бюджет\p{L}*|расход\p{L}*\s+(?:на\s+)?реклам\p{L}*|цен\p{L}*\s+(?:за\s+)?клик|стоимост\p{L}*\s+(?:за\s+)?клик|стоимост\p{L}*\s+(?:за\s+)?(?:заявк\p{L}*|конверси\p{L}*)|конверси\p{L}*|эффективност\p{L}*|окупаемост\p{L}*|рентабельност\p{L}*|прибыльност\p{L}*|состояни\p{L}*\s+аккаунт\p{L}*|внутренн\p{L}*\s+стратег\p{L}*|(?:^|\s)ставк\p{L}*)/iu;

export function containsCompetitorPromptInjection(value: unknown) {
  return PROMPT_INJECTION.test(String(value ?? ""));
}

export function containsHiddenCompetitorPerformance(value: unknown) {
  return HIDDEN_PERFORMANCE.test(String(value ?? "").replace(/[_-]+/gu, " "));
}

export function createBoundedCompetitorCandidateSet(input: {
  rule: string;
  candidates: Array<{ competitor: string; rationale: string; exactDestinations: string[] }>;
}): CompetitorCandidateSet {
  const rule = requiredText(input.rule, "COMPETITOR_SET_RULE_REQUIRED", 1_000);
  assertSafeObservationText(rule);
  if (!Array.isArray(input.candidates) || input.candidates.length < 1 || input.candidates.length > MAXIMUM_CANDIDATES) {
    fail("COMPETITOR_CANDIDATE_SET_UNBOUNDED", `Candidate set должен содержать от 1 до ${MAXIMUM_CANDIDATES} конкурентов.`);
  }
  const seenCompetitors = new Set<string>();
  const candidates = input.candidates.map((candidate) => {
    const competitor = requiredText(candidate.competitor, "COMPETITOR_NAME_REQUIRED", 200);
    assertSafeObservationText(competitor);
    const identity = competitor.toLocaleLowerCase("ru-RU");
    if (seenCompetitors.has(identity)) fail("COMPETITOR_CANDIDATE_DUPLICATE", "Competitor candidate должен быть уникальным.");
    seenCompetitors.add(identity);
    const rationale = requiredText(candidate.rationale, "COMPETITOR_CANDIDATE_RATIONALE_REQUIRED", 1_000);
    assertSafeObservationText(rationale);
    if (!Array.isArray(candidate.exactDestinations)
      || candidate.exactDestinations.length < 1
      || candidate.exactDestinations.length > MAXIMUM_DESTINATIONS_PER_CANDIDATE) {
      fail("COMPETITOR_DESTINATION_SET_UNBOUNDED", "Каждый candidate требует от 1 до 3 exact public destinations.");
    }
    const exactDestinations = [...new Set(candidate.exactDestinations.map(exactPublicUrl))].sort();
    if (exactDestinations.length !== candidate.exactDestinations.length) {
      fail("COMPETITOR_DESTINATION_DUPLICATE", "Exact destination allowlist не должна содержать дубликаты.");
    }
    return { competitor, rationale, exact_destinations: exactDestinations };
  });
  return {
    schema_version: BOUNDED_COMPETITOR_RESEARCH_SCHEMA,
    competitor_set_rule: rule,
    candidates,
  };
}

function assertSafeObservationText(value: unknown) {
  if (containsCompetitorPromptInjection(value)) {
    fail("COMPETITOR_PROMPT_INJECTION_REJECTED", "Инструкция из публичного контента отклонена и не может управлять агентом.");
  }
  if (containsHiddenCompetitorPerformance(value)) {
    fail("COMPETITOR_HIDDEN_PERFORMANCE_REJECTED", "Публичное наблюдение не может доказывать скрытую эффективность или внутреннее состояние конкурента.");
  }
}

function evidenceStatus(observedCount: number | null, denominator: number): "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" {
  if (observedCount === null) return "UNAVAILABLE";
  return observedCount === denominator ? "AVAILABLE" : "PARTIAL";
}

export function buildCompetitorMatrix(input: {
  candidateSet: CompetitorCandidateSet;
  rows: CompetitorMatrixRowInput[];
}): CompetitorMatrix {
  if (input.candidateSet?.schema_version !== BOUNDED_COMPETITOR_RESEARCH_SCHEMA) {
    fail("COMPETITOR_SCHEMA_UNSUPPORTED", "Competitor candidate set schema не поддерживается.");
  }
  const candidateSet = createBoundedCompetitorCandidateSet({
    rule: input.candidateSet.competitor_set_rule,
    candidates: input.candidateSet.candidates.map((candidate) => ({
      competitor: candidate.competitor,
      rationale: candidate.rationale,
      exactDestinations: candidate.exact_destinations,
    })),
  });
  if (!Array.isArray(input.rows) || input.rows.length > candidateSet.candidates.length * MAXIMUM_DESTINATIONS_PER_CANDIDATE) {
    fail("COMPETITOR_MATRIX_UNBOUNDED", "Competitor matrix превысила bounded candidate destination set.");
  }
  const candidates = new Map(candidateSet.candidates.map((candidate) => [candidate.competitor.toLocaleLowerCase("ru-RU"), candidate]));
  const observedDestinations = new Set<string>();
  const rows = input.rows.map((row) => {
    const competitor = requiredText(row.competitor, "COMPETITOR_NAME_REQUIRED", 200);
    const candidate = candidates.get(competitor.toLocaleLowerCase("ru-RU"));
    if (!candidate) fail("COMPETITOR_NOT_IN_CANDIDATE_SET", "Matrix row отсутствует в bounded candidate set.");
    const exactLanding = exactPublicUrl(row.exactLanding);
    if (!candidate.exact_destinations.includes(exactLanding)) {
      fail("COMPETITOR_DESTINATION_NOT_ALLOWLISTED", "Matrix row landing отсутствует в exact destination allowlist.");
    }
    if (observedDestinations.has(exactLanding)) fail("COMPETITOR_MATRIX_ROW_DUPLICATE", "Exact landing уже сохранён в matrix.");
    observedDestinations.add(exactLanding);
    const sourceUrl = exactPublicUrl(row.source?.url);
    if (sourceUrl !== exactLanding) fail("COMPETITOR_SOURCE_DRIFT", "Matrix source должен совпадать с exact observed landing.");
    const productsServices = Array.isArray(row.productsServices)
      ? [...new Set(row.productsServices.map((value) => requiredText(value, "COMPETITOR_PRODUCT_REQUIRED", 500)))].slice(0, 12)
      : [];
    if (!productsServices.length) fail("COMPETITOR_PRODUCT_REQUIRED", "Matrix row требует наблюдаемый product/service.");
    const observedOfferMessage = requiredText(row.observedOfferMessage, "COMPETITOR_OFFER_REQUIRED", 1_000);
    const sourceLabel = requiredText(row.source?.label, "COMPETITOR_SOURCE_REQUIRED", 300);
    const geography = requiredText(row.geography, "COMPETITOR_SCOPE_REQUIRED", 200);
    const device = requiredText(row.device, "COMPETITOR_SCOPE_REQUIRED", 100);
    const priceStatus = row.publishedPrice?.status;
    const priceValue = priceStatus === "PUBLISHED"
      ? requiredText(row.publishedPrice.value, "COMPETITOR_PRICE_REQUIRED", 300)
      : priceStatus === "NOT_PUBLISHED" && row.publishedPrice.value === null
        ? null
        : fail("COMPETITOR_PRICE_STATUS_INVALID", "Цена должна быть опубликована с value или явно не опубликована.");
    const ad = row.adVisibilitySample;
    if (!ad || !["OBSERVED", "NOT_OBSERVED", "UNAVAILABLE"].includes(ad.status)) {
      fail("COMPETITOR_VISIBILITY_SAMPLE_INVALID", "Matrix row требует bounded ad-visibility sample status.");
    }
    const query = ad.status === "UNAVAILABLE"
      ? ad.query === null ? null : fail("COMPETITOR_VISIBILITY_SAMPLE_INVALID", "Unavailable visibility query должна оставаться null.")
      : requiredText(ad.query, "COMPETITOR_VISIBILITY_SAMPLE_INVALID", 500);
    const adSource = requiredText(ad.source, "COMPETITOR_VISIBILITY_SAMPLE_INVALID", 300);
    const adGeography = requiredText(ad.geography, "COMPETITOR_SCOPE_REQUIRED", 200);
    const adDevice = requiredText(ad.device, "COMPETITOR_SCOPE_REQUIRED", 100);
    [productsServices, observedOfferMessage, priceValue, sourceLabel, geography, device, query, adSource, adGeography, adDevice]
      .forEach(assertSafeObservationText);
    return {
      competitor: candidate.competitor,
      products_services: productsServices,
      observed_offer_message: observedOfferMessage,
      published_price: { status: priceStatus, value: priceValue },
      exact_landing: exactLanding,
      source: { label: sourceLabel, url: sourceUrl },
      geography,
      device,
      observation_date: validObservationDate(row.observedAt),
      ad_visibility_sample: {
        status: ad.status,
        query,
        source: adSource,
        geography: adGeography,
        device: adDevice,
        observation_date: validObservationDate(ad.observedAt),
      },
    };
  }).sort((left, right) => left.competitor.localeCompare(right.competitor, "ru-RU") || left.exact_landing.localeCompare(right.exact_landing));

  const observedCompetitors = new Set(rows.map((row) => row.competitor));
  const denominator = candidateSet.candidates.length;
  const offersObserved = rows.length ? observedCompetitors.size : null;
  const pricesObserved = rows.length
    ? new Set(rows.filter((row) => row.published_price.status === "PUBLISHED").map((row) => row.competitor)).size
    : null;
  const visibilityObserved = rows.length
    ? new Set(rows.filter((row) => row.ad_visibility_sample.status === "OBSERVED").map((row) => row.competitor)).size
    : null;
  const aggregate = (claim: string, observedCount: number | null) => ({
    claim,
    competitor_set_rule: candidateSet.competitor_set_rule,
    denominator,
    observed_count: observedCount,
    evidence_status: evidenceStatus(observedCount, denominator),
    limitation: "Наблюдение относится только к ограниченному набору и не доказывает эффективность.",
  });
  return {
    schema_version: BOUNDED_COMPETITOR_RESEARCH_SCHEMA,
    status: evidenceStatus(offersObserved, denominator),
    candidate_set: candidateSet,
    rows,
    coverage: candidateSet.candidates.map((candidate) => ({
      competitor: candidate.competitor,
      status: observedCompetitors.has(candidate.competitor) ? "OBSERVED" as const : "UNAVAILABLE" as const,
    })),
    aggregate_claims: [
      aggregate("Публичное предложение наблюдалось", offersObserved),
      aggregate("Публичная цена опубликована", pricesObserved),
      aggregate("Рекламная видимость наблюдалась", visibilityObserved),
    ],
    limitations: [
      "Матрица описывает только публично наблюдаемое позиционирование в указанную дату и в указанном срезе.",
      "Публичные наблюдения не показывают расходы, CPC, конверсии, CPA, ROI, прибыльность, состояние аккаунта, внутреннюю стратегию или эффективность.",
      "Неполученные и частичные наблюдения остаются недоступными, а не нулевыми.",
    ],
  };
}

export async function researchBoundedCompetitorCandidateSet(
  candidateSet: CompetitorCandidateSet,
  dependencies: SiteResearchDependencies,
): Promise<{
  candidate_set: CompetitorCandidateSet;
  observations: Array<{ competitor: string; rationale: string; page: PublicCompetitorPageObservation }>;
}> {
  if (candidateSet?.schema_version !== BOUNDED_COMPETITOR_RESEARCH_SCHEMA) {
    fail("COMPETITOR_SCHEMA_UNSUPPORTED", "Competitor candidate set schema не поддерживается.");
  }
  const validated = createBoundedCompetitorCandidateSet({
    rule: candidateSet.competitor_set_rule,
    candidates: candidateSet.candidates.map((candidate) => ({
      competitor: candidate.competitor,
      rationale: candidate.rationale,
      exactDestinations: candidate.exact_destinations,
    })),
  });
  const observations: Array<{ competitor: string; rationale: string; page: PublicCompetitorPageObservation }> = [];
  for (const candidate of validated.candidates) {
    const allowedHosts = [...new Set(candidate.exact_destinations.map((destination) => new URL(destination).hostname.toLowerCase()))];
    for (const destination of candidate.exact_destinations) {
      const origin = new URL(destination).origin;
      observations.push({
        competitor: candidate.competitor,
        rationale: candidate.rationale,
        page: await researchAllowlistedPublicCompetitorPage(destination, {
          allowedHosts,
          allowedDestinations: candidate.exact_destinations,
          policyId: "public-competitor-pages",
          policyVersion: "2.0.0",
          policyUrl: `${origin}/robots.txt`,
          observationScope: `Exact public landing for ${candidate.competitor}; rationale: ${candidate.rationale}`,
        }, dependencies),
      });
    }
  }
  return { candidate_set: validated, observations };
}
