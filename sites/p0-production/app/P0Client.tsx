"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import styles from "./prototype/prd-149/prototype.module.css";
import type {
  OwnerActionField,
  OwnerJourneyProjection,
  OwnerJourneyStageId,
} from "../lib/p0-owner-journey";

type JsonRecord = Record<string, unknown>;

async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  const value = await response.json() as JsonRecord;
  if (!response.ok) throw new Error(String(value.message ?? "Действие не выполнено."));
  return value as OwnerJourneyProjection;
}

function actionValues(form: HTMLFormElement, fields: OwnerActionField[]) {
  const data = new FormData(form);
  return Object.fromEntries(fields.map((field) => [field.key, String(data.get(field.key) ?? "").trim()]));
}

const cardLabels = {
  "agent-activity": "Работа агента",
  finding: "Вывод",
  problem: "Проблема",
  "human-decision-gate": "Решение владельца",
} as const;

const stageDetails: Record<OwnerJourneyProjection["journey"]["stages"][number]["id"], string> = {
  goal: "Доступ и бизнес-результат",
  findings: "Модель и доказательства",
  strategy: "Готовое решение",
  campaigns: "Сравнение гипотез",
  review: "Точное полномочие",
};

export default function P0Client() {
  const [projection, setProjection] = useState<OwnerJourneyProjection | null>(null);
  const [selectedStage, setSelectedStage] = useState<OwnerJourneyStageId | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    request("/api/p0")
      .then((next) => {
        setProjection(next);
        const requestedStage = new URL(window.location.href).searchParams.get("stage");
        setSelectedStage(next.journey.stages.some((stage) => stage.id === requestedStage)
          ? requestedStage as OwnerJourneyStageId
          : next.journey.currentStage);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    if (!projection) return;
    const agentContinues = projection.agentActivity?.status === "working"
      || projection.agentActivity?.status === "waiting";
    const businessContinues = projection.businessOutcome.status === "working" && !projection.primaryAction;
    if (!agentContinues && !businessContinues) return;
    const timer = window.setTimeout(() => {
      request("/api/p0").then((next) => {
        setProjection(next);
        setSelectedStage((selected) => !selected || selected === projection.journey.currentStage
          ? next.journey.currentStage
          : selected);
      }).catch(() => undefined);
    }, 3_000);
    return () => window.clearTimeout(timer);
  }, [projection]);

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

  if (!projection) {
    return <div className={styles.prototype}>
      <Header />
      <main className={styles.pageA}><section className="owner-loading" aria-live="polite"><strong>Готовлю путь владельца</strong><p>{error || "Собираю текущий бизнес-вывод…"}</p></section></main>
    </div>;
  }

  const activeStage = selectedStage ?? projection.journey.currentStage;
  const activeStageStatus = projection.journey.stages.find((stage) => stage.id === activeStage)?.status ?? "upcoming";
  const viewingCurrentStage = activeStage === projection.journey.currentStage;

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
      <StageNavigation projection={projection} selectedStage={activeStage} onStage={chooseStage} />
      <div className={styles.ownerWorkspace}>
        <AgentRail projection={projection} selectedStage={activeStage} />
        <section className={`${styles.artifact} owner-main`} id="owner-stage-panel" aria-labelledby={`owner-stage-tab-${activeStage}`}>
          <header className={`${styles.sectionHead} owner-outcome`}>
            <div><p className={styles.eyebrow}>ТЕКУЩИЙ БИЗНЕС-РЕЗУЛЬТАТ</p><h2>{projection.businessOutcome.headline}</h2><p>{projection.businessOutcome.summary}</p></div>
          </header>

          {projection.currentRecommendation && <section className="owner-recommendation">
            <span>Текущая рекомендация</span><h3>{projection.currentRecommendation.headline}</h3><p>{projection.currentRecommendation.rationale}</p>
          </section>}

          {activeStageStatus === "upcoming" && <StageUnavailable projection={projection} stage={activeStage} />}
          {activeStage === "goal" && activeStageStatus !== "upcoming" && <GoalStageSummary projection={projection} />}

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
          </section>}

          {activeStage === "strategy" && activeStageStatus !== "upcoming" && projection.campaignStrategy && <section className="owner-business-readiness" aria-labelledby="owner-campaign-strategy-title">
            <header><div><p className="owner-eyebrow">CAMPAIGN STRATEGY</p><h2 id="owner-campaign-strategy-title">Полная рекомендация агента</h2></div><strong>{projection.campaignStrategy.status}</strong></header>
            <div className="owner-demand-cost-grid">{projection.campaignStrategy.recommendations.map((item) => <article key={item.label}>
              <span>{item.label}</span><h3>{item.value}</h3><p>{item.rationale}</p><small>Уверенность: {item.confidence}</small>
            </article>)}</div>
            {projection.campaignStrategy.materialQuestions.length > 0 && <div className="owner-model-questions"><h3>Только существенные вопросы</h3><ul>{projection.campaignStrategy.materialQuestions.map((item) => <li key={item.field}><strong>{item.field}: {item.question}</strong><span>{item.recommendation} {item.consequences}</span></li>)}</ul></div>}
            {projection.campaignStrategy.decisionGate && <article className="owner-card human-decision-gate"><span>РЕШЕНИЕ ВЛАДЕЛЬЦА</span><h3>{projection.campaignStrategy.decisionGate.recommendation}</h3><p><b>Основание:</b> {projection.campaignStrategy.decisionGate.evidence}</p><p><b>Уверенность:</b> {projection.campaignStrategy.decisionGate.confidence}</p><p><b>Альтернативы:</b> {projection.campaignStrategy.decisionGate.alternatives}</p><p><b>Последствия:</b> {projection.campaignStrategy.decisionGate.consequences}</p></article>}
          </section>}

          {activeStage === "findings" && activeStageStatus !== "upcoming" && projection.demandCostResearch && <section className="owner-demand-cost" aria-labelledby="owner-demand-cost-title">
            <header><div><p className="owner-eyebrow">СПРОС И СОПОСТАВИМАЯ СТОИМОСТЬ</p><h2 id="owner-demand-cost-title">Исследование нескольких формулировок</h2></div><strong>{projection.demandCostResearch.demand.status}</strong></header>
            <div className="owner-demand-cost-grid">
              <article><span>Спрос</span><h3>{projection.demandCostResearch.demand.conclusion}</h3><dl><div><dt>Источник и дата</dt><dd>{projection.demandCostResearch.demand.source} · {projection.demandCostResearch.demand.observedAt}</dd></div><div><dt>Область</dt><dd>{projection.demandCostResearch.demand.scope}</dd></div><div><dt>Сезонность</dt><dd>{projection.demandCostResearch.demand.seasonality}</dd></div></dl><p>{projection.demandCostResearch.demand.limitation}</p></article>
              <article><span>Сопоставимая стоимость</span><h3>{projection.demandCostResearch.cost.range}</h3><dl><div><dt>Источник и дата</dt><dd>{projection.demandCostResearch.cost.source} · {projection.demandCostResearch.cost.observedAt}</dd></div><div><dt>Валюта и НДС</dt><dd>{projection.demandCostResearch.cost.currency} · {projection.demandCostResearch.cost.vat}</dd></div><div><dt>Выборка</dt><dd>{projection.demandCostResearch.cost.sample}</dd></div><div><dt>Сопоставимость</dt><dd>{projection.demandCostResearch.cost.scope}</dd></div></dl><p>{projection.demandCostResearch.cost.limitation}</p></article>
            </div>
            <div className="owner-demand-formulations"><h3>Проверенные формулировки</h3>{projection.demandCostResearch.demand.formulations.map((item, index) => <article key={`${item.category}-${index}`}><span>{item.category}</span><strong>{item.phrase}</strong><small>{item.status}</small></article>)}</div>
          </section>}

          {activeStage === "strategy" && activeStageStatus !== "upcoming" && projection.appliedPractice && <section className="owner-recommendation" aria-labelledby="owner-applied-practice-title">
            <span>Применённая практика</span><h3 id="owner-applied-practice-title">{projection.appliedPractice.practice}</h3><p>{projection.appliedPractice.limitation}</p>
          </section>}

          {activeStage === "findings" && activeStageStatus !== "upcoming" && projection.businessReadiness && <section className="owner-business-readiness" aria-labelledby="owner-business-readiness-title">
            <header><div><p className="owner-eyebrow">ИЗМЕРИМОСТЬ И ПОСАДОЧНАЯ</p><h2 id="owner-business-readiness-title">Готовность бизнес-результата</h2></div><strong>{projection.businessReadiness.status}</strong></header>
            <div className="owner-demand-cost-grid">
              <article className="owner-measurement-report" data-measurement-state={projection.businessReadiness.measurement.report.state}>
                <span>Измеримость</span><h3>{projection.businessReadiness.measurement.report.state}</h3><p>{projection.businessReadiness.measurement.report.conclusion}</p>
                <dl className="owner-measurement-summary"><div><dt>Окно отчёта</dt><dd>{projection.businessReadiness.measurement.report.window}</dd></div><div><dt>Достижения</dt><dd>{projection.businessReadiness.measurement.report.reaches}</dd></div><div><dt>Свежесть</dt><dd>{projection.businessReadiness.measurement.report.freshness}</dd></div></dl>
                <h4>Качество отчёта</h4><dl>{projection.businessReadiness.measurement.report.quality.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
                <details><summary>Все проверки измеримости</summary><p>{projection.businessReadiness.measurement.summary}</p><dl>{projection.businessReadiness.measurement.checks.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.result}. {item.limitation}</dd></div>)}</dl></details>
              </article>
              <article><span>Посадочная по устройствам</span><h3>{projection.businessReadiness.destination.status}</h3><dl>{projection.businessReadiness.destination.scopes.map((scope) => <div key={scope.device}><dt>{scope.device}</dt><dd>{scope.classification}. {scope.conclusion}</dd></div>)}</dl></article>
            </div>
            {projection.businessReadiness.destination.priorityCorrections.length > 0 && <div><h3>До трёх приоритетных исправлений</h3><ol>{projection.businessReadiness.destination.priorityCorrections.map((item) => <li key={`${item.priority}-${item.action}`}><strong>{item.priority}. {item.action}</strong><span>{item.basis}</span></li>)}</ol></div>}
            {projection.businessReadiness.repairPlan.length > 0 && <div><h3>Подготовленный план</h3><ol>{projection.businessReadiness.repairPlan.map((item) => <li key={`${item.priority}-${item.action}`}><strong>{item.action}</strong><span>{item.expectedResult}</span></li>)}</ol></div>}
            {projection.businessReadiness.decisionGate && <article className="owner-card human-decision-gate"><span>РЕШЕНИЕ ВЛАДЕЛЬЦА</span><h3>{projection.businessReadiness.decisionGate.recommendation}</h3><p><b>Доказательства:</b> {projection.businessReadiness.decisionGate.evidence}</p><p><b>Уверенность:</b> {projection.businessReadiness.decisionGate.confidence}</p><p><b>Варианты и последствия:</b> {projection.businessReadiness.decisionGate.options}</p></article>}
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
                <div><dt>Срез рекламной видимости</dt><dd>{row.adVisibilitySample}</dd></div>
              </dl>
            </article>)}</div> : <p className="owner-competitor-unavailable">Публичные наблюдения не получены и остаются недоступными, а не нулевыми.</p>}
            <div className="owner-competitor-aggregates"><h3>Выводы только по этому набору</h3>{projection.competitorMatrix.aggregateClaims.map((claim) => <article key={claim.claim}><strong>{claim.claim}</strong><span>{claim.result}</span><p>{claim.scope} {claim.limitation}</p></article>)}</div>
            <div className="owner-competitor-limitations"><strong>Что эта матрица не доказывает</strong><ul>{projection.competitorMatrix.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></div>
          </section>}

          {viewingCurrentStage && projection.agentActivity && <section className="owner-progress" aria-label="Ход работы агента">
            <i /><div><strong>{projection.agentActivity.summary}</strong><p>{projection.agentActivity.nextBusinessStep}</p></div>
            <span>{projection.agentActivity.completed} из {projection.agentActivity.total}</span>
          </section>}

          {viewingCurrentStage && <section className="owner-cards" aria-label="Выводы и решения">
            {projection.cards.map((card, index) => <article key={`${card.kind}-${index}`} className={`owner-card ${card.kind}`}>
              <span>{cardLabels[card.kind]}</span><h3>{card.title}</h3><p>{card.body}</p>
              {card.facts && <dl>{card.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}
            </article>)}
          </section>}

          {activeStage === "campaigns" && activeStageStatus !== "upcoming" && projection.campaignOptions.length > 0 && <section className="owner-campaigns" aria-labelledby="owner-campaigns-title">
            <header><p className="owner-eyebrow">ВАРИАНТЫ КАМПАНИЙ</p><h2 id="owner-campaigns-title">Кампании для бизнес-проверки</h2></header>
            <div>{projection.campaignOptions.map((campaign, index) => <article key={`${campaign.name}-${index}`} className={campaign.selected ? "selected" : ""}>
              <header><span>{campaign.status} · {campaign.readiness}</span>{campaign.selected ? <b>Выбрана владельцем</b> : campaign.agentRecommended && <b>Рекомендация агента</b>}</header>
              <h3>{campaign.name}</h3>
              <dl><div><dt>Предложение</dt><dd>{campaign.offer}</dd></div><div><dt>Аудитория</dt><dd>{campaign.audience}</dd></div><div><dt>Куда ведём</dt><dd>{campaign.destination}</dd></div><div><dt>Сравнительный приоритет</dt><dd>{campaign.comparativeScore}</dd></div><div><dt>Покрытие доказательств</dt><dd>{campaign.evidenceCoverage}</dd></div><div><dt>Чувствительность</dt><dd>{campaign.sensitivity}</dd></div></dl>
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
              {campaign.reasons.length > 0 && <ul>{campaign.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
            </article>)}</div>
          </section>}

          {activeStage === "review" && activeStageStatus !== "upcoming" && projection.packageSummary && <section className="owner-package" aria-labelledby="owner-package-title">
            <header><div><p className="owner-eyebrow">ИТОГОВАЯ ПРОВЕРКА</p><h2 id="owner-package-title">{projection.packageSummary.campaignCount} кампании к созданию</h2></div><strong>{projection.packageSummary.preflight}</strong></header>
            <p>{projection.packageSummary.execution}</p>
            <div className="owner-demand-cost-grid">
              <article><span>Месячный бюджет Strategy</span><h3>{projection.packageSummary.strategyMonthlyBudget}</h3></article>
              <article><span>Сумма выбранного пакета</span><h3>{projection.packageSummary.orderedPackageBudget}</h3><p>{projection.packageSummary.budgetAlignment.classification}. {projection.packageSummary.budgetAlignment.explanation}</p></article>
            </div>
            <div><h3>Бюджеты и периоды выбранных тестов</h3><ol>{projection.packageSummary.campaignBudgets.map((campaign) => <li key={`${campaign.name}-${campaign.period}`}><strong>{campaign.name}</strong><span>{campaign.budget} · {campaign.period}</span></li>)}</ol></div>
            <div><h3>Предпубликационная проверка</h3><ol>{projection.packageSummary.preflightGates.map((gate) => <li key={gate.label}><strong>{gate.label} · {gate.status}</strong><span>{gate.explanation}</span></li>)}</ol></div>
            {projection.packageSummary.outcomes.length > 0 && <ul>{projection.packageSummary.outcomes.map((item) => <li key={item.campaign}><strong>{item.campaign}</strong><span>{item.outcome}</span></li>)}</ul>}
          </section>}

          {viewingCurrentStage && projection.materialUnknowns.length > 0 && <details className={styles.disclosure} open><summary>СУЩЕСТВЕННЫЕ НЕИЗВЕСТНЫЕ</summary><ul>{projection.materialUnknowns.map((item) => <li key={item}>{item}</li>)}</ul></details>}

          {viewingCurrentStage && projection.primaryAction && <form key={projection.primaryAction.handle} className="owner-action" onSubmit={submit}>
            <header><p className="owner-eyebrow">СЛЕДУЮЩИЙ ШАГ</p><h2>{projection.primaryAction.label}</h2><p>{projection.primaryAction.description}</p></header>
            {projection.primaryAction.fields.length > 0 && <div className="owner-fields">{projection.primaryAction.fields.map((field) => <OwnerField key={field.key} field={field} />)}</div>}
            <button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? "Агент выполняет работу…" : projection.primaryAction.label}</button>
          </form>}
          {viewingCurrentStage && !projection.primaryAction && projection.businessOutcome.status === "working" && <div className="owner-progress" role="status"><i /><div><strong>Агент продолжает работу</strong><p>Ожидание, повторные проверки и безопасная сверка не требуют действий владельца.</p></div></div>}
          {error && <p className="owner-error" role="alert">{error}</p>}
        </section>

      </div>
    </main>
  </div>;
}

function Hero({ projection }: { projection: OwnerJourneyProjection }) {
  return <section className={styles.hero}>
    <div><p className={styles.eyebrow}>P0 · ПРОИЗВОДСТВЕННЫЙ МОДУЛЬ</p><h1>Стратегия и рекламные кампании</h1><p>Агент ведёт владельца от бизнес-цели до точного пакета кампаний.</p></div>
    <div className={styles.heroOutcome}><span>Текущий результат</span><strong>{projection.businessOutcome.headline}</strong><small>{projection.businessOutcome.summary}</small></div>
  </section>;
}

function StageNavigation({ projection, selectedStage, onStage }: { projection: OwnerJourneyProjection; selectedStage: OwnerJourneyStageId; onStage: (stage: OwnerJourneyStageId) => void }) {
  return <ol className={`${styles.stageNav} ${styles.stageNavhorizontal}`} aria-label="Путь подготовки рекламных кампаний">
    {projection.journey.stages.map((stage, index) => <li key={stage.id}>
      <button
        id={`owner-stage-tab-${stage.id}`}
        type="button"
        className={`${selectedStage === stage.id ? styles.currentStage : ""} ${stage.status === "current" ? styles.workflowStage : ""} ${stage.status === "complete" ? styles.passedStage : ""}`}
        onClick={() => onStage(stage.id)}
        aria-current={stage.status === "current" ? "step" : undefined}
        aria-pressed={selectedStage === stage.id}
        aria-controls="owner-stage-panel"
      >
        <span>{stage.status === "complete" ? "✓" : index + 1}</span><div><strong>{stage.label}</strong><small>{stageDetails[stage.id]}</small></div>
      </button>
    </li>)}
  </ol>;
}

function GoalStageSummary({ projection }: { projection: OwnerJourneyProjection }) {
  const qualifiedResult = projection.businessModel?.fields.find((field) => field.label === "Квалифицированный результат");
  return <section className="owner-stage-summary" aria-labelledby="owner-goal-summary-title">
    <header><div><p className="owner-eyebrow">ЦЕЛЬ</p><h2 id="owner-goal-summary-title">Цель и бизнес-результат</h2></div><strong>{qualifiedResult ? "Зафиксирована" : "Текущий этап"}</strong></header>
    <div>
      <article><span>Бизнес-результат</span><strong>{qualifiedResult?.value ?? projection.businessOutcome.headline}</strong><p>{qualifiedResult?.limitation ?? projection.businessOutcome.summary}</p></article>
      <article><span>Целевая стоимость результата</span><strong>{projection.businessModel?.economics.targetResultCost ?? "Будет рассчитана после подтверждения экономики"}</strong><p>{projection.businessModel?.economics.explanation ?? "Агент сначала проверяет доступные факты и готовит цель для решения владельца."}</p></article>
    </div>
  </section>;
}

function StageUnavailable({ projection, stage }: { projection: OwnerJourneyProjection; stage: OwnerJourneyStageId }) {
  const label = projection.journey.stages.find((item) => item.id === stage)?.label ?? "Следующий этап";
  const current = projection.journey.stages.find((item) => item.status === "current")?.label ?? "текущий этап";
  return <section className="owner-stage-unavailable" role="status">
    <span>ЭТАП ЕЩЁ НЕ ОТКРЫТ</span><h2>{label}</h2><p>Сначала завершите этап «{current}». Просмотр этого раздела не меняет состояние и не выдаёт новых полномочий.</p>
  </section>;
}

function AgentRail({ projection, selectedStage }: { projection: OwnerJourneyProjection; selectedStage: OwnerJourneyStageId }) {
  const agentWorking = projection.agentActivity?.status === "working" || projection.agentActivity?.status === "waiting";
  const currentStage = projection.journey.stages.find((stage) => stage.status === "current");
  const openedStage = projection.journey.stages.find((stage) => stage.id === selectedStage);
  const viewingCurrentStage = selectedStage === projection.journey.currentStage;
  return <aside className={styles.agentRail} aria-label="Контекст работы агента">
    <header><span>А</span><div><strong>Агент кампании</strong><small>{agentWorking ? "Выполняет безопасную работу" : "Безопасная работа завершена"}</small></div></header>
    <section className={styles.agentMessage}><p className={styles.eyebrow}>ТЕКУЩИЙ ВЫВОД</p><strong>{projection.agentActivity?.summary ?? projection.businessOutcome.headline}</strong><p>{projection.agentActivity?.nextBusinessStep ?? projection.businessOutcome.summary}</p></section>
    <section className={styles.railSnapshot}><span>{viewingCurrentStage ? "Текущий этап" : "Открытый раздел"}</span><strong>{openedStage?.label ?? currentStage?.label ?? "Проверка и создание"}</strong><small>{viewingCurrentStage ? (projection.businessOutcome.status === "blocked" ? "Нужно внимание владельца" : "Факты и ограничения раскрыты в основном рабочем поле") : `Текущий этап процесса: ${currentStage?.label ?? "не определён"}`}</small></section>
    <section className={styles.automationMap} aria-label="Карта автоматизации">
      <h2>Карта автоматизации</h2>
      <div><span>Исследование</span><strong>АГЕНТ</strong></div>
      <div><span>Бизнес-смысл</span><strong>ИСПРАВЛЯЕТ ВЛАДЕЛЕЦ</strong></div>
      <div><span>Точный пакет</span><strong>РАЗОВОЕ ПРАВО</strong></div>
      <div><span>Запуск показов и расходов</span><strong className={styles.unavailable}>ЗАПРЕЩЁН В P0</strong></div>
    </section>
    <section className={styles.safetyCard}><span>ГРАНИЦА P0</span><strong>Создание без запуска</strong><p>Показы, расходы и возобновление кампаний недоступны. Успех подтверждается повторным чтением статуса «Остановлена».</p></section>
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
    <div className={styles.connectionState}><i />Агент готов</div>
  </header>;
}

function OwnerField({ field }: { field: OwnerActionField }) {
  const common = { name: field.key, required: field.required, defaultValue: field.value, readOnly: field.readOnly };
  return <label className={field.control === "textarea" ? "wide" : ""}><span>{field.label}</span>
    {field.control === "textarea" ? <textarea {...common} /> : field.control === "select" ? <select name={field.key} required={field.required} defaultValue={field.value}><option value="" disabled>Выберите</option>{field.options?.map((option) => {
      const value = typeof option === "string" ? option : option.value;
      const label = typeof option === "string" ? option : option.label;
      return <option key={value} value={value}>{label}</option>;
    })}</select> : <input {...common} type={field.control} />}
    {field.help && <small>{field.help}</small>}
  </label>;
}
