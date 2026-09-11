"use client";

import Link from "next/link";
import SingleCodexWorkspace from "./SingleCodexWorkspace";
import { FormationPortfolioView, FormationResearchView } from "./CampaignFormation.tsx";
import type { FormationBundle } from "../lib/campaign-formation-portfolio.ts";
import { businessError, businessText } from "../lib/owner-business-copy.ts";
import type { PipelineStageTask } from "../lib/pipeline-stage-tools.ts";
import { normalizeGoalGeography, normalizeGoalText, QUALIFIED_REQUEST_COUNTING_POLICY } from "../lib/goal-revision.ts";
import { formatGoalMetricTarget, GOAL_METRIC_LABELS, type GoalMetricDefinition, type GoalComparison } from "../lib/goal-metric.ts";
import GoalMetricFields from "./GoalMetricFields.tsx";
import GeographyAutocomplete from "./GeographyAutocomplete";
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import styles from "./production-dashboard.module.css";
import AnalyticsSummaryDisclosure from "./AnalyticsSummaryDisclosure";
import FindingsReadiness from "./FindingsReadiness";
import StrategyBrief from "./StrategyBrief";
import CampaignPortfolio from "./CampaignPortfolio";
import EvidenceReuseActions from "./EvidenceReuseActions";
import { localizedText, machineLabel, ownerDate, ownerFieldLabel, ownerValue } from "./ui-copy.ts";
import type {
  OwnerActionField,
  OwnerJourneyProjection,
  OwnerJourneyStageId,
} from "../lib/p0-owner-journey";
import type { CurrentPipelineOwnerResult } from "../lib/pipeline-current-contract";

type JsonRecord = Record<string, unknown>;
type CurrentOwnerProjection = OwnerJourneyProjection & { currentResult?: CurrentPipelineOwnerResult };
type LocalRecovery = { action: "RESET_INVALID_LOCAL_P0_STATE"; label: string; description: string };

class DashboardRequestError extends Error {
  readonly recovery: LocalRecovery | null;

  constructor(message: string, recovery: LocalRecovery | null = null) {
    super(message);
    this.name = "DashboardRequestError";
    this.recovery = recovery;
  }
}

const DASHBOARD_REQUEST_TIMEOUT_MS = 165_000;
const COMPETITOR_RESEARCH_REQUEST_TIMEOUT_MS = 3_000_000;

async function request(path: string, init?: RequestInit, timeoutMs = DASHBOARD_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const signal = init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, { ...init, signal });
    const value = await response.json() as JsonRecord;
    if (!response.ok) {
      const recovery = value.recovery && typeof value.recovery === "object" && !Array.isArray(value.recovery)
        ? value.recovery as LocalRecovery
        : null;
      throw new DashboardRequestError(String(value.message ?? "Действие не выполнено."), recovery);
    }
    return value as CurrentOwnerProjection;
  } catch (reason) {
    if (controller.signal.aborted) {
      throw new DashboardRequestError(`Запрос остановлен через ${Math.round(timeoutMs / 1_000)} секунд. Поздний ответ не будет показан как свежий; повторите обновление.`);
    }
    throw reason;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function actionValues(form: HTMLFormElement, fields: OwnerActionField[]) {
  const data = new FormData(form);
  return Object.fromEntries(fields.map((field) => [field.key, String(data.get(field.key) ?? "").trim()]));
}

function goalNeedsClarification(projection: OwnerJourneyProjection) {
  const formation = projection.pipeline?.goalFormation;
  return Boolean(formation && (formation.status !== "VERIFIED" || !formation.criterionComplete));
}

function authoritativeStage(projection: OwnerJourneyProjection) {
  if (goalNeedsClarification(projection)) return "goal";
  return projection.pipeline?.currentStage ?? projection.journey.currentStage;
}

function stageViewAvailable(projection: CurrentOwnerProjection, stage: OwnerJourneyStageId) {
  if (stage === "goal" || stage === authoritativeStage(projection)) return true;
  const products = projection.currentResult?.products;
  if (projection.currentResult) {
    if (stage === "findings") return Boolean(products?.evidence);
    if (stage === "strategy") return Boolean(products?.strategy);
    return Boolean(products?.campaignPairs.length);
  }
  return projection.journey.stages.some(item => item.id === stage && item.status !== "upcoming");
}

const cardLabels = {
  "agent-activity": "Работа агента",
  finding: "Вывод",
  problem: "Проблема",
  "human-decision-gate": "Решение владельца",
} as const;

export default function P0Client({ surface = "owner" }: { surface?: "owner" | "agent" }) {
  const [projection, setProjection] = useState<CurrentOwnerProjection | null>(null);
  const [selectedStage, setSelectedStage] = useState<OwnerJourneyStageId | null>(null);
  const [busy, setBusy] = useState(true);
  const [stopping, setStopping] = useState(false);
  const [competitorRefreshBusy, setCompetitorRefreshBusy] = useState(false);
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState<LocalRecovery | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    request("/api/p0")
      .then((next) => {
        setProjection(next);
        setRecovery(null);
        const url = new URL(window.location.href);
        const searchParams = url.searchParams;
        const requestedStage = searchParams.get("stage") === "review" ? "campaigns" : searchParams.get("stage");
        if (searchParams.get("stage") === "review") {
          searchParams.set("stage", "campaigns");
          window.history.replaceState({}, "", url);
        }
        setSelectedStage(next.journey.stages.some((stage) => stage.id === requestedStage)
          ? requestedStage as OwnerJourneyStageId
          : authoritativeStage(next));
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setRecovery(reason instanceof DashboardRequestError ? reason.recovery : null);
      })
      .finally(() => setBusy(false));
  }, []);

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
    if (busy) return false;
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const saved = await request("/api/p0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipeline_action: "CORRECT_GOAL",
          desired_outcome: String(values.get("desired_outcome") ?? "").trim(),
          qualified_action: String(values.get("qualified_action") ?? "").trim(),
          ...(values.get("metric_definition") ? { target_value: Number(values.get("target_value")), metric: JSON.parse(String(values.get("metric_definition"))), comparison: String(values.get("goal_comparison")) } : { target_count: Number(values.get("target_count")), counting_policy: QUALIFIED_REQUEST_COUNTING_POLICY }),
          deadline: String(values.get("deadline") ?? ""),
          total_budget_rub: Number(values.get("total_budget_rub")),
          customer_geography: String(values.get("customer_geography") ?? ""),
        }),
      });
      setProjection(saved);
      setSelectedStage("goal");
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function codexAction(action: string, values: Record<string, unknown>): Promise<PipelineStageTask | null> {
    if (busy) return null;
    setBusy(true);
    setError("");
    try {
      const response = await request("/api/p0", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipeline_action: action, ...values }),
      }, action === "COLLECT_EVIDENCE" ? 1_800_000 : DASHBOARD_REQUEST_TIMEOUT_MS);
      if (action === "GET_STAGE_TASK") return (response as unknown as { task: PipelineStageTask }).task;
      setProjection(response);
      setSelectedStage(authoritativeStage(response));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      await request("/api/p0").then(setProjection).catch(() => undefined);
    } finally { setBusy(false); }
    return null;
  }

  async function refreshEvidence() {
    if (busy || projection?.pipeline?.active) return;
    setBusy(true);
    setError("");
    try {
      const next = await request("/api/p0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipeline_action: "REFRESH_EVIDENCE" }),
      });
      setProjection(next);
      setSelectedStage("findings");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function regenerateFromEvidence() {
    const evidenceReuse = projection?.pipeline?.evidenceReuse;
    if (busy || projection?.pipeline?.active || !evidenceReuse?.available
      || evidenceReuse.expectedStateRevision === null || !evidenceReuse.reuseToken) return;
    setBusy(true);
    setError("");
    try {
      const next = await request("/api/p0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipeline_action: "REGENERATE_FROM_EVIDENCE",
          expected_state_revision: evidenceReuse.expectedStateRevision,
          reuse_token: evidenceReuse.reuseToken,
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

  async function stopPipeline() {
    if (stopping || (busy && projection?.pipeline?.singleCodex?.phase !== "COLLECTING") || !projection?.pipeline?.active) return;
    setStopping(true);
    setBusy(true);
    setError("");
    try {
      const next = await request("/api/p0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipeline_action: "STOP" }),
      });
      setProjection(next);
      setSelectedStage(authoritativeStage(next));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStopping(false);
      setBusy(false);
    }
  }

  async function refreshCompetitorAnalysis() {
    const currentResult = projection?.currentResult;
    if (busy || competitorRefreshBusy || !currentResult?.products?.evidence || currentResult.stateRevision === null) return;
    setCompetitorRefreshBusy(true);
    setError("");
    try {
      const next = await request("/api/p0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipeline_action: "REFRESH_COMPETITOR_ANALYSIS",
          expected_state_revision: currentResult.stateRevision,
        }),
      }, COMPETITOR_RESEARCH_REQUEST_TIMEOUT_MS);
      setProjection(next);
      setSelectedStage("findings");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCompetitorRefreshBusy(false);
    }
  }

  async function submitStrategyCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const currentResult = projection?.currentResult;
    const strategy = currentResult?.products?.strategy;
    if (busy || !currentResult || !strategy || currentResult.stateRevision === null) return;
    const expectedStateRevision = currentResult.stateRevision;
    const expectedStrategyRevisionId = strategy.revisionId;
    const values = new FormData(event.currentTarget);
    const targetCost = String(values.get("target_result_cost") ?? "").trim();
    const changes = {
      geography: String(values.get("geography") ?? "").trim(),
      weekly_budget: Number(values.get("weekly_budget")),
      target_result_cost: targetCost ? Number(targetCost) : null,
      core_message: String(values.get("core_message") ?? "").trim(),
    };
    setBusy(true);
    setError("");
    try {
      const next = await request("/api/p0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipeline_action: "CORRECT_STRATEGY",
          expected_state_revision: expectedStateRevision,
          expected_strategy_revision_id: expectedStrategyRevisionId,
          changes,
        }),
      });
      setProjection(next);
      setSelectedStage("strategy");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function submitPairEdit(
    event: FormEvent<HTMLFormElement>,
    pair: NonNullable<CurrentPipelineOwnerResult["products"]>["campaignPairs"][number],
    kind: "semantic" | "technical",
  ) {
    event.preventDefault();
    const currentResult = projection?.currentResult;
    if (busy || !currentResult?.products || currentResult.stateRevision === null) return;
    const expectedStateRevision = currentResult.stateRevision;
    const values = new FormData(event.currentTarget);
    const fieldNames = kind === "semantic"
      ? ["product", "audience", "offer", "qualified_result", "core_message"]
      : pair.publicationReadiness
        ? ["campaign_name", "group_name", "negative_keywords", "keywords", "ad_title", "ad_text", "landing_page"]
        : ["campaign_name", "group_name", "negative_keywords", "keyword", "ad_title", "ad_text", "measurement_goal"];
    const changedEntries = fieldNames.flatMap((field) => {
      const value = String(values.get(field) ?? "").trim();
      const control = event.currentTarget.elements.namedItem(field);
      const defaultValue = control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement
        ? control.defaultValue.trim()
        : "";
      return value === defaultValue ? [] : [[field, value] as const];
    });
    if (!changedEntries.length) {
      setError("Изменений не обнаружено; новая редакция не создана.");
      return;
    }
    const changes = Object.fromEntries(changedEntries);
    setBusy(true);
    setError("");
    try {
      const next = await request("/api/p0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipeline_action: "EDIT_CAMPAIGN_PAIR",
          expected_state_revision: expectedStateRevision,
          edit: {
            pair_id: pair.pairKey,
            expected_hypothesis_revision_id: pair.hypothesisRevisionId,
            expected_draft_revision_id: pair.draftRevisionId,
            ...(values.get("group_ref") ? { group_ref: String(values.get("group_ref")) } : {}),
            ...(kind === "semantic" ? { semantic_changes: changes } : { technical_changes: changes }),
          },
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

  if (!projection) {
  return <div className={styles.dashboard}>
      <Header />
      <main className={styles.pageA}><section className="owner-loading" aria-live="polite">
        <strong>{recovery ? "Нужен безопасный перезапуск подготовки" : "Загрузка дашборда"}</strong>
        {error && <p>{surface === "agent" ? error : businessError(error)}</p>}
        {recovery && <div className="owner-recovery-action">
          <p>{businessText(recovery.description) || "Для продолжения требуется перезапуск подготовки."}</p>
          <button type="button" disabled={busy} onClick={recoverInvalidLocalState}>{busy ? "Перезапускаю…" : businessText(recovery.label) || "Перезапустить подготовку"}</button>
        </div>}
      </section></main>
    </div>;
  }

  if (surface === "agent") return <main className={styles.pageA} data-agent-workspace>
    <h1>Рабочая область агента</h1>
    {projection.pipeline?.singleCodex ? <SingleCodexWorkspace pipeline={projection.pipeline} busy={busy} operatorView onAction={codexAction} stopping={stopping} onStop={projection.pipeline.active ? stopPipeline : undefined} /> : <p>Нет доступной подготовки.</p>}
    {error && <p role="alert">{error}</p>}
  </main>;

  const requestedStage = selectedStage ?? authoritativeStage(projection);
  const activeStage = stageViewAvailable(projection, requestedStage) ? requestedStage : authoritativeStage(projection);
  const pipelineStage = projection.pipeline && projection.pipeline.status !== "NOT_STARTED"
    ? projection.pipeline.stages.find((stage) => stage.id === activeStage)
    : undefined;
  const activeStageStatus = pipelineStage
      ? pipelineStage.tone === "complete"
        ? "complete"
        : pipelineStage.tone === "active" || pipelineStage.tone === "returned" || pipelineStage.tone === "stopped" ? "current" : "upcoming"
      : projection.journey.stages.find((stage) => stage.id === activeStage)?.status ?? "upcoming";
  const viewingCurrentStage = activeStage === authoritativeStage(projection);
  const ownerHasAction = Boolean(projection.primaryAction);
  const ownerActionProblem = ownerHasAction
    ? projection.cards.find((card) => card.kind === "human-decision-gate")
      ?? projection.cards.find((card) => card.kind === "problem")
      ?? null
    : null;
  const findingsPrototypeActive = false;
  const useFindingsReadiness = activeStage === "findings"
    && (activeStageStatus !== "upcoming" || Boolean(projection.currentResult?.products?.evidence));
  const competitorResearchDuringGeneration = useFindingsReadiness && !findingsPrototypeActive
    && projection.pipeline?.currentStage === "campaigns";
  const useStrategyBrief = activeStage === "strategy"
    && (activeStageStatus !== "upcoming" || Boolean(projection.currentResult?.products?.strategy));
  const useCampaignPortfolio = activeStage === "campaigns"
    && Boolean(projection.currentResult);
  const workingCampaigns = activeStage === "campaigns" ? projection.pipeline?.singleCodex?.workingCampaigns : undefined;
  const savedFormation = projection.currentResult?.products?.campaignPairs.find(pair => pair.publishProjection.schema_version === "p0-direct-projection-v6")?.publishProjection.formation as FormationBundle | undefined;
  const readOnlyFormationStage = !projection.primaryAction && Boolean(
    activeStage === "findings" && projection.currentResult?.products?.evidence?.formationResearch
    || activeStage === "strategy" && projection.currentResult?.products?.evidence?.formationResearch && projection.currentResult?.products?.strategy?.formationPlan && projection.pipeline?.singleCodex
    || activeStage === "campaigns" && (workingCampaigns || savedFormation),
  );

  function chooseStage(stage: OwnerJourneyStageId) {
    if (!projection || !stageViewAvailable(projection, stage)) return;
    setSelectedStage(stage);
    const url = new URL(window.location.href);
    url.searchParams.set("stage", stage);
    url.hash = "";
    window.history.replaceState({}, "", url);
    window.requestAnimationFrame(() => document.getElementById("owner-stage-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return <div className={`${styles.dashboard} ${useCampaignPortfolio ? styles.campaignWorkspace : ""}`} data-dashboard-stage={activeStage}>
    <Header />
    <main className={styles.pageA} id="module">
      <StageNavigation projection={projection} selectedStage={activeStage} onStage={chooseStage} />
      {projection.pipeline?.singleCodex && <SingleCodexWorkspace pipeline={projection.pipeline} busy={busy} ownerView={activeStage === "goal"} hideSavedCampaigns={activeStage !== "goal"} onAction={codexAction} stopping={stopping} onStop={projection.pipeline.active ? stopPipeline : undefined} />}
      {projection.pipeline?.active && !projection.pipeline.singleCodex && <section className="owner-run-control" role="status" aria-label="Управление текущим запуском">
        <div><strong>{projection.pipeline.currentTask}</strong><span>Внешняя запись, показы и расходы не выполняются.</span></div>
        <button type="button" disabled={stopping || busy} onClick={stopPipeline}>{stopping ? "Останавливаю…" : "Остановить текущий запуск"}</button>
      </section>}
      {!projection.pipeline?.singleCodex && projection.pipeline?.evidenceReuse && !projection.pipeline.active && activeStage !== "goal" && activeStage !== "findings" && !useCampaignPortfolio && <EvidenceReuseActions
        available={projection.pipeline.evidenceReuse.available}
        reason={projection.pipeline.evidenceReuse.reason}
        refreshAvailable={!goalNeedsClarification(projection)}
        busy={busy}
        active={projection.pipeline.active}
        onRegenerate={regenerateFromEvidence}
        onRefresh={refreshEvidence}
      />}
      <fieldset className={`${styles.ownerWorkspace} ${styles.ownerWorkspaceFull} pipeline-readonly-boundary`} disabled={(projection.pipeline?.editingLocked ?? false) && !competitorResearchDuringGeneration && !readOnlyFormationStage} aria-label="Текущий этап и редактирование">
        <section className={`${styles.artifact} owner-main`} id="owner-stage-panel" aria-labelledby={`owner-stage-tab-${activeStage}`}>
          {projection.currentResult && !findingsPrototypeActive && !useFindingsReadiness && !useStrategyBrief && !useCampaignPortfolio && <CurrentPipelineResult
            result={projection.currentResult}
            stage={activeStage}
            active={projection.pipeline?.active ?? false}
            busy={busy}
            demandResearch={projection.demandCostResearch}
            onEvidenceRefresh={refreshEvidence}
            onCompetitorRefresh={refreshCompetitorAnalysis}
            onStrategy={submitStrategyCorrection}
            onPair={submitPairEdit}
          />}

          {useFindingsReadiness && !findingsPrototypeActive && projection.currentResult?.products?.evidence?.formationResearch && <FormationResearchView
            research={projection.currentResult.products.evidence.formationResearch}
            summary={projection.currentResult.products.evidence.formationSummary}
            materials={projection.currentResult.products.evidence.researchMaterials}
            sourceFacts={projection.currentResult.products.evidence.sourceFacts}
            plan={projection.currentResult.products.strategy?.formationPlan}
            portfolio={projection.pipeline?.singleCodex?.workingCampaigns?.bundle.portfolio ?? savedFormation?.portfolio}
            search={<FindingsReadiness view="search" projection={projection} busy={busy} active={projection.pipeline?.active ?? false} onRefresh={refreshEvidence} onCompetitorRefresh={refreshCompetitorAnalysis} competitorBusy={competitorRefreshBusy} onContinue={regenerateFromEvidence} />}
            archive={<FindingsReadiness view="archive" projection={projection} busy={busy} active={projection.pipeline?.active ?? false} onRefresh={refreshEvidence} onCompetitorRefresh={refreshCompetitorAnalysis} competitorBusy={competitorRefreshBusy} onContinue={regenerateFromEvidence} />}
          />}
          {useFindingsReadiness && !findingsPrototypeActive && !projection.currentResult?.products?.evidence?.formationResearch && <FindingsReadiness
            projection={projection}
            embedded={Boolean(projection.currentResult?.products?.evidence?.formationResearch)}
            busy={busy}
            active={projection.pipeline?.active ?? false}
            onRefresh={refreshEvidence}
            onCompetitorRefresh={refreshCompetitorAnalysis}
            competitorBusy={competitorRefreshBusy}
            onContinue={regenerateFromEvidence}
          />}

          {viewingCurrentStage && projection.pipeline && !goalNeedsClarification(projection) && ["STOPPED", "FAILED"].includes(projection.pipeline.status) && <section className="owner-run-failure" role="alert" aria-labelledby="owner-run-failure-title">
            <span>ЗАПУСК ОСТАНОВЛЕН</span>
            <h2 id="owner-run-failure-title">{projection.pipeline.evidenceReuse?.available ? "Можно продолжить по собранным сведениям" : "Подготовка не завершена"}</h2>
            <p>{businessError(projection.pipeline.stateText)}</p>
          </section>}

          {projection.currentRecommendation && !useStrategyBrief && <section className="owner-recommendation">
            <span>Текущая рекомендация</span><h3>{projection.currentRecommendation.headline}</h3><p>{projection.currentRecommendation.rationale}</p>
          </section>}

          {activeStage === "goal" && activeStageStatus !== "upcoming" && <GoalStageSummary projection={projection} busy={busy} onCorrect={submitGoalCorrection} />}

          {activeStage === "findings" && !useFindingsReadiness && activeStageStatus !== "upcoming" && projection.analyticsSummary && <AnalyticsSummaryDisclosure summary={projection.analyticsSummary} />}

          {activeStage === "findings" && !useFindingsReadiness && activeStageStatus !== "upcoming" && projection.directReport && <section className="owner-direct-report" data-report-state={projection.directReport.state} aria-labelledby="owner-direct-report-title">
            <header><div><p className="owner-eyebrow">ТЕКУЩЕЕ ПРОДВИЖЕНИЕ В ЯНДЕКС ДИРЕКТЕ</p><h2 id="owner-direct-report-title">Отчёт о текущем продвижении</h2></div><strong>{projection.directReport.status}</strong></header>
            <div className="owner-direct-lead"><div><h3>{localizedText(projection.directReport.headline)}</h3><p>{localizedText(projection.directReport.summary)}</p></div><dl><div><dt>Проверено</dt><dd>{ownerDate(projection.directReport.observedAt)}</dd></div><div><dt>Свежесть</dt><dd>{localizedText(projection.directReport.freshness)}</dd></div></dl></div>
            <div className="owner-direct-inventory" aria-label="Состав продвижения">{projection.directReport.inventory.map((item) => <article key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small>{item.detail}</small></article>)}</div>
            <section className="owner-direct-campaign-list" aria-labelledby="owner-direct-campaigns-title"><h3 id="owner-direct-campaigns-title">Кампании в отчёте</h3>{projection.directReport.campaigns.length > 0 ? <div>{projection.directReport.campaigns.map((campaign) => <article key={`${campaign.name}-${campaign.delivery}-${campaign.review}`}><strong>{campaign.name}</strong><span>{campaign.delivery}</span><small>{campaign.review}</small></article>)}</div> : <p>{projection.directReport.state === "empty" ? "В проверенном отчёте нет кампаний." : "Список кампаний недоступен; это не означает, что кампаний нет."}</p>}</section>
            <div className="owner-direct-details">
              <article><header><span>Поисковые запросы</span><b>{projection.directReport.queries.status}</b></header><h3>{projection.directReport.queries.value}</h3><p>{projection.directReport.queries.detail}</p></article>
              <article><header><span>Наблюдаемые результаты</span><b>{projection.directReport.results.status}</b></header><h3>{projection.directReport.results.value}</h3><p>{projection.directReport.results.detail}</p></article>
            </div>
          </section>}

          {activeStage === "findings" && !useFindingsReadiness && activeStageStatus !== "upcoming" && projection.businessModel && <section className="owner-business-model" aria-labelledby="owner-business-model-title">
            <header><div><p className="owner-eyebrow">МОДЕЛЬ БИЗНЕСА</p><h2 id="owner-business-model-title">Проверяемое понимание бизнеса</h2></div><strong>{projection.businessModel.economics.status}</strong></header>
            <div className="owner-model-economics"><span>Целевая стоимость результата <button type="button" className="owner-term-info" aria-label="Описание целевой стоимости результата" aria-describedby="target-result-cost-help">?<span id="target-result-cost-help" className="owner-term-tooltip" role="tooltip"><strong>Предельная стоимость одного квалифицированного обращения, при которой реклама сохраняет экономический смысл.</strong><small><b>Формула:</b> ценность продажи × валовая маржа × конверсия обращения в продажу.</small></span></button></span><b>{projection.businessModel.economics.targetResultCost}</b><p>{projection.businessModel.economics.explanation}</p></div>
            <div className="owner-model-grid">{projection.businessModel.fields.map((field) => <article key={field.label}>
              <header><h3>{field.label}</h3><span>{field.availability}</span></header><p>{field.value}</p>
              <dl><div><dt>Источник</dt><dd>{localizedText(field.provenance)}</dd></div><div><dt>Проверено</dt><dd>{ownerDate(field.observedAt)}</dd></div><div><dt>Свежесть</dt><dd>{localizedText(field.freshness)}</dd></div><div><dt>Уверенность</dt><dd>{localizedText(field.confidence)}</dd></div><div><dt>Ограничение</dt><dd>{localizedText(field.limitation)}</dd></div><div><dt>Предположение</dt><dd>{localizedText(field.assumption)}</dd></div></dl>
            </article>)}</div>
            {projection.businessModel.materialQuestions.length > 0 && <div className="owner-model-questions"><h3>Только существенные вопросы</h3><ul>{projection.businessModel.materialQuestions.map((item) => <li key={item.question}><strong>{item.question}</strong><span>{item.consequence}</span></li>)}</ul></div>}
            {projection.businessModel.editor && <BusinessModelEditor
              editor={projection.businessModel.editor}
              busy={busy}
              onEdit={submitBusinessModelEdit}
            />}
          </section>}

          {useStrategyBrief && <StrategyBrief
            strategy={projection.campaignStrategy}
            currentResult={projection.currentResult}
            businessModel={projection.businessModel}
            demandResearch={projection.demandCostResearch}
            competitorMatrix={projection.competitorMatrix}
            materialUnknowns={projection.materialUnknowns}
            active={projection.pipeline?.active ?? false}
            busy={busy}
            onCorrect={submitStrategyCorrection}
            correctionAvailable={!projection.pipeline?.singleCodex}
          />}

          {workingCampaigns && <FormationPortfolioView bundle={workingCampaigns.bundle} sourceFacts={workingCampaigns.sourceFacts} active={false} />}
          {useCampaignPortfolio && projection.currentResult && !workingCampaigns && <CampaignPortfolio
            result={projection.currentResult}
            active={Boolean(projection.pipeline?.active && projection.pipeline.currentStage === "campaigns")}
            busy={busy}
            economicLimitRub={projection.pipeline?.goalFormation.status === "VERIFIED"
              ? projection.pipeline.goalFormation.successCriterion?.maxResultCostRub
              : null}
            onPair={submitPairEdit}
            onOpenStrategy={() => chooseStage("strategy")}
            preparationActions={!projection.pipeline?.singleCodex && projection.pipeline?.evidenceReuse && !projection.pipeline.active ? <EvidenceReuseActions
              available={projection.pipeline.evidenceReuse.available}
              reason={projection.pipeline.evidenceReuse.reason}
              refreshAvailable={!goalNeedsClarification(projection)}
              busy={busy}
              active={projection.pipeline.active}
              onRegenerate={regenerateFromEvidence}
              onRefresh={refreshEvidence}
            /> : null}
          />}

          {activeStage === "findings" && !useFindingsReadiness && activeStageStatus !== "upcoming" && projection.demandCostResearch && <section className="owner-demand-cost" aria-labelledby="owner-demand-cost-title">
            <header><div><p className="owner-eyebrow">СПРОС И СОПОСТАВИМАЯ СТОИМОСТЬ</p><h2 id="owner-demand-cost-title">Исследование нескольких формулировок</h2></div><strong>{projection.demandCostResearch.demand.status}</strong></header>
            <div className="owner-demand-cost-grid">
              <article><span>Спрос</span><h3>{localizedText(projection.demandCostResearch.demand.conclusion)}</h3><dl><div><dt>Источник и дата</dt><dd>{localizedText(projection.demandCostResearch.demand.source)} · {ownerDate(projection.demandCostResearch.demand.observedAt)}</dd></div><div><dt>Как проверяли</dt><dd>{localizedText(projection.demandCostResearch.demand.method)}</dd></div><div><dt>Период</dt><dd>{localizedText(projection.demandCostResearch.demand.window)}</dd></div><div><dt>Где и для кого</dt><dd>{localizedText(projection.demandCostResearch.demand.scope)}</dd></div><div><dt>Покрытие</dt><dd>{localizedText(projection.demandCostResearch.demand.coverage)}</dd></div><div><dt>Сезонность</dt><dd>{localizedText(projection.demandCostResearch.demand.seasonality)}</dd></div></dl><p>{localizedText(projection.demandCostResearch.demand.limitation)}</p></article>
              <article><span>Сопоставимая стоимость</span><h3>{projection.demandCostResearch.cost.range}</h3><dl><div><dt>Источник и дата</dt><dd>{localizedText(projection.demandCostResearch.cost.source)} · {ownerDate(projection.demandCostResearch.cost.observedAt)}</dd></div><div><dt>Валюта и НДС</dt><dd>{projection.demandCostResearch.cost.currency} · {projection.demandCostResearch.cost.vat}</dd></div><div><dt>Что сравнивали</dt><dd>{localizedText(projection.demandCostResearch.cost.sample)}</dd></div><div><dt>Насколько сравнение подходит</dt><dd>{localizedText(projection.demandCostResearch.cost.scope)}</dd></div></dl><p>{localizedText(projection.demandCostResearch.cost.limitation)}</p></article>
            </div>
            {projection.demandCostResearch.demand.formulations.length > 0 && <div className="owner-demand-formulations"><h3>Результативные формулировки Wordstat</h3>{projection.demandCostResearch.demand.formulations.map((item, index) => <article key={`${item.category}-${index}`} data-frequency-state="available">
              <header><span>{localizedText(item.category)}</span><strong>{localizedText(item.phrase)}</strong><b>{item.frequency}</b></header>
              <dl><div><dt>Как проверяли</dt><dd>{localizedText(item.method)} · {item.operator}</dd></div><div><dt>Где и когда</dt><dd>{localizedText(item.scope)} · {ownerDate(item.observedAt)}</dd></div><div><dt>Источник</dt><dd>{localizedText(item.provenance)}</dd></div></dl>
            </article>)}</div>}
            {projection.demandCostResearch.demand.gaps.length > 0 && <div className="owner-demand-gaps"><strong>Чего не хватает</strong><ul>{projection.demandCostResearch.demand.gaps.map((gap) => <li key={gap}>{localizedText(gap)}</li>)}</ul></div>}
            <article className="owner-demand-next-action"><span>Следующий шаг</span><strong>{projection.demandCostResearch.demand.nextAction}</strong></article>
          </section>}

          {activeStage === "strategy" && activeStageStatus !== "upcoming" && !useStrategyBrief && projection.appliedPractice && <section className="owner-recommendation" aria-labelledby="owner-applied-practice-title">
            <span>Применённая практика</span><h3 id="owner-applied-practice-title">{projection.appliedPractice.practice}</h3><p>{projection.appliedPractice.limitation}</p>
          </section>}

          {activeStage === "findings" && !useFindingsReadiness && activeStageStatus !== "upcoming" && projection.competitorMatrix && <section className="owner-competitor-matrix" aria-labelledby="owner-competitor-matrix-title">
            <header><div><p className="owner-eyebrow">КАК КОНКУРЕНТЫ ПОКАЗЫВАЮТ СЕБЯ</p><h2 id="owner-competitor-matrix-title">Сравнение конкурентов</h2></div><strong>{projection.competitorMatrix.status}</strong></header>
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
            <div className="owner-competitor-aggregates"><h3>Выводы только по этому набору</h3>{projection.competitorMatrix.aggregateClaims.map((claim) => <article key={claim.claim}><strong>{localizedText(claim.claim)}</strong><span>{localizedText(claim.result)}</span><p>{localizedText(claim.scope)} {localizedText(claim.limitation)}</p></article>)}</div>
            {projection.competitorMatrix.hypotheses.length > 0 && <div className="owner-competitor-hypotheses"><h3>Гипотезы для кампании — не факты эффективности</h3>{projection.competitorMatrix.hypotheses.map((hypothesis) => <article key={hypothesis.pattern}>
              <span>ПОВТОРЯЮЩАЯСЯ РЫНОЧНАЯ ТЕХНИКА</span>
              <h4>{hypothesis.pattern}</h4>
              <p><b>Проверяемая гипотеза:</b> {localizedText(hypothesis.hypothesis)}</p>
              <p><b>Основание:</b> {localizedText(hypothesis.basis)}</p>
              <p><b>Точный набор доказательств:</b></p>
              <ul>{hypothesis.evidenceSet.map((evidence) => <li key={`${evidence.competitor}-${evidence.exactLanding}`}><strong>{evidence.competitor}</strong> · {evidence.exactLanding} · {evidence.observationDate}</li>)}</ul>
              <p>{hypothesis.limitation}</p>
            </article>)}</div>}
            <div className="owner-competitor-limitations"><strong>Чего это сравнение не доказывает</strong><ul>{projection.competitorMatrix.limitations.map((limitation) => <li key={limitation}>{localizedText(limitation)}</li>)}</ul></div>
          </section>}

          {viewingCurrentStage && !useFindingsReadiness && projection.agentActivity && <section className="owner-progress" aria-label="Ход работы агента">
            <i /><div><strong>{projection.agentActivity.summary}</strong><p>{projection.agentActivity.nextBusinessStep}</p></div>
            <span>{projection.agentActivity.completed} из {projection.agentActivity.total}</span>
          </section>}

          {viewingCurrentStage && !useCampaignPortfolio && ownerActionProblem && <section className="owner-cards" aria-label="Проблема, требующая действия владельца">
            <article className={`owner-card ${ownerActionProblem.kind}`}>
              <span>{cardLabels[ownerActionProblem.kind]}</span><h3>{ownerActionProblem.title}</h3><p>{ownerActionProblem.body}</p>
              {ownerActionProblem.facts && <dl>{ownerActionProblem.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}
            </article>
          </section>}

          {viewingCurrentStage && !useCampaignPortfolio && projection.primaryAction && <form key={projection.primaryAction.handle} className="owner-action" onSubmit={submit}>
            <header><p className="owner-eyebrow">СЛЕДУЮЩИЙ ШАГ</p><h2>{projection.primaryAction.label}</h2><p>{projection.primaryAction.description}</p></header>
            {projection.primaryAction.fields.length > 0 && <div className="owner-fields">{projection.primaryAction.fields.map((field) => <OwnerField key={field.key} field={field} />)}</div>}
            <button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? "Агент выполняет работу…" : projection.primaryAction.label}</button>
          </form>}
          {error && <p className="owner-error" role="alert" ref={errorRef} tabIndex={-1}>{businessError(error)}</p>}
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
      <p>Сохранение создаст новую версию модели бизнеса и заново соберёт связанные данные, стратегию и черновики кампаний.</p>
      <div className="owner-fields">{editor.fields.map((field) => <OwnerField key={field.key} field={field} />)}</div>
      <footer><button type="button" onClick={(event) => { event.currentTarget.form?.reset(); setEditing(false); }}>Отменить правки</button><button type="submit" disabled={busy}>{busy ? "Сохраняю…" : "Сохранить и пересобрать"}</button></footer>
    </form>}
  </section>;
}

function currentDimension(result: CurrentPipelineOwnerResult, id: string) {
  return result.products?.strategy?.dimensions.find((dimension) => dimension.id === id)?.value ?? "";
}

function projectionAt(value: Record<string, unknown>, pointer: string): unknown {
  return pointer.slice(1).split("/").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function editableProjectionText(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => typeof item === "object" && item !== null ? String((item as Record<string, unknown>).Text ?? "") : String(item)).filter(Boolean).join("\n");
  return String(value ?? "");
}

function rublesFromMicros(value: unknown) {
  const micros = Number(value);
  if (!Number.isFinite(micros) || micros <= 0) return "Не подтверждено";
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(micros / 1_000_000)} ₽`;
}

function currentAuctionSummary(projection: Record<string, unknown>) {
  const strategyType = String(projectionAt(projection, "/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/BiddingStrategyType") ?? "");
  const searchResults = String(projectionAt(projection, "/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/PlacementTypes/SearchResults") ?? "");
  const productGallery = String(projectionAt(projection, "/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/PlacementTypes/ProductGallery") ?? "");
  const networkType = String(projectionAt(projection, "/direct/campaign/UnifiedCampaign/BiddingStrategy/Network/BiddingStrategyType") ?? "");
  const negatives = projectionAt(projection, "/direct/ad_group/NegativeKeywords/Items");
  return {
    name: localizedText(projectionAt(projection, "/direct/campaign/Name") ?? "Текущий черновик кампании"),
    placement: [
      searchResults === "YES" ? "Поиск Яндекса" : null,
      productGallery === "YES" ? "Товарная галерея" : null,
      networkType === "SERVING_OFF" ? "РСЯ отключена" : networkType ? "РСЯ включена" : null,
    ].filter(Boolean).join(" · ") || "Размещение не подтверждено",
    strategy: strategyType === "WB_MAXIMUM_CLICKS"
      ? "Максимум переходов в недельном бюджете"
      : strategyType || "Стратегия не подтверждена",
    weeklyBudget: rublesFromMicros(projectionAt(projection, "/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/WbMaximumClicks/WeeklySpendLimit")),
    bidCeiling: rublesFromMicros(projectionAt(projection, "/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/WbMaximumClicks/BidCeiling")),
    keyword: String(projectionAt(projection, "/direct/keyword/Keyword") ?? "Не подтверждена"),
    negativeKeywords: Array.isArray(negatives) && negatives.length ? negatives.map(String).join(", ") : "Не заданы",
  };
}

type DemandCostResearchProjection = OwnerJourneyProjection["demandCostResearch"];
type CurrentAuctionSummary = ReturnType<typeof currentAuctionSummary>;

function CampaignMarketChecks({
  research,
  auctions,
}: {
  research: DemandCostResearchProjection;
  auctions: CurrentAuctionSummary[];
}) {
  const demand = research?.demand;
  const cost = research?.cost;
  return <section className="owner-current-market" aria-labelledby="owner-current-market-title">
    <header>
      <div><p className="owner-eyebrow">ПРОВЕРКА ЧЕРНОВИКА КАМПАНИИ</p><h3 id="owner-current-market-title">Спрос и аукцион</h3></div>
      <strong>{demand?.status ?? "Недоступно"}</strong>
    </header>
    <div className="owner-current-market-grid">
      <article className="owner-current-wordstat">
        <span>ДАННЫЕ WORDSTAT</span>
        <h4>{localizedText(demand?.conclusion ?? "Подтверждённые данные Wordstat не найдены; это не означает нулевой спрос.")}</h4>
        {demand ? <>
          <dl>
            <div><dt>Источник и дата</dt><dd>{localizedText(demand.source)} · {ownerDate(demand.observedAt)}</dd></div>
            <div><dt>Как и когда проверяли</dt><dd>{localizedText(demand.method)} · {localizedText(demand.window)}</dd></div>
            <div><dt>Где и для кого</dt><dd>{localizedText(demand.scope)}</dd></div>
            <div><dt>Покрытие</dt><dd>{localizedText(demand.coverage)}</dd></div>
            <div><dt>Динамика и сезонность</dt><dd>{localizedText(demand.seasonality)}</dd></div>
          </dl>
          {demand.formulations.length > 0 && <ol>{demand.formulations.map((item, index) => <li key={`${item.category}-${item.phrase}-${index}`} data-frequency-state="available"><span>{localizedText(item.category)}</span><strong>{localizedText(item.phrase)}</strong><b>{item.frequency}</b><small>{localizedText(item.method)} · {item.operator} · {localizedText(item.scope)}</small></li>)}</ol>}
          {demand.gaps.length > 0 && <p><b>Чего не хватает:</b> {demand.gaps.map(localizedText).join(" · ")}</p>}
          <p>{localizedText(demand.limitation)}</p>
        </> : <p>В текущих проверенных данных нет частоты Wordstat. Отсутствие данных нельзя считать нулевым спросом.</p>}
      </article>
      <article className="owner-current-auction">
        <span>УЧАСТИЕ В АУКЦИОНЕ</span>
        <h4>Как черновик ограничивает будущие торги</h4>
        {auctions.length ? <div>{auctions.map((auction, index) => <section key={`${auction.name}-${index}`}>
          <h5>{auction.name}</h5>
          <dl>
            <div><dt>Где участвует</dt><dd>{auction.placement}</dd></div>
            <div><dt>Стратегия</dt><dd>{auction.strategy}</dd></div>
            <div><dt>Недельный бюджет</dt><dd>{auction.weeklyBudget}</dd></div>
            <div><dt>Предел ставки</dt><dd>{auction.bidCeiling} за клик</dd></div>
            <div><dt>Ключевая фраза</dt><dd>{auction.keyword}</dd></div>
            <div><dt>Минус-слова</dt><dd>{auction.negativeKeywords}</dd></div>
          </dl>
        </section>)}</div> : <p>Настройки участия в аукционе ещё не подтверждены черновиком кампании.</p>}
        <dl className="owner-current-cost">
          <div><dt>Сопоставимая стоимость перехода</dt><dd>{cost?.range ?? "Недоступна"}</dd></div>
          <div><dt>Источник оценки</dt><dd>{cost ? `${localizedText(cost.source)} · ${ownerDate(cost.observedAt)}` : "Квалифицированный источник не найден"}</dd></div>
        </dl>
        <p>Предел ставки — верхняя граница, а не обещанная цена клика. Фактическая цена может быть ниже; позиция и объём трафика заранее не гарантируются.</p>
      </article>
    </div>
    <footer>Wordstat показывает частоту запросов, а аукционный блок — настройки черновика и ориентир по стоимости. Эти данные не обещают клики, позицию или бизнес-результат.</footer>
  </section>;
}

function financialRub(value: string | null) {
  if (!value || !/^-?\d+$/u.test(value)) return "Недоступно";
  return `${BigInt(value).toLocaleString("ru-RU")} ₽`;
}

function competitorAnalysisStatus(status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE") {
  return status === "AVAILABLE" ? "Получено" : status === "PARTIAL" ? "Получено частично" : "Недоступно";
}

function competitiveRelationLabel(relation: "DIRECT_COMPETITOR" | "SUBSTITUTE_COMPETITOR" | null) {
  return relation === "SUBSTITUTE_COMPETITOR"
    ? "Альтернативный конкурент"
    : relation === "DIRECT_COMPETITOR" ? "Прямой конкурент" : "Роль не классифицирована";
}

function financialProfileRoleLabel(role: "COMPANY" | "COMPETITOR" | "COMPANY_COMPETITOR") {
  return role === "COMPANY_COMPETITOR" ? "Организатор · конкурент" : role === "COMPANY" ? "Организатор" : "Конкурент";
}

type CurrentEvidenceProjection = NonNullable<NonNullable<CurrentPipelineOwnerResult["products"]>["evidence"]>;

const EVIDENCE_CODE_LABELS: Record<string, string> = {
  CURRENT: "Актуально",
  current: "Актуально",
  AGING: "Требует скорого обновления",
  aging: "Требует скорого обновления",
  STALE: "Устарело",
  stale: "Устарело",
  UNKNOWN: "Свежесть неизвестна",
  unknown: "Свежесть неизвестна",
  COMPLETE_FOR_SCOPE: "Полно для указанной области",
  complete_for_scope: "Полно для указанной области",
  PARTIAL: "Частично",
  partial: "Частично",
  PRIMARY_ONLY: "Только первичные источники",
  MIXED_ALLOWED: "Первичные и разрешённые публичные источники",
  SINGLE_SOURCE: "Один источник",
  CORROBORATED: "Подтверждено несколькими источниками",
  CONFLICTED: "Есть противоречия",
  TIER_1_VERIFIED: "Проверенный факт",
  TIER_2_CORROBORATED: "Подтверждённый факт",
  TIER_3_INDICATIVE: "Ориентировочные данные",
  TIER_4_INFERENCE: "Интерпретация",
  BLOCKED_UNKNOWN: "Неизвестно — использование заблокировано",
};

function evidenceCodeLabel(value: unknown) {
  const code = String(value ?? "").trim();
  return EVIDENCE_CODE_LABELS[code] ?? machineLabel(code, "Неизвестно");
}

const EVIDENCE_SCOPE_LABELS: Record<string, string> = {
  client_login: "Логин аккаунта",
  client_id: "ID клиента",
  counter_id: "Счётчик Метрики",
  goal_id: "Цель Метрики",
  host: "Сайт",
  regions: "Регионы",
  region_names: "Регионы",
  device: "Устройства",
  access: "Доступ",
  observations: "Наблюдения",
};

function evidenceScopeLabel(value: string) {
  return EVIDENCE_SCOPE_LABELS[value] ?? ownerFieldLabel(value);
}

function evidenceScopeValue(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value as JsonRecord).map(([key, item]) => `${evidenceScopeLabel(key)}: ${ownerValue(item)}`).join(" · ");
  }
  return ownerValue(value);
}

const COMPANY_FACT_PRIORITY = [
  "product",
  "value",
  "audience",
  "qualified_result",
  "geography",
  "exclusions",
  "average_sale_value_rub",
  "gross_margin_percent",
];

function EvidenceSnapshotOverview({ evidence }: { evidence: CurrentEvidenceProjection }) {
  const provenance = evidence.provenance;
  const companyFacts = [...provenance.company.facts]
    .sort((left, right) => {
      const leftPriority = COMPANY_FACT_PRIORITY.indexOf(left.field);
      const rightPriority = COMPANY_FACT_PRIORITY.indexOf(right.field);
      return (leftPriority < 0 ? COMPANY_FACT_PRIORITY.length : leftPriority)
        - (rightPriority < 0 ? COMPANY_FACT_PRIORITY.length : rightPriority);
    })
    .slice(0, COMPANY_FACT_PRIORITY.length);
  return <div className="owner-current-snapshot" data-evidence-status={provenance.recommendationStatus.toLowerCase()}>
    <header>
      <div><p className="owner-eyebrow">ТЕКУЩИЙ EVIDENCE SNAPSHOT</p><h4>Факты компании и доступ к данным</h4></div>
      <strong>{evidenceCodeLabel(provenance.recommendationStatus)}</strong>
    </header>
    <p>Текущий Evidence Snapshot сформирован {ownerDate(provenance.generatedAt)}; состояние источников оценивается на {ownerDate(provenance.asOf)}.</p>
    <dl className="owner-current-snapshot-meta">
      <div><dt>ID среза</dt><dd>{provenance.snapshotId || "Недоступно"}</dd></div>
      <div><dt>Источники</dt><dd>{provenance.summary.sourcesVerified} проверено · {provenance.summary.sourcesPartial} частично · {provenance.summary.sourcesUnavailable} недоступно</dd></div>
      <div><dt>Свежесть</dt><dd>{evidenceCodeLabel(provenance.confidence.freshness)}</dd></div>
      <div><dt>Покрытие</dt><dd>{evidenceCodeLabel(provenance.confidence.coverage)}</dd></div>
      <div><dt>Уверенность</dt><dd>{evidenceCodeLabel(provenance.confidence.quality)} · {evidenceCodeLabel(provenance.confidence.consistency)}</dd></div>
    </dl>
    <div className="owner-current-evidence-core">
      <article>
        <header><h5>Компания · {provenance.company.host || "сайт не определён"}</h5><span>{companyFacts.length} из {provenance.company.facts.length} фактов</span></header>
        {companyFacts.length ? <dl>{companyFacts.map((fact) => <div key={fact.id}>
          <dt>{ownerFieldLabel(fact.field)}</dt>
          <dd>{localizedText(fact.value)}</dd>
          <small>{evidenceCodeLabel(fact.confidence.tier)} · {evidenceCodeLabel(fact.confidence.freshness)}</small>
          {fact.sourceUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer">Источник</a>)}
        </div>)}</dl> : <p>Подтверждённые сведения компании не получены.</p>}
      </article>
      {provenance.integrations.map((integration) => <article key={integration.id} data-source-status={integration.status.toLowerCase()}>
        <header><h5>{integration.title}</h5><span>{evidenceCodeLabel(integration.status)}</span></header>
        <dl>
          <div><dt>Источник и дата наблюдения</dt><dd>{integration.sourceUrls.length ? integration.sourceUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer">Официальный источник</a>) : "URL недоступен"} · {integration.observedAt ? ownerDate(integration.observedAt) : "дата недоступна"}</dd></div>
          <div><dt>Свежесть</dt><dd>{evidenceCodeLabel(integration.freshness)}</dd></div>
          <div><dt>Область</dt><dd>{Object.entries(integration.scope).map(([key, value]) => `${evidenceScopeLabel(key)}: ${evidenceScopeValue(value)}`).join(" · ") || "Недоступна"}</dd></div>
        </dl>
        {integration.facts.length > 0 && <p>{integration.facts.map(localizedText).join(" · ")}</p>}
        {integration.limitations.length > 0 && <p><b>Ограничения:</b> {integration.limitations.join(" · ")}</p>}
      </article>)}
    </div>
    {(provenance.hardBlockers.length > 0 || provenance.materialUncertainties.length > 0) && <div className="owner-current-evidence-gaps">
      <span className="owner-eyebrow">СУЩЕСТВЕННЫЕ НЕИЗВЕСТНЫЕ</span>
      <strong>Недоступное не заменено нулями</strong>
      <p>{[...provenance.hardBlockers, ...provenance.materialUncertainties].map(localizedText).join(" · ")}</p>
    </div>}
    <details className="owner-current-evidence-sources">
      <summary>Источники, свежесть и ограничения</summary>
      <div>{provenance.sources.map((source) => <article key={source.id} data-source-status={source.status.toLowerCase()}>
        <header><h5>{localizedText(source.title)}</h5><span>{evidenceCodeLabel(source.status)}</span></header>
        <dl>
          <div><dt>Происхождение</dt><dd>{localizedText(source.provenanceClass)} · {localizedText(source.kind)}</dd></div>
          <div><dt>Дата наблюдения</dt><dd>{source.observedAt ? ownerDate(source.observedAt) : "Недоступна"}</dd></div>
          <div><dt>Свежесть</dt><dd>{evidenceCodeLabel(source.freshness)}</dd></div>
          <div><dt>Область</dt><dd>{Object.entries(source.scope).map(([key, value]) => `${evidenceScopeLabel(key)}: ${evidenceScopeValue(value)}`).join(" · ") || "Недоступна"}</dd></div>
        </dl>
        {source.sourceUrls.length > 0 && <footer>{source.sourceUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer">Открыть источник</a>)}</footer>}
        {source.facts.length > 0 && <p>{source.facts.map(localizedText).join(" · ")}</p>}
        <p><b>Ограничения:</b> {source.limitations.length ? source.limitations.join(" · ") : "Не зафиксированы для текущей области."}</p>
      </article>)}</div>
      {provenance.domains.length > 0 && <ul className="owner-current-evidence-domains">{provenance.domains.map((domain) => <li key={domain.id}>
        <strong>{localizedText(domain.id)}</strong><span>{evidenceCodeLabel(domain.status)}</span>
        <small>Свежесть: {domain.freshness.current} актуально · {domain.freshness.aging} требует обновления · {domain.freshness.stale} устарело · {domain.freshness.unknown} неизвестно</small>
      </li>)}</ul>}
    </details>
  </div>;
}

function EvidenceMarketResearch({ research }: { research: DemandCostResearchProjection }) {
  const demand = research?.demand;
  const cost = research?.cost;
  return <section className="owner-current-market owner-current-market--evidence" aria-labelledby="owner-current-market-evidence-title">
    <header><div><p className="owner-eyebrow">РЫНОК · ДО ЗАПУСКА</p><h3 id="owner-current-market-evidence-title">Спрос и сопоставимая стоимость</h3></div><strong>{demand?.status ?? "Недоступно"}</strong></header>
    <div className="owner-current-market-grid">
      <article className="owner-current-wordstat">
        <span>ЯНДЕКС WORDSTAT</span>
        <h4>{localizedText(demand?.conclusion ?? "Подтверждённая частота не получена.")}</h4>
        {demand ? <>
          <dl>
            <div><dt>Источник и дата наблюдения</dt><dd>{localizedText(demand.source)} · {ownerDate(demand.observedAt)}</dd></div>
            <div><dt>Метод и окно</dt><dd>{localizedText(demand.method)} · {localizedText(demand.window)}</dd></div>
            <div><dt>Область</dt><dd>{localizedText(demand.scope)}</dd></div>
            <div><dt>Покрытие</dt><dd>{localizedText(demand.coverage)}</dd></div>
          </dl>
          {demand.formulations.length > 0 && <ol>{demand.formulations.map((item, index) => <li key={`${item.category}-${item.phrase}-${index}`} data-frequency-state="available"><span>{localizedText(item.category)}</span><strong>{localizedText(item.phrase)}</strong><b>{item.frequency}</b><small>{localizedText(item.scope)} · {ownerDate(item.observedAt)}</small></li>)}</ol>}
          {demand.gaps.length > 0 && <p><b>Ограничения:</b> {demand.gaps.map(localizedText).join(" · ")}</p>}
          <p>{localizedText(demand.limitation)}</p>
        </> : <p>Недоступно — не означает ноль. Источник, дата и область наблюдения отсутствуют.</p>}
      </article>
      <article>
        <span>СТОИМОСТЬ ДО ЗАПУСКА</span>
        <h4>{cost?.range ?? "Сопоставимая стоимость недоступна"}</h4>
        <dl>
          <div><dt>Источник и дата наблюдения</dt><dd>{cost ? `${localizedText(cost.source)} · ${ownerDate(cost.observedAt)}` : "Недоступны"}</dd></div>
          <div><dt>Область</dt><dd>{cost ? localizedText(cost.scope) : "Недоступна"}</dd></div>
          <div><dt>Выборка</dt><dd>{cost?.sample ?? "Недоступна"}</dd></div>
          <div><dt>НДС</dt><dd>{cost?.vat ?? "Недоступен"}</dd></div>
        </dl>
        <p><b>Ограничения:</b> {localizedText(cost?.limitation ?? "Недоступно — не означает нулевую стоимость.")}</p>
      </article>
    </div>
    <footer>Коллекторы сохраняют источник, дату и область. Evidence Analyst интерпретирует только сохранённый срез; частота и диапазон не являются прогнозом результата.</footer>
  </section>;
}

function CurrentPipelineResult({
  result,
  stage,
  active,
  busy,
  demandResearch,
  onEvidenceRefresh,
  onCompetitorRefresh,
  onStrategy,
  onPair,
}: {
  result: CurrentPipelineOwnerResult;
  stage: OwnerJourneyStageId;
  active: boolean;
  busy: boolean;
  demandResearch: DemandCostResearchProjection;
  onEvidenceRefresh: () => Promise<void>;
  onCompetitorRefresh: () => Promise<void>;
  onStrategy: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onPair: (
    event: FormEvent<HTMLFormElement>,
    pair: NonNullable<CurrentPipelineOwnerResult["products"]>["campaignPairs"][number],
    kind: "semantic" | "technical",
  ) => Promise<void>;
}) {
  const products = result.products;
  return <section className="owner-current-pipeline-result" data-current-state-revision={result.stateRevision ?? "none"}>
    {stage === "campaigns" && <CampaignMarketChecks
      research={demandResearch}
      auctions={products?.campaignPairs.map((pair) => currentAuctionSummary(pair.publishProjection)) ?? []}
    />}

    {stage === "findings" && <section className="owner-current-evidence" aria-labelledby="owner-current-evidence-title">
      <header>
        <div><p className="owner-eyebrow">ПРОВЕРЕННЫЕ ДАННЫЕ</p><h3 id="owner-current-evidence-title">Компания, рынок, конкуренты и финансовый контекст</h3></div>
        <div className="owner-current-evidence-actions">
          {products?.evidence && <strong>{competitorAnalysisStatus(products.evidence.competitorAnalysis.status)}</strong>}
          <button type="button" onClick={onEvidenceRefresh} disabled={busy || active}>{busy ? "Запускаю сбор…" : "Собрать все сведения заново"}</button>
          <button type="button" onClick={onCompetitorRefresh} disabled={busy || active || !products?.evidence}>{busy ? "Обновляю…" : "Обновить данные о конкурентах"}</button>
        </div>
      </header>
      {products?.evidence ? <>
        <EvidenceSnapshotOverview evidence={products.evidence} />
        <h4 className="owner-current-evidence-subtitle">Конкуренты и финансовый контекст</h4>
        <p className="owner-current-evidence-summary">{products.evidence.competitorAnalysis.summary}</p>
        <dl className="owner-current-evidence-meta">
          <div><dt>Конкурентные предложения</dt><dd>{products.evidence.competitorAnalysis.observedOfferCount} из {products.evidence.competitorAnalysis.candidateCount}</dd></div>
          <div><dt>Финансовая отчётность</dt><dd>{competitorAnalysisStatus(products.evidence.competitorAnalysis.financialStatus)}</dd></div>
          <div><dt>Конкуренты проверены</dt><dd>{products.evidence.competitorRefresh?.refreshedAt ? ownerDate(products.evidence.competitorRefresh.refreshedAt) : products.evidence.generatedAt ? ownerDate(products.evidence.generatedAt) : "Время сохранено в истории версий"}</dd></div>
        </dl>
        {products.evidence.competitorAnalysis.competitors.length > 0 && <div className="owner-current-competitors">
          {products.evidence.competitorAnalysis.competitors.map((competitor) => <article key={competitor.name} data-observation-status={competitor.observationStatus.toLowerCase()}>
            <header><h4>{competitor.name}</h4><span>{competitor.publishedPrice ?? (competitor.observationStatus === "OBSERVED" ? "Проверено" : "Не получено")}</span></header>
            <small className="owner-current-competitor-relation">{competitiveRelationLabel(competitor.competitiveRelation)}</small>
            <p>{competitor.observationStatus === "OBSERVED" ? localizedText(competitor.observedOffer) : "Страница не получена при текущей проверке; предложение не считается подтверждённым."}</p>
            {competitor.evidenceQuote && <blockquote>«{localizedText(competitor.evidenceQuote)}»</blockquote>}
            <small>{competitor.observedAt ? `Наблюдение: ${ownerDate(competitor.observedAt)}` : "Дата наблюдения недоступна"}</small>
            {competitor.observationScope && <small>{localizedText(competitor.observationScope)}</small>}
            <small>{localizedText(competitor.rationale)}</small>
            {competitor.limitations.length > 0 && <small><b>Ограничения:</b> {competitor.limitations.map(localizedText).join(" · ")}</small>}
            {competitor.landingUrl && <a href={competitor.landingUrl} target="_blank" rel="noreferrer">{competitor.observationStatus === "OBSERVED" ? "Открыть подтверждённую страницу" : "Открыть заявленную страницу"}</a>}
          </article>)}
        </div>}
        {products.evidence.competitorAnalysis.financialProfiles.length > 0 && <details className="owner-current-financial">
          <summary>Финансовая отчётность юридических лиц</summary>
          <div>{products.evidence.competitorAnalysis.financialProfiles.map((profile) => <article key={profile.name}>
            <header><h4>{profile.name}</h4><span>{financialProfileRoleLabel(profile.role)}</span></header>
            <dl><div><dt>Отчётный год</dt><dd>{profile.reportingYear ?? "Недоступен"}</dd></div><div><dt>Выручка</dt><dd>{financialRub(profile.revenueRub)}</dd></div><div><dt>Чистая прибыль</dt><dd>{financialRub(profile.netProfitRub)}</dd></div></dl>
            <footer>{profile.bfoUrl && <a href={profile.bfoUrl} target="_blank" rel="noreferrer">ГИР БО ФНС</a>}{profile.rusprofileUrl && <a href={profile.rusprofileUrl} target="_blank" rel="noreferrer">Rusprofile</a>}</footer>
          </article>)}</div>
        </details>}
        {products.evidence.competitorAnalysis.limitations.length > 0 && <p className="owner-current-evidence-limitations">Финансовые значения относятся к юридическим лицам целиком и не раскрывают рекламные бюджеты, CPC, CPA или эффективность кампаний конкурентов.</p>}
        <p className="owner-current-evidence-refresh-note">Сбор выполняют read-only adapters: first-party HTTPS, официальные API Директа и Метрики, Wordstat bridge, разрешённые страницы конкурентов и настроенный Financial Intelligence bridge. Evidence Analyst интерпретирует уже собранный snapshot и не выполняет внешний сбор. Публикация, показы и расходы не разрешаются.</p>
      </> : <p>Система проверки ещё не сохранила текущие данные.</p>}
    </section>}

    {stage === "findings" && <EvidenceMarketResearch research={demandResearch} />}

    {stage === "strategy" && products?.strategy && <section className="owner-current-strategy" aria-labelledby="owner-current-strategy-title">
      <header><div><p className="owner-eyebrow">ПОДГОТОВЛЕННАЯ СТРАТЕГИЯ</p><h3 id="owner-current-strategy-title">Текущая стратегия кампании</h3></div><strong>{machineLabel(products.strategy.status || "AGENT_ACCEPTED")}</strong></header>
      <div className="owner-model-grid">{products.strategy.dimensions.map((dimension) => <article key={dimension.id}><header><h4>{ownerFieldLabel(dimension.id)}</h4><span>{machineLabel(dimension.confidence, "—")}</span></header><p>{ownerValue(dimension.value)}</p><small>{localizedText(dimension.rationale)}</small></article>)}</div>
      <form onSubmit={onStrategy}>
        <h4>Важная правка с полной повторной проверкой</h4>
        <div className="owner-fields">
          <label><span>География</span><input name="geography" required defaultValue={String(currentDimension(result, "geography"))} /></label>
          <label><span>Недельный бюджет, ₽</span><input name="weekly_budget" type="number" min="1" required defaultValue={String(currentDimension(result, "weekly_budget"))} /></label>
          <label><span>Целевая стоимость результата, ₽</span><input name="target_result_cost" type="number" min="0" defaultValue={String(currentDimension(result, "target_result_cost") ?? "")} /></label>
          <label><span>Основное сообщение</span><textarea name="core_message" required defaultValue={String(currentDimension(result, "core_message"))} /></label>
        </div>
        <button type="submit" disabled={busy || active}>{busy ? "Перепроверяю…" : "Сохранить и перепроверить"}</button>
      </form>
    </section>}

    {stage === "campaigns" && <section className="owner-current-pairs" aria-labelledby="owner-current-pairs-title">
      <header><div><p className="owner-eyebrow">ОТ ГИПОТЕЗЫ К ЧЕРНОВИКУ</p><h3 id="owner-current-pairs-title">Текущие пары</h3></div><strong>{products?.campaignPairs.length ?? 0}</strong></header>
      {products?.campaignPairs.map((pair, index) => {
        const semanticDefaults = {
          product: projectionAt(pair.publishProjection, "/business/product") ?? currentDimension(result, "campaign_focus"),
          audience: projectionAt(pair.publishProjection, "/business/audience") ?? currentDimension(result, "target_audience"),
          offer: currentDimension(result, "advertised_offer"),
          qualified_result: projectionAt(pair.publishProjection, "/business/qualified_result") ?? currentDimension(result, "qualified_result"),
          core_message: projectionAt(pair.publishProjection, "/business/value") ?? currentDimension(result, "core_message"),
        };
        const technicalDefaults = {
          campaign_name: editableProjectionText(projectionAt(pair.publishProjection, "/direct/campaign/Name")),
          group_name: editableProjectionText(projectionAt(pair.publishProjection, "/direct/ad_group/Name")),
          negative_keywords: editableProjectionText(projectionAt(pair.publishProjection, "/direct/ad_group/NegativeKeywords/Items")),
          keyword: editableProjectionText(projectionAt(pair.publishProjection, "/direct/keyword/Keyword")),
          ad_title: editableProjectionText(projectionAt(pair.publishProjection, "/direct/ad/ResponsiveAd/Titles")),
          ad_text: editableProjectionText(projectionAt(pair.publishProjection, "/direct/ad/ResponsiveAd/Texts")),
          measurement_goal: String(pair.auctionProtocol.measurement_goal ?? semanticDefaults.qualified_result ?? ""),
        };
        return <article key={pair.pairKey} className="owner-current-pair">
          <header><span>Пара {index + 1}</span><strong>Одна гипотеза · один черновик</strong></header>
          <form onSubmit={(event) => onPair(event, pair, "semantic")}>
            <input type="hidden" name="pair_key" value={pair.pairKey} />
            <h4>Гипотеза кампании · бизнес-смысл</h4>
            <div className="owner-fields">{Object.entries(semanticDefaults).map(([name, value]) => <label key={name}><span>{ownerFieldLabel(name)}</span><textarea name={name} required defaultValue={String(value ?? "")} /></label>)}</div>
            <button type="submit" disabled={busy || active}>Сохранить гипотезу и пересобрать черновик</button>
          </form>
          <form onSubmit={(event) => onPair(event, pair, "technical")}>
            <input type="hidden" name="pair_key" value={pair.pairKey} />
            <h4>Черновик кампании · предпросмотр и настройки</h4>
            <div className="owner-fields">{Object.entries(technicalDefaults).map(([name, value]) => <label key={name}><span>{ownerFieldLabel(name)}</span><textarea name={name} required defaultValue={String(value)} /></label>)}</div>
            <button type="submit" disabled={busy || active}>Сохранить новую версию черновика</button>
          </form>
        </article>;
      })}
      {!products?.campaignPairs.length && <p>Система подготовки кампаний ещё не сохранила ни одной текущей пары.</p>}
    </section>}

  </section>;
}

function StageNavigation({ projection, selectedStage, onStage }: { projection: CurrentOwnerProjection; selectedStage: OwnerJourneyStageId; onStage: (stage: OwnerJourneyStageId) => void }) {
  const pipeline = projection.pipeline;
  const legacyStages = projection.journey.stages.map((stage, index) => ({
    ...stage,
    label: pipeline?.stages[index]?.label ?? stage.label,
    status: stage.status === "complete" ? "Завершён" : stage.status === "current" ? "Выполняется" : "Ожидает",
    icon: stage.status === "complete" ? "✓" : String(index + 1),
    tone: stage.status === "complete" ? "complete" : stage.status === "current" ? "active" : "pending",
  }));
  const sourceStages = pipeline?.stages ?? legacyStages;
  const needsGoalClarification = goalNeedsClarification(projection);
  const stages = sourceStages.map((stage) => stage.id === "goal" && needsGoalClarification
    ? { ...stage, status: "Требует уточнения", icon: "!", tone: "returned" as const }
    : stage);
  const currentStage = needsGoalClarification
    ? "goal"
    : pipeline?.currentStage ?? projection.journey.currentStage;
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
          disabled={!stageViewAvailable(projection, stage.id)}
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

type GoalCriterionValues = {
  targetCount: number | null;
  targetValue?: number;
  comparison?: GoalComparison;
  metric?: GoalMetricDefinition;
  deadline: string;
  totalBudgetRub?: number | null;
};

function goalCriterionValues(projection: CurrentOwnerProjection): GoalCriterionValues {
  const currentGoal = projection.pipeline?.goalFormation.status === "VERIFIED"
    ? projection.pipeline.goalFormation
    : null;
  return currentGoal?.successCriterion ?? { targetCount: 0, deadline: "", totalBudgetRub: null };
}

function goalSuccessCriterion(qualifiedAction: string, values: GoalCriterionValues) {
  const formattedDeadline = values.deadline
    ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${values.deadline}T00:00:00Z`))
    : "";
  const formattedCost = (values.totalBudgetRub ?? 0) > 0
    ? `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(values.totalBudgetRub ?? 0)} ₽`
    : "";
  if (values.metric && values.targetValue !== undefined && formattedDeadline && formattedCost) return `${values.comparison === "AT_MOST" ? "Не более" : "Не менее"} ${formatGoalMetricTarget(values.targetValue, values.metric)} до ${formattedDeadline} при общем бюджете не более ${formattedCost}`;
  const resultName = /заяв/iu.test(qualifiedAction)
    ? "квалифицированных заявок"
    : /обращ/iu.test(qualifiedAction) ? "квалифицированных обращений" : "квалифицированных результатов";
  if ((values.targetCount ?? 0) > 0 && formattedDeadline && formattedCost) {
    return `${values.targetCount} ${resultName} до ${formattedDeadline} при общем бюджете не более ${formattedCost}`;
  }
  const missing = [
    (values.targetCount ?? 0) > 0 ? null : "целевое количество",
    formattedDeadline ? null : "срок",
    formattedCost ? null : "общий бюджет",
  ].filter(Boolean);
  return `Нужно уточнить: ${missing.join(", ")}`;
}

function GoalStageSummary({
  projection,
  busy,
  onCorrect,
}: {
  projection: CurrentOwnerProjection;
  busy: boolean;
  onCorrect: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
}) {
  const currentGoal = projection.pipeline?.goalFormation.status === "VERIFIED"
    ? projection.pipeline.goalFormation
    : null;
  const criterion = goalCriterionValues(projection);
  const criterionComplete = currentGoal?.criterionComplete === true && (criterion.totalBudgetRub ?? 0) > 0;
  const [editing, setEditing] = useState(!currentGoal || !criterionComplete);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const qualifiedResult = projection.businessModel?.fields.find((field) => field.label === "Квалифицированный результат");
  const desiredOutcome = currentGoal?.desiredOutcome ?? projection.campaignGoal ?? "";
  const savedQualifiedAction = currentGoal?.qualifiedAction ?? qualifiedResult?.value ?? projection.businessOutcome.headline;
  const [qualifiedAction, setQualifiedAction] = useState(savedQualifiedAction);
  const [metric, setMetric] = useState<GoalMetricDefinition | null>(criterion.metric ?? null);
  const [comparison, setComparison] = useState<GoalComparison>(criterion.comparison ?? "AT_LEAST");
  const [targetValue, setTargetValue] = useState(String(criterion.targetValue ?? criterion.targetCount ?? ""));
  const successCriterion = goalSuccessCriterion(savedQualifiedAction, criterion);
  const canCorrect = projection.pipeline?.editingLocked !== true;

  function resetMeasurement() {
    setMetric(criterion.metric ?? null); setComparison(criterion.comparison ?? "AT_LEAST");
    setTargetValue(String(criterion.targetValue ?? criterion.targetCount ?? "")); setQualifiedAction(savedQualifiedAction);
  }
  function changeMetric(next: GoalMetricDefinition | null) {
    if ((next?.family ?? "COUNT") !== (metric?.family ?? "COUNT") || (next?.outcome_type ?? "QUALIFIED_REQUEST") !== (metric?.outcome_type ?? "QUALIFIED_REQUEST")) {
      setTargetValue(""); setQualifiedAction(""); setComparison("AT_LEAST");
    }
    setMetric(next);
  }

  function clearFieldError(name: string) {
    setFieldErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  function showInvalidField(event: FormEvent<HTMLFormElement>) {
    const field = event.target as HTMLInputElement | HTMLTextAreaElement;
    if (!field.name) return;
    const details = field.closest("details"); if (details) details.open = true;
    const message = field.validity.customError ? field.validationMessage
      : field.validity.valueMissing ? "Заполните поле."
        : field.type === "number" ? field.name === "target_value" && metric?.family === "RATIO" ? "Укажите долю от 0 до 100%." : field.name === "target_value" && metric?.family === "SUM" ? "Укажите сумму в рублях, не более двух знаков после запятой." : "Укажите положительное целое число."
          : field.type === "date" ? "Укажите существующую дату." : "Проверьте значение.";
    setFieldErrors((current) => ({ ...current, [field.name]: message }));
  }

  async function saveGoal(event: FormEvent<HTMLFormElement>) {
    if (!canCorrect || busy) { event.preventDefault(); return; }
    const form = event.currentTarget;
    for (const [name, label] of [["desired_outcome", "Бизнес-цель"], ["qualified_action", "Квалифицированный результат"], ["customer_geography", "География клиентов"]]) {
      const field = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
      if (!field) continue;
      try {
        if (name === "customer_geography") normalizeGoalGeography(field.value);
        else normalizeGoalText(field.value, label);
        field.setCustomValidity("");
      } catch (error) { field.setCustomValidity((error as Error).message); }
    }
    if (!form.reportValidity()) { event.preventDefault(); return; }
    if (await onCorrect(event)) { setFieldErrors({}); setEditing(false); }
  }

  return <section className="owner-stage-summary owner-goal-summary" aria-label="Цель рекламной кампании" data-complete={criterionComplete}>
    {canCorrect && !editing && <header className="owner-goal-summary-header">
      <button type="button" onClick={() => { resetMeasurement(); setEditing(true); }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z" /></svg>Редактировать</button>
    </header>}
    {!editing || !canCorrect ? <div className="owner-goal-cards">
      <div className="owner-goal-intent">
        <article className="owner-goal-card owner-goal-purpose"><header><h2>Бизнес-цель</h2></header><p>{desiredOutcome}</p></article>
        <article className="owner-goal-card owner-goal-geography"><header><h2>География клиентов</h2></header><p>{currentGoal?.customerGeography || "Не указана"}</p></article>
      </div>
      <article className="owner-goal-card owner-goal-result"><header><h2>{criterion.metric && criterion.metric.outcome_type !== "QUALIFIED_REQUEST" ? "Засчитываемый результат" : "Квалифицированный результат"}</h2></header><p>{savedQualifiedAction}</p>{criterion.metric && <details className="owner-goal-measurement-rules"><summary>{GOAL_METRIC_LABELS[criterion.metric.outcome_type]} · правило учёта</summary><p>{criterion.metric.eligibility_rule}</p><p>{criterion.metric.deduplication_rule}</p><p>{criterion.metric.reversal_rule}</p><p>{criterion.metric.measurement_definition}</p>{criterion.metric.denominator_definition && <p>Знаменатель: {criterion.metric.denominator_definition}. Минимальный объём: {criterion.metric.minimum_denominator}.</p>}</details>}</article>
      <article className="owner-goal-card owner-goal-criterion" data-complete={criterionComplete}>
        <header><h2>Критерий успеха</h2></header>
        {criterionComplete ? <dl className="owner-goal-metrics" aria-label={successCriterion}>
          <div><dt>{criterion.metric?.family === "SUM" ? "Целевая сумма" : criterion.metric?.family === "RATIO" ? "Целевая доля" : "Количество результатов"}</dt><dd>{criterion.metric ? formatGoalMetricTarget(criterion.targetValue ?? 0, criterion.metric) : new Intl.NumberFormat("ru-RU").format(criterion.targetCount ?? 0)}{criterion.comparison === "AT_MOST" && <small>Не более</small>}</dd></div>
          <div><dt>Получить до</dt><dd><time dateTime={criterion.deadline}>{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${criterion.deadline}T00:00:00Z`)).replace(/ г\.$/u, "")}</time></dd></div>
          <div><dt>Бюджет</dt><dd>{new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(criterion.totalBudgetRub ?? 0)} <span>₽</span></dd></div>
        </dl> : <p>{successCriterion}</p>}
      </article>
    </div> : <form className="owner-goal-editor" onSubmit={saveGoal} onInvalid={showInvalidField} onInput={(event) => {
      const field = event.target as HTMLInputElement | HTMLTextAreaElement;
      if (field.name) { field.setCustomValidity(""); clearFieldError(field.name); }
    }}>
      <GoalMetricFields value={metric} comparison={comparison} countedEvent={qualifiedAction} disabled={busy} onChange={changeMetric} onComparisonChange={setComparison} />
      <div className="owner-goal-editor-copy">
        <label><span id="goal-label-desired_outcome">Бизнес-цель</span><textarea aria-labelledby="goal-label-desired_outcome" name="desired_outcome" defaultValue={desiredOutcome} required maxLength={1000} aria-invalid={Boolean(fieldErrors.desired_outcome)} aria-describedby={fieldErrors.desired_outcome ? "goal-error-desired_outcome" : undefined} />{fieldErrors.desired_outcome && <small id="goal-error-desired_outcome" className="owner-goal-field-error" role="alert">{fieldErrors.desired_outcome}</small>}</label>
        <label><span id="goal-label-qualified_action">{metric && metric.outcome_type !== "QUALIFIED_REQUEST" ? "Засчитываемый результат" : "Квалифицированный результат"}</span><textarea aria-labelledby="goal-label-qualified_action" name="qualified_action" value={qualifiedAction} onChange={event => setQualifiedAction(event.target.value)} required maxLength={1000} aria-invalid={Boolean(fieldErrors.qualified_action)} aria-describedby={fieldErrors.qualified_action ? "goal-error-qualified_action" : undefined} />{fieldErrors.qualified_action && <small id="goal-error-qualified_action" className="owner-goal-field-error" role="alert">{fieldErrors.qualified_action}</small>}</label>
        <GeographyAutocomplete defaultValue={currentGoal?.customerGeography ?? ""} disabled={busy} validationError={fieldErrors.customer_geography} onValueChange={() => clearFieldError("customer_geography")} />
      </div>
      <fieldset>
        <legend>Критерий успеха</legend>
        <div>
          <label><span id="goal-label-target_count">{metric?.family === "SUM" ? "Целевая сумма, ₽" : metric?.family === "RATIO" ? "Целевая доля, %" : "Целевое количество"}</span><input aria-labelledby="goal-label-target_count" name={metric ? "target_value" : "target_count"} type="number" min={metric && metric.family !== "COUNT" ? 0 : 1} max={metric?.family === "RATIO" ? 100 : metric?.family === "SUM" ? Number.MAX_SAFE_INTEGER / 100 : Number.MAX_SAFE_INTEGER} step={metric && metric.family !== "COUNT" ? "0.01" : "1"} value={targetValue} onChange={event => setTargetValue(event.target.value)} required aria-invalid={Boolean(fieldErrors.target_value || fieldErrors.target_count)} aria-describedby={fieldErrors.target_value || fieldErrors.target_count ? "goal-error-target_count" : undefined} />{(fieldErrors.target_value || fieldErrors.target_count) && <small id="goal-error-target_count" className="owner-goal-field-error" role="alert">{fieldErrors.target_value || fieldErrors.target_count}</small>}</label>
          <label><span id="goal-label-deadline">Получить результат до</span><input aria-labelledby="goal-label-deadline" name="deadline" type="date" defaultValue={criterion.deadline} required aria-invalid={Boolean(fieldErrors.deadline)} aria-describedby={fieldErrors.deadline ? "goal-error-deadline" : undefined} />{fieldErrors.deadline && <small id="goal-error-deadline" className="owner-goal-field-error" role="alert">{fieldErrors.deadline}</small>}</label>
          <label><span id="goal-label-total_budget_rub">Общий бюджет, ₽</span><input aria-labelledby="goal-label-total_budget_rub" name="total_budget_rub" type="number" min="1" max={Number.MAX_SAFE_INTEGER} step="1" defaultValue={criterion.totalBudgetRub || ""} required aria-invalid={Boolean(fieldErrors.total_budget_rub)} aria-describedby={fieldErrors.total_budget_rub ? "goal-error-total_budget_rub" : undefined} />{fieldErrors.total_budget_rub && <small id="goal-error-total_budget_rub" className="owner-goal-field-error" role="alert">{fieldErrors.total_budget_rub}</small>}</label>
        </div>
      </fieldset>
      <footer>{currentGoal && <button type="button" disabled={busy} onClick={() => { setFieldErrors({}); resetMeasurement(); setEditing(false); }}>Отменить</button>}<button type="submit" disabled={busy}>{busy ? "Сохраняю…" : "Сохранить цель"}</button></footer>
    </form>}
  </section>;
}

function Header() {
  return <header className={styles.topbar}>
    <Link className={styles.brand} href="/" aria-label="MOX-ADV — на главную"><b>M</b><span>MOX-ADV</span></Link>
    <nav aria-label="Основная навигация">
      <Link className={styles.activeNav} href="/" aria-current="page">Стратегия</Link>
      <span>Управление<i>В РАЗРАБОТКЕ</i></span>
      <span>Мониторинг<i>В РАЗРАБОТКЕ</i></span>
      <span>Поиск<i>В РАЗРАБОТКЕ</i></span>
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
