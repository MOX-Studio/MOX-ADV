import {
  P0Application,
  P0ApplicationError,
  type P0Command,
} from "./p0-application.ts";
import type { P0AgentOwnerProjection } from "./p0-agent-runtime.ts";

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
  options?: string[];
  help?: string;
};

export type OwnerJourneyProjection = {
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
    readiness: "Готова к проверке" | "Есть существенные пробелы" | "Заблокирована";
    reasons: string[];
    selected: boolean;
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

function businessModelFields(state: InternalState): OwnerActionField[] {
  const model = record(state.business_model);
  return [
    ["product", "Что рекламируем"],
    ["audience", "Кому это нужно"],
    ["value", "Почему это ценно"],
    ["qualifiedResult", "Какой результат считаем качественным", "qualified_result"],
    ["exclusions", "Что не считаем результатом"],
  ].map(([key, label, sourceKey = key]) => ({
    key,
    label,
    control: "textarea" as const,
    value: ownerText(model[sourceKey], "", 1_000),
    required: true,
  }));
}

function strategyFields(state: InternalState): OwnerActionField[] {
  const value = (fieldId: string) => answerValue(state, fieldId) ?? questionnaireValue(state, fieldId) ?? "";
  const period = record(value("period"));
  return [
    { key: "businessGoal", label: "Бизнес-цель", control: "textarea" as const, value: ownerText(value("business_goal"), "", 500), required: true },
    { key: "offer", label: "Предложение", control: "textarea" as const, value: ownerText(value("advertised_offer"), "", 1_000), required: true },
    { key: "audience", label: "Аудитория", control: "textarea" as const, value: ownerText(value("target_audience"), "", 1_000), required: true },
    { key: "qualifiedResult", label: "Качественный результат", control: "textarea" as const, value: ownerText(value("qualified_result"), "", 1_000), required: true },
    { key: "exclusions", label: "Исключения", control: "textarea" as const, value: ownerText(value("exclusions"), "", 1_000), required: true },
    { key: "geography", label: "География", control: "select" as const, value: ownerText(value("geography"), "", 100), required: true, options: ["Россия", "Москва", "Санкт-Петербург"] },
    { key: "periodStart", label: "Начало периода", control: "date" as const, value: ownerText(period.start_date, "", 20), required: true },
    { key: "periodEnd", label: "Окончание периода", control: "date" as const, value: ownerText(period.end_date, "", 20), required: true },
    { key: "landingPage", label: "Куда вести клиента", control: "url" as const, value: ownerText(value("landing_page"), "", 1_500), required: true },
    { key: "weeklyBudget", label: "Бюджет на неделю, ₽", control: "number" as const, value: Number(value("weekly_budget")) || "", required: true },
    { key: "targetResultCost", label: "Целевая стоимость результата, ₽", control: "number" as const, value: Number(value("target_result_cost")) || "", required: true },
    { key: "message", label: "Главное сообщение", control: "textarea" as const, value: ownerText(value("core_message"), "", 1_000), required: true },
  ];
}

function allowed(view: InternalView, command: string) {
  return view.workflow.allowed_commands.includes(command as never);
}

function correctionWithStatus(state: InternalState, status: string) {
  return state.package_corrections.find((item) => item.status === status) ?? null;
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
    const selected = state.shortlist?.selections.length ?? 0;
    const available = view.shortlist_controls.filter((item) => item.status === "AVAILABLE").length;
    if (selected === 0 && available > 0) {
      return {
        kind: "prepare-package",
        label: "Принять рекомендованный набор",
        description: "Агент включит готовые варианты и подготовит одну итоговую проверку.",
        fields: [],
      };
    }
    if (selected > 0 && allowed(view, "review_package")) {
      return {
        kind: "review-package",
        label: "Перейти к итоговой проверке",
        description: "Будет показано, что именно создаст агент и почему показы останутся выключены.",
        fields: [],
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

async function actionHandle(ownerKey: string, view: InternalView, descriptor: InternalActionDescriptor) {
  const material = JSON.stringify({
    ownerKey,
    state: view.revision,
    kind: descriptor.kind,
    target: descriptor.target ?? null,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  const token = btoa(String.fromCharCode(...new Uint8Array(digest).slice(0, 18)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return `act_${token}`;
}

function materialUnknowns(state: InternalState) {
  const evidence = record(state.analytics_evidence_snapshot);
  const gaps = list(evidence.gaps)
    .filter((gap) => record(gap).material === true)
    .map((gap) => ownerText(record(gap).description, "Существенный факт пока не подтверждён"));
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

function campaignOptions(view: InternalView): OwnerJourneyProjection["campaignOptions"] {
  const state = view.state;
  const drafts = list(record(state.recommendation_set).drafts);
  return drafts
    .filter((value) => record(value).visibility !== "HIDDEN")
    .slice(0, 6)
    .map((value, index) => {
      const draft = record(value);
      const score = record(draft.viability_score);
      const eligibility = record(score.eligibility);
      const selected = state.shortlist?.selections.some((item) => item.draft_id === draft.draft_id) ?? false;
      const blocked = draft.publish_eligibility === "BLOCKED_HARD" || eligibility.status !== "ELIGIBLE";
      const reasons = list(eligibility.reasons).map((reason) => ownerText(reason, "", 240)).filter(Boolean).slice(0, 3);
      return {
        name: ownerText(draft.campaign_name, `Кампания ${index + 1}`, 255),
        audience: ownerText(answerValue(state, "target_audience"), "Целевая аудитория уточняется", 500),
        offer: ownerText(answerValue(state, "advertised_offer"), "Предложение уточняется", 500),
        destination: ownerText(answerValue(state, "landing_page"), "Посадочная страница уточняется", 1_500),
        readiness: blocked ? "Заблокирована" as const : reasons.length ? "Есть существенные пробелы" as const : "Готова к проверке" as const,
        reasons,
        selected,
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
  if (stage === "campaigns") return { status: unknowns.length ? "blocked" : "ready", headline: "Варианты кампаний рассчитаны", summary: "Сравните различия и примите рекомендованный набор для проверки." };
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
  const gateKinds: ActionKind[] = ["confirm-goal", "approve-strategy", "authorize-and-create", "authorize-correction"];
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
): Promise<OwnerJourneyProjection> {
  const stage = currentStage(view.state);
  const stageIndex = OWNER_JOURNEY_STAGES.findIndex((item) => item.id === stage);
  const unknowns = materialUnknowns(view.state);
  const descriptor = actionDescriptor(view);
  const campaigns = campaignOptions(view);
  return {
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

function required(values: Record<string, unknown>, key: string) {
  const value = String(values[key] ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!value) throw new P0ApplicationError("P0_OWNER_INPUT_REQUIRED", "Заполните обязательное бизнес-поле.");
  return value;
}

export class P0OwnerJourney {
  private readonly application: P0Application;
  private readonly agentProjection: ((ownerKey: string) => Promise<P0AgentOwnerProjection | null>) | null;

  constructor(
    application: P0Application,
    options: { agentProjection?: (ownerKey: string) => Promise<P0AgentOwnerProjection | null> } = {},
  ) {
    this.application = application;
    this.agentProjection = options.agentProjection ?? null;
  }

  async query(ownerKey: string): Promise<OwnerJourneyProjection> {
    const initial = await this.application.query(ownerKey);
    const view = this.agentProjection ? initial : await this.continueSafeWork(ownerKey, initial);
    const agent = this.agentProjection ? await this.agentProjection(ownerKey) : null;
    return project(ownerKey, view, agent);
  }

  async submit(ownerKey: string, submission: OwnerActionSubmission): Promise<OwnerJourneyProjection> {
    let view = await this.application.query(ownerKey);
    const descriptor = actionDescriptor(view);
    if (!descriptor || submission.handle !== await actionHandle(ownerKey, view, descriptor)) {
      throw new P0ApplicationError("P0_OWNER_ACTION_STALE", "Действие больше не соответствует текущему состоянию. Обновите страницу.");
    }
    const values = record(submission.values);
    const command = async (payload: Omit<P0Command, "expected_revision">) => {
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
          audience: required(values, "audience"),
          value: required(values, "value"),
          qualified_result: required(values, "qualifiedResult"),
          exclusions: required(values, "exclusions"),
        },
      });
    } else if (descriptor.kind === "approve-strategy") {
      await command({
        action: "approve_strategy",
        confirmation: "APPROVE_CAMPAIGN_STRATEGY",
        answers: {
          business_goal: required(values, "businessGoal"),
          advertised_offer: required(values, "offer"),
          target_audience: required(values, "audience"),
          qualified_result: required(values, "qualifiedResult"),
          exclusions: required(values, "exclusions"),
          geography: required(values, "geography"),
          period: { start_date: required(values, "periodStart"), end_date: required(values, "periodEnd") },
          landing_page: required(values, "landingPage"),
          weekly_budget: required(values, "weeklyBudget"),
          target_result_cost: required(values, "targetResultCost"),
          core_message: required(values, "message"),
        },
      });
    } else if (descriptor.kind === "prepare-package") {
      for (const control of view.shortlist_controls.filter((item) => item.status === "AVAILABLE")) {
        await command({ action: "add_to_shortlist", draft_id: control.draft_id });
      }
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
    return project(ownerKey, view, agent);
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
