"use client";

import { FormEvent, type ReactNode, useId, useState } from "react";
import type { CurrentPipelineOwnerResult } from "../lib/pipeline-current-contract";
import { localizedText, ownerFieldLabel } from "./ui-copy";
import styles from "./campaign-portfolio.module.css";
import { SEARCH_INTENT_LABELS, type SearchFrequency } from "../lib/campaign-search-semantics.ts";
import { FormationPortfolioView } from "./CampaignFormation.tsx";
import type { FormationBundle } from "../lib/campaign-formation-portfolio.ts";
import { businessSourceUrl, businessText } from "../lib/owner-business-copy.ts";

type CampaignPair = NonNullable<CurrentPipelineOwnerResult["products"]>["campaignPairs"][number];
type PortfolioState = "ready" | "local" | "attention" | "stale" | "working" | "empty";
type EditKind = "semantic" | "technical";

type CampaignPortfolioProps = {
  result: CurrentPipelineOwnerResult;
  active: boolean;
  busy: boolean;
  economicLimitRub?: number | null;
  onPair: (event: FormEvent<HTMLFormElement>, pair: CampaignPair, kind: EditKind) => Promise<void>;
  onOpenStrategy: () => void;
  preparationActions?: ReactNode;
};

type CampaignView = {
  pair: CampaignPair;
  index: number;
  title: string;
  audience: string;
  offer: string;
  message: string;
  mechanism: string;
  result: string;
  primaryMetric: string;
  baseline: string;
  landing: string;
  campaignName: string;
  groupName: string;
  keyword: string;
  negativeKeywords: string;
  titles: string[];
  texts: string[];
  weeklyBudgetRub: number | null;
  bidCeilingRub: number | null;
  placement: string;
  bidding: string;
  geography: string;
  period: string;
  measurementGoal: string;
  localReview: boolean;
  groups: Array<{
    ref: string;
    name: string;
    keywords: string[];
    negativeKeywords: string[];
    titles: string[];
    texts: string[];
    landing: string;
    autotargeting: Record<string, unknown> | null;
  }>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function projectionAt(value: Record<string, unknown>, pointer: string): unknown {
  return pointer.slice(1).split("/").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function dimension(result: CurrentPipelineOwnerResult, id: string) {
  return result.products?.strategy?.dimensions.find((item) => item.id === id)?.value;
}

function text(value: unknown, fallback = "Не подтверждено") {
  const normalized = String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  return normalized || fallback;
}

function editableText(value: unknown) {
  if (!Array.isArray(value)) return String(value ?? "");
  return value.map((item) => text(record(item).Text ?? item, "")).filter(Boolean).join("\n");
}

function listText(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(record(item).Text ?? item, "")).filter(Boolean);
}

function rublesFromMicros(value: unknown) {
  const micros = Number(value);
  return Number.isFinite(micros) && micros > 0 ? micros / 1_000_000 : null;
}

function formatMoney(value: number | null) {
  return value === null ? "Не подтверждено" : `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value)} ₽`;
}

function displayUrl(value: unknown) {
  const raw = text(value, "Посадочная не подтверждена");
  try {
    const url = new URL(raw);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return raw;
  }
}

function periodLabel(start: unknown, end: unknown) {
  const values = [start, end].map((value) => text(value, "")).filter(Boolean);
  return values.length ? values.join(" — ") : "Период не подтверждён";
}

function autotargetingDescription(settings: Record<string, unknown> | null) {
  if (!settings) return "Настройки не подтверждены";
  const categories = record(settings.Categories);
  const brands = record(settings.BrandOptions);
  const categoryLabels = { Exact: "целевые", Narrow: "узкие", Alternative: "альтернативные", Accessory: "сопутствующие", Broader: "широкие" };
  const brandLabels = { WithoutBrands: "без брендов", WithAdvertiserBrand: "с брендом рекламодателя", WithCompetitorsBrand: "с брендами конкурентов" };
  return `Запросы: ${Object.entries(categoryLabels).filter(([key]) => categories[key] === "YES").map(([, label]) => label).join(", ")}. Бренды: ${Object.entries(brandLabels).filter(([key]) => brands[key] === "YES").map(([, label]) => label).join(", ")}.`;
}

export function campaignView(pair: CampaignPair, index: number, result: CurrentPipelineOwnerResult): CampaignView {
  const projection = pair.publishProjection;
  const directSearch = "/direct/campaign/UnifiedCampaign/BiddingStrategy/Search";
  const campaignName = text(projectionAt(projection, "/direct/campaign/Name"), `Будущая кампания ${index + 1}`);
  const localReview = Boolean(pair.publicationReadiness);
  const direct = record(projection.direct);
  const groupNodes = Array.isArray(direct.ad_groups) ? direct.ad_groups.map(record) : [];
  const criteria = Array.isArray(direct.keywords) ? direct.keywords.map(record) : [];
  const ads = Array.isArray(direct.ads) ? direct.ads.map(record) : [];
  const groups = localReview ? groupNodes.map((group) => {
    const fields = record(group.provider_fields);
    const matching = criteria.filter((item) => item.ad_group_ref === group.local_ref);
    const ad = record(record(ads.find((item) => item.ad_group_ref === group.local_ref)?.provider_fields).ResponsiveAd);
    const automatic = matching.find((item) => item.kind === "AUTOTARGETING");
    return {
      ref: text(group.local_ref, ""), name: text(fields.Name),
      keywords: matching.filter((item) => item.kind === "EXPLICIT_KEYWORD").map((item) => text(record(item.provider_fields).Keyword)),
      negativeKeywords: listText(record(fields.NegativeKeywords).Items),
      titles: listText(ad.Titles), texts: listText(ad.Texts), landing: text(ad.Href, ""),
      autotargeting: automatic ? record(record(automatic.provider_fields).AutotargetingSettings) : null,
    };
  }) : [];
  const titles = localReview ? groups.flatMap((group) => group.titles) : listText(projectionAt(projection, "/direct/ad/ResponsiveAd/Titles"));
  const texts = localReview ? groups.flatMap((group) => group.texts) : listText(projectionAt(projection, "/direct/ad/ResponsiveAd/Texts"));
  const networkType = text(projectionAt(projection, "/direct/campaign/UnifiedCampaign/BiddingStrategy/Network/BiddingStrategyType"), "");
  const searchType = text(projectionAt(projection, `${directSearch}/BiddingStrategyType`), "");
  const biddingBranch = searchType === "WB_MAXIMUM_CONVERSION_RATE" ? "WbMaximumConversionRate" : "WbMaximumClicks";
  const searchResults = text(projectionAt(projection, `${directSearch}/PlacementTypes/SearchResults`), "");
  const strategyPeriod = record(dimension(result, "period"));
  return {
    pair,
    index,
    title: campaignName,
    audience: text(projectionAt(projection, "/business/audience") ?? dimension(result, "target_audience")),
    offer: text(dimension(result, "advertised_offer") ?? projectionAt(projection, "/business/product")),
    message: text(projectionAt(projection, "/business/value") ?? dimension(result, "core_message")),
    mechanism: text(pair.hypothesis.mechanism, "Основание выбора не подтверждено"),
    result: text(projectionAt(projection, "/business/qualified_result") ?? dimension(result, "qualified_result")),
    primaryMetric: text(pair.hypothesis.primary_metric, "Квалифицированный результат"),
    baseline: text(pair.hypothesis.baseline, "Будет зафиксирован до запуска"),
    landing: localReview ? [...new Set(groups.map((group) => displayUrl(group.landing)))].join(" · ") : displayUrl(projectionAt(projection, "/direct/ad/ResponsiveAd/Href")),
    campaignName,
    groupName: text(projectionAt(projection, "/direct/ad_group/Name"), "Группа объявлений"),
    keyword: text(projectionAt(projection, "/direct/keyword/Keyword"), "Ключевая фраза не подтверждена"),
    negativeKeywords: editableText(projectionAt(projection, "/direct/ad_group/NegativeKeywords/Items")) || "Не заданы",
    titles,
    texts,
    weeklyBudgetRub: rublesFromMicros(projectionAt(projection, `${directSearch}/${biddingBranch}/WeeklySpendLimit`)),
    bidCeilingRub: rublesFromMicros(projectionAt(projection, `${directSearch}/${biddingBranch}/BidCeiling`)),
    placement: [searchResults === "YES" ? "Поиск" : null, networkType === "SERVING_OFF" ? "сети отключены" : networkType ? "сети включены" : null].filter(Boolean).join(" · ") || "Размещение не подтверждено",
    bidding: searchType === "WB_MAXIMUM_CLICKS" ? "Привлечение переходов" : searchType === "WB_MAXIMUM_CONVERSION_RATE" ? "Привлечение обращений" : "Способ распределения расходов не подтверждён",
    geography: text(dimension(result, "geography"), "География не подтверждена"),
    period: periodLabel(projectionAt(projection, "/direct/campaign/StartDate") ?? strategyPeriod.start_date, projectionAt(projection, "/direct/campaign/EndDate") ?? strategyPeriod.end_date),
    measurementGoal: text(pair.auctionProtocol.measurement_goal ?? projectionAt(projection, "/business/qualified_result") ?? dimension(result, "qualified_result")),
    localReview,
    groups,
  };
}

function portfolioState(result: CurrentPipelineOwnerResult, active: boolean): PortfolioState {
  const products = result.products;
  if (active) return "working";
  if (!products?.campaignPairs.length) return products?.pairValidation.violations.length ? "attention" : "empty";
  const strategyRevision = products.strategy?.revisionId;
  const stale = Boolean(strategyRevision && products.campaignPairs.some((pair) => {
    const lineage = record(pair.publishProjection.lineage);
    return [pair.hypothesis.strategy_revision_id, lineage.strategy_revision_id]
      .filter(Boolean)
      .some((revision) => String(revision) !== strategyRevision);
  }));
  if (stale) return "stale";
  const validation = products.pairValidation.status.toUpperCase();
  if (validation && validation !== "VALID" && validation !== "PASS") return "attention";
  if (products.campaignPairs.some((pair) => pair.publicationReadiness && !pair.publicationReadiness.localContentValid)) return "attention";
  if (products.campaignPairs.some((pair) => pair.searchSemantics && pair.searchSemantics.coverage.status !== "REVIEWED")) return "attention";
  if (products.campaignPairs.some((pair) => pair.publicationReadiness)) return "local";
  return "ready";
}

function pluralCampaign(count: number) {
  if (count % 10 === 1 && count % 100 !== 11) return `${count} кампания`;
  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return `${count} кампании`;
  return `${count} кампаний`;
}

function OwnerBand({ state, violations, hasCampaigns }: { state: PortfolioState; violations: string[]; hasCampaigns: boolean }) {
  const content = state === "local" ? ["✓", "Черновики подготовлены"]
    : state === "ready" ? ["✓", "Подготовка кампаний завершена"]
      : state === "working" ? ["↻", hasCampaigns ? "Кампании обновляются" : "Кампании готовятся"]
        : state === "stale" ? ["!", "Кампании устарели"]
          : state === "attention" ? ["!", "Нужна повторная проверка"]
            : ["○", "Кампании ещё не подготовлены"];
  return <section className={`${styles.ownerBand} ${styles[`ownerBand_${state === "local" ? "ready" : state}`]}`}>
    <div className={styles.statusLine}><span className={styles.ownerBandIcon} aria-hidden="true">{content[0]}</span><strong role="status">{content[1]}</strong></div>
    {(violations.length > 0 || state === "stale" || state === "attention") && <div className={styles.statusDetails}>
      {state === "stale" && <p>Стратегия изменилась. Кампании нужно подготовить заново.</p>}
      {violations.length > 0 ? <ul>{[...new Set(violations.map(value => businessText(localizedText(value))).filter(Boolean))].map((violation) => <li key={violation}>{violation}</li>)}</ul> : state === "attention" && <p>Кампании требуют повторной проверки.</p>}
    </div>}
  </section>;
}

function SemanticEditor({ campaign, busy, active, onPair }: { campaign: CampaignView; busy: boolean; active: boolean; onPair: CampaignPortfolioProps["onPair"] }) {
  const defaults = {
    product: projectionAt(campaign.pair.publishProjection, "/business/product") ?? campaign.offer,
    audience: projectionAt(campaign.pair.publishProjection, "/business/audience") ?? campaign.audience,
    offer: campaign.offer,
    qualified_result: projectionAt(campaign.pair.publishProjection, "/business/qualified_result") ?? campaign.result,
    core_message: projectionAt(campaign.pair.publishProjection, "/business/value") ?? campaign.message,
  };
  return <form className={styles.editor} onSubmit={(event) => onPair(event, campaign.pair, "semantic")}>
    <header><strong>Предложение и аудитория</strong><small>После сохранения объявления будут подготовлены заново.</small></header>
    <div className={styles.fields}>{Object.entries(defaults).map(([name, value]) => <label key={name}><span>{ownerFieldLabel(name)}</span><textarea name={name} required defaultValue={String(value ?? "")} /></label>)}</div>
    <footer><button type="reset">Отменить правки</button><button type="submit" disabled={busy || active}>{busy ? "Перепроверяю…" : "Сохранить изменения"}</button></footer>
  </form>;
}

function CampaignDetails({ campaign, busy, active, economicLimitRub, onPair }: { campaign: CampaignView; busy: boolean; active: boolean; economicLimitRub?: number | null; onPair: CampaignPortfolioProps["onPair"] }) {
  const [editing, setEditing] = useState(false);
  return <div className={styles.detailsBody}>
    <dl className={styles.detailGrid}>
      <div><dt>Предложение</dt><dd>{businessText(campaign.offer)}</dd></div>
      <div><dt>Основное сообщение</dt><dd>{businessText(campaign.message)}</dd></div>
      <div><dt>Ожидаемый результат</dt><dd>{businessText(campaign.result)}</dd></div>
      <div><dt>География и период</dt><dd>{campaign.geography} · {campaign.period}</dd></div>
      <div><dt>Измерение</dt><dd>{businessText(campaign.primaryMetric)}. {economicLimitRub ? `≤ ${formatMoney(economicLimitRub)} за результат — предел расходов. Фактическая стоимость результата пока неизвестна.` : "Стоимость и количество результатов пока неизвестны."}</dd></div>
    </dl>
    {!campaign.localReview && <button type="button" className={styles.secondaryAction} onClick={() => setEditing((value) => !value)} aria-expanded={editing}>{editing ? "Закрыть редактирование" : "Изменить предложение и аудиторию"}</button>}
    {editing && <SemanticEditor campaign={campaign} busy={busy} active={active} onPair={onPair} />}
  </div>;
}

function frequencyScope(value: SearchFrequency) {
  const devices: Record<string, string> = { all: "все устройства", desktop: "компьютеры", phone: "телефоны", tablet: "планшеты" };
  const operators: Record<string, string> = { BROAD_CONTAINING: "широкая частота, включая уточнения", FIXED_WORD_COUNT: "фиксированное число слов", FIXED_ORDER_FORM: "фиксированный порядок и форма" };
  const window = value.window === "rolling_last_30_days" ? "Последние 30 дней; точные даты не указаны источником" : businessText(value.window || "Период не уточнён");
  const regions = value.regions.filter(Boolean).join(", ") || "Название региона не подтверждено";
  return `${window} · ${regions} · ${devices[value.device ?? ""] ?? "устройства не уточнены"} · ${operators[value.operator_profile ?? ""] ?? "операторы не уточнены"}`;
}

export function KeywordEvidence({ campaign, groupRef, phrases }: { campaign: CampaignView; groupRef: string; phrases: string[] }) {
  return <ul className={styles.keywordEvidence}>{phrases.map((phrase) => {
    const evidence = campaign.pair.searchSemantics?.keywords.find((row) => row.group_ref === groupRef && row.phrase === phrase);
    return <li key={phrase}>
      <div className={styles.keywordHeading}><strong>{phrase}</strong>{!evidence?.frequencies.length && <span className={styles.unknownFrequency}>Частотность не подтверждена</span>}</div>
      {evidence?.frequencies.map((frequency, index) => <div className={styles.keywordMeasurement} key={`${frequency.observation_id}-${index}`}>
        <b>{frequency.count.toLocaleString("ru-RU")} <small>запросов за период</small></b>
        <span>{frequencyScope(frequency)}</span>
        <small>Wordstat · наблюдение {new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(frequency.observed_at))}</small>
      </div>)}
      {evidence?.intent && <small className={styles.keywordIntent}>{SEARCH_INTENT_LABELS[evidence.intent]} · предварительная оценка намерения</small>}
      {evidence?.rationale && <p className={styles.keywordReason}>{businessText(evidence.rationale)}</p>}
    </li>;
  })}</ul>;
}

export function CampaignStructure({ campaign }: { campaign: CampaignView }) {
  return <div className={styles.detailsBody}>
    <section className={styles.structureRoot}><strong>{campaign.title}</strong><small>{campaign.placement} · {campaign.bidding}</small></section>
    <div className={styles.structureStem} />
    {campaign.localReview ? <section className={`${styles.groupList} ${styles.localGroups}`}>{campaign.groups.map((group) => <article key={group.ref}>
      <div><span>ГРУППА ОБЪЯВЛЕНИЙ</span><strong>{group.name}</strong></div>
      <dl className={styles.technicalGrid}>
        <div className={styles.keywordSection}><dt>Ключевые фразы и частотность</dt><dd><KeywordEvidence campaign={campaign} groupRef={group.ref} phrases={group.keywords} /></dd></div>
        <div><dt>Какие запросы исключены</dt><dd>{group.negativeKeywords.length ? group.negativeKeywords.join(" · ") : "Не выбраны"}</dd></div>
        <div><dt>Заголовки</dt><dd><ul>{group.titles.map((title) => <li key={title}>{title}</li>)}</ul></dd></div>
        <div><dt>Тексты</dt><dd><ul>{group.texts.map((body) => <li key={body}>{body}</li>)}</ul></dd></div>
        <div><dt>Куда ведёт объявление</dt><dd>{businessSourceUrl(group.landing) ? <a href={group.landing} target="_blank" rel="noreferrer">{displayUrl(group.landing)}</a> : "Страница не подтверждена"}</dd></div>
        <div><dt>Дополнительно подбираемые запросы</dt><dd>{autotargetingDescription(group.autotargeting)}</dd></div>
      </dl>
    </article>)}</section> : <section className={styles.groupList}><article><div><span>ГРУППА ОБЪЯВЛЕНИЙ</span><strong>{campaign.groupName}</strong></div></article></section>}
    <dl className={styles.technicalGrid}>
      {!campaign.localReview && <><div className={styles.keywordSection}><dt>Ключевая фраза и частотность</dt><dd><KeywordEvidence campaign={campaign} groupRef="" phrases={[campaign.keyword]} /></dd></div><div><dt>Какие запросы исключены</dt><dd>{campaign.negativeKeywords}</dd></div>
        <div><dt>Заголовки</dt><dd><ul>{campaign.titles.map(title => <li key={title}>{title}</li>)}</ul></dd></div><div><dt>Тексты</dt><dd><ul>{campaign.texts.map(body => <li key={body}>{body}</li>)}</ul></dd></div><div><dt>Куда ведёт объявление</dt><dd>{campaign.landing}</dd></div></>}
      <div><dt>Недельный лимит</dt><dd>{formatMoney(campaign.weeklyBudgetRub)}</dd></div>
      <div><dt>Предельная цена клика</dt><dd>{campaign.bidCeilingRub === null ? "Не выбрана" : formatMoney(campaign.bidCeilingRub)}</dd></div>
      <div><dt>Измеряемый результат</dt><dd>{businessText(campaign.measurementGoal)}</dd></div>
      <div><dt>Что известно до запуска</dt><dd>{businessText(campaign.baseline)}</dd></div>
    </dl>
    <p className={styles.frequencyNote}>Частотность — число поисковых запросов в области наблюдения, не прогноз показов или обращений. Пересекающиеся широкие запросы не складываются.</p>
    {campaign.pair.searchSemantics && campaign.pair.searchSemantics.coverage.status !== "REVIEWED" && <aside className={styles.semanticWarning}>{campaign.pair.searchSemantics.coverage.status === "NOT_REVIEWED" ? "Не проверено, охвачены ли все нужные намерения покупателей. Частоты относятся к указанным датам исследования." : "Охват намерений покупателей пока не подтверждён. Требуется дополнительное исследование."}</aside>}
  </div>;
}

function CampaignOrigin({ campaign }: { campaign: CampaignView }) {
  const coverage = campaign.pair.searchSemantics?.coverage;
  const admissionReasons: Record<string, string> = { OUTSIDE_OFFER: "Не относится к предложению", UPSTREAM_RELEVANCE_EXCLUSION: "Не относится к нужному спросу", UNSAFE_PHRASE: "Неподходящее содержание", NO_POSITIVE_OBSERVATION: "Положительная частота не подтверждена", PROVENANCE_OR_SCOPE_UNVERIFIED: "Источник или область наблюдения не подтверждены", EXPLICIT_CATALOG_CAPACITY: "Запрос пока не рассмотрен; охват неполон", DUPLICATE_OBSERVATION: "Повтор уже рассмотренного запроса" };
  return <div className={styles.detailsBody}>
    {coverage && <section className={styles.semanticCoverage}><h3>Покрытие поисковых намерений</h3>
      <p>{coverage.status === "REVIEWED" ? "Направления рассмотрены; это не доказательство рекламной эффективности." : coverage.status === "NEEDS_RESEARCH" ? "Нужно дополнительное исследование." : "Проверка для этой редакции ещё не выполнялась."}</p>
      {coverage.groups.map((group, index) => <article key={index}><strong>{SEARCH_INTENT_LABELS[group.intent]} · {group.disposition === "INCLUDED" ? "Включено" : group.disposition === "EXCLUDED" ? "Исключено" : "Нужно исследование"}</strong><p>{businessText(group.rationale)}</p></article>)}
      {!!coverage.exclusions.length && <details><summary>Почему исключены запросы</summary><ul>{coverage.exclusions.map((row, index) => <li key={index}>{row.phrase || "Содержимое скрыто"} — {admissionReasons[row.reason] ?? "Не прошло проверку"}</li>)}</ul></details>}
    </section>}
  </div>;
}

function CampaignCard({ campaign, busy, active, economicLimitRub, onPair }: {
  campaign: CampaignView;
  busy: boolean;
  active: boolean;
  economicLimitRub?: number | null;
  onPair: CampaignPortfolioProps["onPair"];
}) {
  const titleId = useId();
  const previewLanding = campaign.localReview ? displayUrl(campaign.groups[0]?.landing) : campaign.landing;
  return <article className={styles.campaignCard} aria-labelledby={titleId}>
    <header className={styles.campaignHeader}>
      <div className={styles.campaignHeading}>
        <h2 id={titleId}>{campaign.title}</h2>
        <p>{campaign.placement} · {campaign.bidding}</p>
      </div>
      <div className={styles.campaignBudget}><span>Лимит в неделю</span><strong>{formatMoney(campaign.weeklyBudgetRub)}</strong></div>
    </header>
    <dl className={styles.campaignBasis}>
      <div><dt>Кому</dt><dd>{businessText(campaign.audience)}</dd></div>
      <div><dt>Почему выбрана</dt><dd>{businessText(campaign.mechanism)}</dd></div>
    </dl>
    <section className={styles.adPreview} aria-label="Предварительный вид объявления">
      <p>Превью объявления</p>
      <div><span>Реклама · {previewLanding}</span><strong>{campaign.titles[0] ?? campaign.offer}</strong><small>{campaign.texts[0] ?? campaign.message}</small></div>
    </section>
    <details className={styles.campaignDisclosure}>
      <summary>Бизнес-смысл и условия</summary>
      <CampaignDetails campaign={campaign} busy={busy} active={active} economicLimitRub={economicLimitRub} onPair={onPair} />
    </details>
    <details className={styles.campaignDisclosure}>
      <summary>Объявления и поисковые запросы</summary>
      <CampaignStructure campaign={campaign} />
    </details>
    {campaign.pair.searchSemantics?.coverage && <details className={styles.campaignDisclosure}>
      <summary>Выбор поисковых намерений</summary>
      <CampaignOrigin campaign={campaign} />
    </details>}
  </article>;
}

export default function CampaignPortfolio({ result, active, busy, economicLimitRub, onPair, onOpenStrategy, preparationActions }: CampaignPortfolioProps) {
  const formedPair = result.products?.campaignPairs.find(p => p.publishProjection.schema_version === "p0-direct-projection-v6");
  const formation = formedPair?.publishProjection.formation as FormationBundle | undefined;
  if (formation && formedPair) return <FormationPortfolioView bundle={formation} active={active} sourceFacts={result.products?.evidence?.sourceFacts} materials={result.products?.evidence?.researchMaterials} period={periodLabel(projectionAt(formedPair.publishProjection, "/direct/campaign/StartDate"), projectionAt(formedPair.publishProjection, "/direct/campaign/EndDate"))} />;
  const products = result.products;
  const campaigns = products?.campaignPairs.map((pair, index) => campaignView(pair, index, result)) ?? [];
  const state = portfolioState(result, active);
  const violations = [...(products?.pairValidation.violations ?? []),
    ...(products?.campaignPairs.filter((pair) => pair.searchSemantics && pair.searchSemantics.coverage.status !== "REVIEWED")
      .map(() => "Покрытие поисковых намерений не подтверждено. Частотность каждой фразы доступна в разделе «Объявления и поисковые запросы».") ?? [])];
  const strategy = products?.strategy;
  const strategyLabel = !strategy ? "Ещё не подготовлена"
    : strategy.status !== "AGENT_ACCEPTED" ? "Проверяется"
      : state === "stale" ? "Изменилась" : "Текущая";
  const totalBudget = campaigns.length && campaigns.every((campaign) => campaign.weeklyBudgetRub !== null)
    ? campaigns.reduce((sum, campaign) => sum + Number(campaign.weeklyBudgetRub), 0)
    : null;

  return <section className={styles.portfolioRoot} aria-labelledby="campaign-portfolio-title">
    <header className={styles.pageHeader}>
      <div><h1 id="campaign-portfolio-title">Кампании</h1>{campaigns.length > 0 && <p>{pluralCampaign(campaigns.length)} · Черновики</p>}</div>
      {campaigns.length > 1 && <div className={styles.totalBudget}><span>Общий лимит в неделю</span><strong>{formatMoney(totalBudget)}</strong></div>}
    </header>

    <OwnerBand state={state} violations={violations} hasCampaigns={campaigns.length > 0} />

    {campaigns.length > 0 && <div className={styles.campaignRows} aria-label="Список кампаний">{campaigns.map((campaign) => <CampaignCard key={campaign.pair.pairKey} campaign={campaign} busy={busy} active={active} economicLimitRub={economicLimitRub} onPair={onPair} />)}</div>}

    {state === "stale" && <footer className={styles.handoffFooter}>
      <button type="button" className={styles.primaryButton} onClick={onOpenStrategy}>Открыть действующую стратегию</button>
    </footer>}

    {(campaigns.length > 0 || preparationActions) && <details className={styles.preparationDetails}>
      <summary>Подробности подготовки</summary>
      <div className={styles.preparationBody}>
        {campaigns.length > 0 && <dl className={styles.preparationFacts}>
          <div><dt>Стратегия</dt><dd><strong>{strategyLabel}</strong></dd></div>
        </dl>}
        {campaigns.some((campaign) => campaign.localReview) && <p className={styles.preparationLimitation}>Размещение этих кампаний пока недоступно. Рекламная эффективность пока не подтверждена.</p>}
        {preparationActions}
      </div>
    </details>}

  </section>;
}
