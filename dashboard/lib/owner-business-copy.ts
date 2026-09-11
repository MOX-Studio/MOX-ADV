import { requirePublicHttpsUrl } from "./site-url.ts";

/** Public source citations only. Service endpoints and local tools are not owner-facing sources. */
export function businessSourceUrl(value: string): string | null {
  try {
    const url = requirePublicHttpsUrl(value);
    if (/^(?:api|api-metrika|login|oauth|oauth2)(?:[.-]|$)/iu.test(url.hostname)
      || /\/(?:json|api|management|oauth|debug|health|v\d)(?:\/|$)/iu.test(url.pathname)
      || [...url.searchParams.keys()].some(key => /^(?:token|key)$/iu.test(key))) return null;
    return url.href;
  } catch { return null; }
}

const fields: Record<string, string> = {
  business_goal: "цель", campaign_focus: "подход", core_message: "сообщение рекламы", weekly_budget: "бюджет в неделю",
  exclusions: "исключения", geography: "география", period: "период",
  average_sale_value_rub: "средняя ценность продажи", gross_margin_percent: "валовая маржа",
  lead_to_sale_percent: "доля обращений, завершившихся продажей", qualified_result: "подтверждённое обращение",
  company_capabilities: "возможности компании", sales_cycle: "срок сделки", seasonality: "сезонность", qualified_action: "подтверждённое обращение",
  qualified_outcome: "подтверждённый результат", target_audience: "покупатели", advertised_offer: "предложение",
  total_budget_rub: "общий бюджет", target_result_cost: "стоимость обращения", landing_page: "страница предложения",
  source_unavailable: "данные источника недоступны", capacity: "возможность обработать обращения",
};
const statusLabels: Record<string, string> = {
  UNKNOWN: "неизвестно", UNAVAILABLE: "данные недоступны", PARTIAL: "данные получены частично",
  NOT_ASSESSED: "оценка не выполнена", UNASSESSED: "оценка не выполнена", CONDITIONAL: "зависит от условий",
  BLOCKER: "требует решения", BLOCKED_UNKNOWN: "не хватает данных", RESEARCH_REQUIRED: "нужно исследование",
  REWORK_REQUIRED: "нужно доработать", READY_FOR_VALIDATION: "подготовлено к проверке", TEST_ONLY: "тестовые данные",
};

/** Presentation only. Never changes saved evidence, identifiers, ad copy or readiness decisions. */
export function businessText(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.startsWith("{") && trimmed.endsWith("}") || trimmed.startsWith("[") && trimmed.endsWith("]")) return "";
  const clean = String(value ?? "")
    .replace(/В форме задан success_url условий (\d{4})/gu, "В форме настроен переход на условия $1")
    .replace(/success_url(?: формы)?/gu, "адрес перехода после отправки")
    .replace(/Счётчик\s+\d+ установлен/gu, "Счётчик аналитики установлен")
    .replace(/API(?: счётчика и целей)? (?:дал|возвращает) 403/gu, "доступ к аналитике отклонён")
    .replace(/Network connection lost\.?/giu, "Не удалось получить данные источника.")
    .replace(/The exact scope and window are retained from the authenticated provider UI collection\./gu, "Каждое наблюдение относится к указанным региону и периоду.")
    .replace(/Wordstat UI returned a confirmed empty surface; absent rows remain unknown and are not zero demand\./gu, "По этой проверке Wordstat не вернул запросов. Это не означает отсутствия спроса.")
    .replace(/К исходным[^.]*поверхностям[^.]*добавлены[^:]*:\s*/giu, "Дополнительно изучены запросы: ")
    .replace(/Два запроса с кавычками[^.]*точная частота не утверждается\./giu, "Точная частота этих запросов не подтверждена.")
    .replace(/операторные ограничения/giu, "ограничения измерения спроса")
    .replace(/операторные частоты не присвоены без доказательства/giu, "точные частоты указаны только при подтверждении")
    .replace(/эффективные операторные формы/giu, "точные частоты")
    .replace(/;\s*сохранить точный статус каждого наблюдения/giu, "")
    .replace(/Доступная цель Метрики\s+\d+\s+отслеживает отправки форм Tilda в аккаунте других услуг\./giu, "Доступная статистика отражает отправки форм по другим услугам.")
    .replace(/Доступная учёт обращений/giu, "Доступная статистика обращений")
    .replace(/Сопоставимые CPC, ([^.!?]+) не установлены\./gu, "Не установлены цена клика, $1.")
    .replace(/No recoverable first-party evidence span is available\./gu, "Для этого утверждения нет доступной цитаты с сайта.")
    .replace(/Dates belong to the exact statements containing them; do not transfer a historical date, price, guarantee or event edition to another period\./gu, "Условия, цены и гарантии относятся к указанному периоду.")
    .replace(/An independent generic offer sentence does not confirm a future event date, availability or performance result\./gu, "Общее описание предложения не подтверждает будущую дату, наличие мест или результат рекламы.")
    .replace(/подтверждающий фрагмент страницы не сохранился/giu, "для утверждения нет доступной цитаты с сайта")
    .replace(/ниже приведено утверждение из сохранённой записи/giu, "ниже приведён вывод исследования")
    .replace(/:?\s*проверка текущего прогона/giu, "")
    .replace(/Краткое содержание основания не сохранено\.?/giu, "Подтверждающие сведения недоступны.")
    .replace(/Ссылка на весь срез не является отдельным подтверждающим фактом\.?/giu, "Источник относится ко всему исследованию и не подтверждает это утверждение отдельно.")
    .replace(/текст сохранённой записи; фрагмент страницы не восстановлен/giu, "цитату с сайта проверить не удалось")
    .replace(/публичн(?:ый|ого) first-party/giu, "публичный сайт компании")
    .replace(/first-party public/giu, "сайт компании")
    .replace(/\bHTTP\s*(?:401|403)\b/gu, "отказ в доступе")
    .replace(/(?:код(?:ом)?|ответ(?:ом)?|ошибк[аи]|получен)\s*(?:401|403)(?=\s|[.,;:]|$)/giu, "отказ в доступе")
    .replace(/\bHTTP\s*5\d\d\b/gu, "источник временно недоступен")
    .replace(/\b(?:fetch failed|ECONNREFUSED|ETIMEDOUT|ECONNRESET|NETWORK_ERROR|TIMEOUT)\b/giu, "не удалось получить данные источника")
    .replace(/цель Метрики\s+\d+/giu, "учёт обращений")
    .replace(/(?:счётчик|счетчик)\s+\d+/giu, "источник статистики")
    .replace(/\bCRM(?:[-–]связк[аиу])?/giu, "учёт обращений")
    .replace(/\bUTM(?:[-–][а-яё]+)?/giu, "источник обращения")
    .replace(/\bCPC\b/gu, "цена клика").replace(/\bCPA\b/gu, "стоимость обращения")
    .replace(/\bCTR\b/gu, "доля переходов").replace(/\bCR\b/gu, "доля обращений")
    .replace(/\bAPI\b/gu, "источник данных")
    .replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gu, token => fields[token] ?? "")
    .replace(/\b(?:exclusions|geography|period)\b/gu, token => fields[token])
    .replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/gu, token => statusLabels[token] ?? "")
    .replace(/\b(?:UNKNOWN|UNAVAILABLE|PARTIAL|BLOCKER)\b/gu, token => statusLabels[token] ?? "")
    .replace(/(?:urn:mox:[^\s,;]+|sha256:[a-f0-9]+|\b[a-f0-9]{32,}\b)/giu, "")
    .replace(/\b[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\b/giu, "")
    .replace(/\b(?:p0|mox|pipeline)-[a-z0-9-]+-v\d+\b/gu, "")
    .replace(/(?:\/Users\/|\/tmp\/|\/var\/folders\/)[^\s),;]+/gu, "")
    .replace(/(?:^|\n)\s*at\s+[^\n]+/gu, "")
    .replace(/\b(?:F|D|C|G|AD|EXP|P|IMG|SEG|PUBLIC|DIRECT|WORDSTAT|HTML|FRESH)[-_][A-Z0-9][A-Za-z0-9:_-]*\b/gu, "")
    .replace(/https?:\/\/[^\s<>"«»]+/gu, url => businessSourceUrl(url) ? url : "")
    .replace(/\b(?:JSON|SQL|schema_version|source_refs|evidence_refs|snapshot_id|revision_id)\b/giu, "")
    .replace(/(?:snapshot|снапшот|срез исследования|срез источников|текущий срез)/giu, "исследование")
    .replace(/\s*→\s*/gu, " → ");
  const sentences = [...new Intl.Segmenter("ru", { granularity: "sentence" }).segment(clean)].map(item => item.segment.trim());
  return sentences.filter(sentence => sentence && !/^(?:источник данных прочитан[ыо]?\s*:|Автоматическое извлечение|Ошибка исправлена в сборщике|Начальная фаза|Последующая автоматическая фаза|Датированные прежние проверки|Строк в срезе:|Проходов поиска:|Версия (?:схемы|контракта)|Идентификатор|Дайджест|Валидация (?:схемы|графа)|Direct Compiler|Applicability|Account binding)/iu.test(sentence))
    .join(" ").replace(/[ \t]{2,}/gu, " ").replace(/\s+([,.;:])/gu, "$1").replace(/(?:\s*[·|]\s*){2,}/gu, " · ").replace(/^[\s·:;,|-]+|[\s·:;,|-]+$/gu, "").trim();
}

/** Operational failures have a separate owner-safe boundary; arbitrary exception text is never a business explanation. */
export function businessError(value: string | null | undefined): string {
  const raw = value?.trim() ?? "";
  if (/network connection lost|failed to fetch|fetch failed|ECONN|ETIMEDOUT|HTTP\s*5\d\d/iu.test(raw)) return "Не удалось получить данные источника. Можно повторить попытку.";
  if (/\bHTTP\s*(?:401|403)\b|\b(?:unauthorized|forbidden)\b/iu.test(raw)) return "Нет доступа к части необходимых данных.";
  if (!raw || raw.startsWith("{") || raw.startsWith("[") || !/[а-яё]/iu.test(raw)
    || /\b(?:D1|SQLite|TypeError|ReferenceError|SyntaxError|Durable|ENOENT|EACCES|schema|compiler|manifest|stacktrace)\b|version drift|\.(?:tsx?|m?js):\d+|\bat\s+\S+\(/iu.test(raw)) return "Не удалось выполнить действие. Можно повторить попытку.";
  return businessText(raw) || "Не удалось выполнить действие. Можно повторить попытку.";
}
