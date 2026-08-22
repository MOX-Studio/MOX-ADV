const normalized = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

function joinRoles(roles: string[]) {
  const unique = [...new Set(roles)];
  const joined = unique.length < 2 ? unique[0] ?? "" : `${unique.slice(0, -1).join(", ")} и ${unique.at(-1)}`;
  return joined ? `${joined[0].toUpperCase()}${joined.slice(1)}` : "";
}

export function inferOffer(brand: unknown, evidence: unknown, qualifiedResult: unknown) {
  const name = normalized(brand);
  const context = normalized(`${evidence ?? ""} ${qualifiedResult ?? ""}`).toLowerCase();
  const participation = /участ|participant|exhibitor/u.test(context);
  const exhibition = /выстав|exhibition|expo\b/u.test(context);
  if (!participation || !exhibition) return "";

  const format = /стенд|exhibition stand|booth/u.test(context) ? "Участие со стендом" : "Участие";
  const scope = /международ|international/u.test(context) ? "международной " : "";
  const industry = /промышлен|industrial/u.test(context) ? "промышленной " : "";
  return `${format} в ${scope}${industry}выставке${name ? ` ${name}` : ""}`;
}

export function isUnprocessedOffer(offer: unknown, evidence: unknown, brand: unknown) {
  const value = normalized(offer).toLowerCase();
  const quote = normalized(evidence).toLowerCase();
  const name = normalized(brand).toLowerCase();
  if (!value) return false;
  return value === quote || (Boolean(name) && value === name);
}

export function inferDecisionMakers(evidence: unknown) {
  const text = normalized(evidence).toLowerCase();
  const roles: string[] = [];

  if (/байер|\bbuyer|закуп/u.test(text)) roles.push("байеры и руководители по закупкам");
  if (/производител|manufactur/u.test(text)) roles.push("представители компаний-производителей");
  if (/инвестор|investor/u.test(text)) roles.push("инвесторы");
  if (/предпринимател|entrepreneur|business owner/u.test(text)) roles.push("предприниматели и владельцы бизнеса");
  if (/руководител|директор|executive|decision[- ]maker/u.test(text)) roles.push("руководители компаний");
  if (/орган.{0,12}власт|правительств|government|public authorit/u.test(text)) roles.push("представители органов власти");

  return joinRoles(roles);
}

export function isUnprocessedAudience(audience: unknown, evidence: unknown) {
  const value = normalized(audience);
  const quote = normalized(evidence);
  if (!value) return false;
  return (Boolean(quote) && value === quote) || value.length > 140;
}

export const OFFER_CATALOG_SCHEMA = "p0-offer-catalog-v1";
export const FOCUS_OPPORTUNITY_SCHEMA = "p0-focus-opportunity-set-v1";
export const PRODUCT_FOCUS_STATE_SCHEMA = "p0-product-focus-state-v1";

export type OfferCandidateInput = {
  label?: unknown;
  offer: unknown;
  audience?: unknown;
  value?: unknown;
  qualified_outcome?: unknown;
  economics?: unknown;
  destination?: unknown;
  destination_status?: "AVAILABLE" | "INVALID" | "BLOCKED" | "UNAVAILABLE";
  current_promotion?: "OBSERVED" | "NOT_OBSERVED" | "UNKNOWN";
  unresolved_facts?: unknown[];
  evidence_refs?: Array<{ source_url?: unknown; quote?: unknown; field?: unknown }>;
  demand_cluster_ids?: unknown[];
};

type MaterialAxes = {
  qualified_outcome: string;
  audience: string;
  economics: string;
  destination: string;
  offer: string;
};

type OfferCatalogItem = {
  offer_id: string;
  label: string;
  merged_labels: string[];
  merged_candidate_count: number;
  material_axes: MaterialAxes;
  value_proposition: string;
  current_promotion: "OBSERVED" | "NOT_OBSERVED" | "UNKNOWN";
  destination_status: "AVAILABLE" | "INVALID" | "BLOCKED" | "UNAVAILABLE";
  unresolved_facts: string[];
  evidence_refs: Array<{ source_url: string; quote: string; field: string }>;
  demand_cluster_ids: string[];
};

export type OfferCatalog = {
  schema_version: typeof OFFER_CATALOG_SCHEMA;
  catalog_id: string;
  generated_at: string;
  materiality_dimensions: readonly ["qualified_outcome", "audience", "economics", "destination", "offer"];
  offers: OfferCatalogItem[];
};

type FocusDimension = {
  status: string;
  score: number | null;
  reasons: Array<{ code: string; detail: string }>;
};

export type FocusOpportunityCard = {
  offer_id: string;
  label: string;
  disposition: "LAUNCH_NOW" | "ALTERNATIVE" | "BLOCKED" | "INSUFFICIENT_EVIDENCE";
  market_opportunity: FocusDimension & {
    status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
    observed_lower_bound: number | null;
    demand_cluster_ids: string[];
  };
  launch_readiness: FocusDimension & {
    status: "READY" | "GAPS" | "BLOCKED";
    blockers: string[];
    gaps: string[];
  };
  evidence_coverage: FocusDimension & {
    status: "SUFFICIENT" | "PARTIAL" | "INSUFFICIENT";
    percent: number;
    covered_dimensions: string[];
    missing_dimensions: string[];
  };
  reasons: Array<{ code: string; detail: string }>;
};

export type FocusOpportunitySet = {
  schema_version: typeof FOCUS_OPPORTUNITY_SCHEMA;
  recommendation_id: string;
  catalog_id: string;
  generated_at: string;
  recommendation_status: "LAUNCH_NOW_RECOMMENDED" | "HUMAN_DECISION_REQUIRED" | "INSUFFICIENT_EVIDENCE";
  recommended_offer_id: string | null;
  cards: FocusOpportunityCard[];
  nearest_alternative_offer_ids: string[];
  blocked_or_insufficient_offer_ids: string[];
  prepared_human_decision_gate: null | {
    schema_version: "p0-focus-human-decision-gate-v1";
    reason_code: "MATERIAL_TIE" | "UNSTABLE_RECOMMENDATION";
    question: string;
    recommendation: string;
    confidence: "LOW" | "MEDIUM";
    options: Array<{ offer_id: string; label: string; disposition: FocusOpportunityCard["disposition"] }>;
    evidence: string[];
    consequences: string[];
  };
};

export type ProductFocusArtifacts = {
  catalog: OfferCatalog;
  focus_opportunities: FocusOpportunitySet;
};

export type ProductFocusState = ProductFocusArtifacts & {
  schema_version: typeof PRODUCT_FOCUS_STATE_SCHEMA;
  focus_revision_id: string;
  analytics_evidence_snapshot_id: string;
  selected_offer_id: string | null;
  recommended_offer_id: string | null;
  selection_source: "AGENT_RECOMMENDATION" | "OWNER_CONFIRMED" | "OWNER_EDITED";
  decision_status: "RECOMMENDED" | "HUMAN_DECISION_REQUIRED" | "OWNER_SELECTED" | "INSUFFICIENT_EVIDENCE";
  selected_at: string;
  previous_focus_revision_id: string | null;
};

function normalizedMaterial(value: unknown) {
  return normalized(value)
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function canonicalDestination(value: unknown) {
  const raw = normalized(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|yclid|gclid|fbclid|_openstat)$/iu.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
    return url.toString();
  } catch {
    return "";
  }
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => compareText(left, right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return "null";
  return JSON.stringify(value) ?? "null";
}

async function contentHash(value: unknown) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalize(value)));
  return `sha256:${[...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map(normalized).filter(Boolean) : [];
}

function evidenceReferences(value: OfferCandidateInput["evidence_refs"]) {
  const unique = new Map<string, { source_url: string; quote: string; field: string }>();
  for (const item of value ?? []) {
    const sourceUrl = canonicalDestination(item.source_url);
    const quote = normalized(item.quote).slice(0, 1_000);
    const field = normalized(item.field).slice(0, 100) || "offer";
    if (!sourceUrl || !quote) continue;
    unique.set(`${sourceUrl}\u0000${quote}\u0000${field}`, { source_url: sourceUrl, quote, field });
  }
  return [...unique.values()].sort((left, right) => compareText(
    `${left.source_url}:${left.field}:${left.quote}`,
    `${right.source_url}:${right.field}:${right.quote}`,
  ));
}

function materialOffer(value: unknown) {
  const source = normalized(value);
  const nonMaterialSkuTokens = new Set([
    "xs", "s", "m", "l", "xl", "xxl",
    "белый", "белая", "белое", "черный", "черная", "черное", "чёрный", "чёрная", "чёрное",
    "красный", "красная", "красное", "синий", "синяя", "синее", "зеленый", "зеленая", "зелёный", "зелёная",
  ]);
  const kept = source.split(/\s+/u).filter((token) => {
    const normalizedToken = normalizedMaterial(token);
    return normalizedToken
      && !nonMaterialSkuTokens.has(normalizedToken)
      && !/^(?:sku|арт(?:икул)?|модель)$/iu.test(normalizedToken)
      && !/^(?:v\d+|(?=[\p{L}\d-]*\d)(?=[\p{L}\d-]*\p{L})[\p{L}\d-]+|\d+(?:[.,]\d+)?(?:мм|см|мл|л|г|кг))$/iu.test(normalizedToken);
  });
  return kept.join(" ") || source;
}

function candidateAxes(candidate: OfferCandidateInput): MaterialAxes {
  return {
    qualified_outcome: normalized(candidate.qualified_outcome),
    audience: normalized(candidate.audience),
    economics: normalized(candidate.economics),
    destination: canonicalDestination(candidate.destination),
    offer: materialOffer(candidate.offer),
  };
}

function materialKey(axes: MaterialAxes) {
  return canonicalize(Object.fromEntries(Object.entries(axes).map(([key, value]) => [key, normalizedMaterial(value)])));
}

function tokens(value: unknown) {
  return new Set(normalizedMaterial(value).split(" ").filter((item) => item.length >= 4));
}

function tokenOverlap(left: unknown, right: unknown) {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  let count = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) count += 1;
  return count;
}

function marketClusterRows(marketEvidence: unknown) {
  const root = marketEvidence && typeof marketEvidence === "object" ? marketEvidence as Record<string, unknown> : {};
  const frequency = root.frequency && typeof root.frequency === "object" ? root.frequency as Record<string, unknown> : {};
  const rows = Array.isArray(frequency.clusters) ? frequency.clusters : [];
  return {
    status: String(frequency.status ?? "UNAVAILABLE"),
    clusters: rows.map((item) => item && typeof item === "object" ? item as Record<string, unknown> : {}),
  };
}

function matchingMarketClusters(offer: OfferCatalogItem, marketEvidence: unknown) {
  const frequency = marketClusterRows(marketEvidence);
  const explicit = new Set(offer.demand_cluster_ids);
  const searchable = `${offer.material_axes.offer} ${offer.material_axes.audience} ${offer.value_proposition}`;
  const matches = frequency.clusters
    .map((cluster) => {
      const clusterId = normalized(cluster.cluster_id);
      const semantic = cluster.semantic_key && typeof cluster.semantic_key === "object"
        ? Object.values(cluster.semantic_key as Record<string, unknown>).map(normalized).join(" ")
        : "";
      const observed = cluster.observed_unique_count && typeof cluster.observed_unique_count === "object"
        ? Number((cluster.observed_unique_count as Record<string, unknown>).value)
        : Number.NaN;
      return {
        cluster_id: clusterId,
        status: String(cluster.status ?? frequency.status),
        observed: Number.isFinite(observed) && observed >= 0 ? observed : null,
        match: explicit.has(clusterId) ? 10_000 : tokenOverlap(searchable, semantic),
      };
    })
    .filter((cluster) => cluster.match > 0)
    .sort((left, right) => right.match - left.match || compareText(left.cluster_id, right.cluster_id));
  const strongestMatch = matches[0]?.match ?? 0;
  return matches.filter((cluster) => cluster.match === strongestMatch);
}

function coverageDimensionLabel(value: string) {
  return {
    offer: "предложение",
    audience: "аудитория",
    qualified_outcome: "квалифицированный результат",
    economics: "экономика",
    destination: "посадочная страница",
    current_promotion: "текущее продвижение",
    market_demand: "рыночный спрос",
  }[value] || value;
}

function offerEvidenceCoverage(offer: OfferCatalogItem, hasMarketEvidence: boolean) {
  const values: Record<string, boolean> = {
    offer: Boolean(offer.material_axes.offer),
    audience: Boolean(offer.material_axes.audience),
    qualified_outcome: Boolean(offer.material_axes.qualified_outcome),
    economics: Boolean(offer.material_axes.economics),
    destination: Boolean(offer.material_axes.destination),
    current_promotion: offer.current_promotion !== "UNKNOWN",
    market_demand: hasMarketEvidence,
  };
  const covered = Object.entries(values).filter(([, available]) => available).map(([dimension]) => dimension);
  const missing = Object.entries(values).filter(([, available]) => !available).map(([dimension]) => dimension);
  const percent = Math.round((covered.length / Object.keys(values).length) * 100);
  const status = percent >= 70 ? "SUFFICIENT" : percent >= 45 ? "PARTIAL" : "INSUFFICIENT";
  return { covered, missing, percent, status } as const;
}

function readiness(offer: OfferCatalogItem) {
  const blockers: string[] = [];
  const gaps: string[] = [];
  if (!offer.material_axes.offer) blockers.push("Предложение не подтверждено.");
  if (!offer.material_axes.qualified_outcome) blockers.push("Квалифицированный результат не подтверждён.");
  if (!offer.material_axes.destination || offer.destination_status !== "AVAILABLE") blockers.push("Допустимая точная посадочная страница не подтверждена.");
  if (!offer.material_axes.audience) gaps.push("Аудитория не подтверждена.");
  if (!offer.material_axes.economics) gaps.push("Экономика предложения не подтверждена.");
  gaps.push(...offer.unresolved_facts);
  const uniqueBlockers = [...new Set(blockers)];
  const uniqueGaps = [...new Set(gaps)];
  const score = Math.max(0, 100 - uniqueBlockers.length * 30 - uniqueGaps.length * 10);
  return {
    status: uniqueBlockers.length ? "BLOCKED" as const : uniqueGaps.length ? "GAPS" as const : "READY" as const,
    score,
    blockers: uniqueBlockers,
    gaps: uniqueGaps,
  };
}

function cardRank(card: FocusOpportunityCard) {
  return [
    card.launch_readiness.status === "READY" ? 2 : card.launch_readiness.status === "GAPS" ? 1 : 0,
    card.market_opportunity.status === "AVAILABLE" ? 2 : card.market_opportunity.status === "PARTIAL" ? 1 : 0,
    card.market_opportunity.score ?? -1,
    card.evidence_coverage.percent,
  ];
}

function compareCards(left: FocusOpportunityCard, right: FocusOpportunityCard) {
  const leftRank = cardRank(left);
  const rightRank = cardRank(right);
  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] !== rightRank[index]) return rightRank[index] - leftRank[index];
  }
  return compareText(left.offer_id, right.offer_id);
}

function materiallyTied(left: FocusOpportunityCard, right: FocusOpportunityCard) {
  if (left.launch_readiness.status !== right.launch_readiness.status) return false;
  if (left.market_opportunity.status !== right.market_opportunity.status) return false;
  const leftMarket = left.market_opportunity.score;
  const rightMarket = right.market_opportunity.score;
  const marketClose = leftMarket === null && rightMarket === null
    ? true
    : leftMarket !== null && rightMarket !== null && Math.abs(leftMarket - rightMarket) <= 5;
  return marketClose && Math.abs(left.evidence_coverage.percent - right.evidence_coverage.percent) <= 10;
}

export async function buildProductFocusArtifacts({
  candidates,
  marketEvidence,
  generatedAt,
}: {
  candidates: OfferCandidateInput[];
  marketEvidence?: unknown;
  generatedAt: string;
}): Promise<ProductFocusArtifacts> {
  const groups = new Map<string, OfferCandidateInput[]>();
  for (const candidate of candidates) {
    const axes = candidateAxes(candidate);
    if (!axes.offer && !axes.destination) continue;
    const key = materialKey(axes);
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  const offers: OfferCatalogItem[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const axes = candidateAxes(first);
    const axisIdentity = Object.fromEntries(Object.entries(axes).map(([key, value]) => [key, normalizedMaterial(value)]));
    const offerId = `offer:${(await contentHash(axisIdentity)).slice("sha256:".length)}`;
    const labels = [...new Set(group.map((item) => normalized(item.label) || normalized(item.offer)).filter(Boolean))].sort(compareText);
    const values = [...new Set(group.map((item) => normalized(item.value)).filter(Boolean))].sort(compareText);
    const promotionValues = group.map((item) => item.current_promotion ?? "UNKNOWN");
    const destinationStatuses = group.map((item) => item.destination_status ?? (axes.destination ? "AVAILABLE" : "UNAVAILABLE"));
    offers.push({
      offer_id: offerId,
      label: labels[0] || axes.offer || "Предложение без названия",
      merged_labels: labels,
      merged_candidate_count: group.length,
      material_axes: axes,
      value_proposition: values[0] ?? "",
      current_promotion: promotionValues.includes("OBSERVED") ? "OBSERVED" : promotionValues.every((item) => item === "NOT_OBSERVED") ? "NOT_OBSERVED" : "UNKNOWN",
      destination_status: destinationStatuses.includes("BLOCKED") ? "BLOCKED" : destinationStatuses.includes("INVALID") ? "INVALID" : destinationStatuses.every((item) => item === "AVAILABLE") ? "AVAILABLE" : "UNAVAILABLE",
      unresolved_facts: [...new Set(group.flatMap((item) => stringList(item.unresolved_facts)))].sort(compareText),
      evidence_refs: evidenceReferences(group.flatMap((item) => item.evidence_refs ?? [])),
      demand_cluster_ids: [...new Set(group.flatMap((item) => stringList(item.demand_cluster_ids)))].sort(compareText),
    });
  }
  offers.sort((left, right) => compareText(left.offer_id, right.offer_id));
  const catalogUnsigned = {
    schema_version: OFFER_CATALOG_SCHEMA as typeof OFFER_CATALOG_SCHEMA,
    generated_at: generatedAt,
    materiality_dimensions: ["qualified_outcome", "audience", "economics", "destination", "offer"] as const,
    offers,
  };
  const catalog: OfferCatalog = { ...catalogUnsigned, catalog_id: await contentHash(catalogUnsigned) };

  const clusterMatches = new Map<string, ReturnType<typeof matchingMarketClusters>>();
  for (const offer of offers) clusterMatches.set(offer.offer_id, matchingMarketClusters(offer, marketEvidence));
  const observedValues = [...clusterMatches.values()].flat().map((item) => item.observed).filter((value): value is number => value !== null);
  const maximumObserved = observedValues.length ? Math.max(...observedValues) : null;
  const cards = offers.map((offer): FocusOpportunityCard => {
    const matches = clusterMatches.get(offer.offer_id) ?? [];
    const observed = matches.length && matches.every((item) => item.observed !== null)
      ? matches.reduce((sum, item) => sum + Number(item.observed), 0)
      : null;
    const marketStatus = observed !== null
      ? matches.every((item) => item.status === "AVAILABLE") ? "AVAILABLE" as const : "PARTIAL" as const
      : "UNAVAILABLE" as const;
    const marketScore = observed !== null && maximumObserved !== null && maximumObserved > 0
      ? Math.round((observed / maximumObserved) * 100)
      : observed === 0 && maximumObserved === 0 ? 100 : null;
    const launch = readiness(offer);
    const coverage = offerEvidenceCoverage(offer, observed !== null);
    const reasons: Array<{ code: string; detail: string }> = [];
    if (marketStatus === "UNAVAILABLE") reasons.push({ code: "MARKET_OPPORTUNITY_UNAVAILABLE", detail: "Данные о спросе в сопоставимом охвате недоступны; это не означает нулевой спрос." });
    for (const blocker of launch.blockers) reasons.push({ code: "LAUNCH_READINESS_BLOCKED", detail: blocker });
    for (const gap of launch.gaps) reasons.push({ code: "LAUNCH_READINESS_GAP", detail: gap });
    for (const dimension of coverage.missing) reasons.push({ code: "EVIDENCE_COVERAGE_GAP", detail: `Не подтверждено: ${coverageDimensionLabel(dimension)}.` });
    const disposition = launch.status === "BLOCKED"
      ? "BLOCKED" as const
      : marketStatus === "UNAVAILABLE" || coverage.status === "INSUFFICIENT"
        ? "INSUFFICIENT_EVIDENCE" as const
        : "ALTERNATIVE" as const;
    return {
      offer_id: offer.offer_id,
      label: offer.label,
      disposition,
      market_opportunity: {
        status: marketStatus,
        score: marketScore,
        observed_lower_bound: observed,
        demand_cluster_ids: matches.map((item) => item.cluster_id),
        reasons: marketStatus === "UNAVAILABLE"
          ? [{ code: "MARKET_OPPORTUNITY_UNAVAILABLE", detail: "Нет официального наблюдения спроса в сопоставимом охвате." }]
          : [{ code: "WORDSTAT_LOWER_BOUND", detail: "Рыночная возможность использует наблюдаемую нижнюю границу запросов, а не прогноз." }],
      },
      launch_readiness: {
        status: launch.status,
        score: launch.score,
        blockers: launch.blockers,
        gaps: launch.gaps,
        reasons: [
          ...launch.blockers.map((detail) => ({ code: "BLOCKER", detail })),
          ...launch.gaps.map((detail) => ({ code: "GAP", detail })),
        ],
      },
      evidence_coverage: {
        status: coverage.status,
        score: coverage.percent,
        percent: coverage.percent,
        covered_dimensions: coverage.covered,
        missing_dimensions: coverage.missing,
        reasons: coverage.missing.map((dimension) => ({ code: "MISSING_DIMENSION", detail: `Не подтверждено: ${coverageDimensionLabel(dimension)}.` })),
      },
      reasons,
    };
  }).sort(compareCards);

  const viable = cards.filter((card) => card.launch_readiness.status !== "BLOCKED");
  const leading = viable[0] ?? null;
  const tied = leading ? viable.filter((card) => materiallyTied(leading, card)) : [];
  const materialTie = tied.length > 1;
  const unstable = Boolean(leading && (
    leading.market_opportunity.status !== "AVAILABLE"
    || leading.launch_readiness.status !== "READY"
    || leading.evidence_coverage.status !== "SUFFICIENT"
  ));
  const recommendedOfferId = materialTie ? null : leading?.offer_id ?? null;
  if (recommendedOfferId && !unstable) {
    const selected = cards.find((card) => card.offer_id === recommendedOfferId);
    if (selected) selected.disposition = "LAUNCH_NOW";
  }
  const gateReason = materialTie ? "MATERIAL_TIE" as const : unstable || !leading ? "UNSTABLE_RECOMMENDATION" as const : null;
  const options = (materialTie ? tied : leading ? [leading, ...viable.filter((card) => card.offer_id !== leading.offer_id).slice(0, 2)] : cards.slice(0, 3));
  const gate = gateReason ? {
    schema_version: "p0-focus-human-decision-gate-v1" as const,
    reason_code: gateReason,
    question: materialTie
      ? "Какое существенно отличающееся предложение выбрать начальным рекламным фокусом?"
      : "Подтвердить предложенный фокус или выбрать альтернативу после раскрытия пробелов?",
    recommendation: leading
      ? `${leading.label}; подтвердите этот вариант только с учётом раскрытых пробелов.`
      : "Не запускать произвольный фокус до устранения блокирующих пробелов.",
    confidence: materialTie || leading?.market_opportunity.status === "UNAVAILABLE" ? "LOW" as const : "MEDIUM" as const,
    options: options.map((card) => ({ offer_id: card.offer_id, label: card.label, disposition: card.disposition })),
    evidence: options.flatMap((card) => [
      `${card.label}: рыночная возможность — ${card.market_opportunity.status === "AVAILABLE" ? "данные доступны" : card.market_opportunity.status === "PARTIAL" ? "частичные данные" : "данные недоступны"}.`,
      `${card.label}: готовность к запуску — ${card.launch_readiness.status === "READY" ? "готово" : card.launch_readiness.status === "GAPS" ? "есть пробелы" : "заблокировано"}.`,
      `${card.label}: покрытие доказательств — ${card.evidence_coverage.percent}%.`,
    ]),
    consequences: [
      "Выбранный фокус определяет следующую стратегию кампании и все зависимые варианты рекламы.",
      "Изменение фокуса создаст новую редакцию и отменит зависимые результаты до пересчёта.",
    ],
  } : null;
  const nearestAlternativeIds = materialTie
    ? tied.map((card) => card.offer_id)
    : viable.filter((card) => card.offer_id !== recommendedOfferId).slice(0, 3).map((card) => card.offer_id);
  const blockedOrInsufficient = cards
    .filter((card) => ["BLOCKED", "INSUFFICIENT_EVIDENCE"].includes(card.disposition))
    .map((card) => card.offer_id);
  const recommendationStatus = gate
    ? "HUMAN_DECISION_REQUIRED" as const
    : recommendedOfferId ? "LAUNCH_NOW_RECOMMENDED" as const : "INSUFFICIENT_EVIDENCE" as const;
  const recommendationUnsigned = {
    schema_version: FOCUS_OPPORTUNITY_SCHEMA as typeof FOCUS_OPPORTUNITY_SCHEMA,
    catalog_id: catalog.catalog_id,
    generated_at: generatedAt,
    recommendation_status: recommendationStatus,
    recommended_offer_id: recommendedOfferId,
    cards,
    nearest_alternative_offer_ids: nearestAlternativeIds,
    blocked_or_insufficient_offer_ids: blockedOrInsufficient,
    prepared_human_decision_gate: gate,
  };
  const focusOpportunities: FocusOpportunitySet = {
    ...recommendationUnsigned,
    recommendation_id: await contentHash(recommendationUnsigned),
  };
  return { catalog, focus_opportunities: focusOpportunities };
}

async function focusStateHashBody(state: Omit<ProductFocusState, "focus_revision_id">) {
  return contentHash(state);
}

export async function createProductFocusState({
  artifacts,
  analyticsEvidenceSnapshotId,
  selectedAt,
  ownerConfirmed = false,
}: {
  artifacts: ProductFocusArtifacts;
  analyticsEvidenceSnapshotId: string;
  selectedAt: string;
  ownerConfirmed?: boolean;
}): Promise<ProductFocusState> {
  const selectedOfferId = artifacts.focus_opportunities.recommended_offer_id;
  const ownerSelected = ownerConfirmed && Boolean(selectedOfferId);
  const decisionStatus = ownerSelected
    ? "OWNER_SELECTED" as const
    : artifacts.focus_opportunities.prepared_human_decision_gate
      ? "HUMAN_DECISION_REQUIRED" as const
      : selectedOfferId ? "RECOMMENDED" as const : "INSUFFICIENT_EVIDENCE" as const;
  const body: Omit<ProductFocusState, "focus_revision_id"> = {
    schema_version: PRODUCT_FOCUS_STATE_SCHEMA,
    ...artifacts,
    analytics_evidence_snapshot_id: analyticsEvidenceSnapshotId,
    selected_offer_id: selectedOfferId,
    recommended_offer_id: artifacts.focus_opportunities.recommended_offer_id,
    selection_source: ownerSelected ? "OWNER_CONFIRMED" : "AGENT_RECOMMENDATION",
    decision_status: decisionStatus,
    selected_at: selectedAt,
    previous_focus_revision_id: null,
  };
  return { ...body, focus_revision_id: await focusStateHashBody(body) };
}

export async function reviseProductFocusState({
  previous,
  artifacts,
  analyticsEvidenceSnapshotId,
  selectedOfferId,
  selectedAt,
  ownerEdited = false,
}: {
  previous: ProductFocusState;
  artifacts: ProductFocusArtifacts;
  analyticsEvidenceSnapshotId: string;
  selectedOfferId: string;
  selectedAt: string;
  ownerEdited?: boolean;
}): Promise<ProductFocusState> {
  if (!artifacts.catalog.offers.some((offer) => offer.offer_id === selectedOfferId)) {
    throw new Error("Selected focus is not part of the current materially distinct offer catalog.");
  }
  const selectedCard = artifacts.focus_opportunities.cards.find((card) => card.offer_id === selectedOfferId);
  if (!selectedCard || selectedCard.launch_readiness.status === "BLOCKED") {
    throw new Error("A launch-blocked focus cannot become the owner-selected Product Focus revision.");
  }
  const body: Omit<ProductFocusState, "focus_revision_id"> = {
    schema_version: PRODUCT_FOCUS_STATE_SCHEMA,
    ...artifacts,
    analytics_evidence_snapshot_id: analyticsEvidenceSnapshotId,
    selected_offer_id: selectedOfferId,
    recommended_offer_id: artifacts.focus_opportunities.recommended_offer_id,
    selection_source: ownerEdited || selectedOfferId !== artifacts.focus_opportunities.recommended_offer_id ? "OWNER_EDITED" : "OWNER_CONFIRMED",
    decision_status: "OWNER_SELECTED",
    selected_at: selectedAt,
    previous_focus_revision_id: previous.focus_revision_id,
  };
  return { ...body, focus_revision_id: await focusStateHashBody(body) };
}

async function verifyProductFocusArtifacts(artifacts: ProductFocusArtifacts) {
  const { catalog_id: catalogId, ...catalogBody } = artifacts.catalog;
  if (catalogId !== await contentHash(catalogBody)) return false;
  const { recommendation_id: recommendationId, ...recommendationBody } = artifacts.focus_opportunities;
  return recommendationId === await contentHash(recommendationBody)
    && artifacts.focus_opportunities.catalog_id === catalogId
    && artifacts.focus_opportunities.cards.every((card) => artifacts.catalog.offers.some((offer) => offer.offer_id === card.offer_id));
}

export async function verifyProductFocusState(state: ProductFocusState | unknown) {
  try {
    if (!state || typeof state !== "object" || Array.isArray(state)) return false;
    const value = state as ProductFocusState;
    if (value.schema_version !== PRODUCT_FOCUS_STATE_SCHEMA) return false;
    if (!await verifyProductFocusArtifacts(value)) return false;
    if (value.selected_offer_id && !value.catalog.offers.some((offer) => offer.offer_id === value.selected_offer_id)) return false;
    const { focus_revision_id: focusRevisionId, ...body } = value;
    return focusRevisionId === await focusStateHashBody(body);
  } catch {
    return false;
  }
}
