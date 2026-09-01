"use client";

import Link from "next/link";
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import styles from "./prototype/prd-149/prototype.module.css";
import AnalyticsSummaryDisclosure from "./AnalyticsSummaryDisclosure";
import type {
  OwnerActionField,
  OwnerJourneyProjection,
  OwnerJourneyStageId,
} from "../lib/p0-owner-journey";
import type { OwnerResultExplanation } from "../lib/pipeline-result-explanation";

type JsonRecord = Record<string, unknown>;
type LocalRecovery = { action: "RESET_INVALID_LOCAL_P0_STATE"; label: string; description: string };

class DashboardRequestError extends Error {
  readonly recovery: LocalRecovery | null;

  constructor(message: string, recovery: LocalRecovery | null = null) {
    super(message);
    this.name = "DashboardRequestError";
    this.recovery = recovery;
  }
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  const value = await response.json() as JsonRecord;
  if (!response.ok) {
    const recovery = value.recovery && typeof value.recovery === "object" && !Array.isArray(value.recovery)
      ? value.recovery as LocalRecovery
      : null;
    throw new DashboardRequestError(String(value.message ?? "Действие не выполнено."), recovery);
  }
  return value as OwnerJourneyProjection;
}

function actionValues(form: HTMLFormElement, fields: OwnerActionField[]) {
  const data = new FormData(form);
  return Object.fromEntries(fields.map((field) => [field.key, String(data.get(field.key) ?? "").trim()]));
}

function authoritativeStage(projection: OwnerJourneyProjection) {
  return projection.pipeline && projection.pipeline.status !== "NOT_STARTED"
    ? projection.pipeline.currentStage
    : projection.journey.currentStage;
}

const cardLabels = {
  "agent-activity": "Работа агента",
  finding: "Вывод",
  problem: "Проблема",
  "human-decision-gate": "Решение владельца",
} as const;

export default function P0Client() {
  const [projection, setProjection] = useState<OwnerJourneyProjection | null>(null);
  const [selectedStage, setSelectedStage] = useState<OwnerJourneyStageId | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState<LocalRecovery | null>(null);
  const interviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    request("/api/p0")
      .then((next) => {
        setProjection(next);
        setRecovery(null);
        const requestedStage = new URL(window.location.href).searchParams.get("stage");
        setSelectedStage(next.journey.stages.some((stage) => stage.id === requestedStage)
          ? requestedStage as OwnerJourneyStageId
          : next.goalInterview?.primaryAction ? "goal" : authoritativeStage(next));
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setRecovery(reason instanceof DashboardRequestError ? reason.recovery : null);
      })
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    if (selectedStage === "goal" && projection?.goalInterview?.primaryAction) {
      interviewHeadingRef.current?.focus();
    }
  }, [projection?.goalInterview?.primaryAction, selectedStage]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  useEffect(() => {
    if (!projection) return;
    const agentContinues = projection.agentActivity?.status === "working"
      || projection.agentActivity?.status === "waiting";
    const businessContinues = projection.businessOutcome.status === "working" && !projection.primaryAction;
    if (!agentContinues && !businessContinues && !projection.pipeline?.active) return;
    const timer = window.setTimeout(() => {
      request("/api/p0").then((next) => {
        setProjection(next);
        const previousCurrentStage = authoritativeStage(projection);
        const nextCurrentStage = authoritativeStage(next);
        setSelectedStage((selected) => !selected || selected === previousCurrentStage
          ? nextCurrentStage
          : selected);
      }).catch(() => undefined);
    }, 3_000);
    return () => window.clearTimeout(timer);
  }, [projection]);

  async function recoverInvalidLocalState() {
    if (!recovery || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await request("/api/p0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recovery_action: recovery.action,
          confirmation: "RESET_INVALID_LOCAL_P0_STATE",
        }),
      });
      setProjection(next);
      setRecovery(null);
      setSelectedStage(authoritativeStage(next));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function submitInterview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const action = projection?.goalInterview?.primaryAction;
    if (!action || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await request("/api/p0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: action.handle,
          values: actionValues(event.currentTarget, action.fields),
        }),
      });
      setProjection(next);
      setSelectedStage(next.goalInterview?.primaryAction ? "goal" : next.journey.currentStage);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  function keyboardSubmit(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projection?.primaryAction || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await request("/api/p0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: projection.primaryAction.handle,
          values: actionValues(event.currentTarget, projection.primaryAction.fields),
        }),
      });
      setProjection(next);
      setSelectedStage(next.journey.currentStage);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function submitCampaignEdit(event: FormEvent<HTMLFormElement>, handle: string, fields: OwnerActionField[]) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await request("/api/p0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle,
          values: actionValues(event.currentTarget, fields),
        }),
      });
      setProjection(next);
      setSelectedStage("campaigns");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function submitStrategyDecision(handle: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await request("/api/p0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle, values: {} }),
      });
      setProjection(next);
      setSelectedStage(next.journey.currentStage);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function submitStrategyEdit(event: FormEvent<HTMLFormElement>, handle: string, fields: OwnerActionField[]) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await request("/api/p0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle, values: actionValues(event.currentTarget, fields) }),
      });
      setProjection(next);
      setSelectedStage(next.journey.currentStage);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function submitBusinessModelEdit(event: FormEvent<HTMLFormElement>, handle: string, fields: OwnerActionField[]) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await request("/api/p0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle, values: actionValues(event.currentTarget, fields) }),
      });
      setProjection(next);
      setSelectedStage("findings");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function submitGoalCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const next = await request("/api/p0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipeline_action: "CORRECT_GOAL",
          desired_outcome: String(values.get("desired_outcome") ?? ""),
          qualified_action: String(values.get("qualified_action") ?? ""),
        }),
      });
      setProjection(next);
      setSelectedStage("goal");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function submitPipelineAction(action: "START" | "STOP") {
    if (busy) return;
    const pipeline = projection?.pipeline;
    if (action === "STOP" && (!pipeline?.runId || pipeline.version === null)) return;
    setBusy(true);
    setError("");
    try {
      const next = await request("/api/p0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "START"
          ? { pipeline_action: "START" }
          : {
              pipeline_action: "STOP",
              run_id: pipeline!.runId,
              expected_version: pipeline!.version,
            }),
      });
      setProjection(next);
      setSelectedStage(authoritativeStage(next));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  if (!projection) {
    return <div className={styles.prototype}>
      <Header />
      <main className={styles.pageA}><section className="owner-loading" aria-live="polite">
        <strong>{recovery ? "Нужен безопасный перезапуск подготовки" : "Готовлю путь владельца"}</strong>
        <p>{error || "Собираю текущий бизнес-вывод…"}</p>
        {recovery && <div className="owner-recovery-action">
          <p>{recovery.description}</p>
          <button type="button" disabled={busy} onClick={recoverInvalidLocalState}>{busy ? "Перезапускаю…" : recovery.label}</button>
        </div>}
      </section></main>
    </div>;
  }

  const activeStage = selectedStage ?? authoritativeStage(projection);
  const publicationReviewHandoff = projection.pipeline?.status === "COMPLETED"
    && projection.pipeline.currentStage === "review";
  const pipelineStage = projection.pipeline && projection.pipeline.status !== "NOT_STARTED"
    ? projection.pipeline.stages.find((stage) => stage.id === activeStage)
    : undefined;
  const activeStageStatus = publicationReviewHandoff && activeStage === "review"
    ? "complete"
    : pipelineStage
      ? pipelineStage.tone === "complete" ? "complete" : pipelineStage.tone === "active" ? "current" : "upcoming"
      : projection.journey.stages.find((stage) => stage.id === activeStage)?.status ?? "upcoming";
  const viewingCurrentStage = activeStage === authoritativeStage(projection);
  const pipelineControl = projection.pipeline && (projection.pipeline.status !== "NOT_STARTED"
    || (projection.journey.currentStage === "review" && projection.campaignOptions.length > 0))
    ? projection.pipeline
    : null;
  const ownerHasAction = Boolean(
    projection.primaryAction
      || projection.goalInterview?.primaryAction
      || projection.campaignStrategy?.ownerReview?.confirmHandle
      || projection.campaignStrategy?.ownerReview?.rejectHandle,
  );
  const ownerActionProblem = ownerHasAction
    ? projection.cards.find((card) => card.kind === "human-decision-gate")
      ?? projection.cards.find((card) => card.kind === "problem")
      ?? null
    : null;
  const autonomousWork = projection.pipeline?.active
    || projection.businessOutcome.status === "working"
    || projection.agentActivity?.status === "working"
    || projection.agentActivity?.status === "waiting";

  function chooseStage(stage: OwnerJourneyStageId) {
    setSelectedStage(stage);
    const url = new URL(window.location.href);
    url.searchParams.set("stage", stage);
    window.history.replaceState({}, "", url);
    window.requestAnimationFrame(() => document.getElementById("owner-stage-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return <div className={styles.prototype}>
    <Header />
    <main className={styles.pageA} id="module">
      {activeStage === "goal" && <Hero projection={projection} />}
      {pipelineControl && <PipelineControl
        pipeline={pipelineControl}
        busy={busy}
        onAction={submitPipelineAction}
      />}
      <StageNavigation projection={projection} selectedStage={activeStage} onStage={chooseStage} />
      <fieldset className={`${styles.ownerWorkspace} pipeline-readonly-boundary`} disabled={projection.pipeline?.editingLocked ?? false} aria-label="Текущий результат и редактирование">
        <AgentRail projection={projection} />
        <section className={`${styles.artifact} owner-main`} id="owner-stage-panel" aria-labelledby={`owner-stage-tab-${activeStage}`}>
          <header className={`${styles.sectionHead} owner-outcome`}>
            <div><p className={styles.eyebrow}>ТЕКУЩИЙ БИЗНЕС-РЕЗУЛЬТАТ</p><h2>{projection.businessOutcome.headline}</h2></div>
          </header>

          {projection.currentRecommendation && <section className="owner-recommendation">
            <span>Текущая рекомендация</span><h3>{projection.currentRecommendation.headline}</h3><p>{projection.currentRecommendation.rationale}</p>
          </section>}

          {activeStageStatus === "upcoming" && <StageUnavailable projection={projection} stage={activeStage} />}
          {activeStage === "goal" && activeStageStatus !== "upcoming" && <GoalStageSummary projection={projection} />}
          {activeStage === "goal" && activeStageStatus !== "upcoming" && projection.pipeline && <GoalFormationSummary pipeline={projection.pipeline} busy={busy} onCorrect={submitGoalCorrection} />}
          {activeStage === "goal" && activeStageStatus !== "upcoming" && projection.goalInterview && projection.pipeline?.goalFormation.status !== "VERIFIED" && <GoalInterview
            interview={projection.goalInterview}
            busy={busy}
            headingRef={interviewHeadingRef}
            onSubmit={submitInterview}
            onKeyDown={keyboardSubmit}
          />}

          {activeStage === "findings" && activeStageStatus !== "upcoming" && projection.analyticsSummary && <AnalyticsSummaryDisclosure summary={projection.analyticsSummary} />}

          {activeStage === "findings" && activeStageStatus !== "upcoming" && projection.directReport && <section className="owner-direct-report" data-report-state={projection.directReport.state} aria-labelledby="owner-direct-report-title">
            <header><div><p className="owner-eyebrow">ТЕКУЩЕЕ ПРОДВИЖЕНИЕ В ЯНДЕКС ДИРЕКТЕ</p><h2 id="owner-direct-report-title">Отчёт о текущем продвижении</h2></div><strong>{projection.directReport.status}</strong></header>
            <div className="owner-direct-lead"><div><h3>{projection.directReport.headline}</h3><p>{projection.directReport.summary}</p></div><dl><div><dt>Наблюдение</dt><dd>{projection.directReport.observedAt}</dd></div><div><dt>Свежесть</dt><dd>{projection.directReport.freshness}</dd></div></dl></div>
            <div className="owner-direct-inventory" aria-label="Состав продвижения">{projection.directReport.inventory.map((item) => <article key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small>{item.detail}</small></article>)}</div>
            <section className="owner-direct-campaign-list" aria-labelledby="owner-direct-campaigns-title"><h3 id="owner-direct-campaigns-title">Кампании в снимке</h3>{projection.directReport.campaigns.length > 0 ? <div>{projection.directReport.campaigns.map((campaign) => <article key={`${campaign.name}-${campaign.delivery}-${campaign.review}`}><strong>{campaign.name}</strong><span>{campaign.delivery}</span><small>{campaign.review}</small></article>)}</div> : <p>{projection.directReport.state === "empty" ? "Проверенный срез не содержит кампаний." : "Список кампаний недоступен; это не означает, что кампаний нет."}</p>}</section>
            <div className="owner-direct-details">
              <article><header><span>Поисковые запросы</span><b>{projection.directReport.queries.status}</b></header><h3>{projection.directReport.queries.value}</h3><p>{projection.directReport.queries.detail}</p></article>
              <article><header><span>Наблюдаемые результаты</span><b>{projection.directReport.results.status}</b></header><h3>{projection.directReport.results.value}</h3><p>{projection.directReport.results.detail}</p></article>
            </div>
          </section>}

          {activeStage === "findings" && activeStageStatus !== "upcoming" && projection.businessModel && <section className="owner-business-model" aria-labelledby="owner-business-model-title">
            <header><div><p className="owner-eyebrow">МОДЕЛЬ БИЗНЕСА</p><h2 id="owner-business-model-title">Проверяемое понимание бизнеса</h2></div><strong>{projection.businessModel.economics.status}</strong></header>
            <div className="owner-model-economics"><span>Целевая стоимость результата</span><b>{projection.businessModel.economics.targetResultCost}</b><p>{projection.businessModel.economics.explanation}</p></div>
            <div className="owner-model-grid">{projection.businessModel.fields.map((field) => <article key={field.label}>
              <header><h3>{field.label}</h3><span>{field.availability}</span></header><p>{field.value}</p>
              <dl><div><dt>Источник</dt><dd>{field.provenance}</dd></div><div><dt>Наблюдение</dt><dd>{field.observedAt}</dd></div><div><dt>Свежесть</dt><dd>{field.freshness}</dd></div><div><dt>Уверенность</dt><dd>{field.confidence}</dd></div><div><dt>Ограничение</dt><dd>{field.limitation}</dd></div><div><dt>Предположение</dt><dd>{field.assumption}</dd></div></dl>
            </article>)}</div>
            {projection.businessModel.materialQuestions.length > 0 && <div className="owner-model-questions"><h3>Только существенные вопросы</h3><ul>{projection.businessModel.materialQuestions.map((item) => <li key={item.question}><strong>{item.question}</strong><span>{item.consequence}</span></li>)}</ul></div>}
            {projection.businessModel.editor && <BusinessModelEditor
              editor={projection.businessModel.editor}
              busy={busy}
              onEdit={submitBusinessModelEdit}
            />}
          </section>}

          {activeStage === "strategy" && activeStageStatus !== "upcoming" && projection.campaignStrategy && <section className="owner-business-readiness" aria-labelledby="owner-campaign-strategy-title">
            <header><div><p className="owner-eyebrow">CAMPAIGN STRATEGY</p><h2 id="owner-campaign-strategy-title">Полная рекомендация агента</h2></div><strong>{projection.campaignStrategy.status}</strong></header>
            <div className="owner-demand-cost-grid">{projection.campaignStrategy.recommendations.map((item) => <article key={item.label} data-strategy-recommendation={item.label === "Стоимость перехода до запуска" ? "prelaunch-click-cost" : undefined}>
              <span>{item.label}</span><h3>{item.value}</h3><p>{item.rationale}</p><small>Уверенность: {item.confidence}</small>
            </article>)}</div>
            <p className="owner-cost-semantics"><b>Разделение стоимости:</b> стоимость перехода отражает аукционный CPC по ключевой фразе; целевая стоимость результата относится к бизнес-экономике. Ни одно из значений не является прогнозом эффективности.</p>
            {projection.campaignStrategy.materialQuestions.length > 0 && <div className="owner-model-questions"><h3>Только существенные вопросы</h3><ul>{projection.campaignStrategy.materialQuestions.map((item) => <li key={item.field}><strong>{item.field}: {item.question}</strong><span>{item.recommendation} {item.consequences}</span></li>)}</ul></div>}
            {projection.campaignStrategy.decisionGate && <article className="owner-card human-decision-gate"><span>РЕШЕНИЕ ВЛАДЕЛЬЦА</span><h3>{projection.campaignStrategy.decisionGate.recommendation}</h3><p><b>Основание:</b> {projection.campaignStrategy.decisionGate.evidence}</p><p><b>Уверенность:</b> {projection.campaignStrategy.decisionGate.confidence}</p><p><b>Альтернативы:</b> {projection.campaignStrategy.decisionGate.alternatives}</p><p><b>Последствия:</b> {projection.campaignStrategy.decisionGate.consequences}</p></article>}
            {projection.campaignStrategy.ownerReview && <StrategyOwnerReview
              review={projection.campaignStrategy.ownerReview}
              busy={busy}
              onDecision={submitStrategyDecision}
              onEdit={submitStrategyEdit}
            />}
          </section>}

          {activeStage === "findings" && activeStageStatus !== "upcoming" && projection.demandCostResearch && <section className="owner-demand-cost" aria-labelledby="owner-demand-cost-title">
            <header><div><p className="owner-eyebrow">СПРОС И СОПОСТАВИМАЯ СТОИМОСТЬ</p><h2 id="owner-demand-cost-title">Исследование нескольких формулировок</h2></div><strong>{projection.demandCostResearch.demand.status}</strong></header>
            <div className="owner-demand-cost-grid">
              <article><span>Спрос</span><h3>{projection.demandCostResearch.demand.conclusion}</h3><dl><div><dt>Источник и дата</dt><dd>{projection.demandCostResearch.demand.source} · {projection.demandCostResearch.demand.observedAt}</dd></div><div><dt>Метод</dt><dd>{projection.demandCostResearch.demand.method}</dd></div><div><dt>Окно</dt><dd>{projection.demandCostResearch.demand.window}</dd></div><div><dt>Область</dt><dd>{projection.demandCostResearch.demand.scope}</dd></div><div><dt>Покрытие</dt><dd>{projection.demandCostResearch.demand.coverage}</dd></div><div><dt>Сезонность</dt><dd>{projection.demandCostResearch.demand.seasonality}</dd></div></dl><p>{projection.demandCostResearch.demand.limitation}</p></article>
              <article><span>Сопоставимая стоимость</span><h3>{projection.demandCostResearch.cost.range}</h3><dl><div><dt>Источник и дата</dt><dd>{projection.demandCostResearch.cost.source} · {projection.demandCostResearch.cost.observedAt}</dd></div><div><dt>Валюта и НДС</dt><dd>{projection.demandCostResearch.cost.currency} · {projection.demandCostResearch.cost.vat}</dd></div><div><dt>Выборка</dt><dd>{projection.demandCostResearch.cost.sample}</dd></div><div><dt>Сопоставимость</dt><dd>{projection.demandCostResearch.cost.scope}</dd></div></dl><p>{projection.demandCostResearch.cost.limitation}</p></article>
            </div>
            <div className="owner-demand-formulations"><h3>Частоты проверенных формулировок</h3>{projection.demandCostResearch.demand.formulations.map((item, index) => <article key={`${item.category}-${index}`} data-frequency-state={item.status === "Частота получена" ? "available" : "unavailable"}>
              <header><span>{item.category}</span><strong>{item.phrase}</strong><b>{item.frequency}</b></header>
              <dl><div><dt>Метод</dt><dd>{item.method} · {item.operator}</dd></div><div><dt>Область и дата</dt><dd>{item.scope} · {item.observedAt}</dd></div><div><dt>Происхождение</dt><dd>{item.provenance}</dd></div></dl>
              <small>{item.status}</small>
            </article>)}</div>
            {projection.demandCostResearch.demand.gaps.length > 0 && <div className="owner-demand-gaps"><strong>Пробелы пакета</strong><ul>{projection.demandCostResearch.demand.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul></div>}
            <article className="owner-demand-next-action"><span>Следующий шаг</span><strong>{projection.demandCostResearch.demand.nextAction}</strong></article>
          </section>}

          {activeStage === "strategy" && activeStageStatus !== "upcoming" && projection.appliedPractice && <section className="owner-recommendation" aria-labelledby="owner-applied-practice-title">
            <span>Применённая практика</span><h3 id="owner-applied-practice-title">{projection.appliedPractice.practice}</h3><p>{projection.appliedPractice.limitation}</p>
          </section>}

          {activeStage === "findings" && activeStageStatus !== "upcoming" && projection.competitorMatrix && <section className="owner-competitor-matrix" aria-labelledby="owner-competitor-matrix-title">
            <header><div><p className="owner-eyebrow">ПУБЛИЧНОЕ ПОЗИЦИОНИРОВАНИЕ</p><h2 id="owner-competitor-matrix-title">Матрица конкурентов</h2></div><strong>{projection.competitorMatrix.status}</strong></header>
            <p className="owner-competitor-rule"><b>Как выбран набор:</b> {projection.competitorMatrix.competitorSetRule}</p>
            <div className="owner-competitor-candidates">{projection.competitorMatrix.candidates.map((candidate) => <article key={candidate.competitor}><h3>{candidate.competitor}</h3><p>{candidate.rationale}</p><small>{candidate.exactDestinations.join(" · ")}</small></article>)}</div>
            {projection.competitorMatrix.rows.length > 0 ? <div className="owner-competitor-rows">{projection.competitorMatrix.rows.map((row) => <article key={`${row.competitor}-${row.exactLanding}`}>
              <header><h3>{row.competitor}</h3><span>{row.observationDate}</span></header>
              <dl>
                <div><dt>Продукты и услуги</dt><dd>{row.productsServices}</dd></div>
                <div><dt>Наблюдаемое предложение</dt><dd>{row.observedOfferMessage}</dd></div>
                <div><dt>Опубликованная цена</dt><dd>{row.publishedPrice}</dd></div>
                <div><dt>Точная посадочная</dt><dd>{row.exactLanding}</dd></div>
                <div><dt>Источник</dt><dd>{row.source}</dd></div>
                <div><dt>География и устройство</dt><dd>{row.geography} · {row.device}</dd></div>
                <div><dt>Статус рекламного наблюдения</dt><dd>{row.adObservationStatus}</dd></div>
                <div><dt>Источник рекламного наблюдения</dt><dd>{row.adObservationSource}</dd></div>
                <div><dt>Дата рекламного наблюдения</dt><dd>{row.adObservationDate}</dd></div>
                <div><dt>Точная область рекламного наблюдения</dt><dd>{row.adObservationScope}</dd></div>
                <div><dt>Ограничение рекламного наблюдения</dt><dd>{row.adObservationLimitation}</dd></div>
              </dl>
            </article>)}</div> : <p className="owner-competitor-unavailable">Публичные наблюдения не получены и остаются недоступными, а не нулевыми.</p>}
            <div className="owner-competitor-aggregates"><h3>Выводы только по этому набору</h3>{projection.competitorMatrix.aggregateClaims.map((claim) => <article key={claim.claim}><strong>{claim.claim}</strong><span>{claim.result}</span><p>{claim.scope} {claim.limitation}</p></article>)}</div>
            {projection.competitorMatrix.hypotheses.length > 0 && <div className="owner-competitor-hypotheses"><h3>Гипотезы для кампании — не факты эффективности</h3>{projection.competitorMatrix.hypotheses.map((hypothesis) => <article key={hypothesis.pattern}>
              <span>ПОВТОРЯЮЩАЯСЯ РЫНОЧНАЯ ТЕХНИКА</span>
              <h4>{hypothesis.pattern}</h4>
              <p><b>Проверяемая гипотеза:</b> {hypothesis.hypothesis}</p>
              <p><b>Основание:</b> {hypothesis.basis}</p>
              <p><b>Точный набор доказательств:</b></p>
              <ul>{hypothesis.evidenceSet.map((evidence) => <li key={`${evidence.competitor}-${evidence.exactLanding}`}><strong>{evidence.competitor}</strong> · {evidence.exactLanding} · {evidence.observationDate}</li>)}</ul>
              <p>{hypothesis.limitation}</p>
            </article>)}</div>}
            <div className="owner-competitor-limitations"><strong>Что эта матрица не доказывает</strong><ul>{projection.competitorMatrix.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></div>
          </section>}

          {viewingCurrentStage && projection.agentActivity && <section className="owner-progress" aria-label="Ход работы агента">
            <i /><div><strong>{projection.agentActivity.summary}</strong><p>{projection.agentActivity.nextBusinessStep}</p></div>
            <span>{projection.agentActivity.completed} из {projection.agentActivity.total}</span>
          </section>}

          {viewingCurrentStage && ownerActionProblem && <section className="owner-cards" aria-label="Проблема, требующая действия владельца">
            <article className={`owner-card ${ownerActionProblem.kind}`}>
              <span>{cardLabels[ownerActionProblem.kind]}</span><h3>{ownerActionProblem.title}</h3><p>{ownerActionProblem.body}</p>
              {ownerActionProblem.facts && <dl>{ownerActionProblem.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}
            </article>
          </section>}

          {activeStage === "review" && publicationReviewHandoff && <section className="owner-recommendation publication-review-boundary" role="status">
            <span>ПРОВЕРКА ПУБЛИКАЦИИ</span>
            <h3>Текущие Draft переданы на отдельную проверку</h3>
            <p>Просмотр и правки доступны без решения о публикации. Этот этап не создаёт и не изменяет кампании в Директе, не запускает показы и не расходует бюджет.</p>
          </section>}

          {(activeStage === "campaigns" || activeStage === "review") && activeStageStatus !== "upcoming" && projection.pipeline?.campaignDossier && <CampaignPairDossier dossier={projection.pipeline.campaignDossier} />}

          {(activeStage === "campaigns" || (activeStage === "review" && publicationReviewHandoff)) && activeStageStatus !== "upcoming" && projection.campaignOptions.length > 0 && <section className="owner-campaigns" aria-labelledby="owner-campaigns-title">
            <header><p className="owner-eyebrow">ТЕКУЩИЕ CAMPAIGN DRAFT</p><h2 id="owner-campaigns-title">Кампании для бизнес-проверки</h2></header>
            <div>{projection.campaignOptions.map((campaign, index) => <CampaignOption
              key={`${campaign.editor.publicationHandle ?? campaign.editor.protocolHandle ?? campaign.editor.versionLabel}-${index}`}
              campaign={campaign}
              busy={busy}
              onSubmit={submitCampaignEdit}
            />)}</div>
          </section>}

          {viewingCurrentStage && projection.primaryAction && <form key={projection.primaryAction.handle} className="owner-action" onSubmit={submit}>
            <header><p className="owner-eyebrow">СЛЕДУЮЩИЙ ШАГ</p><h2>{projection.primaryAction.label}</h2><p>{projection.primaryAction.description}</p></header>
            {projection.primaryAction.fields.length > 0 && <div className="owner-fields">{projection.primaryAction.fields.map((field) => <OwnerField key={field.key} field={field} />)}</div>}
            <button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? "Агент выполняет работу…" : projection.primaryAction.label}</button>
          </form>}
          {viewingCurrentStage && !ownerHasAction && autonomousWork && <div className="owner-progress" role="status"><i /><div><strong>Агент продолжает работу</strong><p>Автоматические проверки и безопасная сверка не требуют действий владельца.</p></div></div>}
          {viewingCurrentStage && !ownerHasAction && !autonomousWork && <section className="owner-terminal-result" role="status"><span>ТЕКУЩИЙ РЕЗУЛЬТАТ</span><h2>{projection.businessOutcome.headline}</h2><p>{projection.businessOutcome.summary}</p></section>}
          {error && <p className="owner-error" role="alert" ref={errorRef} tabIndex={-1}>{error}</p>}
        </section>

      </fieldset>
    </main>
  </div>;
}

type BusinessModelEditorProjection = NonNullable<NonNullable<OwnerJourneyProjection["businessModel"]>["editor"]>;

function BusinessModelEditor({
  editor,
  busy,
  onEdit,
}: {
  editor: BusinessModelEditorProjection;
  busy: boolean;
  onEdit: (event: FormEvent<HTMLFormElement>, handle: string, fields: OwnerActionField[]) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  return <section className="owner-strategy-version-editor owner-business-model-editor">
    <button type="button" onClick={() => setEditing((value) => !value)} aria-expanded={editing}>{editing ? "Закрыть редактор модели бизнеса" : "Изменить модель бизнеса"}</button>
    {editing && <form onSubmit={(event) => onEdit(event, editor.handle, editor.fields)}>
      <p>Сохранение создаст новую текущую версию модели бизнеса и заново соберёт зависимые сведения, Strategy и Campaign Draft.</p>
      <div className="owner-fields">{editor.fields.map((field) => <OwnerField key={field.key} field={field} />)}</div>
      <footer><button type="button" onClick={(event) => { event.currentTarget.form?.reset(); setEditing(false); }}>Отменить правки</button><button type="submit" disabled={busy}>{busy ? "Сохраняю…" : "Сохранить и пересобрать"}</button></footer>
    </form>}
  </section>;
}

type StrategyOwnerReviewProjection = NonNullable<NonNullable<OwnerJourneyProjection["campaignStrategy"]>["ownerReview"]>;

type PipelineCampaignDossier = NonNullable<NonNullable<OwnerJourneyProjection["pipeline"]>["campaignDossier"]>;

function StrategyOwnerReview({
  review,
  busy,
  onDecision,
  onEdit,
}: {
  review: StrategyOwnerReviewProjection;
  busy: boolean;
  onDecision: (handle: string) => Promise<void>;
  onEdit: (event: FormEvent<HTMLFormElement>, handle: string, fields: OwnerActionField[]) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  return <section className="owner-strategy-review" data-review-status={review.status} aria-labelledby="owner-strategy-review-title">
    <header>
      <div><p className="owner-eyebrow">ОТДЕЛЬНЫЙ ШАГ ВЛАДЕЛЬЦА</p><h3 id="owner-strategy-review-title">Проверка точной версии стратегии</h3><p>Сначала проверьте весь бизнес-смысл и доказательства. Только отдельное подтверждение откроет черновики кампаний.</p></div>
      <strong>{review.versionLabel} · {review.status}</strong>
    </header>
    <p className="owner-strategy-exactness">{review.exactBinding}</p>
    <div className="owner-strategy-review-summary">{review.summary.map((item) => <article key={item.label}><span>{item.label}</span><strong>{item.value}</strong><p>{item.explanation}</p></article>)}</div>
    <section className="owner-strategy-review-decisions" aria-labelledby="owner-strategy-decisions-title">
      <h4 id="owner-strategy-decisions-title">Полная стратегия рядом с основаниями</h4>
      <div>{review.decisions.map((item) => <article key={item.label}><header><strong>{item.label}</strong><span>{item.confidence}</span></header><p>{item.value}</p><small>{item.evidence}</small></article>)}</div>
    </section>
    <div className="owner-strategy-review-boundaries">
      <section><h4>Альтернативы</h4><ul>{review.alternatives.map((item) => <li key={item}>{item}</li>)}</ul></section>
      <section><h4>Ограничения и доказательства</h4><ul>{review.limitations.map((item) => <li key={item}>{item}</li>)}</ul></section>
    </div>
    {(review.rejectHandle || review.confirmHandle) && <footer>
      {review.rejectHandle && <button type="button" onClick={() => onDecision(review.rejectHandle!)} disabled={busy}>Вернуться к редактированию</button>}
      {review.confirmHandle && <button type="button" className="owner-strategy-confirm" onClick={() => onDecision(review.confirmHandle!)} disabled={busy}>{busy ? "Подтверждаю…" : "Подтвердить точную версию"}</button>}
    </footer>}
    {review.editorHandle && <div className="owner-strategy-version-editor">
      <button type="button" onClick={() => setEditing((value) => !value)} aria-expanded={editing}>{editing ? "Закрыть редактор стратегии" : "Изменить стратегию"}</button>
      {editing && <form onSubmit={(event) => onEdit(event, review.editorHandle!, review.editorFields)}>
        <p>Существенное сохранение сразу отменит это подтверждение и закроет черновики до новой отдельной проверки. Нормализация без изменения смысла сохранит текущую версию.</p>
        <div className="owner-fields">{review.editorFields.map((field) => <OwnerField key={field.key} field={field} />)}</div>
        <footer><button type="button" onClick={(event) => { event.currentTarget.form?.reset(); setEditing(false); }}>Отменить правки</button><button type="submit" disabled={busy}>{busy ? "Сохраняю…" : "Сохранить и проверить новую версию"}</button></footer>
      </form>}
    </div>}
  </section>;
}

function CampaignPairDossier({ dossier }: { dossier: PipelineCampaignDossier }) {
  return <section className="owner-campaign-dossier" aria-labelledby="owner-campaign-dossier-title">
    <header>
      <div><p className="owner-eyebrow">CAMPAIGN HYPOTHESIS + ПОЛНЫЙ CAMPAIGN DRAFT</p><h2 id="owner-campaign-dossier-title">{dossier.title}</h2><p>{dossier.profile}</p></div>
      <strong>{dossier.state}</strong>
    </header>
    <p className="owner-dossier-safety">{dossier.safety}</p>
    <ol className="owner-dossier-lineage" aria-label="Campaign Strategy → Campaign Hypothesis → Campaign Draft">
      {dossier.lineage.map((item) => <li key={item.kind}><span>{item.kind}</span><strong>{item.summary}</strong><small>{item.versionLabel}</small></li>)}
    </ol>
    <section className="owner-dossier-hypothesis" aria-labelledby="owner-dossier-hypothesis-title">
      <div><p className="owner-eyebrow">БИЗНЕС-СМЫСЛ</p><h3 id="owner-dossier-hypothesis-title">{dossier.hypothesis.mechanism}</h3></div>
      <dl><div><dt>Основная метрика</dt><dd>{dossier.hypothesis.primaryMetric}</dd></div><div><dt>С чем сравниваем</dt><dd>{dossier.hypothesis.baseline}</dd></div></dl>
      <p><b>Доказательства:</b> {dossier.hypothesis.evidence.join(" · ")}</p>
    </section>
    <section className="owner-dossier-preview" aria-labelledby="owner-dossier-preview-title">
      <header><p className="owner-eyebrow">ЧТО УВИДИТ КЛИЕНТ</p><h3 id="owner-dossier-preview-title">Заголовки, тексты, ссылка и все сочетания</h3></header>
      <div className="owner-dossier-copy"><article><h4>Заголовки</h4><ul>{dossier.clientPreview.titles.map((title) => <li key={title}>{title}</li>)}</ul></article><article><h4>Тексты</h4><ul>{dossier.clientPreview.texts.map((value) => <li key={value}>{value}</li>)}</ul></article></div>
      <p className="owner-dossier-link"><b>Ссылка:</b> {dossier.clientPreview.link}</p>
      <ol className="owner-dossier-combinations">{dossier.clientPreview.combinations.map((combination, index) => <li key={`${combination.title}-${combination.text}-${index}`}><strong>{combination.title}</strong><span>{combination.text}</span><small>{combination.link}</small></li>)}</ol>
      <footer><p><b>Происхождение:</b> {dossier.clientPreview.creativeSource} · {dossier.clientPreview.creativeRights}</p><p><b>Обязательные оговорки:</b> {dossier.clientPreview.requiredDisclaimers.length ? dossier.clientPreview.requiredDisclaimers.join(" · ") : "Не требуются для текущего подтверждённого содержания"}</p></footer>
    </section>
    <section className="owner-dossier-mapping" aria-labelledby="owner-dossier-mapping-title">
      <header><p className="owner-eyebrow">STRATEGY → CAMPAIGN DRAFT</p><h3 id="owner-dossier-mapping-title">Решение → evidence → точное поле</h3></header>
      {dossier.strategyMapping.map((item) => <article key={item.dimension}>
        <h4>{item.dimension}</h4>
        <div><span>Решение</span><strong>{item.decision}</strong><small>{item.rationale}</small></div>
        <div><span>Evidence</span><ul>{item.evidence.map((reference) => <li key={reference}>{reference}</li>)}</ul></div>
        <div><span>Точное поле Draft</span><dl>{item.exactDraftFields.map((field) => <div key={field.pointer}><dt><code>{field.pointer}</code></dt><dd>{field.value}</dd></div>)}</dl></div>
      </article>)}
    </section>
    <details className="owner-dossier-direct">
      <summary>Точная Direct Projection · {dossier.directProjection.fields.length} полей</summary>
      <p>{dossier.directProjection.graph.join(" · ")}</p>
      <div>{dossier.directProjection.fields.map((field) => <article key={field.pointer}><code>{field.pointer}</code><strong>{field.disposition}</strong><output>{field.value}</output><small>Происхождение: {field.provenance}</small></article>)}</div>
    </details>
  </section>;
}

type CampaignOptionProjection = OwnerJourneyProjection["campaignOptions"][number];

function CampaignOption({
  campaign,
  busy,
  onSubmit,
}: {
  campaign: CampaignOptionProjection;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>, handle: string, fields: OwnerActionField[]) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const canEdit = Boolean(campaign.editor.publicationHandle || campaign.editor.protocolHandle);
  return <article>
    <header><span>ТЕКУЩАЯ КАМПАНИЯ</span></header>
    <h3>{campaign.name}</h3>
    <div className="owner-draft-version">
      <div><span>{campaign.editor.versionLabel}</span></div>
      {canEdit ? <button type="button" onClick={() => setEditing((value) => !value)} aria-expanded={editing}>{editing ? "Закрыть редактор" : "Редактировать черновик"}</button>
        : <span>Редактирование завершено</span>}
    </div>
    <dl><div><dt>Предложение</dt><dd>{campaign.offer}</dd></div><div><dt>Аудитория</dt><dd>{campaign.audience}</dd></div><div><dt>Куда ведём</dt><dd>{campaign.destination}</dd></div></dl>
    {editing && <section className="owner-draft-editor" aria-label={`Редактор черновика «${campaign.name}»`}>
      <header><div><span>РУЧНОЕ РЕДАКТИРОВАНИЕ</span><h4>Точная сохранённая редакция кампании</h4></div><strong>Без технических идентификаторов</strong></header>
      <p>Каждая форма изменяет только эту кампанию. Существенная правка создаёт новую редакцию; отмена возвращает сохранённые значения.</p>
      {campaign.editor.publicationHandle && <form onSubmit={(event) => onSubmit(event, campaign.editor.publicationHandle!, campaign.editor.publicationFields)}>
        <h5>Кампания, таргетинг и объявление</h5>
        <div className="owner-fields">{campaign.editor.publicationFields.map((field) => <OwnerField key={field.key} field={field} />)}</div>
        <footer><button type="button" onClick={(event) => { event.currentTarget.form?.reset(); setEditing(false); }}>Отменить правки</button><button type="submit" disabled={busy}>{busy ? "Сохраняю…" : "Сохранить новую версию"}</button></footer>
      </form>}
      {campaign.editor.protocolHandle && <form onSubmit={(event) => onSubmit(event, campaign.editor.protocolHandle!, campaign.editor.protocolFields)}>
        <h5>Аукционный протокол</h5>
        <p>Бюджет, период, сравнение и условия результата сохраняются независимо для этой кампании.</p>
        <div className="owner-fields">{campaign.editor.protocolFields.map((field) => <OwnerField key={field.key} field={field} />)}</div>
        <footer><button type="button" onClick={(event) => { event.currentTarget.form?.reset(); setEditing(false); }}>Отменить правки протокола</button><button type="submit" disabled={busy}>{busy ? "Сохраняю…" : "Сохранить протокол"}</button></footer>
      </form>}
      <details className="owner-draft-contract">
        <summary>Поддерживаемые, условные и неподдерживаемые значения</summary>
        <p>Поля не исчезают молча: каждое значение явно редактируется, фиксируется либо блокируется.</p>
        <div>{campaign.editor.publicationContract.map((field) => <div key={`${field.section}-${field.label}`} data-field-classification={field.classification}>
          <span>{field.section}</span><strong>{field.label}</strong><b>{field.classification}</b><output>{field.value}</output><small>{field.explanation}</small>
        </div>)}</div>
        <section><h5>Границы текущего профиля</h5>{campaign.editor.capabilityBoundaries.map((boundary) => <div key={boundary.label} data-capability-classification={boundary.classification}><strong>{boundary.label}</strong><b>{boundary.classification}</b><small>{boundary.explanation}</small></div>)}</section>
      </details>
    </section>}
    <section className="owner-publish-preview" aria-label="Заранее зафиксированный протокол теста">
      <h4>Как будет проверяться гипотеза</h4>
      <dl>
        <div><dt>Сравнение</dt><dd>{campaign.auctionProtocol.control}</dd></div>
        <div><dt>Проверяемое изменение</dt><dd>{campaign.auctionProtocol.testedChange}</dd></div>
        <div><dt>Ставки и предел</dt><dd>{campaign.auctionProtocol.biddingStrategy} · {campaign.auctionProtocol.bidCeiling}</dd></div>
        <div><dt>Запросы</dt><dd>{campaign.auctionProtocol.queryMatching}</dd></div>
        <div><dt>Автотаргетинг</dt><dd>{campaign.auctionProtocol.autotargetingPolicy}</dd></div>
        <div><dt>Распределение</dt><dd>{campaign.auctionProtocol.trafficSplit}</dd></div>
        <div><dt>Бюджет и период</dt><dd>{campaign.auctionProtocol.testBudget} · {campaign.auctionProtocol.testPeriod}</dd></div>
        <div><dt>Измеряемый результат</dt><dd>{campaign.auctionProtocol.measurementGoal}</dd></div>
        <div><dt>Условие успеха</dt><dd>{campaign.auctionProtocol.successThreshold}</dd></div>
        <div><dt>Условие остановки</dt><dd>{campaign.auctionProtocol.stopCondition}</dd></div>
        <div><dt>Честность вывода</dt><dd>{campaign.auctionProtocol.attribution}</dd></div>
      </dl>
      <p>{campaign.auctionProtocol.evidenceStatus}</p>
    </section>
    <section className="owner-publish-preview" aria-label="Точный предпросмотр публикации">
      <h4>Что увидят клиенты</h4>
      <div><strong>Заголовки</strong><ul>{campaign.publishPreview.titles.map((title) => <li key={title}>{title}</li>)}</ul></div>
      <div><strong>Тексты</strong><ul>{campaign.publishPreview.texts.map((text) => <li key={text}>{text}</li>)}</ul></div>
      <div><strong>Ссылки и отслеживание</strong>{campaign.publishPreview.urls.map((url) => <p key={`${url.landing}-${url.tracking}`}>{url.landing}<small>{url.tracking}</small></p>)}</div>
      <details><summary>Поддерживаемые сочетания · {campaign.publishPreview.creativeCombinations.length}</summary><ol>{campaign.publishPreview.creativeCombinations.map((combination, combinationIndex) => <li key={`${combination.title}-${combination.text}-${combinationIndex}`}><b>{combination.title}</b><span>{combination.text}</span><small>{combination.landing}</small></li>)}</ol></details>
      <p><b>Происхождение:</b> {campaign.publishPreview.creativeProvenance.family} · {campaign.publishPreview.creativeProvenance.source} · {campaign.publishPreview.creativeProvenance.rights}</p>
      <p><b>Обязательные оговорки:</b> {campaign.publishPreview.requiredDisclaimers.length ? campaign.publishPreview.requiredDisclaimers.join(" · ") : "Для текущего подтверждённого содержания не требуются"}</p>
    </section>
  </article>;
}

function Hero({ projection }: { projection: OwnerJourneyProjection }) {
  return <section className={styles.hero}>
    <div><p className={styles.eyebrow}>P0 · ПРОИЗВОДСТВЕННЫЙ МОДУЛЬ</p><h1>Стратегия и рекламные кампании</h1><p>Агент ведёт владельца от бизнес-цели до готовых рекламных кампаний.</p></div>
    <div className={styles.heroOutcome}><span>Текущий результат</span><strong>{projection.businessOutcome.headline}</strong><small>{projection.businessOutcome.summary}</small></div>
  </section>;
}

type PipelineProjection = NonNullable<OwnerJourneyProjection["pipeline"]>;

function PipelineControl({
  pipeline,
  busy,
  onAction,
}: {
  pipeline: PipelineProjection;
  busy: boolean;
  onAction: (action: "START" | "STOP") => Promise<void>;
}) {
  return <section className="owner-pipeline-control" data-run-status={pipeline.status} aria-labelledby="owner-pipeline-title">
    <header>
      <div><p className="owner-eyebrow">ЕДИНЫЙ ЗАПУСК</p><h2 id="owner-pipeline-title">{pipeline.currentTask}</h2><p>{pipeline.stateText}</p></div>
      <strong>{pipeline.active ? "Выполняется" : pipeline.status === "STOPPED" ? "Остановлен" : pipeline.status === "COMPLETED" ? "Завершён" : "Готов к запуску"}</strong>
    </header>
    {pipeline.return && <article className="owner-pipeline-return" role="status">
      <span>ВОЗВРАТ</span><strong>{pipeline.return.source} → {pipeline.return.target}</strong><p>{pipeline.return.reason}</p>
    </article>}
    {pipeline.editingLocked && <p className="owner-pipeline-lock" role="status">Текущие Цель, Campaign Strategy и пары доступны только для чтения до остановки или завершения запуска.</p>}
    {pipeline.provenance && <ResultProvenance provenance={pipeline.provenance} />}
    <footer>
      {pipeline.canStart && <button type="button" className={styles.primaryButton} onClick={() => onAction("START")} disabled={busy}>{busy ? "Запускаю…" : "Запустить"}</button>}
      {pipeline.canStop && <button type="button" className="owner-pipeline-stop" onClick={() => onAction("STOP")} disabled={busy}>{busy ? "Останавливаю…" : "Остановить"}</button>}
    </footer>
  </section>;
}

function ResultProvenance({ provenance }: { provenance: NonNullable<PipelineProjection["provenance"]> }) {
  const [answer, setAnswer] = useState<OwnerResultExplanation | null>(null);
  const [asking, setAsking] = useState(false);
  const [questionError, setQuestionError] = useState("");

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (asking) return;
    const data = new FormData(event.currentTarget);
    setAsking(true);
    setQuestionError("");
    try {
      const response = await fetch("/api/p0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipeline_action: "EXPLAIN",
          pair_key: String(data.get("pair_key") ?? ""),
          question: String(data.get("question") ?? ""),
        }),
      });
      const value = await response.json() as OwnerResultExplanation & { message?: string };
      if (!response.ok) throw new Error(value.message ?? "Не удалось объяснить текущий результат.");
      setAnswer(value);
    } catch (reason) {
      setQuestionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setAsking(false);
    }
  }

  return <details className="owner-result-provenance" open>
    <summary>{provenance.title}</summary>
    <p className="owner-result-safety">{provenance.safety}</p>
    {provenance.agents.length > 0 && <section className="owner-result-agents" aria-label="Агенты текущего запуска">
      <h3>Агенты текущего запуска</h3>
      {provenance.agents.map((agent, index) => <article key={`${agent.name}-${agent.stage}-${index}`}>
        <header><strong>{agent.name}</strong><span>{agent.stage}</span></header>
        <p><b>Работа:</b> {agent.work}.</p>
        <p><b>Результат:</b> {agent.outcome}</p>
        <p><b>Основание:</b> {agent.evidenceBasis.length ? agent.evidenceBasis.join("; ") : "точные входы текущего этапа"}.</p>
      </article>)}
    </section>}
    {provenance.pairs.length > 0 && <section className="owner-result-pairs" aria-label="Текущие проверенные пары">
      <h3>Текущие пары результата</h3>
      {provenance.pairs.map((pair) => <article key={pair.key}>
        <strong>{pair.label}</strong>
        <span>{pair.hypothesis.kind}: {pair.hypothesis.revision}</span>
        <span>{pair.draft.kind}: {pair.draft.revision}</span>
      </article>)}
    </section>}
    <section className="owner-result-events" aria-label="Очищенный след этапов и попыток">
      <h3>Запуск, этапы и попытки</h3>
      {provenance.events.map((event, index) => <article key={`${event.stage}-${event.attempt}-${index}`}>
        <header><strong>{event.stage}</strong><span>{event.status} · попытка {event.attempt}</span></header>
        <p><b>Исполнитель:</b> {event.executor}. <b>Задача:</b> {event.task}.</p>
        <p><b>Входы:</b> {event.inputs.length ? event.inputs.map((item) => `${item.kind} · ${item.revision}`).join("; ") : "не требовались"}.</p>
        <p><b>Доказательства:</b> {event.evidence.length ? event.evidence.map((item) => `${item.kind} · ${item.revision}`).join("; ") : "не требовались"}.</p>
        <p><b>Проверки:</b> {event.checks.length ? event.checks.join("; ") : "для этого события не требовались"}.</p>
        {event.safeCorrection && <p><b>Безопасное исправление:</b> {event.safeCorrection}</p>}
        {event.retry && <p><b>Повтор:</b> {event.retry}</p>}
        {event.return && <p><b>Возврат:</b> {event.return}</p>}
        {event.handoff && <p><b>Передача:</b> {event.handoff}</p>}
      </article>)}
    </section>
    <section className="owner-result-versions" aria-label="Версии воспроизводимости">
      <h3>Версии для воспроизводимости</h3>
      <p>{provenance.versions.historicalDocument}</p>
      <p>Политика: {provenance.versions.policy.schemaVersion} · {provenance.versions.policy.revision}</p>
      <p>Campaign Playbook: {provenance.versions.campaignPlaybook.schemaVersion} · {provenance.versions.campaignPlaybook.revision}</p>
    </section>
    <form className="owner-result-chat" onSubmit={ask}>
      <h3>Спросить о текущем результате</h3>
      {provenance.pairs.length > 0 && <label>Пара<select name="pair_key" defaultValue={provenance.pairs[0].key}>{provenance.pairs.map((pair) => <option key={pair.key} value={pair.key}>{pair.label}</option>)}</select></label>}
      <label>Свободный вопрос<textarea name="question" required maxLength={1000} placeholder="Например: какие проверки пройдены и кто передал результат?" /></label>
      <button type="submit" disabled={asking}>{asking ? "Проверяю след…" : "Получить объяснение"}</button>
    </form>
    {answer && <section className="owner-result-answer" role="status"><strong>{answer.scope}</strong><p>{answer.answer}</p><ul>{answer.facts.map((fact, index) => <li key={`${fact}-${index}`}>{fact}</li>)}</ul><small>{answer.safety}</small></section>}
    {questionError && <p className="owner-error" role="alert">{questionError}</p>}
  </details>;
}

function StageNavigation({ projection, selectedStage, onStage }: { projection: OwnerJourneyProjection; selectedStage: OwnerJourneyStageId; onStage: (stage: OwnerJourneyStageId) => void }) {
  const pipeline = projection.pipeline;
  const legacyStages = projection.journey.stages.map((stage, index) => ({
    ...stage,
    label: pipeline?.stages[index]?.label ?? stage.label,
    status: stage.status === "complete" ? "Завершён" : stage.status === "current" ? "Выполняется" : "Ожидает",
    icon: stage.status === "complete" ? "✓" : String(index + 1),
    tone: stage.status === "complete" ? "complete" : stage.status === "current" ? "active" : "pending",
  }));
  const stages = pipeline && pipeline.status !== "NOT_STARTED" ? pipeline.stages : legacyStages;
  const currentStage = pipeline && pipeline.status !== "NOT_STARTED" ? pipeline.currentStage : projection.journey.currentStage;
  return <ol className={`${styles.stageNav} ${styles.stageNavhorizontal}`} aria-label="Путь подготовки рекламных кампаний">
    {stages.map((stage) => {
      const statusText = stage.status;
      const toneClass = stage.tone === "returned"
        ? styles.returnedStage
        : stage.tone === "stopped"
          ? styles.stoppedStage
          : stage.tone === "pending"
            ? styles.pendingStage
            : "";
      return <li key={stage.id}>
        <button
          id={`owner-stage-tab-${stage.id}`}
          type="button"
          data-stage-status={statusText}
          className={`${selectedStage === stage.id ? styles.currentStage : ""} ${stage.id === currentStage ? styles.workflowStage : ""} ${stage.tone === "complete" ? styles.passedStage : ""} ${toneClass}`}
          onClick={() => onStage(stage.id)}
          aria-current={stage.id === currentStage ? "step" : undefined}
          aria-pressed={selectedStage === stage.id}
          aria-controls="owner-stage-panel"
        >
          <span>{stage.icon}</span><div><strong>{stage.label}</strong><small>{statusText}</small></div>
        </button>
      </li>;
    })}
  </ol>;
}

function GoalFormationSummary({
  pipeline,
  busy,
  onCorrect,
}: {
  pipeline: PipelineProjection;
  busy: boolean;
  onCorrect: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const formation = pipeline.goalFormation;
  if (formation.status === "PENDING") {
    return <section className="owner-goal-formation" data-goal-status="PENDING" aria-live="polite">
      <header><div><p className="owner-eyebrow">GOAL AGENT + ПРОВЕРКА КОДОМ</p><h2>Формируется полная цель кампании</h2></div><strong>Выполняется</strong></header>
      <p>Агент связывает желаемый бизнес-результат, квалифицированное действие, происхождение и известные ограничения.</p>
    </section>;
  }
  if (formation.status === "VERIFIED") {
    return <section className="owner-goal-formation" data-goal-status="VERIFIED" aria-labelledby="owner-verified-goal-title">
      <header><div><p className="owner-eyebrow">ПРОВЕРЕННАЯ GOAL REVISION</p><h2 id="owner-verified-goal-title">{formation.desiredOutcome}</h2></div><strong>{formation.versionLabel} · Проверена</strong></header>
      <article><span>Квалифицированное действие</span><h3>{formation.qualifiedAction}</h3><p>Без обязательного подтверждения владельцем: код проверил полную редакцию и точные входы.</p></article>
      <div className="owner-goal-formation-grid">
        <section><h3>Доказательства</h3><ul>{formation.provenance.map((item) => <li key={item}>{item}</li>)}</ul></section>
        <section><h3>Известные ограничения</h3>{formation.knownConstraints.length ? <ul>{formation.knownConstraints.map((item) => <li key={item}>{item}</li>)}</ul> : <p>Дополнительные известные ограничения не зафиксированы.</p>}</section>
      </div>
      {formation.rebuildRequired.length > 0 && <section className="owner-goal-rebuild" role="status"><h3>Что требует пересборки</h3><ul>{formation.rebuildRequired.map((item) => <li key={item}>{item}</li>)}</ul><p>Независимые результаты не аннулируются.</p></section>}
      {formation.canCorrect && <form className="owner-goal-correction" onSubmit={onCorrect}>
        <h3>Исправить текущую Цель</h3><p>Существенная правка создаст новую редакцию и аннулирует только зависимые сведения, Strategy и пары.</p>
        <label><span>Желаемый бизнес-результат</span><textarea name="desired_outcome" defaultValue={formation.desiredOutcome} required maxLength={1000} /></label>
        <label><span>Квалифицированное действие</span><textarea name="qualified_action" defaultValue={formation.qualifiedAction} required maxLength={1000} /></label>
        <button type="submit" disabled={busy}>{busy ? "Сохраняю…" : "Сохранить исправление"}</button>
      </form>}
    </section>;
  }
  return <section className="owner-goal-formation owner-goal-decision" data-goal-status="MATERIAL_DECISION_REQUIRED" aria-labelledby="owner-goal-decision-title">
    <header><div><p className="owner-eyebrow">НУЖЕН ВЫБОР БИЗНЕС-РЕЗУЛЬТАТА</p><h2 id="owner-goal-decision-title">Варианты материально различаются</h2><p>{formation.reason}</p></div><strong>Рекомендация подготовлена</strong></header>
    <p className="owner-goal-recommendation"><b>Рекомендация агента:</b> {formation.recommendation}</p>
    <div className="owner-goal-options">{formation.options.map((option) => <article key={option.id} data-recommended={option.recommended}>
      <header><span>{option.recommended ? "РЕКОМЕНДАЦИЯ" : "АЛЬТЕРНАТИВА"}</span><h3>{option.desiredOutcome}</h3></header>
      <p><b>Квалифицированное действие:</b> {option.qualifiedAction}</p>
      <section><h4>Доказательства</h4><ul>{option.evidence.map((item) => <li key={item}>{item}</li>)}</ul></section>
      <section><h4>Последствия выбора</h4><ul>{option.consequences.map((item) => <li key={item}>{item}</li>)}</ul></section>
    </article>)}</div>
  </section>;
}

function GoalStageSummary({ projection }: { projection: OwnerJourneyProjection }) {
  const currentGoal = projection.pipeline?.goalFormation.status === "VERIFIED"
    ? projection.pipeline.goalFormation
    : null;
  const qualifiedResult = projection.businessModel?.fields.find((field) => field.label === "Квалифицированный результат");
  return <section className="owner-stage-summary" aria-labelledby="owner-goal-summary-title">
    <header><div><p className="owner-eyebrow">ЦЕЛЬ</p><h2 id="owner-goal-summary-title">Цель и бизнес-результат</h2></div><strong>{projection.campaignGoalConfirmed ? "Сформирована" : projection.campaignGoal ? "Рекомендация агента" : "Текущий этап"}</strong></header>
    <div>
      <article><span>Цель рекламной кампании</span><strong>{currentGoal?.desiredOutcome ?? projection.campaignGoal ?? "Агент готовит рекомендацию"}</strong><p>{currentGoal ? "Показана только текущая проверенная редакция Цели." : projection.campaignGoalConfirmed ? "Цель сохранена после подтверждения и определяет бизнес-смысл дальнейшей стратегии." : "Это подготовленная рекомендация; владелец может исправить её перед сохранением."}</p></article>
      <article><span>Качественный результат</span><strong>{currentGoal?.qualifiedAction ?? qualifiedResult?.value ?? projection.businessOutcome.headline}</strong><p>{currentGoal ? "Текущее квалифицированное действие связано с этой редакцией Цели." : qualifiedResult?.limitation ?? projection.businessOutcome.summary}</p></article>
      <article><span>Целевая стоимость результата</span><strong>{projection.businessModel?.economics.targetResultCost ?? "Будет рассчитана после подтверждения экономики"}</strong><p>{projection.businessModel?.economics.explanation ?? "Агент сначала проверяет доступные факты и готовит цель для решения владельца."}</p></article>
    </div>
  </section>;
}

function GoalInterview({
  interview,
  busy,
  headingRef,
  onSubmit,
  onKeyDown,
}: {
  interview: NonNullable<OwnerJourneyProjection["goalInterview"]>;
  busy: boolean;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const action = interview.primaryAction;
  const confidence = interview.recommendedAnswer?.confidence === "MEDIUM" ? "Средняя" : "Ограниченная";
  return <section className="owner-interview" aria-labelledby="owner-interview-title">
    <header><div><p className="owner-eyebrow">ДИАЛОГ С АГЕНТОМ</p><h2 id="owner-interview-title" ref={headingRef} tabIndex={-1}>Цель кампании и модель бизнеса</h2></div><strong>{interview.complete ? "Ответы сохранены" : "Нужно решение"}</strong></header>
    {!interview.complete && <article className="owner-interview-question">
      <span>Вопрос агента</span><h3>{interview.question}</h3>
    </article>}
    {interview.recommendedAnswer && !interview.complete && <article className="owner-interview-recommendation">
      <span>Рекомендованный ответ</span><h3>{interview.recommendedAnswer.answer}</h3>
      <p><b>Почему:</b> {interview.recommendedAnswer.rationale}</p>
      <p><b>Основание:</b> {interview.recommendedAnswer.evidence}</p>
      <small>Уверенность: {confidence}</small>
    </article>}
    {interview.ownerCorrection && !interview.complete && <article className="owner-interview-correction"><span>Исправление владельца</span><strong>{interview.ownerCorrection}</strong></article>}
    {interview.confirmation && !interview.complete && <article className="owner-interview-confirmation"><span>Ответ перед сохранением · {interview.confirmation.source}</span><strong>{interview.confirmation.answer}</strong></article>}
    {interview.confirmedAnswers.length > 0 && <section className="owner-interview-history" aria-labelledby="owner-interview-history-title">
      <h3 id="owner-interview-history-title">Сохранённые ответы</h3>
      <ol>{interview.confirmedAnswers.map((answer, index) => <li key={`${answer.question}-${index}`}><span>{answer.question}</span><strong>{answer.answer}</strong><small>{answer.source}</small></li>)}</ol>
    </section>}
    {action && <form key={action.handle} className="owner-interview-action" onSubmit={onSubmit} aria-label="Ответ агенту" aria-busy={busy}>
      <header><h3>{action.label}</h3><p>{action.description}</p></header>
      {action.fields.length > 0 && <div className="owner-fields">{action.fields.map((field) => <OwnerField key={field.key} field={field} onTextareaKeyDown={onKeyDown} />)}</div>}
      <button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? "Сохраняю ответ…" : action.label}</button>
      {action.fields.length > 0 && <small className="owner-keyboard-hint">Ctrl/⌘ + Enter — проверить ответ</small>}
      {busy && <span className="owner-visually-hidden" role="status">Ответ сохраняется</span>}
    </form>}
  </section>;
}

function StageUnavailable({ projection, stage }: { projection: OwnerJourneyProjection; stage: OwnerJourneyStageId }) {
  const label = projection.journey.stages.find((item) => item.id === stage)?.label ?? "Следующий этап";
  const current = projection.journey.stages.find((item) => item.status === "current")?.label ?? "текущий этап";
  return <section className="owner-stage-unavailable" role="status">
    <span>ЭТАП ЕЩЁ НЕ ОТКРЫТ</span><h2>{label}</h2><p>Сначала завершите этап «{current}». Просмотр этого раздела не меняет состояние и не выдаёт новых полномочий.</p>
  </section>;
}

function AgentRail({ projection }: { projection: OwnerJourneyProjection }) {
  const agentWorking = projection.agentActivity?.status === "working" || projection.agentActivity?.status === "waiting";
  return <aside className={styles.agentRail} aria-label="Контекст работы агента">
    <header><span>А</span><div><strong>Агент кампании</strong><small>{agentWorking ? "Выполняет безопасную работу" : "Безопасная работа завершена"}</small></div></header>
    <section className={styles.automationMap} aria-label="Карта автоматизации">
      <h2>Карта автоматизации</h2>
      <div><span>Исследование</span><strong>АГЕНТ</strong></div>
      <div><span>Бизнес-смысл</span><strong>ИСПРАВЛЯЕТ ВЛАДЕЛЕЦ</strong></div>
      <div><span>Текущие кампании</span><strong>ГОТОВИТ АГЕНТ</strong></div>
      <div><span>Запуск показов и расходов</span><strong className={styles.unavailable}>ЗАПРЕЩЁН В P0</strong></div>
    </section>
  </aside>;
}

function Header() {
  return <header className={styles.topbar}>
    <Link className={styles.brand} href="/" aria-label="MOX-ADV — на главную"><b>M</b><span>MOX-ADV</span></Link>
    <nav aria-label="Основная навигация">
      <Link className={styles.activeNav} href="/" aria-current="page">Стратегия</Link>
      <span>Управление<i>В РАЗРАБОТКЕ</i></span>
      <span>Мониторинг<i>В РАЗРАБОТКЕ</i></span>
      <span>SEO<i>В РАЗРАБОТКЕ</i></span>
      <span>Каналы<i>VK · В РАЗРАБОТКЕ</i></span>
    </nav>
  </header>;
}

function OwnerField({ field, onTextareaKeyDown }: { field: OwnerActionField; onTextareaKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void }) {
  const common = {
    name: field.key,
    required: field.required,
    defaultValue: field.value,
    readOnly: field.readOnly,
    maxLength: field.maximumLength,
    min: field.minimum,
    max: field.maximum,
    step: field.control === "number" ? 1 : undefined,
  };
  return <label className={field.control === "textarea" ? "wide" : ""}><span>{field.label}</span>
    {field.control === "textarea" ? <textarea {...common} onKeyDown={onTextareaKeyDown} /> : field.control === "select" ? <select name={field.key} required={field.required} defaultValue={field.value}><option value="" disabled>Выберите</option>{field.options?.map((option) => {
      const value = typeof option === "string" ? option : option.value;
      const label = typeof option === "string" ? option : option.label;
      return <option key={value} value={value}>{label}</option>;
    })}</select> : <input {...common} type={field.control} />}
    {field.help && <small>{field.help}</small>}
  </label>;
}
