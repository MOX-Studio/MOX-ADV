import {
  P0Application,
  P0ApplicationError,
} from "./p0-application.ts";
import {
  projectOwnerGoalInterview,
  type OwnerGoalInterviewProjection,
  type OwnerGoalInterviewQuestion,
} from "./p0-owner-journey-transition.ts";
import { BUSINESS_MODEL_FIELD_ORDER } from "./business-model-contract.ts";
import type { P0AgentOwnerProjection } from "./p0-agent-runtime.ts";
import { buildOwnerPublishPreview } from "./campaign-creation-profile.ts";
import {
  AUCTION_PROTOCOL_EDITOR_FIELDS,
  CAMPAIGN_DRAFT_EDITOR_CONTRACT,
  projectionFieldValue,
} from "./campaign-draft-fields.ts";
import {
  type AccessReadinessProjection,
  type AccessReadinessService,
  type AccessReadinessState,
} from "./access-readiness.ts";
import { projectWordstatForPresentation } from "./wordstat-presentation.ts";
import {
  projectAnalyticsEvidenceForOwner,
  type OwnerAnalyticsSummary,
} from "./analytics-owner-summary.ts";
import type { OwnerPipelineProjection } from "./pipeline-owner-dashboard.ts";

export const OWNER_JOURNEY_STAGES = [
  { id: "goal", label: "Цель" },
  { id: "findings", label: "Что узнал агент" },
  { id: "strategy", label: "Стратегия" },
  { id: "campaigns", label: "Кампании" },
  { id: "review", label: "Проверка публикации" },
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
  maximumLength?: number;
  minimum?: number;
  maximum?: number;
};

export type OwnerJourneyProjection = {
  pipeline?: OwnerPipelineProjection;
  accessReadiness: AccessReadinessProjection | null;
  goalInterview: OwnerGoalInterviewProjection | null;
  campaignGoal: string | null;
  campaignGoalConfirmed: boolean;
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
  directReport: {
    state: "filled" | "empty" | "partial" | "unavailable";
    status: "Данные получены" | "Пустой срез" | "Данные частичные" | "Данные недоступны";
    headline: string;
    summary: string;
    observedAt: string;
    freshness: string;
    inventory: Array<{ label: string; value: string; detail: string }>;
    campaigns: Array<{ name: string; delivery: string; review: string }>;
    queries: { status: "Доступно" | "Частично" | "Недоступно"; value: string; detail: string };
    results: { status: "Доступно" | "Частично" | "Недоступно"; value: string; detail: string };
    limitations: string[];
    nextActions: string[];
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
      adObservationStatus: string;
      adObservationSource: string;
      adObservationDate: string;
      adObservationScope: string;
      adObservationLimitation: string;
    }>;
    aggregateClaims: Array<{ claim: string; scope: string; result: string; limitation: string }>;
    hypotheses: Array<{
      pattern: string;
      hypothesis: string;
      basis: string;
      evidenceSet: Array<{ competitor: string; exactLanding: string; observationDate: string }>;
      limitation: string;
    }>;
    limitations: string[];
  } | null;
  analyticsSummary: OwnerAnalyticsSummary | null;
  demandCostResearch: {
    demand: {
      status: "Доступно" | "Частично" | "Недоступно";
      conclusion: string;
      source: string;
      observedAt: string;
      scope: string;
      method: string;
      window: string;
      coverage: string;
      formulations: Array<{
        category: string;
        phrase: string;
        frequency: string;
        status: "Частота получена" | "Частота недоступна" | "Формулировка недоступна";
        method: string;
        operator: string;
        scope: string;
        observedAt: string;
        provenance: string;
      }>;
      seasonality: string;
      limitation: string;
      gaps: string[];
      nextAction: string;
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
    ownerReview: null | {
      status: "Готова к подтверждению" | "Возвращена к редактированию" | "Подтверждена";
      versionLabel: string;
      exactBinding: string;
      summary: Array<{ label: string; value: string; explanation: string }>;
      decisions: Array<{ label: string; value: string; evidence: string; confidence: string }>;
      alternatives: string[];
      limitations: string[];
      confirmHandle: string | null;
      rejectHandle: string | null;
      editorHandle: string | null;
      editorFields: OwnerActionField[];
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
      report: {
        state: "Готово" | "Редкие данные" | "Устарело" | "Ошибка" | "Недоступно";
        conclusion: string;
        window: string;
        reaches: string;
        freshness: string;
        quality: Array<{ label: string; value: string }>;
      };
      checks: Array<{ label: string; result: string; limitation: string }>;
    };
    destination: {
      status: "Готово" | "Заблокировано" | "Недоступно";
      scopes: Array<{ device: string; classification: string; conclusion: string }>;
      priorityCorrections: Array<{ priority: number; action: string; basis: "Наблюдение" | "Гипотеза" }>;
    };
    repairPlan: Array<{ priority: number; action: string; expectedResult: string }>;
    decisionGate: null | { recommendation: string; evidence: string; confidence: string; options: string };
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
    auctionProtocol: {
      control: string;
      testedChange: string;
      biddingStrategy: string;
      bidCeiling: string;
      queryMatching: string;
      autotargetingPolicy: string;
      trafficSplit: string;
      testBudget: string;
      testPeriod: string;
      measurementGoal: string;
      successThreshold: string;
      stopCondition: string;
      attribution: string;
      evidenceStatus: string;
    };
    publishPreview: {
      titles: string[];
      texts: string[];
      urls: Array<{ landing: string; tracking: string }>;
      creativeCombinations: Array<{ title: string; text: string; landing: string; tracking: string }>;
      requiredDisclaimers: string[];
      creativeProvenance: { family: string; source: string; rights: string };
    };
    editor: {
      versionLabel: string;
      validationStatus: "Проверена" | "Требуется повторная проверка" | "Балл недействителен";
      validationExplanation: string;
      publicationHandle: string | null;
      publicationFields: OwnerActionField[];
      protocolHandle: string | null;
      protocolFields: OwnerActionField[];
      publicationContract: Array<{
        section: "Кампания" | "Таргетинг" | "Объявление" | "Активы";
        label: string;
        classification: "Редактируется" | "Зафиксировано стратегией" | "Зафиксировано возможностями" | "Доступно после отдельной проверки";
        value: string;
        explanation: string;
      }>;
      capabilityBoundaries: Array<{
        label: string;
        classification: "Доступно после отдельной проверки" | "Не поддерживается";
        explanation: string;
      }>;
      feedback: string | null;
    };
    selected: boolean;
    agentRecommended: boolean;
  }>;
  packageSummary: {
    campaignCount: number;
    preflight: string;
    preflightGates: Array<{ label: string; status: "Пройдено" | "Заблокировано"; explanation: string }>;
    strategyMonthlyBudget: string;
    orderedPackageBudget: string;
    budgetAlignment: {
      classification: "Соответствует" | "Ограниченный тест" | "Нужно изменить" | "Заблокировано";
      explanation: string;
    };
    campaignBudgets: Array<{ name: string; budget: string; period: string }>;
    execution: string;
    outcomes: Array<{ campaign: string; outcome: string }>;
  } | null;
  packageDecision: {
    status: "Нужно решение" | "Принято";
    exactVersion: string;
    recommendation: string;
    alternatives: string[];
    consequences: string[];
    risks: string[];
    nextRealStage: string;
    safety: string;
    campaigns: Array<{ order: number; name: string; budget: string; period: string }>;
    acceptHandle: string | null;
    rejectHandle: string | null;
    history: Array<{ verdict: "Принято" | "Отклонено"; decidedAt: string; exactVersion: string }>;
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
  | "select-focus"
  | "review-strategy"
  | "revalidate-draft"
  | "revalidate-auction-protocol"
  | "prepare-package"
  | "edit-package"
  | "review-package"
  | "authorize-and-create"
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

export function ownerPublicBrandName(value: unknown, fallback = "Не указано", maximum = 200) {
  let text = String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  for (const pattern of FORBIDDEN_TECHNICAL_TEXT) text = text.replace(pattern, "техническая деталь");
  text = text.replace(/\s+·\s*$/u, "").replace(/\s+/gu, " ").slice(0, maximum).trim();
  return text || fallback;
}

function ownerCount(value: unknown) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function ownerCountLabel(value: number | null) {
  return value === null ? "Недоступно" : value.toLocaleString("ru-RU");
}

function ownerCountPhrase(value: unknown, one: string, few: string, many: string) {
  const count = ownerCount(value);
  if (count === null) return `${ownerText(value, "Недоступно", 40)} ${many}`;
  const lastTwo = count % 100;
  const last = count % 10;
  const noun = lastTwo >= 11 && lastTwo <= 14 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
  return `${ownerCountLabel(count)} ${noun}`;
}

function ownerObservedAt(value: unknown) {
  const date = new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) return "Время наблюдения недоступно";
  return `${new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(date)} МСК`;
}

const CAMPAIGN_DELIVERY_LABELS: Record<string, string> = {
  ON: "Показы включены",
  OFF: "Показы выключены",
  SUSPENDED: "Остановлена",
  ARCHIVED: "В архиве",
};

const CAMPAIGN_REVIEW_LABELS: Record<string, string> = {
  ACCEPTED: "Принята рекламной системой",
  DRAFT: "Черновик",
  MODERATION: "На проверке рекламной системой",
  REJECTED: "Отклонена рекламной системой",
};

function reportRowCount(report: Record<string, unknown>) {
  return ownerCount(record(report.artifact_reference).object_count);
}

export function projectDirectAuditForOwner(snapshot: unknown): OwnerJourneyProjection["directReport"] {
  const root = record(snapshot);
  if (!Object.keys(root).length) return null;
  const sources = list(root.sources).map(record);
  const claims = list(root.claims).map(record);
  const directSource = sources.find((source) => source.source_id === "direct");
  const directClaim = claims.find((claim) => ["complete_account_audit", "campaign_inventory"].includes(String(claim.predicate)));
  const directValue = record(directClaim?.value);
  const audit = record(directValue.complete_read_audit);
  const objectCounts = record(audit.object_counts);
  const reports = list(audit.report_summaries).map(record);
  const searchReport = reports.find((report) => String(report.report_key).includes("search-query") || String(report.report_type).includes("SEARCH_QUERY"));
  const campaignReport = reports.find((report) => String(report.report_key).includes("campaign-performance") || String(report.report_type).includes("CAMPAIGN_PERFORMANCE"));
  const metricClaim = claims.find((claim) => claim.predicate === "observed_performance");
  const metricValue = record(metricClaim?.value);
  const metricPeriod = record(metricValue.report);
  const visitsCount = ownerCount(metricValue.visits);
  const goalVisitsCount = ownerCount(metricValue.goal_visits);
  const metricAvailable = visitsCount !== null || goalVisitsCount !== null;
  const metricComplete = visitsCount !== null && goalVisitsCount !== null;
  const sourceStatus = String(directSource?.status ?? "UNAVAILABLE");
  const campaignCount = ownerCount(objectCounts.campaigns ?? directValue.campaigns_total);
  const groupCount = ownerCount(objectCounts.adgroups);
  const adCount = ownerCount(objectCounts.ads);
  const keywordCount = ownerCount(objectCounts.keywords);
  const autotargetingCount = ownerCount(objectCounts.autotargetings);
  const targetingCount = keywordCount === null && autotargetingCount === null
    ? null
    : (keywordCount ?? 0) + (autotargetingCount ?? 0);
  const searchRows = searchReport?.status === "COMPLETE" ? reportRowCount(searchReport) : null;
  const campaignRows = campaignReport?.status === "COMPLETE" ? reportRowCount(campaignReport) : null;
  const hasDirectClaim = Boolean(directClaim && Object.keys(directValue).length);
  const auditStatus = String(audit.status ?? "");
  const partial = hasDirectClaim && (sourceStatus === "PARTIAL" || auditStatus === "PARTIAL" || !Object.keys(audit).length);
  const unavailable = sourceStatus === "UNAVAILABLE" || !hasDirectClaim;
  const empty = !unavailable && !partial
    && [campaignCount, groupCount, adCount, targetingCount, searchRows, campaignRows]
      .every((count) => count === 0);
  const state: NonNullable<OwnerJourneyProjection["directReport"]>["state"] = unavailable
    ? "unavailable"
    : partial ? "partial" : empty ? "empty" : "filled";
  const stateCopy = {
    filled: {
      status: "Данные получены" as const,
      headline: "Виден состав продвижения и наблюдаемые результаты",
      summary: "Снимок связывает текущие кампании, объявления, условия показа и доступные отчёты. Это наблюдение не доказывает причинную эффективность.",
    },
    empty: {
      status: "Пустой срез" as const,
      headline: "В проверенном срезе нет объектов продвижения",
      summary: "Нулевые значения подтверждены доступным чтением. Они описывают этот аккаунт и момент наблюдения, но не историю бизнеса за пределами среза.",
    },
    partial: {
      status: "Данные частичные" as const,
      headline: "Часть продвижения видна, часть остаётся неизвестной",
      summary: "Доступные объекты и отчёты показаны отдельно от пробелов. Недоступное не считается нулевым и не поддерживает вывод об эффективности.",
    },
    unavailable: {
      status: "Данные недоступны" as const,
      headline: "Текущую картину продвижения подтвердить нельзя",
      summary: "Проверенного среза рекламного аккаунта нет. Активность неизвестна и не подменяется нулевыми значениями или предположениями.",
    },
  }[state];
  const confidence = record(directClaim?.confidence);
  const freshnessStatus = String(confidence.freshness ?? "unknown");
  const freshness = ["fresh", "current"].includes(freshnessStatus)
    ? "Актуально на момент снимка"
    : freshnessStatus === "aging"
      ? "Свежесть снижается"
      : freshnessStatus === "stale" ? "Снимок требует обновления" : "Свежесть не подтверждена";
  const queryAvailable = searchReport?.status === "COMPLETE" && searchRows !== null;
  const queryPartial = Boolean(searchReport) && !queryAvailable;
  const resultAvailable = campaignRows !== null || metricAvailable;
  const campaigns = list(directValue.campaign_summaries).map(record).slice(0, 12).map((campaign) => ({
    name: ownerText(campaign.name, "Кампания без названия", 160),
    delivery: CAMPAIGN_DELIVERY_LABELS[String(campaign.state)] ?? "Состояние показов не подтверждено",
    review: CAMPAIGN_REVIEW_LABELS[String(campaign.status)] ?? "Статус проверки не подтверждён",
  }));
  const limitations = [
    "Снимок показывает наблюдаемое состояние и не доказывает причинную эффективность, прибыль или будущий результат.",
    ...(state === "partial" ? ["Часть объектов или отчётов недоступна; недоступное нельзя считать нулевым, а решения допустимы только в пределах явно показанных данных."] : []),
    ...(state === "unavailable" ? ["Текущая активность неизвестна и не должна трактоваться как отсутствие рекламы."] : []),
    ...(queryAvailable || resultAvailable ? ["Статистика за последние три дня может уточняться рекламной системой."] : []),
    ...(!metricComplete ? ["Наблюдение бизнес-результата за сопоставимый период неполно или недоступно."] : []),
  ];
  const nextActions = state === "filled"
    ? [
        "Сопоставить состав кампаний и объявлений с достижениями цели, не выдавая связь за причинный эффект.",
        queryAvailable
          ? "Использовать доступный срез поисковых запросов для отдельного анализа и исключений."
          : "Сначала получить проверенный срез поисковых запросов, затем уточнять исключения.",
      ]
    : state === "empty"
      ? [
          "Если продвижение ожидалось, проверить выбранный бизнес-аккаунт и момент наблюдения.",
          "Не создавать вывод об эффективности из отсутствия объектов в одном подтверждённом срезе.",
        ]
      : state === "partial"
        ? [
            "Опираться только на отмеченные доступные части; пробелы не считать нулевыми значениями.",
            "Восстановить недоступный объём чтения до решений, зависящих от полной картины.",
          ]
        : [
            "Восстановить подтверждённый доступ к выбранному рекламному аккаунту.",
            "Не принимать решений о текущей активности до нового проверенного снимка.",
          ];
  return {
    state,
    ...stateCopy,
    observedAt: ownerObservedAt(directSource?.observed_at),
    freshness,
    inventory: [
      { label: "Кампании", value: ownerCountLabel(campaignCount), detail: "Текущие кампании в выбранном рекламном аккаунте" },
      { label: "Группы объявлений", value: ownerCountLabel(groupCount), detail: "Связанные группы в том же снимке" },
      { label: "Объявления", value: ownerCountLabel(adCount), detail: "Объявления без внутренних идентификаторов" },
      { label: "Условия показа", value: ownerCountLabel(targetingCount), detail: "Ключевые фразы и автотаргетинги вместе" },
    ],
    campaigns,
    queries: {
      status: queryAvailable ? "Доступно" : queryPartial ? "Частично" : "Недоступно",
      value: queryAvailable ? `${ownerCountPhrase(searchRows, "строка", "строки", "строк")} за период` : "Нет проверенного отчёта",
      detail: queryAvailable
        ? "Показано проверенное количество строк; сами формулировки остаются в защищённом исходном отчёте."
        : "Поисковые запросы неизвестны и не считаются пустыми.",
    },
    results: {
      status: resultAvailable ? metricComplete && campaignRows !== null ? "Доступно" : "Частично" : "Недоступно",
      value: goalVisitsCount !== null
        ? `${ownerCountPhrase(goalVisitsCount, "достижение", "достижения", "достижений")} цели`
        : campaignRows !== null ? `${ownerCountPhrase(campaignRows, "строка", "строки", "строк")} результата` : "Достижения цели недоступны",
      detail: metricAvailable
        ? `${visitsCount === null ? "Визиты недоступны" : ownerCountPhrase(visitsCount, "визит", "визита", "визитов")} за ${ownerText(metricPeriod.period_start, "начало периода не указано", 40)} — ${ownerText(metricPeriod.period_end, "конец периода не указан", 40)}. ${goalVisitsCount === null ? "Достижения цели не подтверждены. " : ""}Это наблюдение Метрики, не оценка прибыли.`
        : "Нет сопоставимого наблюдения бизнес-результата; эффективность не оценивается.",
    },
    limitations,
    nextActions,
  };
}

function answerValue(state: InternalState, fieldId: string): unknown {
  const strategySource = state.strategy ?? record(state.strategy_review).candidate;
  const answers = list(record(strategySource).answers);
  return record(answers.find((answer) => record(answer).field_id === fieldId)).value;
}

function questionnaireValue(state: InternalState, fieldId: string): unknown {
  const fields = list(record(state.strategy_questionnaire).fields);
  return record(fields.find((field) => record(field).field_id === fieldId)).recommended_value;
}

function preparedGoalInterviewQuestions(state: InternalState): OwnerGoalInterviewQuestion[] | null {
  const context = record(state.context_state);
  const provisionalGoal = ownerText(record(context.provisional_business_goal).value, "", 500);
  if (!provisionalGoal) return null;
  return [
    {
      key: "campaign-goal",
      prompt: "Какой бизнес-результат должна поддержать рекламная кампания?",
      target: { kind: "BUSINESS_GOAL" },
      materiality: {
        boundary: "MATERIAL_UNCERTAINTY",
        whyMaterial: "Бизнес-результат определяет цель кампании и способ оценки качественного обращения.",
        consequences: ["Исправление изменит цель кампании и зависимые рекомендации."],
      },
      recommendation: {
        answer: provisionalGoal,
        rationale: "Агент сформулировал ближайший проверяемый результат по доступным страницам бизнеса.",
        evidence: "Публичные страницы компании и доступное описание обращения клиента.",
        confidence: "MEDIUM",
      },
    },
    {
      key: "qualified-contact",
      prompt: "Как отличить качественное обращение от случайного?",
      materiality: {
        boundary: "MATERIAL_UNCERTAINTY",
        whyMaterial: "Критерий качества определяет, какое обращение поддерживает бизнес-цель кампании.",
        consequences: ["Ответ станет основанием для проверки сформированной модели бизнеса."],
      },
      recommendation: {
        answer: "Обращение от клиента, который подтвердил потребность в услуге и готов обсудить задачу.",
        rationale: "Такой критерий отделяет проверяемый бизнес-результат от любого заполнения формы.",
        evidence: "Подтверждённая владельцем цель кампании и доступный способ обращения на сайте.",
        confidence: "MEDIUM",
      },
    },
  ];
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

function protocolFields(drafts: Record<string, unknown>[]): OwnerActionField[] {
  return drafts.flatMap((draft, index) => {
    const protocol = record(draft.auction_protocol);
    const bidding = record(protocol.bidding);
    const split = record(protocol.traffic_split);
    const period = record(protocol.test_period);
    const name = ownerText(draft.campaign_name, `Кампания ${index + 1}`, 180);
    const key = (field: string) => `test${index + 1}_${field}`;
    return [
      { key: key("control"), label: `${name} · с чем сравниваем`, control: "textarea", value: ownerText(protocol.control, "", 1_000), required: true },
      { key: key("change"), label: `${name} · проверяемое изменение`, control: "textarea", value: ownerText(protocol.tested_change, "", 1_000), required: true },
      { key: key("bidding"), label: `${name} · подход к ставкам`, control: "textarea", value: ownerText(bidding.strategy, "", 300), required: true },
      { key: key("ceiling"), label: `${name} · предел ставки, ₽`, control: "number", value: Number(bidding.ceiling_rub), required: true },
      { key: key("matching"), label: `${name} · сопоставление запросов`, control: "textarea", value: ownerText(protocol.query_matching, "", 500), required: true },
      { key: key("autotargeting"), label: `${name} · автотаргетинг`, control: "textarea", value: ownerText(protocol.autotargeting_policy, "", 500), required: true },
      { key: key("comparatorTraffic"), label: `${name} · доля сравнения, %`, control: "number", value: Number(split.comparator_percent), required: true },
      { key: key("treatmentTraffic"), label: `${name} · доля изменения, %`, control: "number", value: Number(split.treatment_percent), required: true },
      { key: key("budget"), label: `${name} · бюджет теста, ₽`, control: "number", value: Number(protocol.test_budget_rub), required: true },
      { key: key("start"), label: `${name} · начало теста`, control: "date", value: ownerText(period.start_date, "", 10), required: true },
      { key: key("end"), label: `${name} · окончание теста`, control: "date", value: ownerText(period.end_date, "", 10), required: true },
      { key: key("goal"), label: `${name} · измеряемый результат`, control: "textarea", value: ownerText(protocol.measurement_goal, "", 1_000), required: true },
      { key: key("success"), label: `${name} · условие успеха`, control: "textarea", value: ownerText(protocol.success_threshold, "", 1_000), required: true },
      { key: key("stop"), label: `${name} · условие остановки`, control: "textarea", value: ownerText(protocol.stop_condition, "", 1_000), required: true },
    ] as OwnerActionField[];
  });
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

export function ownerActionDescriptor(view: InternalView): InternalActionDescriptor | null {
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
  const businessModelConfirmed = record(state.business_model).source === "REAL_SITE_RESEARCH_PLUS_OWNER_CONFIRMATION";
  const focusSelected = record(state.product_focus).decision_status === "OWNER_SELECTED"
    && Boolean(record(state.product_focus).selected_offer_id);
  if (!businessModelConfirmed) {
    return {
      kind: "confirm-business-model",
      label: "Подтвердить понимание бизнеса",
      description: "Подтвердите заполненное понимание; рутинное исследование остаётся работой агента.",
      fields: businessModelFields(state),
    };
  }
  if (!focusSelected) {
    const focusState = record(state.product_focus);
    const focus = record(focusState.focus_opportunities);
    const viableCards = list(focus.cards).map(record).filter((card) =>
      String(record(card.launch_readiness).status ?? "BLOCKED") !== "BLOCKED"
    );
    const focusOptions = viableCards.map((card) => ({
      value: String(card.offer_id ?? ""),
      label: ownerText(card.label, "Рекламный фокус", 300),
    })).filter((option) => option.value);
    if (focusOptions.length > 0) {
      const recommendedOfferId = String(focus.recommended_offer_id ?? "");
      return {
        kind: "select-focus",
        label: "Выбрать рекламный фокус",
        description: "Выберите один подготовленный фокус; стратегия и кампании будут привязаны только к нему.",
        fields: [{
          key: "focusOffer",
          label: "Рекламный фокус",
          control: "select",
          value: focusOptions.some((option) => option.value === recommendedOfferId)
            ? recommendedOfferId
            : focusOptions[0].value,
          required: true,
          options: focusOptions,
          help: "Заблокированные и недостаточно подтверждённые варианты недоступны.",
        }],
      };
    }
    const focusCards = list(focus.cards).map(record);
    if (focusCards.length === 0) {
      return {
        kind: "confirm-business-model",
        label: "Уточнить рекламируемое предложение",
        description: "Подтвердите одно конкретное предложение, чтобы агент восстановил проверяемый рекламный фокус для точной страницы услуги.",
        fields: businessModelFields(state),
      };
    }
    const focusBlockers = [...new Set(focusCards.flatMap((card) =>
      list(record(card.launch_readiness).blockers).map((blocker) => ownerText(blocker, "", 300)).filter(Boolean)
    ))].slice(0, 3);
    return {
      kind: "analyze-business",
      label: "Проверить посадочную страницу",
      description: focusBlockers.length
        ? `Подготовленный фокус заблокирован: ${focusBlockers.join(" ")} Укажите релевантную официальную страницу услуги для повторной безопасной проверки.`
        : "Подтверждённый оффер пока не связан с доступной точной посадочной страницей. Укажите релевантную страницу услуги для повторной безопасной проверки.",
      fields: [{
        key: "website",
        label: "Страница услуги",
        control: "url",
        value: ownerText(record(state.site_analysis).url, "", 1_500),
        required: true,
        help: "Используйте официальную HTTPS-страницу того же бизнеса с описанием выбранной услуги.",
      }],
    };
  }
  if (!state.strategy) {
    if (state.strategy_review?.status === "REVIEW_REQUIRED") return null;
    return {
      kind: "review-strategy",
      label: state.strategy_review?.status === "CHANGES_REQUESTED"
        ? "Проверить исправленную стратегию"
        : "Перейти к проверке стратегии",
      description: state.strategy_review?.status === "CHANGES_REQUESTED"
        ? "Исправьте сохранённые значения и снова откройте отдельную проверку точной версии."
        : "Сначала сохраните полную версию. Подтверждение будет отдельным следующим решением.",
      fields: strategyFields(state),
    };
  }

  const draftRevalidation = list(record(state.recommendation_set).drafts).map(record).find((draft) =>
    list(draft.publication_blockers).map(record).some((blocker) => blocker.code === "DRAFT_REVALIDATION_REQUIRED")
  );
  if (draftRevalidation) {
    return {
      kind: "revalidate-draft",
      target: String(draftRevalidation.draft_id ?? ""),
      label: "Повторно проверить изменённую кампанию",
      description: "Материальная правка создала новую неизменяемую версию. Агент заново проверит сравнительный score и все 9 бизнес-ограничений до нового решения.",
      fields: [],
    };
  }
  const protocolRevalidation = list(record(state.recommendation_set).drafts).map(record).find((draft) =>
    list(draft.publication_blockers).map(record).some((blocker) => blocker.code === "AUCTION_PROTOCOL_REVALIDATION_REQUIRED")
  );
  if (protocolRevalidation) {
    return {
      kind: "revalidate-auction-protocol",
      target: String(protocolRevalidation.draft_id ?? ""),
      label: "Повторно проверить изменённый тест",
      description: "Материальная правка уже создала новую версию кампании. Агент заново проверит score и все бизнес-ограничения до нового решения.",
      fields: [],
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
  if (state.package_execution?.items.some((item) => item.status === "REJECTED_NEEDS_EDIT"
    && !state.package_corrections.some((correction) => correction.source.item_execution_id === item.item_execution_id))
    || state.package_corrections.some((correction) => correction.status === "EDITING" || correction.status === "PACKAGE_REVIEW_REQUIRED")) {
    return null;
  }

  if (!state.package_review) {
    const candidates = orderedShortlistCandidates(view);
    if (candidates.length > 0) {
      const selectedOrder = new Map((state.shortlist?.selections ?? []).map((item, index) => [item.draft_id, index + 1]));
      const drafts = list(record(state.recommendation_set).drafts).map(record);
      return {
        kind: "prepare-package",
        label: "Проверить состав и порядок набора",
        description: "Агент предложил порядок. Укажите 0, чтобы исключить вариант, или поменяйте номера; заблокированные кампании недоступны. Сначала изменения сохраняются, затем повторное действие без новых изменений открывает точный пакет.",
        fields: [
          ...candidates.map((candidate, index) => ({
            key: `campaign_${index + 1}`,
            label: ownerText(drafts.find((draft) => draft.draft_id === candidate.draft_id)?.campaign_name, `Кампания ${index + 1}`, 255),
            control: "number" as const,
            value: selectedOrder.get(candidate.draft_id) ?? (candidate.status === "REMOVED" ? 0 : index + 1),
            required: true,
            help: "0 — исключить; положительное число — место в пакете.",
          })),
          ...protocolFields(candidates.map((candidate) => drafts.find((draft) => draft.draft_id === candidate.draft_id) ?? {})),
        ],
      };
    }
    return null;
  }
  if (!state.human_decision_gate && record(record(state.package_review).business_projection).preflight
    && record(record(record(state.package_review).business_projection).preflight).status === "BLOCKED") {
    const drafts = list(record(state.recommendation_set).drafts).map(record);
    return {
      kind: "edit-package",
      label: "Исправить бюджет или протокол пакета",
      description: "Предпубликационная проверка заблокирована. Измените показанные тестовые бюджеты или периоды; материальная правка потребует явной повторной проверки.",
      fields: protocolFields((state.shortlist?.selections ?? []).map((selection) =>
        drafts.find((draft) => draft.draft_id === selection.draft_id) ?? {}
      )),
    };
  }
  if (!state.human_decision_gate && allowed(view, "confirm_package")) {
    const drafts = list(record(state.recommendation_set).drafts).map(record);
    return {
      kind: "authorize-and-create",
      label: "Подтвердить точный пакет",
      description: "Одно решение выдаёт одноразовое полномочие только на показанный пакет и точные протоколы тестов. Подтверждение не создаёт кампании и не выполняет внешнюю запись.",
      fields: protocolFields((state.shortlist?.selections ?? []).map((selection) =>
        drafts.find((draft) => draft.draft_id === selection.draft_id) ?? {}
      )),
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

async function strategyReviewActionHandle(
  ownerKey: string,
  view: InternalView,
  kind: "confirm" | "reject" | "edit",
) {
  return opaqueHandle({
    ownerKey,
    state: view.revision,
    kind: `campaign-strategy-review-${kind}`,
    review: view.state.strategy_review?.review_id ?? null,
    strategy: record(view.state.strategy).strategy_revision_id ?? null,
  });
}

async function matchingStrategyReviewAction(ownerKey: string, view: InternalView, handle: string) {
  const review = view.state.strategy_review;
  if (review?.status === "REVIEW_REQUIRED") {
    if (allowed(view, "confirm_strategy_review") && handle === await strategyReviewActionHandle(ownerKey, view, "confirm")) {
      return { kind: "confirm" as const, review };
    }
    if (allowed(view, "reject_strategy_review") && handle === await strategyReviewActionHandle(ownerKey, view, "reject")) {
      return { kind: "reject" as const, review };
    }
  }
  if (view.state.strategy && allowed(view, "review_strategy") && handle === await strategyReviewActionHandle(ownerKey, view, "edit")) {
    return { kind: "edit" as const, review: null };
  }
  return null;
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

export function projectCompetitorMatrixForOwner(state: InternalState): OwnerJourneyProjection["competitorMatrix"] {
  const matrix = record(record(state.analytics_evidence_snapshot).competitor_matrix);
  const candidateSet = record(matrix.candidate_set);
  if (!Object.keys(candidateSet).length) return null;
  const candidates = list(candidateSet.candidates).map((candidateValue) => {
    const candidate = record(candidateValue);
    return {
      competitor: ownerPublicBrandName(candidate.competitor),
      rationale: ownerText(candidate.rationale),
      exactDestinations: list(candidate.exact_destinations).map((destination) => ownerText(destination, "Недоступно", 1_500)),
    };
  });
  const matrixRows = list(matrix.rows).map(record);
  const rows = matrixRows.map((row) => {
    const price = record(row.published_price);
    const source = record(row.source);
    const sample = record(row.ad_visibility_sample);
    const analysis = record(row.campaign_analysis);
    const sampleStatus = sample.status === "OBSERVED"
      ? "Объявление наблюдалось в одобренном артефакте"
      : sample.status === "NOT_OBSERVED_IN_SAMPLE"
        ? "В точном sample одобренного артефакта объявление не наблюдалось"
        : "UNAVAILABLE_NO_APPROVED_SOURCE · одобренный источник отсутствует";
    const analysisStatus = analysis.evidence_status === "OBSERVED_AD"
      ? "Анализ наблюдаемой рекламы"
      : analysis.evidence_status === "HYPOTHESIS_FROM_PUBLIC_POSITIONING"
        ? "Гипотеза по публичному позиционированию; запуск рекламы не доказан"
        : "Анализ кампании недоступен";
    const analysisSummary = Object.keys(analysis).length ? [
      `${analysisStatus}.`,
      `Паттерн: ${ownerText(analysis.pattern_label)}.`,
      `Тип: ${ownerText(analysis.campaign_type)}.`,
      `Сигнал аудитории: ${ownerText(analysis.audience_signal)}.`,
      `Сообщение: ${ownerText(analysis.ad_message)}.`,
      `Призыв: ${ownerText(analysis.call_to_action)}.`,
      `Связь со стратегией: ${ownerText(analysis.strategy_fit)}.`,
      `Что можно улучшить: ${ownerText(analysis.weakness).replace(/[.!?]+$/u, "")}.`,
      `Гипотеза: ${ownerText(analysis.improvement_hypothesis).replace(/[.!?]+$/u, "")}.`,
    ].join(" ") : analysisStatus;
    return {
      competitor: ownerPublicBrandName(row.competitor),
      productsServices: list(row.products_services).map((item) => ownerText(item)).join(", ") || "Недоступно",
      observedOfferMessage: ownerText(row.observed_offer_message),
      publishedPrice: price.status === "PUBLISHED" ? ownerText(price.value) : "Не опубликована",
      exactLanding: ownerText(row.exact_landing, "Недоступно", 1_500),
      source: `${ownerText(source.label)} · ${ownerText(source.url, "Недоступно", 1_500)}`,
      geography: row.geography === "UNAVAILABLE" ? "Недоступна" : ownerText(row.geography),
      device: row.device === "UNAVAILABLE" ? "Недоступно" : ownerText(row.device),
      observationDate: ownerText(row.observation_date, "Дата недоступна", 100),
      adObservationStatus: `${sampleStatus}. ${analysisSummary}`,
      adObservationSource: sample.source_name === null
        ? "Одобренный источник отсутствует"
        : `${sample.source_class === "OWNER_PROVIDED_ARTIFACT" ? "Артефакт владельца" : "Проверенный лицензированный провайдер"} · ${ownerText(sample.source_name)}`,
      adObservationDate: sample.observation_date === null ? "Наблюдение отсутствует" : ownerText(sample.observation_date, "Дата недоступна", 100),
      adObservationScope: `Запрос: ${sample.query === null ? "не задан" : ownerText(sample.query)}. География: ${ownerText(sample.geography, "недоступна")}. Устройство: ${ownerText(sample.device, "недоступно")}.`,
      adObservationLimitation: ownerText(sample.limitation, "Наблюдение не доказывает расходы, эффективность или активность вне точного sample."),
    };
  });
  const hypotheses = list(matrix.aggregate_claims).map(record)
    .filter((claim) => claim.claim_status === "OBSERVED_TECHNIQUE_NOT_PERFORMANCE_FACT" && Number(claim.observed_count) >= 2)
    .map((claim) => {
      const pattern = ownerText(claim.claim).replace(/^Наблюдаемый (?:рекламный паттерн|паттерн публичного позиционирования):\s*/u, "");
      const patternRow = matrixRows.find((row) => ownerText(record(row.campaign_analysis).pattern_label) === pattern);
      const analysis = record(patternRow?.campaign_analysis);
      const denominator = Number(claim.denominator);
      const observedCount = Number(claim.observed_count);
      return {
        pattern,
        hypothesis: ownerText(analysis.improvement_hypothesis),
        basis: `Техника наблюдалась у ${observedCount} из ${denominator} конкурентов. Правило набора: ${ownerText(claim.competitor_set_rule)}`,
        evidenceSet: list(claim.evidence_set).map((referenceValue) => {
          const reference = record(referenceValue);
          return {
            competitor: ownerPublicBrandName(reference.competitor),
            exactLanding: ownerText(reference.exact_landing, "Недоступно", 1_500),
            observationDate: ownerText(reference.observation_date, "Дата недоступна", 100),
          };
        }),
        limitation: `${ownerText(claim.limitation)} Это проверяемая гипотеза кампании, а не факт эффективности или прогноз результата.`,
      };
    });
  return {
    status: matrix.status === "AVAILABLE" ? "Доступно" : matrix.status === "PARTIAL" ? "Частично" : "Недоступно",
    competitorSetRule: ownerText(candidateSet.competitor_set_rule),
    candidates,
    rows,
    aggregateClaims: list(matrix.aggregate_claims).map((claimValue) => {
      const claim = record(claimValue);
      const denominator = Number(claim.denominator);
      const observedCount = Number(claim.observed_count);
      const observed = claim.observed_count === null || claim.observed_count === undefined
        ? "недоступно"
        : Number.isFinite(observedCount) && Number.isFinite(denominator) && denominator > 0
          ? `${observedCount} из ${denominator} (${Math.round(observedCount / denominator * 100)}%)`
          : String(claim.observed_count);
      return {
        claim: ownerText(claim.claim),
        scope: `${ownerText(claim.competitor_set_rule)} Знаменатель: ${denominator}.`,
        result: `Наблюдалось: ${observed}.`,
        limitation: ownerText(claim.limitation),
      };
    }),
    hypotheses,
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
  const wordstat = projectWordstatForPresentation(frequency, plan, market.batch_finished_at);
  const formulations: NonNullable<OwnerJourneyProjection["demandCostResearch"]>["demand"]["formulations"] = wordstat.formulations.map((row, index) => ({
    category: row.formulation_role === "RETURNED_TOP_ROW"
      ? "Популярная формулировка Wordstat"
      : ownerText(DEMAND_DIMENSION_LABELS[String(seeds[index]?.dimension)]),
    phrase: ownerText(row.phrase),
    frequency: row.frequency_label,
    status: row.status === "AVAILABLE" ? "Частота получена" as const : "Частота недоступна" as const,
    method: row.method_label,
    operator: row.operator_label,
    scope: row.scope_label,
    observedAt: ownerText(row.observed_at, "Дата наблюдения недоступна", 100),
    provenance: row.source_label,
  }));
  for (const dimension of dimensions) {
    if (seeds.some((seed) => seed.dimension === dimension.dimension)) continue;
    formulations.push({
      category: ownerText(DEMAND_DIMENSION_LABELS[String(dimension.dimension)]),
      phrase: "Формулировка недоступна из текущих подтверждённых данных",
      frequency: "Частота недоступна",
      status: "Формулировка недоступна",
      method: wordstat.method_label,
      operator: "Профиль формулировки недоступен",
      scope: "Область наблюдения недоступна",
      observedAt: "Дата наблюдения недоступна",
      provenance: "Яндекс Wordstat · официальное API",
    });
  }
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
      scope: wordstat.formulations[0]?.scope_label || [...regions, ...devices].join(" · ") || "Область наблюдения недоступна",
      method: wordstat.method_label,
      window: wordstat.window_label,
      coverage: wordstat.coverage_label,
      formulations,
      seasonality: seasonality.business_context
        ? `${ownerText(seasonality.business_context)} · месячная динамика ${ownerText(seasonality.from_date, "")} — ${ownerText(seasonality.to_date, "")}`
        : "Сезонный бизнес-контекст недоступен; месячная динамика сохраняется отдельно.",
      limitation: "Это нижняя граница возвращённых строк, а не число людей, кликов, показов или прогноз бюджета.",
      gaps: wordstat.gaps,
      nextAction: wordstat.next_action,
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
  GOAL_DUPLICATION: "Отсутствие дублирующей цели",
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

const MEASUREMENT_REPORT_STATE_LABELS: Record<string, NonNullable<OwnerJourneyProjection["businessReadiness"]>["measurement"]["report"]["state"]> = {
  READY: "Готово",
  RARE: "Редкие данные",
  STALE: "Устарело",
  ERROR: "Ошибка",
  UNAVAILABLE: "Недоступно",
};

export function projectMeasurementReadinessForOwner(value: unknown): NonNullable<OwnerJourneyProjection["businessReadiness"]>["measurement"] {
  const measurement = record(value);
  const report = record(measurement.report);
  const window = record(report.window);
  const freshness = record(report.freshness);
  const quality = record(report.quality);
  const start = ownerText(window.start, "начало недоступно", 20);
  const end = ownerText(window.end, "конец недоступен", 20);
  const reaches = report.reaches === null || report.reaches === undefined ? null : ownerCount(report.reaches);
  const state = MEASUREMENT_REPORT_STATE_LABELS[String(report.state)] ?? "Недоступно";
  const measurementChecks = list(measurement.checks).map(record);
  return {
    status: measurement.status === "READY" ? "Готово" : "Заблокировано",
    summary: measurement.status === "READY" ? "Выбранный бизнес-результат можно наблюдать в нужной области." : "Измеримость выбранного результата пока не доказана.",
    report: {
      state,
      conclusion: ownerText(report.conclusion, "Официальное наблюдение достижений недоступно; это не означает ноль.", 1_000),
      window: window.start && window.end ? `${start} — ${end}, обе даты включены` : "Окно отчёта недоступно",
      reaches: reaches === null ? "Недоступно — не ноль" : ownerCountPhrase(reaches, "достижение", "достижения", "достижений"),
      freshness: freshness.status === "CURRENT" ? `Конец окна не старше ${ownerCount(freshness.maximum_age_days) ?? 3} дней` : freshness.status === "STALE" ? `Конец окна устарел на ${ownerCount(freshness.age_days) ?? "неизвестное число"} дней` : "Свежесть не подтверждена",
      quality: [
        { label: "Выборка", value: quality.sampling === "UNSAMPLED" ? "Без выборки" : quality.sampling === "SAMPLED" ? `Ограничена выборкой${quality.sample_share === null || quality.sample_share === undefined ? "" : ` · доля ${Number(quality.sample_share) * 100}%`}` : "Недоступно" },
        { label: "Приватность", value: quality.privacy === "CLEAR" ? "Не ограничивает агрегат" : quality.privacy === "LIMITED" ? "Ограничивает доступное раскрытие" : "Недоступно" },
        { label: "Задержка", value: quality.data_lag_seconds === null || quality.data_lag_seconds === undefined ? "Недоступно" : `${ownerCountLabel(ownerCount(quality.data_lag_seconds))} сек.` },
        { label: "Размер", value: quality.sample_size === null || quality.sample_size === undefined ? "Недоступно" : `${ownerCountLabel(ownerCount(quality.sample_size))} из ${quality.sample_space === null || quality.sample_space === undefined ? "неизвестно" : ownerCountLabel(ownerCount(quality.sample_space))}` },
      ],
    },
    checks: measurementChecks.map((item) => ({
      label: ownerText(READINESS_CHECK_LABELS[String(item.code)], "Проверка измеримости"),
      result: item.status === "PASS" ? "Пройдено" : item.status === "NOT_APPLICABLE" ? "Не требуется" : item.status === "FAIL" ? "Не пройдено" : "Недоступно",
      limitation: item.limitation ? ownerText(item.limitation) : "Нет существенных ограничений для этой проверки",
    })),
  };
}

function businessReadinessProjection(state: InternalState): OwnerJourneyProjection["businessReadiness"] {
  const readiness = record(state.measurement_destination_readiness);
  if (!Object.keys(readiness).length) return null;
  const measurement = record(readiness.measurement);
  const destination = record(readiness.destination);
  const gate = record(readiness.human_decision_gate);
  return {
    status: readiness.status === "READY" ? "Готово" : "Заблокировано",
    measurement: projectMeasurementReadinessForOwner(measurement),
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
      confidence: gate.confidence === "LIMITED" ? "Ограниченная" : ownerText(gate.confidence, "Не определена"),
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

function ownerStrategyValue(fieldId: string, value: unknown) {
  if (fieldId === "period") {
    const period = record(value);
    return period.start_date && period.end_date
      ? `${ownerText(period.start_date, "", 20)} — ${ownerText(period.end_date, "", 20)}`
      : "Период не указан";
  }
  if (["weekly_budget", "target_result_cost"].includes(fieldId)) {
    return Number(value) > 0 ? `${Number(value).toLocaleString("ru-RU")} ₽` : "Не указано";
  }
  return ownerText(value);
}

function ownerStrategyVersionLabel(value: unknown) {
  const match = /-r(\d+)$/u.exec(String(value ?? ""));
  return `Версия ${match ? Number(match[1]) : 1}`;
}

async function campaignStrategyProjection(ownerKey: string, view: InternalView): Promise<OwnerJourneyProjection["campaignStrategy"]> {
  const state = view.state;
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
  const prelaunchCost = record(recommendation.prelaunch_cost);
  const prelaunchCostRange = record(prelaunchCost.range);
  const prelaunchCostSource = record(prelaunchCost.source);
  const prelaunchCostValue = prelaunchCost.status === "QUALIFIED_RANGE"
    ? `${Number(prelaunchCostRange.low).toLocaleString("ru-RU")}–${Number(prelaunchCostRange.high).toLocaleString("ru-RU")} ${ownerText(prelaunchCostRange.currency, "", 20)} за переход`
    : prelaunchCost.status === "OWNER_ECONOMICS_EDIT_REQUIRED"
      ? "Нужно уточнить экономику результата"
      : prelaunchCost.status === "COST_EVIDENCE_BLOCKED"
        ? "Конфликт стоимости блокирует подготовку"
        : "Ограниченный бюджетом тест трафика";
  const prelaunchCostRationale = [
    ownerText(prelaunchCost.uncertainty, "Сопоставимая стоимость перехода недоступна; это не нулевая цена."),
    ...(prelaunchCost.status === "QUALIFIED_RANGE" && prelaunchCostSource.kind
      ? [`Источник: ${ownerText(COST_SOURCE_LABELS[String(prelaunchCostSource.kind)], "Сопоставимый источник")}; наблюдение ${ownerText(prelaunchCostSource.observed_at, "без даты", 100)}.`]
      : []),
    ...list(prelaunchCost.consequences).map((item) => ownerText(item)),
    ...(prelaunchCost.owner_action ? [`Следующий шаг: ${ownerText(prelaunchCost.owner_action)}`] : []),
  ].join(" ");
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
  const review = state.strategy_review;
  const strategySource = state.strategy ?? review?.candidate ?? null;
  const strategyAnswers = new Map(list(record(strategySource).answers).map((value) => {
    const answer = record(value);
    return [String(answer.field_id), answer.value] as const;
  }));
  const reviewFields = list(questionnaire.fields).map(record);
  const ownerReview: NonNullable<OwnerJourneyProjection["campaignStrategy"]>["ownerReview"] = strategySource ? {
    status: approved ? "Подтверждена" : review?.status === "CHANGES_REQUESTED" ? "Возвращена к редактированию" : "Готова к подтверждению",
    versionLabel: ownerStrategyVersionLabel(record(strategySource).strategy_revision_id),
    exactBinding: "Эта версия одновременно связана с текущими моделью бизнеса, рекламным фокусом и снимком доказательств. Изменение любого из них отменяет подтверждение и снова закрывает переход к кампаниям.",
    summary: [
      {
        label: "Цель",
        value: ownerStrategyValue("business_goal", strategyAnswers.get("business_goal")),
        explanation: "Определяет бизнес-результат, ради которого создаются кампании.",
      },
      {
        label: "Бюджет",
        value: ownerStrategyValue("weekly_budget", strategyAnswers.get("weekly_budget")),
        explanation: "Недельная граница расходов; подтверждение стратегии само по себе не разрешает расходы.",
      },
      {
        label: "Измерение",
        value: record(recommendation.measurement).value === "EXACT_METRIKA_PRIMARY_GOAL" ? "Точная основная цель Метрики" : "Проверка измерения до запуска",
        explanation: ownerText(record(recommendation.measurement).rationale, "Измерение проверяется до создания кампаний."),
      },
      {
        label: "Неопределённость",
        value: economics.uncertainty ? "Существенная" : prelaunchCost.status === "QUALIFIED_RANGE" ? "Ограниченная диапазоном" : "Есть ограничения до запуска",
        explanation: ownerText(economics.uncertainty ?? prelaunchCost.uncertainty, "Неопределённость не скрывается прогнозом эффективности."),
      },
    ],
    decisions: reviewFields.map((field) => ({
      label: ownerText(STRATEGY_FIELD_LABELS[String(field.field_id)], "Существенное поле"),
      value: ownerStrategyValue(String(field.field_id), strategyAnswers.get(String(field.field_id))),
      evidence: `${ownerText(field.source_category, "Источник не указан")} · ${ownerText(field.explanation, "Основание требует проверки")}`,
      confidence: ownerText(field.status, "нужно проверить"),
    })),
    alternatives: list(gate.alternatives).map((item) => ownerText(item)).filter(Boolean).length
      ? list(gate.alternatives).map((item) => ownerText(item)).filter(Boolean)
      : ["Подтвердить точную показанную версию", "Вернуться к редактированию без открытия черновиков кампаний"],
    limitations: [...new Set([
      ...list(gate.evidence).map((item) => ownerText(item)),
      ...list(gate.consequences).map((item) => ownerText(item)),
      ownerText(economics.uncertainty, "", 600),
      ownerText(prelaunchCost.uncertainty, "", 600),
      "Подтверждение стратегии не разрешает публикацию, показы или расходы.",
    ].filter(Boolean))].slice(0, 8),
    confirmHandle: review?.status === "REVIEW_REQUIRED" && allowed(view, "confirm_strategy_review")
      ? await strategyReviewActionHandle(ownerKey, view, "confirm")
      : null,
    rejectHandle: review?.status === "REVIEW_REQUIRED" && allowed(view, "reject_strategy_review")
      ? await strategyReviewActionHandle(ownerKey, view, "reject")
      : null,
    editorHandle: approved && allowed(view, "review_strategy")
      ? await strategyReviewActionHandle(ownerKey, view, "edit")
      : null,
    editorFields: approved ? strategyFields(state) : [],
  } : null;
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
      ...(Object.keys(prelaunchCost).length ? [{
        label: "Стоимость перехода до запуска",
        value: prelaunchCostValue,
        rationale: prelaunchCostRationale,
        confidence: prelaunchCost.status === "QUALIFIED_RANGE" ? "Средняя" : "Ограниченная",
      }] : []),
    ],
    materialQuestions: approved ? [] : questions,
    decisionGate: !approved && Object.keys(gate).length ? {
      recommendation: ownerText(gate.recommendation),
      evidence: list(gate.evidence).map((item) => ownerText(item)).join(" · ") || "Перечисленные material gaps являются основанием решения.",
      confidence: gate.confidence === "MEDIUM" ? "Средняя" : "Ограниченная",
      alternatives: list(gate.alternatives).map((item) => ownerText(item)).join(" · "),
      consequences: list(gate.consequences).map((item) => ownerText(item)).join(" · "),
    } : null,
    ownerReview,
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

const OWNER_DRAFT_FIELD_SECTIONS = {
  CAMPAIGN: "Кампания",
  AD_GROUP: "Таргетинг",
  CRITERION: "Таргетинг",
  AD: "Объявление",
  ASSET: "Активы",
} as const;

const OWNER_DRAFT_CLASSIFICATIONS = {
  EDITABLE: "Редактируется",
  FIXED_BY_STRATEGY: "Зафиксировано стратегией",
  FIXED_BY_CAPABILITY: "Зафиксировано возможностями",
  CONDITIONALLY_ELIGIBLE: "Доступно после отдельной проверки",
} as const;

function ownerDraftRevisionLabel(value: unknown) {
  const match = /-r(\d+)$/u.exec(String(value ?? ""));
  return `Редакция ${match ? Number(match[1]) : 1}`;
}

function ownerDraftContractValue(pointer: string, value: unknown) {
  if (value === undefined || value === null) return "Не публикуется";
  if (pointer.endsWith("/TimeTargeting")) return "Ежедневно, круглосуточно по московскому времени";
  if (pointer.endsWith("/CounterIds")) return "Подтверждённый счётчик Метрики";
  if (pointer.endsWith("/WeeklySpendLimit") || pointer.endsWith("/BidCeiling")) {
    return `${Math.floor(Number(value) / 1_000_000).toLocaleString("ru-RU")} ₽`;
  }
  const labels: Record<string, string> = {
    YES: "Включено",
    NO: "Отключено",
    WB_MAXIMUM_CLICKS: "Максимум переходов в недельном бюджете",
    SERVING_OFF: "Показы отключены",
    "Europe/Moscow": "Москва",
  };
  if (typeof value === "string") return labels[value] ?? ownerText(value, "Не указано", 1_500);
  if (typeof value === "number") return value.toLocaleString("ru-RU");
  if (Array.isArray(value)) return value.map((item) => ownerText(item, "", 500)).filter(Boolean).join(", ") || "Не публикуется";
  const items = list(record(value).Items);
  if (items.length) return items.map((item) => ownerText(item, "", 500)).filter(Boolean).join(", ");
  return "Зафиксировано текущим профилем";
}

function ownerDraftContractExplanation(classification: keyof typeof OWNER_DRAFT_CLASSIFICATIONS) {
  if (classification === "EDITABLE") return "Сохраняется в новой редакции и входит в точную проекцию публикации.";
  if (classification === "FIXED_BY_STRATEGY") return "Изменяется только через отдельную утверждённую стратегию.";
  if (classification === "FIXED_BY_CAPABILITY") return "Определяется подтверждённым профилем возможностей выбранного аккаунта.";
  return "Не публикуется, пока отдельная проверка API и аккаунта не подтвердит поддержку.";
}

function draftPublicationFields(draft: Record<string, unknown>): OwnerActionField[] {
  return CAMPAIGN_DRAFT_EDITOR_CONTRACT.publication_fields
    .filter((field) => field.editable && field.input_name)
    .map((field) => {
      const key = String(field.input_name);
      const control: OwnerActionField["control"] = ["negative_keywords", "keyword", "ad_text"].includes(key) ? "textarea" : "text";
      return {
        key,
        label: field.label,
        control,
        value: ownerText(draft[key], "", Number(field.maximum_length ?? 1_000)),
        required: true,
        maximumLength: Number(field.maximum_length ?? 1_000),
        help: `Публикуется точно в текущей кампании. До ${Number(field.maximum_length).toLocaleString("ru-RU")} символов.`,
      };
    });
}

function draftProtocolFields(draft: Record<string, unknown>): OwnerActionField[] {
  const protocol = record(draft.auction_protocol);
  const bidding = record(protocol.bidding);
  const split = record(protocol.traffic_split);
  const period = record(protocol.test_period);
  const values: Record<string, string | number> = {
    control: ownerText(protocol.control, "", 1_000),
    tested_change: ownerText(protocol.tested_change, "", 1_000),
    bidding_strategy: ownerText(bidding.strategy, "", 300),
    bid_ceiling_rub: Number(bidding.ceiling_rub),
    query_matching: ownerText(protocol.query_matching, "", 500),
    autotargeting_policy: ownerText(protocol.autotargeting_policy, "", 500),
    comparator_percent: Number(split.comparator_percent),
    treatment_percent: Number(split.treatment_percent),
    test_budget_rub: Number(protocol.test_budget_rub),
    start_date: ownerText(period.start_date, "", 10),
    end_date: ownerText(period.end_date, "", 10),
    measurement_goal: ownerText(protocol.measurement_goal, "", 1_000),
    success_threshold: ownerText(protocol.success_threshold, "", 1_000),
    stop_condition: ownerText(protocol.stop_condition, "", 1_000),
  };
  return AUCTION_PROTOCOL_EDITOR_FIELDS.map((field) => ({
    key: field.key,
    label: field.label,
    control: field.control,
    value: values[field.key] ?? "",
    required: true,
    ...(field.maximum_length ? { maximumLength: field.maximum_length } : {}),
    ...(["bid_ceiling_rub", "test_budget_rub"].includes(field.key) ? { minimum: 1 } : {}),
    ...(["comparator_percent", "treatment_percent"].includes(field.key) ? { minimum: 0, maximum: 100 } : {}),
    help: "Существенная правка создаёт новую редакцию кампании и требует повторной проверки.",
  }));
}

function draftEditorFeedback(draft: Record<string, unknown>) {
  const currentVersion = String(draft.draft_revision_id ?? "");
  const draftSave = record(draft.draft_save_result);
  const protocolSave = record(draft.protocol_edit_result);
  const draftSaveIsCurrent = String(draftSave.current_draft_revision_id ?? "") === currentVersion;
  const protocolSaveIsCurrent = String(protocolSave.current_draft_revision_id ?? "") === currentVersion;
  if (protocolSaveIsCurrent && !draftSaveIsCurrent) return protocolSave.material_change === true
    ? "Сохранена новая редакция аукционного протокола. Балл и полномочие недействительны до повторной проверки."
    : "После нормализации протокол не изменился: сохранена прежняя редакция.";
  if (draftSaveIsCurrent) return draftSave.material_change === true
    ? "Сохранена новая неизменяемая редакция. Балл, предварительная проверка, список и полномочие недействительны до повторной проверки."
    : "После нормализации значения не изменились: сохранена прежняя редакция и действующие проверки.";
  if (protocolSaveIsCurrent) return protocolSave.material_change === true
    ? "Сохранена новая редакция аукционного протокола. Балл и полномочие недействительны до повторной проверки."
    : "После нормализации протокол не изменился: сохранена прежняя редакция.";
  return null;
}

async function draftEditorActionHandle(ownerKey: string, view: InternalView, draftId: string, kind: "publication" | "protocol") {
  return opaqueHandle({ ownerKey, state: view.revision, kind: `edit-campaign-draft-${kind}`, target: draftId });
}

async function matchingDraftEditorAction(ownerKey: string, view: InternalView, handle: string) {
  const drafts = list(record(view.state.recommendation_set).drafts)
    .map(record)
    .filter((draft) => draft.visibility !== "HIDDEN" && draft.draft_id);
  for (const draft of drafts) {
    const draftId = String(draft.draft_id);
    if (allowed(view, "save_draft") && handle === await draftEditorActionHandle(ownerKey, view, draftId, "publication")) {
      return { kind: "publication" as const, draft };
    }
    if (allowed(view, "save_auction_protocol") && handle === await draftEditorActionHandle(ownerKey, view, draftId, "protocol")) {
      return { kind: "protocol" as const, draft };
    }
  }
  return null;
}

async function campaignOptions(ownerKey: string, view: InternalView): Promise<OwnerJourneyProjection["campaignOptions"]> {
  const state = view.state;
  const recommendationSet = record(state.recommendation_set);
  const correctedDrafts = new Map(state.package_corrections
    .filter((correction) => correction.corrected_draft)
    .map((correction) => [correction.corrected_draft!.draft_id, correction.corrected_draft]));
  const drafts = list(recommendationSet.drafts).map((value) => {
    const draft = record(value);
    return correctedDrafts.get(String(draft.draft_id ?? "")) ?? value;
  });
  const recommendedIds = new Set(list(record(recommendationSet.recommended_shortlist).draft_ids).map(String));
  return Promise.all(drafts
    .filter((value) => record(value).visibility !== "HIDDEN")
    .slice(0, 6)
    .map(async (value, index) => {
      const draft = record(value);
      const draftId = String(draft.draft_id ?? "");
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
      const protocol = record(draft.auction_protocol);
      const protocolBidding = record(protocol.bidding);
      const protocolSplit = record(protocol.traffic_split);
      const protocolPeriod = record(protocol.test_period);
      const attribution = record(protocol.attribution);
      const blockerCodes = new Set(list(draft.publication_blockers).map((item) => String(record(item).code ?? "")));
      const revalidationRequired = blockerCodes.has("DRAFT_REVALIDATION_REQUIRED") || blockerCodes.has("AUCTION_PROTOCOL_REVALIDATION_REQUIRED");
      const validationStatus = revalidationRequired ? "Требуется повторная проверка" as const
        : Object.keys(score).length ? "Проверена" as const : "Балл недействителен" as const;
      const publicationContract = CAMPAIGN_DRAFT_EDITOR_CONTRACT.publication_fields.map((field) => ({
        section: OWNER_DRAFT_FIELD_SECTIONS[field.object_kind],
        label: field.label,
        classification: OWNER_DRAFT_CLASSIFICATIONS[field.classification],
        value: ownerDraftContractValue(field.pointer, projectionFieldValue(draft.publish_projection, field.pointer)),
        explanation: ownerDraftContractExplanation(field.classification),
      }));
      return {
        name: ownerText(draft.campaign_name, `Кампания ${index + 1}`, 255),
        audience: ownerText(answerValue(state, "target_audience"), "Целевая аудитория уточняется", 500),
        offer: ownerText(answerValue(state, "advertised_offer"), "Предложение уточняется", 500),
        destination: ownerText(answerValue(state, "landing_page"), "Посадочная страница уточняется", 1_500),
        status,
        readiness: status === "BLOCKED" ? "Заблокирована" as const
          : status === "INSUFFICIENT_EVIDENCE" ? "Недостаточно доказательств" as const
            : status === "TESTABLE_WITH_GAPS" ? "Есть существенные пробелы" as const : "Готова к проверке" as const,
        comparativeScore: score.score === null || score.score === undefined ? "Не рассчитывается до прохождения обязательных условий" : `${score.score}/100 · только сравнительный приоритет, не прогноз`,
        evidenceCoverage: `${Number(coverage.percent ?? 0)}%`,
        sensitivity: score.score_lower === null || score.score_lower === undefined ? "Недоступна до оценки" : `${score.score_lower}–${score.score_upper}`,
        reasons,
        auctionProtocol: {
          control: ownerText(protocol.control),
          testedChange: ownerText(protocol.tested_change),
          biddingStrategy: ownerText(protocolBidding.strategy),
          bidCeiling: `${Number(protocolBidding.ceiling_rub).toLocaleString("ru-RU")} ₽`,
          queryMatching: ownerText(protocol.query_matching),
          autotargetingPolicy: ownerText(protocol.autotargeting_policy),
          trafficSplit: `${Number(protocolSplit.comparator_percent)}% сравнение · ${Number(protocolSplit.treatment_percent)}% изменение`,
          testBudget: `${Number(protocol.test_budget_rub).toLocaleString("ru-RU")} ₽`,
          testPeriod: `${ownerText(protocolPeriod.start_date, "Недоступно", 20)} — ${ownerText(protocolPeriod.end_date, "Недоступно", 20)}`,
          measurementGoal: ownerText(protocol.measurement_goal),
          successThreshold: ownerText(protocol.success_threshold),
          stopCondition: ownerText(protocol.stop_condition),
          attribution: attribution.status === "ONE_FACTOR" ? "Однофакторное сравнение"
            : attribution.status === "COMPARATOR_ONLY" ? "Контроль для сравнения"
              : attribution.status === "MULTI_FACTOR" ? "Многофакторная гипотеза — результат нельзя приписать одному изменению"
                : "Несопоставимая гипотеза — причинная атрибуция запрещена",
          evidenceStatus: "Предположение теста отделено от зафиксированных фактов рекламной системы",
        },
        publishPreview: buildOwnerPublishPreview(record(draft.publish_projection)),
        editor: {
          versionLabel: ownerDraftRevisionLabel(draft.draft_revision_id),
          validationStatus,
          validationExplanation: revalidationRequired
            ? "Балл, предварительная проверка, короткий список и прежнее полномочие не действуют для этой редакции."
            : validationStatus === "Проверена"
              ? "Балл и проекция рассчитаны для этой точной сохранённой редакции."
              : "Кампания не может войти в пакет, пока её балл и проекция не проверены заново.",
          publicationHandle: allowed(view, "save_draft") ? await draftEditorActionHandle(ownerKey, view, draftId, "publication") : null,
          publicationFields: draftPublicationFields(draft),
          protocolHandle: allowed(view, "save_auction_protocol") ? await draftEditorActionHandle(ownerKey, view, draftId, "protocol") : null,
          protocolFields: draftProtocolFields(draft),
          publicationContract,
          capabilityBoundaries: CAMPAIGN_DRAFT_EDITOR_CONTRACT.capability_boundaries.map((boundary) => ({
            label: boundary.label,
            classification: boundary.classification === "CONDITIONALLY_ELIGIBLE" ? "Доступно после отдельной проверки" as const : "Не поддерживается" as const,
            explanation: boundary.reason,
          })),
          feedback: draftEditorFeedback(draft),
        },
        selected,
        agentRecommended: recommendedIds.has(draftId),
      };
    }));
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
  const businessProjection = record(state.package_review.business_projection);
  const preflight = record(businessProjection.preflight);
  const alignment = record(businessProjection.budget_alignment);
  const alignmentLabels: Record<string, NonNullable<OwnerJourneyProjection["packageSummary"]>["budgetAlignment"]["classification"]> = {
    ALIGNED: "Соответствует",
    LIMITED_TEST: "Ограниченный тест",
    REQUIRED_EDIT: "Нужно изменить",
    BLOCKER: "Заблокировано",
  };
  const correctedItemIds = new Set(state.package_corrections
    .filter((correction) => correction.terminal_outcome === "PASS_AFTER_CORRECTION")
    .map((correction) => correction.source.item_execution_id));
  const completed = Boolean(execution?.items.length)
    && execution!.items.every((item) => item.status === "DIRECT_ACCEPTED" || correctedItemIds.has(item.item_execution_id));
  return {
    campaignCount: state.shortlist?.selections.length ?? 0,
    preflight: `${Number(preflight.passed ?? 0)}/${Number(preflight.total ?? 9)} бизнес-проверок ${preflight.status === "PASS" ? "пройдено" : "требуют внимания"}`,
    preflightGates: list(preflight.gates).map((value) => {
      const item = record(value);
      return {
        label: ownerText(item.label),
        status: item.status === "PASS" ? "Пройдено" as const : "Заблокировано" as const,
        explanation: ownerText(item.explanation),
      };
    }),
    strategyMonthlyBudget: `${Number(alignment.strategy_monthly_budget_rub ?? 0).toLocaleString("ru-RU")} ₽ в месяц`,
    orderedPackageBudget: `${Number(alignment.ordered_package_sum_rub ?? 0).toLocaleString("ru-RU")} ₽`,
    budgetAlignment: {
      classification: alignmentLabels[String(alignment.classification)] ?? "Заблокировано",
      explanation: ownerText(alignment.explanation, "Арифметическое сопоставление недоступно; это не прогноз результата."),
    },
    campaignBudgets: list(alignment.campaigns).map((value) => {
      const item = record(value);
      const period = record(item.period);
      return {
        name: ownerText(item.campaign_name),
        budget: `${Number(item.test_budget_rub ?? 0).toLocaleString("ru-RU")} ₽`,
        period: `${ownerText(period.start_date, "Недоступно", 20)} — ${ownerText(period.end_date, "Недоступно", 20)}`,
      };
    }),
    execution: execution
      ? completed ? "Создание завершено" : "Агент продолжает создание и проверку"
      : state.human_decision_gate
        ? "Решение записано без внешней записи; реальное создание требует отдельного следующего разрешения"
        : "Ожидает решения владельца",
    outcomes: (execution?.items ?? []).map((item, index) => ({
      campaign: campaigns[index]?.name ?? `Кампания ${index + 1}`,
      outcome: correctedItemIds.has(item.item_execution_id)
        ? "Исправлена, создана и оставлена без показов"
        : executionOutcome(item.status),
    })),
  };
}

async function packageDecisionHandle(
  ownerKey: string,
  view: InternalView,
  verdict: "ACCEPTED" | "REJECTED",
) {
  const review = view.state.package_review;
  if (!review) return null;
  return opaqueHandle({
    ownerKey,
    state: view.revision,
    kind: "package-owner-decision",
    verdict,
    packageReview: review.package_review_id,
    package: review.package_id,
  });
}

async function packageDecisionProjection(
  ownerKey: string,
  view: InternalView,
): Promise<OwnerJourneyProjection["packageDecision"]> {
  const state = view.state;
  const review = state.package_review;
  if (!review) return null;
  const accepted = state.human_decision_gate
    ? state.package_owner_decisions.find((decision) => decision.decision_id === state.human_decision_gate?.owner_decision_id) ?? null
    : null;
  const explanation = accepted?.explanation ?? {
    recommendation: "Принять только показанный точный пакет после полной проверки, если его состав, порядок и ограничения соответствуют вашему решению.",
    alternatives: ["Принять точный пакет без внешней записи", "Отклонить пакет и вернуться к редактированию"],
    consequences: [
      "Принятие фиксирует одноразовое полномочие только для показанных неизменяемых версий.",
      "Отклонение не выдаёт полномочие и не меняет внешнюю систему.",
    ],
    risks: [
      "Существенное изменение или устаревшая версия отменяют решение и полномочие.",
      "Полномочие не разрешает показы, расходы или возобновление кампаний.",
      "Агент и модель не могут расширить состав пакета, аккаунт или разрешённые действия.",
    ],
    next_real_stage: "Создание точных кампаний в остановленном состоянии возможно только на следующем отдельно разрешаемом реальном этапе.",
  };
  const drafts = state.recommendation_set?.drafts ?? [];
  const alignment = review.business_projection.budget_alignment;
  const campaigns = review.authority.ordered_selections.map((selection, index) => {
    const draft = drafts.find((item) => item.draft_id === selection.draft_id);
    const budget = alignment.campaigns.find((item) => item.draft_id === selection.draft_id);
    return {
      order: index + 1,
      name: ownerText(draft?.campaign_name, `Кампания ${index + 1}`, 255),
      budget: `${Number(budget?.test_budget_rub ?? 0).toLocaleString("ru-RU")} ₽`,
      period: `${ownerText(budget?.period.start_date, "Недоступно", 20)} — ${ownerText(budget?.period.end_date, "Недоступно", 20)}`,
    };
  });
  const canDecide = !state.human_decision_gate
    && allowed(view, "confirm_package")
    && allowed(view, "reject_package");
  return {
    status: accepted ? "Принято" : "Нужно решение",
    exactVersion: `${campaigns.length} ${campaigns.length === 1 ? "кампания" : "кампании"} · ${review.business_projection.preflight.passed}/9 проверок · состав и порядок зафиксированы`,
    recommendation: explanation.recommendation,
    alternatives: structuredClone(explanation.alternatives),
    consequences: structuredClone(explanation.consequences),
    risks: structuredClone(explanation.risks),
    nextRealStage: explanation.next_real_stage,
    safety: accepted
      ? "Решение записано. Внешних записей — 0, показы — 0, расходы — 0. Реальное создание не началось."
      : "Это решение только записывает принятие или отклонение. Внешних записей, показов и расходов не будет.",
    campaigns,
    acceptHandle: canDecide ? await packageDecisionHandle(ownerKey, view, "ACCEPTED") : null,
    rejectHandle: canDecide ? await packageDecisionHandle(ownerKey, view, "REJECTED") : null,
    history: state.package_owner_decisions.map((decision) => ({
      verdict: decision.verdict === "ACCEPTED" ? "Принято" as const : "Отклонено" as const,
      decidedAt: ownerObservedAt(decision.decided_at),
      exactVersion: `${decision.exact_review.authority.ordered_selections.length} ${decision.exact_review.authority.ordered_selections.length === 1 ? "кампания" : "кампании"} · точный состав сохранён`,
    })),
  };
}

async function matchingPackageDecisionAction(
  ownerKey: string,
  view: InternalView,
  handle: string,
) {
  if (!view.state.package_review || view.state.human_decision_gate) return null;
  for (const verdict of ["ACCEPTED", "REJECTED"] as const) {
    if (handle === await packageDecisionHandle(ownerKey, view, verdict)) return verdict;
  }
  return null;
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
  if (state.package_corrections.some((correction) => correction.status === "HUMAN_GATE_REQUIRED")) {
    return { status: "ready", headline: "Исправление подготовлено к решению", summary: "Исходный отказ сохранён отдельно; новая формулировка ещё не получила полномочие и не отправлялась повторно." };
  }
  if (state.package_execution?.items.some((item) => item.status === "REJECTED_NEEDS_EDIT")) {
    return { status: "working", headline: "Формулировку нужно исправить", summary: "Агент готовит исправленную кампанию и вернётся только с новым бизнес-решением." };
  }
  if (state.package_execution?.items.some((item) => item.status === "RECONCILIATION_REQUIRED" || item.status === "OUTCOME_UNKNOWN")) {
    return { status: "blocked", headline: "Создание остановлено до безопасной сверки", summary: "Неоднозначный результат не считается успехом. Агент продолжит только проверяемую сверку и не повторит запись вслепую." };
  }
  if (state.package_execution?.items.some((item) => item.status === "SYSTEM_FAILED" || item.status === "PROVIDER_REJECTED")) {
    return { status: "blocked", headline: "Часть кампаний безопасно не создана", summary: "Каждый результат сохранён отдельно; подтверждённые остановленные кампании не смешаны с отказами или сбоями." };
  }
  if (state.human_decision_gate && !state.package_execution) {
    return { status: "complete", headline: "Решение по точному пакету записано", summary: "Внешних записей, показов и расходов не было. Реальное создание требует следующего отдельного разрешения." };
  }
  return { status: "ready", headline: "Пакет готов к точному решению", summary: "Проверьте бизнес-состав пакета. Принятие или отклонение только сохранит решение без внешней записи." };
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
  if (state.package_corrections.some((correction) => correction.status === "HUMAN_GATE_REQUIRED")) {
    return { headline: "Подтвердить подготовленное исправление", rationale: "Новая формулировка прошла тот же бизнес-редактор и полную проверку, но исходный отказ и новое решение остаются раздельными." };
  }
  if (state.human_decision_gate && !state.package_execution) {
    return { headline: "Точный пакет принят без внешней записи", rationale: "Одноразовое полномочие связано только с показанными версиями; показы, расходы и возобновление запрещены, а реальное создание требует отдельного следующего разрешения." };
  }
  return { headline: "Принять или отклонить точный пакет", rationale: "Одно явное решение будет записано только для показанного состава. На этом этапе внешней записи, показов и расходов не будет." };
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
  const rejectedItem = state.package_execution?.items.find((item) => item.status === "REJECTED_NEEDS_EDIT");
  if (rejectedItem) {
    result.push({
      kind: "problem",
      title: "Формулировка не принята",
      body: "Рекламная система не приняла формулировку. Исходный результат сохранён отдельно, показы не запускались, а агент готовит исправленную кампанию через ту же полную проверку.",
    });
  }
  if (state.package_execution?.items.some((item) => item.status === "RECONCILIATION_REQUIRED" || item.status === "OUTCOME_UNKNOWN")) {
    result.push({
      kind: "problem",
      title: "Нужна безопасная сверка результата",
      body: "Результат внешней записи неоднозначен и не считается успехом. Повторная запись запрещена, пока агент не подтвердит фактическое состояние.",
    });
  } else if (state.package_execution?.items.some((item) => item.status === "SYSTEM_FAILED" || item.status === "PROVIDER_REJECTED")) {
    result.push({
      kind: "problem",
      title: "Одна из кампаний безопасно не создана",
      body: "Сбой или явный отказ учтён отдельно и не изменил результаты остальных кампаний; показы и расходы не начинались.",
    });
  }
  for (const item of unknowns.slice(0, 3)) result.push({ kind: "problem", title: "Существенное неизвестное", body: item });
  const descriptor = ownerActionDescriptor(view);
  const gateKinds: ActionKind[] = ["confirm-goal", "confirm-business-model", "select-focus", "review-strategy", "authorize-and-create", "authorize-correction"];
  if (descriptor && gateKinds.includes(descriptor.kind)) {
    const current = recommendation(view, stage);
    const correctionDecision = descriptor.kind === "authorize-correction";
    const preparedCorrection = correctionDecision
      ? state.package_corrections.find((correction) => correction.correction_id === descriptor.target)
      : null;
    result.push({
      kind: "human-decision-gate",
      title: correctionDecision ? "Подготовлено решение по исправлению" : "Нужно существенное решение владельца",
      body: descriptor.description,
      facts: [
        { label: "Рекомендация", value: current?.headline ?? descriptor.label },
        { label: "Основание", value: correctionDecision
          ? `Исправленная формулировка: ${ownerText(preparedCorrection?.corrected_draft?.ad_text, "Подготовленное исправление", 1_000)}`
          : current?.rationale ?? "Агент использовал все доступные разрешённые evidence." },
        { label: "Уверенность", value: correctionDecision ? "Исправление проверено, но итог повторной модерации определяет рекламная система" : unknowns.length ? "Ограничена указанными существенными неизвестными" : "Достаточна для подготовленного решения" },
        { label: "Альтернатива", value: correctionDecision ? "Сохранить исходный отказ и не отправлять исправление" : "Скорректировать показанный бизнес-смысл без расширения полномочий" },
        { label: "Последствие", value: correctionDecision ? "После отдельного точного решения агент повторно отправит только исправленную кампанию; показы и расходы не начнутся" : descriptor.description },
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
  const baseDescriptor = ownerActionDescriptor(view);
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
  const campaigns = await campaignOptions(ownerKey, view);
  const goalInterview = view.state.owner_goal_interview
    ? await projectOwnerGoalInterview(ownerKey, view.state.owner_goal_interview)
    : null;
  const context = record(view.state.context_state);
  const campaignGoal = ownerText(
    record(context.business_goal_decision).value ?? record(context.provisional_business_goal).value,
    "",
    500,
  ) || null;
  return {
    accessReadiness: access,
    goalInterview,
    campaignGoal,
    campaignGoalConfirmed: Boolean(record(context.business_goal_decision).owner_confirmed),
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
    directReport: projectDirectAuditForOwner(view.state.analytics_evidence_snapshot),
    competitorMatrix: projectCompetitorMatrixForOwner(view.state),
    analyticsSummary: projectAnalyticsEvidenceForOwner(view.state.analytics_evidence_snapshot),
    demandCostResearch: projectDemandCostResearchForOwner(view.state.analytics_evidence_snapshot),
    businessModel: businessModelProjection(view.state),
    campaignStrategy: await campaignStrategyProjection(ownerKey, view),
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
    packageDecision: await packageDecisionProjection(ownerKey, view),
    primaryAction: descriptor && descriptor.kind !== "authorize-and-create" && !goalInterview?.primaryAction ? {
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
    goalInterview: null,
    campaignGoal: null,
    campaignGoalConfirmed: false,
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
    directReport: null,
    competitorMatrix: null,
    analyticsSummary: null,
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
    packageDecision: null,
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

function ownerStrategyAnswers(values: Record<string, unknown>) {
  return {
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
  };
}

function normalizedFirstPartyHost(value: unknown) {
  try {
    return new URL(String(value ?? "")).hostname.toLowerCase().replace(/^www\./u, "");
  } catch {
    return "";
  }
}

export function strategyLandingRequiresContextReanalysis(state: InternalState, landingPage: string) {
  const analyzedHost = normalizedFirstPartyHost(record(state.site_analysis).url);
  const requestedHost = normalizedFirstPartyHost(landingPage);
  if (!analyzedHost || !requestedHost) return false;
  const sameFirstParty = analyzedHost === requestedHost
    || analyzedHost.endsWith(`.${requestedHost}`)
    || requestedHost.endsWith(`.${analyzedHost}`);
  return !sameFirstParty;
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

  async snapshot(ownerKey: string): Promise<OwnerJourneyProjection> {
    const accessState = this.accessReadiness ? await this.accessReadiness.get(ownerKey) : null;
    const access = accessState && this.accessReadiness ? this.accessReadiness.project(accessState) : null;
    if (accessState && !accessIsActive(accessState)) return projectAccessOnly(ownerKey, accessState, access!);
    return project(ownerKey, await this.application.query(ownerKey), null, access);
  }

  async query(ownerKey: string): Promise<OwnerJourneyProjection> {
    const accessState = this.accessReadiness ? await this.accessReadiness.get(ownerKey, true) : null;
    const access = accessState && this.accessReadiness ? this.accessReadiness.project(accessState) : null;
    if (accessState && !accessIsActive(accessState)) return projectAccessOnly(ownerKey, accessState, access!);
    const initial = await this.application.query(ownerKey);
    if (!this.agentProjection) return project(ownerKey, await this.continueSafeWork(ownerKey, initial, false), null, access);
    const agent = await this.agentProjection(ownerKey);
    const current = await this.application.query(ownerKey);
    return project(ownerKey, current, agent, access);
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
      if (!this.agentProjection) return project(ownerKey, await this.continueSafeWork(ownerKey, initial, false), null, nextAccess);
      const agent = await this.agentProjection(ownerKey);
      const current = await this.application.query(ownerKey);
      return project(ownerKey, current, agent, nextAccess);
    }

    let view = await this.application.query(ownerKey);
    const interview = view.state.owner_goal_interview
      ? await projectOwnerGoalInterview(ownerKey, view.state.owner_goal_interview)
      : null;
    if (interview?.primaryAction) {
      if (submission.handle !== interview.primaryAction.handle) {
        throw new P0ApplicationError("P0_OWNER_ACTION_STALE", "Действие больше не соответствует текущему состоянию. Обновите страницу.");
      }
      const confirmingBusinessGoal = view.state.owner_goal_interview?.phase === "confirmation"
        && view.state.owner_goal_interview.current.target?.kind === "BUSINESS_GOAL";
      view = await this.application.submitOwnerGoalInterview(ownerKey, {
        expected_revision: view.revision,
        submission,
      });
      if (confirmingBusinessGoal && view.state.context_state?.business_goal_decision && !view.state.business_model) {
        view = await this.application.command(ownerKey, {
          action: "confirm_context_goal",
          expected_revision: view.revision,
          confirmation: "CONFIRM_CONTEXT_GOAL",
          goal: view.state.context_state.business_goal_decision.value,
        });
      }
      const agent = this.agentProjection ? await this.agentProjection(ownerKey) : null;
      if (agent) view = await this.application.query(ownerKey);
      const access = accessState && this.accessReadiness ? this.accessReadiness.project(accessState) : null;
      return project(ownerKey, view, agent, access);
    }
    const strategyReviewAction = await matchingStrategyReviewAction(ownerKey, view, submission.handle);
    if (strategyReviewAction) {
      const values = record(submission.values);
      if (strategyReviewAction.kind === "edit") {
        const answers = ownerStrategyAnswers(values);
        if (strategyLandingRequiresContextReanalysis(view.state, answers.landing_page)) {
          view = await this.application.command(ownerKey, {
            action: "analyze_site",
            expected_revision: view.revision,
            url: answers.landing_page,
          });
        } else {
          view = await this.application.command(ownerKey, {
            action: "review_strategy",
            expected_revision: view.revision,
            answers,
          });
        }
      } else if (strategyReviewAction.kind === "reject") {
        view = await this.application.command(ownerKey, {
          action: "reject_strategy_review",
          expected_revision: view.revision,
          review_id: strategyReviewAction.review.review_id,
        });
      } else {
        view = await this.application.command(ownerKey, {
          action: "confirm_strategy_review",
          expected_revision: view.revision,
          confirmation: "CONFIRM_EXACT_CAMPAIGN_STRATEGY",
          review_id: strategyReviewAction.review.review_id,
          strategy_revision_id: strategyReviewAction.review.candidate.strategy_revision_id,
        });
      }
      const agent = this.agentProjection ? await this.agentProjection(ownerKey) : null;
      if (agent) view = await this.application.query(ownerKey);
      const access = accessState && this.accessReadiness ? this.accessReadiness.project(accessState) : null;
      return project(ownerKey, view, agent, access);
    }
    const packageDecisionAction = await matchingPackageDecisionAction(ownerKey, view, submission.handle);
    if (packageDecisionAction) {
      const review = view.state.package_review!;
      view = await this.application.command(ownerKey, {
        action: packageDecisionAction === "ACCEPTED" ? "confirm_package" : "reject_package",
        expected_revision: view.revision,
        confirmation: packageDecisionAction === "ACCEPTED"
          ? "CONFIRM_EXACT_SHORTLIST_PACKAGE"
          : "REJECT_EXACT_SHORTLIST_PACKAGE",
        package_review_id: review.package_review_id,
        package_id: review.package_id,
      });
      const access = accessState && this.accessReadiness ? this.accessReadiness.project(accessState) : null;
      return project(ownerKey, view, null, access);
    }
    const draftEditorAction = await matchingDraftEditorAction(ownerKey, view, submission.handle);
    if (draftEditorAction) {
      const values = record(submission.values);
      const draftId = String(draftEditorAction.draft.draft_id);
      if (draftEditorAction.kind === "publication") {
        view = await this.application.command(ownerKey, {
          action: "save_draft",
          expected_revision: view.revision,
          value: {
            draft_id: draftId,
            campaign_name: required(values, "campaign_name"),
            group_name: required(values, "group_name"),
            negative_keywords: required(values, "negative_keywords"),
            keyword: required(values, "keyword"),
            ad_title: required(values, "ad_title"),
            ad_text: required(values, "ad_text"),
          },
        });
      } else {
        view = await this.application.command(ownerKey, {
          action: "save_auction_protocol",
          expected_revision: view.revision,
          value: {
            draft_id: draftId,
            control: required(values, "control"),
            tested_change: required(values, "tested_change"),
            bidding: {
              strategy: required(values, "bidding_strategy"),
              ceiling_rub: required(values, "bid_ceiling_rub"),
            },
            query_matching: required(values, "query_matching"),
            autotargeting_policy: required(values, "autotargeting_policy"),
            traffic_split: {
              comparator_percent: required(values, "comparator_percent"),
              treatment_percent: required(values, "treatment_percent"),
            },
            test_budget_rub: required(values, "test_budget_rub"),
            test_period: {
              start_date: required(values, "start_date"),
              end_date: required(values, "end_date"),
            },
            measurement_goal: required(values, "measurement_goal"),
            success_threshold: required(values, "success_threshold"),
            stop_condition: required(values, "stop_condition"),
          },
        });
      }
      const agent = this.agentProjection ? await this.agentProjection(ownerKey) : null;
      if (agent) view = await this.application.query(ownerKey);
      const access = accessState && this.accessReadiness ? this.accessReadiness.project(accessState) : null;
      return project(ownerKey, view, agent, access);
    }
    const descriptor = ownerActionDescriptor(view);
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
    const saveProtocols = async (drafts: Record<string, unknown>[]) => {
      let materialChange = false;
      for (const [index, draft] of drafts.entries()) {
        const key = (field: string) => `test${index + 1}_${field}`;
        await command({
          action: "save_auction_protocol",
          value: {
            draft_id: draft.draft_id,
            control: required(values, key("control")),
            tested_change: required(values, key("change")),
            bidding: { strategy: required(values, key("bidding")), ceiling_rub: required(values, key("ceiling")) },
            query_matching: required(values, key("matching")),
            autotargeting_policy: required(values, key("autotargeting")),
            traffic_split: {
              comparator_percent: required(values, key("comparatorTraffic")),
              treatment_percent: required(values, key("treatmentTraffic")),
            },
            test_budget_rub: required(values, key("budget")),
            test_period: { start_date: required(values, key("start")), end_date: required(values, key("end")) },
            measurement_goal: required(values, key("goal")),
            success_threshold: required(values, key("success")),
            stop_condition: required(values, key("stop")),
          },
        });
        materialChange ||= record(view.state.draft?.protocol_edit_result).material_change === true;
        if (materialChange) break;
      }
      return materialChange;
    };

    if (descriptor.kind === "analyze-business") {
      await command({ action: "analyze_site", url: required(values, "website") });
      if (!view.state.owner_goal_interview) {
        const questions = preparedGoalInterviewQuestions(view.state);
        if (questions) {
          view = await this.application.startOwnerGoalInterview(ownerKey, {
            expected_revision: view.revision,
            interview_key: `owner-goal-${view.revision}`,
            questions,
          });
        }
      }
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
    } else if (descriptor.kind === "select-focus") {
      await command({
        action: "select_focus",
        confirmation: "SELECT_PRODUCT_FOCUS",
        focus_offer_id: required(values, "focusOffer"),
      });
    } else if (descriptor.kind === "review-strategy") {
      const answers = ownerStrategyAnswers(values);
      if (strategyLandingRequiresContextReanalysis(view.state, answers.landing_page)) {
        await command({ action: "analyze_site", url: answers.landing_page });
      } else {
        await command({ action: "review_strategy", answers });
      }
    } else if (descriptor.kind === "revalidate-draft") {
      await command({ action: "revalidate_draft", draft_id: descriptor.target });
    } else if (descriptor.kind === "revalidate-auction-protocol") {
      await command({ action: "revalidate_auction_protocol", draft_id: descriptor.target });
    } else if (descriptor.kind === "prepare-package") {
      const candidates = orderedShortlistCandidates(view);
      const candidateDrafts = candidates.map((candidate) =>
        list(record(view.state.recommendation_set).drafts).map(record).find((draft) => draft.draft_id === candidate.draft_id) ?? {}
      );
      if (await saveProtocols(candidateDrafts)) {
        const agent = this.agentProjection ? await this.agentProjection(ownerKey) : null;
        return project(ownerKey, view, agent, accessState && this.accessReadiness ? this.accessReadiness.project(accessState) : null);
      }
      const desired = candidates.map((candidate, index) => ({
        ...candidate,
        order: Number(values[`campaign_${index + 1}`] ?? descriptor.fields[index]?.value),
      })).filter((candidate) => Number.isSafeInteger(candidate.order) && candidate.order > 0)
        .sort((left, right) => left.order - right.order || left.draft_id.localeCompare(right.draft_id));
      if (new Set(desired.map((candidate) => candidate.order)).size !== desired.length) {
        throw new P0ApplicationError("P0_OWNER_SHORTLIST_ORDER_INVALID", "Каждая выбранная кампания должна иметь отдельное положительное место.");
      }
      const desiredIds = desired.map((candidate) => candidate.draft_id);
      const currentIds = (view.state.shortlist?.selections ?? []).map((selection) => selection.draft_id);
      const shortlistChanged = JSON.stringify(currentIds) !== JSON.stringify(desiredIds);
      for (const selected of [...(view.state.shortlist?.selections ?? [])]) {
        if (!desiredIds.includes(selected.draft_id)) await command({ action: "remove_from_shortlist", draft_id: selected.draft_id });
      }
      for (const candidate of desired) {
        const currentControl = view.shortlist_controls.find((item) => item.draft_id === candidate.draft_id);
        if (currentControl?.status === "REMOVED") await command({ action: "restore_to_shortlist", draft_id: candidate.draft_id });
        else if (currentControl?.status === "AVAILABLE") await command({ action: "add_to_shortlist", draft_id: candidate.draft_id });
      }
      const persistedIds = (view.state.shortlist?.selections ?? []).map((selection) => selection.draft_id);
      if (desiredIds.length > 1 && JSON.stringify(persistedIds) !== JSON.stringify(desiredIds)) {
        await command({ action: "reorder_shortlist", ordered_draft_ids: desiredIds });
      }
      if (!shortlistChanged && allowed(view, "review_package")) await command({ action: "review_package" });
    } else if (descriptor.kind === "review-package") {
      await command({ action: "review_package" });
    } else if (descriptor.kind === "edit-package") {
      const selectedDrafts = (view.state.shortlist?.selections ?? []).map((selection) =>
        list(record(view.state.recommendation_set).drafts).map(record).find((draft) => draft.draft_id === selection.draft_id) ?? {}
      );
      if (!await saveProtocols(selectedDrafts)) {
        throw new P0ApplicationError("P0_OWNER_PACKAGE_EDIT_REQUIRED", "Измените бюджет или период хотя бы одного теста перед повторной проверкой.");
      }
    } else if (descriptor.kind === "authorize-and-create") {
      const selectedDrafts = (view.state.shortlist?.selections ?? []).map((selection) =>
        list(record(view.state.recommendation_set).drafts).map(record).find((draft) => draft.draft_id === selection.draft_id) ?? {}
      );
      if (await saveProtocols(selectedDrafts)) {
        const agent = this.agentProjection ? await this.agentProjection(ownerKey) : null;
        return project(ownerKey, view, agent, accessState && this.accessReadiness ? this.accessReadiness.project(accessState) : null);
      }
      const review = view.state.package_review!;
      await command({
        action: "confirm_package",
        confirmation: "CONFIRM_EXACT_SHORTLIST_PACKAGE",
        package_review_id: review.package_review_id,
        package_id: review.package_id,
      });
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

    let agent: P0AgentOwnerProjection | null = null;
    if (!this.agentProjection) {
      view = await this.continueSafeWork(ownerKey, view, descriptor.kind !== "authorize-and-create");
    } else {
      agent = await this.agentProjection(ownerKey);
      view = await this.application.query(ownerKey);
    }
    const access = accessState && this.accessReadiness ? this.accessReadiness.project(accessState) : null;
    return project(ownerKey, view, agent, access);
  }

  async diagnostics(ownerKey: string) {
    return this.application.query(ownerKey);
  }

  private async continueSafeWork(ownerKey: string, initial: InternalView, allowDispatch = true) {
    let view = initial;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (allowDispatch && view.state.human_decision_gate && !view.state.package_execution && allowed(view, "dispatch_package")) {
        const gate = view.state.human_decision_gate;
        view = await this.application.command(ownerKey, {
          action: "dispatch_package",
          expected_revision: view.revision,
          package_id: gate.package_id,
          gate_id: gate.gate_id,
        });
        continue;
      }
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
