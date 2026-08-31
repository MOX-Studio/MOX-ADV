import {
  NO_APPROVED_COMPETITOR_AD_SOURCE,
  assertSafeCompetitorObservationText,
  createBoundedCompetitorCandidateSet,
  type CompetitorAdObservationInput,
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
  adVisibilitySample: Omit<CompetitorAdObservationInput, "geography" | "device"> | null;
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
      if (sampleStatus === NO_APPROVED_COMPETITOR_AD_SOURCE) {
        return {
          status: NO_APPROVED_COMPETITOR_AD_SOURCE,
          sourceClass: null,
          sourceName: null,
          query: null,
          observedAt: null,
          limitation: requiredText(sample.limitation, "Competitor ad observation limitation", 1_000),
          raw: null,
          extraction: null,
          provenance: null,
          approval: null,
        } satisfies Omit<CompetitorAdObservationInput, "geography" | "device">;
      }
      if (!["OBSERVED", "NOT_OBSERVED_IN_SAMPLE"].includes(sampleStatus)) {
        throw new Error("Configured competitor ad observation status is unsupported.");
      }
      const sourceClass = String(sample.sourceClass ?? "");
      if (!["OWNER_PROVIDED_ARTIFACT", "LICENSED_PROVIDER"].includes(sourceClass)) {
        throw new Error("Configured competitor ad observation source is not approved.");
      }
      const raw = record(sample.raw);
      const extraction = record(sample.extraction);
      const provenance = record(sample.provenance);
      const approval = record(sample.approval);
      return {
        status: sampleStatus as "OBSERVED" | "NOT_OBSERVED_IN_SAMPLE",
        sourceClass: sourceClass as "OWNER_PROVIDED_ARTIFACT" | "LICENSED_PROVIDER",
        sourceName: requiredText(sample.sourceName, "Competitor ad observation source", 300),
        query: requiredText(sample.query, "Competitor ad observation query", 500),
        observedAt: requiredText(sample.observedAt, "Competitor ad observation date", 100),
        limitation: requiredText(sample.limitation, "Competitor ad observation limitation", 1_000),
        raw: {
          immutablePointer: requiredText(raw.immutablePointer, "Competitor ad artifact pointer", 2_000),
          sha256: requiredText(raw.sha256, "Competitor ad artifact digest", 100),
          mediaType: requiredText(raw.mediaType, "Competitor ad artifact media type", 200),
          byteLength: Number(raw.byteLength),
        },
        extraction: {
          method: String(extraction.method ?? "") as "manual_span" | "ocr" | "provider_schema",
          adMarker: extraction.adMarker === null ? null : requiredText(extraction.adMarker, "Competitor ad marker", 500),
          locator: requiredText(extraction.locator, "Competitor ad artifact locator", 1_000),
        },
        provenance: {
          obtainedBy: String(provenance.obtainedBy ?? "") as "owner" | "provider",
          obtainedAt: requiredText(provenance.obtainedAt, "Competitor ad artifact provenance date", 100),
        },
        approval: sourceClass === "LICENSED_PROVIDER" ? {
          termsUrl: requiredText(approval.termsUrl, "Competitor ad provider terms", 2_000),
          termsCheckedAt: requiredText(approval.termsCheckedAt, "Competitor ad provider terms date", 100),
          termsSha256: requiredText(approval.termsSha256, "Competitor ad provider terms digest", 100),
          acquisitionMethod: requiredText(approval.acquisitionMethod, "Competitor ad provider acquisition method", 500),
          downstreamUseApproved: approval.downstreamUseApproved === true,
        } as CompetitorAdObservationInput["approval"] : null,
      } satisfies Omit<CompetitorAdObservationInput, "geography" | "device">;
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
      configuredCandidate.adVisibilitySample?.sourceName,
      configuredCandidate.adVisibilitySample?.limitation,
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
              source_class: configuredCandidate.adVisibilitySample.sourceClass,
              source_name: configuredCandidate.adVisibilitySample.sourceName,
              query: configuredCandidate.adVisibilitySample.query,
              geography: configured.geography,
              device: configured.device,
              observation_date: configuredCandidate.adVisibilitySample.observedAt,
              limitation: configuredCandidate.adVisibilitySample.limitation,
              raw: configuredCandidate.adVisibilitySample.raw ? {
                immutable_pointer: configuredCandidate.adVisibilitySample.raw.immutablePointer,
                sha256: configuredCandidate.adVisibilitySample.raw.sha256,
                media_type: configuredCandidate.adVisibilitySample.raw.mediaType,
                byte_length: configuredCandidate.adVisibilitySample.raw.byteLength,
              } : null,
              extraction: configuredCandidate.adVisibilitySample.extraction ? {
                method: configuredCandidate.adVisibilitySample.extraction.method,
                ad_marker: configuredCandidate.adVisibilitySample.extraction.adMarker,
                locator: configuredCandidate.adVisibilitySample.extraction.locator,
              } : null,
              provenance: configuredCandidate.adVisibilitySample.provenance ? {
                obtained_by: configuredCandidate.adVisibilitySample.provenance.obtainedBy,
                obtained_at: configuredCandidate.adVisibilitySample.provenance.obtainedAt,
              } : null,
              approval: configuredCandidate.adVisibilitySample.approval ? {
                terms_url: configuredCandidate.adVisibilitySample.approval.termsUrl,
                terms_checked_at: configuredCandidate.adVisibilitySample.approval.termsCheckedAt,
                terms_sha256: configuredCandidate.adVisibilitySample.approval.termsSha256,
                acquisition_method: configuredCandidate.adVisibilitySample.approval.acquisitionMethod,
                downstream_use_approved: configuredCandidate.adVisibilitySample.approval.downstreamUseApproved,
              } : null,
            } : {
              status: NO_APPROVED_COMPETITOR_AD_SOURCE,
              source_class: null,
              source_name: null,
              query: null,
              geography: configured.geography,
              device: configured.device,
              observation_date: null,
              limitation: "Одобренный source фактических показов не предоставлен; отсутствие наблюдения не означает отсутствие рекламы.",
              raw: null,
              extraction: null,
              provenance: null,
              approval: null,
            },
          },
          limitations: [
            "Наблюдение относится только к указанной публичной странице и дате.",
            configuredCandidate.adVisibilitySample?.status !== NO_APPROVED_COMPETITOR_AD_SOURCE
              ? "Рекламное наблюдение относится только к точному sample одобренного артефакта и не раскрывает активность вне sample."
              : "Одобренный источник не предоставлен; отсутствие наблюдения не означает отсутствие рекламы.",
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
