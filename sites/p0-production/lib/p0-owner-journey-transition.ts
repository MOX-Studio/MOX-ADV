export const OWNER_GOAL_INTERVIEW_PHASES = [
  "question",
  "recommendation",
  "owner-correction",
  "confirmation",
  "resumable-continuation",
] as const;

export type OwnerGoalInterviewPhase = typeof OWNER_GOAL_INTERVIEW_PHASES[number];

export type OwnerGoalInterviewRecommendation = {
  answer: string;
  rationale: string;
  evidence: string;
  confidence: "LOW" | "MEDIUM";
};

export const OWNER_GOAL_INTERVIEW_SCHEMA = "p0-owner-goal-interview-v1" as const;

export const OWNER_GOAL_INTERVIEW_BUSINESS_MODEL_FIELDS = [
  "product",
  "audience",
  "value",
  "qualified_result",
  "exclusions",
] as const;

export type OwnerGoalInterviewBusinessModelField = typeof OWNER_GOAL_INTERVIEW_BUSINESS_MODEL_FIELDS[number];

export type OwnerGoalInterviewTarget =
  | { kind: "BUSINESS_GOAL" }
  | { kind: "BUSINESS_MODEL_FIELD"; field: OwnerGoalInterviewBusinessModelField };

export type OwnerGoalInterviewQuestion = {
  key: string;
  prompt: string;
  materiality: {
    boundary: "MATERIAL_UNCERTAINTY" | "CRITICAL_DECISION";
    whyMaterial: string;
    consequences: string[];
  };
  recommendation: OwnerGoalInterviewRecommendation;
  target?: OwnerGoalInterviewTarget | null;
};

export type OwnerGoalInterviewConfirmedAnswer = {
  questionKey: string;
  question: string;
  answer: string;
  source: "RECOMMENDED" | "OWNER_CORRECTED";
};

export type OwnerGoalInterviewCorrection = {
  questionKey: string;
  answer: string;
  interviewRevision: number;
};

type OwnerGoalInterviewStateBase = {
  schema_version: typeof OWNER_GOAL_INTERVIEW_SCHEMA;
  interviewKey: string;
  revision: number;
  questionOrder: string[];
  questions: OwnerGoalInterviewQuestion[];
  confirmedAnswers: OwnerGoalInterviewConfirmedAnswer[];
  invalidatedAnswers: OwnerGoalInterviewConfirmedAnswer[];
  corrections: OwnerGoalInterviewCorrection[];
  remainingQuestions: OwnerGoalInterviewQuestion[];
};

export type OwnerGoalInterviewState = OwnerGoalInterviewStateBase & (
  | { phase: "question"; current: OwnerGoalInterviewQuestion }
  | { phase: "recommendation"; current: OwnerGoalInterviewQuestion }
  | { phase: "owner-correction"; current: OwnerGoalInterviewQuestion; ownerCorrection: string }
  | {
      phase: "confirmation";
      current: OwnerGoalInterviewQuestion;
      answer: string;
      answerSource: OwnerGoalInterviewConfirmedAnswer["source"];
    }
  | {
      phase: "resumable-continuation";
      current: OwnerGoalInterviewQuestion;
      confirmedAnswer: OwnerGoalInterviewConfirmedAnswer;
    }
);

export type OwnerGoalInterviewSubmission = {
  handle: string;
  values?: Record<string, unknown>;
};

export type OwnerGoalInterviewActionField = {
  key: "answer";
  label: string;
  control: "textarea";
  value: string;
  required: true;
  help?: string;
};

export type OwnerGoalInterviewPrimaryAction = {
  handle: string;
  label: string;
  description: string;
  fields: OwnerGoalInterviewActionField[];
};

export type OwnerGoalInterviewProjection = {
  phase: OwnerGoalInterviewPhase;
  question: string;
  recommendedAnswer?: OwnerGoalInterviewRecommendation;
  ownerCorrection?: string;
  confirmation?: {
    answer: string;
    source: "Рекомендация агента" | "Исправление владельца";
  };
  confirmedAnswers: Array<{
    question: string;
    answer: string;
    source: "Рекомендация агента" | "Исправление владельца";
  }>;
  primaryAction: OwnerGoalInterviewPrimaryAction;
};

type OwnerGoalInterviewActionKind =
  | "show-recommendation"
  | "review-recommended-answer"
  | "review-owner-correction"
  | "confirm-answer"
  | "continue-after-break";

type OwnerGoalInterviewActionDescriptor = Omit<OwnerGoalInterviewPrimaryAction, "handle"> & {
  kind: OwnerGoalInterviewActionKind;
};

export class OwnerGoalInterviewTransitionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OwnerGoalInterviewTransitionError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new OwnerGoalInterviewTransitionError(code, message);
}

function normalizedText(value: unknown, label: string, maximum = 1_000) {
  const text = String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!text) fail("P0_OWNER_INPUT_REQUIRED", `${label} не заполнено.`);
  if (text.length > maximum) fail("P0_OWNER_INPUT_TOO_LONG", `${label}: максимум ${maximum} символов.`);
  return text;
}

const FORBIDDEN_OWNER_TEXT = [
  /\b(?:schema|contract)[_ -]?(?:version|name)\b/giu,
  /\b(?:revision|run[_ -]?id|tool names?)\b/giu,
  /\bp0_[a-z0-9_]+\b/giu,
];

const PROMPT_INJECTION_TEXT = [
  /\bignore\s+(?:all\s+)?(?:previous|prior)\s+instructions?\b/iu,
  /\b(?:system|assistant|developer)\s*:\s*/iu,
  /\b(?:call|invoke|run|execute)\s+(?:the\s+)?(?:shell|browser|tool|command)\b/iu,
  /\b(?:grant|replace|override)\s+(?:the\s+)?(?:authority|policy|permissions?)\b/iu,
];

function rejectPromptInjection(value: unknown) {
  const text = String(value ?? "").normalize("NFKC");
  if (PROMPT_INJECTION_TEXT.some((pattern) => pattern.test(text))) {
    fail("P0_OWNER_PROMPT_INJECTION", "Подготовленный вопрос содержит недоверенную инструкцию вместо бизнес-информации.");
  }
}

function ownerSafeText(value: unknown, label: string, maximum = 1_000) {
  let text = normalizedText(value, label, maximum);
  for (const pattern of FORBIDDEN_OWNER_TEXT) text = text.replace(pattern, "техническая деталь");
  text = text.replace(/\s+/gu, " ").slice(0, maximum).trim();
  return text;
}

function normalizedTarget(value: unknown): OwnerGoalInterviewTarget | null {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("P0_OWNER_INTERVIEW_TARGET_INVALID", "Назначение ответа имеет неизвестный формат.");
  }
  const target = value as Record<string, unknown>;
  if (target.kind === "BUSINESS_GOAL" && Object.keys(target).length === 1) return { kind: "BUSINESS_GOAL" };
  if (target.kind === "BUSINESS_MODEL_FIELD"
    && Object.keys(target).length === 2
    && OWNER_GOAL_INTERVIEW_BUSINESS_MODEL_FIELDS.includes(target.field as OwnerGoalInterviewBusinessModelField)) {
    return { kind: "BUSINESS_MODEL_FIELD", field: target.field as OwnerGoalInterviewBusinessModelField };
  }
  fail("P0_OWNER_INTERVIEW_TARGET_INVALID", "Назначение ответа не поддерживается безопасным контрактом опроса.");
}

function normalizedQuestion(question: OwnerGoalInterviewQuestion): OwnerGoalInterviewQuestion {
  const preparedText = [
    question.prompt,
    question.materiality?.whyMaterial,
    ...(question.materiality?.consequences ?? []),
    question.recommendation?.answer,
    question.recommendation?.rationale,
    question.recommendation?.evidence,
  ];
  preparedText.forEach(rejectPromptInjection);
  if (!["MATERIAL_UNCERTAINTY", "CRITICAL_DECISION"].includes(question.materiality?.boundary)) {
    fail("P0_OWNER_QUESTION_UNNECESSARY", "Вопрос владельцу допустим только перед существенной неопределённостью или критическим решением.");
  }
  if (!Array.isArray(question.materiality?.consequences) || question.materiality.consequences.length < 1) {
    fail("P0_OWNER_QUESTION_UNNECESSARY", "Существенный вопрос должен раскрывать последствия решения.");
  }
  if (!["LOW", "MEDIUM"].includes(question.recommendation?.confidence)) {
    fail("P0_OWNER_RECOMMENDATION_FALSE_CONFIDENCE", "Неподтверждённая рекомендация не может заявлять высокую или произвольную уверенность.");
  }
  return {
    key: normalizedText(question.key, "Ключ вопроса", 120),
    prompt: ownerSafeText(question.prompt, "Вопрос"),
    materiality: {
      boundary: question.materiality.boundary,
      whyMaterial: ownerSafeText(question.materiality.whyMaterial, "Существенность"),
      consequences: question.materiality.consequences.map((item) => ownerSafeText(item, "Последствие")),
    },
    recommendation: {
      answer: ownerSafeText(question.recommendation?.answer, "Рекомендованный ответ"),
      rationale: ownerSafeText(question.recommendation?.rationale, "Обоснование"),
      evidence: ownerSafeText(question.recommendation?.evidence, "Доказательства"),
      confidence: question.recommendation.confidence,
    },
    target: normalizedTarget(question.target),
  };
}

function stateInvalid(message: string): never {
  fail("P0_OWNER_INTERVIEW_STATE_INVALID", `Сохранённый опрос отклонён: ${message}`);
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Rejects malformed snapshots instead of repairing or dropping owner input. */
export function validateOwnerGoalInterviewState(value: unknown): OwnerGoalInterviewState {
  if (!value || typeof value !== "object" || Array.isArray(value)) stateInvalid("состояние должно быть объектом.");
  const state = structuredClone(value) as OwnerGoalInterviewState;
  if (state.schema_version !== OWNER_GOAL_INTERVIEW_SCHEMA) stateInvalid("версия схемы не поддерживается.");
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) stateInvalid("revision некорректна.");
  if (!Array.isArray(state.questions) || state.questions.length < 2) stateInvalid("полный порядок вопросов отсутствует.");
  let canonicalQuestions: OwnerGoalInterviewQuestion[];
  try {
    canonicalQuestions = state.questions.map(normalizedQuestion);
  } catch (error) {
    stateInvalid(error instanceof Error ? error.message : "вопрос некорректен.");
  }
  if (!sameJson(state.questions, canonicalQuestions)) stateInvalid("вопросы или рекомендации не каноничны.");
  const canonicalOrder = canonicalQuestions.map((question) => question.key);
  if (new Set(canonicalOrder).size !== canonicalOrder.length) stateInvalid("ключи вопросов повторяются.");
  if (!Array.isArray(state.questionOrder) || !sameJson(state.questionOrder, canonicalOrder)) stateInvalid("порядок вопросов изменён.");
  if (!Array.isArray(state.confirmedAnswers) || !Array.isArray(state.invalidatedAnswers)
    || !Array.isArray(state.corrections) || !Array.isArray(state.remainingQuestions)) {
    stateInvalid("история ответов или продолжение отсутствуют.");
  }
  const questionByKey = new Map(canonicalQuestions.map((question) => [question.key, question]));
  const validateAnswer = (answer: OwnerGoalInterviewConfirmedAnswer) => {
    const question = questionByKey.get(String(answer?.questionKey ?? ""));
    if (!answer || typeof answer !== "object" || !sameJson(Object.keys(answer).sort(), ["answer", "question", "questionKey", "source"])) {
      stateInvalid("подтверждённый ответ содержит неизвестные поля.");
    }
    if (!question || answer.question !== question.prompt || !["RECOMMENDED", "OWNER_CORRECTED"].includes(answer.source)) {
      stateInvalid("подтверждённый ответ потерял вопрос или источник.");
    }
    if (ownerSafeText(answer.answer, "Ответ") !== answer.answer) stateInvalid("подтверждённый ответ не каноничен.");
  };
  state.confirmedAnswers.forEach(validateAnswer);
  state.invalidatedAnswers.forEach(validateAnswer);
  if (new Set(state.confirmedAnswers.map((answer) => answer.questionKey)).size !== state.confirmedAnswers.length) {
    stateInvalid("подтверждённый вопрос повторяется.");
  }
  const confirmedOrder = state.confirmedAnswers.map((answer) => answer.questionKey);
  if (!sameJson(confirmedOrder, canonicalOrder.slice(0, confirmedOrder.length))) stateInvalid("подтверждённые ответы нарушают порядок.");
  for (const correction of state.corrections) {
    if (!correction || typeof correction !== "object"
      || !sameJson(Object.keys(correction).sort(), ["answer", "interviewRevision", "questionKey"])
      || !questionByKey.has(String(correction.questionKey ?? ""))
      || !Number.isSafeInteger(correction.interviewRevision) || correction.interviewRevision < 1
      || ownerSafeText(correction.answer, "Исправление") !== correction.answer) {
      stateInvalid("история исправлений некорректна.");
    }
  }
  const current = questionByKey.get(String((state as OwnerGoalInterviewState).current?.key ?? ""));
  if (!current || !sameJson(state.current, current)) stateInvalid("текущий вопрос не совпадает с сохранённым порядком.");
  const remainingKeys = state.remainingQuestions.map((question) => question.key);
  if (!state.remainingQuestions.every((question) => sameJson(question, questionByKey.get(question.key)))) {
    stateInvalid("оставшиеся вопросы были изменены.");
  }
  const currentIndex = canonicalOrder.indexOf(current.key);
  if (!sameJson(remainingKeys, canonicalOrder.slice(currentIndex + 1))) stateInvalid("продолжение нарушает порядок вопросов.");
  const expectedConfirmedCount = state.phase === "resumable-continuation" ? currentIndex + 1 : currentIndex;
  if (state.confirmedAnswers.length !== expectedConfirmedCount) {
    stateInvalid("подтверждённый вопрос был повторно открыт без материальной инвалидации.");
  }
  if (state.phase === "owner-correction") {
    if (ownerSafeText(state.ownerCorrection, "Исправление") !== state.ownerCorrection) stateInvalid("текущее исправление не канонично.");
  } else if (state.phase === "confirmation") {
    if (ownerSafeText(state.answer, "Ответ") !== state.answer || !["RECOMMENDED", "OWNER_CORRECTED"].includes(state.answerSource)) {
      stateInvalid("подтверждение некорректно.");
    }
  } else if (state.phase === "resumable-continuation") {
    validateAnswer(state.confirmedAnswer);
    if (!sameJson(state.confirmedAnswer, state.confirmedAnswers.at(-1))) stateInvalid("точка продолжения потеряла последний ответ.");
  } else if (!OWNER_GOAL_INTERVIEW_PHASES.includes(state.phase)) {
    stateInvalid("этап опроса неизвестен.");
  }
  return state;
}

/**
 * Starts a prepared interview. At least two prepared questions keep the first
 * confirmation resumable without asking the owner to reconstruct prior input.
 */
export function beginOwnerGoalInterview(input: {
  interviewKey: string;
  questions: OwnerGoalInterviewQuestion[];
}): OwnerGoalInterviewState {
  const interviewKey = normalizedText(input.interviewKey, "Ключ опроса", 200);
  const questions = input.questions.map(normalizedQuestion);
  if (questions.length < 2) {
    fail("P0_OWNER_INTERVIEW_CONTINUATION_REQUIRED", "Для продолжения нужен следующий подготовленный вопрос.");
  }
  if (new Set(questions.map((question) => question.key)).size !== questions.length) {
    fail("P0_OWNER_INTERVIEW_QUESTION_DUPLICATE", "Каждый подготовленный вопрос должен иметь отдельный ключ.");
  }
  const [current, ...remainingQuestions] = questions;
  return {
    schema_version: OWNER_GOAL_INTERVIEW_SCHEMA,
    interviewKey,
    revision: 0,
    phase: "question",
    current,
    questionOrder: questions.map((question) => question.key),
    questions,
    confirmedAnswers: [],
    invalidatedAnswers: [],
    corrections: [],
    remainingQuestions,
  };
}

function actionDescriptor(state: OwnerGoalInterviewState): OwnerGoalInterviewActionDescriptor {
  if (state.phase === "question") {
    return {
      kind: "show-recommendation",
      label: "Показать рекомендованный ответ",
      description: "Агент покажет подготовленный ответ, основание и уверенность перед решением владельца.",
      fields: [],
    };
  }
  if (state.phase === "recommendation") {
    return {
      kind: "review-recommended-answer",
      label: "Проверить ответ",
      description: "Оставьте рекомендацию или исправьте бизнес-смысл перед подтверждением.",
      fields: [{
        key: "answer",
        label: "Ответ",
        control: "textarea",
        value: state.current.recommendation.answer,
        required: true,
        help: "Изменение будет отдельно показано как исправление владельца.",
      }],
    };
  }
  if (state.phase === "owner-correction") {
    return {
      kind: "review-owner-correction",
      label: "Проверить исправление",
      description: "Проверьте исправленный бизнес-смысл перед отдельным подтверждением.",
      fields: [{
        key: "answer",
        label: "Исправленный ответ",
        control: "textarea",
        value: state.ownerCorrection,
        required: true,
      }],
    };
  }
  if (state.phase === "confirmation") {
    return {
      kind: "confirm-answer",
      label: "Подтвердить ответ",
      description: "Подтверждение сохранит точный показанный ответ и не изменит ранее подтверждённые ответы.",
      fields: [],
    };
  }
  return {
    kind: "continue-after-break",
    label: "Продолжить опрос",
    description: "Опрос продолжится со следующего подготовленного вопроса; подтверждённые ответы сохранятся.",
    fields: [],
  };
}

async function opaqueActionHandle(ownerKey: string, state: OwnerGoalInterviewState, kind: OwnerGoalInterviewActionKind) {
  const material = JSON.stringify({
    ownerKey,
    interviewKey: state.interviewKey,
    revision: state.revision,
    phase: state.phase,
    questionKey: state.current.key,
    kind,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  const token = btoa(String.fromCharCode(...new Uint8Array(digest).slice(0, 18)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return `act_${token}`;
}

function ownerSource(source: OwnerGoalInterviewConfirmedAnswer["source"]) {
  return source === "OWNER_CORRECTED" ? "Исправление владельца" as const : "Рекомендация агента" as const;
}

export async function projectOwnerGoalInterview(
  ownerKey: string,
  state: OwnerGoalInterviewState,
): Promise<OwnerGoalInterviewProjection> {
  const descriptor = actionDescriptor(state);
  return {
    phase: state.phase,
    question: state.current.prompt,
    ...(state.phase === "recommendation" || state.phase === "owner-correction" || state.phase === "confirmation"
      ? { recommendedAnswer: structuredClone(state.current.recommendation) }
      : {}),
    ...(state.phase === "owner-correction" ? { ownerCorrection: state.ownerCorrection } : {}),
    ...(state.phase === "confirmation" ? {
      confirmation: { answer: state.answer, source: ownerSource(state.answerSource) },
    } : {}),
    confirmedAnswers: state.confirmedAnswers.map((answer) => ({
      question: answer.question,
      answer: answer.answer,
      source: ownerSource(answer.source),
    })),
    primaryAction: {
      handle: await opaqueActionHandle(ownerKey, state, descriptor.kind),
      label: descriptor.label,
      description: descriptor.description,
      fields: structuredClone(descriptor.fields),
    },
  };
}

export async function transitionOwnerGoalInterview(
  ownerKey: string,
  currentState: OwnerGoalInterviewState,
  submission: OwnerGoalInterviewSubmission,
): Promise<OwnerGoalInterviewState> {
  const state = validateOwnerGoalInterviewState(currentState);
  const descriptor = actionDescriptor(state);
  const expectedHandle = await opaqueActionHandle(ownerKey, state, descriptor.kind);
  if (submission.handle !== expectedHandle) {
    fail("P0_OWNER_ACTION_STALE", "Действие больше не соответствует текущему состоянию. Обновите страницу.");
  }
  const values = submission.values ?? {};
  const actualValueKeys = Object.keys(values).sort();
  const expectedValueKeys = descriptor.fields.map((field) => field.key).sort();
  if (JSON.stringify(actualValueKeys) !== JSON.stringify(expectedValueKeys)) {
    fail("P0_OWNER_ACTION_INVALID", "Данные действия не соответствуют текущему допустимому шагу.");
  }

  if (state.phase === "question") {
    return { ...state, phase: "recommendation", revision: state.revision + 1 };
  }
  if (state.phase === "recommendation") {
    const answer = ownerSafeText(values.answer, "Ответ");
    if (answer === state.current.recommendation.answer) {
      return {
        ...state,
        phase: "confirmation",
        revision: state.revision + 1,
        answer,
        answerSource: "RECOMMENDED",
      };
    }
    return {
      ...state,
      phase: "owner-correction",
      revision: state.revision + 1,
      ownerCorrection: answer,
      corrections: [...state.corrections, {
        questionKey: state.current.key,
        answer,
        interviewRevision: state.revision + 1,
      }],
    };
  }
  if (state.phase === "owner-correction") {
    const answer = ownerSafeText(values.answer, "Исправленный ответ");
    return {
      schema_version: state.schema_version,
      interviewKey: state.interviewKey,
      revision: state.revision + 1,
      phase: "confirmation",
      current: state.current,
      answer,
      answerSource: "OWNER_CORRECTED",
      questionOrder: state.questionOrder,
      questions: state.questions,
      confirmedAnswers: state.confirmedAnswers,
      invalidatedAnswers: state.invalidatedAnswers,
      corrections: state.corrections.at(-1)?.questionKey === state.current.key
        ? [...state.corrections.slice(0, -1), {
            questionKey: state.current.key,
            answer,
            interviewRevision: state.revision + 1,
          }]
        : [...state.corrections, {
            questionKey: state.current.key,
            answer,
            interviewRevision: state.revision + 1,
          }],
      remainingQuestions: state.remainingQuestions,
    };
  }
  if (state.phase === "confirmation") {
    if (state.remainingQuestions.length === 0) {
      fail("P0_OWNER_INTERVIEW_CONTINUATION_REQUIRED", "Следующий подготовленный вопрос недоступен; подтверждённый ответ не изменён.");
    }
    const confirmedAnswer: OwnerGoalInterviewConfirmedAnswer = {
      questionKey: state.current.key,
      question: state.current.prompt,
      answer: state.answer,
      source: state.answerSource,
    };
    return {
      schema_version: state.schema_version,
      interviewKey: state.interviewKey,
      revision: state.revision + 1,
      phase: "resumable-continuation",
      current: state.current,
      confirmedAnswer,
      questionOrder: state.questionOrder,
      questions: state.questions,
      confirmedAnswers: [...state.confirmedAnswers, confirmedAnswer],
      invalidatedAnswers: state.invalidatedAnswers,
      corrections: state.corrections,
      remainingQuestions: state.remainingQuestions,
    };
  }

  const [current, ...remainingQuestions] = state.remainingQuestions;
  if (!current) {
    fail("P0_OWNER_INTERVIEW_CONTINUATION_REQUIRED", "Следующий подготовленный вопрос недоступен; подтверждённые ответы не изменены.");
  }
  return {
    schema_version: state.schema_version,
    interviewKey: state.interviewKey,
    revision: state.revision + 1,
    phase: "question",
    current,
    questionOrder: state.questionOrder,
    questions: state.questions,
    confirmedAnswers: state.confirmedAnswers,
    invalidatedAnswers: state.invalidatedAnswers,
    corrections: state.corrections,
    remainingQuestions,
  };
}

/**
 * Records a later material owner correction, preserves invalidated dependent
 * answers for audit, and resumes only from the next question in fixed order.
 */
export function correctConfirmedOwnerGoalInterviewAnswer(
  currentState: OwnerGoalInterviewState,
  input: { questionKey: string; answer: unknown },
): OwnerGoalInterviewState {
  const state = validateOwnerGoalInterviewState(currentState);
  const questionKey = normalizedText(input.questionKey, "Ключ вопроса", 120);
  const answer = ownerSafeText(input.answer, "Исправленный ответ");
  const confirmedIndex = state.confirmedAnswers.findIndex((item) => item.questionKey === questionKey);
  if (confirmedIndex < 0) fail("P0_OWNER_INTERVIEW_ANSWER_NOT_CONFIRMED", "Исправить можно только подтверждённый ответ.");
  const previous = state.confirmedAnswers[confirmedIndex];
  if (previous.answer === answer) fail("P0_OWNER_INTERVIEW_CORRECTION_NOT_MATERIAL", "Исправление не меняет подтверждённый ответ.");
  const questionIndex = state.questionOrder.indexOf(questionKey);
  const question = state.questions[questionIndex];
  const corrected: OwnerGoalInterviewConfirmedAnswer = {
    questionKey,
    question: question.prompt,
    answer,
    source: "OWNER_CORRECTED",
  };
  const dependentAnswers = state.confirmedAnswers.slice(confirmedIndex + 1);
  const remainingQuestions = state.questions.slice(questionIndex + 1);
  return {
    schema_version: state.schema_version,
    interviewKey: state.interviewKey,
    revision: state.revision + 1,
    phase: "resumable-continuation",
    current: question,
    confirmedAnswer: corrected,
    questionOrder: state.questionOrder,
    questions: state.questions,
    confirmedAnswers: [...state.confirmedAnswers.slice(0, confirmedIndex), corrected],
    invalidatedAnswers: [...state.invalidatedAnswers, ...dependentAnswers],
    corrections: [...state.corrections, {
      questionKey,
      answer,
      interviewRevision: state.revision + 1,
    }],
    remainingQuestions,
  };
}
