type JsonRecord = Record<string, unknown>;

export type WordstatFormulationPresentation = {
  phrase: string;
  formulation_role: "PLANNED_FORMULATION" | "RETURNED_TOP_ROW";
  frequency: number | null;
  frequency_label: string;
  status: "AVAILABLE" | "UNAVAILABLE";
  source: "YANDEX_WORDSTAT_V1";
  source_label: "Яндекс Wordstat · официальное API";
  method: string;
  method_label: string;
  operator_profile: string;
  operator_label: string;
  regions: string[];
  device: string;
  scope_label: string;
  observed_at: string | null;
  lower_bound: true;
};

export type WordstatPresentation = {
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  method: string;
  method_label: string;
  window_label: string;
  coverage_label: string;
  formulations: WordstatFormulationPresentation[];
  gaps: string[];
  next_action: string;
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

function finiteFrequency(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function queryWord(value: number) {
  const integer = Math.abs(Math.trunc(value));
  const lastTwo = integer % 100;
  const last = integer % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "запросов";
  if (last === 1) return "запрос";
  if (last >= 2 && last <= 4) return "запроса";
  return "запросов";
}

function frequencyLabel(value: number | null) {
  return value === null ? "Частота недоступна" : `${value.toLocaleString("ru-RU")} ${queryWord(value)}`;
}

const OPERATOR_LABELS: Record<string, string> = {
  BROAD_CONTAINING: "Широкая формулировка",
  FIXED_WORD_COUNT: "Фиксированное число слов",
  FIXED_ORDER_FORM: "Фиксированный порядок слов",
};

const DEVICE_LABELS: Record<string, string> = {
  all: "все устройства",
  desktop: "компьютеры",
  phone: "телефоны",
  tablet: "планшеты",
};

const GAP_LABELS: Record<string, string> = {
  WORDSTAT_AUTHORITY_UNAVAILABLE: "Доступ к Wordstat недоступен.",
  WORDSTAT_ACCESS_DENIED: "Wordstat отклонил доступ к данным.",
  WORDSTAT_QUOTA_EXHAUSTED: "Квота Wordstat исчерпана.",
  WORDSTAT_QUEUE_UNAVAILABLE: "Очередь Wordstat временно недоступна.",
  WORDSTAT_RESPONSE_PARTIAL: "Ответ Wordstat для части формулировок неполон.",
  WORDSTAT_PROVIDER_ERROR: "Wordstat не вернул подтверждённый ответ.",
  WORDSTAT_ROW_COUNT_CONFLICT: "Получены конфликтующие частоты одной формулировки; значение не используется.",
  INCOMPARABLE_WORDSTAT_SCOPES: "Частоты получены в несопоставимых областях и не складываются.",
  WORDSTAT_SCOPE_INVALID: "Область наблюдения Wordstat не подтверждена.",
};

function gapLabels(frequency: JsonRecord) {
  return [...new Set(list(frequency.gaps).map((value) => {
    const code = text(record(value).code);
    return GAP_LABELS[code] ?? "Для части пакета Wordstat частота недоступна.";
  }))];
}

function status(value: unknown): WordstatPresentation["status"] {
  return value === "AVAILABLE" ? "AVAILABLE" : value === "PARTIAL" ? "PARTIAL" : "UNAVAILABLE";
}

function methodLabel(method: string) {
  return method === "/v1/topRequests"
    ? "Популярные запросы Wordstat · /v1/topRequests"
    : "Метод Wordstat недоступен";
}

export function projectWordstatForPresentation(
  frequencyValue: unknown,
  researchPlanValue: unknown,
  fallbackObservedAt?: unknown,
): WordstatPresentation {
  const frequency = record(frequencyValue);
  const plan = record(researchPlanValue);
  const planScope = record(plan.scope);
  const fallbackRegions = list(planScope.regions).map((value) => text(record(value).name)).filter(Boolean);
  const fallbackDevice = text(list(planScope.devices)[0]);
  const counts = new Map(list(frequency.seed_matched_row_counts).map((value) => {
    const item = record(value);
    return [text(item.seed_id), finiteFrequency(item.value)] as const;
  }).filter(([seedId]) => Boolean(seedId)));
  const method = text(frequency.method) || "/v1/topRequests";
  const observedAt = text(frequency.batch_finished_at) || text(fallbackObservedAt) || null;
  const formulation = (input: {
    phrase: unknown;
    formulationRole: WordstatFormulationPresentation["formulation_role"];
    count: unknown;
    operatorProfile?: unknown;
    regions?: unknown;
    device?: unknown;
    observedAt?: unknown;
  }): WordstatFormulationPresentation | null => {
    const phrase = text(input.phrase);
    if (!phrase) return null;
    const count = finiteFrequency(input.count);
    const operatorProfile = text(input.operatorProfile) || "BROAD_CONTAINING";
    const regions = list(input.regions).map(text).filter(Boolean);
    const scopedRegions = regions.length ? regions : fallbackRegions;
    const device = text(input.device) || fallbackDevice || "all";
    return {
      phrase,
      formulation_role: input.formulationRole,
      frequency: count,
      frequency_label: frequencyLabel(count),
      status: count === null ? "UNAVAILABLE" : "AVAILABLE",
      source: "YANDEX_WORDSTAT_V1",
      source_label: "Яндекс Wordstat · официальное API",
      method,
      method_label: methodLabel(method),
      operator_profile: operatorProfile,
      operator_label: OPERATOR_LABELS[operatorProfile] ?? "Профиль формулировки недоступен",
      regions: scopedRegions,
      device,
      scope_label: [...scopedRegions, DEVICE_LABELS[device] ?? "устройство не подтверждено"].join(" · ") || "Область наблюдения недоступна",
      observed_at: text(input.observedAt) || observedAt,
      lower_bound: true,
    };
  };
  const plannedFormulations = list(plan.seeds).map((value) => {
    const seed = record(value);
    return formulation({
      phrase: seed.phrase,
      formulationRole: "PLANNED_FORMULATION",
      count: counts.get(text(seed.seed_id)),
      operatorProfile: seed.operator_profile,
      regions: seed.region_names,
      device: seed.device,
    });
  }).filter((value): value is WordstatFormulationPresentation => value !== null);
  const canonicalFormulations = list(frequency.canonical_observations).map((value) => {
    const observation = record(value);
    return formulation({
      phrase: observation.phrase,
      formulationRole: "RETURNED_TOP_ROW",
      count: observation.count,
      operatorProfile: record(list(frequency.scopes)[0]).operator_profile,
      regions: observation.region_names,
      device: observation.device,
      observedAt: observation.observed_at,
    });
  }).filter((value): value is WordstatFormulationPresentation => value !== null);
  const plannedAvailable = plannedFormulations.some((item) => item.status === "AVAILABLE");
  const formulations = status(frequency.status) === "AVAILABLE" && !plannedAvailable && canonicalFormulations.length
    ? canonicalFormulations.slice(0, 8)
    : plannedFormulations.length ? plannedFormulations : canonicalFormulations.slice(0, 8);
  const available = formulations.filter((item) => item.status === "AVAILABLE").length;
  const gaps = gapLabels(frequency);
  const quotaExhausted = gaps.includes(GAP_LABELS.WORDSTAT_QUOTA_EXHAUSTED);
  const accessUnavailable = gaps.some((gap) => gap === GAP_LABELS.WORDSTAT_AUTHORITY_UNAVAILABLE || gap === GAP_LABELS.WORDSTAT_ACCESS_DENIED);
  const nextAction = available === formulations.length && formulations.length > 0
    ? "Сравнить формулировки по наблюдаемым частотам, сохраняя одинаковую область и ограничения метода."
    : available > 0 || (status(frequency.status) === "PARTIAL" && canonicalFormulations.length > 0)
      ? "Повторить только недоступные формулировки; до повторного наблюдения не считать пробелы нулевым спросом."
      : quotaExhausted
        ? "Повторить сбор после восстановления квоты; до этого спрос по формулировкам остаётся недоступным."
        : accessUnavailable
          ? "Восстановить доступ к Wordstat и повторить пакет; отсутствие частоты не означает нулевой спрос."
          : "Повторить официальный сбор Wordstat; до подтверждённого ответа не делать вывод о величине спроса.";
  return {
    status: status(frequency.status),
    method,
    method_label: methodLabel(method),
    window_label: frequency.declared_window === "rolling_last_30_days"
      ? "Последние 30 дней; точный конец окна API не раскрывает"
      : "Окно наблюдения недоступно",
    coverage_label: `${available} из ${formulations.length} формулировок получили подтверждённую частоту`,
    formulations,
    gaps,
    next_action: nextAction,
  };
}
