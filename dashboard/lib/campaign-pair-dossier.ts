import { buildOwnerPublishPreview } from "./campaign-creation-profile.ts";
import {
  COMPILED_CAMPAIGN_PAIR_SCHEMA,
  CAMPAIGN_HYPOTHESIS_SCHEMA,
  type CampaignDesignPipelineResult,
  type CompiledCampaignPair,
} from "./campaign-design-agent.ts";
import {
  AUTONOMOUS_CAMPAIGN_STRATEGY_SCHEMA,
  type AutonomousCampaignStrategy,
  type CampaignStrategyDimensionId,
} from "./campaign-strategy-agent.ts";
import {
  DIRECT_PROFILE_APPLICABILITY_REGISTRY,
  DIRECT_PROJECTION_COMPILER_VERSION,
} from "./direct-projection-compiler.ts";
import { fingerprintDirectProjection } from "./campaign-fanout.ts";
import {
  compileLocalCampaignGenerationProjection,
  isLocalCampaignGenerationProjection,
  LOCAL_CAMPAIGN_GENERATION_COMPILER,
  LOCAL_CAMPAIGN_GENERATION_PROFILE,
  LOCAL_CAMPAIGN_GENERATION_PROFILE_VERSION,
} from "./campaign-generation-profile.ts";

export const OWNER_CAMPAIGN_PAIR_DOSSIER_SCHEMA = "p0-owner-campaign-pair-dossier-v1";

type ExactDirectField = {
  pointer: string;
  disposition: "Будет передано" | "Доказанное отсутствие" | "Не применяется" | "Локальный черновик";
  value: string;
  provenance: string;
};

export type OwnerCampaignPairDossier = {
  schemaVersion: typeof OWNER_CAMPAIGN_PAIR_DOSSIER_SCHEMA;
  state: "Полная текущая пара";
  title: string;
  profile: string;
  lineage: Array<{
    kind: "Campaign Strategy" | "Campaign Hypothesis" | "Campaign Draft";
    versionLabel: string;
    summary: string;
  }>;
  hypothesis: {
    mechanism: string;
    primaryMetric: string;
    baseline: string;
    evidence: string[];
  };
  clientPreview: {
    titles: string[];
    texts: string[];
    link: string;
    combinations: Array<{ title: string; text: string; link: string }>;
    requiredDisclaimers: string[];
    creativeSource: string;
    creativeRights: string;
  };
  strategyMapping: Array<{
    dimension: "Предложение" | "Аудитория" | "Целевое действие" | "Экономические границы";
    decision: string;
    rationale: string;
    evidence: string[];
    exactDraftFields: Array<{ pointer: string; value: string }>;
  }>;
  directProjection: {
    graph: string[];
    fields: ExactDirectField[];
  };
  safety: string;
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
const SHA256_REFERENCE = /^sha256:[0-9a-f]{64}$/iu;
const SHA256_INLINE = /sha256:[0-9a-f]{64}/giu;
const SENSITIVE_REFERENCE = /oauth|token|secret|password|cookie|authorization|client[-_:]?login|counter[-_:]?id|goal[-_:]?id|provider/iu;

function safeBusinessText(value: unknown) {
  return text(value).replace(SHA256_INLINE, "контентно-адресную evidence revision");
}

function safeEvidenceReference(value: unknown) {
  const reference = text(value);
  if (SHA256_REFERENCE.test(reference)) return "Контентно-адресная редакция evidence";
  if (SENSITIVE_REFERENCE.test(reference)) return "Скрытая чувствительная evidence revision";
  return safeBusinessText(reference);
}

function displayValue(value: unknown) {
  if (typeof value === "string") return text(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  return JSON.stringify(value);
}

function rubles(value: unknown) {
  return `${new Intl.NumberFormat("ru-RU").format(Number(value))} ₽`;
}

function dimension(strategy: AutonomousCampaignStrategy, id: CampaignStrategyDimensionId) {
  return strategy.dimensions.find((item) => item.dimension_id === id) ?? null;
}

function evidenceLabels(value: ReturnType<typeof dimension>) {
  if (!value) return [];
  return value.evidence_refs.map((reference) =>
    [reference.input_kind, reference.revision_id, reference.evidence_id]
      .map(safeEvidenceReference)
      .filter(Boolean)
      .join(" · "),
  );
}

function projectionParts(pair: CompiledCampaignPair) {
  const projection = pair.draft.publish_projection;
  const direct = record(projection.direct);
  const campaign = record(direct.campaign);
  const unified = record(campaign.UnifiedCampaign);
  const bidding = record(unified.BiddingStrategy);
  const search = record(bidding.Search);
  const maximumClicks = record(search.WbMaximumClicks);
  const adGroup = record(direct.ad_group);
  const responsiveAd = record(record(direct.ad).ResponsiveAd);
  return { projection, direct, campaign, unified, bidding, search, maximumClicks, adGroup, responsiveAd };
}

function hasCompleteShape(strategy: AutonomousCampaignStrategy, pair: CompiledCampaignPair) {
  const parts = projectionParts(pair);
  const lineage = record(parts.projection.lineage);
  const explicitDraftRevision = text(record(pair.draft).draft_revision_id);
  const draftRevision = explicitDraftRevision || text(lineage.draft_revision_id);
  const graph = record(pair.draft.local_graph);
  const applicabilityPointers = list(pair.draft.applicability).map(record).map((item) => text(item.pointer)).filter(Boolean).sort();
  const requiredPointers = DIRECT_PROFILE_APPLICABILITY_REGISTRY.fields.map((item) => item.pointer).sort();
  const requiredDimensions: CampaignStrategyDimensionId[] = [
    "advertised_offer", "target_audience", "qualified_result", "weekly_budget", "period",
  ];
  const preview = buildOwnerPublishPreview(parts.projection as unknown as Record<string, unknown>);
  return strategy.schema_version === AUTONOMOUS_CAMPAIGN_STRATEGY_SCHEMA
    && strategy.status === "AGENT_ACCEPTED"
    && pair.schema_version === COMPILED_CAMPAIGN_PAIR_SCHEMA
    && pair.hypothesis.schema_version === CAMPAIGN_HYPOTHESIS_SCHEMA
    && pair.strategy_revision_id === strategy.strategy_revision_id
    && pair.hypothesis.strategy_revision_id === strategy.strategy_revision_id
    && pair.analytics_evidence_snapshot_id === pair.hypothesis.analytics_evidence_snapshot_id
    && lineage.strategy_revision_id === strategy.strategy_revision_id
    && lineage.campaign_hypothesis_revision_id === pair.hypothesis.hypothesis_revision_id
    && Boolean(draftRevision)
    && (!explicitDraftRevision || explicitDraftRevision === lineage.draft_revision_id)
    && pair.draft.schema_version === DIRECT_PROJECTION_COMPILER_VERSION
    && pair.draft.validation.status === "VALID"
    && pair.draft.validation.external_write_sent === false
    && pair.draft.profile_id === "p0-campaign-creation-profile-v1"
    && pair.draft.profile_version === "1.0.0"
    && JSON.stringify(applicabilityPointers) === JSON.stringify(requiredPointers)
    && parts.search.BiddingStrategyType === "WB_MAXIMUM_CLICKS"
    && record(parts.bidding.Network).BiddingStrategyType === "SERVING_OFF"
    && Number(parts.maximumClicks.WeeklySpendLimit) > 0
    && Number(parts.maximumClicks.BidCeiling) > 0
    && list(parts.responsiveAd.Titles).length > 0
    && list(parts.responsiveAd.Texts).length > 0
    && text(parts.responsiveAd.Href).length > 0
    && preview.creativeCombinations.length === preview.titles.length * preview.texts.length
    && preview.creativeCombinations.length > 0
    && Object.keys(record(graph.campaign)).length > 0
    && list(graph.ad_groups).length === 1
    && list(graph.keywords).length === 1
    && list(graph.ads).length === 1
    && list(graph.assets).length === 0
    && requiredDimensions.every((id) => {
      const item = dimension(strategy, id);
      return item && item.value !== null && text(item.rationale) && item.evidence_refs.length > 0;
    })
    && pair.hypothesis.evidence_refs.length > 0
    && pair.economics.budget_limited === true
    && pair.economics.weekly_budget === Number(dimension(strategy, "weekly_budget")?.value)
    && Number(parts.maximumClicks.WeeklySpendLimit) === pair.economics.weekly_budget * 1_000_000
    && pair.economics.effectiveness_forecast === false;
}

function exactField(pointer: string, value: unknown) {
  return { pointer, value: displayValue(value) };
}

function mapping(strategy: AutonomousCampaignStrategy, pair: CompiledCampaignPair): OwnerCampaignPairDossier["strategyMapping"] {
  const { campaign, unified, maximumClicks, adGroup, direct, responsiveAd } = projectionParts(pair);
  const offer = dimension(strategy, "advertised_offer")!;
  const audience = dimension(strategy, "target_audience")!;
  const result = dimension(strategy, "qualified_result")!;
  const budget = dimension(strategy, "weekly_budget")!;
  const period = dimension(strategy, "period")!;
  const targetCost = dimension(strategy, "target_result_cost");
  const periodValue = record(period.value);
  const costText = targetCost?.value === null || targetCost?.value === undefined
    ? "Подтверждённая стоимость результата недоступна; используется только бюджетный предел без прогноза эффективности."
    : `Целевая стоимость результата: ${rubles(targetCost.value)}; прогноз эффективности не строится.`;
  return [{
    dimension: "Предложение",
    decision: safeBusinessText(offer.value),
    rationale: safeBusinessText(offer.rationale),
    evidence: evidenceLabels(offer),
    exactDraftFields: [
      exactField("/direct/ad/ResponsiveAd/Titles", responsiveAd.Titles),
      exactField("/direct/ad/ResponsiveAd/Texts", responsiveAd.Texts),
    ],
  }, {
    dimension: "Аудитория",
    decision: safeBusinessText(audience.value),
    rationale: safeBusinessText(audience.rationale),
    evidence: evidenceLabels(audience),
    exactDraftFields: [
      exactField("/direct/ad_group/RegionIds", adGroup.RegionIds),
      exactField("/direct/ad_group/NegativeKeywords/Items", record(adGroup.NegativeKeywords).Items),
      exactField("/direct/keyword/Keyword", record(direct.keyword).Keyword),
    ],
  }, {
    dimension: "Целевое действие",
    decision: safeBusinessText(result.value),
    rationale: safeBusinessText(result.rationale),
    evidence: evidenceLabels(result),
    exactDraftFields: [
      exactField("/direct/ad/ResponsiveAd/Href", responsiveAd.Href),
      exactField("/direct/campaign/UnifiedCampaign/TrackingParams", unified.TrackingParams),
    ],
  }, {
    dimension: "Экономические границы",
    decision: `${rubles(budget.value)} в неделю · ${text(periodValue.start_date)} — ${text(periodValue.end_date)}. ${costText}`,
    rationale: safeBusinessText(`${budget.rationale} ${period.rationale}`),
    evidence: [...new Set([...evidenceLabels(budget), ...evidenceLabels(period), ...evidenceLabels(targetCost)])],
    exactDraftFields: [
      exactField("/direct/campaign/StartDate", campaign.StartDate),
      exactField("/direct/campaign/EndDate", campaign.EndDate),
      exactField("/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/WbMaximumClicks/WeeklySpendLimit", maximumClicks.WeeklySpendLimit),
      exactField("/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/WbMaximumClicks/BidCeiling", maximumClicks.BidCeiling),
    ],
  }];
}

function directFields(pair: CompiledCampaignPair): ExactDirectField[] {
  return pair.draft.applicability.map((item) => {
    const value = record(item);
    const disposition = value.disposition === "VALUE"
      ? "Будет передано" as const
      : value.disposition === "PROVEN_ABSENCE"
        ? "Доказанное отсутствие" as const
        : "Не применяется" as const;
    return {
      pointer: text(value.pointer),
      disposition,
      value: value.disposition === "VALUE" ? displayValue(value.value) : text(value.reason),
      provenance: safeEvidenceReference(value.provenance_ref ?? value.evidence_ref),
    };
  });
}

async function projectLocalGenerationDossier(
  strategy: AutonomousCampaignStrategy,
  pair: CompiledCampaignPair,
): Promise<OwnerCampaignPairDossier | null> {
  const projection = pair.draft.publish_projection;
  if (!isLocalCampaignGenerationProjection(projection)) return null;
  const lineage = record(projection.lineage);
  const draft = record(pair.draft);
  const readiness = record(draft.publication_readiness);
  if (strategy.status !== "AGENT_ACCEPTED" || strategy.schema_version !== AUTONOMOUS_CAMPAIGN_STRATEGY_SCHEMA
    || pair.schema_version !== COMPILED_CAMPAIGN_PAIR_SCHEMA || pair.hypothesis.schema_version !== CAMPAIGN_HYPOTHESIS_SCHEMA
    || pair.strategy_revision_id !== strategy.strategy_revision_id || pair.hypothesis.strategy_revision_id !== strategy.strategy_revision_id
    || pair.analytics_evidence_snapshot_id !== pair.hypothesis.analytics_evidence_snapshot_id
    || lineage.strategy_revision_id !== strategy.strategy_revision_id || lineage.campaign_hypothesis_revision_id !== pair.hypothesis.hypothesis_revision_id
    || pair.draft.schema_version !== LOCAL_CAMPAIGN_GENERATION_COMPILER || pair.draft.profile_id !== (projection.schema_version === "p0-direct-projection-v6" ? "campaign-formation-local-v1" : LOCAL_CAMPAIGN_GENERATION_PROFILE)
    || pair.draft.profile_version !== LOCAL_CAMPAIGN_GENERATION_PROFILE_VERSION || pair.draft.validation.status !== "VALID"
    || pair.draft.validation.external_write_sent !== false || record(pair.draft.validation).scope !== "LOCAL_CONTENT_REVIEW"
    || readiness.status !== "UNAVAILABLE" || !list(readiness.blockers).some((blocker) => record(blocker).code === "LOCAL_PROFILE_WRITE_UNIMPLEMENTED")
    || !pair.hypothesis.evidence_refs.length || pair.economics.effectiveness_forecast !== false || pair.economics.budget_limited !== true
    || Number(projection.local_review.strategy_weekly_budget_rub) !== Number(dimension(strategy, "weekly_budget")?.value)
    || Number(projection.local_review.allocated_weekly_budget_rub) > Number(pair.economics.weekly_budget)) return null;
  const responsiveAds = projection.direct.ads.map((node) => record(node.provider_fields.ResponsiveAd));
  const allowedHosts = responsiveAds.flatMap((ad) => {
    try { return [new URL(text(ad.Href)).hostname]; } catch { return []; }
  });
  const verified = await compileLocalCampaignGenerationProjection({ projection, capability_snapshot: null, allowed_landing_hosts: allowedHosts });
  if (verified.violations.length || verified.compiled.publish_fingerprint !== pair.draft.publish_fingerprint
    || JSON.stringify(verified.compiled.local_graph) !== JSON.stringify(pair.draft.local_graph)
    || JSON.stringify(verified.compiled.applicability) !== JSON.stringify(pair.draft.applicability)) return null;
  const campaign = projection.direct.campaign;
  const unified = record(campaign.UnifiedCampaign);
  const search = record(record(unified.BiddingStrategy).Search);
  const conversion = search.BiddingStrategyType === "WB_MAXIMUM_CONVERSION_RATE";
  const branch = conversion ? "WbMaximumConversionRate" : "WbMaximumClicks";
  const business = projection.business;
  const offer = dimension(strategy, "advertised_offer");
  const audience = dimension(strategy, "target_audience");
  const outcome = dimension(strategy, "qualified_result");
  const budget = dimension(strategy, "weekly_budget");
  const period = dimension(strategy, "period");
  if ([offer, audience, outcome, budget, period].some((item) => !item || item.value === null || !text(item.rationale) || !item.evidence_refs.length)) return null;
  const combinations = responsiveAds.flatMap((ad) => list(ad.Titles).flatMap((title) => list(ad.Texts).map((body) => ({ title: text(title), text: text(body), link: text(ad.Href) }))));
  const explicit = projection.direct.keywords.filter((node) => node.kind === "EXPLICIT_KEYWORD");
  const automatic = projection.direct.keywords.filter((node) => node.kind === "AUTOTARGETING");
  const fields: ExactDirectField[] = verified.compiled.applicability.map((field) => ({
    pointer: field.pointer,
    disposition: "Локальный черновик",
    value: displayValue(field.value),
    provenance: safeEvidenceReference(field.provenance_ref),
  }));
  return {
    schemaVersion: OWNER_CAMPAIGN_PAIR_DOSSIER_SCHEMA,
    state: "Полная текущая пара",
    title: text(campaign.Name),
    profile: projection.formation ? `Локальный план / ${projection.formation.portfolio.campaigns.find(c => c.id === projection.formation?.campaign_id)?.channel === "SEARCH" ? "Поиск" : "РСЯ"}` : `ЕПК / Поиск / ${conversion ? "Максимум конверсий" : "Максимум кликов"} · локальный профиль генерации`,
    lineage: [{
      kind: "Campaign Strategy", versionLabel: strategy.strategy_revision_id,
      summary: `${safeBusinessText(business.product)} · ${safeBusinessText(business.audience)} · ${safeBusinessText(business.qualified_result)}`,
    }, {
      kind: "Campaign Hypothesis", versionLabel: pair.hypothesis.hypothesis_revision_id, summary: safeBusinessText(pair.hypothesis.mechanism),
    }, {
      kind: "Campaign Draft", versionLabel: text(lineage.draft_revision_id), summary: "Полное содержание подготовлено; публикация нового профиля недоступна.",
    }],
    hypothesis: {
      mechanism: safeBusinessText(pair.hypothesis.mechanism), primaryMetric: safeBusinessText(pair.hypothesis.primary_metric),
      baseline: safeBusinessText(pair.hypothesis.baseline), evidence: pair.hypothesis.evidence_refs.map(safeEvidenceReference),
    },
    clientPreview: {
      titles: [...new Set(combinations.map((item) => item.title))],
      texts: [...new Set(combinations.map((item) => item.text))],
      link: [...new Set(combinations.map((item) => item.link))].join(" · "),
      combinations,
      requiredDisclaimers: ["Оговорки и рекламные обещания требуют проверки перед публикацией."],
      creativeSource: "Содержание агента со ссылками на подтверждающие источники.",
      creativeRights: "Проверка источников и прав перед публикацией",
    },
    strategyMapping: [{
      dimension: "Предложение", decision: safeBusinessText(offer!.value), rationale: safeBusinessText(offer!.rationale), evidence: evidenceLabels(offer),
      exactDraftFields: responsiveAds.flatMap((ad, index) => [exactField(`/direct/ads/${index}/provider_fields/ResponsiveAd/Titles`, ad.Titles), exactField(`/direct/ads/${index}/provider_fields/ResponsiveAd/Texts`, ad.Texts)]),
    }, {
      dimension: "Аудитория", decision: safeBusinessText(audience!.value), rationale: safeBusinessText(audience!.rationale), evidence: evidenceLabels(audience),
      exactDraftFields: [
        ...projection.direct.ad_groups.map((group, index) => exactField(`/direct/ad_groups/${index}/provider_fields`, group.provider_fields)),
        ...projection.direct.keywords.map((keyword, index) => exactField(`/direct/keywords/${index}/provider_fields`, keyword.provider_fields)),
      ],
    }, {
      dimension: "Целевое действие", decision: safeBusinessText(outcome!.value), rationale: safeBusinessText(outcome!.rationale), evidence: evidenceLabels(outcome),
      exactDraftFields: [
        ...responsiveAds.map((ad, index) => exactField(`/direct/ads/${index}/provider_fields/ResponsiveAd/Href`, ad.Href)),
        exactField("/creation_profile/measurement_plan", projection.creation_profile.measurement_plan),
      ],
    }, {
      dimension: "Экономические границы",
      decision: `${rubles(projection.local_review.allocated_weekly_budget_rub)} в неделю на эту кампанию из ${rubles(budget!.value)} по Стратегии. ${text(campaign.StartDate)} — ${text(campaign.EndDate)}.`,
      rationale: safeBusinessText(`${budget!.rationale} ${period!.rationale}`), evidence: [...new Set([...evidenceLabels(budget), ...evidenceLabels(period)])],
      exactDraftFields: [projection.formation ? exactField("/direct/campaign/DeliveryPlan", campaign.DeliveryPlan) : exactField(`/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/${branch}`, search[branch]), exactField("/direct/campaign/StartDate", campaign.StartDate), exactField("/direct/campaign/EndDate", campaign.EndDate)],
    }],
    directProjection: {
      graph: ["1 кампания", `${projection.direct.ad_groups.length} групп объявлений`, `${explicit.length} ключевых фраз`, `${automatic.length} обязательных автотаргетингов`, `${projection.direct.ads.length} адаптивных объявлений`],
      fields,
    },
    safety: `Полный локальный черновик без права публикации, показов или расходов. ${list(readiness.blockers).map((blocker) => text(record(blocker).message)).join(" ")}`,
  };
}

/**
 * Builds the business-first dossier only from a fully compiled pair. Every
 * technical or compilation failure projects to null, so a partial Hypothesis
 * or Draft cannot reach the owner interface.
 */
export async function projectCampaignPairDossier(input: {
  strategy: AutonomousCampaignStrategy;
  result: CampaignDesignPipelineResult;
}): Promise<OwnerCampaignPairDossier | null> {
  if (input.result.status !== "COMPLETED") return null;
  const pair = input.result.pair as CompiledCampaignPair;
  if (isLocalCampaignGenerationProjection(pair.draft.publish_projection)) return projectLocalGenerationDossier(input.strategy, pair);
  if (!hasCompleteShape(input.strategy, pair)) return null;
  if (await fingerprintDirectProjection(pair.draft.publish_projection as unknown as Record<string, unknown>) !== pair.draft.publish_fingerprint) return null;

  const preview = buildOwnerPublishPreview(pair.draft.publish_projection as unknown as Record<string, unknown>);
  const business = record(pair.draft.publish_projection.business);
  const campaign = record(record(pair.draft.publish_projection.direct).campaign);
  const projectionLineage = record(pair.draft.publish_projection.lineage);
  const draftRevision = text(record(pair.draft).draft_revision_id ?? projectionLineage.draft_revision_id);
  const fields = directFields(pair);
  if (!fields.length || fields.some((field) => !field.pointer || !field.value || !field.provenance)) return null;

  return {
    schemaVersion: OWNER_CAMPAIGN_PAIR_DOSSIER_SCHEMA,
    state: "Полная текущая пара",
    title: text(campaign.Name),
    profile: "ЕПК / Поиск / WB_MAXIMUM_CLICKS",
    lineage: [{
      kind: "Campaign Strategy",
      versionLabel: input.strategy.strategy_revision_id,
      summary: `${safeBusinessText(business.product)} · ${safeBusinessText(business.audience)} · ${safeBusinessText(business.qualified_result)}`,
    }, {
      kind: "Campaign Hypothesis",
      versionLabel: pair.hypothesis.hypothesis_revision_id,
      summary: safeBusinessText(pair.hypothesis.mechanism),
    }, {
      kind: "Campaign Draft",
      versionLabel: draftRevision,
      summary: `${pair.draft.profile_id} · ${pair.draft.validation.status}`,
    }],
    hypothesis: {
      mechanism: safeBusinessText(pair.hypothesis.mechanism),
      primaryMetric: safeBusinessText(pair.hypothesis.primary_metric),
      baseline: safeBusinessText(pair.hypothesis.baseline),
      evidence: pair.hypothesis.evidence_refs.map(safeEvidenceReference),
    },
    clientPreview: {
      titles: preview.titles,
      texts: preview.texts,
      link: preview.urls[0].landing,
      combinations: preview.creativeCombinations.map((item) => ({ title: item.title, text: item.text, link: item.landing })),
      requiredDisclaimers: preview.requiredDisclaimers,
      creativeSource: `${preview.creativeProvenance.family} · ${preview.creativeProvenance.source}`,
      creativeRights: preview.creativeProvenance.rights,
    },
    strategyMapping: mapping(input.strategy, pair),
    directProjection: {
      graph: ["1 кампания", "1 группа объявлений", "1 ключевая фраза", "1 адаптивное объявление", "0 дополнительных материалов"],
      fields,
    },
    safety: "Это черновик без права публикации, показов или расхода. Прогноз эффективности не строится.",
  };
}
