"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { OwnerJourneyProjection } from "../lib/p0-owner-journey";
import type { CurrentPipelineOwnerResult } from "../lib/pipeline-current-contract";
import { localizedText, ownerValue } from "./ui-copy.ts";
import styles from "./strategy-brief.module.css";
import { FormationStrategyView } from "./CampaignFormation.tsx";
import { isWordstatEmptyResultNote } from "../lib/wordstat-presentation.ts";
import { businessSourceUrl, businessText } from "../lib/owner-business-copy.ts";

const narrative = (value: string) => businessText(localizedText(value));

type CampaignStrategy = NonNullable<OwnerJourneyProjection["campaignStrategy"]>;

type StrategyBriefProps = {
  strategy: CampaignStrategy | null;
  currentResult?: CurrentPipelineOwnerResult;
  businessModel: OwnerJourneyProjection["businessModel"];
  demandResearch: OwnerJourneyProjection["demandCostResearch"];
  competitorMatrix: OwnerJourneyProjection["competitorMatrix"];
  materialUnknowns: string[];
  active: boolean;
  busy: boolean;
  correctionAvailable?: boolean;
  onCorrect: (event: FormEvent<HTMLFormElement>) => Promise<void>;
};

type StrategyField = {
  id: string;
  label: string;
  value: string;
  rationale: string;
  rawValue: unknown;
};

const STRATEGY_LABELS: Record<string, string> = {
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

function meaningful(value: unknown) {
  const text = String(value ?? "").trim();
  return text && !/^(?:не подтверждено|не указано|недоступно|период не указан|—)$/iu.test(text);
}

function formatStrategyValue(id: string, value: unknown) {
  if (["weekly_budget", "target_result_cost"].includes(id)) {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? `${amount.toLocaleString("ru-RU")} ₽` : "Не подтверждено";
  }
  if (id === "period" && value && typeof value === "object" && !Array.isArray(value)) {
    const period = value as Record<string, unknown>;
    const dates = [period.start_date ?? period.start, period.end_date ?? period.end]
      .filter((date): date is string => typeof date === "string" && date.trim().length > 0);
    if (dates.length) return dates.join(" — ");
  }
  return ownerValue(value);
}

function displayedStrategyField(field: StrategyField) {
  if (["weekly_budget", "target_result_cost"].includes(field.id)) return field.value;
  if (field.id === "landing_page") return businessSourceUrl(field.value) ? field.value : "Страница предложения не подтверждена";
  return businessText(field.value) || "Описание не уточнено";
}

function statusTone(value: string): "ready" | "limited" | "blocked" {
  if (/блок|нельзя|ошиб|конфликт/iu.test(value)) return "blocked";
  if (/принят|готов|можно|пройден/iu.test(value)) return "ready";
  return "limited";
}

// Short excerpts are presentation only; the complete saved value stays available inline.
function CompactValue({ value, limit = 120 }: { value: string; limit?: number }) {
  if (value.length <= limit) return <p className={styles.value}>{value}</p>;
  const firstSentence = value.match(/^.+?[.!?](?=\s|$)/u)?.[0];
  const excerpt = firstSentence && firstSentence.length <= limit
    ? firstSentence
    : `${value.slice(0, limit).replace(/\s+\S*$/u, "")}…`;
  return <details className={styles.compactValue}>
    <summary><span className={styles.excerpt}>{excerpt}</span><span className={styles.expandLabel}>Полностью</span><span className={styles.collapseLabel}>Свернуть</span></summary>
    <p className={styles.value}>{value}</p>
  </details>;
}

function StrategyEditor({ fields, canCorrect, active, busy, onCorrect, onClose }: {
  fields: StrategyField[];
  canCorrect: boolean;
  active: boolean;
  busy: boolean;
  onCorrect: StrategyBriefProps["onCorrect"];
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const raw = (id: string) => String(fields.find((field) => field.id === id)?.rawValue ?? "");

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return <dialog ref={dialogRef} className={styles.editor} aria-labelledby="strategy-editor-title" onCancel={onClose}>
    <div className={styles.editorContent}>
      <header><h2 id="strategy-editor-title">Изменить стратегию</h2><button type="button" onClick={onClose} aria-label="Закрыть редактирование стратегии">×</button></header>
      <p className={styles.note}>После сохранения стратегия и связанные кампании пройдут повторную проверку.</p>
      {canCorrect ? <form className={styles.correctionForm} onSubmit={onCorrect}>
        <label><span>География</span><input name="geography" required defaultValue={raw("geography")} /></label>
        <label><span>Недельный бюджет, ₽</span><input name="weekly_budget" type="number" min="1" required defaultValue={raw("weekly_budget")} /></label>
        <label><span>Целевая стоимость результата, ₽</span><input name="target_result_cost" type="number" min="0" defaultValue={raw("target_result_cost")} /></label>
        <label className={styles.wideField}><span>Основное сообщение</span><textarea name="core_message" required defaultValue={raw("core_message")} /></label>
        <button type="submit" disabled={busy || active}>{busy ? "Перепроверяю…" : "Сохранить и перепроверить"}</button>
      </form> : <p className={styles.note}>Редактирование станет доступно, когда будет сформирована стратегия.</p>}
    </div>
  </dialog>;
}

export default function StrategyBrief({
  strategy,
  currentResult,
  businessModel,
  demandResearch,
  competitorMatrix,
  materialUnknowns,
  active,
  busy,
  onCorrect,
  correctionAvailable = true,
}: StrategyBriefProps) {
  const [editing, setEditing] = useState(false);
  const currentStrategy = currentResult?.products?.strategy ?? null;
  const review = strategy?.ownerReview ?? null;

  const fields = useMemo<StrategyField[]>(() => {
    const currentById = new Map((currentStrategy?.dimensions ?? []).map((dimension) => [dimension.id, dimension]));
    const reviewByLabel = new Map((review?.decisions ?? []).map((decision) => [decision.label, decision]));
    return Object.entries(STRATEGY_LABELS).map(([id, label]) => {
      const current = currentById.get(id);
      const decision = reviewByLabel.get(label);
      const rawValue = current?.value ?? decision?.value ?? "";
      return {
        id,
        label,
        rawValue,
        value: formatStrategyValue(id, rawValue),
        rationale: businessText(current?.rationale ?? decision?.evidence ?? "Основание пока не показано"),
      };
    });
  }, [currentStrategy, review]);

  const byId = new Map(fields.map((field) => [field.id, field]));
  const value = (id: string) => {
    const field = byId.get(id);
    return field && meaningful(field.value) ? displayedStrategyField(field) : "Не подтверждено";
  };
  const missingFieldCount = fields.filter((field) => !meaningful(field.value)).length;
  const currentCompetitors = currentResult?.products?.evidence?.competitorAnalysis;
  const unclassifiedCompetitorCount = currentCompetitors?.competitors.filter((item) => item.competitiveRelation === null).length ?? 0;
  const acceptedByAgent = /ACCEPT|VALID/iu.test(currentStrategy?.status ?? "") || review?.status === "Принята Strategy Agent" || review?.status === "Подтверждена";
  const strategyAccepted = acceptedByAgent && missingFieldCount === 0;
  const needsDecision = Boolean(strategy?.decisionGate || strategy?.materialQuestions.length);
  const hasGaps = missingFieldCount > 0 || unclassifiedCompetitorCount > 0 || materialUnknowns.some(item => !isWordstatEmptyResultNote(item)) || Boolean(demandResearch?.demand.gaps.some(item => !isWordstatEmptyResultNote(item))) || Boolean(businessModel?.materialQuestions.length);
  const strategyStatus = needsDecision ? "Нужно решение" : strategyAccepted ? "Принята" : active ? "Codex уточняет" : "Требует проверки";
  const campaignPairsExist = Boolean(currentResult?.products?.campaignPairs.length);
  const preflightGates = campaignPairsExist ? currentResult?.preflight.preflightGates ?? [] : [];
  const launchBlocked = campaignPairsExist && currentResult?.preflight.status !== "PASS";
  const launchConstraints = [...new Set(preflightGates.filter(item => item.status !== "Пройдено").map(item =>
    /полного графа|публикация.{0,30}профиля|LOCAL_PROFILE_WRITE_UNIMPLEMENTED/iu.test(item.explanation)
      ? "Размещение этих кампаний пока недоступно."
      : narrative(item.explanation),
  ).filter(Boolean))];
  const canCorrect = Boolean(currentStrategy && currentResult?.stateRevision !== null);
  const limitations = [...new Set([
    ...(review?.limitations ?? []),
    ...materialUnknowns,
    ...(demandResearch?.demand.gaps ?? []),
    ...(businessModel?.materialQuestions.map((item) => [item.question, item.consequence].filter(Boolean).join(" ")) ?? []),
    ...fields.filter((field) => !meaningful(field.value)).map((field) => `${field.label}: не подтверждено`),
  ])].filter(item => !isWordstatEmptyResultNote(item)).map(item => narrative(item)).filter(Boolean);
  const competitorStatus = competitorMatrix?.status
    ?? (currentCompetitors?.competitorStatus === "AVAILABLE" ? "Классифицировано" : currentCompetitors?.competitorStatus === "PARTIAL" ? "Частично классифицировано" : "Не классифицирована");
  const businessDetails = businessModel?.fields.filter((field) => ["Контекст покупки", "Цикл продажи", "Мощность"].includes(field.label)) ?? [];
  const evidenceFields = fields.filter((field) => meaningful(field.rationale) && field.rationale !== "Основание пока не показано");
  const formationPlan = currentStrategy?.formationPlan;
  const formationResearch = currentResult?.products?.evidence?.formationResearch;
  const overviewFieldIds = new Set(["advertised_offer", "target_audience", "geography", "period", "campaign_focus", ...(formationPlan ? [] : ["weekly_budget", "target_result_cost"])]);
  const detailFields = fields.filter((field) => !overviewFieldIds.has(field.id));
  const overviewEvidence = evidenceFields.filter((field) => overviewFieldIds.has(field.id));
  const hasChecks = limitations.length > 0 || hasGaps || launchBlocked || launchConstraints.length > 0 || Boolean(strategy?.recommendations.length) || Boolean(demandResearch || competitorMatrix || currentCompetitors);
  const landing = value("landing_page");
  const landingUrl = /^https?:\/\//iu.test(landing) ? landing : null;

  if (formationPlan && formationResearch) {
    const archive = <div className={styles.formationArchive}>
      <section><h3>Предложение и условия</h3>
        <dl className={styles.fullFields}>{fields.map((field) => <div key={field.id}><dt>{field.label}</dt><dd>
          <p className={styles.value}>{displayedStrategyField(field)}</p>
          <p className={styles.fieldRationale}>{narrative(field.rationale)}</p>
        </dd></div>)}</dl>
      </section>
      {businessDetails.length > 0 && <section><h3>Условия продаж</h3><dl className={styles.fullFields}>{businessDetails.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{narrative(field.value)}</dd></div>)}</dl></section>}
      {limitations.length > 0 && <section><h3>Что не подтверждено</h3><ul>{limitations.map((item) => <li key={item}>{narrative(item)}</li>)}</ul></section>}
      {demandResearch && <section><h3>Спрос · {demandResearch.demand.status}</h3><p>{narrative(demandResearch.demand.coverage)}</p><p>{narrative(demandResearch.demand.limitation)}</p></section>}
      {(competitorMatrix || currentCompetitors) && <section><h3>Конкуренты · {narrative(competitorStatus)}</h3><p>Наблюдения конкурентов не подтверждают эффективность их рекламы.</p>{unclassifiedCompetitorCount > 0 && <p>Роль части компаний пока не установлена.</p>}</section>}
      {Boolean(strategy?.recommendations.length) && <section><h3>Рекомендации</h3>{strategy?.recommendations.map((item) => <article key={item.label}><h4>{narrative(item.label)}</h4><strong>{narrative(item.value)}</strong><p>{narrative(item.rationale)}</p></article>)}</section>}
      {launchConstraints.length > 0 && <section id="strategy-saved-checks"><h3>Что нужно для размещения</h3><ul>{launchConstraints.map(item => <li key={item}>{item}</li>)}</ul></section>}
    </div>;
    const notice = <>
      {needsDecision && <section className={styles.decisionGate} aria-label="Нужно ваше решение"><strong>Нужно ваше решение</strong>
        {strategy?.decisionGate ? <><p>{narrative(strategy.decisionGate.recommendation)}</p><p>{narrative(strategy.decisionGate.consequences)}</p></> : <ul>{strategy?.materialQuestions.map((item) => <li key={item.field}>{narrative(item.question)}</li>)}</ul>}
      </section>}
      {launchBlocked && <p className={styles.launchNotice}>Размещение пока недоступно.</p>}
    </>;
    return <section className={styles.formationBrief} aria-label="Стратегия рекламы" data-strategy-status={statusTone(strategyStatus)}>
      {correctionAvailable && <div className={styles.editAction}><button type="button" onClick={() => setEditing(true)} disabled={busy || (active && !currentStrategy)}>Изменить стратегию</button></div>}
      <FormationStrategyView plan={formationPlan} research={formationResearch} archive={archive} notice={notice} sourceFacts={currentResult?.products?.evidence?.sourceFacts} materials={currentResult?.products?.evidence?.researchMaterials} />
      {editing && <StrategyEditor fields={fields} canCorrect={canCorrect} active={active} busy={busy} onCorrect={onCorrect} onClose={() => setEditing(false)} />}
    </section>;
  }

  return <section className={styles.brief} aria-labelledby="strategy-brief-title" data-strategy-status={statusTone(strategyStatus)}>
    <header className={styles.header}>
      <div><h2 id="strategy-brief-title">Стратегия рекламы</h2><span className={styles.status} data-state={statusTone(strategyStatus)}>{strategyStatus}</span></div>
      {correctionAvailable && <button type="button" onClick={() => setEditing(true)} disabled={busy || (active && !currentStrategy)}>Изменить</button>}
    </header>

    {needsDecision && <section className={styles.decisionGate} aria-label="Нужно ваше решение">
      <strong>Нужно ваше решение</strong>
      {strategy?.decisionGate ? <><p>{narrative(strategy.decisionGate.recommendation)}</p><p>{narrative(strategy.decisionGate.consequences)}</p></> : <ul>{strategy?.materialQuestions.map((item) => <li key={item.field}>{narrative(item.question)}</li>)}</ul>}
    </section>}

    <dl className={styles.summary} aria-label="Главное о стратегии">
      <div><dt>Что рекламируем</dt><dd><CompactValue value={value("advertised_offer")} />{landingUrl && <a className={styles.landing} href={landingUrl} target="_blank" rel="noreferrer">Открыть сайт ↗</a>}</dd></div>
      <div><dt>Кому</dt><dd><CompactValue value={value("target_audience")} /></dd></div>
      <div><dt>Как привлекаем</dt><dd><CompactValue value={value("campaign_focus")} /></dd></div>
    </dl>

    <dl className={styles.boundaries} aria-label="Условия продвижения">
      {[
        ["География", value("geography")],
        ["Период", value("period")],
        ...(formationPlan
          ? [["Бюджет", `${formationPlan.budget.total_cap_rub.toLocaleString("ru-RU")} ₽`]]
          : [["Бюджет в неделю", value("weekly_budget")], ["Предельная цена результата", value("target_result_cost")]]),
      ].map(([label, fieldValue]) => <div key={label}><dt>{label}</dt><dd><CompactValue value={fieldValue} limit={75} /></dd></div>)}
    </dl>

    <div className={styles.details}>
      <details className={styles.disclosure}>
        <summary><span>Параметры и основания</span></summary>
        <div className={styles.detailBody}>
          <dl className={styles.fullFields}>{detailFields.map((field) => <div key={field.id}><dt>{field.label}</dt><dd><CompactValue value={displayedStrategyField(field)} limit={180} />{evidenceFields.includes(field) && <p className={styles.fieldRationale}>{narrative(field.rationale)}</p>}</dd></div>)}</dl>
          {overviewEvidence.length > 0 && <section className={styles.research}><h3>Основания краткой стратегии</h3><dl className={styles.fullFields}>{overviewEvidence.map((field) => <div key={field.id}><dt>{field.label}</dt><dd>{narrative(field.rationale)}</dd></div>)}</dl></section>}
          {businessDetails.length > 0 && <section className={styles.research}><h3>Условия продаж</h3><dl className={styles.fullFields}>{businessDetails.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{narrative(field.value)}</dd></div>)}</dl></section>}
        </div>
      </details>

      {hasChecks && <details className={styles.disclosure}>
        <summary><span>Ограничения</span>{launchBlocked ? <small className={styles.launchStatus} data-state="blocked">Размещение пока недоступно</small> : (hasGaps || limitations.length > 0) && <small>Есть пробелы в данных</small>}</summary>
        <div className={styles.detailBody}>
          {limitations.length > 0 && <section className={styles.limitations}><h3>Что не подтверждено</h3><ul>{limitations.map((item) => <li key={item}>{narrative(item)}</li>)}</ul></section>}
          {demandResearch && <details className={styles.research}><summary>Спрос · {demandResearch.demand.status}</summary><p>{narrative(demandResearch.demand.coverage)}</p><p>{narrative(demandResearch.demand.limitation)}</p></details>}
          {(competitorMatrix || currentCompetitors) && <details className={styles.research}><summary>Конкуренты · {narrative(competitorStatus)}</summary><p>Наблюдения конкурентов не подтверждают эффективность их рекламы.</p>{unclassifiedCompetitorCount > 0 && <p>Роль части компаний пока не установлена.</p>}</details>}
          {strategy?.recommendations.length ? <div className={styles.recommendations}>{strategy.recommendations.map((item) => <article key={item.label}><h3>{narrative(item.label)}</h3><strong>{narrative(item.value)}</strong><p>{narrative(item.rationale)}</p></article>)}</div> : null}
          {launchConstraints.length > 0 && <section><h3>Что нужно для размещения</h3><ul>{launchConstraints.map(item => <li key={item}>{item}</li>)}</ul></section>}
        </div>
      </details>}
    </div>

    {editing && <StrategyEditor fields={fields} canCorrect={canCorrect} active={active} busy={busy} onCorrect={onCorrect} onClose={() => setEditing(false)} />}
  </section>;
}
