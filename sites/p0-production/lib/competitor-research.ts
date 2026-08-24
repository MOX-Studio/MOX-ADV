import { normalizePublicHttpsUrl } from "./site-url.ts";
import { cleanText } from "./text.ts";
import {
  researchAllowlistedPublicCompetitorPage,
  type PublicCompetitorPageObservation,
  type SiteResearchDependencies,
} from "./site-research.ts";

export const BOUNDED_COMPETITOR_RESEARCH_SCHEMA = "p0-bounded-competitor-research-v1";
const MAXIMUM_CANDIDATES = 10;
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
  campaignAnalysis?: {
    evidenceStatus: "OBSERVED_AD" | "HYPOTHESIS_FROM_PUBLIC_POSITIONING";
    patternId: string;
    patternLabel: string;
    campaignType: string;
    audienceSignal: string;
    adMessage: string;
    callToAction: string;
    strategyFit: string;
    weakness: string;
    improvementHypothesis: string;
    changedFamily: "QUALIFIED_ACTION" | "AUDIENCE_SPECIFICITY" | "MESSAGE_OFFER";
  } | null;
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
    campaign_analysis: {
      evidence_status: "OBSERVED_AD" | "HYPOTHESIS_FROM_PUBLIC_POSITIONING";
      pattern_id: string;
      pattern_label: string;
      campaign_type: string;
      audience_signal: string;
      ad_message: string;
      call_to_action: string;
      strategy_fit: string;
      weakness: string;
      improvement_hypothesis: string;
      changed_family: "QUALIFIED_ACTION" | "AUDIENCE_SPECIFICITY" | "MESSAGE_OFFER";
    } | null;
  }>;
  coverage: Array<{ competitor: string; status: "OBSERVED" | "UNAVAILABLE" }>;
  aggregate_claims: Array<{
    claim: string;
    claim_status: "OBSERVED_PUBLIC_FACT_NOT_PERFORMANCE_FACT" | "OBSERVED_TECHNIQUE_NOT_PERFORMANCE_FACT";
    competitor_set_rule: string;
    denominator: number;
    observed_count: number | null;
    evidence_status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
    evidence_set: Array<{
      competitor: string;
      exact_landing: string;
      observation_date: string;
    }>;
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
const HIDDEN_PERFORMANCE = /(?:\b(?:advertising\s+budget|budget|spend|ctr|cvr|cpc|cpa|roi|roas|success\s+rate|conversions?|profitability|performance|effectiveness|account\s+state|internal\s+strategy|bids?|ads?\s+(?:launched|running|active))\b|бюджет\p{L}*|расход\p{L}*\s+(?:на\s+)?реклам\p{L}*|цен\p{L}*\s+(?:за\s+)?клик|стоимост\p{L}*\s+(?:за\s+)?клик|стоимост\p{L}*\s+(?:за\s+)?(?:заявк\p{L}*|конверси\p{L}*)|конверси\p{L}*|эффективност\p{L}*|результативност\p{L}*|успешност\p{L}*\s+(?:реклам\p{L}*)?|окупаемост\p{L}*|рентабельност\p{L}*|прибыльност\p{L}*|состояни\p{L}*\s+аккаунт\p{L}*|внутренн\p{L}*\s+стратег\p{L}*|реклам\p{L}*\s+(?:запущен\p{L}*|работа\p{L}*|активн\p{L}*)|(?:^|\s)ставк\p{L}*)/iu;

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
  assertSafeCompetitorObservationText(rule);
  if (!Array.isArray(input.candidates) || input.candidates.length < 1 || input.candidates.length > MAXIMUM_CANDIDATES) {
    fail("COMPETITOR_CANDIDATE_SET_UNBOUNDED", `Candidate set должен содержать от 1 до ${MAXIMUM_CANDIDATES} конкурентов.`);
  }
  const seenCompetitors = new Set<string>();
  const candidates = input.candidates.map((candidate) => {
    const competitor = requiredText(candidate.competitor, "COMPETITOR_NAME_REQUIRED", 200);
    assertSafeCompetitorObservationText(competitor);
    const identity = competitor.toLocaleLowerCase("ru-RU");
    if (seenCompetitors.has(identity)) fail("COMPETITOR_CANDIDATE_DUPLICATE", "Competitor candidate должен быть уникальным.");
    seenCompetitors.add(identity);
    const rationale = requiredText(candidate.rationale, "COMPETITOR_CANDIDATE_RATIONALE_REQUIRED", 1_000);
    assertSafeCompetitorObservationText(rationale);
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

export function assertSafeCompetitorObservationText(value: unknown) {
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
    const adSource = requiredText(ad.source, "COMPETITOR_VISIBILITY_SAMPLE_INVALID", 1_000);
    const adGeography = requiredText(ad.geography, "COMPETITOR_SCOPE_REQUIRED", 200);
    const adDevice = requiredText(ad.device, "COMPETITOR_SCOPE_REQUIRED", 100);
    const rawAnalysis = row.campaignAnalysis;
    const campaignAnalysis = rawAnalysis ? (() => {
      if (!["OBSERVED_AD", "HYPOTHESIS_FROM_PUBLIC_POSITIONING"].includes(rawAnalysis.evidenceStatus)) {
        fail("COMPETITOR_CAMPAIGN_ANALYSIS_INVALID", "Campaign analysis evidence status не поддерживается.");
      }
      if (rawAnalysis.evidenceStatus === "OBSERVED_AD" && ad.status !== "OBSERVED") {
        fail("COMPETITOR_CAMPAIGN_ANALYSIS_INVALID", "Observed campaign analysis требует наблюдаемую рекламную видимость.");
      }
      if (!["QUALIFIED_ACTION", "AUDIENCE_SPECIFICITY", "MESSAGE_OFFER"].includes(rawAnalysis.changedFamily)) {
        fail("COMPETITOR_CAMPAIGN_ANALYSIS_INVALID", "Campaign improvement требует одну поддержанную hypothesis family.");
      }
      const analysis = {
        evidence_status: rawAnalysis.evidenceStatus,
        pattern_id: requiredText(rawAnalysis.patternId, "COMPETITOR_CAMPAIGN_PATTERN_REQUIRED", 200),
        pattern_label: requiredText(rawAnalysis.patternLabel, "COMPETITOR_CAMPAIGN_PATTERN_REQUIRED", 500),
        campaign_type: requiredText(rawAnalysis.campaignType, "COMPETITOR_CAMPAIGN_TYPE_REQUIRED", 500),
        audience_signal: requiredText(rawAnalysis.audienceSignal, "COMPETITOR_CAMPAIGN_AUDIENCE_REQUIRED", 1_000),
        ad_message: requiredText(rawAnalysis.adMessage, "COMPETITOR_CAMPAIGN_MESSAGE_REQUIRED", 1_000),
        call_to_action: requiredText(rawAnalysis.callToAction, "COMPETITOR_CAMPAIGN_CTA_REQUIRED", 500),
        strategy_fit: requiredText(rawAnalysis.strategyFit, "COMPETITOR_CAMPAIGN_STRATEGY_FIT_REQUIRED", 1_000),
        weakness: requiredText(rawAnalysis.weakness, "COMPETITOR_CAMPAIGN_WEAKNESS_REQUIRED", 1_000),
        improvement_hypothesis: requiredText(rawAnalysis.improvementHypothesis, "COMPETITOR_CAMPAIGN_HYPOTHESIS_REQUIRED", 1_000),
        changed_family: rawAnalysis.changedFamily,
      };
      Object.values(analysis).forEach(assertSafeCompetitorObservationText);
      return analysis;
    })() : null;
    [productsServices, observedOfferMessage, priceValue, sourceLabel, geography, device, query, adSource, adGeography, adDevice]
      .forEach(assertSafeCompetitorObservationText);
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
      campaign_analysis: campaignAnalysis,
    };
  }).sort((left, right) => left.competitor.localeCompare(right.competitor, "ru-RU") || left.exact_landing.localeCompare(right.exact_landing));

  const analysesByPattern = Map.groupBy(
    rows.filter((row) => row.campaign_analysis),
    (row) => row.campaign_analysis!.pattern_id,
  );
  for (const patternRows of analysesByPattern.values()) {
    const signatures = new Set(patternRows.map((row) => JSON.stringify(row.campaign_analysis)));
    if (signatures.size !== 1) {
      fail("COMPETITOR_CAMPAIGN_PATTERN_CONFLICT", "Один campaign pattern ID не может объединять разные техники, evidence status или improvement hypotheses.");
    }
  }

  const observedCompetitors = new Set(rows.map((row) => row.competitor));
  const denominator = candidateSet.candidates.length;
  const offersObserved = rows.length ? observedCompetitors.size : null;
  const pricesObserved = rows.length
    ? new Set(rows.filter((row) => row.published_price.status === "PUBLISHED").map((row) => row.competitor)).size
    : null;
  const availableVisibilitySamples = rows.filter((row) => row.ad_visibility_sample.status !== "UNAVAILABLE");
  const visibilityObserved = availableVisibilitySamples.length
    ? new Set(availableVisibilitySamples.filter((row) => row.ad_visibility_sample.status === "OBSERVED").map((row) => row.competitor)).size
    : null;
  const campaignPatterns = analysesByPattern;
  const exactEvidenceSet = (supportingRows: typeof rows) => supportingRows
    .map((row) => ({
      competitor: row.competitor,
      exact_landing: row.exact_landing,
      observation_date: row.observation_date,
    }))
    .sort((left, right) => left.competitor.localeCompare(right.competitor, "ru-RU")
      || left.exact_landing.localeCompare(right.exact_landing));
  const aggregate = (
    claim: string,
    observedCount: number | null,
    supportingRows: typeof rows,
    claimStatus: CompetitorMatrix["aggregate_claims"][number]["claim_status"] = "OBSERVED_PUBLIC_FACT_NOT_PERFORMANCE_FACT",
  ) => ({
    claim,
    claim_status: claimStatus,
    competitor_set_rule: candidateSet.competitor_set_rule,
    denominator,
    observed_count: observedCount,
    evidence_status: evidenceStatus(observedCount, denominator),
    evidence_set: exactEvidenceSet(supportingRows),
    limitation: "Наблюдение относится только к ограниченному набору и не доказывает эффективность.",
  });
  const campaignPatternClaims = [...campaignPatterns.entries()]
    .map(([, patternRows]) => {
      const analysis = patternRows[0].campaign_analysis!;
      const count = new Set(patternRows.map((row) => row.competitor)).size;
      const prefix = analysis.evidence_status === "OBSERVED_AD" ? "Наблюдаемый рекламный паттерн" : "Наблюдаемый паттерн публичного позиционирования";
      return aggregate(`${prefix}: ${analysis.pattern_label}`, count, patternRows, "OBSERVED_TECHNIQUE_NOT_PERFORMANCE_FACT");
    })
    .sort((left, right) => (right.observed_count ?? 0) - (left.observed_count ?? 0) || left.claim.localeCompare(right.claim, "ru-RU"));
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
      aggregate("Публичное предложение наблюдалось", offersObserved, rows),
      aggregate("Публичная цена опубликована", pricesObserved, rows.filter((row) => row.published_price.status === "PUBLISHED")),
      aggregate("Рекламная видимость наблюдалась", visibilityObserved, availableVisibilitySamples.filter((row) => row.ad_visibility_sample.status === "OBSERVED")),
      ...campaignPatternClaims,
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
