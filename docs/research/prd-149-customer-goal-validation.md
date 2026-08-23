# Валидация PRD #149 против конечной цели и потребностей заказчика

**Дата проверки:** 2026-08-23

**PRD:** [#149 «P0 · Подготовить стратегию и жизнеспособные рекламные кампании»](https://github.com/ElJeskos/MOX-ADV/issues/149)

**Режим:** product/spec validation; GitHub issue не изменялся, production API-вызовы и внешние записи не выполнялись.

## Короткий вердикт

**По продуктовому направлению — условно принято. Как implementation-ready PRD — пока не принято.**

PRD хорошо отражает главный P0 outcome: непрофессиональный владелец получает от агента готовую, объяснимую и редактируемую Campaign Strategy, конечное полотно materially distinct Campaign Drafts, рекомендуемый shortlist и безопасную возможность создать выбранный пакет в Яндекс Директе без запуска показов. Он также правильно отделяет P0 от P1–P3 и исправляет два опасных ожидания заказчика:

1. публично нельзя достоверно определить расходы, CPA, конверсии или прибыльность кампаний конкурента;
2. до запуска нельзя честно выбрать «самую эффективную» кампанию — можно оценить только готовность к ограниченному тесту, а winner определяется после зрелых результатов в P1.

Но текущий текст нельзя отдавать на реализацию одной задачей. В нём остаются пять блокирующих неопределённостей:

1. нет отдельного owner-visible контракта **Business Model и unit economics**;
2. не описан путь подключения и согласия на Direct/Metrika/Wordstat, включая новый бизнес без существующего рекламного аккаунта;
3. `VIABLE` и Product MVP можно формально доказать на controlled evidence собственным же score-контрактом, не доказав полезность на реальном незнакомом бизнесе;
4. «current capability-gated Direct projection» не фиксирует тонкий publish profile v1 и может разрастись до поддержки всей платформы;
5. issue имеет `ready-for-agent`, 70 user stories и ноль дочерних delivery slices, что противоречит принятому delivery workflow и требованию минимализма.

Рекомендуемый статус: **сначала product-owner review и точечная правка PRD, затем `to-tickets`; до этого снять `ready-for-agent` с #149.**

## 1. Проверяемая конечная цель P0

Из брифа заказчика, [CONTEXT.md](../../CONTEXT.md), [ADR-0001](../adr/0001-agent-owns-safe-work.md) и parent module [#79](https://github.com/ElJeskos/MOX-ADV/issues/79) следует такой P0 promise:

> Для одного бизнеса AI-агент самостоятельно собирает разрешённые факты, формирует проверяемую модель бизнеса, предлагает рекламную цель и фокус, подготавливает готовую Campaign Strategy и конечное полотно редактируемых Campaign Drafts. Человек исправляет только бизнес-смысл и принимает материальные решения. Как минимум один Draft может быть признан готовым к ограниченному pre-launch test только при достаточных evidence, измеримости, пригодной посадочной странице и полной поддерживаемой проекции Яндекс Директа.

Это **не** обещание прибыльности и **не** полный продуктовый lifecycle:

- P1 управляет запущенными кампаниями и определяет результативность на зрелых данных;
- P2 отвечает за мониторинг и вмешательство;
- P3 — за SEO, контент и внешние публикационные пайплайны;
- создание лендинга, VK и другие каналы остаются будущими возможностями.

## 2. Coverage matrix

| Потребность заказчика | Покрытие в #149 | Вердикт / уточнение |
|---|---|---|
| Продукт построен вокруг AI-агента | Agent-first owner journey, Agent-Owned Work, typed tool loop | **Полное** |
| Опрос, модель бизнеса и цель в начале | Цель — первый этап; агент предлагает и владелец редактирует | **Частичное:** цель покрыта, но формальный Business Model и unit economics не заданы |
| Готовая стратегия с ручным редактированием | Stories 33–39, business-only editor | **Полное** |
| Сбор данных по компании | Analytics Evidence Snapshot, first-party research | **Полное по контуру**, но нужен explicit consent/connect flow |
| Выбор фокуса при множестве услуг | Stories 6–8 | **Полное** |
| Исследование конкурентов | Stories 15–16, bounded public observations | **Корректно ограничено:** активность и сообщения — да; чужая эффективность — нет |
| Wordstat: частота, регион, устройства, сезонность | Stories 17–19 | **Полное**, если linked contract остаётся нормативным |
| Понимание цены запросов | Comparable cost range, source/date/scope | **Полное с важной коррекцией:** Wordstat не является источником CPC |
| Аудит текущего Direct | Story 23 и полный account/report audit в decisions | **Полное для существующего рекламодателя**; новый рекламодатель не описан |
| Fan-out альтернатив | Stories 40–44, finite Recommendation Set | **Полное концептуально**, но нужен anti-fragmentation/learning-volume guard |
| Оставлять наиболее эффективные варианты | Shortlist и comparative pre-launch score | **Только pre-launch priority в P0**; фактический winner — P1 |
| Гипотезы рекламного аукциона | Story 22, typed hypotheses | **Полное** |
| Использование актуальных функций Директа | Account-specific capabilities, ResponsiveAd/combinatorial contour | **Частичное:** принцип есть, profile v1 не заморожен |
| Лучшие практики и самообучение | Versioned curated playbook, запрет автоматической promotion | **Безопасно для P0**, но «самообучение» отложено и требует явного roadmap handoff |
| Анализ существующей посадочной | Stories 26–29, deterministic facts vs neural hypotheses | **Полное для advisory**, но device scope не задан |
| Создание отсутствующего лендинга | `FUTURE_LANDING_REQUIRED` brief | **Корректно отложено**, как и просил заказчик |
| Редактируемое полотно кампаний | Stories 40–54 | **Полное** |
| Скоринг жизнеспособности | Stories 45–48, eligibility before score | **Сильная основа**, но экономическая жизнеспособность недоопределена |
| Безопасное создание кампаний | Exact package authority, suspend, readback, moderation | **Полное и сильнее исходного брифа** |
| P1: управление | Explicit Out of Scope / handoff in `SUSPENDED` | **Правильно отложено** |
| P2: мониторинг и вмешательство | Explicit Out of Scope | **Правильно отложено** |
| P3: SEO, статьи, paid-link marketplaces | Explicit Out of Scope | **Правильно отложено** |
| VK и будущие разделы «в разработке» | Только Out of Scope | **Не покрыто:** нужен owner общего Dashboard / Integrated Prototype |
| Минимализм и отсутствие будущей переделки | Typed owner seam, immutable/versioned contracts | **Архитектурно хорошо, delivery scope слишком велик** |

## 3. Что PRD исправляет правильно

### 3.1. «Успех конкурентов» нельзя выдавать за факт

Direct API и Reports относятся к данным авторизованного рекламодателя. Публичное наблюдение может доказать наличие оффера, сообщения, посадочной или объявления в определённом query/region/time sample, но не чужие spend, CPA, conversions, ROI или profitability.

Поэтому stories 15–16 и соответствующая implementation boundary правильны. Следует дополнительно запретить фразы вида «90% конкурентов запускают X», если не сохранены:

- правило формирования competitor set;
- размер выборки и denominator;
- query/region/device/time scope;
- число фактически наблюдавшихся случаев;
- источники и ограничения наблюдения.

### 3.2. «Жизнеспособность» до запуска — не прогноз результата

Принятый [Pre-launch Viability Score](./pre-launch-viability-score.md) правильно отделяет hard eligibility от сравнительного ранжирования. `score=73` не означает 73% успеха, прогноз CPA или прибыльность. Реальную результативность можно оценить только после serving и зрелых conversion/economics данных.

Это принципиально правильная корректировка ожидания «оставить самые эффективные». P0 выбирает обоснованные **кандидаты на тест**, P1 проводит тест и определяет дальнейшее действие.

### 3.3. Product MVP и live write разделены

Пользовательская ценность полотна может быть проверена без риска production write. Отдельная live acceptance затем доказывает официальный API contour, semantic readback и confirmed `SUSPENDED`. Это сильнее исходного брифа и совместимо с completion parent module #79, если закрытие #149 требует **обоих** gates.

## 4. Блокирующие пробелы

### 4.1. Нет полноценного Business Model и unit economics

Customer brief прямо требует сформировать модель бизнеса. Сейчас PRD показывает «что агент узнал» и хранит offer/audience/goal/budget/target result cost, но не определяет отдельный owner-visible Business Model.

Минимальный контракт должен содержать с provenance и confidence:

- продукт/услугу и реальный qualified outcome;
- сегменты клиентов, decision maker и buying context;
- revenue model и sales cycle;
- средний чек или value of qualified result;
- contribution/gross margin либо явно недоступное значение;
- lead-to-sale rate, repeat/LTV horizon, если они нужны для target economics;
- операционную capacity и ограничения;
- сезонность, географию, exclusions и ключевые допущения.

`VIABLE` нельзя присваивать только потому, что введены положительные budget и target result cost. Если maximum economically acceptable CPA/CAC нельзя обосновать, это Material Uncertainty: Draft может быть `TESTABLE_WITH_GAPS` или `INSUFFICIENT_EVIDENCE`, но не экономически «готов».

**Добавить user story:** владелец видит и исправляет компактную модель бизнеса до утверждения Strategy; target result cost выводится из подтверждённой экономики либо становится подготовленным Human Decision Gate.

### 4.2. Нет onboarding/access readiness

Stories предполагают Direct, Metrika, Wordstat и private evidence, но не описывают действие, которое неизбежно принадлежит человеку: авторизацию и выбор допустимого advertiser scope.

Нужны два явных пути:

1. **Existing advertiser:** безопасно подключить Direct/Metrika/Wordstat, выбрать advertiser/counter без ручных ID, показать scope и возможность отозвать доступ.
2. **New advertiser:** не требовать существующую статистику, честно маркировать unavailable evidence и использовать допустимый fallback profile.

Credential consent не должен скрываться как Agent-Owned Work. Агент может подготовить минимальный запрос доступа, но владелец предоставляет authority.

### 4.3. Acceptance oracle недостаточно независим

Текущий Product MVP допускает controlled evidence и требует один `VIABLE` Draft. Это может проверить код, но не доказать, что агент полезен для незнакомого бизнеса.

Нужны два разных acceptance scenarios:

- **positive pilot:** заранее отобранный реальный незнакомый бизнес с существующей релевантной посадочной и достаточным live read-only evidence; ожидается минимум один `VIABLE` Draft;
- **honesty pilot:** бизнес без достаточного спроса/измеримости/посадочной; ожидается отсутствие ложного `VIABLE`, ясный blocker и repair plan.

Контрактные fixtures остаются для воспроизводимости, но не заменяют product pilot. Production write всё ещё не нужен для Product MVP.

### 4.4. Не заморожен тонкий Direct publish profile v1

Официальный Direct API v501 поддерживает UnifiedCampaign и ResponsiveAd. [Уведомление Яндекса об обновлении API](https://yandex.ru/dev/direct/doc/ru/update-tga) говорит, что с 30 июня Text & Image ads в unified performance campaigns доступны только для редактирования, а `Ads.add.TextAd` создаёт `RESPONSIVE_AD`; новые объявления должны использовать combinatorial format. См. также [Ad object](https://yandex.com/dev/direct/doc/en/objects/ad), [Ads.add](https://yandex.com/dev/direct/doc/en/ads/add) и [Combinatorial ads](https://yandex.com/support/direct/en/unified-performance-campaign/create-comb-ad).

Фраза «current capability-gated» не отвечает, что именно обязано работать в P0. Нужен versioned `P0 Campaign Creation Profile v1`, например:

- один advertiser и одна валюта;
- `UNIFIED_CAMPAIGN` / `UNIFIED_AD_GROUP`;
- один явно выбранный Search profile;
- `RESPONSIVE_AD` с полным набором обязательных titles/texts;
- exact geo, schedule, landing, tracking, negative phrases;
- explicit keywords и account-supported autotargeting policy;
- Metrika binding и measurement plan;
- только явно поддержанные extensions/assets;
- все остальные возможности имеют status `NOT_IMPLEMENTED`, `UNAVAILABLE` или `CONDITIONALLY_ELIGIBLE`, а выбранное неподдержанное поле блокирует publish.

Это не запрещает будущие профили; оно делает MVP конечным и проверяемым.

### 4.5. Scope не готов к одной реализации

#149 содержит четыре product submodules, cross-cutting agent runtime, 70 stories, два acceptance gates и интеграцию нескольких provider APIs. При этом issue помечен `ready-for-agent` и не декомпозирован.

Согласно [delivery workflow](../agents/delivery-workflow.md), после принятия spec нужно выполнить `to-tickets`, создать independently verifiable vertical slices и только затем отдавать frontier tickets в `/ready`. Иначе минимализм существует в тексте, но не в delivery.

## 5. Существенные уточнения, не блокирующие product sign-off

### 5.1. Fan-out не должен дробить learning volume

Яндекс указывает, что conversion strategies требуют достаточных conversion данных и бюджета; при недостатке данных кампании рекомендуется объединять или выбирать более частую funnel goal. См. [strategy selection](https://yandex.com/support/direct/en/strategies/select-strategy), [Maximize conversions](https://yandex.com/support/direct/en/strategies/average-cpa) и [insufficient conversions](https://yandex.com/support/direct/en/troubleshooting/conversions).

Поэтому canvas может показывать много гипотез, но publish package не должен автоматически создавать отдельную кампанию на каждый keyword cluster. Зафиксировать:

- packing по принятому `delivery_key`;
- control плюс не более двух однофакторных improvement hypotheses на bucket;
- budget/learning sufficiency до split;
- shortlist может содержать меньше live campaigns, чем canvas Drafts.

### 5.2. Creative output и policy readiness должны быть явными

`complete current projection` должен включать owner-visible preview реально публикуемых titles, texts, URL, tracking и supported assets. Нужно зафиксировать:

- ad-to-landing message match;
- factual-claim evidence;
- запрещённые или регулируемые категории;
- обязательные disclaimers;
- права/provenance на изображения и видео, если они входят в profile;
- moderation preflight и исправление через тот же Draft flow.

### 5.3. Desktop scope Dashboard не равен device scope рекламы

Ограничение 1920×1080 относится к интерфейсу MOX-ADV. Оно не должно автоматически ограничивать аудит внешней landing page. Если Draft допускает mobile traffic, destination readiness должна проверяться на соответствующем device scope; иначе mobile delivery нужно отключить или показать как gap.

### 5.4. Initial curated playbook — отдельный deliverable

PRD требует approved versioned playbook, но не определяет seed release. До Product MVP нужен `playbook-v1` с:

- официальным source и observed/review/expiry dates;
- applicability predicates;
- conflicts и exceptions;
- eval fixture для каждого material rule;
- owner/reviewer процесса обновления.

Pre-launch outcomes не должны автоматически становиться best practice. Будущая learning logic должна проходить через Knowledge Claim → replicated evidence → Promotion Policy, как уже принято в domain model.

### 5.5. Future-module visibility не имеет owner

P0 правильно исключает P1–P3 и VK, но бриф отдельно требует показывать будущие разделы как «в разработке». Это не должно становиться P0 logic. Требование следует закрепить за Integrated Prototype / общим Dashboard shell:

- P1 «Управление»;
- P2 «Мониторинг»;
- P3 «SEO»;
- VK/другие каналы — non-interactive roadmap state.

P0 должен экспортировать стабильные versioned outputs; общий shell отвечает за navigation placeholders.

## 6. Рекомендуемый тонкий P0

### Must deliver

1. Один business/advertiser scope и один agent-owned journey.
2. Business Model summary с economics, evidence и assumptions.
3. Agent-recommended editable goal и product focus.
4. Бounded first-party, competitor, multi-seed Wordstat, comparable-cost, current Direct, Metrika и destination research.
5. Одна complete Campaign Strategy revision.
6. Конечный canvas: один control и до двух material improvements на совместимый delivery bucket; duplicate suppression и packing.
7. Hard eligibility, evidence coverage, comparative score/sensitivity и recommended shortlist.
8. Один frozen Direct publish profile v1 с exact projection.
9. Manual edits только business meaning и реально публикуемых значений.
10. Product pilot без write и отдельный exact-authority live create → suspend → readback gate.

### Explicitly defer

- serving, spend, optimization и winner selection;
- exhaustive Direct capability coverage;
- landing creation/modification;
- automatic online learning/promotion;
- monitoring, SEO, publication marketplaces и VK;
- mobile design собственного Dashboard.

## 7. Рекомендуемые acceptance criteria

### Product MVP — no production write

1. На positive pilot агент самостоятельно строит Business Model, цель и focus; владелец может исправить material misunderstanding.
2. Каждый material вывод имеет source, observation time, scope, freshness и confidence/limitation; unavailable не превращается в zero.
3. Competitor claims не содержат неподтверждённых spend/CPA/conversion/profitability и раскрывают sample denominator для aggregate claims.
4. Strategy содержит business goal, qualified outcome, economics, budget, target result cost, geography, period, destination, measurement и message.
5. Canvas конечен, materially differentiated, без cosmetic duplicates и budget-fragmenting splits.
6. Минимум один Draft получает `VIABLE` только если hard gates, economics, destination, measurement, demand, policy и exact profile v1 projection проходят.
7. Score только ранжирует comparable eligible Drafts; карточка показывает coverage, sensitivity и 2–3 главные причины.
8. Владелец редактирует Strategy/Draft и видит предсказуемую invalidation/regeneration boundary.
9. Shortlist и exact package review воспроизводимы из immutable revisions.
10. Неспециалист может объяснить цель, ключевые evidence, различия Drafts, риски и смысл подтверждения без разработчика.
11. Honesty pilot не создаёт ложный `VIABLE` и показывает конкретный repair plan.
12. Owner UI проходит 1920×1080 acceptance; landing audit использует device scope Draft, а не viewport Dashboard.

### Live acceptance — separately authorized

1. Exact package authority привязана к конкретным revisions и инвалидируется material edit.
2. Каждый item исполняется независимо; intent persisted before write.
3. Campaign создаётся через официальный API, немедленно переводится в `SUSPENDED`, затем child graph создаётся и semantically read back.
4. Ambiguous write не retry-ится вслепую; pending/moderation/reconciliation не показываются как success.
5. Итог: confirmed `SUSPENDED`, no resume capability, no impressions и no spend.

### Feature closure

Явно написать: Product MVP gate принимает пользовательскую ценность, но #149 закрывается только после обязательного checkpoint, определённого parent #79. Если live acceptance остаётся обязательной для completion, оба gates должны быть отмечены как required; если она optional, parent #79 нужно изменить согласованно.

## 8. Open-source research delta

Существующий [open-source contour](./p0-open-source-research-contour.md) правильно принимает official Yandex API-first adapters, Lighthouse и axe-core и не находит безопасный drop-in продукт. Свежий GitHub spot-check обнаружил дополнительные Yandex-specific проекты, которые стоит добавить в source audit перед `to-tickets`:

| Кандидат | Полезный reference | Почему не drop-in |
|---|---|---|
| [`nebelov/yandex-direct-for-all`](https://github.com/nebelov/yandex-direct-for-all) | Direct/Wordstat/Metrika collectors и campaign lifecycle workflow | Очень молодой; spot-check не нашёл `ResponsiveAd`; нужен source/schema/safety review |
| [`Kozharina/yadirect-agent`](https://github.com/Kozharina/yadirect-agent) | plan → confirm → execute, policy и audit | README прямо говорит, что real Wordstat/Metrika ещё не готовы; присутствует resume surface |
| [`georgy-agaev/yandex-direct-metrica-mcp`](https://github.com/georgy-agaev/yandex-direct-metrica-mcp) | read-only Direct/Metrika/Wordstat normalization | Полезен только как read contour; не решает Strategy/Draft/viability/publish contract |
| [`nikolaymokh-dev/yandex-direct-mcp`](https://github.com/nikolaymokh-dev/yandex-direct-mcp) | read-only default и tool profiles | Широкая generic tool surface; молодая реализация; не доказан current P0 profile |
| [`baltic-tea/yandex-wordstat-mcp`](https://github.com/baltic-tea/yandex-wordstat-mcp) | typed Wordstat v2 mapping, operators, retries | Малое adoption и отдельная license/supply-chain проверка; transport, не продуктовый pipeline |
| [`SvechaPVL/yandex-mcp`](https://github.com/SvechaPVL/yandex-mcp) | широкий coverage Direct/Metrika/Wordstat | Generic create/resume/delete tools и text-ad assumptions требуют сильного narrowing |
| [`Silverov/yandex-direct-skill`](https://github.com/Silverov/yandex-direct-skill) | список audit checks и output format | Однодневное происхождение, benchmark-heavy scoring и отсутствие доказанной viability calibration |

На 2026-08-23 GitHub metadata показывает, что эти репозитории молоды и имеют примерно 0–59 stars; popularity не является качественным доказательством. Вывод PRD остаётся правильным: **адаптировать отдельные contracts/patterns, но не заменять trusted MOX-ADV boundary широким MCP-сервером**.

## 9. Точные правки для #149

Перед product sign-off добавить или изменить:

1. **Problem/Solution:** явно назвать owner-visible Business Model и unit economics частью outcome.
2. **User Stories:** добавить existing/new advertiser onboarding, least-privilege consent и revocation.
3. **User Stories:** добавить Business Model correction и economics-backed target result cost.
4. **User Stories:** добавить complete creative preview, policy/disclaimer и asset provenance.
5. **User Stories:** добавить честный outcome «нет жизнеспособных Drafts» с repair plan.
6. **Implementation:** определить `P0 Campaign Creation Profile v1`, а не «все current capabilities».
7. **Implementation:** закрепить anti-fragmentation packing и learning-volume guard.
8. **Implementation:** назначить owner будущим Dashboard placeholders для P1–P3/VK.
9. **Testing:** разделить deterministic fixtures, positive real-business pilot и honesty pilot.
10. **Testing:** отличить 1920×1080 product UI от campaign-relevant landing device audit.
11. **Acceptance:** определить, обязан ли live gate для закрытия #149.
12. **Further Notes:** добавить normative links на research contracts и initial playbook release.
13. **Workflow:** снять `ready-for-agent`, принять PRD, затем выполнить `to-tickets` и создать vertical implementation slices/checkpoint.

## 10. Итоговое решение

**Approve with required changes.** Архитектурная направленность PRD соответствует конечной цели лучше исходного брифа: agent-owned research, business-only human gates, evidence lineage, честные границы конкурентного анализа, finite fan-out, non-predictive viability и safe non-serving creation — правильные решения.

Главный риск сейчас не в неверном vision, а в том, что широкий PRD выглядит «готовым к агенту» до фиксации минимального publish profile, Business Model/economics, access onboarding и независимого product acceptance. После этих правок #149 можно считать каноническим spec и декомпозировать; до них реализация с высокой вероятностью либо разрастётся, либо формально пройдёт собственные тесты без доказанной пользы заказчику.

## Источники

### Локальные нормативные и исследовательские документы

- [CONTEXT.md](../../CONTEXT.md)
- [ADR-0001: Agent owns all safe work](../adr/0001-agent-owns-safe-work.md)
- [P0 Agent-First Completion Gap Analysis](./p0-agent-first-completion-gap-analysis.md)
- [Analytics Evidence Contract](./analytics-evidence-contract.md)
- [Wordstat, Cost and Long-tail Packing](./wordstat-cost-and-long-tail-packing.md)
- [Pre-launch Viability Score](./pre-launch-viability-score.md)
- [Campaign Draft Fan-out and Direct MVP](./campaign-draft-fan-out-and-direct-mvp.md)
- [Landing Page Advisory Analysis Contract](./landing-page-advisory-analysis-contract.md)
- [P0 Open-source Research Contour](./p0-open-source-research-contour.md)
- [Yandex Direct and Metrika Capabilities](./yandex-direct-metrica-capabilities.md)

### Первичные внешние источники

- [Yandex Direct API: обновление TextAd до ResponsiveAd](https://yandex.ru/dev/direct/doc/ru/update-tga)
- [Yandex Direct API: Ad object](https://yandex.com/dev/direct/doc/en/objects/ad)
- [Yandex Direct API: Ads.add](https://yandex.com/dev/direct/doc/en/ads/add)
- [Yandex Direct: Combinatorial ads](https://yandex.com/support/direct/en/unified-performance-campaign/create-comb-ad)
- [Yandex Direct API: UnifiedCampaign.add](https://yandex.com/dev/direct/doc/en/campaigns/add-unified-campaign)
- [Yandex Wordstat API structure](https://yandex.com/support2/wordstat/en/content/api-structure)
- [Yandex Direct: Strategy selection](https://yandex.com/support/direct/en/strategies/select-strategy)
- [Yandex Direct: Maximize conversions](https://yandex.com/support/direct/en/strategies/average-cpa)
- [Yandex Direct: Insufficient conversions](https://yandex.com/support/direct/en/troubleshooting/conversions)
- [Yandex Direct: Evaluate performance campaigns](https://yandex.com/support/direct/en/statistics/performance-stat-guide)
