"use client";

// Throwaway UI prototype: one portfolio-first Campaigns interface, exercised through ?state=.

import Link from "next/link";
import { useEffect, useState } from "react";
import shell from "../../production-dashboard.module.css";
import PrototypeSwitcher, { type PrototypeVariant } from "../PrototypeSwitcher";
import styles from "./campaigns-prototype.module.css";

type PrototypeStateKey = "single" | "portfolio" | "decision" | "stale";
type CampaignStatus = "ready" | "decision" | "stale";
type DrawerTab = "overview" | "structure" | "audit";
type DecisionChoice = "participation" | "calculator";

type Campaign = {
  id: string;
  title: string;
  revision: string;
  audience: string;
  intent: string;
  offer: string;
  message: string;
  landing: string;
  result: string;
  budget: number;
  status: CampaignStatus;
  reason: string;
  groups: Array<{ name: string; phrases: number }>;
};

const prototypeStates: PrototypeVariant[] = [
  { key: "single", name: "1 кампания · готово", label: "1/4 · 1 кампания · готово" },
  { key: "portfolio", name: "3 кампании · готово", label: "2/4 · 3 кампании · готово" },
  { key: "decision", name: "нужно решение", label: "3/4 · нужно решение" },
  { key: "stale", name: "портфель устарел", label: "4/4 · портфель устарел" },
];

const primaryCampaign: Campaign = {
  id: "innoprom-exhibit",
  title: "Участие со стендом — ИННОПРОМ-2027",
  revision: "draft r04",
  audience: "Компании, рассматривающие участие в выставке",
  intent: "Найти условия участия со стендом",
  offer: "Форматы, сроки и условия участия",
  message: "Покажите компанию ключевым промышленным заказчикам",
  landing: "innoprom.com/exhibit",
  result: "Квалифицированное обращение",
  budget: 30000,
  status: "ready",
  reason: "Три совместимых поисковых намерения имеют одну посадочную, географию и способ измерения, поэтому агент упаковал их в одну кампанию.",
  groups: [
    { name: "Участие со стендом", phrases: 12 },
    { name: "Заявка участника", phrases: 9 },
    { name: "Стоимость стенда", phrases: 7 },
  ],
};

const portfolioCampaigns: Campaign[] = [
  {
    ...primaryCampaign,
    id: "innoprom-direct",
    title: "Прямой спрос на участие",
    revision: "draft r07",
    audience: "Компании, уже ищущие участие в ИННОПРОМ",
    intent: "Подать заявку или изучить условия",
    budget: 22000,
    reason: "Отдельный delivery key: брендовый и прямой спрос ведёт на страницу участия и использует наиболее конкретное сообщение.",
    groups: [{ name: "Участие ИННОПРОМ", phrases: 11 }, { name: "Заявка экспонента", phrases: 8 }],
  },
  {
    ...primaryCampaign,
    id: "innoprom-cost",
    title: "Стоимость и форматы стенда",
    revision: "draft r05",
    audience: "Команды, сравнивающие формат и бюджет участия",
    intent: "Оценить стоимость и комплектацию стенда",
    landing: "innoprom.com/exhibit/formats",
    budget: 20000,
    reason: "Отдельная посадочная и более узкое намерение требуют собственной кампании, чтобы не смешивать сообщения и бюджет.",
    groups: [{ name: "Стоимость участия", phrases: 10 }, { name: "Форматы стенда", phrases: 8 }],
  },
  {
    ...primaryCampaign,
    id: "innoprom-industry",
    title: "Выход на промышленных заказчиков",
    revision: "draft r03",
    audience: "Производители, ищущие деловые контакты и заказчиков",
    intent: "Найти отраслевую выставку для продвижения компании",
    landing: "innoprom.com/business-program",
    budget: 18000,
    reason: "Намерение начинается не с бренда выставки и ведёт на программу для бизнеса, поэтому агент изолировал его от прямого спроса.",
    groups: [{ name: "Промышленные выставки", phrases: 13 }, { name: "Поиск заказчиков", phrases: 9 }],
  },
];

const decisionCampaign: Campaign = {
  ...primaryCampaign,
  id: "innoprom-decision",
  revision: "draft r05",
  title: "Участие и стоимость стенда",
  status: "decision",
  budget: 30000,
  landing: "Посадочная не зафиксирована",
  reason: "Для направления стоимости подтверждены две разные посадочные. Они создают разные пользовательские пути и меняют состав портфеля.",
};

const staleCampaign: Campaign = {
  ...primaryCampaign,
  id: "innoprom-stale",
  revision: "draft r04 · из Strategy r12",
  status: "stale",
};

const stateData: Record<PrototypeStateKey, {
  strategyRevision: string;
  portfolioRevision: string;
  campaigns: Campaign[];
  usedBudget: number;
  limitBudget: number;
  coverage: string;
}> = {
  single: { strategyRevision: "r12", portfolioRevision: "r12", campaigns: [primaryCampaign], usedBudget: 30000, limitBudget: 60000, coverage: "8 из 8 направлений" },
  portfolio: { strategyRevision: "r12", portfolioRevision: "r12", campaigns: portfolioCampaigns, usedBudget: 60000, limitBudget: 60000, coverage: "8 из 8 направлений" },
  decision: { strategyRevision: "r12", portfolioRevision: "r12", campaigns: [decisionCampaign], usedBudget: 30000, limitBudget: 60000, coverage: "6 из 8 направлений" },
  stale: { strategyRevision: "r13", portfolioRevision: "r12", campaigns: [staleCampaign], usedBudget: 30000, limitBudget: 60000, coverage: "Неактуально" },
};

function stateFromLocation(): PrototypeStateKey {
  if (typeof window === "undefined") return "single";
  const value = new URL(window.location.href).searchParams.get("state");
  return value === "portfolio" || value === "decision" || value === "stale" ? value : "single";
}

function formatMoney(value: number) {
  return `${value.toLocaleString("ru-RU")} ₽`;
}

function statusLabel(status: CampaignStatus) {
  if (status === "decision") return "Нужно решение";
  if (status === "stale") return "Устарела";
  return "Готова";
}

function stageItems(state: PrototypeStateKey) {
  const campaignStatus = state === "decision" ? "Нужен 1 ответ" : state === "stale" ? "Нужна пересборка" : "Подготовлены";
  return [
    { icon: "✓", label: "Цели", status: "Завершён", tone: "done" },
    { icon: "✓", label: "Сбор сведений", status: "Завершён", tone: "done" },
    { icon: "✓", label: "Стратегия", status: "Завершён", tone: "done" },
    { icon: "4", label: "Кампании", status: campaignStatus, tone: "current" },
    { icon: "5", label: "Проверка публикации", status: "Ожидает", tone: "pending" },
  ] as const;
}

function OwnerActionBand({ state, resolved, rebuilding }: { state: PrototypeStateKey; resolved: boolean; rebuilding: boolean }) {
  if (state === "decision") {
    if (resolved) return <section className={`${styles.ownerBand} ${styles.ownerBandChecking}`}>
      <span className={styles.ownerBandIcon}>↻</span>
      <div><p>АГЕНТ ПЕРЕПРОВЕРЯЕТ ПОРТФЕЛЬ</p><strong>Решение принято только в памяти прототипа</strong><small>В рабочем продукте появилась бы новая редакция стратегии или черновика.</small></div>
    </section>;
    return <section className={`${styles.ownerBand} ${styles.ownerBandDecision}`}>
      <span className={styles.ownerBandIcon}>1</span>
      <div><p>НУЖНО ОДНО РЕШЕНИЕ</p><strong>Какой путь использовать для спроса о стоимости стенда?</strong><small>Доступны две подтверждённые посадочные; фактических данных для самостоятельного выбора нет.</small></div>
    </section>;
  }

  if (state === "stale") {
    if (rebuilding) return <section className={`${styles.ownerBand} ${styles.ownerBandChecking}`}>
      <span className={styles.ownerBandIcon}>↻</span>
      <div><p>ПЕРЕСБОРКА ЗАПУЩЕНА</p><strong>Агент сопоставляет Campaign Drafts со Strategy r13</strong><small>Это локальная имитация; данные и внешние системы не изменяются.</small></div>
    </section>;
    return <section className={`${styles.ownerBand} ${styles.ownerBandStale}`}>
      <span className={styles.ownerBandIcon}>!</span>
      <div><p>ПОРТФЕЛЬ УСТАРЕЛ</p><strong>Стратегия изменилась после подготовки кампаний</strong><small>Текущие черновики собраны из r12 и не могут быть переданы на публикацию после появления r13.</small></div>
    </section>;
  }

  return <section className={`${styles.ownerBand} ${styles.ownerBandReady}`}>
    <span className={styles.ownerBandIcon}>✓</span>
    <div><p>ДЕЙСТВИЙ ВЛАДЕЛЬЦА НЕ ТРЕБУЕТСЯ</p><strong>Агент проверил состав и обязательные поля</strong><small>Откройте кампанию только если хотите проверить детали или сообщить о существенном несоответствии.</small></div>
  </section>;
}

function CampaignRow({ campaign, onOpen }: { campaign: Campaign; onOpen: () => void }) {
  return <button type="button" className={`${styles.campaignRow} ${styles[`campaignRow_${campaign.status}`]}`} onClick={onOpen} aria-label={`Открыть кампанию «${campaign.title}»`}>
    <span className={styles.rowMarker} aria-hidden="true" />
    <span className={styles.rowMain}>
      <span className={styles.rowMeta}>{campaign.revision} · ЕПК · Поиск</span>
      <strong>{campaign.title}</strong>
      <small>{campaign.audience}</small>
      <span className={styles.intentLine}>{campaign.intent} <i>→</i> {campaign.offer}</span>
    </span>
    <span className={styles.rowOutcome}>
      <small>ПОСАДОЧНАЯ</small><strong>{campaign.landing}</strong>
      <small>РЕЗУЛЬТАТ</small><strong>{campaign.result}</strong>
    </span>
    <span className={styles.rowNumbers}>
      <small>БЮДЖЕТ</small><strong>{formatMoney(campaign.budget)} / нед.</strong>
      <span className={`${styles.statusBadge} ${styles[`status_${campaign.status}`]}`}>{statusLabel(campaign.status)}</span>
    </span>
    <span className={styles.rowChevron} aria-hidden="true">›</span>
  </button>;
}

function PortfolioRail({ state, data, onAudit }: {
  state: PrototypeStateKey;
  data: (typeof stateData)[PrototypeStateKey];
  onAudit: () => void;
}) {
  const ready = data.campaigns.filter((campaign) => campaign.status === "ready").length;
  const blocked = data.campaigns.length - ready;
  const usage = Math.min(100, Math.round((data.usedBudget / data.limitBudget) * 100));
  return <aside className={styles.portfolioRail}>
    <section>
      <p className={styles.railLabel}>ЭКСПОЗИЦИЯ</p>
      <strong className={styles.railValue}>{formatMoney(data.usedBudget)} <small>/ нед.</small></strong>
      <span className={styles.railLimit}>из лимита {formatMoney(data.limitBudget)}</span>
      <div className={styles.budgetTrack} aria-label={`Использовано ${usage}% недельного лимита`}><i style={{ width: `${usage}%` }} /></div>
    </section>
    <section>
      <p className={styles.railLabel}>ГОТОВНОСТЬ</p>
      <div className={styles.readinessCounts}><span><b>{ready}</b> готово</span><span><b>{blocked}</b> требует внимания</span></div>
    </section>
    <section>
      <p className={styles.railLabel}>ПОКРЫТИЕ СТРАТЕГИИ</p>
      <strong className={styles.coverageValue}>{data.coverage}</strong>
      <button type="button" className={styles.auditLink} onClick={onAudit} disabled={state === "stale"}>Как агент собрал состав <span>→</span></button>
    </section>
    <footer><span>Яндекс Директ</span><strong>Записей и расходов ещё нет</strong></footer>
  </aside>;
}

function DrawerTabs({ tab, onChange }: { tab: DrawerTab; onChange: (tab: DrawerTab) => void }) {
  return <nav className={styles.drawerTabs} aria-label="Разделы кампании">
    <button type="button" aria-pressed={tab === "overview"} className={tab === "overview" ? styles.activeTab : ""} onClick={() => onChange("overview")}>Обзор</button>
    <button type="button" aria-pressed={tab === "structure"} className={tab === "structure" ? styles.activeTab : ""} onClick={() => onChange("structure")}>Структура</button>
    <button type="button" aria-pressed={tab === "audit"} className={tab === "audit" ? styles.activeTab : ""} onClick={() => onChange("audit")}>Происхождение</button>
  </nav>;
}

function CampaignOverview({ campaign, onNotice }: { campaign: Campaign; onNotice: (message: string) => void }) {
  return <div className={styles.drawerBody}>
    <section className={styles.adPreview}>
      <p>ПРЕДВАРИТЕЛЬНЫЙ ВИД ДЛЯ ПОЛЬЗОВАТЕЛЯ</p>
      <div><span>Реклама · {campaign.landing}</span><strong>{campaign.offer} — ИННОПРОМ-2027</strong><small>{campaign.message}. Узнайте форматы, сроки и условия участия.</small></div>
    </section>
    <section className={styles.hypothesisBlock}>
      <p>БИЗНЕС-СМЫСЛ</p><strong>{campaign.audience}</strong><span>{campaign.intent} <i>→</i> {campaign.offer} <i>→</i> {campaign.result}</span>
    </section>
    <dl className={styles.detailGrid}>
      <div><dt>Почему это отдельная кампания</dt><dd>{campaign.reason}</dd></div>
      <div><dt>Профиль размещения</dt><dd>ЕПК · Поиск · сети отключены</dd></div>
      <div><dt>География и период</dt><dd>Россия · до 30.06.2027</dd></div>
      <div><dt>Измерение</dt><dd>Квалифицированное обращение; ≤30 000 ₽ — экономический предел, не прогноз CPA</dd></div>
    </dl>
    <div className={styles.correctionActions}>
      <button type="button" onClick={() => onNotice("Открыт путь изменения Draft-local полей: текстов, ключевых фраз и минус-фраз")}>Исправить черновик</button>
      <button type="button" onClick={() => onNotice("Бизнес-смысл маршрутизирован в новую редакцию Стратегии")}>Сообщить о несоответствии стратегии</button>
    </div>
  </div>;
}

function CampaignStructure({ campaign }: { campaign: Campaign }) {
  return <div className={styles.drawerBody}>
    <section className={styles.structureRoot}><span>БУДУЩАЯ КАМПАНИЯ</span><strong>{campaign.title}</strong><small>ЕПК · Поиск · максимум переходов · сети отключены</small></section>
    <div className={styles.structureStem} />
    <section className={styles.groupList}>
      {campaign.groups.map((group) => <article key={group.name}><div><span>ГРУППА ОБЪЯВЛЕНИЙ</span><strong>{group.name}</strong></div><b>{group.phrases} фраз</b><small>2 объявления · минус-фразы проверены</small></article>)}
    </section>
    <aside className={styles.structureNote}>Все публикуемые поля доступны до расхода. Точная API-проекция появится на следующем этапе.</aside>
  </div>;
}

function CampaignAudit({ campaign }: { campaign: Campaign }) {
  return <div className={styles.drawerBody}>
    <section className={styles.auditSummary}><p>ПОЧЕМУ ЭТА КАМПАНИЯ В ТЕКУЩЕМ СОСТАВЕ</p><strong>{campaign.reason}</strong></section>
    <ol className={styles.auditSteps}>
      <li><b>1</b><span><strong>Strategy {campaign.id === "innoprom-stale" ? "r12" : "r12"}</strong><small>Аудитория, предложение, результат, бюджет и посадочная</small></span></li>
      <li><b>2</b><span><strong>Проверка применимости</strong><small>Поиск доступен; профиль ЕПК поддерживает выбранную структуру</small></span></li>
      <li><b>3</b><span><strong>Упаковка направлений</strong><small>{campaign.groups.length} совместимых групп объединены по delivery key</small></span></li>
      <li><b>4</b><span><strong>Campaign Draft {campaign.revision}</strong><small>Обязательные поля и измерение проверены</small></span></li>
    </ol>
    <details className={styles.auditDisclosure}><summary>Показать скрытые и объединённые направления</summary><div><p>2 направления объединены как дублирующие по посадочной и сообщению.</p><p>1 направление отложено: сезонный спрос не пересекает окно стратегии.</p><p>Внутренний Recommendation Set и reason codes сохранены в audit trail.</p></div></details>
  </div>;
}

function CampaignDrawer({ campaign, initialTab, onClose, onNotice }: {
  campaign: Campaign;
  initialTab: DrawerTab;
  onClose: () => void;
  onNotice: (message: string) => void;
}) {
  const [tab, setTab] = useState<DrawerTab>(initialTab);
  return <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={`Кампания ${campaign.title}`}>
      <header className={styles.drawerHeader}>
        <div><p>{campaign.revision} · ЯНДЕКС ДИРЕКТ</p><h2>{campaign.title}</h2><span className={`${styles.statusBadge} ${styles[`status_${campaign.status}`]}`}>{statusLabel(campaign.status)}</span></div>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Закрыть карточку кампании">×</button>
      </header>
      <DrawerTabs tab={tab} onChange={setTab} />
      {tab === "overview" && <CampaignOverview campaign={campaign} onNotice={onNotice} />}
      {tab === "structure" && <CampaignStructure campaign={campaign} />}
      {tab === "audit" && <CampaignAudit campaign={campaign} />}
    </aside>
  </div>;
}

function DecisionDialog({ choice, onChoice, onApply, onClose }: {
  choice: DecisionChoice;
  onChoice: (choice: DecisionChoice) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  return <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={styles.decisionDialog} role="dialog" aria-modal="true" aria-labelledby="decision-title">
      <header><div><p>МАТЕРИАЛЬНАЯ НЕОПРЕДЕЛЁННОСТЬ</p><h2 id="decision-title">Куда вести спрос о стоимости стенда?</h2></div><button type="button" className={styles.closeButton} onClick={onClose} aria-label="Закрыть решение">×</button></header>
      <p className={styles.decisionIntro}>Стратегия допускает обе страницы, но они меняют пользовательский путь и структуру портфеля. Фактических данных о качестве обращений ещё нет.</p>
      <div className={styles.evidenceLine}><span>Стратегия: обе допустимы</span><span>Сайт: обе доступны</span><span>Данных для выбора нет</span></div>
      <div className={styles.choiceList}>
        <label htmlFor="landing-participation" aria-label="Оставить общую страницу участия" className={choice === "participation" ? styles.selectedChoice : ""}><input id="landing-participation" type="radio" name="landing" checked={choice === "participation"} onChange={() => onChoice("participation")} /><span><strong>Оставить общую страницу участия</strong><small>Направление остаётся внутри одной кампании вместе с прямым спросом.</small><b>Состав: 1 кампания · 30 000 ₽ / нед.</b></span></label>
        <label htmlFor="landing-calculator" aria-label="Использовать страницу форматов и стоимости" className={choice === "calculator" ? styles.selectedChoice : ""}><input id="landing-calculator" type="radio" name="landing" checked={choice === "calculator"} onChange={() => onChoice("calculator")} /><span><strong>Использовать страницу форматов и стоимости</strong><small>Направление отделяется в самостоятельную кампанию из-за другой посадочной.</small><b>Состав: 2 кампании · общий лимит не меняется</b></span></label>
      </div>
      <footer><small>Применение создаст новую редакцию и запустит повторную проверку. Ничего не будет опубликовано.</small><button type="button" className={styles.primaryButton} onClick={onApply}>Применить решение</button></footer>
    </section>
  </div>;
}

export default function CampaignsPrototype() {
  const [prototypeState, setPrototypeState] = useState<PrototypeStateKey>("single");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("overview");
  const [notice, setNotice] = useState("");
  const [showDecision, setShowDecision] = useState(false);
  const [decisionChoice, setDecisionChoice] = useState<DecisionChoice>("participation");
  const [decisionResolved, setDecisionResolved] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  useEffect(() => {
    function syncFromUrl() { setPrototypeState(stateFromLocation()); }
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedCampaignId(null);
        setShowDecision(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const data = stateData[prototypeState];
  const selectedCampaign = data.campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null;
  const stages = stageItems(prototypeState);

  function changeState(next: string) {
    const value: PrototypeStateKey = next === "portfolio" || next === "decision" || next === "stale" ? next : "single";
    const url = new URL(window.location.href);
    url.searchParams.delete("variant");
    url.searchParams.set("state", value);
    window.history.replaceState({}, "", url);
    setPrototypeState(value);
    setSelectedCampaignId(null);
    setShowDecision(false);
    setDecisionResolved(false);
    setRebuilding(false);
    setNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openCampaign(id: string, tab: DrawerTab = "overview") {
    setDrawerTab(tab);
    setSelectedCampaignId(id);
  }

  function showPrototypeNotice(message: string) {
    setNotice(`Прототип: ${message}. Реальных изменений нет.`);
  }

  function handlePrimaryAction() {
    if (prototypeState === "decision") {
      setShowDecision(true);
      return;
    }
    if (prototypeState === "stale") {
      setRebuilding(true);
      showPrototypeNotice("агент начал пересборку портфеля из Strategy r13");
      return;
    }
    showPrototypeNotice("точные редакции переданы в локальный сценарий проверки публикации; объекты в Директе не создавались");
  }

  function applyDecision() {
    setShowDecision(false);
    setDecisionResolved(true);
    showPrototypeNotice(decisionChoice === "participation" ? "выбрана общая страница участия и запущена повторная проверка" : "выбрано разделение по странице форматов и запущена повторная проверка");
  }

  const readyState = prototypeState === "single" || prototypeState === "portfolio";
  const primaryLabel = prototypeState === "decision" ? "Решить вопрос" : prototypeState === "stale" ? "Пересобрать портфель" : "Перейти к проверке публикации";
  const primaryDisabled = decisionResolved || rebuilding;

  return <div className={`${shell.dashboard} ${styles.prototypeRoot}`}>
    <header className={shell.topbar}>
      <Link className={shell.brand} href="/" aria-label="MOX-ADV — на главную"><b>M</b><span>MOX-ADV</span></Link>
      <nav aria-label="Основная навигация">
        <Link className={shell.activeNav} href="/">Стратегия</Link>
        <span>Управление<i>В РАЗРАБОТКЕ</i></span>
        <span>Мониторинг<i>В РАЗРАБОТКЕ</i></span>
        <span>Поиск<i>В РАЗРАБОТКЕ</i></span>
        <span>Каналы<i>VK · В РАЗРАБОТКЕ</i></span>
      </nav>
    </header>

    <main className={`${shell.pageA} ${styles.prototypePage}`}>
      <aside className={styles.prototypeNotice}><strong>ПРОТОТИП · ОДНА ФОРМУЛА</strong><span>Переключатель внизу меняет только состояние данных. Записей, публикаций и расходов нет.</span></aside>
      <ol className={`${shell.stageNav} ${shell.stageNavhorizontal}`} aria-label="Путь подготовки рекламных кампаний">
        {stages.map((stage) => <li key={stage.label}><div className={`${shell.stageItem} ${stage.tone === "current" ? shell.currentStage : ""} ${stage.tone === "done" ? shell.passedStage : ""}`}><span>{stage.icon}</span><div><strong>{stage.label}</strong><small>{stage.status}</small></div></div></li>)}
      </ol>

      <section className={`${shell.ownerWorkspace} ${shell.ownerWorkspaceFull} ${styles.prototypeWorkspace}`} aria-live="polite">
        <div className={`${shell.artifact} ${styles.prototypeArtifact}`}>
          <header className={styles.pageHeader}>
            <div><p className={styles.eyebrow}>ТЕКУЩИЙ РЕЗУЛЬТАТ РАБОТЫ АГЕНТА</p><h1>Кампании</h1><p>{data.campaigns.length === 1 ? "Подготовлена 1 будущая кампания" : `Подготовлены ${data.campaigns.length} будущие кампании`} из действующей стратегии.</p></div>
            <div className={styles.revisionBlock}><span>СТРАТЕГИЯ</span><strong>{data.strategyRevision}</strong><small>{prototypeState === "stale" ? `портфель из ${data.portfolioRevision}` : "актуальна"}</small></div>
          </header>

          <OwnerActionBand state={prototypeState} resolved={decisionResolved} rebuilding={rebuilding} />

          <div className={styles.portfolioGrid}>
            <section className={styles.portfolioRegister}>
              <header><div><p>ТЕКУЩИЙ ПОРТФЕЛЬ</p><h2>{data.campaigns.length === 1 ? "1 будущая кампания" : `${data.campaigns.length} будущие кампании`}</h2></div><span>Бизнес-смысл + полный черновик</span></header>
              <div className={styles.campaignRows}>
                {data.campaigns.map((campaign) => <CampaignRow key={campaign.id} campaign={campaign} onOpen={() => openCampaign(campaign.id)} />)}
              </div>
              {data.campaigns.length === 1 && <div className={styles.singleExplanation}><span>Почему одна?</span><p>{data.campaigns[0].reason}</p></div>}
            </section>
            <PortfolioRail state={prototypeState} data={data} onAudit={() => openCampaign(data.campaigns[0].id, "audit")} />
          </div>

          <footer className={styles.handoffFooter}>
            <div><strong>{readyState ? "Следующий этап зафиксирует точные редакции" : prototypeState === "decision" ? "Передача недоступна до повторной проверки" : "Устаревшие редакции нельзя передавать дальше"}</strong><span>{readyState ? "Переход не создаёт кампании в Яндекс Директе и не разрешает расходы." : "Публикация и внешние записи остаются отдельным решением."}</span></div>
            <button type="button" className={styles.primaryButton} disabled={primaryDisabled} onClick={handlePrimaryAction}>{primaryDisabled ? "Проверка выполняется" : primaryLabel}</button>
          </footer>
        </div>
      </section>

      {notice && <div className={styles.localNotice} role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Закрыть сообщение">×</button></div>}
    </main>

    {selectedCampaign && <CampaignDrawer key={`${selectedCampaign.id}-${drawerTab}`} campaign={selectedCampaign} initialTab={drawerTab} onClose={() => setSelectedCampaignId(null)} onNotice={showPrototypeNotice} />}
    {showDecision && <DecisionDialog choice={decisionChoice} onChoice={setDecisionChoice} onApply={applyDecision} onClose={() => setShowDecision(false)} />}
    <PrototypeSwitcher variants={prototypeStates} current={prototypeState} onChange={changeState} ariaLabel="Переключатель состояний данных прототипа" previousLabel="Предыдущее состояние" nextLabel="Следующее состояние" />
  </div>;
}
