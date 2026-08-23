import {
  P0Application,
  P0ApplicationError,
} from "./p0-application.ts";
import { BUSINESS_MODEL_FIELD_ORDER } from "./business-model-contract.ts";
import type { P0AgentOwnerProjection } from "./p0-agent-runtime.ts";
import { buildOwnerPublishPreview } from "./campaign-creation-profile.ts";
import {
  type AccessReadinessProjection,
  type AccessReadinessService,
  type AccessReadinessState,
} from "./access-readiness.ts";

export const OWNER_JOURNEY_STAGES = [
  { id: "goal", label: "Цель" },
  { id: "findings", label: "Что узнал агент" },
  { id: "strategy", label: "Стратегия" },
  { id: "campaigns", label: "Кампании" },
  { id: "review", label: "Проверка и создание" },
] as const;

export type OwnerJourneyStageId = typeof OWNER_JOURNEY_STAGES[number]["id"];
export type OwnerCardKind = "agent-activity" | "finding" | "problem" | "human-decision-gate";

export type OwnerActionField = {
  key: string;
  label: string;
  control: "text" | "url" | "textarea" | "number" | "date" | "select";
  value: string | number;
  required: boolean;
  options?: Array<string | { value: string; label: string }>;
  help?: string;
  readOnly?: boolean;
};

export type OwnerJourneyProjection = {
  accessReadiness: AccessReadinessProjection | null;
  journey: {
    stages: Array<{ id: OwnerJourneyStageId; label: string; status: "complete" | "current" | "upcoming" }>;
    currentStage: OwnerJourneyStageId;
  };
  introduction?: {
    title: string;
    body: string;
  };
  businessOutcome: {
    status: "ready" | "working" | "blocked" | "complete";
    headline: string;
    summary: string;
  };
  currentRecommendation: {
    headline: string;
    rationale: string;
  } | null;
  competitorMatrix: {
    status: "Доступно" | "Частично" | "Недоступно";
    competitorSetRule: string;
    candidates: Array<{ competitor: string; rationale: string; exactDestinations: string[] }>;
    rows: Array<{
      competitor: string;
      productsServices: string;
      observedOfferMessage: string;
      publishedPrice: string;
      exactLanding: string;
      source: string;
      geography: string;
      device: string;
      observationDate: string;
      adVisibilitySample: string;
    }>;
    aggregateClaims: Array<{ claim: string; scope: string; result: string; limitation: string }>;
    limitations: string[];
  } | null;
  demandCostResearch: {
    demand: {
      status: "Доступно" | "Частично" | "Недоступно";
      conclusion: string;
      source: string;
      observedAt: string;
      scope: string;
      formulations: Array<{ category: string; phrase: string; status: "Запланировано" | "Недоступно" }>;
      seasonality: string;
      limitation: string;
    };
    cost: {
      status: "Доступно" | "Недоступно";
      range: string;
      source: string;
      observedAt: string;
      currency: string;
      vat: string;
      sample: string;
      scope: string;
      limitation: string;
    };
  } | null;
  businessModel: {
    fields: Array<{
      label: string;
      value: string;
      availability: "Доступно" | "Недоступно";
      provenance: string;
      observedAt: string;
      freshness: string;
      confidence: string;
      limitation: string;
      assumption: string;
    }>;
    economics: {
      status: "Подтверждена" | "Существенная неопределённость";
      targetResultCost: string;
      explanation: string;
    };
    materialQuestions: Array<{ question: string; consequence: string }>;
  } | null;
  campaignStrategy: {
    status: "Готова к решению" | "Нужны существенные решения";
    recommendations: Array<{
      label: string;
      value: string;
      rationale: string;
      confidence: string;
    }>;
    materialQuestions: Array<{ field: string; question: string; recommendation: string; consequences: string }>;
    decisionGate: null | {
      recommendation: string;
      evidence: string;
      confidence: string;
      alternatives: string;
      consequences: string;
    };
  } | null;
  appliedPractice: {
    practice: string;
    limitation: string;
  } | null;
  businessReadiness: {
    status: "Готово" | "Заблокировано";
    measurement: {
      status: "Готово" | "Заблокировано";
      summary: string;
      checks: Array<{ label: string; result: string; limitation: string }>;
    };
    destination: {
      status: "Готово" | "Заблокировано" | "Недоступно";
      scopes: Array<{ device: string; classification: string; conclusion: string }>;
      priorityCorrections: Array<{ priority: number; action: string; basis: "Наблюдение" | "Гипотеза" }>;
    };
    repairPlan: Array<{ priority: number; action: string; expectedResult: string }>;
    decisionGate: null | { recommendation: string; evidence: string; options: string };
    limitations: string[];
  } | null;
  materialUnknowns: string[];
  agentActivity: {
    status: P0AgentOwnerProjection["status"];
    completed: number;
    total: number;
    summary: string;
    nextBusinessStep: string;
  } | null;
  cards: Array<{
    kind: OwnerCardKind;
    title: string;
    body: string;
    facts?: Array<{ label: string; value: string }>;
  }>;
  campaignOptions: Array<{
    name: string;
    audience: string;
    offer: string;
    destination: string;
    status: "VIABLE" | "TESTABLE_WITH_GAPS" | "INSUFFICIENT_EVIDENCE" | "BLOCKED";
    readiness: "Готова к проверке" | "Есть существенные пробелы" | "Недостаточно доказательств" | "Заблокирована";
    comparativeScore: string;
    evidenceCoverage: string;
    sensitivity: string;
    reasons: string[];
    publishPreview: {
      titles: string[];
      texts: string[];
      urls: Array<{ landing: string; tracking: string }>;
      creativeCombinations: Array<{ title: string; text: string; landing: string; tracking: string }>;
      requiredDisclaimers: string[];
      creativeProvenance: { family: string; source: string; rights: string };
    };
    selected: boolean;
    agentRecommended: boolean;
  }>;
  packageSummary: {
    campaignCount: number;
    preflight: string;
    execution: string;
    outcomes: Array<{ campaign: string; outcome: string }>;
  } | null;
  primaryAction: {
    handle: string;
    label: string;
    description: string;
    fields: OwnerActionField[];
  } | null;
  roadmap: Array<{
    label: string;
    horizon: string;
    interactive: false;
  }>;
};

export type OwnerActionSubmission = {
  handle: string;
  values?: Record<string, unknown>;
};

type InternalView = Awaited<ReturnType<P0Application["query"]>>;
type InternalState = InternalView["state"];

type ActionKind =
  | "choose-access-path"
  | "grant-access-consent"
  | "select-access-binding"
  | "confirm-access-readiness"
  | "analyze-business"
  | "confirm-goal"
  | "confirm-business-model"
  | "approve-strategy"
  | "prepare-package"
  | "review-package"
  | "authorize-and-create"
  | "start-correction"
  | "save-correction"
  | "authorize-correction";

type InternalActionDescriptor = {
  kind: ActionKind;
  label: string;
  description: string;
  fields: OwnerActionField[];
  target?: string;
};

const ROADMAP: OwnerJourneyProjection["roadmap"] = [
  { label: "Управление", horizon: "P1", interactive: false },
  { label: "Мониторинг", horizon: "P2", interactive: false },
  { label: "SEO", horizon: "P3", interactive: false },
  { label: "VK", horizon: "Будущий канал", interactive: false },
];

const FORBIDDEN_TECHNICAL_TEXT = [
  /sha-?256:[a-f0-9]+/giu,
  /\b(?:schema|contract)[_ -]?(?:version|name)\b/giu,
  /\b(?:revision|fingerprint|hash|journal|raw payload|tool trace|error code)\b/giu,
  /\b(?:run[_ -]?id|checkpoint|retry|poll(?:ing)?|tool names?)\b/giu,
  /\bp0_[a-z0-9_]+\b/giu,
  /\b(?:campaigns|adgroups|keywords|ads|clients|dictionaries)\.(?:get|add|update|suspend|moderate|resume)\b/giu,
];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function ownerText(value: unknown, fallback = "Не указано", maximum = 600) {
  let text = String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  for (const pattern of FORBIDDEN_TECHNICAL_TEXT) text = text.replace(pattern, "техническая деталь");
  text = text.replace(/\b[A-Z][A-Z0-9_]{3,}\b/gu, "").replace(/\s+·\s*$/u, "").replace(/\s+/gu, " ");
  text = text.slice(0, maximum).trim();
  return text || fallback;
}

function answerValue(state: InternalState, fieldId: string): unknown {
  const answers = list(record(state.strategy).answers);
  return record(answers.find((answer) => record(answer).field_id === fieldId)).value;
}

function questionnaireValue(state: InternalState, fieldId: string): unknown {
  const fields = list(record(state.strategy_questionnaire).fields);
  return record(fields.find((field) => record(field).field_id === fieldId)).recommended_value;
}

function currentStage(state: InternalState): OwnerJourneyStageId {
  if (state.package_review) return "review";
  if (state.strategy) return "campaigns";
  if (record(state.business_model).source === "REAL_SITE_RESEARCH_PLUS_OWNER_CONFIRMATION") return "strategy";
  if (state.business_model) return "findings";
  return "goal";
}

function goalFields(state: InternalState): OwnerActionField[] {
  if (!state.context_state) {
    return [{
      key: "website",
      label: "Сайт или адрес компании",
      control: "url",
      value: ownerText(record(state.site_analysis).url, "", 1_500),
      required: true,
      help: "Агент сам соберёт доступные факты и предложит бизнес-цель.",
    }];
  }
  const context = record(state.context_state);
  const decision = record(context.business_goal_decision);
  const provisional = record(context.provisional_business_goal);
  return [{
    key: "goal",
    label: "Бизнес-цель",
    control: "textarea",
    value: ownerText(decision.value ?? provisional.value, "", 500),
    required: true,
    help: "Исправьте только если предложенный результат не соответствует бизнесу.",
  }];
}

const BUSINESS_MODEL_INPUTS = [
  { key: "product", field: "product", label: "Что рекламируем", required: true },
  { key: "value", field: "value", label: "Почему это ценно", required: true },
  { key: "qualifiedResult", field: "qualified_outcome", label: "Какой результат считаем качественным", required: true },
  { key: "customerContext", field: "customer_context", label: "Клиент и его контекст", required: true },
  { key: "buyingContext", field: "buying_context", label: "Кто и как принимает решение о покупке" },
  { key: "revenueModel", field: "revenue_model", label: "Модель выручки" },
  { key: "salesCycle", field: "sales_cycle", label: "Цикл продажи" },
  { key: "averageSaleValueRub", field: "average_sale_value_rub", label: "Средняя ценность продажи, ₽", control: "number" },
  { key: "grossMarginPercent", field: "gross_margin_percent", label: "Валовая маржа, %", control: "number" },
  { key: "leadToSalePercent", field: "lead_to_sale_percent", label: "Доля обращений, переходящих в продажу, %", control: "number" },
  { key: "capacity", field: "capacity", label: "Мощность обработки новых результатов" },
  { key: "seasonality", field: "seasonality", label: "Сезонность" },
  { key: "geography", field: "geography", label: "География обслуживания" },
  { key: "exclusions", field: "exclusions", label: "Что не считаем результатом", required: true },
  { key: "keyConstraints", field: "key_constraints", label: "Ключевые ограничения" },
] as const;

function businessModelFields(state: InternalState): OwnerActionField[] {
  const model = record(state.business_model);
  const contract = record(model.owner_contract);
  const contractFields = record(contract.fields);
  const questions = list(contract.questions).map(record);
  return BUSINESS_MODEL_INPUTS.map((input) => {
    const contractField = record(contractFields[input.field]);
    const value = input.field === "product" || input.field === "value"
      ? model[input.field]
      : contractField.value;
    const question = questions.find((item) => item.field === input.field);
    return {
      key: input.key,
      label: input.label,
      control: "control" in input ? input.control : "textarea" as const,
      value: typeof value === "number" ? value : ownerText(value, "", 1_000),
      required: "required" in input && input.required === true,
      ...(question ? { help: `${ownerText(question.question)} ${ownerText(question.why_material)}` } : {}),
    };
  });
}

function strategyFields(state: InternalState): OwnerActionField[] {
  const value = (fieldId: string) => answerValue(state, fieldId) ?? questionnaireValue(state, fieldId) ?? "";
  const period = record(value("period"));
  return [
    { key: "businessGoal", label: "Бизнес-цель", control: "textarea" as const, value: ownerText(value("business_goal"), "", 500), required: true },
    { key: "campaignFocus", label: "Рекламный фокус", control: "textarea" as const, value: ownerText(value("campaign_focus"), "", 1_000), required: true },
    { key: "offer", label: "Предложение", control: "textarea" as const, value: ownerText(value("advertised_offer"), "", 1_000), required: true },
    { key: "audience", label: "Аудитория", control: "textarea" as const, value: ownerText(value("target_audience"), "", 1_000), required: true },
    { key: "qualifiedResult", label: "Качественный результат", control: "textarea" as const, value: ownerText(value("qualified_result"), "", 1_000), required: true },
    { key: "exclusions", label: "Исключения", control: "textarea" as const, value: ownerText(value("exclusions"), "", 1_000), required: true },
    { key: "geography", label: "География", control: "textarea" as const, value: ownerText(value("geography"), "", 255), required: true },
    { key: "periodStart", label: "Начало периода", control: "date" as const, value: ownerText(period.start_date, "", 20), required: true },
    { key: "periodEnd", label: "Окончание периода", control: "date" as const, value: ownerText(period.end_date, "", 20), required: true },
    { key: "landingPage", label: "Куда вести клиента", control: "url" as const, value: ownerText(value("landing_page"), "", 1_500), required: true },
    { key: "weeklyBudget", label: "Бюджет на неделю, ₽", control: "number" as const, value: Number(value("weekly_budget")) || "", required: true },
    {
      key: "targetResultCost",
      label: "Целевая стоимость результата, ₽",
      control: "number" as const,
      value: Number(value("target_result_cost")) || "",
      required: false,
      help: Number(value("target_result_cost")) > 0
        ? "Рекомендовано из economics Business Model; измените, только если бизнес-предел отличается."
        : "Оставьте пустым, если economics остаётся существенной неопределённостью.",
    },
    { key: "message", label: "Главное сообщение", control: "textarea" as const, value: ownerText(value("core_message"), "", 1_000), required: true },
  ];
}

function allowed(view: InternalView, command: string) {
  return view.workflow.allowed_commands.includes(command as never);
}

function correctionWithStatus(state: InternalState, status: string) {
  return state.package_corrections.find((item) => item.status === status) ?? null;
}

function orderedShortlistCandidates(view: InternalView) {
  const recommendationSet = record(view.state.recommendation_set);
  const recommendedIds = list(record(recommendationSet.recommended_shortlist).draft_ids).map(String);
  const controls = view.shortlist_controls.filter((item) => item.status !== "BLOCKED");
  return [...controls].sort((left, right) => {
    const leftIndex = recommendedIds.indexOf(left.draft_id);
    const rightIndex = recommendedIds.indexOf(right.draft_id);
    return (leftIndex < 0 ? Number.POSITIVE_INFINITY : leftIndex) - (rightIndex < 0 ? Number.POSITIVE_INFINITY : rightIndex)
      || left.draft_id.localeCompare(right.draft_id);
  });
}

function actionDescriptor(view: InternalView): InternalActionDescriptor | null {
  const state = view.state;
  if (!state.context_state) {
    return {
      kind: "analyze-business",
      label: "Исследовать бизнес и предложить цель",
      description: "Агент проверит доступный контекст и вернётся с одной рекомендацией.",
      fields: goalFields(state),
    };
  }
  if (state.context_state.status === "GOAL_PROVISIONAL") {
    return {
      kind: "confirm-goal",
      label: "Подтвердить цель и продолжить",
      description: "После решения агент самостоятельно соберёт бизнес-факты и существенные пробелы.",
      fields: goalFields(state),
    };
  }
  if (record(state.business_model).source !== "REAL_SITE_RESEARCH_PLUS_OWNER_CONFIRMATION") {
    return {
      kind: "confirm-business-model",
      label: "Подтвердить понимание бизнеса",
      description: "Подтвердите заполненное понимание; рутинное исследование остаётся работой агента.",
      fields: businessModelFields(state),
    };
  }
  if (!state.strategy) {
    return {
      kind: "approve-strategy",
      label: "Утвердить стратегию",
      description: "Одно решение фиксирует полный бизнес-смысл стратегии.",
      fields: strategyFields(state),
    };
  }

  const editingCorrection = correctionWithStatus(state, "EDITING");
  if (editingCorrection) {
    return {
      kind: "save-correction",
      target: editingCorrection.correction_id,
      label: "Сохранить исправленную формулировку",
      description: "Меняется только отклонённая бизнес-формулировка; исходный результат остаётся в истории.",
      fields: [{
        key: "adText",
        label: "Исправленный текст",
        control: "textarea",
        value: ownerText(record(editingCorrection.source.draft_snapshot).ad_text, "", 1_000),
        required: true,
      }],
    };
  }
  const correctionGate = correctionWithStatus(state, "HUMAN_GATE_REQUIRED");
  if (correctionGate) {
    return {
      kind: "authorize-correction",
      target: correctionGate.correction_id,
      label: "Подтвердить исправление",
      description: "Новое решение относится только к показанной исправленной формулировке.",
      fields: [],
    };
  }
  const rejected = state.package_execution?.items.find((item) => item.status === "REJECTED_NEEDS_EDIT"
    && !state.package_corrections.some((correction) => correction.source.item_execution_id === item.item_execution_id));
  if (rejected) {
    return {
      kind: "start-correction",
      target: rejected.item_execution_id,
      label: "Подготовить исправление",
      description: "Агент откроет только существенную формулировку, которую нужно исправить.",
      fields: [],
    };
  }

  if (!state.package_review) {
    const candidates = orderedShortlistCandidates(view);
    if (candidates.length > 0) {
      const selectedOrder = new Map((state.shortlist?.selections ?? []).map((item, index) => [item.draft_id, index + 1]));
      const drafts = list(record(state.recommendation_set).drafts).map(record);
      return {
        kind: "prepare-package",
        label: "Проверить состав и порядок набора",
        description: "Агент предложил порядок. Укажите 0, чтобы исключить вариант, или поменяйте номера; заблокированные кампании недоступны.",
        fields: candidates.map((candidate, index) => ({
          key: `campaign_${index + 1}`,
          label: ownerText(drafts.find((draft) => draft.draft_id === candidate.draft_id)?.campaign_name, `Кампания ${index + 1}`, 255),
          control: "number" as const,
          value: selectedOrder.get(candidate.draft_id) ?? (candidate.status === "REMOVED" ? 0 : index + 1),
          required: true,
          help: "0 — исключить; положительное число — место в пакете.",
        })),
      };
    }
    return null;
  }
  if (!state.human_decision_gate && allowed(view, "confirm_package")) {
    return {
      kind: "authorize-and-create",
      label: "Подтвердить и создать без запуска",
      description: "Одно решение разрешает только показанный пакет. Кампании останутся без показов и расходов.",
      fields: [],
    };
  }
  return null;
}

async function opaqueHandle(material: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(material)));
  const token = btoa(String.fromCharCode(...new Uint8Array(digest).slice(0, 18)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return `act_${token}`;
}

async function actionHandle(ownerKey: string, view: InternalView, descriptor: InternalActionDescriptor) {
  const material = JSON.stringify({
    ownerKey,
    state: view.revision,
    kind: descriptor.kind,
    target: descriptor.target ?? null,
  });
  return opaqueHandle(material);
}

const BUSINESS_MODEL_LABELS: Record<string, string> = {
  qualified_outcome: "Квалифицированный результат",
  customer_context: "Клиент и его контекст",
  buying_context: "Контекст покупки",
  revenue_model: "Модель выручки",
  sales_cycle: "Цикл продажи",
  average_sale_value_rub: "Средняя ценность продажи",
  gross_margin_percent: "Валовая маржа",
  lead_to_sale_percent: "Обращения, переходящие в продажу",
  capacity: "Мощность",
  seasonality: "Сезонность",
  geography: "География",
  exclusions: "Исключения",
  key_constraints: "Ключевые ограничения",
};

function competitorMatrixProjection(state: InternalState): OwnerJourneyProjection["competitorMatrix"] {
  const matrix = record(record(state.analytics_evidence_snapshot).competitor_matrix);
  const candidateSet = record(matrix.candidate_set);
  if (!Object.keys(candidateSet).length) return null;
  const candidates = list(candidateSet.candidates).map((candidateValue) => {
    const candidate = record(candidateValue);
    return {
      competitor: ownerText(candidate.competitor),
      rationale: ownerText(candidate.rationale),
      exactDestinations: list(candidate.exact_destinations).map((destination) => ownerText(destination, "Недоступно", 1_500)),
    };
  });
  const rows = list(matrix.rows).map((rowValue) => {
    const row = record(rowValue);
    const price = record(row.published_price);
    const source = record(row.source);
    const sample = record(row.ad_visibility_sample);
    const sampleStatus = sample.status === "OBSERVED"
      ? "Объявление наблюдалось"
      : sample.status === "NOT_OBSERVED" ? "В этом срезе объявление не наблюдалось" : "Срез недоступен";
    return {
      competitor: ownerText(row.competitor),
      productsServices: list(row.products_services).map((item) => ownerText(item)).join(", ") || "Недоступно",
      observedOfferMessage: ownerText(row.observed_offer_message),
      publishedPrice: price.status === "PUBLISHED" ? ownerText(price.value) : "Не опубликована",
      exactLanding: ownerText(row.exact_landing, "Недоступно", 1_500),
      source: `${ownerText(source.label)} · ${ownerText(source.url, "Недоступно", 1_500)}`,
      geography: row.geography === "UNAVAILABLE" ? "Недоступна" : ownerText(row.geography),
      device: row.device === "UNAVAILABLE" ? "Недоступно" : ownerText(row.device),
      observationDate: ownerText(row.observation_date, "Дата недоступна", 100),
      adVisibilitySample: `${sampleStatus}. Запрос: ${sample.query === null ? "недоступен" : ownerText(sample.query)}. География: ${sample.geography === "UNAVAILABLE" ? "недоступна" : ownerText(sample.geography)}. Устройство: ${sample.device === "UNAVAILABLE" ? "недоступно" : ownerText(sample.device)}. Дата: ${ownerText(sample.observation_date, "недоступна", 100)}. Источник: ${ownerText(sample.source)}.`,
    };
  });
  return {
    status: matrix.status === "AVAILABLE" ? "Доступно" : matrix.status === "PARTIAL" ? "Частично" : "Недоступно",
    competitorSetRule: ownerText(candidateSet.competitor_set_rule),
    candidates,
    rows,
    aggregateClaims: list(matrix.aggregate_claims).map((claimValue) => {
      const claim = record(claimValue);
      const observed = claim.observed_count === null || claim.observed_count === undefined ? "недоступно" : String(claim.observed_count);
      return {
        claim: ownerText(claim.claim),
        scope: `${ownerText(claim.competitor_set_rule)} Знаменатель: ${Number(claim.denominator)}.`,
        result: `Наблюдалось: ${observed}.`,
        limitation: ownerText(claim.limitation),
      };
    }),
    limitations: list(matrix.limitations).map((item) => ownerText(item)).filter(Boolean),
  };
}

const DEMAND_DIMENSION_LABELS: Record<string, string> = {
  OFFER_LANGUAGE: "Язык предложения",
  CUSTOMER_PROBLEM: "Проблема клиента",
  HIGH_INTENT_ACTION: "Целевое действие",
  BRAND: "Брендовый спрос",
  NON_BRAND: "Небрендовый спрос",
};

const COST_SOURCE_LABELS: Record<string, string> = {
  LEGACY_LIVE4_SCENARIO: "Сценарная оценка выбранного рекламного аккаунта",
  KEYWORDBIDS_V5_CURRENT_PROXY: "Текущая аукционная оценка Яндекс Директа",
  DIRECT_HISTORY_OWN_EMPIRICAL: "Собственная сопоставимая история Яндекс Директа",
};

export function projectDemandCostResearchForOwner(snapshot: unknown): OwnerJourneyProjection["demandCostResearch"] {
  const market = record(record(snapshot).market_evidence);
  const frequency = record(market.frequency);
  const cost = record(market.cost);
  const plan = record(market.research_plan);
  if (!Object.keys(frequency).length && !Object.keys(cost).length && !Object.keys(plan).length) return null;
  const dimensions = list(plan.dimensions).map(record);
  const seeds = list(plan.seeds).map(record);
  const formulations: NonNullable<OwnerJourneyProjection["demandCostResearch"]>["demand"]["formulations"] = dimensions.flatMap((dimension): NonNullable<OwnerJourneyProjection["demandCostResearch"]>["demand"]["formulations"] => {
    const matches = seeds.filter((seed) => seed.dimension === dimension.dimension);
    if (matches.length) return matches.map((seed) => ({
      category: ownerText(DEMAND_DIMENSION_LABELS[String(dimension.dimension)]),
      phrase: ownerText(seed.phrase),
      status: "Запланировано" as const,
    }));
    return [{
      category: ownerText(DEMAND_DIMENSION_LABELS[String(dimension.dimension)]),
      phrase: "Формулировка недоступна из текущих подтверждённых данных",
      status: "Недоступно" as const,
    }];
  });
  const demandStatus = frequency.status === "AVAILABLE" ? "Доступно" as const : frequency.status === "PARTIAL" ? "Частично" as const : "Недоступно" as const;
  const observed = record(frequency.observed_unique_count).value;
  const planScope = record(plan.scope);
  const regions = list(planScope.regions).map((item) => ownerText(record(item).name, "")).filter(Boolean);
  const devices = list(planScope.devices).map((item) => ownerText(item, "")).filter(Boolean);
  const seasonality = record(planScope.seasonality);
  const costAvailable = cost.status === "AVAILABLE" && record(cost.range).low !== undefined && record(cost.range).high !== undefined;
  const selectedRange = record(cost.range);
  const sample = record(cost.sample_size);
  const comparison = record(record(cost.scope).comparison);
  const costScope = Object.values(comparison).map((item) => ownerText(item, "")).filter(Boolean).join(" · ");
  const gapReasons = list(cost.missing_or_conflict_reasons).map((item) => ownerText(item, "", 200)).filter(Boolean);
  return {
    demand: {
      status: demandStatus,
      conclusion: observed === null || observed === undefined
        ? "Наблюдаемая нижняя граница спроса недоступна; это не нулевой спрос."
        : `Наблюдаемая нижняя граница: ${Number(observed).toLocaleString("ru-RU")} запросов в возвращённых верхних строках.`,
      source: "Яндекс Wordstat · официальное наблюдение",
      observedAt: ownerText(market.batch_finished_at, "Дата наблюдения недоступна", 100),
      scope: [...regions, ...devices].join(" · ") || "Область наблюдения недоступна",
      formulations,
      seasonality: seasonality.business_context
        ? `${ownerText(seasonality.business_context)} · месячная динамика ${ownerText(seasonality.from_date, "")} — ${ownerText(seasonality.to_date, "")}`
        : "Сезонный бизнес-контекст недоступен; месячная динамика сохраняется отдельно.",
      limitation: "Это нижняя граница возвращённых строк, а не число людей, кликов, показов или прогноз бюджета.",
    },
    cost: {
      status: costAvailable ? "Доступно" : "Недоступно",
      range: costAvailable ? `${Number(selectedRange.low).toLocaleString("ru-RU")}–${Number(selectedRange.high).toLocaleString("ru-RU")} ${ownerText(cost.currency, "")}` : "Сопоставимая стоимость недоступна",
      source: costAvailable ? ownerText(COST_SOURCE_LABELS[String(cost.compact_source)], "Сопоставимый источник") : "Квалифицированный источник не найден",
      observedAt: costAvailable ? ownerText(cost.as_of, "Дата недоступна", 100) : "Дата недоступна",
      currency: costAvailable ? ownerText(cost.currency, "Не указана", 20) : "Недоступна",
      vat: costAvailable ? cost.vat_treatment === "INCLUDED" ? "НДС включён" : cost.vat_treatment === "EXCLUDED" ? "Без НДС" : "Режим НДС неизвестен" : "Недоступен",
      sample: costAvailable ? `${Number(sample.value).toLocaleString("ru-RU")} ${ownerText(sample.unit, "наблюдений", 50)}` : "Недоступна",
      scope: costAvailable ? costScope || "Сопоставимый scope сохранён" : "Нет полностью сопоставимого scope",
      limitation: costAvailable
        ? "Выбран один совместимый источник без усреднения с другими; диапазон не является гарантией результата."
        : gapReasons.join(" · ") || "Нет источника, прошедшего проверки фразы, географии, размещения, стратегии, сезона и выборки.",
    },
  };
}

function businessModelProjection(state: InternalState): OwnerJourneyProjection["businessModel"] {
  const contract = record(record(state.business_model).owner_contract);
  const fields = record(contract.fields);
  if (!Object.keys(fields).length) return null;
  const economics = record(contract.economics);
  return {
    fields: BUSINESS_MODEL_FIELD_ORDER.map((field) => {
      const item = record(fields[field]);
      const provenance = record(item.provenance);
      const assumption = record(item.assumption);
      const value = item.value === null || item.value === undefined || item.value === ""
        ? "Недоступно"
        : typeof item.value === "number"
          ? `${item.value}${field.includes("percent") ? "%" : field.endsWith("_rub") ? " ₽" : ""}`
          : ownerText(item.value);
      return {
        label: BUSINESS_MODEL_LABELS[field],
        value,
        availability: item.availability === "AVAILABLE" ? "Доступно" as const : "Недоступно" as const,
        provenance: ownerText(provenance.label, "Нет доступного подтверждения"),
        observedAt: ownerText(provenance.observed_at, "Дата наблюдения недоступна", 100),
        freshness: item.freshness === "CURRENT" ? "Актуально для текущего анализа" : "Свежесть неизвестна",
        confidence: item.confidence === "OWNER_CONFIRMED" ? "Подтверждено владельцем" : item.confidence === "HIGH" ? "Высокая" : item.confidence === "MEDIUM" ? "Средняя" : item.confidence === "LOW" ? "Низкая" : "Недоступна",
        limitation: ownerText(item.limitation, "Нет известного ограничения"),
        assumption: ownerText(assumption.statement, "Предположение не применялось"),
      };
    }),
    economics: {
      status: economics.status === "CONFIRMED" ? "Подтверждена" : "Существенная неопределённость",
      targetResultCost: economics.status === "CONFIRMED" ? `${Number(economics.target_result_cost_rub)} ₽` : "Не выводится",
      explanation: economics.status === "CONFIRMED"
        ? "Рассчитано из подтверждённых ценности продажи, маржи и доли обращений, переходящих в продажу."
        : ownerText(economics.limitation, "Economics пока не подтверждена."),
    },
    materialQuestions: list(contract.questions).map((value) => {
      const question = record(value);
      return { question: ownerText(question.question), consequence: ownerText(question.why_material) };
    }),
  };
}

const READINESS_CHECK_LABELS: Record<string, string> = {
  EXACT_BINDING: "Точная привязка аналитики",
  GOAL_SEMANTICS: "Смысл основной цели",
  GOAL_FUNNEL: "Этап воронки",
  RECENT_REACHES: "Свежие достижения",
  SAMPLING_PRIVACY_LAG: "Качество и задержка данных",
  ATTRIBUTION: "Привязка результата к выбранному трафику",
  VALUE_REVENUE: "Ценность и выручка",
  OFFLINE_READINESS: "Результаты, передаваемые после продажи",
};

const DESTINATION_CLASSIFICATION_LABELS: Record<string, string> = {
  EXISTING_BUSINESS_PAGE: "Существующая бизнес-страница",
  EXISTING_LANDING: "Существующая посадочная",
  FUTURE_LANDING_REQUIRED: "Нужна новая посадочная",
  INVALID_UNRELATED: "Страница не относится к предложению",
};

function businessReadinessProjection(state: InternalState): OwnerJourneyProjection["businessReadiness"] {
  const readiness = record(state.measurement_destination_readiness);
  if (!Object.keys(readiness).length) return null;
  const measurement = record(readiness.measurement);
  const destination = record(readiness.destination);
  const gate = record(readiness.human_decision_gate);
  const measurementChecks = list(measurement.checks).map(record);
  return {
    status: readiness.status === "READY" ? "Готово" : "Заблокировано",
    measurement: {
      status: measurement.status === "READY" ? "Готово" : "Заблокировано",
      summary: measurement.status === "READY" ? "Выбранный бизнес-результат можно наблюдать в нужной области." : "Измеримость выбранного результата пока не доказана.",
      checks: measurementChecks.map((item) => ({
        label: ownerText(READINESS_CHECK_LABELS[String(item.code)], "Проверка измеримости"),
        result: item.status === "PASS" ? "Пройдено" : item.status === "NOT_APPLICABLE" ? "Не требуется" : item.status === "FAIL" ? "Не пройдено" : "Недоступно",
        limitation: item.limitation ? ownerText(item.limitation) : "Нет существенных ограничений для этой проверки",
      })),
    },
    destination: {
      status: destination.status === "READY" ? "Готово" : destination.status === "UNAVAILABLE" ? "Недоступно" : "Заблокировано",
      scopes: list(destination.device_scopes).map((value) => {
        const scope = record(value);
        return {
          device: scope.device === "mobile" ? "Мобильные устройства" : "Компьютеры",
          classification: scope.classification === null ? "Недоступно" : ownerText(DESTINATION_CLASSIFICATION_LABELS[String(scope.classification)], "Недоступно"),
          conclusion: ownerText(scope.conclusion),
        };
      }),
      priorityCorrections: list(destination.priority_corrections).slice(0, 3).map((value) => {
        const correction = record(value);
        return {
          priority: Number(correction.priority),
          action: ownerText(correction.action),
          basis: correction.basis === "NEURAL_HYPOTHESIS" ? "Гипотеза" as const : "Наблюдение" as const,
        };
      }),
    },
    repairPlan: list(readiness.repair_plan).map((value) => {
      const item = record(value);
      return { priority: Number(item.priority), action: ownerText(item.action), expectedResult: ownerText(item.expected_result) };
    }),
    decisionGate: Object.keys(gate).length ? {
      recommendation: ownerText(gate.recommendation),
      evidence: list(gate.evidence).map((item) => ownerText(item)).join(" · "),
      options: list(gate.options).map((item) => `${ownerText(record(item).option)}: ${ownerText(record(item).consequence)}`).join(" · "),
    } : null,
    limitations: list(readiness.limitations).map((item) => ownerText(item)).filter(Boolean),
  };
}

function materialUnknowns(state: InternalState) {
  const evidence = record(state.analytics_evidence_snapshot);
  const gaps = list(evidence.gaps)
    .filter((gap) => record(gap).material === true)
    .map((gap) => ownerText(record(gap).description, "Существенный факт пока не подтверждён"));
  const contract = record(record(state.business_model).owner_contract);
  for (const questionValue of list(contract.questions)) {
    const question = record(questionValue);
    gaps.push(`${ownerText(question.question)} ${ownerText(question.why_material)}`);
  }
  const economics = record(contract.economics);
  if (economics.status === "MATERIAL_UNCERTAINTY") gaps.push(ownerText(economics.limitation, "Economics пока не подтверждена."));
  const readiness = record(state.measurement_destination_readiness);
  if (readiness.status === "BLOCKED") {
    for (const item of list(readiness.repair_plan).slice(0, 3)) gaps.push(ownerText(record(item).action));
  }
  const drafts = list(record(state.recommendation_set).drafts);
  for (const draftValue of drafts) {
    const draft = record(draftValue);
    const score = record(draft.viability_score);
    for (const reason of list(record(score.eligibility).reasons)) {
      const text = ownerText(reason, "", 300);
      if (text) gaps.push(text);
    }
  }
  return [...new Set(gaps)].slice(0, 6);
}

const STRATEGY_FIELD_LABELS: Record<string, string> = {
  business_goal: "Бизнес-цель",
  campaign_focus: "Рекламный фокус",
  advertised_offer: "Предложение",
  target_audience: "Аудитория",
  qualified_result: "Квалифицированный результат",
  exclusions: "Исключения",
  geography: "География",
  period: "Период",
  landing_page: "Посадочная",
  weekly_budget: "Недельный бюджет",
  target_result_cost: "Целевая стоимость результата",
  core_message: "Основное сообщение",
};

function campaignStrategyProjection(state: InternalState): OwnerJourneyProjection["campaignStrategy"] {
  const questionnaire = record(state.strategy_questionnaire);
  const recommendation = record(questionnaire.recommendation);
  if (!Object.keys(recommendation).length) return null;
  const recommendationItem = (key: string, label: string, valueLabel?: (value: unknown) => string) => {
    const item = record(recommendation[key]);
    return {
      label,
      value: valueLabel ? valueLabel(item.value) : ownerText(item.value),
      rationale: ownerText(item.rationale),
      confidence: item.confidence === "HIGH" ? "Высокая" : item.confidence === "MEDIUM" ? "Средняя" : "Ограниченная",
    };
  };
  const economics = record(recommendation.economics);
  const questions = list(questionnaire.material_questions).map((value) => {
    const item = record(value);
    const decision = record(item.decision);
    return {
      field: ownerText(STRATEGY_FIELD_LABELS[String(item.field_id)], "Существенное поле"),
      question: ownerText(decision.question),
      recommendation: ownerText(decision.recommendation),
      consequences: list(decision.consequences).map((entry) => ownerText(entry)).join(" · "),
    };
  });
  const gate = record(questionnaire.human_decision_gate);
  const approved = Boolean(state.strategy);
  return {
    status: approved || (!questions.length && !Object.keys(gate).length) ? "Готова к решению" : "Нужны существенные решения",
    recommendations: [
      recommendationItem("objective", "Цель оптимизации", (value) => value === "QUALIFIED_RESULT" ? "Квалифицированный результат" : "Проверка качественного трафика"),
      recommendationItem("bidding", "Подход к ставкам", (value) => value === "WB_MAXIMUM_CLICKS" ? "Максимум переходов в недельном бюджете" : "Недоступно до проверки возможностей аккаунта"),
      recommendationItem("placements", "Размещения", (value) => list(value).map((item) => item === "SEARCH" ? "Поиск" : ownerText(item)).join(", ") || "Недоступно"),
      recommendationItem("measurement", "Измерение", (value) => value === "EXACT_METRIKA_PRIMARY_GOAL" ? "Точная основная цель Метрики" : "Проверка измерения до запуска"),
      {
        label: "Экономика результата",
        value: economics.target_result_cost_rub ? `${Number(economics.target_result_cost_rub).toLocaleString("ru-RU")} ₽` : "Существенная неопределённость",
        rationale: ownerText(economics.uncertainty, "Целевая стоимость подтверждена Business Model."),
        confidence: economics.target_result_cost_rub ? "Высокая" : "Ограниченная",
      },
    ],
    materialQuestions: approved ? [] : questions,
    decisionGate: !approved && Object.keys(gate).length ? {
      recommendation: ownerText(gate.recommendation),
      evidence: list(gate.evidence).map((item) => ownerText(item)).join(" · ") || "Перечисленные material gaps являются основанием решения.",
      confidence: gate.confidence === "MEDIUM" ? "Средняя" : "Ограниченная",
      alternatives: list(gate.alternatives).map((item) => ownerText(item)).join(" · "),
      consequences: list(gate.consequences).map((item) => ownerText(item)).join(" · "),
    } : null,
  };
}

function appliedPractice(state: InternalState): OwnerJourneyProjection["appliedPractice"] {
  const draft = list(record(state.recommendation_set).drafts)
    .map(record)
    .find((candidate) => candidate.visibility === "VISIBLE" && record(candidate.variant).kind === "IMPROVEMENT");
  const family = String(record(record(draft?.variant).hypothesis).changed_family ?? "");
  const practices: Record<string, string> = {
    QUALIFIED_ACTION: "Качественный результат прямо назван в формулировке предложения и проверяется как отдельная гипотеза.",
    AUDIENCE_SPECIFICITY: "Предложение сформулировано для выбранной аудитории и сравнивается с базовым вариантом.",
    MESSAGE_OFFER: "Сообщение прямо связано с выбранным предложением и сравнивается с базовым вариантом.",
  };
  if (!practices[family]) return null;
  return {
    practice: practices[family],
    limitation: "Это практика для подготовки и сравнения гипотез, а не обещание результата. Она не отменяет ограничения, проверки и решение владельца перед созданием.",
  };
}

function campaignOptions(view: InternalView): OwnerJourneyProjection["campaignOptions"] {
  const state = view.state;
  const recommendationSet = record(state.recommendation_set);
  const drafts = list(recommendationSet.drafts);
  const recommendedIds = new Set(list(record(recommendationSet.recommended_shortlist).draft_ids).map(String));
  return drafts
    .filter((value) => record(value).visibility !== "HIDDEN")
    .slice(0, 6)
    .map((value, index) => {
      const draft = record(value);
      const score = record(draft.viability_score);
      const eligibility = record(score.eligibility);
      const gaps = record(score.evidence_gaps);
      const coverage = record(score.evidence_coverage);
      const selected = state.shortlist?.selections.some((item) => item.draft_id === draft.draft_id) ?? false;
      const status = ["VIABLE", "TESTABLE_WITH_GAPS", "INSUFFICIENT_EVIDENCE", "BLOCKED"].includes(String(draft.viability_status))
        ? String(draft.viability_status) as "VIABLE" | "TESTABLE_WITH_GAPS" | "INSUFFICIENT_EVIDENCE" | "BLOCKED" : "BLOCKED";
      const comparativeReasons = list(score.main_reasons).map((reason) => ownerText(record(reason).reason, "", 240)).filter(Boolean);
      const blockerReasons = list(eligibility.blockers).map((reason) => ownerText(record(reason).remediation, "", 240)).filter(Boolean);
      const gapReasons = [...list(gaps.required), ...list(gaps.optional)].map((reason) => ownerText(record(reason).description, "", 240)).filter(Boolean);
      const reasons = (score.score === null || score.score === undefined ? [...blockerReasons, ...gapReasons] : [...comparativeReasons, ...gapReasons]).slice(0, 3);
      return {
        name: ownerText(draft.campaign_name, `Кампания ${index + 1}`, 255),
        audience: ownerText(answerValue(state, "target_audience"), "Целевая аудитория уточняется", 500),
        offer: ownerText(answerValue(state, "advertised_offer"), "Предложение уточняется", 500),
        destination: ownerText(answerValue(state, "landing_page"), "Посадочная страница уточняется", 1_500),
        status,
        readiness: status === "BLOCKED" ? "Заблокирована" as const
          : status === "INSUFFICIENT_EVIDENCE" ? "Недостаточно доказательств" as const
            : status === "TESTABLE_WITH_GAPS" ? "Есть существенные пробелы" as const : "Готова к проверке" as const,
        comparativeScore: score.score === null || score.score === undefined ? "Не рассчитывается до hard eligibility" : `${score.score}/100 · только сравнительный приоритет, не прогноз`,
        evidenceCoverage: `${Number(coverage.percent ?? 0)}%`,
        sensitivity: score.score_lower === null || score.score_lower === undefined ? "Недоступна до оценки" : `${score.score_lower}–${score.score_upper}`,
        reasons,
        publishPreview: buildOwnerPublishPreview(record(draft.publish_projection)),
        selected,
        agentRecommended: recommendedIds.has(String(draft.draft_id)),
      };
    });
}

function executionOutcome(status: unknown) {
  const value = String(status ?? "");
  if (["DIRECT_ACCEPTED", "CORRECTED_DIRECT_ACCEPTED"].includes(value)) return "Создана и оставлена без показов";
  if (value === "REJECTED_NEEDS_EDIT") return "Нужно исправить формулировку";
  if (["MODERATION_PENDING", "DISPATCHING", "QUEUED"].includes(value)) return "Агент продолжает проверку";
  if (["RECONCILIATION_REQUIRED", "OUTCOME_UNKNOWN"].includes(value)) return "Создание остановлено до безопасной сверки";
  if (value === "SYSTEM_FAILED") return "Создание безопасно остановлено";
  return "Ожидает создания";
}

function packageSummary(view: InternalView, campaigns: OwnerJourneyProjection["campaignOptions"]): OwnerJourneyProjection["packageSummary"] {
  const state = view.state;
  if (!state.package_review) return null;
  const execution = state.package_execution;
  const correctedItemIds = new Set(state.package_corrections
    .filter((correction) => correction.terminal_outcome === "PASS_AFTER_CORRECTION")
    .map((correction) => correction.source.item_execution_id));
  const completed = Boolean(execution?.items.length)
    && execution!.items.every((item) => item.status === "DIRECT_ACCEPTED" || correctedItemIds.has(item.item_execution_id));
  return {
    campaignCount: state.shortlist?.selections.length ?? 0,
    preflight: "9/9 бизнес-проверок пройдено",
    execution: execution
      ? completed ? "Создание завершено" : "Агент продолжает создание и проверку"
      : state.human_decision_gate ? "Решение подтверждено" : "Ожидает решения владельца",
    outcomes: (execution?.items ?? []).map((item, index) => ({
      campaign: campaigns[index]?.name ?? `Кампания ${index + 1}`,
      outcome: correctedItemIds.has(item.item_execution_id)
        ? "Исправлена, создана и оставлена без показов"
        : executionOutcome(item.status),
    })),
  };
}

function outcome(view: InternalView, stage: OwnerJourneyStageId, unknowns: string[]): OwnerJourneyProjection["businessOutcome"] {
  const state = view.state;
  if (stage === "goal") {
    return state.context_state
      ? { status: "ready", headline: "Бизнес-цель подготовлена", summary: "Агент предложил один измеримый результат и ждёт только вашего решения." }
      : { status: "working", headline: "Начнём с результата для бизнеса", summary: "Укажите бизнес один раз — исследование и подготовка останутся работой агента." };
  }
  if (stage === "findings") return { status: unknowns.length ? "blocked" : "ready", headline: "Агент собрал понимание бизнеса", summary: "Проверьте только выводы, которые существенно влияют на рекламу." };
  if (stage === "strategy") return { status: "ready", headline: "Стратегия подготовлена", summary: "Рекомендации уже заполнены; подтвердите бизнес-смысл одним решением." };
  if (stage === "campaigns") {
    const viabilityOutcome = record(record(state.recommendation_set).viability_outcome);
    if (viabilityOutcome.status === "NO_VIABLE_DRAFTS") {
      const repairs = list(viabilityOutcome.repair_plan).map((item) => ownerText(record(item).action, "", 240)).filter(Boolean).slice(0, 3);
      return {
        status: "blocked",
        headline: "Пока нет честно жизнеспособных кампаний",
        summary: repairs.length ? `Сначала: ${repairs.join(" Затем: ")}` : "Агент не будет принудительно показывать положительный результат без достаточных оснований.",
      };
    }
    return { status: unknowns.length ? "blocked" : "ready", headline: "Варианты кампаний рассчитаны", summary: "Сравните различия и примите рекомендованный набор для проверки." };
  }
  const correctedItemIds = new Set(state.package_corrections
    .filter((correction) => correction.terminal_outcome === "PASS_AFTER_CORRECTION")
    .map((correction) => correction.source.item_execution_id));
  const executionComplete = Boolean(state.package_execution?.items.length)
    && state.package_execution!.items.every((item) => item.status === "DIRECT_ACCEPTED" || correctedItemIds.has(item.item_execution_id));
  if (executionComplete) return { status: "complete", headline: "Создание завершено без запуска показов", summary: "Каждый результат учтён отдельно; расходы и показы не начинались." };
  return { status: state.human_decision_gate ? "working" : "ready", headline: "Пакет готов к точному решению", summary: "Проверьте бизнес-состав пакета. Техническое продолжение останется работой агента." };
}

function recommendation(view: InternalView, stage: OwnerJourneyStageId): OwnerJourneyProjection["currentRecommendation"] {
  const state = view.state;
  if (stage === "goal") {
    const goal = record(record(state.context_state).provisional_business_goal).value;
    return goal ? { headline: ownerText(goal), rationale: ownerText(record(record(state.context_state).provisional_business_goal).rationale, "Цель основана на доступном бизнес-контексте.") } : null;
  }
  if (stage === "findings") {
    return { headline: ownerText(record(state.business_model).product, "Подтвердить рекламный фокус"), rationale: ownerText(record(state.business_model).value, "Агент собрал доступные факты и отделил неизвестное.") };
  }
  if (stage === "strategy") return { headline: "Утвердить подготовленную стратегию", rationale: "Агент заполнил discoverable факты; от владельца требуется только материальное бизнес-решение." };
  if (stage === "campaigns") return { headline: "Принять готовые к проверке варианты", rationale: "Жёсткие ограничения применены до сравнительной оценки; заблокированные варианты не попадут в пакет." };
  return { headline: "Создать подтверждённые кампании без запуска", rationale: "Каждая кампания будет создана и проверена независимо, а показы останутся выключены." };
}

function cards(
  view: InternalView,
  stage: OwnerJourneyStageId,
  unknowns: string[],
  agent: P0AgentOwnerProjection | null,
): OwnerJourneyProjection["cards"] {
  const state = view.state;
  const result: OwnerJourneyProjection["cards"] = [];
  if (agent && agent.card.kind !== "human-decision-gate") {
    result.push({
      kind: agent.card.kind,
      title: ownerText(agent.card.title, "Текущая работа агента", 200),
      body: ownerText(agent.card.body, "Агент безопасно продолжает текущую работу.", 600),
    });
  } else if (stage === "goal") {
    result.push({ kind: "agent-activity", title: "Агент собирает контекст", body: "Проверяет бизнес, доступную аналитику и текущую рекламу без просьб выполнять технические шаги." });
  }
  if (state.business_model) {
    const model = record(state.business_model);
    result.push({
      kind: "finding",
      title: "Понимание бизнеса",
      body: ownerText(model.value, "Ценность предложения пока уточняется."),
      facts: [
        { label: "Предложение", value: ownerText(model.product) },
        { label: "Аудитория", value: ownerText(model.audience) },
        { label: "Качественный результат", value: ownerText(model.qualified_result) },
      ],
    });
  }
  for (const item of unknowns.slice(0, 3)) result.push({ kind: "problem", title: "Существенное неизвестное", body: item });
  const descriptor = actionDescriptor(view);
  const gateKinds: ActionKind[] = ["confirm-goal", "confirm-business-model", "approve-strategy", "authorize-and-create", "authorize-correction"];
  if (descriptor && gateKinds.includes(descriptor.kind)) {
    const current = recommendation(view, stage);
    result.push({
      kind: "human-decision-gate",
      title: "Нужно существенное решение владельца",
      body: descriptor.description,
      facts: [
        { label: "Рекомендация", value: current?.headline ?? descriptor.label },
        { label: "Основание", value: current?.rationale ?? "Агент использовал все доступные разрешённые evidence." },
        { label: "Уверенность", value: unknowns.length ? "Ограничена указанными существенными неизвестными" : "Достаточна для подготовленного решения" },
        { label: "Альтернатива", value: "Скорректировать показанный бизнес-смысл без расширения полномочий" },
        { label: "Последствие", value: descriptor.description },
      ],
    });
  } else if (!agent && stage !== "goal") {
    result.push({ kind: "agent-activity", title: "Текущая работа агента", body: "Безопасные проверки, ожидание и повторные чтения выполняются автоматически." });
  }
  return result;
}

async function project(
  ownerKey: string,
  view: InternalView,
  agent: P0AgentOwnerProjection | null,
  access: AccessReadinessProjection | null = null,
): Promise<OwnerJourneyProjection> {
  const stage = currentStage(view.state);
  const stageIndex = OWNER_JOURNEY_STAGES.findIndex((item) => item.id === stage);
  const unknowns = materialUnknowns(view.state);
  const baseDescriptor = actionDescriptor(view);
  const descriptor = baseDescriptor && access?.path === "existing" && access.canRevoke
    ? {
        ...baseDescriptor,
        fields: [...baseDescriptor.fields, {
          key: "accessDecision",
          label: "Доступ к частным данным",
          control: "select" as const,
          value: "continue",
          required: true,
          options: [
            { value: "continue", label: "Продолжить с подтверждённым доступом" },
            { value: "revoke", label: "Отозвать доступ" },
          ],
          help: "Отзыв немедленно ограничит evidence и доступные агенту инструменты.",
        }],
      }
    : baseDescriptor;
  const campaigns = campaignOptions(view);
  return {
    accessReadiness: access,
    journey: {
      stages: OWNER_JOURNEY_STAGES.map((item, index) => ({
        ...item,
        status: index < stageIndex ? "complete" : index === stageIndex ? "current" : "upcoming",
      })),
      currentStage: stage,
    },
    ...(stage === "goal" ? {
      introduction: {
        title: "От бизнес-цели до готовых кампаний",
        body: "Агент исследует доступные данные, готовит стратегию и кампании, а вы принимаете только существенные бизнес-решения.",
      },
    } : {}),
    businessOutcome: outcome(view, stage, unknowns),
    currentRecommendation: recommendation(view, stage),
    competitorMatrix: competitorMatrixProjection(view.state),
    demandCostResearch: projectDemandCostResearchForOwner(view.state.analytics_evidence_snapshot),
    businessModel: businessModelProjection(view.state),
    campaignStrategy: campaignStrategyProjection(view.state),
    appliedPractice: appliedPractice(view.state),
    businessReadiness: businessReadinessProjection(view.state),
    materialUnknowns: unknowns,
    agentActivity: agent ? {
      status: agent.status,
      completed: agent.progress.completed,
      total: agent.progress.total,
      summary: ownerText(agent.progress.label, "Агент продолжает работу", 300),
      nextBusinessStep: ownerText(agent.nextBusinessStep, "Дождаться следующего бизнес-вывода.", 400),
    } : null,
    cards: cards(view, stage, unknowns, agent),
    campaignOptions: campaigns,
    packageSummary: packageSummary(view, campaigns),
    primaryAction: descriptor ? {
      handle: await actionHandle(ownerKey, view, descriptor),
      label: descriptor.label,
      description: descriptor.description,
      fields: descriptor.fields,
    } : null,
    roadmap: structuredClone(ROADMAP),
  };
}

function accessActionDescriptor(state: AccessReadinessState, access: AccessReadinessProjection): InternalActionDescriptor | null {
  if (state.status === "PATH_REQUIRED") {
    return {
      kind: "choose-access-path",
      label: "Продолжить",
      description: "Выберите путь, который соответствует реальной истории рекламодателя.",
      fields: [{
        key: "advertiserPath",
        label: "Исходная ситуация",
        control: "select",
        value: "",
        required: true,
        options: [
          { value: "existing", label: "Уже запускали рекламу" },
          { value: "new", label: "Новый рекламодатель без истории" },
        ],
      }],
    };
  }
  if (state.status === "CONSENT_REQUIRED" || state.status === "BLOCKED" || state.status === "REVOKED") {
    return {
      kind: "grant-access-consent",
      label: state.status === "CONSENT_REQUIRED" ? "Предоставить доступ на чтение" : "Подключить доступ заново",
      description: "Это решение владельца разрешает только показанный объём чтения и не разрешает изменения в рекламных системах.",
      fields: [],
    };
  }
  if (state.status === "SELECTION_REQUIRED") {
    return {
      kind: "select-access-binding",
      label: "Подтвердить выбранный бизнес",
      description: "Агент проверит точное соответствие официальными API до использования частных данных.",
      fields: [
        {
          key: "accountChoice",
          label: "Рекламируемый бизнес",
          control: "select",
          value: "",
          required: true,
          options: access.accountChoices.map((choice) => ({ value: choice.handle, label: `${choice.label} — ${choice.detail}` })),
        },
        {
          key: "counterChoice",
          label: "Сайт и аналитика",
          control: "select",
          value: "",
          required: true,
          options: access.counterChoices.map((choice) => ({ value: choice.handle, label: `${choice.label} — ${choice.detail}` })),
        },
      ],
    };
  }
  if (state.status === "READY" || state.status === "LIMITED") {
    return {
      kind: "confirm-access-readiness",
      label: "Подтвердить готовность доступа",
      description: "Можно продолжить только с доступным evidence scope или сразу отозвать разрешение.",
      fields: [{
        key: "accessDecision",
        label: "Решение",
        control: "select",
        value: "continue",
        required: true,
        options: [
          { value: "continue", label: "Продолжить с доступным объёмом данных" },
          { value: "revoke", label: "Отозвать доступ" },
        ],
      }],
    };
  }
  return null;
}

async function projectAccessOnly(
  ownerKey: string,
  state: AccessReadinessState,
  access: AccessReadinessProjection,
): Promise<OwnerJourneyProjection> {
  const descriptor = accessActionDescriptor(state, access);
  const blocked = ["blocked", "revoked"].includes(access.status);
  const working = ["choose-path", "needs-consent", "needs-selection"].includes(access.status);
  return {
    accessReadiness: access,
    journey: {
      currentStage: "goal",
      stages: OWNER_JOURNEY_STAGES.map((stage, index) => ({ ...stage, status: index === 0 ? "current" : "upcoming" })),
    },
    introduction: {
      title: "Честный старт с доступными данными",
      body: "Существующий рекламодатель подключает минимальный доступ, а новый начинает без выдуманной истории аккаунта.",
    },
    businessOutcome: {
      status: blocked ? "blocked" : working ? "working" : "ready",
      headline: access.headline,
      summary: access.summary,
    },
    currentRecommendation: {
      headline: state.path === "NEW_ADVERTISER" ? "Продолжить с cold-start профилем" : "Использовать только подтверждённый доступ",
      rationale: access.history.explanation,
    },
    competitorMatrix: null,
    demandCostResearch: null,
    businessModel: null,
    campaignStrategy: null,
    appliedPractice: null,
    businessReadiness: null,
    materialUnknowns: [...access.limitations],
    agentActivity: null,
    cards: [{
      kind: state.status === "CONSENT_REQUIRED" ? "human-decision-gate" : blocked ? "problem" : "finding",
      title: access.headline,
      body: access.summary,
      facts: [
        ...access.scopes.map((scope) => ({ label: scope.label, value: `${scope.availability}. ${scope.purpose}` })),
        { label: "История аккаунта", value: `${access.history.availability}. ${access.history.explanation}` },
      ],
    }],
    campaignOptions: [],
    packageSummary: null,
    primaryAction: descriptor ? {
      handle: await opaqueHandle({ ownerKey, accessRevision: state.revision, kind: descriptor.kind }),
      label: descriptor.label,
      description: descriptor.description,
      fields: descriptor.fields,
    } : null,
    roadmap: structuredClone(ROADMAP),
  };
}

function accessIsActive(state: AccessReadinessState) {
  return state.status === "ACTIVE" || state.status === "ACTIVE_LIMITED";
}

function required(values: Record<string, unknown>, key: string) {
  const value = String(values[key] ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!value) throw new P0ApplicationError("P0_OWNER_INPUT_REQUIRED", "Заполните обязательное бизнес-поле.");
  return value;
}

export class P0OwnerJourney {
  private readonly application: P0Application;
  private readonly agentProjection: ((ownerKey: string) => Promise<P0AgentOwnerProjection | null>) | null;
  private readonly accessReadiness: AccessReadinessService | null;

  constructor(
    application: P0Application,
    options: {
      agentProjection?: (ownerKey: string) => Promise<P0AgentOwnerProjection | null>;
      accessReadiness?: AccessReadinessService;
    } = {},
  ) {
    this.application = application;
    this.agentProjection = options.agentProjection ?? null;
    this.accessReadiness = options.accessReadiness ?? null;
  }

  async query(ownerKey: string): Promise<OwnerJourneyProjection> {
    const accessState = this.accessReadiness ? await this.accessReadiness.get(ownerKey, true) : null;
    const access = accessState && this.accessReadiness ? this.accessReadiness.project(accessState) : null;
    if (accessState && !accessIsActive(accessState)) return projectAccessOnly(ownerKey, accessState, access!);
    const initial = await this.application.query(ownerKey);
    const view = this.agentProjection ? initial : await this.continueSafeWork(ownerKey, initial);
    const agent = this.agentProjection ? await this.agentProjection(ownerKey) : null;
    return project(ownerKey, view, agent, access);
  }

  async submit(ownerKey: string, submission: OwnerActionSubmission): Promise<OwnerJourneyProjection> {
    let accessState = this.accessReadiness ? await this.accessReadiness.get(ownerKey) : null;
    if (accessState && !accessIsActive(accessState)) {
      const access = this.accessReadiness!.project(accessState);
      const descriptor = accessActionDescriptor(accessState, access);
      const expectedHandle = descriptor
        ? await opaqueHandle({ ownerKey, accessRevision: accessState.revision, kind: descriptor.kind })
        : null;
      if (!descriptor || submission.handle !== expectedHandle) {
        throw new P0ApplicationError("P0_OWNER_ACTION_STALE", "Действие больше не соответствует текущему состоянию. Обновите страницу.");
      }
      const values = record(submission.values);
      if (descriptor.kind === "choose-access-path") {
        const path = required(values, "advertiserPath");
        accessState = await this.accessReadiness!.choosePath(ownerKey, path === "new" ? "NEW_ADVERTISER" : "EXISTING_ADVERTISER");
      } else if (descriptor.kind === "grant-access-consent") {
        accessState = await this.accessReadiness!.grantConsent(ownerKey, accessState.revision);
      } else if (descriptor.kind === "select-access-binding") {
        accessState = await this.accessReadiness!.selectBinding(
          ownerKey,
          accessState.revision,
          required(values, "accountChoice"),
          required(values, "counterChoice"),
        );
      } else if (descriptor.kind === "confirm-access-readiness") {
        accessState = required(values, "accessDecision") === "revoke"
          ? await this.accessReadiness!.revoke(ownerKey, accessState.revision)
          : await this.accessReadiness!.activate(ownerKey, accessState.revision);
      }
      const nextAccess = this.accessReadiness!.project(accessState);
      if (!accessIsActive(accessState)) return projectAccessOnly(ownerKey, accessState, nextAccess);
      const initial = await this.application.query(ownerKey);
      const view = this.agentProjection ? initial : await this.continueSafeWork(ownerKey, initial);
      const agent = this.agentProjection ? await this.agentProjection(ownerKey) : null;
      return project(ownerKey, view, agent, nextAccess);
    }

    let view = await this.application.query(ownerKey);
    const descriptor = actionDescriptor(view);
    if (!descriptor || submission.handle !== await actionHandle(ownerKey, view, descriptor)) {
      throw new P0ApplicationError("P0_OWNER_ACTION_STALE", "Действие больше не соответствует текущему состоянию. Обновите страницу.");
    }
    const values = record(submission.values);
    if (accessState?.path === "EXISTING_ADVERTISER" && values.accessDecision === "revoke") {
      accessState = await this.accessReadiness!.revoke(ownerKey, accessState.revision);
      return projectAccessOnly(ownerKey, accessState, this.accessReadiness!.project(accessState));
    }
    const command = async (payload: Record<string, unknown> & { action: string }) => {
      view = await this.application.command(ownerKey, { ...payload, expected_revision: view.revision });
    };

    if (descriptor.kind === "analyze-business") {
      await command({ action: "analyze_site", url: required(values, "website") });
    } else if (descriptor.kind === "confirm-goal") {
      await command({ action: "confirm_context_goal", confirmation: "CONFIRM_CONTEXT_GOAL", goal: required(values, "goal") });
    } else if (descriptor.kind === "confirm-business-model") {
      await command({
        action: "save_business_model",
        value: {
          product: required(values, "product"),
          audience: required(values, "customerContext"),
          value: required(values, "value"),
          qualified_result: required(values, "qualifiedResult"),
          exclusions: required(values, "exclusions"),
          qualified_outcome: required(values, "qualifiedResult"),
          customer_context: required(values, "customerContext"),
          buying_context: values.buyingContext,
          revenue_model: values.revenueModel,
          sales_cycle: values.salesCycle,
          average_sale_value_rub: values.averageSaleValueRub,
          gross_margin_percent: values.grossMarginPercent,
          lead_to_sale_percent: values.leadToSalePercent,
          capacity: values.capacity,
          seasonality: values.seasonality,
          geography: values.geography,
          key_constraints: values.keyConstraints,
        },
      });
    } else if (descriptor.kind === "approve-strategy") {
      await command({
        action: "approve_strategy",
        confirmation: "APPROVE_CAMPAIGN_STRATEGY",
        answers: {
          business_goal: required(values, "businessGoal"),
          campaign_focus: required(values, "campaignFocus"),
          advertised_offer: required(values, "offer"),
          target_audience: required(values, "audience"),
          qualified_result: required(values, "qualifiedResult"),
          exclusions: required(values, "exclusions"),
          geography: required(values, "geography"),
          period: { start_date: required(values, "periodStart"), end_date: required(values, "periodEnd") },
          landing_page: required(values, "landingPage"),
          weekly_budget: required(values, "weeklyBudget"),
          target_result_cost: values.targetResultCost,
          core_message: required(values, "message"),
        },
      });
    } else if (descriptor.kind === "prepare-package") {
      const candidates = orderedShortlistCandidates(view);
      const desired = candidates.map((candidate, index) => ({
        ...candidate,
        order: Number(values[`campaign_${index + 1}`] ?? descriptor.fields[index]?.value),
      })).filter((candidate) => Number.isSafeInteger(candidate.order) && candidate.order > 0)
        .sort((left, right) => left.order - right.order || left.draft_id.localeCompare(right.draft_id));
      if (new Set(desired.map((candidate) => candidate.order)).size !== desired.length) {
        throw new P0ApplicationError("P0_OWNER_SHORTLIST_ORDER_INVALID", "Каждая выбранная кампания должна иметь отдельное положительное место.");
      }
      const desiredIds = desired.map((candidate) => candidate.draft_id);
      for (const selected of [...(view.state.shortlist?.selections ?? [])]) {
        if (!desiredIds.includes(selected.draft_id)) await command({ action: "remove_from_shortlist", draft_id: selected.draft_id });
      }
      for (const candidate of desired) {
        const currentControl = view.shortlist_controls.find((item) => item.draft_id === candidate.draft_id);
        if (currentControl?.status === "REMOVED") await command({ action: "restore_to_shortlist", draft_id: candidate.draft_id });
        else if (currentControl?.status === "AVAILABLE") await command({ action: "add_to_shortlist", draft_id: candidate.draft_id });
      }
      if (desiredIds.length > 1) await command({ action: "reorder_shortlist", ordered_draft_ids: desiredIds });
      if (allowed(view, "review_package")) await command({ action: "review_package" });
    } else if (descriptor.kind === "review-package") {
      await command({ action: "review_package" });
    } else if (descriptor.kind === "authorize-and-create") {
      const review = view.state.package_review!;
      await command({
        action: "confirm_package",
        confirmation: "CONFIRM_EXACT_SHORTLIST_PACKAGE",
        package_review_id: review.package_review_id,
        package_id: review.package_id,
      });
      if (!this.agentProjection) {
        const gate = view.state.human_decision_gate!;
        await command({ action: "dispatch_package", package_id: gate.package_id, gate_id: gate.gate_id });
      }
    } else if (descriptor.kind === "start-correction") {
      await command({ action: "start_package_correction", item_execution_id: descriptor.target });
    } else if (descriptor.kind === "save-correction") {
      const correction = view.state.package_corrections.find((item) => item.correction_id === descriptor.target)!;
      const draft = record(correction.source.draft_snapshot);
      const fields = list(record(view.state.recommendation_set?.field_registry).fields)
        .map(record)
        .filter((field) => field.editable === true && typeof field.input_name === "string");
      const correctionValue = {
        draft_id: draft.draft_id,
        ...Object.fromEntries(fields.map((field) => {
          const inputName = String(field.input_name);
          return [inputName, inputName === "ad_text" ? required(values, "adText") : draft[inputName]];
        })),
      };
      await command({ action: "save_package_correction", correction_id: descriptor.target, value: correctionValue });
      await command({ action: "review_package_correction", correction_id: descriptor.target });
    } else if (descriptor.kind === "authorize-correction") {
      let correction = view.state.package_corrections.find((item) => item.correction_id === descriptor.target)!;
      if (correction.status === "HUMAN_GATE_REQUIRED") {
        await command({
          action: "confirm_package_correction",
          correction_id: correction.correction_id,
          confirmation: "CONFIRM_EXACT_SHORTLIST_PACKAGE",
          package_review_id: correction.package_review!.package_review_id,
          package_id: correction.package_review!.package_id,
        });
        correction = view.state.package_corrections.find((item) => item.correction_id === descriptor.target)!;
      }
      if (!this.agentProjection) {
        await command({
          action: "resubmit_package_correction",
          correction_id: correction.correction_id,
          package_id: correction.human_decision_gate!.package_id,
          gate_id: correction.human_decision_gate!.gate_id,
        });
      }
    }

    if (!this.agentProjection) view = await this.continueSafeWork(ownerKey, view);
    const agent = this.agentProjection ? await this.agentProjection(ownerKey) : null;
    const access = accessState && this.accessReadiness ? this.accessReadiness.project(accessState) : null;
    return project(ownerKey, view, agent, access);
  }

  async diagnostics(ownerKey: string) {
    return this.application.query(ownerKey);
  }

  private async continueSafeWork(ownerKey: string, initial: InternalView) {
    let view = initial;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const initialItem = view.state.package_execution?.items.find((item) => ["MODERATION_PENDING", "OUTCOME_UNKNOWN"].includes(item.status));
      if (initialItem && allowed(view, "poll_package_moderation")) {
        try {
          view = await this.application.command(ownerKey, {
            action: "poll_package_moderation",
            expected_revision: view.revision,
            package_id: view.state.package_execution!.package_id,
            item_execution_id: initialItem.item_execution_id,
          });
          continue;
        } catch (error) {
          if (error instanceof P0ApplicationError && error.code === "P0_MODERATION_POLL_NOT_DUE") break;
          throw error;
        }
      }
      const correction = view.state.package_corrections.find((item) => item.status === "RESUBMISSION_PENDING"
        && item.execution?.items.some((entry) => ["MODERATION_PENDING", "OUTCOME_UNKNOWN"].includes(entry.status)));
      const correctionItem = correction?.execution?.items.find((item) => ["MODERATION_PENDING", "OUTCOME_UNKNOWN"].includes(item.status));
      if (correction && correctionItem && allowed(view, "poll_package_correction_moderation")) {
        try {
          view = await this.application.command(ownerKey, {
            action: "poll_package_correction_moderation",
            expected_revision: view.revision,
            correction_id: correction.correction_id,
            package_id: correction.execution!.package_id,
            item_execution_id: correctionItem.item_execution_id,
          });
          continue;
        } catch (error) {
          if (error instanceof P0ApplicationError && error.code === "P0_MODERATION_POLL_NOT_DUE") break;
          throw error;
        }
      }
      break;
    }
    return view;
  }
}
