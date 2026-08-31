import type {
  AnalyticsEvidenceBundle,
  AnalyticsEvidenceDomain,
  AnalyticsEvidenceDomainEntry,
  EvidenceClaim,
  EvidenceGap,
} from "./analytics-evidence.ts";

export type OwnerAnalyticsStatus = "Готово к стратегии" | "Есть существенные пробелы" | "Недостаточно доказательств";
export type OwnerAnalyticsFindingStatus = "Подтверждено" | "Частично" | "Недоступно";
export type OwnerAnalyticsImpact = "Блокирует допустимость кампаний" | "Меняет стратегию" | "Снижает уверенность";

export type OwnerAnalyticsSummary = {
  status: OwnerAnalyticsStatus;
  headline: string;
  conclusion: string;
  quality: {
    coverage: string;
    freshness: string;
    consistency: string;
    limitation: string;
  };
  findings: Array<{
    area: string;
    status: OwnerAnalyticsFindingStatus;
    finding: string;
    source: string;
    freshness: string;
    confidence: string;
    limitation: string;
  }>;
  remediation: Array<{
    priority: number;
    impact: OwnerAnalyticsImpact;
    area: string;
    problem: string;
    action: string;
  }>;
};

const DOMAIN_ORDER: AnalyticsEvidenceDomain[] = [
  "BUSINESS_MODEL",
  "DIRECT",
  "METRIKA",
  "WORDSTAT",
  "COST",
  "COMPETITORS",
  "FINANCIAL",
];

const DOMAIN_LABELS: Record<AnalyticsEvidenceDomain, string> = {
  BUSINESS_MODEL: "Модель бизнеса",
  DIRECT: "Текущее продвижение",
  METRIKA: "Наблюдаемый результат",
  WORDSTAT: "Поисковый спрос",
  COST: "Сопоставимая стоимость",
  COMPETITORS: "Публичные конкуренты",
  FINANCIAL: "Финансовая история юрлиц",
};

const DOMAIN_SOURCES: Record<AnalyticsEvidenceDomain, string> = {
  BUSINESS_MODEL: "Публичные страницы компании и подтверждения владельца",
  DIRECT: "Подтверждённый срез выбранного рекламного аккаунта",
  METRIKA: "Подтверждённое измерение выбранного бизнес-результата",
  WORDSTAT: "Официальный срез поискового спроса в выбранной области",
  COST: "Сопоставимая собственная история или текущий аукционный ориентир",
  COMPETITORS: "Ограниченный набор публичных страниц и поисковых наблюдений",
  FINANCIAL: "Официальная отчётность ГИР БО подтверждённого юридического периметра",
};

const DOMAIN_LIMITATIONS: Record<AnalyticsEvidenceDomain, string> = {
  BUSINESS_MODEL: "Модель описывает подтверждённый сейчас бизнес-контекст и требует нового решения при его изменении.",
  DIRECT: "Наблюдаемое состояние не доказывает причинную эффективность или будущий результат.",
  METRIKA: "Достижения цели являются наблюдением в указанном окне, а не доказательством прибыли или причинного эффекта рекламы.",
  WORDSTAT: "Частоты являются нижней границей доступных строк в точной области и не являются прогнозом обращений.",
  COST: "Диапазон описывает только прошедший проверки сопоставимый источник и не является прогнозом цены будущего результата.",
  COMPETITORS: "Публичное позиционирование и видимость не раскрывают расходы, конверсии, прибыльность или внутреннюю стратегию конкурентов.",
  FINANCIAL: "Бухгалтерская динамика не доказывает рекламный бюджет, эффективность рекламы, силу бренда или присутствие на всём рынке.",
};

const GAP_COPY: Record<string, { problem: string; action: string; domain: AnalyticsEvidenceDomain }> = {
  BUSINESS_MODEL_EVIDENCE_MISSING: {
    domain: "BUSINESS_MODEL",
    problem: "Существенный факт модели бизнеса не подтверждён владельцем или доступным источником.",
    action: "Подтвердить предложение, аудиторию, качественный результат и экономические ограничения бизнеса.",
  },
  CURRENT_DIRECT_INVENTORY_UNAVAILABLE: {
    domain: "DIRECT",
    problem: "Текущее продвижение неизвестно и не может считаться нулевым.",
    action: "Восстановить подтверждённый срез выбранного рекламного аккаунта до решений, зависящих от текущих кампаний.",
  },
  METRIKA_REPORT_UNAVAILABLE: {
    domain: "METRIKA",
    problem: "Наблюдение выбранного бизнес-результата отсутствует или неполно.",
    action: "Подтвердить цель измерения и получить сопоставимое окно достижений без подмены отсутствующих данных нулём.",
  },
  PRELAUNCH_COST_UNAVAILABLE: {
    domain: "COST",
    problem: "Нет источника стоимости, прошедшего проверки сопоставимости.",
    action: "Собрать сопоставимую собственную историю или допустимый текущий аукционный ориентир; не усреднять несопоставимые данные.",
  },
  WORDSTAT_AUTHORITY_UNAVAILABLE: {
    domain: "WORDSTAT",
    problem: "Поисковый спрос в выбранной области не подтверждён.",
    action: "Восстановить разрешённый сбор спроса и повторить только недоступные формулировки в той же области.",
  },
  WORDSTAT_QUOTA_EXHAUSTED: {
    domain: "WORDSTAT",
    problem: "Часть или весь срез поискового спроса недоступен из-за временного ограничения сбора.",
    action: "Повторить недоступные формулировки после восстановления возможности сбора, сохранив тот же регион и устройство.",
  },
  WORDSTAT_RESPONSE_PARTIAL: {
    domain: "WORDSTAT",
    problem: "По части проверяемых формулировок частота не получена.",
    action: "Повторить только недоступные формулировки и не считать их нулевыми.",
  },
  COMPETITOR_EVIDENCE_UNAVAILABLE: {
    domain: "COMPETITORS",
    problem: "Публичный конкурентный срез не покрывает утверждённый набор.",
    action: "Завершить ограниченный публичный срез по точным страницам, сохранив размер исходного набора.",
  },
  UNAVAILABLE_NO_APPROVED_SOURCE: {
    domain: "COMPETITORS",
    problem: "Одобренный источник фактических рекламных показов конкурентов отсутствует.",
    action: "Сохранять рекламное наблюдение недоступным; принимать только артефакт владельца с provenance и digest либо проверенного лицензированного провайдера.",
  },
  COMPETITOR_INTERNAL_PERFORMANCE_UNAVAILABLE: {
    domain: "COMPETITORS",
    problem: "Внутренняя эффективность конкурентов недоступна из публичных источников.",
    action: "Использовать публичные наблюдения только как гипотезы позиционирования и не приписывать им эффективность.",
  },
  FINANCIAL_COMPETITOR_INTELLIGENCE_UNAVAILABLE: {
    domain: "FINANCIAL",
    problem: "История ГИР БО подтверждённого юридического периметра недоступна или неполна.",
    action: "Продолжить без финансового вывода; не заменять отсутствующую отчётность нулём и не поручать её ручной сбор владельцу.",
  },
};

const DOMAIN_FALLBACK_REMEDIATION: Record<AnalyticsEvidenceDomain, { problem: string; action: string }> = {
  BUSINESS_MODEL: GAP_COPY.BUSINESS_MODEL_EVIDENCE_MISSING,
  DIRECT: GAP_COPY.CURRENT_DIRECT_INVENTORY_UNAVAILABLE,
  METRIKA: GAP_COPY.METRIKA_REPORT_UNAVAILABLE,
  WORDSTAT: GAP_COPY.WORDSTAT_AUTHORITY_UNAVAILABLE,
  COST: GAP_COPY.PRELAUNCH_COST_UNAVAILABLE,
  COMPETITORS: GAP_COPY.COMPETITOR_EVIDENCE_UNAVAILABLE,
  FINANCIAL: GAP_COPY.FINANCIAL_COMPETITOR_INTELLIGENCE_UNAVAILABLE,
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function safeText(value: unknown, fallback: string, maximum = 500) {
  let text = String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  text = text
    .replace(/sha-?256:[a-f0-9]+/giu, "")
    .replace(/\b(?:schema|contract|snapshot|provider|record|manifest|revision|fingerprint|hash|identifier|id)\b/giu, "")
    .replace(/\b[A-Z][A-Z0-9_]{3,}\b/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return text.slice(0, maximum).trim() || fallback;
}

function countLabel(value: unknown, one: string, few: string, many: string) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) return "Количество не подтверждено";
  const lastTwo = count % 100;
  const last = count % 10;
  const noun = lastTwo >= 11 && lastTwo <= 14 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
  return `${count.toLocaleString("ru-RU")} ${noun}`;
}

function domainClaims(snapshot: AnalyticsEvidenceBundle, domain: AnalyticsEvidenceDomainEntry) {
  const claims = Array.isArray(snapshot.claims) ? snapshot.claims : [];
  return domain.claim_indexes.map((index) => claims[index]).filter((claim): claim is EvidenceClaim => Boolean(claim));
}

function domainGaps(snapshot: AnalyticsEvidenceBundle, domain: AnalyticsEvidenceDomainEntry) {
  const gaps = Array.isArray(snapshot.gaps) ? snapshot.gaps : [];
  return domain.gap_indexes.map((index) => gaps[index]).filter((gap): gap is EvidenceGap => Boolean(gap));
}

function domainStatus(status: AnalyticsEvidenceDomainEntry["status"]): OwnerAnalyticsFindingStatus {
  return status === "VERIFIED" ? "Подтверждено" : status === "PARTIAL" ? "Частично" : "Недоступно";
}

function freshness(domain: AnalyticsEvidenceDomainEntry) {
  const values = domain.freshness;
  if (values.stale > 0) return "Требует обновления";
  if (values.current > 0 && values.aging === 0 && values.unknown === 0) return "Актуально на момент снимка";
  if (values.aging > 0 || (values.current > 0 && values.unknown > 0)) return "Смешанная свежесть";
  return "Свежесть не подтверждена";
}

function confidence(claims: EvidenceClaim[], domain: AnalyticsEvidenceDomainEntry) {
  if (!claims.length) return "Недостаточная";
  if (domain.conflict_indexes.length || claims.some((claim) => ["D", "U"].includes(claim.confidence.quality)
    || claim.confidence.tier === "BLOCKED_UNKNOWN")) return "Недостаточная";
  if (claims.every((claim) => ["A", "B"].includes(claim.confidence.quality)
    && claim.confidence.coverage === "complete_for_scope"
    && claim.confidence.consistency !== "conflicted")) return "Высокая";
  return "Ограниченная";
}

function businessFinding(snapshot: AnalyticsEvidenceBundle) {
  const offers = list(record(snapshot.product_catalog).offers).map(record);
  if (!offers.length) return "Рекламируемое предложение и его бизнес-результат не подтверждены.";
  const recommendedId = record(snapshot.focus_opportunities).recommended_offer_id;
  const recommended = offers.find((offer) => offer.offer_id === recommendedId) ?? offers[0];
  const axes = record(recommended.material_axes);
  const audience = safeText(axes.audience, "аудитория требует подтверждения", 220);
  const offer = safeText(axes.offer, "предложение требует подтверждения", 240);
  return offers.length === 1
    ? `Предложение: ${safeText(recommended.label, offer, 240)}. Аудитория: ${audience}.`
    : `${countLabel(offers.length, "существенно различающееся предложение", "существенно различающихся предложения", "существенно различающихся предложений")}; текущий фокус — ${safeText(recommended.label, offer, 240)} для аудитории «${audience}».`;
}

function directFinding(claims: EvidenceClaim[]) {
  const claim = claims.find((item) => ["complete_account_audit", "campaign_inventory"].includes(item.predicate));
  if (!claim) return "Текущая рекламная активность не подтверждена; это не означает отсутствие кампаний.";
  const value = record(claim.value);
  const audit = record(value.complete_read_audit);
  const counts = record(audit.object_counts);
  const campaigns = counts.campaigns ?? value.campaigns_total;
  return `${countLabel(campaigns, "кампания", "кампании", "кампаний")} в подтверждённом текущем срезе. Доступное состояние показов и проверки сохранено отдельно от выводов об эффективности.`;
}

function metrikaFinding(claims: EvidenceClaim[]) {
  const performance = claims.find((item) => item.predicate === "observed_performance");
  if (performance) {
    const value = record(performance.value);
    const report = record(value.report);
    return `${countLabel(value.goal_visits, "достижение выбранного результата", "достижения выбранного результата", "достижений выбранного результата")} при ${countLabel(value.visits, "визите", "визитах", "визитах")} за ${safeText(report.period_start, "неизвестное начало", 30)} — ${safeText(report.period_end, "неизвестный конец", 30)}.`;
  }
  if (claims.some((item) => item.predicate === "exact_goal_binding")) {
    return "Выбранная цель измерения подтверждена, но сопоставимое наблюдение её достижений недоступно.";
  }
  return "Выбранный бизнес-результат пока нельзя наблюдать в подтверждённой области.";
}

function wordstatFinding(snapshot: AnalyticsEvidenceBundle) {
  const frequency = record(record(snapshot.market_evidence).frequency);
  const count = record(frequency.observed_unique_count).value;
  if (frequency.status === "AVAILABLE" || frequency.status === "PARTIAL") {
    return `Наблюдаемая нижняя граница спроса — ${countLabel(count, "уникальная строка", "уникальные строки", "уникальных строк")} в выбранной области; недоступные формулировки не считаются нулевыми.`;
  }
  return "Поисковый спрос в выбранной области не подтверждён и не подменён нулевым значением.";
}

function costFinding(snapshot: AnalyticsEvidenceBundle) {
  const cost = record(snapshot.prelaunch_cost);
  const range = record(cost.range);
  if (cost.status === "AVAILABLE" && Number.isFinite(Number(range.low)) && Number.isFinite(Number(range.high))) {
    return `Сопоставимый диапазон стоимости перехода: ${Number(range.low).toLocaleString("ru-RU")}–${Number(range.high).toLocaleString("ru-RU")} ${safeText(cost.currency, "в выбранной валюте", 20)}; выборка — ${countLabel(record(cost.sample_size).value, "наблюдение", "наблюдения", "наблюдений")}.`;
  }
  return "Сопоставимый диапазон стоимости до запуска не подтверждён; цена не считается нулевой и не выдумывается.";
}

function competitorFinding(snapshot: AnalyticsEvidenceBundle) {
  const matrix = record(snapshot.competitor_matrix);
  const adObservation = record(snapshot.competitor_ad_observation);
  if (!Object.keys(matrix).length) return adObservation.status === "UNAVAILABLE_NO_APPROVED_SOURCE"
    ? "Публичный конкурентный срез недоступен; это не означает отсутствие конкурентов. Одобренный источник рекламных наблюдений отсутствует; рекламная активность неизвестна."
    : "Публичный конкурентный срез недоступен; это не означает отсутствие конкурентов.";
  const denominator = list(record(matrix.candidate_set).candidates).length;
  const observed = list(matrix.rows).length;
  const adStatus = adObservation.status === "UNAVAILABLE_NO_APPROVED_SOURCE"
    ? " Одобренный источник рекламных наблюдений отсутствует; это не означает нулевую рекламную активность."
    : ` Одобренных рекламных samples: ${Number(adObservation.approved_sample_count).toLocaleString("ru-RU")}; каждый ограничен своей точной областью.`;
  return `Публичные предложения наблюдались у ${observed.toLocaleString("ru-RU")} из ${denominator.toLocaleString("ru-RU")} участников ограниченного набора; вывод относится только к этому набору.${adStatus}`;
}

function financialFinding(snapshot: AnalyticsEvidenceBundle) {
  const dossier = record(snapshot.financial_competitor_intelligence);
  if (!Object.keys(dossier).length) return "История ГИР БО не собрана; отсутствующие значения не считаются нулевыми.";
  const coverage = record(dossier.coverage);
  const accepted = Number(coverage.accepted_entities);
  const observed = Number(coverage.entities_with_records);
  const acceptedLabel = Number.isSafeInteger(accepted) && accepted >= 0 ? accepted.toLocaleString("ru-RU") : "неустановленного числа";
  const observedLabel = Number.isSafeInteger(observed) && observed >= 0 ? observed.toLocaleString("ru-RU") : "неустановленного числа";
  return `Финансовая история доступна для ${observedLabel} из ${acceptedLabel} подтверждённых юридических лиц; выводы ограничены бухгалтерской динамикой.`;
}

function findingForDomain(snapshot: AnalyticsEvidenceBundle, domain: AnalyticsEvidenceDomain, claims: EvidenceClaim[]) {
  if (domain === "BUSINESS_MODEL") return businessFinding(snapshot);
  if (domain === "DIRECT") return directFinding(claims);
  if (domain === "METRIKA") return metrikaFinding(claims);
  if (domain === "WORDSTAT") return wordstatFinding(snapshot);
  if (domain === "COST") return costFinding(snapshot);
  if (domain === "FINANCIAL") return financialFinding(snapshot);
  return competitorFinding(snapshot);
}

function impactForDomain(domain: AnalyticsEvidenceDomain): OwnerAnalyticsImpact {
  if (["BUSINESS_MODEL", "DIRECT", "METRIKA"].includes(domain)) return "Блокирует допустимость кампаний";
  if (["WORDSTAT", "COST"].includes(domain)) return "Меняет стратегию";
  return "Снижает уверенность";
}

function remediationForGap(gap: EvidenceGap, fallbackDomain: AnalyticsEvidenceDomain) {
  const exact = GAP_COPY[gap.code];
  if (exact) return exact;
  return {
    domain: fallbackDomain,
    problem: "Существенная часть доказательств в этой области недоступна или противоречива.",
    action: DOMAIN_FALLBACK_REMEDIATION[fallbackDomain].action,
  };
}

function priorityOrder(impact: OwnerAnalyticsImpact) {
  return impact === "Блокирует допустимость кампаний" ? 0 : impact === "Меняет стратегию" ? 1 : 2;
}

export function projectAnalyticsEvidenceForOwner(snapshot: AnalyticsEvidenceBundle | null | unknown): OwnerAnalyticsSummary | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const evidence = snapshot as AnalyticsEvidenceBundle;
  const domains = new Map(evidence.domain_manifest?.domains?.map((domain) => [domain.domain, domain]) ?? []);
  const findings = DOMAIN_ORDER.map((domainName) => {
    const domain = domains.get(domainName) ?? {
      domain: domainName,
      artifact_paths: [],
      status: "UNAVAILABLE" as const,
      source_ids: [],
      claim_indexes: [],
      evidence_indexes: [],
      conflict_indexes: [],
      gap_indexes: [],
      freshness: { current: 0, aging: 0, stale: 0, unknown: 0 },
    };
    const claims = domainClaims(evidence, domain);
    const gaps = domainGaps(evidence, domain);
    const gapLimitation = gaps.find((gap) => gap.material);
    return {
      area: DOMAIN_LABELS[domainName],
      status: domainStatus(domain.status),
      finding: findingForDomain(evidence, domainName, claims),
      source: DOMAIN_SOURCES[domainName],
      freshness: freshness(domain),
      confidence: confidence(claims, domain),
      limitation: gapLimitation
        ? remediationForGap(gapLimitation, domainName).problem
        : DOMAIN_LIMITATIONS[domainName],
    };
  });

  const candidates: Array<Omit<OwnerAnalyticsSummary["remediation"][number], "priority"> & { order: number }> = [];
  for (const domainName of DOMAIN_ORDER) {
    const domain = domains.get(domainName);
    if (!domain) continue;
    const gaps = domainGaps(evidence, domain).filter((gap) => gap.material);
    for (const gap of gaps) {
      const copy = remediationForGap(gap, domainName);
      const impact = impactForDomain(copy.domain);
      candidates.push({
        impact,
        area: DOMAIN_LABELS[copy.domain],
        problem: copy.problem,
        action: copy.action,
        order: DOMAIN_ORDER.indexOf(copy.domain),
      });
    }
    if (domain.status !== "VERIFIED" && gaps.length === 0) {
      const fallback = DOMAIN_FALLBACK_REMEDIATION[domainName];
      const impact = impactForDomain(domainName);
      candidates.push({ impact, area: DOMAIN_LABELS[domainName], ...fallback, order: DOMAIN_ORDER.indexOf(domainName) });
    }
    if (domain.freshness.stale > 0) {
      const impact = impactForDomain(domainName);
      candidates.push({
        impact,
        area: DOMAIN_LABELS[domainName],
        problem: "Доступные наблюдения в этой области устарели.",
        action: `Обновить область «${DOMAIN_LABELS[domainName]}» в прежнем объёме до опоры на неё в новом решении.`,
        order: DOMAIN_ORDER.indexOf(domainName),
      });
    }
  }
  const conflicts = Array.isArray(evidence.conflicts) ? evidence.conflicts : [];
  for (const conflict of conflicts.filter((item) => item.material && item.resolution.startsWith("UNRESOLVED"))) {
    candidates.push({
      impact: "Блокирует допустимость кампаний",
      area: DOMAIN_LABELS.BUSINESS_MODEL,
      problem: `Существенные источники расходятся по факту «${safeText(conflict.predicate, "модель бизнеса", 160)}».`,
      action: "Получить явное решение владельца и сохранить новую версию аналитики до подготовки стратегии.",
      order: 0,
    });
  }
  const seen = new Set<string>();
  const remediation = candidates
    .sort((left, right) => priorityOrder(left.impact) - priorityOrder(right.impact) || left.order - right.order || left.action.localeCompare(right.action, "ru"))
    .filter((item) => {
      const key = `${item.area}:${item.problem}:${item.action}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6)
    .map((item, index) => ({
      priority: index + 1,
      impact: item.impact,
      area: item.area,
      problem: item.problem,
      action: item.action,
    }));

  const verified = findings.filter((finding) => finding.status === "Подтверждено").length;
  const partial = findings.filter((finding) => finding.status === "Частично").length;
  const unavailable = findings.filter((finding) => finding.status === "Недоступно").length;
  const stale = findings.filter((finding) => finding.freshness === "Требует обновления").length;
  const blockingDomainUnavailable = (["BUSINESS_MODEL", "DIRECT", "METRIKA"] as AnalyticsEvidenceDomain[])
    .some((domainName) => domains.get(domainName)?.status === "UNAVAILABLE");
  const unresolvedMaterialConflict = conflicts.some((conflict) => conflict.material && conflict.resolution.startsWith("UNRESOLVED"));
  const blocked = evidence.recommendation_status === "BLOCKED_UNKNOWN"
    || blockingDomainUnavailable
    || unresolvedMaterialConflict;
  const status: OwnerAnalyticsStatus = blocked
    ? "Недостаточно доказательств"
    : remediation.length || partial > 0 || unavailable > 0 || stale > 0
      ? "Есть существенные пробелы"
      : "Готово к стратегии";
  const statusCopy = {
    "Готово к стратегии": {
      headline: "Ключевые аналитические области подтверждены",
      conclusion: "Стратегию можно готовить по показанным фактам и ограничениям; изменение существенного контекста потребует новой версии аналитики.",
    },
    "Есть существенные пробелы": {
      headline: "Основные выводы собраны, но часть решений требует осторожности",
      conclusion: "Доступные факты можно использовать только вместе с показанными ограничениями; исправления ниже упорядочены по влиянию на стратегию.",
    },
    "Недостаточно доказательств": {
      headline: "Подтверждений недостаточно для честной готовности",
      conclusion: "Кампания не должна считаться допустимой по отсутствующим или противоречивым данным. Сначала выполните блокирующие исправления.",
    },
  }[status];

  return {
    status,
    ...statusCopy,
    quality: {
      coverage: `${verified} из ${findings.length} областей подтверждены; частично — ${partial}; недоступно — ${unavailable}.`,
      freshness: stale ? `${stale} областей требуют обновления.` : findings.some((finding) => finding.freshness !== "Актуально на момент снимка") ? "Свежесть части выводов ограничена или не подтверждена." : "Все подтверждённые выводы актуальны на момент снимка.",
      consistency: conflicts.some((conflict) => conflict.material && conflict.resolution.startsWith("UNRESOLVED")) ? "Есть неразрешённые существенные противоречия." : "Неразрешённых существенных противоречий не выявлено.",
      limitation: "Готовность определяется отдельно по каждой области; сводный статус не скрывает частичные, устаревшие или недоступные доказательства.",
    },
    findings,
    remediation,
  };
}
