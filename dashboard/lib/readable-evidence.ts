import { redactSensitiveEvidenceText } from "./analytics-evidence.ts";
import { businessText, businessSourceUrl } from "./owner-business-copy.ts";

export type ReadableEvidenceFact = {
  id: string;
  aliases: string[];
  kind?: "FACT" | "MATERIAL" | "SOURCE" | "SNAPSHOT" | "GAP" | "UNRESOLVED";
  label: string;
  value: string;
  basis: "OBSERVATION" | "INFERENCE" | "OWNER" | "UNKNOWN";
  sources: Array<{ title: string; url: string | null; observedAt: string | null; excerpt?: string; excerptStatus?: "SAVED" | "MISSING" | "PARTIAL"; scope?: string[] }>;
  limitations: string[];
};

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(row) : [];
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const text = (value: unknown) => typeof value === "string" ? redactSensitiveEvidenceText(value).trim() : "";
const narrative = (value: unknown) => businessText(text(value));
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const fieldLabels: Record<string, string> = {
  company: "Компания", brand: "Бренд", advertised_offer: "Предложение", offer: "Предложение", material_offer: "Предложение", product: "Продукт",
  target_audience: "Покупатели", audience: "Покупатели", qualified_action: "Квалифицированное обращение", qualified_result: "Квалифицированное обращение", qualified_outcome: "Квалифицированный результат",
  geography: "География", customer_geography: "География", desired_outcome: "Цель владельца", business_goal: "Цель владельца", target_count: "Количество результатов", deadline: "Срок",
  total_budget_rub: "Общий бюджет", weekly_budget: "Бюджет в неделю", target_result_cost: "Предел цены результата", average_sale_value_rub: "Средняя ценность продажи", gross_margin_percent: "Валовая маржа", lead_to_sale_percent: "Конверсия в продажу",
  core_message: "Сообщение рекламы", message: "Сообщение рекламы", exclusions: "Исключения", campaign_focus: "Выбранный подход", landing_page: "Посадочная страница", period: "Период", capacity: "Мощность продаж",
  scoped_wordstat_frequency: "Поисковой спрос", observed_performance: "Исторические наблюдения", exact_goal_binding: "Связь с целью", qualified_cost_range: "Диапазон стоимости",
};

function publicUrl(value: unknown) {
  return typeof value === "string" ? businessSourceUrl(value) : null;
}

const observedDate = (value: unknown): string | null => typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T|$)/u.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
const missingExcerpt = (limitations: string[]) => limitations.some(value => /no recoverable first-party evidence span|подтверждающий фрагмент[^.]*не сохранил|фрагмент[^.]*не сохран/iu.test(value));

function sourceScope(value: unknown): string[] {
  const scope = row(value);
  const fields: Record<string, string> = { region_names: "Регион", declared_window: "Период", window: "Период", date_from: "С", date_to: "По" };
  const devices: Record<string, string> = { all: "Все устройства", desktop: "Компьютеры", mobile: "Мобильные устройства", phone: "Телефоны", tablet: "Планшеты" };
  const device = devices[text(scope.device).toLocaleLowerCase("en")];
  return unique([...Object.entries(fields).flatMap(([key, label]) => {
    const value = businessText(display(scope[key]));
    return value ? [`${label}: ${value}`] : [];
  }), ...(device ? [device] : []), ...(!strings(scope.region_names).length && Array.isArray(scope.region_ids) && scope.region_ids.length ? ["Название региона не указано."] : [])]);
}

function display(value: unknown): string {
  if (typeof value === "string") return text(value);
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("ru-RU") : "";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (Array.isArray(value)) return unique(value.filter(item => ["string", "number", "boolean"].includes(typeof item)).map(display)).join(" · ");
  const data = row(value);
  if (typeof data.phrase === "string" || typeof data.query === "string") {
    const phrase = text(data.phrase ?? data.query);
    const count = typeof data.count === "number" && Number.isFinite(data.count) ? `${display(data.count)} запросов` : "Частота не установлена";
    return `${phrase} · ${count}`;
  }
  if (typeof data.start_date === "string" && typeof data.end_date === "string") return `${text(data.start_date)} — ${text(data.end_date)}`;
  for (const key of ["text", "statement", "description", "value", "offer", "advertised_offer", "summary"]) {
    if (["string", "number", "boolean"].includes(typeof data[key])) return display(data[key]);
  }
  return "";
}

/** Exact reference collection only; never serializes arbitrary nested source data. */
export function collectReadableEvidenceRefs(value: unknown): string[] {
  const refs = new Set<string>();
  const visit = (item: unknown) => {
    if (Array.isArray(item)) { item.forEach(visit); return; }
    for (const [key, child] of Object.entries(row(item))) {
      if (["evidence_refs", "source_refs", "evidence_ids"].includes(key)) {
        strings(child).forEach(ref => refs.add(ref));
        if (key === "evidence_refs") rows(child).forEach(reference => { if (typeof reference.evidence_id === "string") refs.add(reference.evidence_id); });
      }
      else if (["observation_ref", "source_ref"].includes(key) && typeof child === "string") refs.add(child);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(value);
  return [...refs];
}

/** Read-only, allowlisted presentation of the exact frozen sources used by the saved result. */
export function buildReadableEvidence(snapshot: unknown, options: { references: string[]; catalog?: unknown; strategy?: unknown }): ReadableEvidenceFact[] {
  const data = row(snapshot);
  const sources = [...rows(data.sources), ...rows(data.source_manifests)];
  const records = [...rows(data.evidence), ...rows(data.evidence_records)];
  const claims = rows(data.claims);
  const sourceById = new Map(sources.map(source => [String(source.source_id ?? source.manifest_id ?? source.source_manifest_id ?? source.id ?? ""), source]));
  const recordById = new Map(records.map(record => [String(record.evidence_id ?? record.record_id ?? ""), record]));
  const claimById = new Map(claims.map(claim => [String(claim.claim_id ?? claim.evidence_id ?? ""), claim]));
  const catalog = new Map(rows(row(options.catalog).sources).map(source => [String(source.source_ref ?? ""), source]));
  const dimensions = new Map(rows(row(options.strategy).dimensions).map(dimension => [String(dimension.dimension_id ?? dimension.id ?? ""), dimension]));
  const materials = new Map(rows(row(data.business_research).supporting_materials).map(material => [String(material.id ?? ""), material]));
  const gaps = new Map(rows(data.gaps).map(gap => [String(gap.gap_id ?? ""), gap]));
  const frequency = row(row(data.market_evidence).frequency);
  const wordstatRows = rows(frequency.canonical_observations);
  const wordstatIds = new Set(wordstatRows.map(observation => String(observation.observation_id ?? "")));
  const observations = new Map([
    ...wordstatRows,
    ...rows(row(data.first_party_history).query_observations),
  ].map(observation => [String(observation.observation_id ?? ""), observation]));

  const recordLinks = (linked: Row[]): ReadableEvidenceFact["sources"] => {
    const links = linked.map(record => {
      const source = sourceById.get(String(record.source_id ?? record.source_manifest_id ?? "")) ?? {};
      const locator = row(record.source_locator);
      const serviceLabels: Record<string, string> = { DIRECT_OFFICIAL_API: "Яндекс Директ", METRIKA_OFFICIAL_API: "Яндекс Метрика", WORDSTAT_OFFICIAL_API: "Яндекс Wordstat", WORDSTAT_OFFICIAL_UI: "Яндекс Wordstat" };
      const excerpt = text(row(record.raw).quote);
      const excerptStatus = missingExcerpt([...strings(record.limitations), ...strings(source.limitations)]) ? "MISSING" as const
        : row(row(record.raw).bounded).truncated === true ? "PARTIAL" as const : excerpt ? "SAVED" as const : undefined;
      return {
        title: serviceLabels[String(source.provenance_class)] || narrative(source.title) || "Источник информации",
        url: publicUrl(locator.url ?? locator.document_url),
        observedAt: observedDate(record.observed_at) ?? observedDate(source.observed_at),
        ...(excerpt ? { excerpt } : {}),
        ...(excerptStatus ? { excerptStatus } : {}),
        scope: sourceScope({ ...row(source.scope), ...row(record.scope) }),
      };
    });
    return [...new Map(links.map(link => [JSON.stringify(link), link])).values()];
  };
  const linkedRecords = (refs: string[]): Row[] => {
    const found = new Map<string, Row>();
    for (const ref of refs) {
      const exact = recordById.get(ref) ?? (ref.endsWith(":quote") ? recordById.get(ref.slice(0, -6)) : undefined);
      if (exact) found.set(String(exact.evidence_id ?? exact.record_id), exact);
      const claim = claimById.get(ref);
      if (claim) for (const id of strings(claim.evidence_ids)) {
        const record = recordById.get(id); if (record) found.set(id, record);
      }
    }
    return [...found.values()];
  };
  const recordLimitations = (linked: Row[]): string[] => unique(linked.flatMap(record => {
    const source = sourceById.get(String(record.source_id ?? record.source_manifest_id ?? "")) ?? {};
    const freshness = row(record.freshness).status;
    return [
      ...strings(record.limitations), ...strings(source.limitations),
      ...(freshness === "stale" ? ["Источник относится к более раннему периоду."] : []),
      ...(freshness === "aging" ? ["Актуальность данных ограничена."] : []),
      ...(!freshness || freshness === "unknown" ? ["Актуальность данных не установлена."] : []),
      ...(strings(record.conflicts).length ? ["В источниках есть противоречие."] : []),
      ...(source.status === "UNAVAILABLE" ? ["Данные источника недоступны."] : []),
      ...(row(row(record.raw).bounded).truncated === true ? ["Цитата источника доступна частично."] : []),
    ];
  }).map(text));
  const classify = (claim: Row, ref: string): ReadableEvidenceFact["basis"] => {
    if (claim.classification === "unknown" || row(claim.confidence).tier === "BLOCKED_UNKNOWN") return "UNKNOWN";
    if (/^(owner:|trusted-business:)/u.test(ref) || claim.classification === "owner_confirmed") return "OWNER";
    if (ref.startsWith("strategy:") || claim.classification === "derived") return "INFERENCE";
    if (["observed", "documented_api_fact"].includes(String(claim.classification))) return "OBSERVATION";
    return "UNKNOWN";
  };
  const recordBasis = (record: Row): ReadableEvidenceFact["basis"] => {
    const source = sourceById.get(String(record.source_id ?? record.source_manifest_id ?? "")) ?? {};
    if (!["VERIFIED", "PARTIAL"].includes(String(source.status))) return "UNKNOWN";
    if (source.provenance_class === "OWNER_CONFIRMED") return "OWNER";
    return observedDate(record.observed_at) ?? observedDate(source.observed_at) ? "OBSERVATION" : "UNKNOWN";
  };

  return unique(options.references).map(ref => {
    const suffix = /^(?:owner:|trusted-business:|strategy:)/u.test(ref) ? undefined : ref.match(/:(quote|offer|audience|qualified_outcome|economics|message)$/u)?.[1];
    const possibleBase = suffix ? ref.slice(0, -(suffix.length + 1)) : ref;
    const quoteRef = !recordById.has(ref) && suffix === "quote" && recordById.has(possibleBase);
    const facet = !claimById.has(ref) && suffix && suffix !== "quote" && claimById.has(possibleBase) ? suffix : "";
    const baseRef = quoteRef || facet ? possibleBase : ref;
    const claim = claimById.get(ref) ?? claimById.get(baseRef);
    const saved = catalog.get(ref);
    const record = recordById.get(quoteRef ? baseRef : ref);
    const fact: ReadableEvidenceFact = { id: ref, aliases: [], kind: "FACT", label: "Основание", value: "", basis: "UNKNOWN", sources: [], limitations: [] };

    if (claim || saved) {
      const predicate = String(claim?.predicate ?? ref.replace(/^(owner:|strategy:|trusted-business:)/u, ""));
      const units = saved ? strings(saved.admissible_fact_units) : [];
      const value = claim && !facet ? display(row(claim.normalized).value) || display(claim.value) : "";
      const offer = facet && claim?.predicate === "material_offer" ? rows(row(data.product_catalog).offers).find(offer => offer.offer_id === row(row(claim.normalized).value).offer_id) : undefined;
      const facetValue = offer && JSON.stringify(offer.material_axes) === JSON.stringify(row(row(claim?.normalized).value).material_axes)
        ? display(facet === "message" ? offer.value_proposition : row(offer.material_axes)[facet]) : "";
      fact.label = fieldLabels[facet] ?? fieldLabels[predicate] ?? (ref.startsWith("strategy:") ? "Решение стратегии" : "Сведения источника");
      fact.value = value || units.map(text).join(" · ") || text(saved?.source_excerpt) || facetValue;
      fact.basis = record && !claim ? recordBasis(record) : classify(claim ?? {}, ref);
      const linked = linkedRecords(unique([...(claim ? strings(claim.evidence_ids) : []), ...(saved ? strings(saved.evidence_refs) : [])]));
      fact.sources = recordLinks(linked);
      fact.limitations = unique([
        ...strings(row(claim?.confidence).uncertainty),
        ...(saved ? strings(saved.temporal_limitations) : []),
        ...recordLimitations(linked),
        ...(row(claim?.confidence).freshness === "stale" ? ["Источник относится к более раннему периоду."] : []),
        ...(row(claim?.confidence).freshness === "unknown" ? ["Актуальность данных не установлена."] : []),
        ...(row(claim?.confidence).freshness === "aging" ? ["Актуальность данных ограничена."] : []),
        ...(row(claim?.confidence).consistency === "conflicted" || (claim && rows(data.conflicts).some(conflict => strings(conflict.claim_ids).includes(String(claim.claim_id)) && conflict.relation === "contradicts")) ? ["В источниках есть противоречие."] : []),
        ...(row(claim?.confidence).consistency === "scope_mismatch" ? ["Области наблюдений не совпадают."] : []),
        ...(claim?.classification === "unknown" || row(claim?.confidence).tier === "BLOCKED_UNKNOWN" ? ["Утверждение не подтверждено доступными сведениями."] : []),
        ...(saved?.excerpt_truncated ? ["Цитата источника доступна частично."] : []),
      ].map(text));
      if (!fact.value) fact.value = "Подтверждение недоступно.";
      if (!linked.length && fact.basis !== "OWNER" && fact.basis !== "INFERENCE") fact.limitations.push("Источник, подтверждающий это утверждение, недоступен.");
      if (ref.startsWith("strategy:")) fact.limitations.push("Это решение стратегии; оно не является наблюдаемым фактом.");
      return fact;
    }
    if (record) {
      const source = sourceById.get(String(record.source_id ?? "")) ?? {};
      fact.label = narrative(source.title) || "Сведения источника";
      fact.value = quoteRef ? text(row(record.raw).quote) || display(row(record.raw).value) : display(row(record.normalized).value) || text(row(record.raw).quote) || display(row(record.raw).value);
      fact.basis = recordBasis(record);
      fact.sources = recordLinks([record]);
      fact.limitations = recordLimitations([record]);
      if (!fact.value) fact.value = "Подтверждение недоступно.";
      return fact;
    }
    const source = sourceById.get(ref);
    if (source) {
      fact.kind = "SOURCE";
      fact.label = narrative(source.title) || "Источник исследования";
      fact.value = strings(source.facts).map(text).join(" · ");
      fact.sources = recordLinks(records.filter(record => String(record.source_id ?? record.source_manifest_id ?? "") === ref));
      fact.limitations = unique([...strings(source.limitations).map(text), ...recordLimitations(records.filter(record => String(record.source_id ?? record.source_manifest_id ?? "") === ref))]);
      if (source.status === "UNAVAILABLE") fact.limitations.push("Данные источника недоступны.");
      fact.limitations.push("Это сведения об источнике в целом; отдельное утверждение проверяется по его материалам.");
      return fact;
    }
    const dimension = ref.startsWith("strategy:") ? dimensions.get(ref.slice(9)) : undefined;
    if (dimension) {
      fact.label = fieldLabels[ref.slice(9)] ?? "Решение стратегии";
      fact.value = display(dimension.value); fact.basis = "INFERENCE";
      fact.limitations = [narrative(dimension.rationale), "Это решение стратегии."].filter(Boolean);
      return fact;
    }
    const material = materials.get(ref);
    if (material) {
      fact.kind = "MATERIAL";
      fact.label = narrative(material.label) || "Материал исследования";
      fact.value = typeof material.content === "string" ? text(material.content) : text(material.summary) || text(row(material.content).summary);
      fact.basis = "INFERENCE";
      const descriptions = rows(row(material.content).sources);
      fact.sources = strings(material.source_urls).map(url => {
        const safe = publicUrl(url);
        const description = descriptions.find(source => safe && publicUrl(source.url) === safe);
        return { title: narrative(description?.title) || fact.label, url: safe, observedAt: observedDate(description?.observed_at) ?? observedDate(material.observed_at), scope: [fact.label],
          ...(text(description?.quote) ? { excerpt: text(description?.quote), excerptStatus: "SAVED" as const } : {}),
        };
      });
      fact.limitations = unique([...strings(material.limitations), ...strings(row(material.content).limitations), "Материал исследования сохраняет исходные ограничения и не подтверждает рекламные обещания сам по себе."].map(text));
      return fact;
    }
    const observation = observations.get(ref);
    if (observation) {
      const wordstat = wordstatIds.has(ref);
      const observedAt = observedDate(observation.observed_at) ?? observedDate(observation.date);
      fact.label = wordstat ? "Поисковый спрос" : "Поисковый запрос в истории";
      fact.value = wordstat ? display(observation) : text(observation.query);
      fact.basis = observedAt && observation.state !== "UNKNOWN" && observation.status !== "UNAVAILABLE" ? "OBSERVATION" : "UNKNOWN";
      const linked = linkedRecords(strings(observation.evidence_ids));
      if (wordstat && !linked.length) linked.push(...records.filter(record => strings(row(record.provider_metadata).canonical_observation_ids).includes(ref)));
      fact.sources = recordLinks(linked).map(source => ({ ...source, observedAt: observedAt ?? source.observedAt, scope: unique([...(source.scope ?? []), ...sourceScope({ ...row(observation.scope), ...observation })]) }));
      if (!fact.sources.length) fact.sources = [{ title: wordstat ? "Яндекс Wordstat" : "История поисковых запросов", url: publicUrl(observation.source_url), observedAt }];
      const scope = row(observation.region);
      fact.limitations = unique([text(scope.name), ...strings(observation.region_names), ...sourceScope({ device: observation.device }), text(observation.period ?? frequency.declared_window), ...strings(observation.limitations), ...recordLimitations(linked),
        wordstat ? "Частота относится к запросам в указанной области наблюдения; она не определяет число покупателей или результаты кампании." : "Исторический запрос не подтверждает квалифицированные результаты или эффективность новой кампании.",
        ...(!observedAt ? ["Дата наблюдения не установлена."] : []),
      ].map(text));
      return fact;
    }
    const gap = gaps.get(ref);
    if (gap) { fact.kind = "GAP"; fact.label = "Неизвестные данные"; fact.value = text(gap.description); fact.limitations = strings(gap.limitations).map(text); return fact; }
    if ([data.snapshot_id, data.snapshot_revision_id, data.revision_id].includes(ref)) {
      fact.kind = "SNAPSHOT";
      fact.label = "Материалы исследования"; fact.value = "";
      fact.limitations = [];
      return fact;
    }
    fact.kind = "UNRESOLVED"; fact.value = "Подтверждение недоступно.";
    return fact;
  });
}
