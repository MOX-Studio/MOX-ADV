import {
  assertSafeCompetitorObservationText,
  createBoundedCompetitorCandidateSet,
  type CompetitorCandidateSet,
} from "./competitor-research.ts";
import { researchAllowlistedPublicCompetitorPage, type SiteResearchDependencies } from "./site-research.ts";
import { cleanText } from "./text.ts";

export type ProductionCompetitorResearchInput = {
  competitor_candidate_set: CompetitorCandidateSet;
  competitor_observations: Array<Record<string, unknown>>;
};

type ConfiguredCandidate = {
  competitor: string;
  rationale: string;
  exactDestinations: string[];
  productsServices: string[];
  observedOfferMessage: string;
  evidenceQuote: string;
  publishedPrice: { status: "PUBLISHED"; value: string } | { status: "NOT_PUBLISHED"; value: null };
  adVisibilitySample: {
    status: "OBSERVED" | "NOT_OBSERVED" | "UNAVAILABLE";
    query: string | null;
    source: string;
    observedAt: string | null;
  } | null;
  campaignAnalysis: {
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

type ConfiguredResearch = {
  rule: string;
  geography: string;
  device: string;
  candidates: ConfiguredCandidate[];
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requiredText(value: unknown, label: string, maximum: number) {
  const normalized = cleanText(String(value ?? ""), maximum);
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function stringList(value: unknown, label: string, maximumItems: number, maximumLength: number) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumItems) {
    throw new Error(`${label} must contain between 1 and ${maximumItems} items.`);
  }
  return value.map((item) => requiredText(item, label, maximumLength));
}

export function parseProductionCompetitorResearchConfig(raw: string): ConfiguredResearch {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Production competitor research configuration is not valid JSON.");
  }
  const input = record(parsed);
  const candidates = Array.isArray(input.candidates) ? input.candidates.map((value) => {
    const candidate = record(value);
    const price = record(candidate.publishedPrice);
    const priceStatus = String(price.status ?? "");
    const publishedPrice = priceStatus === "PUBLISHED"
      ? { status: "PUBLISHED" as const, value: requiredText(price.value, "Published competitor price", 300) }
      : priceStatus === "NOT_PUBLISHED" && price.value === null
        ? { status: "NOT_PUBLISHED" as const, value: null }
        : (() => { throw new Error("Configured competitor price must be published with a value or explicitly not published."); })();
    const sample = record(candidate.adVisibilitySample);
    const sampleStatus = String(sample.status ?? "");
    const adVisibilitySample = Object.keys(sample).length === 0 ? null : (() => {
      if (!["OBSERVED", "NOT_OBSERVED", "UNAVAILABLE"].includes(sampleStatus)) {
        throw new Error("Configured competitor ad visibility status is unsupported.");
      }
      const query = sampleStatus === "UNAVAILABLE"
        ? sample.query === null ? null : (() => { throw new Error("Unavailable competitor ad visibility query must be null."); })()
        : requiredText(sample.query, "Competitor ad visibility query", 500);
      const observedAt = sample.observedAt === null || sample.observedAt === undefined
        ? null
        : (() => {
            const parsed = Date.parse(requiredText(sample.observedAt, "Competitor ad visibility observation date", 100));
            if (!Number.isFinite(parsed)) throw new Error("Configured competitor ad visibility date must be an ISO timestamp.");
            return new Date(parsed).toISOString();
          })();
      return {
        status: sampleStatus as "OBSERVED" | "NOT_OBSERVED" | "UNAVAILABLE",
        query,
        source: requiredText(sample.source, "Competitor ad visibility source", 1_000),
        observedAt,
      };
    })();
    const rawAnalysis = record(candidate.campaignAnalysis);
    const campaignAnalysis = Object.keys(rawAnalysis).length === 0 ? null : (() => {
      const evidenceStatus = String(rawAnalysis.evidenceStatus ?? "");
      const changedFamily = String(rawAnalysis.changedFamily ?? "");
      if (!["OBSERVED_AD", "HYPOTHESIS_FROM_PUBLIC_POSITIONING"].includes(evidenceStatus)) {
        throw new Error("Configured competitor campaign analysis evidence status is unsupported.");
      }
      if (evidenceStatus === "OBSERVED_AD" && adVisibilitySample?.status !== "OBSERVED") {
        throw new Error("Observed competitor campaign analysis requires an observed ad visibility sample.");
      }
      if (!["QUALIFIED_ACTION", "AUDIENCE_SPECIFICITY", "MESSAGE_OFFER"].includes(changedFamily)) {
        throw new Error("Configured competitor campaign analysis changed family is unsupported.");
      }
      return {
        evidenceStatus: evidenceStatus as "OBSERVED_AD" | "HYPOTHESIS_FROM_PUBLIC_POSITIONING",
        patternId: requiredText(rawAnalysis.patternId, "Competitor campaign pattern ID", 200),
        patternLabel: requiredText(rawAnalysis.patternLabel, "Competitor campaign pattern", 500),
        campaignType: requiredText(rawAnalysis.campaignType, "Competitor campaign type", 500),
        audienceSignal: requiredText(rawAnalysis.audienceSignal, "Competitor campaign audience signal", 1_000),
        adMessage: requiredText(rawAnalysis.adMessage, "Competitor campaign message", 1_000),
        callToAction: requiredText(rawAnalysis.callToAction, "Competitor campaign call to action", 500),
        strategyFit: requiredText(rawAnalysis.strategyFit, "Competitor campaign strategy fit", 1_000),
        weakness: requiredText(rawAnalysis.weakness, "Competitor campaign weakness", 1_000),
        improvementHypothesis: requiredText(rawAnalysis.improvementHypothesis, "Competitor campaign improvement hypothesis", 1_000),
        changedFamily: changedFamily as "QUALIFIED_ACTION" | "AUDIENCE_SPECIFICITY" | "MESSAGE_OFFER",
      };
    })();
    const configuredCandidate = {
      competitor: requiredText(candidate.competitor, "Competitor", 200),
      rationale: requiredText(candidate.rationale, "Competitor rationale", 1_000),
      exactDestinations: stringList(candidate.exactDestinations, "Competitor exact destinations", 3, 2_000),
      productsServices: stringList(candidate.productsServices, "Competitor products and services", 12, 500),
      observedOfferMessage: requiredText(candidate.observedOfferMessage, "Competitor offer message", 1_000),
      evidenceQuote: requiredText(candidate.evidenceQuote, "Competitor evidence quote", 1_000),
      publishedPrice,
      adVisibilitySample,
      campaignAnalysis,
    } satisfies ConfiguredCandidate;
    [
      configuredCandidate.competitor,
      configuredCandidate.rationale,
      ...configuredCandidate.productsServices,
      configuredCandidate.observedOfferMessage,
      configuredCandidate.evidenceQuote,
      configuredCandidate.adVisibilitySample?.query,
      configuredCandidate.adVisibilitySample?.source,
      ...Object.values(configuredCandidate.campaignAnalysis ?? {}),
    ].forEach(assertSafeCompetitorObservationText);
    return configuredCandidate;
  }) : [];
  const result = {
    rule: requiredText(input.rule, "Competitor set rule", 1_000),
    geography: requiredText(input.geography, "Competitor geography", 200),
    device: requiredText(input.device ?? "all", "Competitor device", 100),
    candidates,
  };
  createBoundedCompetitorCandidateSet(result);
  return result;
}

function competitorSubject(value: string) {
  return cleanText(value, 200)
    .toLocaleLowerCase("ru-RU")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

export async function collectProductionCompetitorResearch(
  rawConfig: string,
  dependencies: SiteResearchDependencies,
): Promise<ProductionCompetitorResearchInput> {
  const configured = parseProductionCompetitorResearchConfig(rawConfig);
  const candidateSet = createBoundedCompetitorCandidateSet(configured);
  const byName = new Map(configured.candidates.map((candidate) => [candidate.competitor.toLocaleLowerCase("ru-RU"), candidate]));
  const observations: Array<Record<string, unknown>> = [];

  for (const candidate of candidateSet.candidates) {
    const configuredCandidate = byName.get(candidate.competitor.toLocaleLowerCase("ru-RU"));
    if (!configuredCandidate) continue;
    const allowedHosts = [...new Set(candidate.exact_destinations.map((destination) => new URL(destination).hostname.toLowerCase()))];
    for (const destination of candidate.exact_destinations) {
      try {
        const origin = new URL(destination).origin;
        const page = await researchAllowlistedPublicCompetitorPage(destination, {
          allowedHosts,
          allowedDestinations: candidate.exact_destinations,
          policyId: "public-competitor-pages",
          policyVersion: "2.0.0",
          policyUrl: `${origin}/robots.txt`,
          observationScope: `Exact public landing for ${candidate.competitor}; rationale: ${candidate.rationale}`,
        }, dependencies);
        observations.push({
          source_url: page.source_url,
          observed_at: page.observed_at,
          collected_via: page.collected_via,
          locator: page.locator,
          policy: page.policy,
          scope: page.scope,
          claim: {
            subject: `competitor:${competitorSubject(candidate.competitor)}`,
            predicate: "published_offer",
            value: configuredCandidate.observedOfferMessage,
          },
          raw_quote: configuredCandidate.evidenceQuote,
          matrix_row: {
            competitor: candidate.competitor,
            products_services: configuredCandidate.productsServices,
            observed_offer_message: configuredCandidate.observedOfferMessage,
            published_price: configuredCandidate.publishedPrice,
            exact_landing: page.source_url,
            source: { label: "Публичная страница услуги", url: page.source_url },
            geography: configured.geography,
            device: configured.device,
            observation_date: page.observed_at,
            campaign_analysis: configuredCandidate.campaignAnalysis ? {
              evidence_status: configuredCandidate.campaignAnalysis.evidenceStatus,
              pattern_id: configuredCandidate.campaignAnalysis.patternId,
              pattern_label: configuredCandidate.campaignAnalysis.patternLabel,
              campaign_type: configuredCandidate.campaignAnalysis.campaignType,
              audience_signal: configuredCandidate.campaignAnalysis.audienceSignal,
              ad_message: configuredCandidate.campaignAnalysis.adMessage,
              call_to_action: configuredCandidate.campaignAnalysis.callToAction,
              strategy_fit: configuredCandidate.campaignAnalysis.strategyFit,
              weakness: configuredCandidate.campaignAnalysis.weakness,
              improvement_hypothesis: configuredCandidate.campaignAnalysis.improvementHypothesis,
              changed_family: configuredCandidate.campaignAnalysis.changedFamily,
            } : null,
            ad_visibility_sample: configuredCandidate.adVisibilitySample ? {
              status: configuredCandidate.adVisibilitySample.status,
              query: configuredCandidate.adVisibilitySample.query,
              source: configuredCandidate.adVisibilitySample.source,
              geography: configured.geography,
              device: configured.device,
              observation_date: configuredCandidate.adVisibilitySample.observedAt ?? page.observed_at,
            } : {
              status: "UNAVAILABLE",
              query: null,
              source: "Поисковый рекламный срез не выполнялся; запрос не задан",
              geography: configured.geography,
              device: configured.device,
              observation_date: page.observed_at,
            },
          },
          limitations: [
            "Наблюдение относится только к указанной публичной странице и дате.",
            configuredCandidate.adVisibilitySample
              ? "Рекламная видимость относится только к зафиксированным запросу, географии, устройству, дате и публичному источнику."
              : "Поисковый рекламный срез не выполнялся; отсутствие наблюдения не означает отсутствие рекламы.",
          ],
        });
      } catch {
        // A failed exact landing remains unavailable in the denominator; it is never converted to zero evidence.
      }
    }
  }

  return {
    competitor_candidate_set: candidateSet,
    competitor_observations: observations,
  };
}
