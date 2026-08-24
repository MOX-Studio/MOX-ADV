"use client";

// Owner verdict 2026-08-23: the «Путь владельца» direction is the only retained prototype.
// The prototype is stage-switchable via ?stage= and does not perform external API writes.
import Link from "next/link";
import { useMemo, useState } from "react";
import styles from "./prototype.module.css";

type StageId = "goal" | "learned" | "strategy" | "campaigns" | "review";
type Campaign = {
  id: string;
  type: "CONTROL" | "IMPROVEMENT";
  title: string;
  premise: string;
  score: number;
  range: string;
  demand: string;
  cost: string;
  status: "VIABLE" | "TESTABLE_WITH_GAPS";
  evidence: number;
  budget: string;
  selected: boolean;
  creativeFamily: string;
  headline: string;
  description: string;
  queryCluster: string;
  geography: string;
  landing: string;
  auctionChange: string;
  bidPolicy: string;
  matchingPolicy: string;
  autotargetingPolicy: string;
  trafficSplit: string;
  successSignal: string;
  stopCondition: string;
  sourceLabel: string;
};

type StrategyDraft = {
  goal: string;
  qualifiedOutcome: string;
  offer: string;
  audience: string;
  geography: string;
  period: string;
  landing: string;
  budget: string;
  targetCost: string;
};

const initialStrategy: StrategyDraft = {
  goal: "Получать 8 квалифицированных брифов в месяц на проекты выставочных стендов от 700 000 ₽",
  qualifiedOutcome: "Компания готовит выставку в ближайшие 3–9 месяцев, знает площадь стенда и готова обсуждать бюджет.",
  offer: "Дизайн и застройка стенда под ключ",
  audience: "Директор по маркетингу · B2B-экспонент",
  geography: "Москва и Санкт-Петербург",
  period: "1 сентября — 30 ноября",
  landing: "https://moxstudio.ru/exhibition-design",
  budget: "24 000 ₽ / неделю",
  targetCost: "18 000 ₽ за бриф",
};

const stages: Array<{ id: StageId; label: string; detail: string }> = [
  { id: "goal", label: "Цель", detail: "Доступ и бизнес-результат" },
  { id: "learned", label: "Что узнал агент", detail: "Модель и доказательства" },
  { id: "strategy", label: "Стратегия", detail: "Готовое решение" },
  { id: "campaigns", label: "Кампании", detail: "Сравнение гипотез" },
  { id: "review", label: "Проверка и создание", detail: "Точное полномочие" },
];

const initialCampaigns: Campaign[] = [
  {
    id: "brief",
    type: "IMPROVEMENT",
    title: "Квалифицированный бриф",
    premise: "Ведём директора по маркетингу сразу к предметному брифу и следующему шагу по проекту.",
    score: 86,
    range: "75–92",
    demand: "510 запросов / мес",
    cost: "120–190 ₽ / клик",
    status: "VIABLE",
    evidence: 88,
    budget: "14 000 ₽ / нед",
    selected: true,
    creativeFamily: "Предметный бриф",
    headline: "Выставочный стенд под задачи бренда",
    description: "Получите концепцию и предметный бриф для выставки. Дизайн, производство и монтаж.",
    queryCluster: "бриф на выставочный стенд · заказать проект стенда",
    geography: "Москва и Санкт-Петербург",
    landing: "https://moxstudio.ru/exhibition-design",
    auctionChange: "Добавить только узкий целевой автотаргетинг к высокоинтентному кластеру",
    bidPolicy: "Максимум кликов · ограничение 190 ₽",
    matchingPolicy: "Фразы с операторами + целевые запросы",
    autotargetingPolicy: "Целевые и узкие категории",
    trafficSplit: "55% улучшение · 45% контроль",
    successSignal: "Квалифицированный бриф или ≥2 начала формы на 100 кликов",
    stopCondition: "30 дней или 36 000 ₽ без квалифицированного брифа",
    sourceLabel: "САЙТ + ВЛАДЕЛЕЦ + ЧЕРНОВИК АГЕНТА",
  },
  {
    id: "control",
    type: "CONTROL",
    title: "Базовый коммерческий спрос",
    premise: "Контрольная кампания по наблюдаемой формулировке «дизайн выставочного стенда».",
    score: 81,
    range: "68–88",
    demand: "1 240 запросов / мес",
    cost: "90–140 ₽ / клик",
    status: "VIABLE",
    evidence: 82,
    budget: "10 000 ₽ / нед",
    selected: true,
    creativeFamily: "Коммерческий спрос",
    headline: "Дизайн выставочного стенда под ключ",
    description: "Разработаем стенд для вашей выставки: от концепции до монтажа на площадке.",
    queryCluster: "дизайн выставочного стенда · заказать выставочный стенд",
    geography: "Москва и Санкт-Петербург",
    landing: "https://moxstudio.ru/exhibition-design",
    auctionChange: "Сохранить явные коммерческие фразы без расширения — контроль аукциона",
    bidPolicy: "Максимум кликов · ограничение 140 ₽",
    matchingPolicy: "Фразы с операторами и 43 семейства исключений",
    autotargetingPolicy: "Выключен; если обязателен — только целевые запросы",
    trafficSplit: "45% контроль · 55% улучшение",
    successSignal: "Квалифицированный бриф или ≥2 начала формы на 100 кликов",
    stopCondition: "30 дней или 36 000 ₽ без квалифицированного брифа",
    sourceLabel: "WORDSTAT + САЙТ + ЧЕРНОВИК АГЕНТА",
  },
  {
    id: "industry",
    type: "IMPROVEMENT",
    title: "Отраслевая специализация",
    premise: "Одна переменная: сообщение адаптировано для промышленных B2B-экспонентов.",
    score: 78,
    range: "65–86",
    demand: "320 запросов / мес",
    cost: "110–175 ₽ / клик",
    status: "VIABLE",
    evidence: 79,
    budget: "8 000 ₽ / нед",
    selected: false,
    creativeFamily: "B2B-экспонент",
    headline: "Стенд для промышленной B2B-выставки",
    description: "Превратим сложный продукт в понятную выставочную историю и готовый стенд.",
    queryCluster: "стенд для промышленной выставки · b2b выставочный стенд",
    geography: "Москва и Санкт-Петербург",
    landing: "https://moxstudio.ru/exhibition-design",
    auctionChange: "Выделить промышленный кластер с собственным ограничением цены клика",
    bidPolicy: "Максимум кликов · ограничение 175 ₽",
    matchingPolicy: "Фразы с отраслевыми маркерами и операторами",
    autotargetingPolicy: "Только узкие категории",
    trafficSplit: "Не назначен до проверки ёмкости",
    successSignal: "Начало квалифицированной формы по промышленному проекту",
    stopCondition: "120 кликов без начала формы или выход за 175 ₽",
    sourceLabel: "ИССЛЕДОВАНИЕ + САЙТ + ЧЕРНОВИК АГЕНТА",
  },
  {
    id: "turnkey",
    type: "IMPROVEMENT",
    title: "Стенд под ключ",
    premise: "Объединяем концепцию, производство и монтаж; стоимости пока не хватает для уверенного сравнения.",
    score: 73,
    range: "58–83",
    demand: "170 запросов / мес",
    cost: "Источник частичный",
    status: "TESTABLE_WITH_GAPS",
    evidence: 68,
    budget: "Не включена",
    selected: false,
    creativeFamily: "Единый подрядчик",
    headline: "Выставочный стенд: дизайн и реализация",
    description: "Одна команда отвечает за концепцию, производство и монтаж выставочного стенда.",
    queryCluster: "выставочный стенд под ключ · застройка стенда под ключ",
    geography: "Москва и Санкт-Петербург",
    landing: "https://moxstudio.ru/exhibition-design",
    auctionChange: "Проверить широкий коммерческий кластер только после получения цены",
    bidPolicy: "Не назначена · нет полного источника цены",
    matchingPolicy: "Коммерческие фразы «под ключ» с операторами",
    autotargetingPolicy: "Выключен до устранения пробела",
    trafficSplit: "0% · эксперимент не допущен",
    successSignal: "Квалифицированный бриф по комплексному проекту",
    stopCondition: "Не запускать до подтверждения цены и бюджета",
    sourceLabel: "САЙТ + ЧЕРНОВИК АГЕНТА",
  },
];

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export default function PrototypeClient({ initialStage = "goal" }: { initialStage?: StageId }) {
  const [stage, setStage] = useState<StageId>(initialStage);
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [strategy, setStrategy] = useState(initialStrategy);
  const [selectedCampaignId, setSelectedCampaignId] = useState("brief");
  const [authorityChecked, setAuthorityChecked] = useState(false);
  const [authorityPrepared, setAuthorityPrepared] = useState(false);
  const [needsRevalidation, setNeedsRevalidation] = useState(false);
  const [revision, setRevision] = useState(3);
  const [businessSummary, setBusinessSummary] = useState(
    "MOX Studio проектирует и строит выставочные стенды под ключ для B2B-компаний, которым нужен измеримый результат выставки, а не только красивый объект.",
  );
  const [briefEditing, setBriefEditing] = useState(false);
  const [goalEditing, setGoalEditing] = useState(false);
  const [strategyEditing, setStrategyEditing] = useState(false);
  const [campaignEditing, setCampaignEditing] = useState(false);
  const [creativePreviewOpen, setCreativePreviewOpen] = useState(true);

  const selectedCampaigns = useMemo(
    () => campaigns.filter((campaign) => campaign.selected),
    [campaigns],
  );
  const currentCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId) || campaigns[0];

  function chooseStage(nextStage: StageId) {
    setStage(nextStage);
    setAuthorityPrepared(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("variant");
    url.searchParams.set("stage", nextStage);
    window.history.replaceState({}, "", url);
  }

  function markMaterialEdit() {
    setNeedsRevalidation(true);
    setAuthorityChecked(false);
    setAuthorityPrepared(false);
  }

  function updateStrategy(field: keyof StrategyDraft, value: string) {
    setStrategy((current) => ({ ...current, [field]: value }));
    markMaterialEdit();
  }

  function updateCampaign(id: string, field: keyof Campaign, value: string) {
    setCampaigns((items) => items.map((campaign) => campaign.id === id ? { ...campaign, [field]: value } : campaign));
    markMaterialEdit();
  }

  function selectCampaign(id: string) {
    setSelectedCampaignId(id);
    setCampaignEditing(false);
    setCreativePreviewOpen(true);
  }

  function toggleCampaign(id: string) {
    setCampaigns((items) =>
      items.map((campaign) =>
        campaign.id === id && campaign.status === "VIABLE"
          ? { ...campaign, selected: !campaign.selected }
          : campaign,
      ),
    );
    markMaterialEdit();
  }

  function revalidateRevision() {
    setNeedsRevalidation(false);
    setRevision((current) => current + 1);
    setAuthorityChecked(false);
    setAuthorityPrepared(false);
  }

  const stageContent = (
    <StageContent
      stage={stage}
      campaigns={campaigns}
      selectedCampaigns={selectedCampaigns}
      currentCampaign={currentCampaign}
      strategy={strategy}
      authorityChecked={authorityChecked}
      authorityPrepared={authorityPrepared}
      needsRevalidation={needsRevalidation}
      revision={revision}
      businessSummary={businessSummary}
      briefEditing={briefEditing}
      goalEditing={goalEditing}
      strategyEditing={strategyEditing}
      campaignEditing={campaignEditing}
      creativePreviewOpen={creativePreviewOpen}
      onBusinessSummary={(value) => { setBusinessSummary(value); markMaterialEdit(); }}
      onBriefEditing={setBriefEditing}
      onGoalEditing={setGoalEditing}
      onStrategyEditing={setStrategyEditing}
      onCampaignEditing={(editing) => { setCampaignEditing(editing); if (editing) setCreativePreviewOpen(false); }}
      onStrategyChange={updateStrategy}
      onCampaignChange={updateCampaign}
      onCreativePreview={() => setCreativePreviewOpen((open) => !open)}
      onSelectCampaign={selectCampaign}
      onToggleCampaign={toggleCampaign}
      onAuthorityChecked={setAuthorityChecked}
      onPrepareAuthority={() => setAuthorityPrepared(true)}
      onRevalidate={revalidateRevision}
      onStage={chooseStage}
    />
  );

  return (
    <div className={styles.prototype}>
      <PrototypeHeader />
      <div className={styles.prototypeFlag}>ПРОТОТИП · ЦЕЛЕВОЕ СОСТОЯНИЕ · БЕЗ ВНЕШНИХ ЗАПИСЕЙ</div>
      <main className={styles.pageA} id="module">
        {stage === "goal" && <Hero strategy={strategy} />}
        <StageNavigation stage={stage} onStage={chooseStage} />
        <div className={styles.ownerWorkspace}>
          <AgentRail stage={stage} selectedCount={selectedCampaigns.length} />
          <section className={styles.artifact}>{stageContent}</section>
        </div>
      </main>
    </div>
  );
}

function PrototypeHeader() {
  return (
    <header className={styles.topbar}>
      <Link className={styles.brand} href="/" aria-label="MOX-ADV — на главную">
        <b>M</b><span>MOX-ADV</span>
      </Link>
      <nav aria-label="Основная навигация прототипа">
        <a className={styles.activeNav} href="#module">Стратегия</a>
        <span>Управление <i>В РАЗРАБОТКЕ</i></span>
        <span>Мониторинг <i>В РАЗРАБОТКЕ</i></span>
        <span>SEO <i>В РАЗРАБОТКЕ</i></span>
        <span>Каналы <i>VK · В РАЗРАБОТКЕ</i></span>
      </nav>
      <div className={styles.connectionState}><i />Срез доказательств · 6 разрешённых источников</div>
    </header>
  );
}

function Hero({ strategy }: { strategy: StrategyDraft }) {
  return (
    <section className={styles.hero}>
      <div>
        <p className={styles.eyebrow}>P0 · ПРОИЗВОДСТВЕННЫЙ МОДУЛЬ</p>
        <h1>Стратегия и рекламные кампании</h1>
        <p>Агент подготовил модель бизнеса, стратегию и конечный набор кампаний.</p>
      </div>
      <div className={styles.heroOutcome}>
        <span>Целевой результат</span>
        <strong>{strategy.goal}</strong>
        <small>{strategy.targetCost} · {strategy.budget}</small>
      </div>
    </section>
  );
}

function StageNavigation({ stage, onStage }: { stage: StageId; onStage: (stage: StageId) => void }) {
  const currentIndex = stages.findIndex((item) => item.id === stage);
  return (
    <ol className={classNames(styles.stageNav, styles.stageNavhorizontal)} aria-label="Путь подготовки рекламных кампаний">
      {stages.map((item, index) => (
        <li key={item.id}>
          <button
            type="button"
            className={classNames(stage === item.id && styles.currentStage, index < currentIndex && styles.passedStage)}
            onClick={() => onStage(item.id)}
            aria-current={stage === item.id ? "step" : undefined}
          >
            <span>{index < currentIndex ? "✓" : index + 1}</span>
            <div><strong>{item.label}</strong><small>{item.detail}</small></div>
          </button>
        </li>
      ))}
    </ol>
  );
}

function AgentRail({ stage, selectedCount }: { stage: StageId; selectedCount: number }) {
  const messages: Record<StageId, { title: string; copy: string }> = {
    goal: { title: "Понимание готово к проверке", copy: "Сначала показываю, как понял бизнес. Исправление владельца изменит всё последующее исследование." },
    learned: { title: "Исследование завершено", copy: "Сопоставил бизнес, конкурентов, спрос, текущий Директ и посадочную. Один риск оставил явным." },
    strategy: { title: "Решение объяснено", copy: "Показываю почему, на каких фактах, что изменится и какие ограничения сохранятся." },
    campaigns: { title: "4 рекламные гипотезы", copy: `Рекомендую ${selectedCount} кампании. Предстартовый балл задаёт порядок просмотра, а не прогноз.` },
    review: { title: "Пакет готов к проверке", copy: "Каждая кампания будет создана независимо и останется без показов." },
  };
  const message = messages[stage];
  return (
    <aside className={styles.agentRail}>
      <header><span>А</span><div><strong>Агент кампании</strong><small>Безопасная работа завершена</small></div></header>
      <section className={styles.agentMessage}>
        <p className={styles.eyebrow}>ТЕКУЩИЙ ВЫВОД</p>
        <strong>{message.title}</strong>
        <p>{message.copy}</p>
      </section>
      <section className={styles.railSnapshot}>
        <span>Срез доказательств</span><strong>84% покрытия · 6 источников</strong><small>Факты и ограничения раскрыты в шаге «Что узнал агент»</small>
      </section>
      <AutomationMap />
      <SafetyCard />
    </aside>
  );
}

function AutomationMap() {
  return (
    <section className={styles.automationMap}>
      <h3>Карта автоматизации</h3>
      <div><span>Исследование</span><strong>АГЕНТ</strong></div>
      <div><span>Бизнес-смысл</span><strong>ИСПРАВЛЯЕТ ВЛАДЕЛЕЦ</strong></div>
      <div><span>Точный пакет</span><strong>РАЗОВОЕ ПРАВО</strong></div>
      <div><span>Запуск показов и расходов</span><strong className={styles.unavailable}>ЗАПРЕЩЁН В P0</strong></div>
    </section>
  );
}

function SafetyCard() {
  return (
    <section className={styles.safetyCard}>
      <span>ГРАНИЦА P0</span>
      <strong>Создание без запуска</strong>
      <p>Показы, расходы и возобновление кампаний недоступны. Успех подтверждается повторным чтением статуса «Остановлена».</p>
    </section>
  );
}

function StageContent(props: {
  stage: StageId;
  campaigns: Campaign[];
  selectedCampaigns: Campaign[];
  currentCampaign: Campaign;
  strategy: StrategyDraft;
  authorityChecked: boolean;
  authorityPrepared: boolean;
  needsRevalidation: boolean;
  revision: number;
  businessSummary: string;
  briefEditing: boolean;
  goalEditing: boolean;
  strategyEditing: boolean;
  campaignEditing: boolean;
  creativePreviewOpen: boolean;
  onBusinessSummary: (value: string) => void;
  onBriefEditing: (editing: boolean) => void;
  onGoalEditing: (editing: boolean) => void;
  onStrategyEditing: (editing: boolean) => void;
  onCampaignEditing: (editing: boolean) => void;
  onStrategyChange: (field: keyof StrategyDraft, value: string) => void;
  onCampaignChange: (id: string, field: keyof Campaign, value: string) => void;
  onCreativePreview: () => void;
  onSelectCampaign: (id: string) => void;
  onToggleCampaign: (id: string) => void;
  onAuthorityChecked: (checked: boolean) => void;
  onPrepareAuthority: () => void;
  onRevalidate: () => void;
  onStage: (stage: StageId) => void;
}) {
  if (props.stage === "goal") {
    return (
      <GoalStage
        strategy={props.strategy}
        businessSummary={props.businessSummary}
        briefEditing={props.briefEditing}
        goalEditing={props.goalEditing}
        onBusinessSummary={props.onBusinessSummary}
        onBriefEditing={props.onBriefEditing}
        onGoalEditing={props.onGoalEditing}
        onStrategyChange={props.onStrategyChange}
        onNext={() => props.onStage("learned")}
      />
    );
  }
  if (props.stage === "learned") return <LearnedStage onNext={() => props.onStage("strategy")} />;
  if (props.stage === "strategy") {
    return (
      <StrategyStage
        strategy={props.strategy}
        revision={props.revision}
        editing={props.strategyEditing}
        onEditing={props.onStrategyEditing}
        onStrategyChange={props.onStrategyChange}
        onNext={() => props.onStage("campaigns")}
      />
    );
  }
  if (props.stage === "campaigns") {
    return (
      <CampaignsStage
        campaigns={props.campaigns}
        currentCampaign={props.currentCampaign}
        editing={props.campaignEditing}
        needsRevalidation={props.needsRevalidation}
        creativePreviewOpen={props.creativePreviewOpen}
        onEditing={props.onCampaignEditing}
        onCampaignChange={props.onCampaignChange}
        onCreativePreview={props.onCreativePreview}
        onSelectCampaign={props.onSelectCampaign}
        onToggleCampaign={props.onToggleCampaign}
        onNext={() => props.onStage("review")}
      />
    );
  }
  return (
    <ReviewStage
      selectedCampaigns={props.selectedCampaigns}
      authorityChecked={props.authorityChecked}
      authorityPrepared={props.authorityPrepared}
      needsRevalidation={props.needsRevalidation}
      revision={props.revision}
      onAuthorityChecked={props.onAuthorityChecked}
      onPrepareAuthority={props.onPrepareAuthority}
      onRevalidate={props.onRevalidate}
      onBack={() => props.onStage("campaigns")}
    />
  );
}

function SectionHead({ eyebrow, title, copy, badge }: { eyebrow: string; title: string; copy: string; badge?: string }) {
  return (
    <header className={styles.sectionHead}>
      <div><p className={styles.eyebrow}>{eyebrow}</p><h2>{title}</h2><p>{copy}</p></div>
      {badge && <strong>{badge}</strong>}
    </header>
  );
}

function GoalStage({
  strategy,
  businessSummary,
  briefEditing,
  goalEditing,
  onBusinessSummary,
  onBriefEditing,
  onGoalEditing,
  onStrategyChange,
  onNext,
}: {
  strategy: StrategyDraft;
  businessSummary: string;
  briefEditing: boolean;
  goalEditing: boolean;
  onBusinessSummary: (value: string) => void;
  onBriefEditing: (editing: boolean) => void;
  onGoalEditing: (editing: boolean) => void;
  onStrategyChange: (field: keyof StrategyDraft, value: string) => void;
  onNext: () => void;
}) {
  return (
    <>
      <SectionHead
        eyebrow="ШАГ 1 · ПОНИМАНИЕ БИЗНЕСА"
        title="Агент сначала показывает, как понял бизнес"
        copy="Сайт и доступы превращаются в короткое редактируемое описание. Владелец исправляет смысл до исследования и генерации кампаний."
        badge="6 ИСТОЧНИКОВ"
      />
      <section className={styles.businessUnderstanding}>
        <header>
          <div><span>ПОНИМАНИЕ АГЕНТА · РЕДАКЦИЯ 2</span><strong>Что именно будет рекламироваться</strong></div>
          <b>ВЛАДЕЛЕЦ МОЖЕТ ИСПРАВИТЬ</b>
        </header>
        {briefEditing ? (
          <label className={styles.briefEditor}>
            <span>Краткое описание бизнеса</span>
            <textarea value={businessSummary} onChange={(event) => onBusinessSummary(event.target.value)} rows={3} />
          </label>
        ) : (
          <p className={styles.briefSummary}>{businessSummary}</p>
        )}
        <div className={styles.briefGrid}>
          <div><span>Предложение</span><strong>Дизайн и застройка выставочных стендов под ключ</strong></div>
          <div><span>Кому и зачем</span><strong>B2B-маркетологу нужен измеримый результат выставки</strong></div>
          <div><span>Не будем утверждать</span><strong>Фиксированный срок, цену или рост продаж без доказательств</strong></div>
        </div>
        <footer>
          <div><span>САЙТ</span><span>МЕТРИКА</span><span>ИСТОРИЯ ДИРЕКТА</span><span>ЭКОНОМИКА ВЛАДЕЛЬЦА</span></div>
          <button type="button" onClick={() => onBriefEditing(!briefEditing)}>{briefEditing ? "Сохранить понимание" : "Исправить понимание"}</button>
        </footer>
      </section>
      <section className={styles.goalStatement}>
        <header><div><span>РЕКОМЕНДАЦИЯ АГЕНТА · ИЗМЕРИМЫЙ РЕЗУЛЬТАТ</span><strong>{goalEditing ? "Исправьте цель и определение результата" : "Цель теста готова к подтверждению"}</strong></div><button type="button" onClick={() => onGoalEditing(!goalEditing)}>{goalEditing ? "Сохранить цель" : "Изменить цель"}</button></header>
        {goalEditing ? (
          <div className={styles.goalEditor}>
            <label><span>Цель рекламной кампании</span><textarea rows={2} value={strategy.goal} onChange={(event) => onStrategyChange("goal", event.target.value)} /></label>
            <label><span>Что считать квалифицированным результатом</span><textarea rows={2} value={strategy.qualifiedOutcome} onChange={(event) => onStrategyChange("qualifiedOutcome", event.target.value)} /></label>
          </div>
        ) : (
          <><h3>{strategy.goal}</h3><p>Квалифицированный результат: {strategy.qualifiedOutcome}</p></>
        )}
        <footer><b>{goalEditing ? "ИЗМЕНЕНИЕ ПЕРЕСОБЕРЁТ РЕКОМЕНДАЦИИ" : "Подтверждено владельцем"}</b><small>Это цель теста, а не обещание результата или прогноз цены брифа</small></footer>
      </section>
      <section className={styles.missingAnswers}>
        <header><div><span>ОПРОС ПО НЕДОСТАЮЩИМ РЕШЕНИЯМ</span><strong>Агент уже предложил ответы — владелец исправляет только бизнес-смысл</strong></div><b>3 ОТВЕТА НУЖНЫ</b></header>
        <div>
          <label><span>Бюджет ограниченного теста</span><input value={strategy.budget} onChange={(event) => onStrategyChange("budget", event.target.value)} /><small>Предложено агентом из доступной рамки расходов</small></label>
          <label><span>География</span><input value={strategy.geography} onChange={(event) => onStrategyChange("geography", event.target.value)} /><small>Сопоставлено с продажами и операционной ёмкостью</small></label>
          <label><span>Куда вести рекламу</span><input value={strategy.landing} onChange={(event) => onStrategyChange("landing", event.target.value)} /><small>Точная посадочная; автоматическая замена URL выключена</small></label>
        </div>
      </section>
      <div className={styles.accessGrid}>
        <AccessCard title="Яндекс Директ" scope="Чтение + создание без показов" detail="Один рекламодатель · возобновление недоступно" />
        <AccessCard title="Яндекс Метрика" scope="Чтение счётчика и целей" detail="Цель «Отправка брифа» · изменение сайта недоступно" />
        <AccessCard title="Wordstat" scope="Только исследование спроса" detail="Россия · компьютер + мобильные · без кабинетной автоматизации" />
      </div>
      <details className={styles.disclosure}>
        <summary>Как изменить или отозвать доступ</summary>
        <p>Рабочий интерфейс открывает отдельный экран согласия, показывает точный рекламный аккаунт и отзывает сохранённое полномочие без ручного ввода идентификаторов.</p>
      </details>
      <PrimaryActions primary="Перейти к выводам агента" onPrimary={onNext} />
    </>
  );
}

function AccessCard({ title, scope, detail }: { title: string; scope: string; detail: string }) {
  return (
    <article className={styles.accessCard}>
      <header><i /><span>ПОДКЛЮЧЕНО</span></header>
      <h3>{title}</h3><strong>{scope}</strong><p>{detail}</p>
    </article>
  );
}

function LearnedStage({ onNext }: { onNext: () => void }) {
  return (
    <>
      <SectionHead
        eyebrow="ШАГ 2 · ЧТО УЗНАЛ АГЕНТ"
        title="Проверяемая модель бизнеса"
        copy="Компактная модель показывает, как продукт, спрос и экономика связаны с рекламной целью. Неизвестное не превращается в ноль."
        badge="84% ПОКРЫТИЯ"
      />
      <div className={styles.modelLead}>
        <div>
          <span>РЕКОМЕНДОВАННЫЙ ФОКУС</span>
          <h3>Дизайн и застройка выставочных стендов под ключ</h3>
          <p>Самая сильная комбинация рыночной возможности, готовности посадочной и измеримого квалифицированного результата.</p>
        </div>
        <b>2 альтернативы уступили по качеству доказательств</b>
      </div>
      <div className={styles.economicsGrid}>
        <MetricCard label="Средний чек" value="1,2 млн ₽" detail="подтверждено владельцем · 90 дней" />
        <MetricCard label="Вклад после прямых затрат" value="32%" detail="384 000 ₽ на продажу" />
        <MetricCard label="Бриф → продажа" value="18%" detail="срез CRM · 11 месяцев" />
        <MetricCard label="Потолок цены брифа" value="69 120 ₽" detail="расчётный максимум" accent />
        <MetricCard label="Целевой ориентир" value="18 000 ₽" detail="для первого ограниченного теста" accent />
        <MetricCard label="Операционная ёмкость" value="3 проекта / мес" detail="выше — согласовать загрузку" warning />
      </div>
      <div className={styles.readinessWorkspace}>
        <section className={styles.readinessGate}>
          <header><div><span>ГОТОВНОСТЬ К РЕКЛАМЕ</span><strong>Можно начинать ограниченный тест</strong></div><b>ЕСТЬ 1 ПРОБЕЛ</b></header>
          <div className={styles.readinessRows}>
            <ReadinessRow label="Экономика" value="Чек, вклад и цена брифа связаны" status="ГОТОВО" />
            <ReadinessRow label="Спрос" value="8 коммерческих кластеров" status="ГОТОВО" />
            <ReadinessRow label="Измерение" value="Бриф наблюдается в Метрике" status="ГОТОВО" />
            <ReadinessRow label="Посадочная" value="Добавить срок ответа на бриф" status="1 ПРАВКА" warning />
            <ReadinessRow label="Операционная ёмкость" value="Не более 3 продаж / мес" status="ОГРАНИЧЕНИЕ" />
          </div>
          <p>Статус разрешает подготовить кампании, но не обещает достижение цели и не снимает один риск посадочной.</p>
        </section>
        <section className={styles.measurementContract}>
          <header><span>КОНТРАКТ ИЗМЕРЕНИЯ · ВЕРСИЯ 1</span><strong>Что будет считаться результатом</strong></header>
          <dl>
            <div><dt>Основной результат</dt><dd>Отправка квалифицированного брифа · цель 197404321</dd></div>
            <div><dt>Промежуточные сигналы</dt><dd>Открытие формы · начало заполнения · страница «Спасибо»</dd></div>
            <div><dt>Связка клика</dt><dd>UTM + yclid сохраняются в заявке</dd></div>
            <div><dt>Наблюдение</dt><dd>7 достижений за 90 дней · окно учёта 30 дней</dd></div>
            <div><dt>Известный пробел</dt><dd>Выручка по сделке ещё не возвращается в Метрику</dd></div>
          </dl>
        </section>
      </div>
      <section className={styles.coldStartCard}>
        <div><span>РЕЖИМ ДАННЫХ</span><strong>История рекламодателя найдена</strong><p>Данные Директа и Метрики используются только как доказательства этого бизнеса.</p></div>
        <div><span>ЕСЛИ ИСТОРИИ НЕТ</span><strong>Честный старт без истории</strong><p>Агент начнёт от сайта, Wordstat и экономики, сократит выбор и расширит диапазон неопределённости — не подставит нули.</p></div>
      </section>
      <section className={styles.researchAudit}>
        <header><div><span>РАСКРЫТИЕ АНАЛИТИКИ</span><strong>Каждый вывод показывает источник, срез и границу достоверности</strong></div><b>6 ИСТОЧНИКОВ</b></header>
        <div className={styles.researchAuditGrid}>
          <article>
            <span>КОНКУРЕНТЫ · ПУБЛИЧНОЕ НАБЛЮДЕНИЕ</span><strong>12 компаний · 7 наблюдаемых объявлений</strong><p>5 из 12 ведут к форме расчёта; 3 из 12 подчёркивают единого подрядчика.</p><small>Москва · поиск · 19–21.08.2026. Расходы, конверсии и прибыльность конкурентов неизвестны.</small>
          </article>
          <article>
            <span>ТЕКУЩИЙ ЯНДЕКС ДИРЕКТ</span><strong>4 кампании · 37 активных фраз</strong><p>В выбранных кластерах пересечений нет. Две старые кампании используют неподтверждённую микроцель.</p><small>Официальный API · рекламодатель MOX Studio · последние 90 дней.</small>
          </article>
          <article>
            <span>СПРОС И ЦЕНА</span><strong>1 240 запросов · 90–140 ₽ за клик</strong><p>Частота взята из Wordstat; цена — из прогноза Директа и собственной истории.</p><small>Россия · компьютер + мобильные · срез 21.08.2026. Это диапазон доступности, не обещание цены.</small>
          </article>
          <article>
            <span>ПОСАДОЧНАЯ · КОМПЬЮТЕР + МОБИЛЬНЫЕ</span><strong>4 из 5 проверок пройдены</strong><p>Оффер, форма, измерение и мобильный CTA готовы. Не указан ожидаемый срок ответа.</p><small>Если подходящей страницы нет, агент создаёт отдельное задание на лендинг; в P0 страницу не публикует.</small>
          </article>
        </div>
      </section>
      <section className={styles.competitorMatrixCard}>
        <header><div><span>МАТРИЦА КОНКУРЕНТОВ · ПУБЛИЧНЫЕ ДАННЫЕ</span><strong>Что продают, как формулируют оффер, раскрывают ли цену и куда ведут рекламу</strong></div><b>4 ПОДРОБНО · 12 В ВЫБОРКЕ</b></header>
        <div className={styles.competitorMatrixWrap}>
          <table className={styles.competitorMatrix}>
            <thead><tr><th>Конкурент</th><th>Продукты и услуги</th><th>Наблюдаемый оффер</th><th>Публичная цена</th><th>Посадочная</th><th>Наблюдаемость рекламы</th><th>Доказательство</th></tr></thead>
            <tbody>
              <tr><td><strong>Конкурент A</strong><small>Москва · обезличено</small></td><td>Индивидуальный дизайн, производство, монтаж</td><td>«3 концепции за 5 дней» · один подрядчик</td><td><strong>от 45 000 ₽ / м²</strong><small>заявлено на странице</small></td><td><code>/stendy-pod-klyuch</code><small>Форма расчёта в первом экране</small></td><td><b>3 из 3 запросов</b><small>19–21.08.2026</small></td><td>Страница услуги + поисковое объявление</td></tr>
              <tr><td><strong>Конкурент B</strong><small>Москва · обезличено</small></td><td>Аренда модульных стендов, брендирование, монтаж</td><td>«Готовый модульный стенд за 10 дней»</td><td><strong>от 680 000 ₽</strong><small>типовой комплект</small></td><td><code>/modulnye-stendy</code><small>Калькулятор комплектации</small></td><td><b>2 из 3 запросов</b><small>19–21.08.2026</small></td><td>Каталог + два поисковых наблюдения</td></tr>
              <tr><td><strong>Конкурент C</strong><small>Санкт-Петербург · обезличено</small></td><td>Премиальные стенды, мультимедиа, сопровождение</td><td>«Сложный проект одной командой»</td><td><strong>Не опубликована</strong><small>только запрос расчёта</small></td><td><code>/premium-expo</code><small>Портфолио → форма брифа</small></td><td><b>1 из 3 запросов</b><small>20.08.2026</small></td><td>Страница + одно поисковое наблюдение</td></tr>
              <tr><td><strong>Конкурент D</strong><small>Москва · обезличено</small></td><td>Дизайн-проект стенда без производства</td><td>«Бесплатная оценка после короткого брифа»</td><td><strong>от 120 000 ₽</strong><small>только дизайн-проект</small></td><td><code>/design-project</code><small>Квиз из пяти вопросов</small></td><td><b>1 из 3 запросов</b><small>21.08.2026</small></td><td>Страница услуги + сниппет выдачи</td></tr>
            </tbody>
          </table>
        </div>
        <footer><div><span>Чего из этого нельзя заключить</span><strong>Наблюдаемость объявления не доказывает расходы, конверсии, стоимость результата, выручку или успешность конкурента.</strong></div><div><span>Как матрица влияет на решение</span><strong>Она помогает найти незакрытый оффер, ценовой контекст и подходящую посадочную, но не назначает победителя.</strong></div></footer>
      </section>
      <details className={styles.disclosure} open>
        <summary>Существенная неопределённость · загрузка производства</summary>
        <p>Если одновременно будет принято больше трёх проектов, срок производства может измениться. Агент не блокирует тест, но исключает обещание фиксированного срока из объявлений.</p>
      </details>
      <PrimaryActions primary="Посмотреть готовую стратегию" onPrimary={onNext} />
    </>
  );
}

function MetricCard({ label, value, detail, accent, warning }: { label: string; value: string; detail: string; accent?: boolean; warning?: boolean }) {
  return (
    <article className={classNames(styles.metricCard, accent && styles.metricAccent, warning && styles.metricWarning)}>
      <span>{label}</span><strong>{value}</strong><small>{detail}</small>
    </article>
  );
}

function ReadinessRow({ label, value, status, warning = false }: { label: string; value: string; status: string; warning?: boolean }) {
  return (
    <div className={styles.readinessRow}>
      <span>{label}</span><strong>{value}</strong><b className={warning ? styles.readinessWarning : undefined}>{status}</b>
    </div>
  );
}

function StrategyStage({
  strategy,
  revision,
  editing,
  onEditing,
  onStrategyChange,
  onNext,
}: {
  strategy: StrategyDraft;
  revision: number;
  editing: boolean;
  onEditing: (editing: boolean) => void;
  onStrategyChange: (field: keyof StrategyDraft, value: string) => void;
  onNext: () => void;
}) {
  const strategyRows: Array<[string, keyof StrategyDraft]> = [
    ["Бизнес-цель", "goal"],
    ["Предложение", "offer"],
    ["Аудитория", "audience"],
    ["География", "geography"],
    ["Период", "period"],
    ["Посадочная", "landing"],
    ["Бюджет", "budget"],
    ["Целевая цена результата", "targetCost"],
  ];
  return (
    <>
      <SectionHead
        eyebrow="ШАГ 3 · ГОТОВАЯ СТРАТЕГИЯ"
        title="Решение уже собрано — не пустая анкета"
        copy="Агент заполнил подтверждённые поля, объяснил технические решения и оставил владельцу редактирование бизнес-смысла."
        badge={`РЕДАКЦИЯ ${revision}`}
      />
      <div className={styles.strategyEditBar}>
        <div><span>РУЧНОЕ РЕДАКТИРОВАНИЕ</span><strong>{editing ? "Изменяйте только бизнес-смысл и публикуемые значения" : "Все поля стратегии доступны владельцу"}</strong></div>
        <button type="button" onClick={() => onEditing(!editing)}>{editing ? "Сохранить редакцию" : "Редактировать стратегию"}</button>
      </div>
      <div className={styles.strategyLayout}>
        <section className={classNames(styles.strategyFields, editing && styles.strategyFieldsEditing)}>
          {strategyRows.map(([label, field]) => (
            <label key={field}><span>{label}</span>{editing ? <input value={strategy[field]} onChange={(event) => onStrategyChange(field, event.target.value)} /> : <strong>{strategy[field]}</strong>}</label>
          ))}
        </section>
        <aside className={styles.strategyRationale}>
          <p className={styles.eyebrow}>РЕКОМЕНДАЦИЯ АГЕНТА</p>
          <h3>Поиск · 2 кампании · точная посадочная</h3>
          <p>Для новой цели ещё недостаточно зрелых конверсий, поэтому агент не включает автостратегию по цене результата, не меняет URL и не дробит бюджет.</p>
          <dl>
            <div><dt>Площадки</dt><dd>Только поиск</dd></div>
            <div><dt>Упаковка</dt><dd>Контроль + улучшение</dd></div>
            <div><dt>Измерение</dt><dd>Бриф + UTM + Метрика</dd></div>
            <div><dt>Накопление данных</dt><dd>Достаточно для 2 кампаний</dd></div>
          </dl>
        </aside>
      </div>
      <section className={styles.budgetAlignment}>
        <div><span>СООТВЕТСТВИЕ ЦЕЛИ И БЮДЖЕТА</span><strong>24 000 ₽ / нед не покрывают бизнес-цель 8 × 18 000 ₽</strong><p>При принятом ориентире цели требуется 144 000 ₽ / мес; текущий бюджет ≈104 000 ₽ / мес.</p></div>
        <div><span>РЕКОМЕНДАЦИЯ АГЕНТА</span><strong>Оставить бюджет как ограниченный тест</strong><p>Не обещать 8 брифов: проверить спрос и измерение, затем принять отдельное решение о масштабе.</p></div>
        <b>НЕ ПРОГНОЗ<br />АРИФМЕТИКА ПЛАНА</b>
      </section>
      <div className={styles.adPlanningGrid}>
        <section className={styles.queryPlan}>
          <header><div><span>КАРТА СПРОСА · 8 КЛАСТЕРОВ</span><strong>Спрос собран по намерению, а не списком ключевых фраз</strong></div><b>0 ПЕРЕСЕЧЕНИЙ</b></header>
          <div className={styles.queryRows}>
            <div><span>Квалифицированный бриф</span><strong>Высокое коммерческое намерение · 510 / мес</strong><em>вакансии · бесплатно · шаблон</em><b>УЛУЧШЕНИЕ</b></div>
            <div><span>Дизайн выставочного стенда</span><strong>Базовое коммерческое намерение · 1 240 / мес</strong><em>своими руками · фото · скачать</em><b>КОНТРОЛЬ</b></div>
            <div><span>MOX Studio</span><strong>Навигационный брендовый спрос</strong><em>не смешивать с небрендовым</em><b>ОТДЕЛЬНО</b></div>
          </div>
          <footer><span>43 семейства минус-фраз</span><span>Точная посадочная для 2 активных кластеров</span><span>Пересечения с Директом: 0</span></footer>
        </section>
        <section className={styles.learningReadiness}>
          <header><span>ГОТОВНОСТЬ К НАКОПЛЕНИЮ ДАННЫХ</span><strong>Бюджет не дробится</strong></header>
          <div><span>Наблюдаемая цена клика</span><strong>90–190 ₽</strong></div>
          <div><span>Доступный объём кликов</span><strong>126–267 / нед</strong></div>
          <div><span>Упаковка</span><strong>2 кампании</strong></div>
          <div><span>Цикл конверсии</span><strong>до 30 дней</strong></div>
          <p>Диапазон кликов — расчёт доступности по бюджету и цене клика, не прогноз конверсий.</p>
        </section>
      </div>
      <section className={styles.recommendationStory}>
        <header><span>ОБОСНОВАНИЕ РЕШЕНИЯ</span><strong>Почему это решение, а не просто заполненные настройки</strong></header>
        <div>
          <article><span>Почему сейчас</span><p>Есть подтверждённая экономика, наблюдаемый спрос и рабочая цель Метрики.</p></article>
          <article><span>На каких фактах</span><p>Сайт, Wordstat, 11 месяцев CRM и история одного рекламодателя.</p></article>
          <article><span>Что изменится</span><p>В точный пакет попадут 2 кампании, 2 семейства объявлений и один URL.</p></article>
          <article><span>Ограничения</span><p>Без обещания цены результата, расширения URL, автоподмены текста, показов и расходов.</p></article>
        </div>
      </section>
      <details className={styles.brandContract}>
        <summary><span>ПРАВИЛА БРЕНДА И УТВЕРЖДЕНИЙ · РЕДАКЦИЯ 1</span><strong>Все созданные материалы пройдут эту проверку</strong></summary>
        <div className={styles.brandGrid}>
          <div><span>Голос</span><strong>Спокойный, предметный, без рекламной гиперболы</strong></div>
          <div><span>Разрешённое утверждение</span><strong>Дизайн, производство и монтаж одной командой</strong></div>
          <div><span>Запрещено</span><strong>«Лучшие», «гарантируем результат», фиксированный срок</strong></div>
          <div><span>Источник</span><strong>Сайт + подтверждение владельца · пересмотр 90 дней</strong></div>
        </div>
      </details>
      <section className={styles.platformContract}>
        <header><div><span>ВОЗМОЖНОСТИ ЯНДЕКС ДИРЕКТА</span><strong>Применяются только проверенные функции профиля P0</strong></div><b>ПРАВИЛА 1.4</b></header>
        <div>
          <article><span>Комбинаторные объявления</span><strong>ВКЛЮЧЕНО</strong><p>Все элементы проверяются в совместимых сочетаниях.</p></article>
          <article><span>Точный URL</span><strong>ЗАФИКСИРОВАН</strong><p>Расширение и автоматическая замена посадочной выключены.</p></article>
          <article><span>Автоприменение</span><strong>ВЫКЛЮЧЕНО</strong><p>Цель, бюджет и тексты не меняются без новой редакции.</p></article>
          <article><span>Передача результатов</span><strong>P1 · УПРАВЛЕНИЕ КАМПАНИЕЙ · #80</strong><p>P0 передаёт кампанию и протокол; P1 получает зрелый результат и формирует знание для следующей гипотезы.</p></article>
        </div>
        <footer>Официальные материалы Яндекса · правила P0 1.4 · обучение на зрелых результатах закреплено за GitHub-модулем P1 #80</footer>
      </section>
      <PrimaryActions primary="Сравнить кампании" onPrimary={onNext} />
    </>
  );
}

function CampaignsStage({
  campaigns,
  currentCampaign,
  editing,
  needsRevalidation,
  creativePreviewOpen,
  onEditing,
  onCampaignChange,
  onCreativePreview,
  onSelectCampaign,
  onToggleCampaign,
  onNext,
}: {
  campaigns: Campaign[];
  currentCampaign: Campaign;
  editing: boolean;
  needsRevalidation: boolean;
  creativePreviewOpen: boolean;
  onEditing: (editing: boolean) => void;
  onCampaignChange: (id: string, field: keyof Campaign, value: string) => void;
  onCreativePreview: () => void;
  onSelectCampaign: (id: string) => void;
  onToggleCampaign: (id: string) => void;
  onNext: () => void;
}) {
  const selectedCount = campaigns.filter((campaign) => campaign.selected).length;
  return (
    <>
      <SectionHead
        eyebrow="ШАГ 4 · КОНЕЧНЫЙ НАБОР"
        title="Кампании различаются одной материальной гипотезой"
        copy="Обязательные проверки выполняются до подсчёта балла. Балл задаёт порядок просмотра и не предсказывает прибыль, цену результата или победителя."
        badge={`${selectedCount} ВЫБРАНО`}
      />
      <section className={styles.auctionPlan}>
        <header><div><span>ПЛАН АУКЦИОННОГО ЭКСПЕРИМЕНТА</span><strong>Изменение, распределение трафика и правила решения фиксируются до запуска</strong></div><b>КОНТРОЛЬ + 1 ИЗМЕНЕНИЕ</b></header>
        <div>
          {campaigns.filter((campaign) => campaign.selected).map((campaign) => (
            <article key={campaign.id}>
              <header><div><span>{campaign.type === "CONTROL" ? "КОНТРОЛЬ АУКЦИОНА" : "ИЗМЕНЕНИЕ АУКЦИОНА"}</span><strong>{campaign.title}</strong></div><b>{campaign.budget}</b></header>
              <p>{campaign.auctionChange}</p>
              <dl>
                <div><dt>Ставка и стратегия</dt><dd>{campaign.bidPolicy}</dd></div>
                <div><dt>Соответствие запросам</dt><dd>{campaign.matchingPolicy}</dd></div>
                <div><dt>Автотаргетинг</dt><dd>{campaign.autotargetingPolicy}</dd></div>
                <div><dt>Распределение трафика</dt><dd>{campaign.trafficSplit}</dd></div>
              </dl>
              <footer><div><span>Сигнал успеха</span><strong>{campaign.successSignal}</strong></div><div><span>Условие остановки</span><strong>{campaign.stopCondition}</strong></div></footer>
            </article>
          ))}
        </div>
        <small>Если платформа не поддерживает проверяемое распределение трафика, результат остаётся операционным наблюдением и не объявляется причинным доказательством.</small>
      </section>
      <div className={styles.campaignWorkspace}>
        <div className={styles.campaignGrid}>
          {campaigns.map((campaign, index) => (
            <article
              key={campaign.id}
              className={classNames(styles.campaignCard, currentCampaign.id === campaign.id && styles.activeCampaign, campaign.selected && styles.shortlistedCampaign)}
            >
              <button type="button" className={styles.campaignSelect} onClick={() => onSelectCampaign(campaign.id)}>
                <header><span>{campaign.type === "CONTROL" ? "КОНТРОЛЬ" : "УЛУЧШЕНИЕ"} · #{index + 1}</span><small>Приоритет <strong>{campaign.score}</strong> / 100</small></header>
                <h3>{campaign.title}</h3><p>{campaign.premise}</p>
                <dl><div><dt>Спрос</dt><dd>{campaign.demand}</dd></div><div><dt>Цена</dt><dd>{campaign.cost}</dd></div></dl>
                <footer><span className={!needsRevalidation && campaign.status === "VIABLE" ? styles.goodPill : styles.warnPill}>{needsRevalidation ? "НУЖНА ПОВТОРНАЯ ПРОВЕРКА" : campaign.status === "VIABLE" ? "ЖИЗНЕСПОСОБНА" : "МОЖНО ТЕСТИРОВАТЬ · ЕСТЬ ПРОБЕЛЫ"}</span><small>Доказательства {campaign.evidence}% · чувствительность {campaign.range}</small></footer>
              </button>
              <button
                type="button"
                className={styles.shortlistButton}
                onClick={() => onToggleCampaign(campaign.id)}
                disabled={campaign.status !== "VIABLE"}
              >
                {campaign.selected ? "✓ Выбрана" : campaign.status === "VIABLE" ? "+ Выбрать" : "Нужны данные"}
              </button>
            </article>
          ))}
        </div>
        <aside className={styles.campaignDetail}>
          <header className={styles.campaignDetailHead}><div><span>{currentCampaign.type === "CONTROL" ? "КОНТРОЛЬНАЯ ГИПОТЕЗА" : "ГИПОТЕЗА УЛУЧШЕНИЯ"}</span><h3>{currentCampaign.title}</h3></div><button type="button" onClick={() => onEditing(!editing)}>{editing ? "Сохранить кампанию" : "Редактировать"}</button></header>
          {editing ? (
            <div className={styles.campaignEditor}>
              <label><span>Название гипотезы</span><input value={currentCampaign.title} onChange={(event) => onCampaignChange(currentCampaign.id, "title", event.target.value)} /></label>
              <label className={styles.editorWide}><span>Что именно проверяем</span><textarea rows={2} value={currentCampaign.premise} onChange={(event) => onCampaignChange(currentCampaign.id, "premise", event.target.value)} /></label>
              <label><span>Бюджет</span><input value={currentCampaign.budget} onChange={(event) => onCampaignChange(currentCampaign.id, "budget", event.target.value)} /></label>
              <label><span>География</span><input value={currentCampaign.geography} onChange={(event) => onCampaignChange(currentCampaign.id, "geography", event.target.value)} /></label>
              <label className={styles.editorWide}><span>Кластер запросов</span><input value={currentCampaign.queryCluster} onChange={(event) => onCampaignChange(currentCampaign.id, "queryCluster", event.target.value)} /></label>
              <label className={styles.editorWide}><span>Точная посадочная</span><input value={currentCampaign.landing} onChange={(event) => onCampaignChange(currentCampaign.id, "landing", event.target.value)} /></label>
              <label className={styles.editorWide}><span>Изменение в аукционе</span><textarea rows={2} value={currentCampaign.auctionChange} onChange={(event) => onCampaignChange(currentCampaign.id, "auctionChange", event.target.value)} /></label>
              <label><span>Ставка и стратегия</span><input value={currentCampaign.bidPolicy} onChange={(event) => onCampaignChange(currentCampaign.id, "bidPolicy", event.target.value)} /></label>
              <label><span>Соответствие запросам</span><input value={currentCampaign.matchingPolicy} onChange={(event) => onCampaignChange(currentCampaign.id, "matchingPolicy", event.target.value)} /></label>
              <label><span>Автотаргетинг</span><input value={currentCampaign.autotargetingPolicy} onChange={(event) => onCampaignChange(currentCampaign.id, "autotargetingPolicy", event.target.value)} /></label>
              <label><span>Распределение трафика</span><input value={currentCampaign.trafficSplit} onChange={(event) => onCampaignChange(currentCampaign.id, "trafficSplit", event.target.value)} /></label>
              <label className={styles.editorWide}><span>Сигнал успеха</span><input value={currentCampaign.successSignal} onChange={(event) => onCampaignChange(currentCampaign.id, "successSignal", event.target.value)} /></label>
              <label className={styles.editorWide}><span>Условие остановки</span><input value={currentCampaign.stopCondition} onChange={(event) => onCampaignChange(currentCampaign.id, "stopCondition", event.target.value)} /></label>
              <label className={styles.editorWide}><span>Заголовок объявления</span><input value={currentCampaign.headline} onChange={(event) => onCampaignChange(currentCampaign.id, "headline", event.target.value)} /></label>
              <label className={styles.editorWide}><span>Текст объявления</span><textarea rows={2} value={currentCampaign.description} onChange={(event) => onCampaignChange(currentCampaign.id, "description", event.target.value)} /></label>
              <p>Материальная правка отменяет прежний балл и полномочие. Перед созданием агент повторит все проверки.</p>
            </div>
          ) : (
            <p>{currentCampaign.premise}</p>
          )}
          <div className={styles.evidenceSummary}>
            <div><span>Качество доказательств</span><strong>{currentCampaign.evidence}%</strong></div>
            <div><span>Чувствительность</span><strong>{currentCampaign.range}</strong></div>
            <div><span>Предстартовый приоритет</span><strong>{needsRevalidation ? "Нужно обновить" : `${currentCampaign.score} / 100`}</strong></div>
          </div>
          <details className={styles.viabilityBreakdown} open>
            <summary><span>Почему гипотеза допущена к тесту</span><strong>{needsRevalidation ? "ТРЕБУЕТ ПЕРЕСЧЁТА" : "5 / 5 ОБЯЗАТЕЛЬНЫХ ПРОВЕРОК"}</strong></summary>
            <div>
              <span>Экономика<strong>ГОТОВО</strong></span><span>Измерение<strong>ГОТОВО</strong></span><span>Спрос<strong>ГОТОВО</strong></span><span>Посадочная<strong>1 ПРАВКА</strong></span><span>Профиль Директа<strong>ГОТОВО</strong></span>
            </div>
            <p>Баланс: экономика 20% · спрос 18% · соответствие 18% · цена 12% · Директ 12% · измерение 10% · доказательства 10%.</p>
          </details>
          <h4>Почему гипотеза заслуживает теста</h4>
          <ul><li>Запрос показывает коммерческое намерение</li><li>Оффер совпадает с текущей посадочной</li><li>Бюджет не дробит обучение</li></ul>
          <section className={styles.creativeFamily}>
            <header><div><span>СЕМЕЙСТВО ОБЪЯВЛЕНИЙ</span><strong>{currentCampaign.creativeFamily}</strong></div><b>3 / 3 СОВМЕСТИМЫ</b></header>
            <div className={styles.assetProvenance}><span>Заголовки · черновик агента</span><span>Текст · с сайта</span><span>URL · подтверждён владельцем</span></div>
            <button type="button" onClick={onCreativePreview}>{creativePreviewOpen ? "Скрыть комбинации" : "Показать все комбинации"}</button>
          </section>
          {creativePreviewOpen && <CreativeCombinationPreview campaign={currentCampaign} />}
        </aside>
      </div>
      <div className={styles.shortlistBar}><div><span>РЕКОМЕНДАЦИЯ АГЕНТА</span><strong>{selectedCount} кампании · 24 000 ₽ / неделю</strong><small>Контроль + однофакторное улучшение. У каждой подготовлено совместимое семейство объявлений.</small></div><button type="button" onClick={onNext} disabled={selectedCount === 0}>Проверить точный пакет →</button></div>
    </>
  );
}

function CreativeCombinationPreview({ campaign }: { campaign: Campaign }) {
  const variants = [
    { label: "Комбинация 1 · точный оффер", headline: campaign.headline, description: campaign.description },
    { label: "Комбинация 2 · доказательство", headline: "Стенд от концепции до монтажа", description: "Одна команда отвечает за дизайн, производство и монтаж на выставочной площадке." },
    { label: "Комбинация 3 · следующий шаг", headline: "Обсудите стенд для вашей выставки", description: "Получите предметный бриф: задача, площадь, сроки подготовки и следующий шаг." },
  ];
  return (
    <section className={styles.creativePreview} aria-label="Предпросмотр комбинаций объявления">
      {variants.map((item) => (
        <article key={item.label}>
          <span>{item.label}</span>
          <small>Реклама · moxstudio.ru</small>
          <strong>{item.headline}</strong>
          <p>{item.description}</p>
          <footer><b>{campaign.sourceLabel}</b><em>Смысл и посадочная совпадают</em></footer>
        </article>
      ))}
      <div className={styles.compatibilityNote}><strong>Полнота материалов · 100%</strong><span>Это проверка полноты и совместимости, не прогноз кликабельности, цены результата или победителя.</span></div>
    </section>
  );
}

function ReviewStage({
  selectedCampaigns,
  authorityChecked,
  authorityPrepared,
  needsRevalidation,
  revision,
  onAuthorityChecked,
  onPrepareAuthority,
  onRevalidate,
  onBack,
}: {
  selectedCampaigns: Campaign[];
  authorityChecked: boolean;
  authorityPrepared: boolean;
  needsRevalidation: boolean;
  revision: number;
  onAuthorityChecked: (checked: boolean) => void;
  onPrepareAuthority: () => void;
  onRevalidate: () => void;
  onBack: () => void;
}) {
  return (
    <>
      <SectionHead
        eyebrow="ШАГ 5 · РЕШЕНИЕ ВЛАДЕЛЬЦА"
        title="Создать точный пакет без запуска показов"
        copy="Одно решение разрешает только выбранные редакции. Позднейшая материальная правка автоматически отменит это полномочие."
        badge={needsRevalidation ? "НУЖНА ПОВТОРНАЯ ПРОВЕРКА" : "ВНЕШНИХ ЗАПИСЕЙ НЕТ"}
      />
      <section className={styles.decisionGate}>
        <header><div><span>РЕКОМЕНДАЦИЯ</span><h3>Создать {selectedCampaigns.length} кампании и подтвердить отсутствие показов</h3></div><strong>{needsRevalidation ? "Уверенность: неактуальна" : "Уверенность: высокая"}</strong></header>
        <div className={styles.gateColumns}>
          <div><span>Почему сейчас</span><p>Экономика, спрос, измерение и посадочная достаточны для ограниченного теста.</p></div>
          <div><span>Доказательства</span><p>6 собственных, официальных или публично наблюдаемых источников · 84% покрытия · один явный риск.</p></div>
          <div><span>Точное изменение</span><p>2 кампании, 2 аукционных протокола, 2 семейства объявлений и один проверенный URL.</p></div>
          <div><span>Последствие</span><p>Объекты появятся в Директе без показов. Запуск принадлежит P1.</p></div>
        </div>
      </section>
      <div className={styles.packageList}>
        {selectedCampaigns.map((campaign, index) => (
          <article key={campaign.id}>
            <span>{index + 1}</span><div><strong>{campaign.title}</strong><small>{campaign.type === "CONTROL" ? "Контроль" : "Улучшение"} · {campaign.creativeFamily} · {campaign.budget} · {needsRevalidation ? "приоритет нужно обновить" : `приоритет ${campaign.score}/100`}</small></div><b>{needsRevalidation ? "ИЗМЕНЕНА" : "ГОТОВА"}</b>
          </article>
        ))}
      </div>
      {needsRevalidation && (
        <section className={styles.revalidationNotice} role="status">
          <div><span>МАТЕРИАЛЬНЫЕ ПОЛЯ ИЗМЕНЕНЫ</span><strong>Старый балл и полномочие отменены</strong><p>Агент повторно проверит спрос, экономику, посадочную, измерение и профиль Директа. Внешняя запись недоступна до завершения.</p></div>
          <button type="button" onClick={onRevalidate}>Пересчитать и зафиксировать редакцию {revision + 1}</button>
        </section>
      )}
      <section className={styles.publishPreflight}>
        <header><div><span>ПРОВЕРКА ПЕРЕД СОЗДАНИЕМ</span><strong>{needsRevalidation ? "Пакет изменён после последней проверки" : "Пакет проверен до внешней записи"}</strong></div><b>{needsRevalidation ? "0 / 9 АКТУАЛЬНО" : "9 / 9 ПРОЙДЕНО"}</b></header>
        <div>
          <PreflightRow label="Стратегия" value={`Редакция ${revision} зафиксирована`} stale={needsRevalidation} />
          <PreflightRow label="Измерение" value="Цель 197404321 · UTM + yclid" stale={needsRevalidation} />
          <PreflightRow label="Безопасность спроса" value="43 исключения · пересечения 0" stale={needsRevalidation} />
          <PreflightRow label="Аукционный протокол" value="Контроль + 1 изменение · трафик и остановка зафиксированы" stale={needsRevalidation} />
          <PreflightRow label="Объявления" value="6 / 6 комбинаций совпадают с посадочной" stale={needsRevalidation} />
          <PreflightRow label="Бренд и утверждения" value="4 / 4 ограничений пройдены" stale={needsRevalidation} />
          <PreflightRow label="Рамка бюджета" value="Ограниченный тест · не цель 8 брифов" stale={needsRevalidation} />
          <PreflightRow label="Настройки платформы" value="Расширение URL и автоприменение выключены" stale={needsRevalidation} />
          <PreflightRow label="Профиль создания" value="Все поля поддержаны · пропущенных полей 0" stale={needsRevalidation} />
        </div>
      </section>
      <section className={styles.exactProfile}>
        <div><span>Профиль</span><strong>Профиль создания P0 · версия 1</strong></div>
        <div><span>Размещения</span><strong>Поиск · сети выключены</strong></div>
        <div><span>URL</span><strong>Точная посадочная · расширение выключено</strong></div>
        <div><span>Эксперимент</span><strong>Контроль + 1 изменение · правила заморожены</strong></div>
        <div><span>Материалы</span><strong>2 семейства · происхождение видно</strong></div>
        <div><span>Защита</span><strong>Нет запуска · нет расходов</strong></div>
      </section>
      <section className={styles.suspendedOutcome}>
        <span>ВНЕШНЯЯ ОПЕРАЦИЯ</span><strong>Создать → сразу остановить → проверить чтением</strong><p>Каждая кампания получает независимый результат. Неоднозначный ответ запускает сверку, а не слепой повтор.</p><b>ПОКАЗЫ ВЫКЛ.</b>
      </section>
      {authorityPrepared ? (
        <div className={styles.authorityPrepared} role="status"><strong>Точное полномочие подготовлено</strong><p>В рабочем модуле следующий запрос создаст только эти редакции. В прототипе вызов API не выполняется.</p></div>
      ) : !needsRevalidation ? (
        <div className={styles.authorityCheck}>
          <input id="prototype-exact-authority" type="checkbox" checked={authorityChecked} onChange={(event) => onAuthorityChecked(event.target.checked)} />
          <label htmlFor="prototype-exact-authority"><strong>Я разрешаю создать именно этот пакет без показов</strong><small>Только эти редакции, точный URL и показанные семейства объявлений. Никаких расходов или скрытой генерации после решения.</small></label>
        </div>
      ) : null}
      <PrimaryActions secondary="Вернуться к выбору" primary={authorityPrepared ? "Полномочие готово" : needsRevalidation ? "Сначала обновите проверки" : "Подготовить точное полномочие"} onSecondary={onBack} onPrimary={onPrepareAuthority} primaryDisabled={needsRevalidation || !authorityChecked || authorityPrepared} />
    </>
  );
}

function PreflightRow({ label, value, stale = false }: { label: string; value: string; stale?: boolean }) {
  return <div className={classNames(styles.preflightRow, stale && styles.preflightStale)}><span>{label}</span><strong>{value}</strong><b>{stale ? "УСТАРЕЛО" : "ГОТОВО"}</b></div>;
}

function PrimaryActions({
  secondary,
  primary,
  onSecondary,
  onPrimary,
  primaryDisabled,
}: {
  secondary?: string;
  primary: string;
  onSecondary?: () => void;
  onPrimary: () => void;
  primaryDisabled?: boolean;
}) {
  return (
    <footer className={styles.primaryActions}>
      {secondary && <button type="button" className={styles.secondaryButton} onClick={onSecondary}>{secondary}</button>}
      <button type="button" className={styles.primaryButton} onClick={onPrimary} disabled={primaryDisabled}>{primary}</button>
    </footer>
  );
}
