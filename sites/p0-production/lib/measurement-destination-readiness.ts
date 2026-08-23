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
  code: "EXACT_BINDING" | "GOAL_SEMANTICS" | "GOAL_FUNNEL" | "RECENT_REACHES" | "SAMPLING_PRIVACY_LAG" | "ATTRIBUTION" | "VALUE_REVENUE" | "OFFLINE_READINESS";
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

function measurementChecks(context: Record<string, unknown>, qualifiedResult: string, nowValue: string) {
  const metrika = record(context.metrika);
  const binding = record(metrika.binding);
  const goalBinding = record(metrika.goal_binding);
  const goal = record(metrika.goal_definition);
  const performance = record(context.performance);
  const display = record(performance.display_metrics);
  const provenance = record(performance.provenance);
  const sampling = record(provenance.sampling);
  const valueTracking = record(metrika.value_tracking);
  const offline = record(metrika.offline_conversion);
  const exact = metrika.ready === true
    && metrika.authority === "VERIFIED"
    && metrika.access === "YANDEX_METRIKA_MANAGEMENT_AND_REPORTS_API"
    && binding.matched === true && goalBinding.matched === true
    && text(binding.expected_counter_id, 100) === text(metrika.counter_id, 100)
    && text(binding.api_counter_id, 100) === text(metrika.counter_id, 100)
    && text(goalBinding.expected_goal_id, 100) === text(metrika.goal_id, 100)
    && text(goalBinding.api_goal_id, 100) === text(metrika.goal_id, 100);
  const goalName = text(goal.name, 500).toLowerCase();
  const resultTokens = qualifiedResult.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  const overlap = resultTokens.length ? resultTokens.filter((token) => goalName.includes(token)).length / resultTokens.length : 0;
  const semanticsKnown = Boolean(goalName && goal.type && goal.semantic_role);
  const semanticsPass = semanticsKnown && goal.semantic_role === "PRIMARY_BUSINESS_RESULT" && overlap >= 0.15;
  const funnelKnown = typeof goal.funnel_complete === "boolean" && Boolean(goal.funnel_stage);
  const funnelPass = funnelKnown && goal.funnel_complete === true && !["AWARENESS", "MICRO_CONVERSION"].includes(String(goal.funnel_stage));
  const reaches = metric(display.goal_visits);
  const reportOfficial = provenance.source_kind === "METRIKA_REPORTS_API";
  const reportWindowKnown = Boolean(text(performance.period_start, 20) && text(performance.period_end, 20));
  const reportFresh = currentFreshness(provenance.observed_at ?? performance.period_end, nowValue, 30);
  const reachesPass = reportOfficial && reportWindowKnown && reaches !== null && reaches >= 3 && reportFresh === "CURRENT";
  const metadataComplete = sampling.metadata_complete === true || ["sampled", "contains_sensitive_data", "sample_share", "sample_size", "sample_space", "data_lag"].every((key) => Object.hasOwn(sampling, key));
  const qualityPass = reportOfficial && metadataComplete && sampling.sampled === false && sampling.contains_sensitive_data === false && Number(sampling.data_lag) === 0;
  const attribution = text(provenance.attribution, 200);
  const attributionPass = reportOfficial && attribution.length > 0 && attribution !== "unspecified" && list(provenance.dimensions).length > 0 && text(provenance.filters, 1_000).length > 0;
  const valueRelevanceKnown = typeof valueTracking.relevant === "boolean";
  const valueRelevant = valueTracking.relevant === true;
  const valuePass = valueRelevanceKnown && (!valueRelevant || (reportOfficial && valueTracking.status === "READY" && Boolean(text(valueTracking.currency, 20)) && metric(display.goal_value) !== null));
  const offlineRelevanceKnown = typeof offline.relevant === "boolean";
  const offlineRelevant = offline.relevant === true;
  const offlinePass = offlineRelevanceKnown && (!offlineRelevant || offline.status === "READY");
  const checks = [
    check("EXACT_BINDING", exact ? "PASS" : "FAIL", exact ? "Точный счётчик и цель подтверждены официальным API." : "Точная привязка счётчика и цели не подтверждена.", exact ? null : "Недоступность или несовпадение не считается готовностью."),
    check("GOAL_SEMANTICS", semanticsPass ? "PASS" : semanticsKnown ? "FAIL" : "UNKNOWN", semanticsPass ? "Основная цель соответствует выбранному бизнес-результату." : "Смысл цели не подтверждает выбранный основной результат.", semanticsKnown ? null : "Название, тип или роль цели недоступны."),
    check("GOAL_FUNNEL", funnelPass ? "PASS" : funnelKnown ? "FAIL" : "UNKNOWN", funnelPass ? "Цель занимает подходящий этап воронки." : "Воронка цели не подтверждена для квалифицированного результата.", funnelKnown ? null : "Этап или полнота воронки недоступны."),
    check("RECENT_REACHES", reachesPass ? "PASS" : reaches === null || !reportWindowKnown ? "UNKNOWN" : "FAIL", reachesPass ? `За свежий период наблюдалось ${reaches} достижений.` : "Свежих достижений недостаточно для проверки измеримости.", reaches === null || !reportWindowKnown ? "Недоступность не является нулём." : !reportOfficial ? "Источник отчёта не подтверждён." : reportFresh === "STALE" ? "Отчёт устарел." : reaches < 3 ? "Наблюдение разрежено: менее трёх достижений." : null),
    check("SAMPLING_PRIVACY_LAG", qualityPass ? "PASS" : metadataComplete ? "FAIL" : "UNKNOWN", qualityPass ? "Sampling, privacy и lag не ограничивают текущий отчёт." : "Качество отчёта ограничено sampling, privacy, lag или неизвестными метаданными."),
    check("ATTRIBUTION", attributionPass ? "PASS" : "UNKNOWN", attributionPass ? "Attribution и точный traffic filter сохранены." : "Attribution или traffic scope отчёта недоступны."),
    check("VALUE_REVENUE", !valueRelevanceKnown ? "UNKNOWN" : valueRelevant ? valuePass ? "PASS" : "FAIL" : "NOT_APPLICABLE", !valueRelevanceKnown ? "Релевантность ценности и выручки не определена." : valueRelevant ? valuePass ? "Ценность результата наблюдаема в выбранной валюте." : "Ценность или выручка результата не готовы." : "Ценность результата не требуется для выбранной measurement-схемы."),
    check("OFFLINE_READINESS", !offlineRelevanceKnown ? "UNKNOWN" : offlineRelevant ? offlinePass ? "PASS" : "FAIL" : "NOT_APPLICABLE", !offlineRelevanceKnown ? "Релевантность результатов после продажи не определена." : offlineRelevant ? offlinePass ? "Релевантные offline results готовы к сопоставлению." : "Релевантные offline results не готовы." : "Offline measurement не требуется для выбранного результата."),
  ];
  const blocking = checks.some((item) => ["FAIL", "UNKNOWN"].includes(item.status));
  const limitations = checks.flatMap((item) => item.limitation ? [item.limitation] : []);
  return {
    status: blocking ? "BLOCKED" as const : "READY" as const,
    checks,
    evidence: {
      source: "YANDEX_METRIKA_OFFICIAL_API" as const,
      observed_at: text(provenance.observed_at || metrika.observed_at, 100) || null,
      scope: "Выбранный business result, traffic attribution и exact destination scope",
      freshness: currentFreshness(provenance.observed_at || metrika.observed_at, nowValue, 30),
      confidence: !exact || !semanticsKnown ? "UNKNOWN" as const : blocking ? "LIMITED" as const : "HIGH" as const,
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
  if (failed.has("GOAL_SEMANTICS") || failed.has("GOAL_FUNNEL")) actions.push({ priority: actions.length + 1, area: "MEASUREMENT", action: "Выбрать существующую основную цель, которая точно означает выбранный квалифицированный результат; если её нет — передать ответственному за сайт подготовленное задание на настройку измерения.", expected_result: "Существующая основная цель с подтверждённым смыслом и этапом воронки.", owner_or_site_team: true });
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
  const gateRequired = measurement.checks.some((item) => item.status === "UNKNOWN" && ["GOAL_SEMANTICS", "GOAL_FUNNEL", "VALUE_REVENUE", "OFFLINE_READINESS"].includes(item.code));
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
      recommendation: "Сначала подтвердить смысл существующей основной цели и подготовить instrumentation brief; не разрешать traffic до повторной проверки.",
      evidence: measurement.checks.filter((item) => item.status === "UNKNOWN").map((item) => item.conclusion),
      confidence: "LIMITED" as const,
      options: [
        { option: "Подтвердить подходящую существующую цель", consequence: "Агент повторит read-only проверку без создания цели." },
        { option: "Передать подготовленный instrumentation brief site/analytics team", consequence: "Draft останется заблокирован до появления проверяемых достижений." },
      ],
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
