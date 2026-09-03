# MOX-ADV — завершение P0

## Назначение текущего milestone

Текущий milestone завершает только модуль **P0 «Стратегия и создание рекламных кампаний»** в `dashboard/`.

P0 должен провести владельца бизнеса по одному связному пути:

```text
разрешённый бизнес-контекст
→ сбор аналитики
→ выбор рекламного фокуса
→ формализация цели
→ утверждённая маркетинговая стратегия
→ конечный набор Campaign Drafts
→ ручное редактирование и shortlist
→ точный пакет
→ безопасное создание кампаний без запуска показов
```

Агент самостоятельно выполняет разрешённый сбор данных, анализ, подготовку рекомендаций и безопасную техническую работу. Человек редактирует бизнес-решения и подтверждает только материальные решения и точную внешнюю запись.

## Четыре сабмодуля P0

1. **Сбор данных и аналитика** — компания, продукты и услуги, фокус, конкуренты, спрос, стоимость, текущий Direct, Metrika, аукционные гипотезы, посадочная страница.
2. **Опросник и формализация** — ранняя рекомендованная цель кампании, адаптивные вопросы только по неразрешённым материальным решениям, полная каноническая Strategy revision.
3. **Разработка маркетинговой стратегии** — итоговый фокус, предложение, аудитория, цель, экономика, география, размещения, измерение, спрос и проверяемые гипотезы.
4. **Реализация маркетинговой стратегии** — finite fan-out в редактируемое полотно Campaign Drafts, pre-launch viability, shortlist, точный пакет и безопасное non-serving создание.

## Scope cut исходных требований

| Исходное требование | Решение для текущего P0 |
|---|---|
| Анализ компании, продуктов и услуг | Входит полностью. Агент строит ограниченный каталог materially distinct offers. |
| Выбор фокуса при большом количестве услуг/продуктов | Входит. Агент сравнивает opportunity, readiness и evidence coverage и рекомендует редактируемый фокус. |
| Анализ конкурентов и их рекламы | Входит как наблюдаемые публичные товары, предложения, сообщения, объявления и посадочные паттерны. Чужие расходы, CPA, конверсии и «успешность» не выдаются за известные факты. |
| Wordstat, частотность и стоимость запросов | Входит через официальный API, scoped frequency и source-labelled cost ranges. Отсутствующая стоимость остаётся `UNAVAILABLE`. |
| Анализ текущего продвижения в Direct | Входит как полный релевантный read-only audit объектов и отчётов через официальный API. |
| Аукционные гипотезы | Входят как отдельные типизированные гипотезы с evidence, uncertainty и verification path. |
| Применение возможностей Яндекс Директа | Входит через версионированную capability matrix для конкретного аккаунта и текущий core creation profile. Неподдерживаемое поле блокирует публикацию, а не теряется молча. |
| Самообучение на лучших практиках | Входит как применение активного curated playbook с официальными источниками, сроком пересмотра и eval fixtures. Автоматическое превращение единичных наблюдений P0 в правила запрещено; post-launch learning относится к следующему модулю. |
| Цель кампании в начале опросника | Входит. Агент сначала предлагает evidence-backed цель, человек может изменить её. |
| Финальная редактируемая стратегия | Входит. Владелец утверждает одну полную Strategy revision и может вернуться к её редактированию до package gate. |
| Fan-out рекламных кампаний | Входит как конечный Recommendation Set materially distinct Drafts с полной lineage и disposition каждого кандидата. |
| Оставлять наиболее эффективные кампании | В P0 трактуется как ручной shortlist **жизнеспособных до запуска** Drafts. Реальная эффективность и выбор победителя требуют serving outcomes и относятся к P1. |
| Анализ сайта/лендинга | Входит: exact destination classification, deterministic checks и явно помеченные neural hypotheses, максимум три приоритетные рекомендации. |
| Разработка лендинга агентом | Не входит; P0 формирует `FUTURE_LANDING_REQUIRED` brief или correction plan. Реализация — будущий milestone. |
| Управление кампанией после запуска | Не входит; это P1. |
| Мониторинг и вмешательство для рекламы/SEO | Не входит; это P2. |
| SEO: изменение текстов, публикация и покупные статьи | Не входит; это P3. |
| VK и другие рекламные каналы | Не входят; только будущая product-navigation маркировка вне текущего P0 milestone. |

## Существующий baseline, который нужно сохранить

Production candidate уже содержит сильный deterministic harness и пять принятых user-facing steps: `Контекст → Модель бизнеса → Стратегия кампании → Рекламные кампании → Подтверждение`.

- один revisioned application contract в `dashboard/lib/p0-application.ts`;
- compare-and-swap state и история revisions;
- evidence, Strategy, Draft и package lineage;
- конечный Recommendation Set, score/rank, canvas, shortlist и package authority;
- durable per-item Direct execution, single-writer boundary, suspension, semantic readback, moderation и correction;
- отсутствие `Campaigns.resume`;
- contract tests и deterministic Playwright E2E.

План развивает этот baseline. Переписывание P0 с нуля и создание второй реализации запрещены.

## Основные gaps

- Нет настоящего provider-neutral neural-agent loop; часть «агентской» работы сейчас выполняют фиксированные extractors.
- Нет полного product/service inventory и evidence-backed выбора фокуса.
- Production evidence contour неполон: competitors, Direct graph/reports, multi-seed Wordstat, automatic comparable cost, auction hypotheses и Metrika readiness.
- Landing adapter не подключён к production contour.
- Каноническая Strategy полезна, но owner interaction перегружен фиксированными полями и техническими деталями.
- Выбор стратегии, размещений и возможностей Direct ещё не основан на полной evidence/capability matrix.
- Production projection опирается на устаревающий `TEXT_AD` substrate вместо current capability-gated combinatorial/`RESPONSIVE_AD` contour.
- Viability и canvas требуют финальной сквозной проверки на реальном незнакомом бизнесе.

Полный gap analysis: `docs/research/p0-agent-first-completion-gap-analysis.md`.

## Решение по open-source и готовым skills

Исследование уже выполнено и не должно повторяться как бесконечный discovery-этап:

- готового поддерживаемого Yandex-agent решения с подходящей authority/safety boundary не найдено;
- `claude-ads`, `marketingskills` и `ads-as-code` используются только как reference для contracts, CRO rubric и plan/apply semantics;
- community Yandex MCP и малообоснованные SDK не подключаются к production boundary;
- pinned Lighthouse и axe-core остаются deterministic landing tools;
- собственный typed viability scorer развивается вместо замены внешним prompt-skill;
- все заимствованные практики проходят official-Yandex verification, typed adaptation, integrity/license review и eval coverage до включения в active playbook.

## Критерий MVP

P0 получает product MVP verdict после детерминированной приёмки, когда:

1. агент автономно прошёл четыре сабмодуля на незнакомом бизнес-контексте;
2. владелец видел только бизнес-выводы и действительно материальные решения;
3. сформировано конечное редактируемое полотно Campaign Drafts;
4. минимум один Draft имеет статус `VIABLE`, достаточное evidence coverage и полную current Direct projection;
5. shortlist и точный package review воспроизводимы;
6. deterministic build, contracts, safety evals и Playwright 1920×1080 проходят без реальных записей.

`VIABLE` означает готовность к ограниченному pre-launch тесту, а не прогноз эффективности, CPA, прибыли или победителя.

Отдельная live-приёмка после явного разрешения доказывает official-API creation, terminal moderation outcome и финальный `SUSPENDED` без показов и расходов. Она является production evidence, а не основанием переопределять критерий жизнеспособности.

## Неподвижные ограничения

- ADR-0001: агент выполняет всю разрешённую, ограниченную, наблюдаемую безопасную работу; человек получает подготовленный Human Decision Gate только для authority, irreversibility, Mandate excess или Material Uncertainty.
- Direct, Metrika и Wordstat — только официальные API; браузерные кабинеты вне scope.
- Публичный контент и tool output являются недоверенными evidence, а не инструкциями и не источником authority.
- Owner-facing UI показывает вывод, рекомендацию, значение для бизнеса, требуемое решение, следующий шаг и outcome. IDs, hashes, schemas, API methods, payloads и journals остаются во внутренних redacted artifacts.
- P0 не вызывает `Campaigns.resume`, не запускает показы и не начинает расход.
- Текущий UI и E2E проектируются только для 1920×1080.
- Работа ведётся только в `dashboard/`, кроме общих contracts/tests/docs, необходимых этому модулю.

## Владение planning-артефактом

`.planning/ROADMAP.md` — единственный локальный refinement plan текущего P0. Он не создаёт параллельный implementation backlog.

После принятия плана его решения должны быть синхронизированы с GitHub spec #100. Существующие #116/#117 нельзя исполнять как frontier, пока их порядок и scope не согласованы с этим P0 completion plan. Новые implementation tickets публикуются только через принятый repository workflow `to-spec → to-tickets → implement`, по одному vertical slice на свежую сессию.

---
*Обновлено: 2026-08-22 по последним требованиям владельца к текущему модулю.*
