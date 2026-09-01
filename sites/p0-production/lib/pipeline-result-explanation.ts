import {
  PIPELINE_STAGES,
  verifyPipelineAuditTrail,
  verifyPipelineRunState,
  type PipelineAuditEvent,
  type PipelineRunState,
  type PipelineStageId,
  type PipelineVersionReference,
} from "./pipeline-orchestrator.ts";

const SENSITIVE_REFERENCE = /(^sha256:|oauth|token|secret|password|cookie|authorization|client[-_:]?login|counter[-_:]?id|goal[-_:]?id|campaign[-_:]?id|yandex|direct|metrika|provider|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\+?\d[\d ()-]{8,}\d)/iu;
const QUESTION_LIMIT = 1_000;

export type OwnerVersionReference = {
  kind: string;
  schemaVersion: string;
  revision: string;
};

export type OwnerResultProvenanceEvent = {
  stage: string;
  task: string;
  executor: string;
  attempt: number;
  status: "Запуск" | "Проверено" | "Отклонено" | "Остановлено" | "Завершено";
  inputs: OwnerVersionReference[];
  evidence: OwnerVersionReference[];
  checks: string[];
  safeCorrection: string | null;
  retry: string | null;
  return: string | null;
  handoff: string | null;
};

export type OwnerCampaignPairProvenance = {
  key: string;
  label: string;
  hypothesis: OwnerVersionReference;
  draft: OwnerVersionReference;
};

export type OwnerStageAgent = {
  name: string;
  stage: string;
  work: string;
  outcome: string;
  evidenceBasis: string[];
};

export type OwnerResultProvenance = {
  title: "Агенты и проверяемый след";
  safety: string;
  currentTask: string;
  agents: OwnerStageAgent[];
  pairs: OwnerCampaignPairProvenance[];
  events: OwnerResultProvenanceEvent[];
  versions: {
    historicalDocument: string;
    policy: OwnerVersionReference;
    campaignPlaybook: OwnerVersionReference;
  };
};

export type OwnerResultExplanation = {
  answer: string;
  scope: string;
  facts: string[];
  safety: string;
};

const TASK_BY_STAGE: Record<PipelineStageId, string> = {
  CAMPAIGN_GOAL: "Сформировать и проверить цель кампании",
  EVIDENCE_COLLECTION: "Собрать и проверить разрешённые сведения",
  STRATEGY: "Сформировать и проверить текущую Campaign Strategy",
  CAMPAIGNS: "Собрать и проверить пары Campaign Hypothesis + Campaign Draft",
  PUBLICATION_REVIEW: "Передать проверенные Draft на проверку публикации без внешней записи",
};

const ACTOR_LABELS: Record<string, string> = {
  OWNER: "Владелец",
  AGENT: "Агент этапа",
  DETERMINISTIC_SERVICE: "Детерминированная проверка",
};

const ACTOR_ROLE_LABELS: Record<string, string> = {
  GOAL_AGENT: "Goal Agent",
  EVIDENCE_ANALYST: "Evidence Analyst",
  STRATEGY_AGENT: "Strategy Agent",
  CAMPAIGN_DESIGN_AGENT: "Campaign Design Agent",
  PIPELINE_OWNER: "Владелец",
  GOAL_VALIDATOR: "Проверка GoalRevision",
  STAGE_EXECUTOR: "Проверка этапа",
};

const EVENT_STATUS: Record<PipelineAuditEvent["event_kind"], OwnerResultProvenanceEvent["status"]> = {
  RUN_STARTED: "Запуск",
  STAGE_VERIFIED: "Проверено",
  ATTEMPT_DISCARDED: "Отклонено",
  RUN_STOPPED: "Остановлено",
  RUN_COMPLETED: "Завершено",
};

function stageLabel(stage: PipelineStageId) {
  return PIPELINE_STAGES.find((item) => item.id === stage)?.label ?? "Этап";
}

function safeReferenceText(value: string) {
  return SENSITIVE_REFERENCE.test(value)
    ? "Скрыто как чувствительный идентификатор"
    : value;
}

function versionKind(schemaVersion: string) {
  if (/hypothesis/iu.test(schemaVersion)) return "Campaign Hypothesis";
  if (/draft/iu.test(schemaVersion)) return "Campaign Draft";
  if (/evidence/iu.test(schemaVersion)) return "Срез доказательств";
  if (/strategy/iu.test(schemaVersion)) return "Campaign Strategy";
  if (/playbook/iu.test(schemaVersion)) return "Campaign Playbook";
  if (/policy/iu.test(schemaVersion)) return "Политика";
  if (/schema/iu.test(schemaVersion)) return "Схема";
  if (/goal/iu.test(schemaVersion)) return "Цель кампании";
  if (/business/iu.test(schemaVersion)) return "Бизнес-вход";
  return "Версия объекта";
}

function ownerReference(reference: PipelineVersionReference): OwnerVersionReference {
  return {
    kind: versionKind(reference.schema_version),
    schemaVersion: safeReferenceText(reference.schema_version),
    revision: safeReferenceText(reference.revision_id),
  };
}

function transition(event: PipelineAuditEvent, field: "return" | "handoff") {
  const target = event[field]?.target_stage;
  return target ? stageLabel(target) : null;
}

function eventCorrection(event: PipelineAuditEvent) {
  if (event.event_kind !== "ATTEMPT_DISCARDED") return null;
  return event.return
    ? "Непроверенный результат отброшен; работа безопасно возвращена на предыдущий этап."
    : "Непроверенный результат отброшен; сохранён только очищенный факт попытки.";
}

function projectEvent(event: PipelineAuditEvent): OwnerResultProvenanceEvent {
  return {
    stage: stageLabel(event.stage),
    task: TASK_BY_STAGE[event.stage],
    executor: ACTOR_ROLE_LABELS[event.actor.role]
      ?? ACTOR_LABELS[event.actor.actor_type]
      ?? "Проверенный исполнитель",
    attempt: event.attempt,
    status: EVENT_STATUS[event.event_kind],
    inputs: event.inputs.map(ownerReference),
    evidence: event.evidence.map(ownerReference),
    checks: event.checks.map((check) => `${check.check_id}: ${check.status === "PASSED" ? "пройдена" : "не пройдена"}`),
    safeCorrection: eventCorrection(event),
    retry: event.retry ? `Повтор с попытки ${event.retry.next_attempt}` : null,
    return: transition(event, "return"),
    handoff: transition(event, "handoff"),
  };
}

/**
 * Produces the only owner/chat projection of the audit trail. It deliberately
 * allowlists business provenance fields and never exposes digests, actor IDs,
 * provider identifiers, raw payloads, prompts, or model reasoning.
 */
export async function projectCurrentResultProvenance(
  run: PipelineRunState,
  audit: PipelineAuditEvent[],
): Promise<OwnerResultProvenance> {
  await verifyPipelineRunState(run);
  await verifyPipelineAuditTrail(audit, run);
  const agentEvents = audit.filter((event) => event.actor.actor_type === "AGENT");
  return {
    title: "Агенты и проверяемый след",
    safety: "Показаны только проверяемые факты очищенного следа. Скрытое рассуждение, секреты, персональные данные, идентификаторы поставщика и технические дампы не включаются.",
    currentTask: TASK_BY_STAGE[run.current_stage],
    agents: agentEvents.map((event) => ({
      name: ACTOR_ROLE_LABELS[event.actor.role] ?? "Агент этапа",
      stage: stageLabel(event.stage),
      work: TASK_BY_STAGE[event.stage],
      outcome: event.event_kind === "STAGE_VERIFIED" || event.event_kind === "RUN_COMPLETED"
        ? event.handoff
          ? `Результат проверен и передан на этап «${stageLabel(event.handoff.target_stage)}».`
          : "Результат проверен."
        : event.event_kind === "ATTEMPT_DISCARDED"
          ? "Результат не прошёл проверку и не был сохранён как текущий."
          : event.event_kind === "RUN_STOPPED"
            ? "Работа безопасно остановлена до внешней записи."
            : "Работа начата.",
      evidenceBasis: event.evidence.map((reference) => `${versionKind(reference.schema_version)} · ${safeReferenceText(reference.revision_id)}`),
    })),
    pairs: run.input_versions.campaign_pairs.map((pair, index) => ({
      key: `pair-${index + 1}`,
      label: `Пара ${index + 1}`,
      hypothesis: ownerReference(pair.hypothesis),
      draft: ownerReference(pair.draft),
    })),
    events: audit.map(projectEvent),
    versions: {
      historicalDocument: `Редакция ${run.input_versions.historical_document.revision} · ${safeReferenceText(run.input_versions.historical_document.schema_version)}`,
      policy: ownerReference(run.input_versions.pipeline_policy),
      campaignPlaybook: ownerReference(run.input_versions.campaign_playbook),
    },
  };
}

function pairFacts(pair: OwnerCampaignPairProvenance | null) {
  if (!pair) return ["В текущем запуске нет проверенной пары Campaign Hypothesis + Campaign Draft."];
  return [
    `${pair.label}: ${pair.hypothesis.kind}, ${pair.hypothesis.revision}; ${pair.draft.kind}, ${pair.draft.revision}.`,
  ];
}

function unique(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

/** Answers from the current sanitized projection only; no model prompt or hidden reasoning is used. */
export function explainCurrentResultQuestion(
  provenance: OwnerResultProvenance,
  questionValue: unknown,
  pairKeyValue?: unknown,
): OwnerResultExplanation {
  const question = String(questionValue ?? "").normalize("NFKC").replace(/\p{Cc}/gu, " ").replace(/\s+/gu, " ").trim();
  if (!question || question.length > QUESTION_LIMIT) throw new Error("Введите вопрос длиной до 1000 символов.");
  const pairKey = String(pairKeyValue ?? provenance.pairs[0]?.key ?? "");
  const pair = provenance.pairs.find((item) => item.key === pairKey) ?? null;
  if (pairKey && !pair) throw new Error("Выбранная пара не относится к текущему результату.");

  const normalized = question.toLocaleLowerCase("ru-RU");
  const relevantEvents = provenance.events;
  let facts: string[];
  if (/(кто|исполнител|агент|сделал)/u.test(normalized)) {
    facts = unique(relevantEvents.map((event) => `${event.stage}: ${event.executor}.`));
  } else if (/(провер|контрол|политик)/u.test(normalized)) {
    facts = unique(relevantEvents.flatMap((event) => event.checks.map((check) => `${event.stage}: ${check}.`)));
    facts.push(`Политика: ${provenance.versions.policy.revision}.`);
  } else if (/(доказ|источник|вход|данн)/u.test(normalized)) {
    facts = unique(relevantEvents.flatMap((event) => [...event.inputs, ...event.evidence]
      .map((reference) => `${event.stage}: ${reference.kind}, ${reference.revision}.`)));
  } else if (/(исправ|повтор|вернул|возврат|передач|этап)/u.test(normalized)) {
    facts = unique(relevantEvents.flatMap((event) => [
      event.safeCorrection,
      event.retry ? `${event.stage}: ${event.retry}.` : null,
      event.return ? `${event.stage}: возврат на этап «${event.return}».` : null,
      event.handoff ? `${event.stage}: передача на этап «${event.handoff}».` : null,
    ]));
  } else if (/(верси|схем|playbook|плейбук|воспроиз)/u.test(normalized)) {
    facts = [
      provenance.versions.historicalDocument,
      `Политика: ${provenance.versions.policy.schemaVersion}, ${provenance.versions.policy.revision}.`,
      `Campaign Playbook: ${provenance.versions.campaignPlaybook.schemaVersion}, ${provenance.versions.campaignPlaybook.revision}.`,
      ...pairFacts(pair),
    ];
  } else {
    facts = [
      `Текущая задача: ${provenance.currentTask}.`,
      ...pairFacts(pair),
      ...unique(relevantEvents.slice(-3).map((event) => `${event.stage}: ${event.status.toLocaleLowerCase("ru-RU")}; исполнитель — ${event.executor}.`)),
    ];
  }
  if (!facts.length) facts = ["В очищенном следе текущего результата нет факта, отвечающего на этот вопрос."];
  return {
    answer: "Ответ составлен только из очищенного неизменяемого следа текущего запуска; это проверяемое объяснение, а не скрытое рассуждение модели.",
    scope: pair ? `Текущий запуск · ${pair.label}` : "Текущий запуск",
    facts,
    safety: provenance.safety,
  };
}
