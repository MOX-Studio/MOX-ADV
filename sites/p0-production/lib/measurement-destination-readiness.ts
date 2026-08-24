import {
  PINNED_LANDING_TOOL_VERSIONS,
  createLandingBrowserPolicy,
  type LandingAdvisoryAdapter,
  type LandingPageInspection,
} from "./landing-advisory.ts";
import { strategyAnswerValue } from "./campaign-strategy.ts";
import { redactSensitiveEvidenceText } from "./analytics-evidence.ts";

export const MEASUREMENT_DESTINATION_READINESS_SCHEMA = "p0-measurement-destination-readiness-v1";
export const MEASUREMENT_DESTINATION_READINESS_VERSION = "1.0.0";

export type ServedDeviceScope = "desktop" | "mobile";
export type DestinationClassification = "EXISTING_BUSINESS_PAGE" | "EXISTING_LANDING" | "FUTURE_LANDING_REQUIRED" | "INVALID_UNRELATED";
type CheckStatus = "PASS" | "FAIL" | "UNKNOWN" | "NOT_APPLICABLE";

export type ReadinessCheck = {
  code: "EXACT_BINDING" | "GOAL_SEMANTICS" | "GOAL_FUNNEL" | "GOAL_DUPLICATION" | "RECENT_REACHES" | "SAMPLING_PRIVACY_LAG" | "ATTRIBUTION" | "VALUE_REVENUE" | "OFFLINE_READINESS";
  status: CheckStatus;
  conclusion: string;
  limitation: string | null;
};

export type MeasurementDestinationReadiness = {
  schema_version: typeof MEASUREMENT_DESTINATION_READINESS_SCHEMA;
  contract_version: typeof MEASUREMENT_DESTINATION_READINESS_VERSION;
  readiness_id: string;
  strategy_revision_id: string;
  observed_at: string;
  status: "READY" | "BLOCKED";
  measurement: {
    status: "READY" | "BLOCKED";
    checks: ReadinessCheck[];
    goal_assessment: {
      business_result: string;
      selected_goal: { goal_id: string; name: string; type: string; source: string };
      result_funnel_stage: "QUALIFIED_LEAD" | "SALE" | "AWARENESS" | "UNKNOWN";
      goal_funnel_stage: "QUALIFIED_LEAD" | "SALE" | "AWARENESS" | "UNKNOWN";
      semantic_similarity: number;
      duplicate_goal_ids: string[];
      alternatives: Array<{ goal_id: string; name: string; type: string; funnel_stage: string; semantic_similarity: number }>;
      attribution_assumption: string;
      value_assumption: string;
    };
    evidence: {
      source: "YANDEX_METRIKA_OFFICIAL_API";
      observed_at: string | null;
      scope: string;
      freshness: "CURRENT" | "STALE" | "UNKNOWN";
      confidence: "HIGH" | "LIMITED" | "UNKNOWN";
      limitations: string[];
    };
  };
  destination: {
    status: "READY" | "BLOCKED" | "SAFETY_BLOCKED" | "UNAVAILABLE";
    requested_url: string;
    adapter: {
      status: "PINNED_MATCH" | "PINNED_MISMATCH" | "UNAVAILABLE";
      contract: "BOUNDED_READ_ONLY_INSPECTION";
    };
    device_scopes: Array<{
      device: ServedDeviceScope;
      status: "READY" | "BLOCKED" | "UNAVAILABLE";
      classification: DestinationClassification | null;
      final_url: string | null;
      conclusion: string;
      limitations: string[];
    }>;
    deterministic_observations: Array<{
      kind: "DETERMINISTIC_OBSERVATION";
      device: ServedDeviceScope;
      code: string;
      conclusion: string;
    }>;
    neural_hypotheses: Array<{
      kind: "NEURAL_HYPOTHESIS";
      device: ServedDeviceScope;
      conclusion: string;
      limitation: "Требует проверки владельцем; не является наблюдаемым фактом.";
    }>;
    priority_corrections: Array<{
      priority: 1 | 2 | 3;
      device: ServedDeviceScope;
      action: string;
      basis: "DETERMINISTIC_OBSERVATION" | "NEURAL_HYPOTHESIS";
    }>;
  };
  repair_plan: Array<{
    priority: number;
    area: "MEASUREMENT" | "DESTINATION";
    action: string;
    expected_result: string;
    owner_or_site_team: true;
  }>;
  human_decision_gate: null | {
    reason: "MATERIAL_UNCERTAINTY";
    recommendation: string;
    evidence: string[];
    confidence: "LIMITED";
    options: Array<{ option: string; consequence: string }>;
  };
  limitations: string[];
  external_changes_performed: false;
};

type ReadinessAdapter = Pick<LandingAdvisoryAdapter, "availability" | "resolveHostname" | "versions"> & {
  inspect(input: {
    url: string;
    viewport: { form_factor: ServedDeviceScope; width: number; height: number; device_scale_factor: number };
    policy: ReturnType<typeof createLandingBrowserPolicy>;
    signal: AbortSignal;
  }): Promise<LandingPageInspection>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, maximum = 1_000) {
  const normalized = String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  return redactSensitiveEvidenceText(normalized, maximum);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonical(item)]));
}

async function hash(value: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical(value))));
  return `sha256:${[...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

function check(code: ReadinessCheck["code"], status: CheckStatus, conclusion: string, limitation: string | null = null): ReadinessCheck {
  return { code, status, conclusion: text(conclusion, 600), limitation: limitation ? text(limitation, 600) : null };
}

function metric(value: unknown) {
  const normalized = String(value ?? "");
  return /^\d+(?:\.\d+)?$/u.test(normalized) && Number.isFinite(Number(normalized)) ? Number(normalized) : null;
}

function currentFreshness(observedAt: unknown, nowValue: string, maximumDays: number) {
  const observed = Date.parse(String(observedAt ?? ""));
  const now = Date.parse(nowValue);
  if (!Number.isFinite(observed) || !Number.isFinite(now)) return "UNKNOWN" as const;
  return now - observed <= maximumDays * 86_400_000 && now >= observed - 60_000 ? "CURRENT" as const : "STALE" as const;
}

type FunnelStage = "QUALIFIED_LEAD" | "SALE" | "AWARENESS" | "UNKNOWN";

const GENERIC_RESULT_WORDS = new Set(["отправлен", "успешн", "основн", "участи", "получен", "результ", "действ"]);

function semanticTokens(value: unknown) {
  return [...new Set((text(value, 1_000).toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])
    .map((item) => item.slice(0, Math.min(item.length, 7)))
    .filter((item) => !GENERIC_RESULT_WORDS.has(item)))];
}

function semanticSimilarity(left: unknown, right: unknown) {
  const expected = semanticTokens(left);
  const observed = new Set(semanticTokens(right));
  return expected.length ? expected.filter((item) => observed.has(item)).length / expected.length : 0;
}

function stageFromText(value: unknown): FunnelStage {
  const normalized = text(value, 1_000).toLowerCase();
  if (/(?:покуп|оплат|продаж|заказ.{0,20}(?:оформ|заверш)|выруч)/u.test(normalized)) return "SALE";
  if (/(?:заяв|регистрац|обращен|звон|встреч|консультац|брони|запрос|лид)/u.test(normalized)) return "QUALIFIED_LEAD";
  if (/(?:просмотр|переход|клик|посещ|скач)/u.test(normalized)) return "AWARENESS";
  return "UNKNOWN";
}

function stageFromGoal(goal: Record<string, unknown>): FunnelStage {
  const type = text(goal.type, 100).toUpperCase();
  if (["PURCHASE", "ORDER"].includes(type)) return "SALE";
  if (["FORM", "PHONE", "EMAIL", "MESSENGER"].includes(type)) return "QUALIFIED_LEAD";
  if (["URL", "DEPTH", "NUMBER", "PAGE_VIEW", "SOCIAL", "FILE", "SEARCH"].includes(type)) return "AWARENESS";
  return stageFromText(goal.name);
}

function funnelStageLabel(value: string) {
  return ({ QUALIFIED_LEAD: "квалифицированный лид", SALE: "продажа", AWARENESS: "ранний этап", UNKNOWN: "этап не определён" } as Record<string, string>)[value] ?? "этап не определён";
}

function goalTypeLabel(value: string) {
  return ({ FORM: "отправка формы", PHONE: "звонок", EMAIL: "письмо", MESSENGER: "обращение в мессенджер", PURCHASE: "покупка", ORDER: "заказ", ACTION: "составное действие", URL: "посещение страницы" } as Record<string, string>)[value] ?? "тип провайдера не распознан";
}

function goalTriggerSignature(goal: Record<string, unknown>) {
  const conditions = list(goal.conditions).map((item) => {
    const value = record(item);
    return `${text(value.type, 100).toUpperCase()}:${text(value.value ?? value.url, 1_000).toLowerCase()}`;
  }).filter((item) => item !== ":").sort();
  const steps = list(goal.steps).map((item) => {
    const value = record(item);
    return `${text(value.type, 100).toUpperCase()}:${text(value.name, 500).toLowerCase()}`;
  }).filter((item) => item !== ":").sort();
  return [...conditions, ...steps].join("|");
}

function measurementChecks(context: Record<string, unknown>, qualifiedResult: string, nowValue: string) {
  const metrika = record(context.metrika);
  const binding = record(metrika.binding);
  const goalBinding = record(metrika.goal_binding);
  const goal = record(metrika.goal_definition);
  const performance = record(context.performance);
  const display = record(performance.display_metrics);
  const provenance = record(performance.provenance);
  const sampling = record(provenance.sampling);
  const exact = metrika.ready === true
    && metrika.authority === "VERIFIED"
    && metrika.access === "YANDEX_METRIKA_MANAGEMENT_AND_REPORTS_API"
    && binding.matched === true && goalBinding.matched === true
    && text(binding.expected_counter_id, 100) === text(metrika.counter_id, 100)
    && text(binding.api_counter_id, 100) === text(metrika.counter_id, 100)
    && text(goalBinding.expected_goal_id, 100) === text(metrika.goal_id, 100)
    && text(goalBinding.api_goal_id, 100) === text(metrika.goal_id, 100);
  const selectedGoalId = text(metrika.goal_id, 100);
  const goalName = text(goal.name, 500);
  const goalType = text(goal.type, 100).toUpperCase();
  const providerMetadata = goal.source === "YANDEX_METRIKA_MANAGEMENT_API"
    && goal.provider_metadata_complete === true && Boolean(goalName && goalType);
  const resultStage = stageFromText(qualifiedResult);
  const goalStage = stageFromGoal(goal);
  const similarity = semanticSimilarity(qualifiedResult, goalName);
  const semanticsKnown = providerMetadata && resultStage !== "UNKNOWN" && goalStage !== "UNKNOWN";
  const semanticsPass = semanticsKnown && resultStage === goalStage && similarity >= 0.2;
  const funnelKnown = providerMetadata && resultStage !== "UNKNOWN" && goalStage !== "UNKNOWN";
  const funnelPass = funnelKnown && resultStage === goalStage && !["AWARENESS", "UNKNOWN"].includes(goalStage);
  const catalog = list(metrika.goal_catalog).map(record).filter((item) => text(item.id, 100));
  const selectedSignature = goalTriggerSignature(goal);
  const selectedName = goalName.toLowerCase();
  const duplicates = catalog.filter((candidate) => text(candidate.id, 100) !== selectedGoalId
    && ((selectedName && text(candidate.name, 500).toLowerCase() === selectedName)
      || (selectedSignature && text(candidate.type, 100).toUpperCase() === goalType && goalTriggerSignature(candidate) === selectedSignature)));
  const duplicationKnown = providerMetadata && metrika.goal_catalog_complete === true
    && catalog.some((candidate) => text(candidate.id, 100) === selectedGoalId);
  const alternatives = catalog
    .filter((candidate) => text(candidate.id, 100) !== selectedGoalId)
    .map((candidate) => ({
      goal_id: text(candidate.id, 100),
      name: text(candidate.name, 500),
      type: text(candidate.type, 100).toUpperCase(),
      funnel_stage: stageFromGoal(candidate),
      semantic_similarity: semanticSimilarity(qualifiedResult, candidate.name),
    }))
    .filter((candidate) => candidate.name && (candidate.semantic_similarity >= 0.2 || candidate.funnel_stage === resultStage))
    .sort((left, right) => right.semantic_similarity - left.semantic_similarity || left.goal_id.localeCompare(right.goal_id))
    .slice(0, 5);
  const reaches = metric(display.goal_visits);
  const reportOfficial = provenance.source_kind === "METRIKA_REPORTS_API";
  const reportWindowKnown = Boolean(text(performance.period_start, 20) && text(performance.period_end, 20));
  const reportFresh = currentFreshness(provenance.observed_at ?? performance.period_end, nowValue, 30);
  const reachesPass = reportOfficial && reportWindowKnown && reaches !== null && reaches >= 3 && reportFresh === "CURRENT";
  const metadataComplete = sampling.metadata_complete === true || ["sampled", "contains_sensitive_data", "sample_share", "sample_size", "sample_space", "data_lag"].every((key) => Object.hasOwn(sampling, key));
  const qualityPass = reportOfficial && metadataComplete && sampling.sampled === false && sampling.contains_sensitive_data === false && Number(sampling.data_lag) === 0;
  const attribution = text(provenance.attribution, 200);
  const dimensions = list(provenance.dimensions).map((item) => text(item, 200));
  const trafficFilter = text(provenance.filters, 1_000);
  const attributionPass = reportOfficial && attribution === "last_direct_click_order_dimension"
    && dimensions.some((item) => item.includes("lastDirectClickOrder"))
    && trafficFilter.includes("lastDirectClickOrder");
  const defaultPrice = metric(goal.default_price);
  const goalValue = metric(display.goal_value);
  const valueKnown = resultStage !== "UNKNOWN";
  const valuePass = resultStage === "SALE" && (defaultPrice !== null || goalValue !== null);
  const valueStatus: CheckStatus = !valueKnown ? "UNKNOWN" : resultStage === "SALE" ? valuePass ? "PASS" : "UNKNOWN" : "NOT_APPLICABLE";
  const valueAssumption = resultStage === "SALE"
    ? valuePass ? "Продажа является выбранным результатом; денежная ценность наблюдаема в метаданных или отчёте Метрики." : "Продажа является выбранным результатом, но денежная ценность пока не наблюдаема."
    : resultStage === "QUALIFIED_LEAD" ? "Выбранный результат — квалифицированный лид; выручка после продажи не приписывается этой цели без отдельного доказательства." : "Роль ценности не определена из выбранного результата.";
  const checks = [
    check("EXACT_BINDING", exact ? "PASS" : "FAIL", exact ? "Точный счётчик и цель подтверждены официальным API." : "Точная привязка счётчика и цели не подтверждена.", exact ? null : "Недоступность или несовпадение не считается готовностью."),
    check("GOAL_SEMANTICS", semanticsPass ? "PASS" : semanticsKnown ? "FAIL" : "UNKNOWN", semanticsPass ? `Цель «${goalName}» соответствует выбранному результату «${qualifiedResult}».` : semanticsKnown ? `Цель «${goalName}» не связана достаточно точно с результатом «${qualifiedResult}».` : "Смысл точно привязанной цели нельзя уверенно связать с выбранным результатом.", semanticsKnown ? semanticsPass ? null : `Лексическое соответствие ${(similarity * 100).toFixed(0)}%; произвольная замена цели запрещена.` : "Официальные метаданные или однозначный смысл бизнес-результата недостаточны."),
    check("GOAL_FUNNEL", funnelPass ? "PASS" : funnelKnown ? "FAIL" : "UNKNOWN", funnelPass ? `Цель и бизнес-результат относятся к этапу «${funnelStageLabel(goalStage)}».` : funnelKnown ? `Цель относится к этапу «${funnelStageLabel(goalStage)}», а выбранный результат — к этапу «${funnelStageLabel(resultStage)}».` : "Этап воронки нельзя установить с достаточной уверенностью.", funnelKnown ? null : "Неоднозначный этап является существенной неопределённостью."),
    check("GOAL_DUPLICATION", !duplicationKnown ? "UNKNOWN" : duplicates.length ? "FAIL" : "PASS", duplicates.length ? `Официальный API обнаружил ${duplicates.length + 1} дублирующие цели для одного события.` : duplicationKnown ? "Дублирующая цель для выбранного события не обнаружена." : "Полный каталог целей для проверки дублей недоступен.", duplicates.length ? `Дубли: ${[selectedGoalId, ...duplicates.map((item) => text(item.id, 100))].join(", ")}.` : duplicationKnown ? null : "Недоступность каталога не считается отсутствием дублей."),
    check("RECENT_REACHES", reachesPass ? "PASS" : reaches === null || !reportWindowKnown ? "UNKNOWN" : "FAIL", reachesPass ? `За свежий период наблюдалось ${reaches} достижений.` : "Свежих достижений недостаточно для проверки измеримости.", reaches === null || !reportWindowKnown ? "Недоступность не является нулём." : !reportOfficial ? "Источник отчёта не подтверждён." : reportFresh === "STALE" ? "Отчёт устарел." : reaches < 3 ? "Наблюдение разрежено: менее трёх достижений." : null),
    check("SAMPLING_PRIVACY_LAG", qualityPass ? "PASS" : metadataComplete ? "FAIL" : "UNKNOWN", qualityPass ? "Sampling, privacy и lag не ограничивают текущий отчёт." : "Качество отчёта ограничено sampling, privacy, lag или неизвестными метаданными."),
    check("ATTRIBUTION", attributionPass ? "PASS" : "UNKNOWN", attributionPass ? "Результат связан с точной областью трафика Яндекс Директа через lastDirectClickOrder." : "Атрибуция или точная область трафика отчёта недоступны.", attributionPass ? null : "Без точного измерения и фильтра нельзя приписать результат выбранной рекламе."),
    check("VALUE_REVENUE", valueStatus, valueAssumption, valueStatus === "UNKNOWN" ? "Предположение о ценности может изменить экономический вывод и требует решения." : null),
    check("OFFLINE_READINESS", valueKnown ? "NOT_APPLICABLE" : "UNKNOWN", valueKnown ? "Результат оценивается на выбранном этапе; последующая продажа не приписывается ему без отдельного доказательства по результатам после продажи." : "Неясно, требуется ли сопоставление результата после продажи.", valueKnown ? null : "Неизвестный этап не позволяет определить область результатов после продажи."),
  ];
  const blocking = checks.some((item) => ["FAIL", "UNKNOWN"].includes(item.status));
  const limitations = checks.flatMap((item) => item.limitation ? [item.limitation] : []);
  return {
    status: blocking ? "BLOCKED" as const : "READY" as const,
    checks,
    goal_assessment: {
      business_result: qualifiedResult,
      selected_goal: { goal_id: selectedGoalId, name: goalName, type: goalType, source: text(goal.source, 100) },
      result_funnel_stage: resultStage,
      goal_funnel_stage: goalStage,
      semantic_similarity: similarity,
      duplicate_goal_ids: duplicates.map((item) => text(item.id, 100)),
      alternatives,
      attribution_assumption: attributionPass ? `lastDirectClickOrder; ${trafficFilter}` : "Точная атрибуция не подтверждена.",
      value_assumption: valueAssumption,
    },
    evidence: {
      source: "YANDEX_METRIKA_OFFICIAL_API" as const,
      observed_at: text(provenance.observed_at || metrika.observed_at, 100) || null,
      scope: "Выбранный business result, traffic attribution и exact destination scope",
      freshness: currentFreshness(provenance.observed_at || metrika.observed_at, nowValue, 30),
      confidence: !exact || !providerMetadata ? "UNKNOWN" as const : blocking ? "LIMITED" as const : "HIGH" as const,
      limitations,
    },
  };
}

function tokens(value: unknown) {
  return new Set(String(value ?? "").toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]{4,}/gu) ?? []);
}

function coverage(pageText: string, expected: string) {
  const source = tokens(pageText);
  const target = [...tokens(expected)];
  return target.length ? target.filter((item) => source.has(item)).length / target.length : 0;
}

async function boundedOperation<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("READ_ONLY_INSPECTION_TIMEOUT"), 30_000);
  try {
    const result = await operation(controller.signal);
    if (controller.signal.aborted) throw new Error("READ_ONLY_INSPECTION_TIMEOUT");
    return result;
  } finally {
    clearTimeout(timer);
  }
}

function viewport(device: ServedDeviceScope) {
  return device === "desktop"
    ? { form_factor: device, width: 1920, height: 1080, device_scale_factor: 1 }
    : { form_factor: device, width: 390, height: 844, device_scale_factor: 3 };
}

function validateInspection(raw: LandingPageInspection, policy: ReturnType<typeof createLandingBrowserPolicy>, requestedUrl: string) {
  if (raw.requested_url !== requestedUrl || raw.response_bytes < 0 || raw.response_bytes > policy.profile.maximum_response_bytes) throw new Error("INSPECTION_INVALID");
  if (!Array.isArray(raw.redirect_chain) || raw.redirect_chain.length < 1 || raw.redirect_chain.length > 5) throw new Error("REDIRECT_INVALID");
  for (const request of raw.network_requests) policy.authorizeRequest(request);
  for (const url of raw.redirect_chain) policy.authorizeRequest({ url, method: "GET", resource_type: "document", headers: {}, body_present: false, resolved_addresses: policy.boundAddresses(new URL(url).hostname) });
  policy.authorizeRequest({ url: raw.final_url, method: "GET", resource_type: "document", headers: {}, body_present: false, resolved_addresses: policy.boundAddresses(new URL(raw.final_url).hostname) });
  return raw;
}

function classify(raw: LandingPageInspection, expected: string): DestinationClassification {
  const page = raw.page;
  const accessible = page.http_status >= 200 && page.http_status < 300 && /html/iu.test(page.content_type);
  if (!accessible) return "FUTURE_LANDING_REQUIRED";
  const pageText = [page.title, ...page.headings, page.text_excerpt].join(" ");
  if (coverage(pageText, expected) < 0.25) return "INVALID_UNRELATED";
  return page.ctas.length > 0 || page.forms.length > 0 ? "EXISTING_LANDING" : "EXISTING_BUSINESS_PAGE";
}

async function destinationReadiness(input: {
  requestedUrl: string;
  contextSiteUrl: string;
  expected: string;
  servedDevices: ServedDeviceScope[];
  adapter: ReadinessAdapter;
}) {
  const deviceScopes: MeasurementDestinationReadiness["destination"]["device_scopes"] = input.servedDevices.map((device) => ({
    device, status: "UNAVAILABLE", classification: null, final_url: null, conclusion: "Проверка destination недоступна.", limitations: ["Недоступность не считается готовностью."],
  }));
  const deterministic: MeasurementDestinationReadiness["destination"]["deterministic_observations"] = [];
  const hypotheses: MeasurementDestinationReadiness["destination"]["neural_hypotheses"] = [];
  const base = {
    requested_url: input.requestedUrl,
    adapter: { status: "UNAVAILABLE" as const, contract: "BOUNDED_READ_ONLY_INSPECTION" as const },
    device_scopes: deviceScopes,
    deterministic_observations: deterministic,
    neural_hypotheses: hypotheses,
    priority_corrections: [] as MeasurementDestinationReadiness["destination"]["priority_corrections"],
  };
  if (!input.adapter.availability.available) return { ...base, status: "UNAVAILABLE" as const };
  try {
    const versions = await boundedOperation((signal) => input.adapter.versions(signal));
    if (Object.entries(PINNED_LANDING_TOOL_VERSIONS).some(([key, value]) => versions[key as keyof typeof versions] !== value)) {
      return { ...base, status: "UNAVAILABLE" as const, adapter: { ...base.adapter, status: "PINNED_MISMATCH" as const } };
    }
    for (const [index, device] of input.servedDevices.entries()) {
      const policy = createLandingBrowserPolicy(input.requestedUrl, input.contextSiteUrl);
      for (const host of policy.allowed_hosts) policy.bindHostResolution(host, await boundedOperation((signal) => input.adapter.resolveHostname(host, signal)));
      const inspected = validateInspection(await boundedOperation((signal) => input.adapter.inspect({ url: input.requestedUrl, viewport: viewport(device), policy, signal })), policy, input.requestedUrl);
      const classification = classify(inspected, input.expected);
      const ready = classification === "EXISTING_LANDING";
      deviceScopes[index] = {
        device,
        status: ready ? "READY" : "BLOCKED",
        classification,
        final_url: text(inspected.final_url, 2_000),
        conclusion: ready ? "Существующая релевантная landing готова для этого device scope." : classification === "EXISTING_BUSINESS_PAGE" ? "Страница относится к бизнесу, но не содержит подтверждённого пути к выбранному результату." : classification === "FUTURE_LANDING_REQUIRED" ? "Нужна будущая landing: существующая destination технически не готова." : "Destination не относится к выбранному предложению.",
        limitations: ready ? [] : ["Traffic для этого device scope нельзя считать готовым."],
      };
      deterministic.push({ kind: "DETERMINISTIC_OBSERVATION", device, code: `DESTINATION_${classification}`, conclusion: deviceScopes[index].conclusion });
      for (const item of list(inspected.hypotheses).slice(0, 3)) {
        hypotheses.push({ kind: "NEURAL_HYPOTHESIS", device, conclusion: text(`${record(item).title}. ${record(item).detail}`, 800), limitation: "Требует проверки владельцем; не является наблюдаемым фактом." });
      }
    }
  } catch {
    return { ...base, status: "SAFETY_BLOCKED" as const };
  }
  const correctionCandidates = [
    ...deviceScopes.filter((item) => item.status === "BLOCKED").map((item) => ({ device: item.device, action: item.classification === "EXISTING_BUSINESS_PAGE" ? "Добавить на существующую страницу ясный путь к выбранному результату и затем повторить проверку." : item.classification === "FUTURE_LANDING_REQUIRED" ? "Подготовить отдельную landing по выбранному предложению и результату, затем указать её в Strategy." : "Заменить destination на существующую релевантную страницу выбранного предложения.", basis: "DETERMINISTIC_OBSERVATION" as const })),
    ...hypotheses.map((item) => ({ device: item.device, action: item.conclusion, basis: "NEURAL_HYPOTHESIS" as const })),
  ].slice(0, 3);
  const priorityCorrections = correctionCandidates.map((item, index) => ({ ...item, priority: (index + 1) as 1 | 2 | 3 }));
  return {
    ...base,
    status: deviceScopes.every((item) => item.status === "READY") ? "READY" as const : "BLOCKED" as const,
    adapter: { ...base.adapter, status: "PINNED_MATCH" as const },
    priority_corrections: priorityCorrections,
  };
}

function repairPlan(measurement: MeasurementDestinationReadiness["measurement"], destination: MeasurementDestinationReadiness["destination"]) {
  const actions: MeasurementDestinationReadiness["repair_plan"] = [];
  const failed = new Map(measurement.checks.filter((item) => item.status === "FAIL" || item.status === "UNKNOWN").map((item) => [item.code, item]));
  if (failed.has("GOAL_SEMANTICS") || failed.has("GOAL_FUNNEL") || failed.has("GOAL_DUPLICATION")) actions.push({ priority: actions.length + 1, area: "MEASUREMENT", action: "По подготовленному пакету решения подтвердить одну существующую основную цель, которая точно означает выбранный квалифицированный результат и не дублирует то же событие; если её нет — передать ответственному за сайт готовое задание на настройку измерения.", expected_result: "Одна существующая основная цель с подтверждёнными смыслом, этапом воронки и уникальностью.", owner_or_site_team: true });
  if (failed.has("RECENT_REACHES")) actions.push({ priority: actions.length + 1, area: "MEASUREMENT", action: "Выполнить контролируемую проверку достижения на сайте силами владельца сайта и дождаться свежего отчёта без изменения цели агентом.", expected_result: "Не менее трёх свежих достижений exact-bound цели или честно задокументированная неисправность.", owner_or_site_team: true });
  if ([...failed.keys()].some((code) => !["GOAL_SEMANTICS", "GOAL_FUNNEL", "RECENT_REACHES"].includes(code))) actions.push({ priority: actions.length + 1, area: "MEASUREMENT", action: "Исправить указанные ограничения качества, задержки, привязки результата, ценности или передачи результатов после продажи; затем повторить проверку.", expected_result: "Полный свежий отчёт в нужной области без неизвестных ограничений качества.", owner_or_site_team: true });
  for (const item of destination.priority_corrections) actions.push({ priority: actions.length + 1, area: "DESTINATION", action: item.action, expected_result: `Релевантная существующая landing для ${item.device}.`, owner_or_site_team: true });
  if (["UNAVAILABLE", "SAFETY_BLOCKED"].includes(destination.status)) actions.push({ priority: actions.length + 1, area: "DESTINATION", action: "Восстановить безопасную проверку публичной страницы или заменить небезопасный адрес на публичную страницу бизнеса и повторить проверку.", expected_result: "Наблюдаемые факты о странице для каждого обслуживаемого устройства.", owner_or_site_team: true });
  return actions.slice(0, 6).map((item, index) => ({ ...item, priority: index + 1 }));
}

export async function buildMeasurementDestinationReadiness(input: {
  strategy: Record<string, unknown>;
  context: Record<string, unknown>;
  contextSiteUrl: string;
  servedDevices: ServedDeviceScope[];
  adapter: ReadinessAdapter;
  now(): string;
}): Promise<MeasurementDestinationReadiness> {
  const observedAt = input.now();
  const strategyRevisionId = text(input.strategy.strategy_revision_id, 255);
  if (!strategyRevisionId) throw new Error("Measurement/destination readiness requires exact Strategy revision.");
  const requestedUrl = text(strategyAnswerValue(input.strategy, "landing_page"), 2_000);
  const qualifiedResult = text(strategyAnswerValue(input.strategy, "qualified_result"), 1_000);
  const expected = `${text(strategyAnswerValue(input.strategy, "advertised_offer"), 1_000)} ${text(strategyAnswerValue(input.strategy, "core_message"), 1_000)} ${qualifiedResult}`;
  const servedDevices = [...new Set(input.servedDevices)].filter((item): item is ServedDeviceScope => item === "desktop" || item === "mobile");
  if (!servedDevices.length) throw new Error("At least one served device scope is required.");
  const measurement = measurementChecks(input.context, qualifiedResult, observedAt);
  const destination = await destinationReadiness({ requestedUrl, contextSiteUrl: input.contextSiteUrl, expected, servedDevices, adapter: input.adapter });
  const plan = repairPlan(measurement, destination);
  const limitations = [...new Set([...measurement.evidence.limitations, ...destination.device_scopes.flatMap((item) => item.limitations), ...(destination.status === "UNAVAILABLE" ? ["Проверка destination недоступна; это не ноль и не готовность."] : []), ...(destination.status === "SAFETY_BLOCKED" ? ["Destination inspection остановлена fail-closed политикой сетевой безопасности."] : [])])];
  const materialChecks = measurement.checks.filter((item) => item.status === "UNKNOWN" && ["GOAL_SEMANTICS", "GOAL_FUNNEL", "GOAL_DUPLICATION", "ATTRIBUTION", "VALUE_REVENUE", "OFFLINE_READINESS"].includes(item.code));
  const selectedGoal = measurement.goal_assessment.selected_goal;
  const ambiguousAlternatives = measurement.goal_assessment.alternatives;
  const duplicateIds = measurement.goal_assessment.duplicate_goal_ids;
  const gateRequired = materialChecks.length > 0 || duplicateIds.length > 0
    || (measurement.checks.some((item) => ["GOAL_SEMANTICS", "GOAL_FUNNEL"].includes(item.code) && item.status === "FAIL") && ambiguousAlternatives.length > 0);
  const decisionEvidence = [
    `Выбранный бизнес-результат: «${measurement.goal_assessment.business_result}».`,
    `Точно привязанная цель ${selectedGoal.goal_id}: «${selectedGoal.name}» (${goalTypeLabel(selectedGoal.type)}).`,
    ...materialChecks.map((item) => `${item.conclusion}${item.limitation ? ` ${item.limitation}` : ""}`),
    ...(duplicateIds.length ? [`Официальный API показывает две цели или более для одного события: ${[selectedGoal.goal_id, ...duplicateIds].join(", ")}.`] : []),
    `Предположение об атрибуции: ${measurement.goal_assessment.attribution_assumption}`,
    `Предположение о ценности: ${measurement.goal_assessment.value_assumption}`,
  ];
  const decisionOptions = [
    {
      option: `Сохранить точно привязанную цель «${selectedGoal.name || "без подтверждённого названия"}» (${selectedGoal.goal_id})`,
      consequence: "Допустимо только после подтверждения, что событие действительно означает выбранный квалифицированный результат; до этого черновик кампании остаётся заблокирован.",
    },
    ...ambiguousAlternatives.slice(0, 3).map((candidate) => ({
      option: `Подтвердить существующую цель «${candidate.name}» (${candidate.goal_id}, ${goalTypeLabel(candidate.type)})`,
      consequence: `Потребуется точная серверная привязка и повторная проверка только для чтения; предполагаемый этап «${funnelStageLabel(candidate.funnel_stage)}», смысловое соответствие ${(candidate.semantic_similarity * 100).toFixed(0)}%.`,
    })),
    {
      option: "Не подтверждать ни одну существующую цель и передать готовое задание на измерение команде сайта или аналитики",
      consequence: "Черновик кампании останется заблокирован до появления одной точной недублирующей цели и повторной проверки официальным API.",
    },
  ];
  const unsigned = {
    schema_version: MEASUREMENT_DESTINATION_READINESS_SCHEMA as typeof MEASUREMENT_DESTINATION_READINESS_SCHEMA,
    contract_version: MEASUREMENT_DESTINATION_READINESS_VERSION as typeof MEASUREMENT_DESTINATION_READINESS_VERSION,
    strategy_revision_id: strategyRevisionId,
    observed_at: observedAt,
    status: measurement.status === "READY" && destination.status === "READY" ? "READY" as const : "BLOCKED" as const,
    measurement,
    destination,
    repair_plan: plan,
    human_decision_gate: gateRequired ? {
      reason: "MATERIAL_UNCERTAINTY" as const,
      recommendation: "Не переключать цель автоматически и оставить черновик кампании заблокированным, пока владелец не выберет подготовленный вариант по смыслу бизнес-события.",
      evidence: decisionEvidence,
      confidence: "LIMITED" as const,
      options: decisionOptions,
    } : null,
    limitations,
    external_changes_performed: false as const,
  };
  return { ...unsigned, readiness_id: await hash(unsigned) };
}

export async function verifyMeasurementDestinationReadiness(value: unknown): Promise<boolean> {
  try {
    const item = record(value);
    if (item.schema_version !== MEASUREMENT_DESTINATION_READINESS_SCHEMA || item.contract_version !== MEASUREMENT_DESTINATION_READINESS_VERSION || item.external_changes_performed !== false) return false;
    if (!text(item.strategy_revision_id, 255) || !Number.isFinite(Date.parse(String(item.observed_at ?? "")))) return false;
    const destination = record(item.destination);
    const scopes = list(destination.device_scopes).map(record);
    if (!scopes.length || scopes.some((scope) => !["desktop", "mobile"].includes(String(scope.device)) || !["READY", "BLOCKED", "UNAVAILABLE"].includes(String(scope.status)) || (scope.classification !== null && !["EXISTING_BUSINESS_PAGE", "EXISTING_LANDING", "FUTURE_LANDING_REQUIRED", "INVALID_UNRELATED"].includes(String(scope.classification))))) return false;
    if (list(destination.priority_corrections).length > 3) return false;
    if (list(destination.deterministic_observations).some((entry) => record(entry).kind !== "DETERMINISTIC_OBSERVATION")) return false;
    if (list(destination.neural_hypotheses).some((entry) => record(entry).kind !== "NEURAL_HYPOTHESIS")) return false;
    const unsigned = { ...item };
    delete unsigned.readiness_id;
    return item.readiness_id === await hash(unsigned);
  } catch {
    return false;
  }
}
