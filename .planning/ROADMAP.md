# План развития P0: AI-агент для стратегии и создания рекламных кампаний

**Статус:** проект для согласования владельцем

**Модуль:** только P0 «Стратегия и создание рекламных кампаний»

**Пользователь:** владелец или сотрудник бизнеса без профессиональных знаний в интернет-рекламе
**Главный принцип:** человек видит работу агента, принимает только бизнес-решения и исправляет то, где агент не может безопасно продолжить сам.

## 1. Решение

P0 не должен быть инженерной консолью Яндекс Директа и не должен пытаться вместить весь будущий MOX-ADV.

P0 должен провести человека по одному понятному пути:

```text
цель бизнеса
→ самостоятельное исследование агентом
→ проблемы и вопросы, которые агент не смог разрешить
→ готовая маркетинговая стратегия
→ несколько существенно разных рекламных кампаний
→ ручные корректировки и shortlist
→ проверка
→ безопасное создание без запуска показов
```

Внутренняя система может оставаться сложной: хранить доказательства, версии, точные проекции, ограничения, журналы и результаты API. Владелец видит только бизнес-смысл этой работы.

## 2. Ценность для пользователя

После прохождения P0 пользователь должен понимать:

1. Что агент уже узнал о бизнесе.
2. Что агент сейчас делает.
3. Что агент рекомендует рекламировать и почему.
4. Какие данные остаются неизвестными.
5. Где без решения человека нельзя безопасно продолжить.
6. Как выглядит итоговая стратегия.
7. Какие кампании предлагает агент и чем они отличаются.
8. Какие варианты лучше подготовлены к тестовому запуску.
9. Что именно будет создано после подтверждения.
10. Что созданные кампании не начнут тратить деньги автоматически.

## 3. Граница P0

### Входит

- сбор контекста компании, продуктов и услуг;
- выбор рекламного фокуса;
- ранняя редактируемая цель кампании;
- наблюдения о конкурентах;
- исследование спроса, сезонности и сопоставимой стоимости;
- аудит текущего продвижения в Direct;
- проверка измеримости результата в Metrika;
- анализ существующей посадочной страницы;
- формирование одной полной Campaign Strategy;
- создание конечного Recommendation Set из нескольких Campaign Drafts;
- Pre-launch Viability Score и причины оценки;
- ручное редактирование, исключение и shortlist;
- проверка выбранного пакета;
- создание выбранных кампаний через официальный API в подтверждённо остановленном состоянии;
- отправка объявлений на модерацию без включения показов.

### Не входит

- управление и оптимизация после запуска;
- фактический выбор победителей по расходам и конверсиям;
- мониторинг рекламы и SEO;
- изменение текстов внешнего сайта;
- разработка или публикация лендинга;
- SEO-статьи и внешние публикации;
- покупные статьи и ссылки;
- VK и другие рекламные каналы;
- включение показов и расход бюджета.

Эти направления могут присутствовать в общей навигации только как «В разработке». Они не должны создавать ложное ощущение работающих функций.

## 4. Что вырезать из текущего пользовательского интерфейса в первую очередь

Это первый implementation slice. Он меняет owner-facing interface, но сохраняет внутренний safety/evidence harness.

| Текущий мусор | Действие | Что увидит пользователь вместо него |
|---|---|---|
| ID, хеши, fingerprints, revision IDs | Удалить из owner UI | Понятное название объекта и время последнего изменения, только если это важно |
| Названия API-методов и endpoints | Удалить | «Данные Direct получены», «Частотность пока недоступна» |
| Schema versions, capability profile IDs, tool versions | Удалить | Поддерживается ли нужная функция и как это влияет на кампанию |
| JSON pointers, payload fields, micros | Удалить | Поля в рублях и на языке бизнеса |
| Внутренние коды `EVIDENCE_GAP`, `PLAYBOOK_RELEASE_UNAVAILABLE` и подобные | Удалить | Причина, влияние и конкретный следующий шаг |
| Полный алгоритм и веса viability score | Удалить | Балл, диапазон неопределённости и 2–3 главные причины |
| Сводки количества claims, sources, records | Свернуть до бизнес-вывода | «Данных достаточно», «Не хватает данных о спросе», «Источники противоречат друг другу» |
| Инженерный редактор точной Direct projection | Заменить бизнес-редактором | Предложение, аудитория, запросы, объявление, бюджет, география, посадочная, измерение |
| Системные поля стратегии и размещения, которые пользователь не должен выбирать | Не показывать | Рекомендация агента и объяснение применённого решения |
| Фиксированная пустая анкета | Убрать | Заполненная агентом Strategy и последовательность только нерешённых вопросов |
| Кнопки обслуживания вроде проверки playbook или provider state | Убрать | Агент выполняет безопасную проверку сам и сообщает только результат или проблему |
| Техническая история, journals и raw diagnostics | Удалить из owner UI | Краткая история бизнес-изменений и их последствий |
| Бейджи «реальные данные», enum-статусы и смешанная русско-английская терминология | Удалить | Единый русский язык и честные статусы «готово / работаю / нужен ответ / проблема» |

### Что нельзя удалять из внутренней системы

Следующие возможности не являются мусором. Они остаются внутри production module и developer/operator diagnostics:

- provenance и Analytics Evidence Snapshot;
- immutable revisions и invalidation cascade;
- точная Direct projection и semantic readback;
- policy, capability и schema validation;
- authority и Human Decision Gates;
- durable checkpoints, retries и reconciliation;
- полный журнал внешних записей;
- блокировка unsupported или unsafe действий;
- обязательный `SUSPENDED` и отсутствие `resume`.

Правило удаления простое:

> Если информация нужна разработчику для доказательства корректности, но не меняет решение владельца бизнеса, она не принадлежит owner-facing P0.

## 5. Целевой пользовательский путь

Сохраняется пять понятных этапов, но меняется их содержание и язык.

### Этап 1. Цель

Пользователь указывает сайт или компанию и описывает желаемый бизнес-результат.

Агент:

- проверяет доступные подключения;
- предлагает уточнённую формулировку цели;
- объясняет, какой результат будет считаться квалифицированным;
- начинает исследование без требования заполнить техническую анкету.

Человек может изменить цель, но не выбирает тип кампании, API strategy, attribution enum или технические настройки.

### Этап 2. Что узнал агент

Пользователь видит не отчёт из десятков технических секций, а ход работы:

- изучаю компанию и предложения;
- сравниваю возможные рекламные фокусы;
- исследую конкурентов;
- проверяю спрос и сезонность;
- анализирую текущий Direct;
- проверяю измерение результата;
- анализирую посадочную страницу.

У каждой работы есть четыре состояния:

- **Работаю** — действие продолжается;
- **Готово** — показан вывод и его значение для стратегии;
- **Нужен ответ** — подготовлен Human Decision Gate;
- **Проблема** — показаны влияние, действия агента и безопасный следующий шаг.

Итог этапа:

- рекомендуемый рекламный фокус;
- сохранённые альтернативы;
- максимум три важных замечания к посадочной;
- список действительно материальных пробелов.

### Этап 3. Стратегия

Агент показывает готовую Campaign Strategy, а не пустую форму.

Пользователь редактирует бизнес-решения:

- цель;
- продукт или услугу;
- аудиторию;
- предложение;
- квалифицированный результат;
- исключения;
- географию и период;
- посадочную страницу;
- бюджет;
- целевую стоимость результата;
- основное сообщение.

Перед существенным изменением интерфейс сообщает:

- что изменится;
- какие кампании будут пересобраны;
- какие предыдущие решения перестанут быть актуальными.

Итог этапа — одна утверждённая Campaign Strategy revision.

### Этап 4. Кампании

Агент создаёт конечное полотно Campaign Drafts. Каждая карточка — одна будущая кампания.

Карточка отвечает на вопросы:

- Для кого эта кампания?
- Что мы предлагаем?
- На каком спросе она основана?
- Чем она отличается от других вариантов?
- Почему агент рекомендует или не рекомендует её?
- Какие данные неизвестны?
- Что нужно исправить до создания?

Пользователь может:

- открыть бизнес-редактор кампании;
- менять все поля, которые влияют на бизнес-смысл или публикуемый текст;
- исключить или вернуть вариант;
- увидеть последствия правки;
- запросить пересборку затронутого варианта;
- сформировать shortlist.

Системные transport/provider поля остаются внутри модуля и не становятся пользовательскими настройками.

### Этап 5. Проверка и создание

Пользователь видит:

- какие кампании выбраны;
- аудиторию, предложение и посадочную каждой;
- недельный и общий бюджет;
- основные ограничения и известные риски;
- что агент создаст в Direct;
- что кампании останутся остановленными.

После одного exact package approval агент:

1. создаёт каждую кампанию независимо;
2. немедленно останавливает её;
3. подтверждает остановленное состояние;
4. создаёт поддерживаемые дочерние объекты;
5. проверяет фактический результат;
6. отправляет объявления на модерацию;
7. показывает бизнес-статус каждого варианта.

## 6. Контракт взаимодействия с агентом

### Агент делает сам

- собирает доступные факты;
- планирует безопасное исследование;
- читает разрешённые источники;
- продолжает asynchronous reads и отчёты;
- формирует модель бизнеса;
- предлагает цель и фокус;
- готовит Strategy;
- создаёт и проверяет Campaign Drafts;
- применяет активный curated playbook;
- объясняет неизвестное и противоречия;
- выполняет подтверждённую техническую работу.

### Человек решает

- какой бизнес-результат нужен;
- какое предложение и аудитория допустимы;
- географию, сроки, бюджет и экономические ограничения;
- спорный фокус при материально равных вариантах;
- юридические или репутационные вопросы;
- утверждение полной Strategy;
- утверждение точного пакета внешней записи.

### Система гарантирует

- модель не расширяет собственные полномочия;
- факты, гипотезы и решения не смешиваются;
- неизвестное не превращается в ноль или уверенный вывод;
- пользовательская правка пересчитывает только затронутые результаты;
- unsafe или unsupported действия блокируются;
- внешние записи воспроизводимы и сверяются;
- P0 не включает показы и расходы.

## 7. Формат проблемы, которую должен решать человек

Каждый Human Decision Gate или problem card содержит:

1. **Что произошло.** Одно предложение на языке бизнеса.
2. **Почему это важно.** Как проблема влияет на Strategy или кампании.
3. **Что уже сделал агент.** Какие безопасные способы разрешения использованы.
4. **Рекомендация агента.** Один preferred вариант.
5. **Альтернативы.** Только materially different варианты.
6. **Последствия.** Что изменится после выбора.
7. **Одно требуемое действие.** Ответ, выбор или authority.

Raw provider error сохраняется внутри, но не показывается владельцу.

## 8. Исследовательский подход

Мы не будем строить крупные функции на основании интуиции или одного LLM-ответа. Для каждого существенного решения используется один цикл:

```text
вопрос
→ первичные источники
→ несколько гипотез решения
→ дешёвый prototype или fixture
→ пользовательская / экспертная / agent-eval проверка
→ зафиксированное решение
→ implementation slice
→ повторная проверка на реальном сценарии
```

### Правила исследования

- Начинать с официальной документации, source code, спецификаций и first-party API.
- Вторичные статьи использовать только для поиска первичного источника или гипотезы.
- Open-source проект не становится dependency только из-за популярности.
- Для каждого OSS-кандидата проверять license, activity, tests, security model, authority model и соответствие Yandex.
- Исследование имеет конкретный вопрос и критерий завершения.
- Не повторять уже принятое исследование без причины: повтор нужен при изменении провайдера, конфликте evidence или новом продуктовом вопросе.
- Исследование не считается завершённым, пока оно не меняет решение, contract, prototype или eval.

## 9. Исследовательская программа

### Уже есть как baseline

Эти документы используются как отправная точка, а не переписываются с нуля:

- `docs/research/p0-open-source-research-contour.md`;
- `docs/research/yandex-direct-metrica-capabilities.md`;
- `docs/research/p0-yandex-campaign-creation-contour.md`;
- `docs/research/analytics-evidence-contract.md`;
- `docs/research/wordstat-cost-and-long-tail-packing.md`;
- `docs/research/landing-page-advisory-analysis-contract.md`;
- `docs/research/pre-launch-viability-score.md`;
- `docs/research/campaign-draft-fan-out-and-direct-mvp.md`;
- `docs/research/p0-agent-first-completion-gap-analysis.md`.

### Новые обязательные research tracks

| Track | Главный вопрос | Метод | Проверяемый результат |
|---|---|---|---|
| Novice UX | Понимает ли непрофессионал работу агента и требуемое решение? | 2–3 UI prototypes, task-based tests с пользователями | Принятая information architecture и vocabulary |
| Agent activity | Как показывать длительное исследование без технического журнала и ложного прогресса? | Prototype progress timeline + restart/provider-delay scenarios | Activity/progress contract |
| Strategy quality | Что делает маркетинговую стратегию достаточно полной и применимой? | Primary-source review, экспертная rubric, blinded comparison на fixtures | Versioned Strategy quality rubric |
| Agent autonomy | Какие вопросы агент обязан разрешать сам, а какие передавать человеку? | Tool-loop evals, unnecessary-question metric, failure scenarios | Typed Human Decision Gate policy |
| Business focus | Как выбирать продукт/услугу при широком каталоге? | Multi-offer fixtures, opportunity/readiness/evidence comparisons | Focus selection contract |
| Campaign differentiation | Какие варианты действительно являются разными гипотезами, а не копиями? | Fan-out prototypes, duplicate/delta analysis, expert pairwise review | Versioned fan-out rules |
| Current Yandex capabilities | Какие кампании и объявления можно безопасно создавать сейчас? | Fresh official API/docs review + account capability fixtures | Current capability matrix и ResponsiveAd profile |
| Viability | Насколько полезен pre-launch rank и не вводит ли он в заблуждение? | Golden vectors, sensitivity tests, expert ordering; позже leakage-safe backtest | Score contract, limitations и release criteria |
| Landing analysis | Какие рекомендации воспроизводимы и полезны до запуска? | Deterministic checks + blinded neural review + user comprehension | Top-3 correction contract |
| Open-source reuse | Что можно адаптировать, а что опасно интегрировать? | Source/license/test/security audit | Adopt / adapt / reject decision records |

## 10. Набор экспериментальных сценариев

Минимальный eval corpus должен включать разные типы бизнеса:

1. Локальная услуга с одним основным предложением.
2. Компания с несколькими услугами и разной экономикой.
3. B2B с длинным циклом и offline-qualified результатом.
4. Интернет-магазин с широким каталогом.
5. Новый бизнес с почти отсутствующей историей Direct/Metrika.
6. Существующий рекламодатель с конфликтующими данными сайта и аккаунта.
7. Бизнес с неподходящей или отсутствующей посадочной страницей.

Для каждого сценария сохраняются:

- ожидаемые факты и допустимые неизвестные;
- бизнес-решения, которые должен принять человек;
- вопросы, которые агент не должен задавать;
- минимально приемлемая Strategy;
- ожидаемые materially distinct Campaign Drafts;
- hard blockers;
- допустимые outcomes при unavailable providers.

После deterministic corpus проводится отдельная проверка на одном незнакомом реальном бизнесе. Fixture не должен становиться page-specific replay.

## 11. Метрики экспериментов

### Понимание человеком

На каждом крупном UX checkpoint минимум 4 из 5 пользователей без подсказки должны суметь:

- объяснить текущую цель;
- сказать, что агент сейчас делает;
- понять, почему агент просит решение;
- внести требуемую корректировку;
- объяснить различие двух Campaign Drafts;
- понять, что произойдёт после подтверждения.

### Качество агента

- ноль обязательных вопросов о discoverable facts;
- каждое material утверждение имеет допустимый источник или label «гипотеза»;
- неизвестное не превращается в факт;
- tool и authority violations блокируются;
- исследование останавливается с понятной причиной;
- Strategy проходит versioned completeness rubric;
- Campaign Drafts имеют material delta;
- хотя бы один acceptance fixture даёт defensible `VIABLE` Draft;
- restart/compaction не теряет objective и checkpoints.

### Качество owner UI

- owner-facing rendered HTML не содержит technical IDs, hashes, schemas, API methods, raw payloads, journals и internal codes;
- каждый экран отвечает «что узнал агент / что рекомендует / почему важно / нужен ли ответ / что дальше»;
- ни одна primary action не требует рекламного или API-жаргона;
- основной путь проходит в viewport 1920×1080 без horizontal overflow и недоступных controls.

### Безопасность создания

- exact package authority инвалидируется после material edit;
- каждый item имеет независимый outcome;
- campaign подтверждённо `SUSPENDED` до дочерних записей;
- ambiguous write не повторяется вслепую;
- `Campaigns.resume` отсутствует;
- impressions и spend равны нулю в P0 acceptance.

## 12. План фаз

### Phase 0 — Очистить owner-facing P0

**Цель:** сначала убрать технический шум и закрепить небольшой owner interface, за которым может развиваться сложная реализация.

**Работы:**

1. Составить автоматический denylist технической лексики owner UI.
2. Удалить перечисленный в разделе 4 мусор со всех пяти этапов.
3. Переименовать этапы и статусы на язык пользователя.
4. Ввести единые Agent Activity, Finding, Problem и Human Decision Gate cards.
5. Заменить инженерный Campaign Draft drawer на business editor projection.
6. Перевести provider/system errors в business impact + next action.
7. Сохранить технические данные только во внутренних redacted artifacts и developer diagnostics.

**Exit gate:** текущий deterministic сценарий проходит через UI, пользователь не видит технических идентификаторов и может объяснить текущее состояние, проблему и следующий шаг.

### Phase 1 — Исследовательская и экспериментальная основа

**Цель:** создать воспроизводимый способ проверять решения, а не оценивать результат «на глаз».

**Работы:**

1. Зафиксировать eval corpus из раздела 10.
2. Создать Strategy quality rubric и Campaign Draft review rubric.
3. Создать шаблон research decision record.
4. Провести novice UX prototypes для agent activity, Strategy и campaign canvas.
5. Провести freshness review текущего Yandex creation profile.
6. Зафиксировать release gates для внешних skills/OSS и curated playbook.

**Exit gate:** все крупные продуктовые неизвестные имеют research/prototype ticket, metric и owner decision; принятые решения готовы к `to-spec`.

### Phase 2 — Настоящий агент и аналитика

**Цель:** агент автономно получает достаточно evidence для выбора рекламного фокуса и подготовки Strategy.

**Работы:**

1. Один provider-neutral neural loop `model → typed tool → validated observation`.
2. Durable objective, checkpoints, budgets, stop reasons и restart.
3. Каталог materially distinct продуктов/услуг и focus cards.
4. Bounded competitor observations.
5. Полный релевантный Direct audit и asynchronous reports.
6. Multi-seed Wordstat, seasonality, comparable cost и auction hypotheses.
7. Metrika measurement readiness.
8. Destination classification и top-3 landing corrections.
9. Первый active official-source curated playbook.
10. Owner-facing activity и problem cards для всех долгих работ.

**Exit gate:** на незнакомом бизнесе агент выдаёт Strategy-ready Analytics Evidence Snapshot либо один подготовленный Material Uncertainty Gate.

### Phase 3 — Формализация и маркетинговая стратегия

**Цель:** превратить evidence в полную редактируемую Strategy без пустой анкеты.

**Работы:**

1. Goal-first owner flow.
2. Agent-filled canonical Strategy.
3. Adaptive вопросы только по unresolved material decisions.
4. Strategy synthesis по принятой quality rubric.
5. Evidence-driven выбор objective, bidding approach, placements и measurement.
6. Typed competitor, demand, auction, creative и targeting hypotheses.
7. Revision cascade и один Strategy approval.

**Exit gate:** пользователь понимает и утверждает одну полную Campaign Strategy; все material поля имеют owner input или допустимое evidence.

### Phase 4 — Полотно рекламных кампаний

**Цель:** реализовать Strategy как несколько понятных, materially distinct и редактируемых Campaign Drafts.

**Работы:**

1. Current Direct capability matrix и current ResponsiveAd/combinatorial profile.
2. Finite fan-out, control и improvement hypotheses.
3. Long-tail packing и duplicate suppression.
4. Hard eligibility до scoring.
5. Pre-launch Viability Score, rank, evidence coverage и sensitivity.
6. Novice-first campaign cards и business editor.
7. Revisions, delta после правок, exclude/restore и shortlist.
8. Exact internal projection без silent field loss.

**Exit gate:** минимум один realistic fixture создаёт редактируемый `VIABLE` Campaign Draft с полной current Direct projection; пользователь понимает различия вариантов.

### Phase 5 — Проверка и безопасное создание

**Цель:** создать выбранные кампании без включения показов и без потери утверждённых полей.

**Работы:**

1. Business-level package review.
2. Один exact package Human Decision Gate.
3. Независимое durable execution каждого Draft.
4. Create → suspend → readback `SUSPENDED` → children.
5. Full semantic readback.
6. Asynchronous moderation, correction и reconciliation.
7. Business outcome для каждого item.

**Exit gate:** deterministic provider fixtures проходят полный lifecycle; live writes остаются закрыты до отдельного разрешения.

### Phase 6 — Product MVP acceptance

**Цель:** доказать, что P0 полезен владельцу и корректен без production writes.

**Работы:**

1. Agent eval suite на полном corpus.
2. Novice UX testing полного пути.
3. Playwright acceptance в 1920×1080 только через UI.
4. Contract/build/provider-shape/safety tests.
5. Незнакомый бизнес-сценарий без page-specific replay.
6. Machine-readable acceptance artifact.

**Exit gate:** выполняются критерии раздела 13.

### Phase 7 — Отдельно разрешённая live acceptance

**Цель:** доказать official-API creation и non-serving outcome.

**Условие входа:** Phase 6 принята и владелец выдал точное разовое authority.

**Exit gate:** каждый созданный item имеет terminal или честный pending/reconciliation outcome; каждая созданная campaign подтверждённо `SUSPENDED`; показов и расходов нет.

## 13. Критерий готовности MVP

P0 готов, когда одновременно выполнено следующее:

1. Непрофессиональный пользователь проходит путь без рекламного/API-жаргона.
2. Пользователь всегда понимает, что делает агент и что произойдёт дальше.
3. Агент сам собирает разрешённые discoverable facts.
4. Человек получает только подготовленные material decisions.
5. Сформирована одна понятная и редактируемая Campaign Strategy.
6. Сформировано конечное полотно materially distinct Campaign Drafts.
7. Каждый Draft можно понять, исправить, исключить или вернуть.
8. Hard blockers отделены от Pre-launch Viability Score.
9. Минимум один Draft имеет статус `VIABLE`, достаточное evidence coverage и полную current Direct projection.
10. Shortlist и package review воспроизводимы.
11. Полный deterministic acceptance проходит без внешней записи.
12. Отдельная live acceptance после authority заканчивается non-serving состоянием.

`VIABLE` означает «обоснованно готов к ограниченному тесту», а не «будет прибыльным» и не «победит другие кампании».

## 14. Основные риски и ответы

| Риск | Ответ плана |
|---|---|
| Красивый UI скрывает слабую агентскую логику | Strategy/Campaign rubrics, fixtures, agent evals и expert review до acceptance |
| Исследование становится бесконечным | У каждого track есть вопрос, артефакт, metric и completion criterion |
| LLM придумывает бизнес-факты | Typed tools, evidence labels, deterministic validation и conflict handling |
| Пользователь слишком доверяет числовому score | Score называется сравнительным приоритетом, показывает uncertainty и не заменяет hard gates |
| Кампании отличаются косметически | Material-delta contract, control/improvement hypotheses и duplicate suppression |
| Yandex меняет API и форматы | Fresh capability snapshot, official-shape fixtures и versioned profile |
| Open-source зависимость расширяет authority | Source/license/security review; adapt contracts before dependency |
| Пользователь вынужден разбираться в рекламе | Business vocabulary, prepared decisions и user comprehension tests |
| Технические данные исчезают вместе с UI | Owner projection отделяется от internal evidence/diagnostics, данные сохраняются |
| Создание случайно запускает расходы | Mandatory suspend/readback, no resume capability и live acceptance guard |

## 15. Delivery workflow

Этот документ остаётся единственным локальным refinement plan P0.

Для крупных нерешённых направлений:

```text
Wayfinder research/prototype
→ принятое решение
→ to-spec
→ to-tickets
→ /ready по одному vertical slice
```

Правила delivery:

- Phase 0 является первым implementation frontier после согласования плана.
- Research и prototype tickets принимают решения, но не внедряют production destination.
- Каждый implementation ticket — один проверяемый vertical slice для свежей сессии.
- Новая capability не попадает в production только на основании исследования; нужен contract, tests и UI acceptance.
- Не создаётся вторая реализация P0 и не переписывается существующий deterministic safety harness без доказанной необходимости.
- Post-launch modules не добавляются в backlog текущего P0.

## 16. Следующие действия после согласования

1. Утвердить scope cut и правило удаления owner-facing technical noise.
2. Синхронизировать `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md` и GitHub spec с новым порядком фаз.
3. Создать Phase 0 spec и vertical tickets.
4. Параллельно открыть decision-only research/prototype map для Phase 1.
5. После Phase 0 провести первый novice UX checkpoint на очищенном current flow.
6. Продолжать по фазам только после executable exit gate предыдущей.

---

*План развивает существующий `sites/p0-production/`. Он сохраняет внутреннюю доказуемость и безопасность, но полностью меняет owner-facing приоритет: сначала бизнес-смысл, затем решение человека, а техническая реализация остаётся внутри модуля.*
