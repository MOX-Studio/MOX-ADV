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

export type OwnerGoalInterviewQuestion = {
  key: string;
  prompt: string;
  materiality: {
    boundary: "MATERIAL_UNCERTAINTY" | "CRITICAL_DECISION";
    whyMaterial: string;
    consequences: string[];
  };
  recommendation: OwnerGoalInterviewRecommendation;
};

export type OwnerGoalInterviewConfirmedAnswer = {
  questionKey: string;
  question: string;
  answer: string;
  source: "RECOMMENDED" | "OWNER_CORRECTED";
};

type OwnerGoalInterviewStateBase = {
  interviewKey: string;
  revision: number;
  confirmedAnswers: OwnerGoalInterviewConfirmedAnswer[];
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
  };
}

function cloneState(state: OwnerGoalInterviewState): OwnerGoalInterviewState {
  return structuredClone(state);
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
    interviewKey,
    revision: 0,
    phase: "question",
    current,
    confirmedAnswers: [],
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
  const state = cloneState(currentState);
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
    };
  }
  if (state.phase === "owner-correction") {
    return {
      interviewKey: state.interviewKey,
      revision: state.revision + 1,
      phase: "confirmation",
      current: state.current,
      answer: ownerSafeText(values.answer, "Исправленный ответ"),
      answerSource: "OWNER_CORRECTED",
      confirmedAnswers: state.confirmedAnswers,
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
      interviewKey: state.interviewKey,
      revision: state.revision + 1,
      phase: "resumable-continuation",
      current: state.current,
      confirmedAnswer,
      confirmedAnswers: [...state.confirmedAnswers, confirmedAnswer],
      remainingQuestions: state.remainingQuestions,
    };
  }

  const [current, ...remainingQuestions] = state.remainingQuestions;
  if (!current) {
    fail("P0_OWNER_INTERVIEW_CONTINUATION_REQUIRED", "Следующий подготовленный вопрос недоступен; подтверждённые ответы не изменены.");
  }
  return {
    interviewKey: state.interviewKey,
    revision: state.revision + 1,
    phase: "question",
    current,
    confirmedAnswers: state.confirmedAnswers,
    remainingQuestions,
  };
}
