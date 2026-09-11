"use client";

// THROWAWAY UI PROTOTYPE.
// Three structurally different Findings views on the existing dashboard route.
// Read-only by design: no prototype control mutates pipeline data.

import type { OwnerJourneyProjection } from "../../../lib/p0-owner-journey.ts";
import PrototypeSwitcher, { type PrototypeVariant } from "../PrototypeSwitcher";
import type { CurrentPipelineOwnerResult } from "../../../lib/pipeline-current-contract.ts";
import { localizedText, ownerDate, ownerFieldLabel } from "../../ui-copy.ts";
import styles from "./findings-prototype.module.css";

export type FindingsPrototypeVariant = "A" | "B" | "C";

type EvidenceProjection = NonNullable<NonNullable<CurrentPipelineOwnerResult["products"]>["evidence"]>;
type EvidenceFact = EvidenceProjection["provenance"]["company"]["facts"][number];
type FindingState = "confirmed" | "assumption" | "missing";

type ReadinessItem = {
  id: string;
  label: string;
  value: string;
  state: FindingState;
  source: string;
  consequence: string;
};

type Blocker = {
  id: string;
  level: "Критично" | "Важно";
  title: string;
  consequence: string;
  action: string;
};

type CapacityEstimate = {
  name: string;
  profit: string;
  range: string;
  pressure: string;
  use: string;
  confidence: string;
  isExample: boolean;
};

type FindingsModel = {
  headline: string;
  summary: string;
  readinessLabel: string;
  readinessCount: number;
  totalCount: number;
  confirmedCount: number;
  assumptionCount: number;
  missingCount: number;
  items: ReadinessItem[];
  blockers: Blocker[];
  market: Array<{ label: string; value: string; detail: string; state: FindingState }>;
  capacities: CapacityEstimate[];
  snapshotDate: string;
  snapshotId: string;
  sourceSummary: string;
  sourceLinks: Array<{ title: string; url: string }>;
};

const VARIANT_NAMES: Record<FindingsPrototypeVariant, string> = {
  A: "Короткое резюме",
  B: "Маршрут готовности",
  C: "Карта уверенности",
};

const FINDINGS_VARIANTS: PrototypeVariant[] = (["A", "B", "C"] as const).map((key) => ({
  key,
  name: VARIANT_NAMES[key],
}));

export function isFindingsPrototypeVariant(value: string | null): value is FindingsPrototypeVariant {
  return value === "A" || value === "B" || value === "C";
}

function compact(value: unknown, fallback = "Нужно уточнить", limit = 170) {
  const normalized = localizedText(String(value ?? "")).replace(/\s+/gu, " ").trim();
  if (!normalized) return fallback;
  return normalized.length > limit ? `${normalized.slice(0, limit - 1).trimEnd()}…` : normalized;
}

function formatRubles(value: number) {
  return `${new Intl.NumberFormat("ru-RU", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)} ₽`;
}

function countLabel(count: number, one: string, few: string, many: string) {
  const modulo100 = count % 100;
  const modulo10 = count % 10;
  const noun = modulo100 >= 11 && modulo100 <= 14
    ? many
    : modulo10 === 1 ? one : modulo10 >= 2 && modulo10 <= 4 ? few : many;
  return `${count} ${noun}`;
}

function factState(fact: EvidenceFact | undefined): FindingState {
  if (!fact) return "missing";
  if (/OWNER_CONFIRMED|TIER_[12]/u.test(`${fact.classification} ${fact.confidence.tier}`)) return "confirmed";
  return "assumption";
}

function factFor(evidence: EvidenceProjection | null, fields: string[]) {
  return evidence?.provenance.company.facts.find((fact) => fields.includes(fact.field));
}

function factSourceLabel(field: string) {
  if (field === "value") return "Ценность предложения";
  if (field === "product") return "Продукт";
  if (field === "audience") return "Аудитория";
  if (field === "qualified_result") return "Целевое действие";
  if (field === "geography") return "География";
  return ownerFieldLabel(field);
}

function integrationState(evidence: EvidenceProjection | null, id: "direct" | "metrika") {
  return evidence?.provenance.integrations.find((integration) => integration.id === id)?.status ?? "UNAVAILABLE";
}

function estimateCapacity(profile: EvidenceProjection["competitorAnalysis"]["financialProfiles"][number]): CapacityEstimate | null {
  if (!profile.netProfitRub || !/^-?\d+$/u.test(profile.netProfitRub)) return null;
  const profit = Number(profile.netProfitRub);
  if (!Number.isFinite(profit)) return null;
  if (profit <= 0) return {
    name: profile.name,
    profit: formatRubles(profit),
    range: "Не оценивается по прибыли",
    pressure: "Неопределённое давление",
    use: "Не считать слабую прибыль доказательством отсутствия рекламы; проверить рекламную активность отдельно.",
    confidence: "Низкая · модель, не факт расходов",
    isExample: false,
  };
  const low = profit * 0.05;
  const high = profit * 0.2;
  const pressure = high >= 10_000_000
    ? "Высокий потенциальный ресурс"
    : high >= 2_000_000 ? "Средний потенциальный ресурс" : "Ограниченный потенциальный ресурс";
  const use = high >= 10_000_000
    ? "Не строить стратегию на перебивании ставок: выигрывать сегментацией, сообщением и конверсией посадочной."
    : "Проверять аукцион узким тестом и не предполагать постоянную ставочную агрессию.";
  return {
    name: profile.name,
    profit: formatRubles(profit),
    range: `${formatRubles(low)}–${formatRubles(high)} в год`,
    pressure,
    use,
    confidence: "Низкая · сценарий 5–20% чистой прибыли",
    isExample: false,
  };
}

function exampleCapacity(): CapacityEstimate {
  const profit = 24_400_000;
  return {
    name: "Как будет работать оценка",
    profit: formatRubles(profit),
    range: `${formatRubles(profit * 0.05)}–${formatRubles(profit * 0.2)} в год`,
    pressure: "Сценарный рекламный ресурс",
    use: "Диапазон помогает оценить риск давления на аукцион и выбрать конкуренцию через сегмент и сообщение, а не только через ставку.",
    confidence: "Иллюстрация · не данные текущего среза",
    isExample: true,
  };
}

function makeReadinessItem(
  id: string,
  label: string,
  value: string,
  state: FindingState,
  source: string,
  consequence: string,
): ReadinessItem {
  return { id, label, value: compact(value), state, source, consequence };
}

function buildFindingsModel(projection: OwnerJourneyProjection, result: CurrentPipelineOwnerResult | null): FindingsModel {
  const evidence = result?.products?.evidence ?? null;
  const goal = projection.pipeline?.goalFormation.status === "VERIFIED" ? projection.pipeline.goalFormation : null;
  const offerFact = factFor(evidence, ["product", "advertised_offer", "offer"]);
  const audienceFact = factFor(evidence, ["audience", "target_audience"]);
  const valueFact = factFor(evidence, ["value", "value_proposition", "core_message"]);
  const resultFact = factFor(evidence, ["qualified_result", "target_action"]);
  const geographyFact = factFor(evidence, ["geography", "regions"]);
  const demand = projection.demandCostResearch?.demand;
  const observedFrequencies = demand?.formulations.filter((item) => item.status === "Частота получена").length ?? 0;
  const formulationCount = demand?.formulations.length ?? 0;
  const competitors = evidence?.competitorAnalysis.competitors ?? [];
  const classifiedCompetitors = competitors.filter((competitor) => competitor.competitiveRelation !== null).length;
  const maxResultCost = goal?.successCriterion?.maxResultCostRub ?? 0;
  const qualifiedResult = goal?.qualifiedAction || resultFact?.value || "";
  const offerValue = offerFact?.value || "";
  const audienceValue = audienceFact?.value || "";
  const valueProposition = valueFact?.value || "";
  const geographyValue = geographyFact?.value || "";
  const metrika = integrationState(evidence, "metrika");

  const items: ReadinessItem[] = [
    makeReadinessItem(
      "offer",
      "Предложение",
      offerValue,
      factState(offerFact),
      offerFact ? factSourceLabel(offerFact.field) : "Нет подтверждённого источника",
      "Без одного точного предложения нельзя собрать однородные группы и объявления.",
    ),
    makeReadinessItem(
      "audience",
      "Аудитория и ЛПР",
      audienceValue,
      factState(audienceFact),
      audienceFact ? factSourceLabel(audienceFact.field) : "Нет подтверждённого источника",
      "Нужны сегмент, инициатор и лицо, принимающее решение, иначе семантика будет слишком широкой.",
    ),
    makeReadinessItem(
      "value",
      "Причина выбрать нас",
      valueProposition,
      factState(valueFact),
      valueFact ? factSourceLabel(valueFact.field) : "Нет подтверждённого источника",
      "Без проверяемого отличия объявления будут повторять общий рыночный язык.",
    ),
    makeReadinessItem(
      "result",
      "Целевое действие",
      qualifiedResult,
      goal?.qualifiedAction ? "confirmed" : factState(resultFact),
      goal?.qualifiedAction ? "Подтверждённая цель" : resultFact ? factSourceLabel(resultFact.field) : "Не определено",
      "Действие станет целью оптимизации и критерием качества кампании.",
    ),
    makeReadinessItem(
      "geography",
      "География и период",
      geographyValue,
      factState(geographyFact),
      geographyFact ? factSourceLabel(geographyFact.field) : "Не определено",
      "От географии и периода зависят спрос, конкуренция, бюджет и расписание показов.",
    ),
    makeReadinessItem(
      "economics",
      "Предел стоимости результата",
      maxResultCost > 0 ? `${new Intl.NumberFormat("ru-RU").format(maxResultCost)} ₽` : "Нужно определить допустимый CPL/CPA",
      maxResultCost > 0 ? "confirmed" : "missing",
      maxResultCost > 0 ? "Критерий бизнес-цели" : "Экономика не подтверждена",
      "Без предела нельзя предложить жизнеспособный бюджет, ставки и условие остановки.",
    ),
    makeReadinessItem(
      "demand",
      "Поисковый спрос",
      observedFrequencies > 0
        ? `${observedFrequencies} из ${formulationCount} формулировок имеют подтверждённую частоту`
        : `${formulationCount || 0} формулировок подготовлено; частота не подтверждена`,
      observedFrequencies > 0 ? "confirmed" : formulationCount > 0 ? "assumption" : "missing",
      demand ? compact(demand.source, "Яндекс Wordstat", 80) : "Wordstat недоступен",
      "Без кластеров реальных намерений нельзя обосновать структуру поисковой кампании.",
    ),
    makeReadinessItem(
      "competition",
      "Конкурентная среда",
      competitors.length
        ? `${countLabel(competitors.length, "предложение", "предложения", "предложений")}; роли определены у ${classifiedCompetitors}`
        : "Сопоставимые предложения не подтверждены",
      classifiedCompetitors > 0 ? "confirmed" : competitors.length > 0 ? "assumption" : "missing",
      competitors.length ? competitors.map((competitor) => competitor.name).join(" · ") : "Нет данных",
      "Подрядчики и заменители не должны ошибочно определять позиционирование как прямые конкуренты.",
    ),
    makeReadinessItem(
      "measurement",
      "Измерение результата",
      metrika === "VERIFIED"
        ? "Цель Метрики связана с текущим срезом"
        : qualifiedResult ? `Событие определено: ${qualifiedResult}; техническая связь не подтверждена` : "Событие и цель Метрики не определены",
      metrika === "VERIFIED" ? "confirmed" : qualifiedResult ? "assumption" : "missing",
      metrika === "VERIFIED" ? "Яндекс Метрика" : "Требуется связать цель Метрики",
      "Стратегия должна заранее зафиксировать измеряемое событие, даже если подключение выполняется позднее.",
    ),
  ];

  const blockerById: Record<string, Omit<Blocker, "id">> = {
    offer: { level: "Критично", title: "Подтвердить одно рекламируемое предложение", consequence: items[0].consequence, action: "Выбрать предложение" },
    audience: { level: "Критично", title: "Уточнить сегмент и лицо, принимающее решение", consequence: items[1].consequence, action: "Описать аудиторию" },
    value: { level: "Важно", title: "Зафиксировать проверяемое отличие", consequence: items[2].consequence, action: "Уточнить ценность" },
    result: { level: "Критично", title: "Определить квалифицированный результат", consequence: items[3].consequence, action: "Выбрать действие" },
    geography: { level: "Важно", title: "Подтвердить географию и период", consequence: items[4].consequence, action: "Указать область" },
    economics: { level: "Критично", title: "Задать допустимую стоимость результата", consequence: items[5].consequence, action: "Указать CPL/CPA" },
    demand: { level: "Важно", title: "Проверить кластеры поискового намерения", consequence: items[6].consequence, action: "Повторить Wordstat" },
    competition: { level: "Важно", title: "Классифицировать роли конкурентов", consequence: items[7].consequence, action: "Проверить роли" },
    measurement: { level: "Важно", title: "Связать действие с целью Метрики", consequence: items[8].consequence, action: "Выбрать цель" },
  };
  const blockers = items
    .filter((item) => item.state !== "confirmed")
    .map((item) => ({ id: item.id, ...blockerById[item.id] }));
  const confirmedCount = items.filter((item) => item.state === "confirmed").length;
  const assumptionCount = items.filter((item) => item.state === "assumption").length;
  const missingCount = items.filter((item) => item.state === "missing").length;
  const readinessCount = confirmedCount;
  const capacities = (evidence?.competitorAnalysis.financialProfiles ?? [])
    .filter((profile) => profile.role !== "COMPANY")
    .map(estimateCapacity)
    .filter((item): item is CapacityEstimate => item !== null);
  if (!capacities.length) capacities.push(exampleCapacity());

  const market = [
    {
      label: "Спрос",
      value: observedFrequencies > 0 ? `${observedFrequencies} частот подтверждено` : "Количественно не подтверждён",
      detail: demand ? compact(demand.conclusion, "Отсутствие данных не означает нулевой спрос.") : "Нужны короткие человеческие формулировки намерений, а не текст посадочной страницы.",
      state: observedFrequencies > 0 ? "confirmed" as const : "assumption" as const,
    },
    {
      label: "Конкуренты",
      value: competitors.length ? `${competitors.length} публичных предложений` : "Набор не собран",
      detail: classifiedCompetitors > 0 ? `Классифицировано: ${classifiedCompetitors}.` : "Роли не определены: подрядчик может быть ошибочно принят за прямого конкурента.",
      state: classifiedCompetitors > 0 ? "confirmed" as const : competitors.length ? "assumption" as const : "missing" as const,
    },
    {
      label: "История Директа",
      value: integrationState(evidence, "direct") === "VERIFIED" ? "История доступна" : "Холодный старт",
      detail: integrationState(evidence, "direct") === "VERIFIED" ? "Можно использовать фактические запросы и результаты." : "Отсутствие доступа не считается отсутствием кампаний или спроса.",
      state: integrationState(evidence, "direct") === "VERIFIED" ? "confirmed" as const : "assumption" as const,
    },
  ];

  const sourceLinks = (evidence?.provenance.sources ?? []).flatMap((source) => source.sourceUrls.slice(0, 1).map((url) => ({
    title: compact(source.title, source.id, 80),
    url,
  }))).slice(0, 8);
  const snapshotDate = evidence?.generatedAt ? ownerDate(evidence.generatedAt) : "Срез ещё не сформирован";
  const sourceSummary = evidence
    ? `${evidence.provenance.summary.sourcesVerified} проверено · ${evidence.provenance.summary.sourcesPartial} частично · ${evidence.provenance.summary.sourcesUnavailable} недоступно`
    : "Источники ещё не собраны";
  const headline = missingCount === 0 && assumptionCount === 0
    ? "Основа готова для сильного черновика стратегии"
    : missingCount === 0
      ? `Нужно подтвердить ${countLabel(assumptionCount, "допущение", "допущения", "допущений")} перед стратегией`
      : `Нужно разобрать ${countLabel(missingCount, "критичный пробел", "критичных пробела", "критичных пробелов")} и ${countLabel(assumptionCount, "допущение", "допущения", "допущений")}`;
  return {
    headline,
    summary: "После подтверждения этой основы стратегия сможет без смыслового разрыва превратиться в структуру кампаний Яндекс Директа.",
    readinessLabel: missingCount === 0 && assumptionCount === 0 ? "Готово" : "Нужно подтвердить",
    readinessCount,
    totalCount: items.length,
    confirmedCount,
    assumptionCount,
    missingCount,
    items,
    blockers,
    market,
    capacities,
    snapshotDate,
    snapshotId: evidence?.provenance.snapshotId ?? "Недоступно",
    sourceSummary,
    sourceLinks,
  };
}

function StateBadge({ state }: { state: FindingState }) {
  return <span className={styles.stateBadge} data-state={state}>{state === "confirmed" ? "Подтверждено" : state === "assumption" ? "Допущение" : "Нужно уточнить"}</span>;
}

function CapacityCard({ estimate, compactView = false }: { estimate: CapacityEstimate; compactView?: boolean }) {
  return <article className={styles.capacityCard} data-example={estimate.isExample}>
    <header><div><span>ФИНАНСОВАЯ ЁМКОСТЬ</span><h3>{estimate.name}</h3></div><b>{estimate.confidence}</b></header>
    <div className={styles.capacityNumbers}>
      <p><span>Чистая прибыль</span><strong>{estimate.profit}</strong></p>
      <p><span>Потенциал рекламы</span><strong>{estimate.range}</strong></p>
    </div>
    {!compactView && <><strong className={styles.capacityPressure}>{estimate.pressure}</strong><p className={styles.capacityUse}><b>Как использовать:</b> {estimate.use}</p></>}
    <small>Это оценка доступного ресурса, а не наблюдаемый рекламный бюджет конкурента.</small>
  </article>;
}

function EvidenceDetails({ model }: { model: FindingsModel }) {
  return <details className={styles.evidenceDetails}>
    <summary>Источники и методика <span>{model.sourceSummary}</span></summary>
    <div>
      <dl>
        <div><dt>Сформирован</dt><dd>{model.snapshotDate}</dd></div>
        <div><dt>ID среза</dt><dd>{model.snapshotId}</dd></div>
        <div><dt>Правило неизвестного</dt><dd>Недоступное не заменяется нулём.</dd></div>
      </dl>
      {model.sourceLinks.length > 0 && <nav aria-label="Источники текущего среза">{model.sourceLinks.map((source) => <a key={`${source.title}-${source.url}`} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</nav>}
    </div>
  </details>;
}

function BlockerList({ model, limit }: { model: FindingsModel; limit?: number }) {
  const blockers = typeof limit === "number" ? model.blockers.slice(0, limit) : model.blockers;
  return <ol className={styles.blockerList} id="findings-prototype-blockers">
    {blockers.map((blocker, index) => <li key={blocker.id}>
      <span>{index + 1}</span>
      <div><small>{blocker.level}</small><strong>{blocker.title}</strong><p>{blocker.consequence}</p></div>
      <b>{blocker.action}</b>
    </li>)}
  </ol>;
}

function scrollToBlockers() {
  document.getElementById("findings-prototype-blockers")?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function scrollToReadinessItem(id: string | undefined) {
  if (!id) return;
  document.getElementById(`findings-prototype-item-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function openCanvasBlockers() {
  const details = document.getElementById("findings-prototype-canvas-blockers");
  if (!(details instanceof HTMLDetailsElement)) return;
  details.open = true;
  details.scrollIntoView({ behavior: "smooth", block: "center" });
}

function VariantA({ model }: { model: FindingsModel }) {
  const coreItems = model.items.slice(0, 6);
  return <div className={`${styles.variant} ${styles.variantA}`}>
    <header className={styles.readinessHero}>
      <div><p>ОСНОВА СТРАТЕГИИ · ПРОТОТИП A</p><h2>{model.headline}</h2><span>{model.summary}</span></div>
      <div className={styles.readinessScore}><strong>{model.readinessCount}/{model.totalCount}</strong><span>подтверждено</span><b>{model.readinessLabel}</b></div>
    </header>
    <div className={styles.signalStrip}>
      <span><b>{model.confirmedCount}</b> подтверждено</span>
      <span><b>{model.assumptionCount}</b> допущения</span>
      <span><b>{model.missingCount}</b> пробелы</span>
      <span><b>{model.snapshotDate}</b> текущий срез</span>
    </div>
    <div className={styles.summaryLayout}>
      <main>
        <section className={styles.briefSection} aria-labelledby="prototype-a-brief">
          <header><div><span>ЧТО СЧИТАЕМ ПРАВДОЙ</span><h3 id="prototype-a-brief">Короткая основа стратегии</h3></div><small>Пользователь видит только значимые решения</small></header>
          <dl>{coreItems.map((item) => <div key={item.id}><dt>{item.label}</dt><dd><strong>{item.value}</strong><small>{item.source}</small></dd><StateBadge state={item.state} /></div>)}</dl>
        </section>
        <section className={styles.marketSection} aria-labelledby="prototype-a-market">
          <header><span>ЧТО ПОДТВЕРЖДАЕТ РЫНОК</span><h3 id="prototype-a-market">Сигналы для будущей структуры кампаний</h3></header>
          <div>{model.market.map((signal) => <article key={signal.label}><StateBadge state={signal.state} /><span>{signal.label}</span><strong>{signal.value}</strong><p>{signal.detail}</p></article>)}</div>
        </section>
        <CapacityCard estimate={model.capacities[0]} />
      </main>
      <aside className={styles.actionPanel}>
        <span>СНАЧАЛА РЕШИТЬ</span>
        <h3>{countLabel(model.blockers.length, "пункт влияет", "пункта влияют", "пунктов влияют")} на качество стратегии</h3>
        <BlockerList model={model} limit={3} />
        {model.blockers.length > 3 && <p>Ещё {countLabel(model.blockers.length - 3, "пункт", "пункта", "пунктов")} — в полном маршруте готовности.</p>}
        <button type="button" onClick={scrollToBlockers}>Уточнить ключевые решения</button>
        <small>Прототип: действие не изменяет данные.</small>
      </aside>
    </div>
    <EvidenceDetails model={model} />
  </div>;
}

function VariantB({ model }: { model: FindingsModel }) {
  return <div className={`${styles.variant} ${styles.variantB}`}>
    <header className={styles.routeHeader}>
      <div><p>МАРШРУТ К СТРАТЕГИИ · ПРОТОТИП B</p><h2>{model.headline}</h2><span>Один список показывает, чего достаточно для черновика, который затем раскладывается на кампании Директа.</span></div>
      <div className={styles.routeProgress}><span style={{ width: `${Math.round(model.confirmedCount / model.totalCount * 100)}%` }} /><b>{model.confirmedCount} из {model.totalCount}</b></div>
    </header>
    <div className={styles.routeLayout}>
      <section className={styles.checklist} aria-label="Проверка основы стратегии">
        {model.items.map((item, index) => <article key={item.id} id={`findings-prototype-item-${item.id}`} data-state={item.state}>
          <span className={styles.stepNumber}>{String(index + 1).padStart(2, "0")}</span>
          <div><small>{item.label}</small><strong>{item.value}</strong><p>{item.consequence}</p></div>
          <div className={styles.stepStatus}><StateBadge state={item.state} /><small>{item.source}</small></div>
        </article>)}
      </section>
      <aside className={styles.routeAside}>
        <section><span>ЧТО ПОЛУЧИТ СТРАТЕГИЯ</span><h3>Контракт без скрытых допущений</h3><ul><li>сегмент и намерение;</li><li>предложение и сообщение;</li><li>цель и предел стоимости;</li><li>географию и ограничения;</li><li>основание структуры групп.</li></ul></section>
        <CapacityCard estimate={model.capacities[0]} compactView />
        <section className={styles.nextDecision}><span>СЛЕДУЮЩЕЕ РЕШЕНИЕ</span><strong>{model.blockers[0]?.title ?? "Все опоры подтверждены"}</strong><p>{model.blockers[0]?.consequence ?? "Можно переходить к формированию стратегии."}</p><button type="button" onClick={() => scrollToReadinessItem(model.blockers[0]?.id)}>{model.blockers[0]?.action ?? "Перейти к стратегии"}</button></section>
      </aside>
    </div>
    <EvidenceDetails model={model} />
  </div>;
}

function ConfidenceColumn({ title, description, items, state }: { title: string; description: string; items: ReadinessItem[]; state: FindingState }) {
  return <section className={styles.confidenceColumn} data-state={state}>
    <header><div><span>{title}</span><small>{description}</small></div><b>{items.length}</b></header>
    <div>{items.length > 0 ? items.map((item) => <article key={item.id}>
      <span>{item.label}</span><strong>{item.value}</strong><p>{item.consequence}</p><small>{item.source}</small>
    </article>) : <p className={styles.emptyColumn}>Здесь пока нет пунктов.</p>}</div>
  </section>;
}

function VariantC({ model }: { model: FindingsModel }) {
  const confirmed = model.items.filter((item) => item.state === "confirmed");
  const assumptions = model.items.filter((item) => item.state === "assumption");
  const missing = model.items.filter((item) => item.state === "missing");
  return <div className={`${styles.variant} ${styles.variantC}`}>
    <header className={styles.canvasHeader}>
      <div><p>КАРТА УВЕРЕННОСТИ · ПРОТОТИП C</p><h2>Из чего на самом деле будет собрана стратегия</h2><span>Факты, допущения и пробелы разведены до передачи следующему модулю.</span></div>
      <div><strong>{model.readinessLabel}</strong><span>{countLabel(model.confirmedCount, "факт", "факта", "фактов")} · {countLabel(model.assumptionCount, "допущение", "допущения", "допущений")} · {countLabel(model.missingCount, "пробел", "пробела", "пробелов")}</span></div>
    </header>
    <div className={styles.canvasColumns}>
      <ConfidenceColumn title="Опираемся" description="Можно передавать как факт" items={confirmed} state="confirmed" />
      <ConfidenceColumn title="Проверяем" description="Войдёт в план как гипотеза" items={assumptions} state="assumption" />
      <ConfidenceColumn title="Нужно получить" description="Ослабляет черновик" items={missing} state="missing" />
    </div>
    <div className={styles.canvasFooter}>
      <CapacityCard estimate={model.capacities[0]} compactView />
      <section className={styles.handoffCard}><span>ПЕРЕДАЧА В СТРАТЕГИЮ</span><h3>{model.headline}</h3><p>В следующий этап уйдут только показанные факты и явно принятые допущения. Источники останутся доступны для проверки.</p><button type="button" onClick={openCanvasBlockers}>Разобрать {model.blockers.length} неподтверждённых пунктов</button></section>
    </div>
    <details className={styles.canvasBlockers} id="findings-prototype-canvas-blockers"><summary>Все неподтверждённые пункты · {model.blockers.length}</summary><BlockerList model={model} /></details>
    <EvidenceDetails model={model} />
  </div>;
}

export default function FindingsPrototype({
  projection,
  result,
  variant,
  onVariant,
}: {
  projection: OwnerJourneyProjection;
  result: CurrentPipelineOwnerResult | null;
  variant: FindingsPrototypeVariant;
  onVariant: (variant: FindingsPrototypeVariant) => void;
}) {
  const model = buildFindingsModel(projection, result);
  return <section className={styles.root} aria-label={`Прототип раздела «Сбор сведений», вариант ${variant}`}>
    {variant === "A" ? <VariantA model={model} /> : variant === "B" ? <VariantB model={model} /> : <VariantC model={model} />}
    <PrototypeSwitcher
      variants={FINDINGS_VARIANTS}
      current={variant}
      onChange={(key) => { if (isFindingsPrototypeVariant(key)) onVariant(key); }}
    />
  </section>;
}
