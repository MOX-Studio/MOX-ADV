"use client";

import { useEffect, useState } from "react";
import type { OwnerPipelineProjection } from "../lib/pipeline-owner-dashboard.ts";
import type { PipelineStageTask } from "../lib/pipeline-stage-tools.ts";
import styles from "./single-codex-workspace.module.css";
import { codexExecutionLabel } from "../lib/codex-dispatch.ts";
import { FormationPortfolioView } from "./CampaignFormation.tsx";
import { businessError, businessText } from "../lib/owner-business-copy.ts";

export default function SingleCodexWorkspace({ pipeline, busy, onAction, ownerView = false, operatorView = false, hideSavedCampaigns = false, stopping = false, onStop }: {
  pipeline: OwnerPipelineProjection;
  busy: boolean;
  ownerView?: boolean;
  operatorView?: boolean;
  hideSavedCampaigns?: boolean;
  stopping?: boolean;
  onStop?: () => void;
  onAction: (action: string, values: Record<string, unknown>) => Promise<PipelineStageTask | null>;
}) {
  const [session] = useState(() => {
    if (typeof window === "undefined") return "";
    const key = "mox-single-codex-session";
    const id = sessionStorage.getItem(key) || crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
  });
  const [task, setTask] = useState<PipelineStageTask | null>(null);
  const [testScenario, setTestScenario] = useState(false);
  const [researchReason, setResearchReason] = useState("");
  const [wordstatQueries, setWordstatQueries] = useState("");
  const [wordstatRegionId, setWordstatRegionId] = useState("225");
  const [wordstatRegionName, setWordstatRegionName] = useState("Россия");
  const [wordstatSimilar, setWordstatSimilar] = useState(true);
  const [result, setResult] = useState("");
  const [fileError, setFileError] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  useEffect(() => () => { if (downloadUrl) URL.revokeObjectURL(downloadUrl); }, [downloadUrl]);
  const workspace = pipeline.singleCodex;
  if (!workspace) return null;
  const mine = Boolean(session && workspace.sessionId === session);
  const active = pipeline.active || workspace.phase === "COMMITTING";
  const phase = workspace.phase;
  const ready = active && phase === "READY";
  const collection = workspace.stage === "EVIDENCE_COLLECTION";
  const controls = { session_id: session, workspace_revision: workspace.revision };
  const act = async (action: string, values: Record<string, unknown> = {}) => {
    setFileError("");
    const nextTask = await onAction(action, { ...controls, ...values });
    if (nextTask) {
      setTask(nextTask);
      setDownloadUrl(URL.createObjectURL(new Blob([JSON.stringify(nextTask, null, 2)], { type: "application/json" })));
    }
    else if (action !== "GET_STAGE_TASK") setTask(null);
    return nextTask;
  };
  const start = () => act("START", { test_scenario: testScenario });
  const reuse = pipeline.evidenceReuse;
  const loadFile = async (file: File | undefined, snapshot = false) => {
    if (!file) return;
    try {
      const content = await file.text();
      const parsed: unknown = JSON.parse(content);
      if (snapshot) {
        const currentTask = await act("GET_STAGE_TASK");
        if (currentTask) await act("IMPORT_EVIDENCE", { input_digest: currentTask.input_digest, snapshot: parsed });
      } else { setResult(content); setFileError(""); }
    } catch { setFileError("Файл должен содержать корректный JSON."); }
  };
  const submit = async () => {
    try {
      const value: unknown = JSON.parse(result);
      await act("SUBMIT_STAGE_RESULT", { result: value });
    } catch { setFileError("Результат должен содержать корректный JSON."); }
  };
  const stage = pipeline.stages.find(item => item.pipelineStageId === workspace.stage)?.label ?? "Подготовка";
  const status = phase === "COLLECTING" ? "Сбор источников выполняется"
    : phase === "COMMITTING" ? "Осталось завершить сохранение результата"
      : active ? `${stage} · ${codexExecutionLabel(workspace).toLocaleLowerCase("ru-RU")}`
        : "";
  const primaryStart = ownerView && phase !== "COMPLETED";
  const startButtons = <>
    <button type="button" disabled={busy || !session || !pipeline.canStart} onClick={start}>{testScenario ? "Начать тестовый прогон" : "Начать подготовку"}</button>
    {reuse?.available && <button type="button" disabled={busy || !session} onClick={() => act("REGENERATE_FROM_EVIDENCE", { expected_state_revision: reuse.expectedStateRevision, reuse_token: reuse.reuseToken, test_scenario: testScenario })}>Продолжить по собранным сведениям</button>}
  </>;
  return <section className={styles.workspace} data-active={active} aria-label={operatorView ? "Управление подготовкой Codex" : "Подготовка рекламы"}>
    {workspace.workingCampaigns && <section aria-label="Сохранённые кампании требуют продолжения" data-goal-readiness={workspace.workingCampaigns.readiness.status}>
      <p role="status"><strong>Подготовка не завершена</strong> · {businessText(workspace.workingCampaigns.readiness.summary)}</p>
      {workspace.workingCampaigns.readiness.missing.length > 0 && <details><summary>Каких данных не хватает</summary><ul>{workspace.workingCampaigns.readiness.missing.map(item => {
        const direction = workspace.workingCampaigns!.bundle.plan.directions.find(d => item.startsWith(`${d.id}:`));
        return <li key={item}>{businessText(direction ? item.replace(direction.id, direction.name) : item)}</li>;
      })}</ul></details>}
      {!hideSavedCampaigns && <details><summary>Сохранённые кампании и объявления</summary><FormationPortfolioView bundle={workspace.workingCampaigns.bundle} sourceFacts={workspace.workingCampaigns.sourceFacts} active={false} /></details>}
    </section>}
    {(active || primaryStart || testScenario) && <header><div>{status && <p role="status">{operatorView ? status : stage}</p>}{(active ? workspace.testScenario : testScenario) && <strong className={styles.testMode}>Тестовый прогон</strong>}</div>
      <div className={styles.actions}>
        {active && phase === "READY" && !workspace.controllerActive && workspace.dispatch?.status !== "QUEUED" && workspace.dispatch?.status !== "PENDING" && <button type="button" disabled={busy} onClick={() => act("DISPATCH_CODEX", { run_id: workspace.runId })}>{workspace.dispatch?.status === "FAILED" ? "Повторить передачу" : "Продолжить подготовку"}</button>}
        {!active && primaryStart && startButtons}
        {operatorView && mine && phase === "COMMITTING" && <button type="button" disabled={busy} onClick={() => act("RESUME_COMMIT")}>Завершить сохранение</button>}
        {onStop && <button className={styles.stop} type="button" disabled={stopping || (busy && phase !== "COLLECTING")} onClick={onStop}>{stopping ? "Останавливаю…" : "Остановить текущий запуск"}</button>}
      </div>
    </header>}
    {!active && (!primaryStart || operatorView) && <details className={styles.options}><summary>{primaryStart ? "Параметры подготовки" : phase === "COMPLETED" ? "Подготовить заново" : "Подготовка"}</summary><div className={styles.actions}>
      {operatorView && <label><input type="checkbox" checked={testScenario} onChange={event => setTestScenario(event.target.checked)} /> Тестовый прогон</label>}
      {!primaryStart && startButtons}
    </div></details>}
    {workspace.dispatch?.error && <p role="alert">{operatorView ? workspace.dispatch.error : "Не удалось продолжить подготовку. Можно повторить попытку."}</p>}
    {phase === "LEGACY" && active && <p>{operatorView ? "Это запуск прежней версии. Остановите его и начните подготовку с Codex; сохранённые результаты останутся в истории." : "Подготовку нужно начать заново. Сохранённые результаты останутся доступны."}</p>}
    {operatorView && active && phase !== "LEGACY" && <details className={styles.materials}>
      <summary>Инструменты агента</summary>
      <div className={styles.actions}>
        <button type="button" disabled={busy || !session || phase === "COLLECTING" || (!mine && workspace.controllerActive)} onClick={() => act("CLAIM_CONTROL")}>{mine ? "Продлить управление" : "Взять управление"}</button>
        {mine && phase !== "COLLECTING" && <button type="button" disabled={busy} onClick={() => act("RELEASE_CONTROL")}>Передать другой сессии</button>}
      </div>
      {ready && mine && <>
      <div className={styles.actions}>
        {collection && workspace.collectionAllowed && <button type="button" disabled={busy} onClick={() => act("COLLECT_EVIDENCE")}>Собрать источники</button>}
        <button type="button" disabled={busy} onClick={() => act("GET_STAGE_TASK")}>Получить материалы этапа</button>
        {collection && workspace.collectionAllowed && <label className={styles.file}>Загрузить срез источников<input type="file" accept=".json,application/json" disabled={busy} onChange={event => loadFile(event.target.files?.[0], true)} /></label>}
      </div>
      {collection && workspace.collectionAllowed && workspace.hasEvidence && <details>
        <summary>Дополнительные запросы Wordstat</summary>
        <label>Запросы, по одному на строку<textarea aria-label="Запросы дополнительного исследования Wordstat" rows={6} value={wordstatQueries} onChange={event => setWordstatQueries(event.target.value)} /></label>
        <label>Регион<input aria-label="Название региона Wordstat" value={wordstatRegionName} onChange={event => setWordstatRegionName(event.target.value)} /></label>
        <label>ID региона<input aria-label="ID региона Wordstat" type="number" min="1" value={wordstatRegionId} onChange={event => setWordstatRegionId(event.target.value)} /></label>
        <label><input type="checkbox" checked={wordstatSimilar} onChange={event => setWordstatSimilar(event.target.checked)} /> Также проверить похожие запросы</label>
        <small>До 20 запросов за проход. Частоты и пустые выдачи сохраняются с датой и регионом.</small>
        <button type="button" disabled={busy || !wordstatQueries.trim()} onClick={() => act("COLLECT_EVIDENCE", { wordstat_research: { queries: wordstatQueries.split(/\r?\n/u).map(q => q.trim()).filter(Boolean), region: { id: Number(wordstatRegionId), name: wordstatRegionName }, similar: wordstatSimilar } })}>Проверить запросы Wordstat</button>
      </details>}
      {task && <div className={styles.task}>
        <label>Материалы и требования к результату<textarea aria-label="Материалы этапа Codex" readOnly value={JSON.stringify(task, null, 2)} rows={9} /></label>
        {downloadUrl && <a href={downloadUrl} download={`codex-${task.stage.toLowerCase()}-${task.run_version}.json`}>Скачать материалы этапа</a>}
      </div>}
      <label className={styles.file}>Загрузить результат Codex<input type="file" accept=".json,application/json" disabled={busy} onChange={event => loadFile(event.target.files?.[0])} /></label>
      <label className={styles.result}>Результат этапа<textarea aria-label="Результат этапа Codex" value={result} onChange={event => setResult(event.target.value)} rows={5} placeholder="Загрузите подготовленный результат или вставьте его содержимое" /></label>
      <button type="button" disabled={busy || !result.trim() || (collection && !workspace.hasEvidence)} onClick={submit}>{busy ? "Проверяю…" : "Проверить и сохранить результат"}</button>
      {!collection && <details><summary>Дополнительное исследование</summary><label>Чего не хватает и на какое решение влияет<textarea aria-label="Причина дополнительного исследования" value={researchReason} onChange={event => setResearchReason(event.target.value)} /></label><button type="button" disabled={busy || researchReason.trim().length < 10} onClick={() => act("REQUEST_RESEARCH", { reason: researchReason })}>Вернуться к исследованию</button></details>}
      </>}
    </details>}
    {workspace.lastError && <div className={styles.error} role="alert"><p>{operatorView ? workspace.lastError.message : businessError(workspace.lastError.message)}</p>{operatorView && workspace.lastError.violations.length > 0 && <details><summary>Замечания к результату</summary><pre>{JSON.stringify(workspace.lastError.violations, null, 2)}</pre></details>}</div>}
    {fileError && <p role="alert">{operatorView ? fileError : "Не удалось выполнить действие. Повторите попытку."}</p>}
  </section>;
}
