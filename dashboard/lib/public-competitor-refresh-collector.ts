import {
  buildCompetitorMatrix,
  type CompetitorAdObservationInput,
  type CompetitorCandidateSet,
  type CompetitorMatrixRowInput,
} from "./competitor-research.ts";
import {
  collectProductionCompetitorResearch,
} from "./production-competitor-research.ts";
import { pipelineDigest } from "./pipeline-orchestrator.ts";
import type { SiteResearchDependencies } from "./site-research.ts";
import type {
  PipelineCompetitorCollection,
  PipelineCompetitorCollectorInput,
} from "./pipeline-competitor-refresh.ts";

type JsonRecord = Record<string, unknown>;

export type PublicCompetitorRefreshDependencies = SiteResearchDependencies & {
  readFinancialCompetitorIntelligence?: (
    input: PipelineCompetitorCollectorInput,
  ) => Promise<JsonRecord | null>;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function matrixRow(value: unknown): CompetitorMatrixRowInput | null {
  const row = record(value);
  if (!Object.keys(row).length) return null;
  const price = record(row.published_price);
  const sample = record(row.ad_visibility_sample);
  const sampleRaw = record(sample.raw);
  const sampleExtraction = record(sample.extraction);
  const sampleProvenance = record(sample.provenance);
  const sampleApproval = record(sample.approval);
  const analysis = record(row.campaign_analysis);
  const source = record(row.source);
  return {
    competitor: text(row.competitor),
    productsServices: list(row.products_services).map(text),
    observedOfferMessage: text(row.observed_offer_message),
    publishedPrice: price.status === "PUBLISHED"
      ? { status: "PUBLISHED", value: text(price.value) }
      : { status: "NOT_PUBLISHED", value: null },
    exactLanding: text(row.exact_landing),
    source: { label: text(source.label), url: text(source.url) },
    geography: text(row.geography),
    device: text(row.device),
    observedAt: text(row.observation_date),
    adVisibilitySample: {
      status: text(sample.status) as CompetitorAdObservationInput["status"],
      sourceClass: sample.source_class === null ? null : text(sample.source_class) as CompetitorAdObservationInput["sourceClass"],
      sourceName: sample.source_name === null ? null : text(sample.source_name),
      query: sample.query === null ? null : text(sample.query),
      geography: text(sample.geography),
      device: text(sample.device),
      observedAt: sample.observation_date === null ? null : text(sample.observation_date),
      limitation: text(sample.limitation),
      raw: sample.raw === null ? null : {
        immutablePointer: text(sampleRaw.immutable_pointer),
        sha256: text(sampleRaw.sha256),
        mediaType: text(sampleRaw.media_type),
        byteLength: Number(sampleRaw.byte_length),
      },
      extraction: sample.extraction === null ? null : {
        method: text(sampleExtraction.method) as "manual_span" | "ocr" | "provider_schema",
        adMarker: sampleExtraction.ad_marker === null ? null : text(sampleExtraction.ad_marker),
        locator: text(sampleExtraction.locator),
      },
      provenance: sample.provenance === null ? null : {
        obtainedBy: text(sampleProvenance.obtained_by) as "owner" | "provider",
        obtainedAt: text(sampleProvenance.obtained_at),
      },
      approval: sample.approval === null ? null : {
        termsUrl: text(sampleApproval.terms_url),
        termsCheckedAt: text(sampleApproval.terms_checked_at),
        termsSha256: text(sampleApproval.terms_sha256),
        acquisitionMethod: text(sampleApproval.acquisition_method),
        downstreamUseApproved: sampleApproval.downstream_use_approved === true,
      } as CompetitorAdObservationInput["approval"],
    },
    campaignAnalysis: Object.keys(analysis).length ? {
      evidenceStatus: text(analysis.evidence_status) as NonNullable<CompetitorMatrixRowInput["campaignAnalysis"]>["evidenceStatus"],
      patternId: text(analysis.pattern_id),
      patternLabel: text(analysis.pattern_label),
      campaignType: text(analysis.campaign_type),
      audienceSignal: text(analysis.audience_signal),
      adMessage: text(analysis.ad_message),
      callToAction: text(analysis.call_to_action),
      strategyFit: text(analysis.strategy_fit),
      weakness: text(analysis.weakness),
      improvementHypothesis: text(analysis.improvement_hypothesis),
      changedFamily: text(analysis.changed_family) as NonNullable<CompetitorMatrixRowInput["campaignAnalysis"]>["changedFamily"],
    } : null,
  };
}

function researchConfiguration(candidateSet: CompetitorCandidateSet, input: PipelineCompetitorCollectorInput) {
  return JSON.stringify({
    rule: candidateSet.competitor_set_rule,
    geography: text(input.model.geography) || "География не подтверждена",
    device: "all",
    candidates: candidateSet.candidates.map((candidate) => ({
      competitor: candidate.competitor,
      rationale: candidate.rationale,
      exactDestinations: candidate.exact_destinations,
    })),
  });
}

function unavailableFinancialEvidence(generatedAt: string): JsonRecord {
  return {
    schema_version: "p0-financial-competitor-intelligence-unavailable-v1",
    capability_status: "UNAVAILABLE",
    observed_at: generatedAt,
    profiles: [],
    accepted_records: [],
    limitations: [
      "Официальный Financial Intelligence read adapter не предоставил проверяемый dossier; финансовые значения не заменены статическим примером или нулями.",
    ],
  };
}

/** Collects only the caller-supplied allowlisted public competitor pages. */
export async function collectPublicCompetitorRefresh(
  input: PipelineCompetitorCollectorInput,
  dependencies: PublicCompetitorRefreshDependencies,
): Promise<PipelineCompetitorCollection | null> {
  if (!input.candidateSet?.candidates.length) return null;
  const [research, financialCompetitorIntelligence] = await Promise.all([
    collectProductionCompetitorResearch(
      researchConfiguration(input.candidateSet, input),
      dependencies,
    ),
    dependencies.readFinancialCompetitorIntelligence?.(structuredClone(input)) ?? null,
  ]);
  const competitorMatrix = buildCompetitorMatrix({
    candidateSet: research.competitor_candidate_set,
    rows: research.competitor_observations
      .map((observation) => matrixRow(record(observation).matrix_row))
      .filter((row): row is CompetitorMatrixRowInput => row !== null),
  });
  return {
    evidencePackId: `public-competitor:${(await pipelineDigest({
      candidate_set: competitorMatrix.candidate_set,
      observed_at: input.generatedAt,
    })).slice(7, 31)}`,
    competitorMatrix: competitorMatrix as unknown as JsonRecord,
    competitorObservations: research.competitor_observations.map((observation) => structuredClone(observation)),
    financialCompetitorIntelligence: financialCompetitorIntelligence
      ? structuredClone(financialCompetitorIntelligence)
      : unavailableFinancialEvidence(input.generatedAt),
  };
}
