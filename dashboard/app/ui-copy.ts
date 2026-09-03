const MACHINE_LABELS: Record<string, string> = {
  ACCEPTED: "Принято",
  ACTIVE: "Активно",
  ACTIVE_APPROVED: "Активно и утверждено",
  ADVISORY_COMPLETE: "Рекомендации готовы",
  AGENT: "Агент",
  AGENT_ACCEPTED: "Принято системой",
  APPROVED: "Утверждено",
  AVAILABLE: "Доступно",
  BLOCKED: "Заблокировано",
  BLOCKED_EVIDENCE_GAP: "Заблокировано из-за пробела в доказательствах",
  BLOCKED_FAIL_CLOSED: "Безопасно заблокировано",
  BLOCKED_UNKNOWN: "Заблокировано из-за неизвестных данных",
  COMPLETE: "Завершено",
  COMPLETED: "Завершено",
  CONFIRMED: "Подтверждено",
  CONFIRMED_SUSPENDED: "Остановка подтверждена",
  CREATED: "Создано",
  CONFLICTING: "Есть противоречия",
  CONTROL: "Контрольный вариант",
  DIRECT_ACCEPTED: "Принято Яндекс Директом",
  EDITING: "Редактируется",
  ELIGIBLE: "Допустимо",
  EVIDENCE_READY_WITH_GAPS: "Доказательства готовы с пробелами",
  FAILED: "Ошибка",
  HIDDEN: "Скрыто",
  HUMAN_GATE_REQUIRED: "Требуется контрольное решение человека",
  HIGH: "Высокая",
  HELD: "Удерживается",
  HYPOTHESIS: "Гипотеза",
  IMPROVEMENT: "Улучшение",
  INSUFFICIENT_EVIDENCE: "Недостаточно доказательств",
  KEEP_REJECTED: "Оставить отклонённым",
  KNOWN: "Известно",
  LOW: "Низкая",
  MATERIAL: "Существенный пробел",
  MEDIUM: "Средняя",
  MODERATION: "На модерации",
  MODERATION_PENDING: "Модерация продолжается",
  NOT_APPLICABLE: "Не применяется",
  NOT_ATTEMPTED: "Не выполнялось",
  NOT_CREATED: "Не создано",
  NOT_EVALUATED: "Не оценено",
  NOT_PRESENT: "Отсутствует",
  OBSERVATION: "Наблюдение",
  OBSERVED: "Наблюдается",
  OUTCOME_UNKNOWN: "Результат неизвестен",
  OWNER_CONFIRMED: "Подтверждено владельцем",
  PACKAGE_REVIEW_REQUIRED: "Требуется проверка пакета",
  PARTIAL: "Частично",
  PASSED: "Пройдено",
  PASS: "Пройдено",
  PASS_AFTER_CORRECTION: "Пройдено после исправления",
  PASS_WITH_PLATFORM_REJECTIONS: "Пройдено с отклонениями площадки",
  PENDING: "Ожидает",
  PREACCEPTED: "Предварительно принято",
  PROVIDER: "Провайдер",
  PROVISIONAL: "Предварительно",
  RANKED: "Место присвоено",
  READY: "Готово",
  RELEASED: "Снята",
  RESOLVED: "Разрешено",
  RESUBMIT: "Повторно отправить",
  RESUBMIT_CORRECTED_REVISION: "Повторно отправить исправленную редакцию",
  READY_TO_RESUBMIT: "Готово к повторной отправке",
  RECONCILIATION_REQUIRED: "Требуется сверка",
  REJECTED: "Отклонено",
  REJECTED_NEEDS_EDIT: "Отклонено — требуется исправление",
  REVIEWED: "Проверено",
  REVIEW_VISIBLE: "Доступно для проверки",
  SAFETY_BLOCKED: "Заблокировано правилами безопасности",
  SERVING_OFF: "Показы отключены",
  SUSPENDED: "Остановлено",
  SYSTEM: "Система",
  STOPPED: "Остановлено",
  STRATEGY_BASELINE_FALLBACK: "Базовый вариант стратегии",
  SYSTEM_FAILED: "Системная ошибка",
  UNAVAILABLE: "Недоступно",
  UNCONFIRMED: "Не подтверждено",
  UNKNOWN: "Неизвестно",
  VALID: "Проверено",
  VERIFIED: "Проверено",
  VISIBLE: "Видимо",
};

const CLASSIFICATION_LABELS: Record<string, string> = {
  CONDITIONALLY_ELIGIBLE: "Доступно при выполнении условия",
  EDITABLE: "Редактируется",
  FIXED_BY_CAPABILITY: "Зафиксировано возможностями аккаунта",
  FIXED_BY_STRATEGY: "Зафиксировано стратегией",
};

const DEVICE_LABELS: Record<string, string> = {
  ALL: "все устройства",
  DESKTOP: "компьютеры",
  MOBILE: "мобильные устройства",
  PHONES: "телефоны",
  TABLETS: "планшеты",
};

export function machineLabel(value: unknown, fallback = "Неизвестно") {
  const normalized = String(value ?? "").trim();
  return normalized ? MACHINE_LABELS[normalized] || normalized : fallback;
}

export function classificationLabel(value: unknown) {
  const normalized = String(value ?? "").trim();
  return CLASSIFICATION_LABELS[normalized] || machineLabel(normalized, "Не указано");
}

export function deviceLabel(value: unknown) {
  const normalized = String(value ?? "").trim();
  return DEVICE_LABELS[normalized.toUpperCase()] || normalized || "устройство не указано";
}

const PROSE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/Яндекс Wordstat · авторизованный интерфейс · интерфейс/giu, "Яндекс Wordstat · авторизованные данные"],
  [/p0-campaign-creation-profile-v1\s*·\s*VALID/giu, "профиль кампании проверен"],
  [/STRATEGY_BASELINE_FALLBACK/gu, "базовый вариант стратегии"],
  [/Нет material changes: нормализация не создала Draft revision\./giu, "Нет существенных изменений: нормализация не создала редакцию черновика кампании."],
  [/Создана новая immutable Draft revision/giu, "Создана новая неизменяемая редакция черновика кампании"],
  [/Comparative score changed through disclosed weighted dimensions\./giu, "Сравнительная оценка изменилась через раскрытые взвешенные измерения."],
  [/Demand unavailable, not zero/giu, "Спрос недоступен, но не равен нулю"],
  [/Resolve Direct evidence/giu, "Устраните пробел в доказательствах Яндекс Директа"],
  [/AUTOTARGETING requires persisted official API and exact account eligibility evidence\./giu, "Автотаргетинг требует сохранённых данных из официального программного интерфейса и проверки выбранного аккаунта."],
  [/Campaign Draft requires persisted official API evidence and exact account binding\./giu, "Черновик кампании требует сохранённых данных из официального программного интерфейса и точной привязки аккаунта."],
  [/Analytics Evidence Snapshot/giu, "срез аналитических данных"],
  [/Financial Competitor Intelligence/giu, "данные о конкурентах и ценах"],
  [/Campaign Design Agent/giu, "система подготовки кампаний"],
  [/Strategy Agent/giu, "система подготовки стратегии"],
  [/Evidence Agent/giu, "система проверки данных"],
  [/Campaign Playbook/giu, "база правил кампаний"],
  [/Knowledge Steward/giu, "проверяющая система"],
  [/Campaign Strategy/giu, "стратегия кампании"],
  [/Campaign Hypothesis/giu, "гипотеза кампании"],
  [/Campaign Drafts/giu, "черновики кампаний"],
  [/Campaign Draft/giu, "черновик кампании"],
  [/\bDrafts\b/giu, "черновики"],
  [/\bDraft\b/giu, "черновик"],
  [/\bHypothesis\b/giu, "гипотеза"],
  [/event-менеджер(?:ы|ами|ов)?/giu, "организаторы мероприятий"],
  [/Recommendation Set/giu, "набор рекомендаций"],
  [/LandingAdvisoryRun/giu, "запуск рекомендаций по посадочной странице"],
  [/Human Decision Gate/giu, "контрольное решение человека"],
  [/StatusClarification/giu, "пояснение состояния"],
  [/first-party/giu, "собственного сайта"],
  [/business-owned/giu, "задаваемый владельцем"],
  [/publish readiness/giu, "готовность к публикации"],
  [/publish projection/giu, "проекция публикации"],
  [/publication blockers?/giu, "блокирующие причины публикации"],
  [/provider responses?/giu, "ответы провайдера"],
  [/provider issues?/giu, "замечания провайдера"],
  [/pre-launch/giu, "до запуска"],
  [/post-launch/giu, "после запуска"],
  [/fail[- ]closed/giu, "безопасно заблокировано"],
  [/hard blockers?/giu, "жёсткие блокирующие причины"],
  [/required evidence gaps?/giu, "обязательные пробелы в доказательствах"],
  [/manual[- ]review/giu, "ручная проверка"],
  [/tool runs?/giu, "запуски инструментов"],
  [/headless Playwright UI/giu, "интерфейс"],
  [/headless Playwright/giu, "интерфейс"],
  [/Яндекс Wordstat · авторизованный интерфейс · интерфейс/giu, "Яндекс Wordstat · авторизованные данные"],
  [/Яндекс Wordstat · авторизованные данные · интерфейс/giu, "Яндекс Wordstat · авторизованные данные"],
  [/Яндекс Wordstat · авторизованный интерфейс/giu, "Яндекс Wordstat · авторизованные данные"],
  [/Популярные запросы Wordstat · интерфейс/giu, "Популярные запросы Wordstat · данные"],
  [/подтверждено интерфейсом Wordstat/giu, "подтверждено данными Wordstat"],
  [/official API/giu, "официальный программный интерфейс"],
  [/readback/giu, "обратная проверка"],
  [/lineage/giu, "происхождение"],
  [/fingerprints?/giu, "отпечатки"],
  [/shortlist/giu, "список"],
  [/confirmation/giu, "подтверждение"],
  [/capability profile/giu, "профиль возможностей"],
  [/capability/giu, "возможность"],
  [/playbook/giu, "свод правил"],
  [/release/giu, "версия"],
  [/snapshot/giu, "срез данных"],
  [/scope/giu, "область"],
  [/correction/giu, "исправление"],
  [/reconciliation/giu, "сверка"],
  [/moderation/giu, "модерация"],
  [/immutable/giu, "неизменяемый"],
  [/material/giu, "существенный"],
  [/persisted/giu, "сохранённый"],
  [/bounded/giu, "ограниченный"],
  [/official/giu, "официальный"],
  [/account binding/giu, "привязка аккаунта"],
  [/account/giu, "аккаунт"],
  [/provider/giu, "провайдер"],
  [/evidence/giu, "доказательства"],
  [/review/giu, "проверка"],
  [/publish/giu, "публикация"],
  [/score/giu, "оценка"],
  [/rank/giu, "место"],
  [/dispatch/giu, "отправка"],
  [/outcome/giu, "результат"],
  [/changes?/giu, "изменения"],
  [/versioned/giu, "версионный"],
  [/revision/giu, "редакция"],
  [/\bStrategy\b/gu, "стратегия"],
  [/\bVALID\b/gu, "проверено"],
  [/status/giu, "состояние"],
  [/current/giu, "текущий"],
  [/exact/giu, "точный"],
  [/Direct/gu, "Яндекс Директ"],
  [/Metrika/gu, "Метрика"],
];

export function localizedText(value: unknown) {
  return PROSE_REPLACEMENTS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), String(value ?? ""));
}

const OWNER_FIELD_LABELS: Record<string, string> = {
  ad_text: "Текст объявления",
  ad_title: "Заголовок объявления",
  advertised_offer: "Предложение",
  audience: "Аудитория",
  business_goal: "Цель бизнеса",
  campaign_focus: "Что продвигаем",
  campaign_name: "Название кампании",
  core_message: "Главное сообщение",
  exclusions: "Исключения",
  geography: "География",
  group_name: "Название группы",
  keyword: "Ключевая фраза",
  landing_page: "Посадочная страница",
  measurement_goal: "Цель измерения",
  negative_keywords: "Минус-слова",
  offer: "Предложение",
  period: "Период",
  product: "Продукт",
  qualified_result: "Целевое действие",
  target_audience: "Аудитория",
  target_result_cost: "Целевая стоимость результата",
  weekly_budget: "Недельный бюджет",
};

export function ownerFieldLabel(value: unknown) {
  const normalized = String(value ?? "").trim();
  return OWNER_FIELD_LABELS[normalized] || localizedText(normalized.replaceAll("_", " "));
}

export function ownerDate(value: unknown) {
  const normalized = String(value ?? "").trim();
  const date = new Date(normalized);
  return normalized && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date)
    : normalized || "Не указано";
}

export function ownerValue(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record.start_date || record.end_date) return `${String(record.start_date ?? "Не указано")} — ${String(record.end_date ?? "Не указано")}`;
  }
  return localizedText(Array.isArray(value) ? value.join(" · ") : String(value ?? "Не подтверждено"));
}

export function fieldRegistryLabel(value: unknown) {
  return String(value ?? "").replace(/, micros$/u, ", микрорубли");
}

export function fieldRegistryReason(value: unknown) {
  return {
    "Значение зафиксировано утверждённой Campaign Strategy.": "Значение зафиксировано утверждённой стратегией кампании.",
    "Значение зафиксировано принятым Direct v501 capability profile.": "Значение зафиксировано принятым профилем возможностей Яндекс Директа API v501.",
    "Поле отсутствует: требуется отдельная official API и exact-account capability eligibility.": "Поле отсутствует: требуется отдельная проверка официального API и возможностей точного аккаунта.",
    "Изменение публикуется в точную Direct projection.": "Изменение публикуется в точную проекцию Яндекс Директа.",
  }[String(value ?? "")] || String(value ?? "");
}

export function yesNoLabel(value: unknown) {
  return value === true || value === "true" ? "да" : "нет";
}
