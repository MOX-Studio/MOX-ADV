# Данные Метрики только для чтения в анализе компании и этапе «Сбор сведений»

**Wayfinder:** [«Определить роль read-only Метрики в анализе компании и этапе сбора информации»](https://github.com/MOX-Studio/MOX-ADV/issues/315)
**Карта:** [«Спроектировать базовый пайплайн готовой рекламной кампании»](https://github.com/MOX-Studio/MOX-ADV/issues/297)
**Дата решения:** 2026-08-31
**Назначение:** нормативный входной и выходной контракт домена `METRIKA` внутри `Analytics Evidence Snapshot`; не реализация, не браузерный кабинет и не внешняя запись.
**Нормативные слова:** **MUST / MUST NOT / SHOULD / MAY** имеют обязательный / запрещающий / рекомендуемый / разрешающий смысл.

## 1. Решение в одном абзаце

Яндекс Метрика участвует в этапе **«Сбор сведений»** в двух независимых ролях:

1. **обязательный контур измеримости** подтверждает точные счётчик и основную цель, их связь с квалифицированным бизнес-результатом и фактическую регистрацию тестового действия;
2. **описательный контур текущей воронки** показывает сопоставимые сессии, источники, UTM, посадочные и наблюдаемые переходы до основной цели, но не доказывает причинность и не прогнозирует будущий результат.

Отсутствие или малый объём исторических данных ограничивает аналитические выводы, но не блокирует полный `Campaign Draft`, если измеримость подтверждена. Неоднозначность точного счётчика, смысла основной цели или регистрации события остаётся блокирующей Material Uncertainty. Данные Метрики сохраняются как доменный срез существующего `Analytics Evidence Snapshot`; новая пользовательская сущность, пользовательский этап или отдельный интерфейс не создаются.

## 2. Основания выбора

Официальная модель Яндекс Метрики разделяет:

- Management API — доступные счётчики, их scope и конфигурацию целей;
- Reports API — агрегированные наблюдения, dimensions, metrics, attribution и качество ответа;
- Logs API — неагрегированные данные для специальных задач.

Официальная проверка цели отдельно требует убедиться, что событие регистрируется и отражается в отчётах. Это отличается от статистической достаточности исторического среза. Яндекс прямо предупреждает, что формально корректный показатель по одной сессии не поддерживает вывод о поведении сайта, а также сообщает, что в среднем 99% сессий завершаются в течение трёх дней.

Следовательно:

- конфигурация и работоспособность измерения — gate;
- исторический объём — качество evidence;
- sampling, privacy suppression и lag — ограничения интерпретации;
- отсутствие строки — не нулевое значение;
- один универсальный readiness-status для всех этих смыслов был бы ложным упрощением.

## 3. Граница домена

### 3.1 Входит в контракт

- автоматическое обнаружение доступных счётчиков через официальный Management API;
- детерминированный выбор точного счётчика либо подготовленный Human Decision Gate при материальной неоднозначности;
- каталог целей и выбор одной основной цели, связанной с текущим квалифицированным бизнес-результатом;
- проверка регистрации основной цели без рекламного расхода;
- чтение агрегированных отчётов по сессиям, цели, источникам, UTM и посадочным;
- построение типизированной текущей воронки;
- явные attribution, period, timezone, numerator, denominator, segment и lineage;
- состояния качества, ограничения claims, версионирование и зависимое аннулирование;
- компактная пользовательская проекция внутри этапа «Сбор сведений».

### 3.2 Не входит в контракт

- браузерный кабинет Яндекс Метрики;
- создание, изменение или удаление счётчика, цели, фильтра, сегмента или воронки;
- изменение сайта, внедрение кода счётчика или `reachGoal`;
- загрузка offline conversions, расходов, CRM-данных или пользовательских параметров;
- персональные row-level данные;
- доказательство причинного эффекта канала или посадочной;
- прогноз будущей конверсии, CPA, прибыли или инкрементальности;
- анализ конкурента по собственной Метрике рекламодателя;
- автоматическое изменение бюджета, публикация или расход.

## 4. Входной контракт

Evidence Analyst получает неизменяемый вход:

```yaml
metrica_analysis_input:
  run_id: string
  as_of: RFC3339
  goal_revision:
    revision_id: string
    qualified_business_outcome: string
    qualified_action: string
  business_scope:
    company_id: string
    canonical_site_host: string
    confirmed_mirror_hosts: [string]
    candidate_landing_urls: [https_url]
  access_ref:
    authority_ref: protected_reference
    required_scope: metrika:read
  policies:
    counter_selection_version: string
    goal_mapping_version: string
    report_window_version: string
    funnel_mapping_version: string
    attribution_version: string
    utm_contract_version: string
    data_quality_version: string
  previous_snapshot_ref: string | null
```

Токен, OAuth payload и секреты не входят в бизнес-объекты, claims или пользовательскую проекцию. `access_ref` разрешается только узким read-only адаптером.

## 5. Автоматический выбор точного счётчика

### 5.1 Получение кандидатов

Адаптер **MUST** вызвать официальный `GET /management/v1/counters` с `status=Active` и получить поля, необходимые для сопоставления:

- `id` — только для защищённой provider binding;
- `name`;
- `status` и `activity_status`;
- `permission`;
- основной site/domain и mirrors;
- `time_zone_name` и offset;
- доступные filters/operations, когда они влияют на scope;
- время создания и иные доступные metadata, необходимые для объяснения конфликта.

`search_string` MAY использоваться только как оптимизация запроса по подтверждённому host; итоговый выбор всё равно проверяется по нормализованному полному кандидату.

### 5.2 Нормализация scope

- Host нормализуется в lowercase registrable domain без scheme, port и `www.`-алиаса.
- Redirect, subdomain и mirror не считаются эквивалентными без подтверждённой связи.
- Кандидат допустим только при read permission и `Active`.
- `activity_status` — диагностический сигнал, а не доказательство корректности счётчика.
- Favorite, имя или число визитов не могут сами определить точный счётчик.

### 5.3 Правило выбора

1. Отобрать кандидатов, у которых основной site или mirror точно совпадает с подтверждённым canonical site/mirror бизнеса.
2. Проверить, что кандидат покрывает выбранную посадочную или её подтверждённое host-семейство.
3. Для каждого кандидата получить каталог целей и сформировать пары `counter + goal`, способные измерять текущий qualified outcome.
4. Автоматически выбрать пару только тогда, когда после детерминированных проверок остаётся ровно один материально допустимый кандидат.
5. Ноль кандидатов → `UNAVAILABLE_NO_EXACT_COUNTER`.
6. Несколько материально разных кандидатов → Human Decision Gate с рекомендацией Evidence Analyst и понятными названиями сайта, счётчика и целей, но без provider IDs.

Человека **MUST NOT** просить вручную вводить `counter_id` или `goal_id`.

## 6. Каталог и роли целей

Для каждой доступной цели сохраняются:

```yaml
goal_candidate:
  protected_goal_id: provider_binding
  display_name: string
  type: string
  status: string | UNKNOWN
  source: string | UNKNOWN
  favorite: boolean | UNKNOWN
  default_price: money | null
  conditions: bounded_normalized_conditions
  steps: bounded_normalized_steps
  observed_reaches: metric_observation | UNAVAILABLE
  role: PRIMARY | AUXILIARY | DUPLICATE | UNMAPPED
  funnel_stage: PRIMARY_QUALIFIED_OUTCOME | INTERMEDIATE_ACTION | EARLY_ACTION | UNKNOWN
  business_outcome_match:
    status: CONFIRMED | CONFLICTING | UNKNOWN
    evidence_refs: [claim_ref]
```

Правила:

- одна текущая `Campaign Strategy` получает ровно одну `PRIMARY` goal binding;
- тип, favorite и название цели являются evidence, но не окончательным бизнес-смыслом;
- основная цель **MUST** соответствовать qualified outcome и точному действию на посадочной;
- ранние действия, page depth, duration, click и pageview **MUST NOT** подменять квалифицированный результат;
- одинаковые names/conditions/steps или наблюдаемо двойная регистрация одного действия создают `DUPLICATE`/conflict;
- неоднозначный business meaning создаёт Human Decision Gate, а не произвольный выбор;
- цель считается работоспособной только после подтверждения тестового события и его появления в официальном отчёте; наличие goal object недостаточно.

## 7. Два независимых результата

### 7.1 Привязка измерения

```yaml
measurement_binding:
  status: VERIFIED | BLOCKED | UNAVAILABLE | CONFLICTING
  counter_ref: protected_provider_binding
  primary_goal_ref: protected_provider_binding
  site_label: string
  goal_label: string
  qualified_outcome: string
  goal_registration:
    status: OBSERVED_IN_REPORT | NOT_OBSERVED | UNAVAILABLE
    observed_at: RFC3339 | null
    evidence_refs: [evidence_ref]
  limitations: [string]
```

`VERIFIED` требует точного счётчика, однозначной основной цели и наблюдаемого тестового события. Это обязательный input для полного Campaign Draft.

### 7.2 Текущая воронка компании

```yaml
current_company_funnel:
  status: COMPLETE | PARTIAL | RARE | STALE | UNAVAILABLE | CONFLICTING
  period: {from: date, to_exclusive: date, timezone: IANA}
  attribution_view: ALL_CHANNELS_LAST_SIGNIFICANT | DIRECT_LAST_CLICK
  segment: typed_filter
  steps: [funnel_step]
  traffic_breakdowns: [breakdown]
  data_quality: data_quality
  allowed_claim_refs: [claim_ref]
  limitations: [string]
```

Funnel MAY быть `UNAVAILABLE` или `RARE` при `measurement_binding.status=VERIFIED`. Это нормальный сценарий нового или малопосещаемого бизнеса и не является нулевой воронкой.

## 8. Временные окна

Политика `metrica-report-window/v1`:

1. **Основной срез:** 28 полностью завершённых календарных дней, заканчивающихся перед `as_of_date−3 days` в timezone счётчика.
2. **Сравнение:** предыдущие непосредственно примыкающие 28 дней с теми же scope, filters, dimensions, attribution и goal semantics.
3. **Редкий трафик:** дополнительный 90-дневный завершённый срез MAY использоваться как контекст, но не смешивается с основным окном и не заменяет его в сравнении.
4. Текущий и последние три потенциально незавершённых дня не входят в основной аналитический срез.
5. Изменение длительности или границ окна создаёт новую версию evidence.

28 и 90 дней — продуктовая версия методики, а не универсальная гарантия Яндекса. Политика MAY калиброваться позднее по данным продукта, сохраняя воспроизводимость старых редакций.

## 9. Атрибуция и сопоставимость

Контракт содержит два раздельных представления:

- `ALL_CHANNELS_LAST_SIGNIFICANT` — описательная структура привлечения по `lastsign`;
- `DIRECT_LAST_CLICK` — отдельный срез трафика, связанного с Яндекс Директом через `last_yandex_direct_click` и соответствующие Direct dimensions.

Правила:

- attribution **MUST** храниться в каждом report request и metric observation;
- срезы разных attribution models нельзя складывать, ранжировать как одинаковые или сравнивать без отдельного reconciliation;
- cross-device attribution используется только как отдельная явно названная версия;
- `automatic` не подменяет выбранную воспроизводимую модель молча;
- изменение attribution model создаёт новую evidence revision и проверку зависимого конуса.

## 10. Каноническая текущая воронка

### 10.1 Стадии

Сессионная воронка состоит из:

1. `SESSION` — сопоставимые сессии в точном business/report scope;
2. `LANDING_SESSION` — сессии, начавшиеся на выбранной посадочной или подтверждённом семействе посадочных;
3. `INTERMEDIATE_ACTION` — ноль или несколько только подтверждённых промежуточных действий;
4. `PRIMARY_QUALIFIED_OUTCOME` — сессии, в которых достигнута точная основная цель.

Если цель Метрики уже является корректной multi-step goal, её фактические steps MAY нормализоваться в `INTERMEDIATE_ACTION`. Произвольные шаги из bounce rate, duration, scroll или page depth **MUST NOT** изобретаться.

### 10.2 Семантика измерений

Для каждого шага сохраняются:

```yaml
funnel_step:
  stage: enum
  label: string
  basis: SESSION_FILTER | GOAL | MULTI_STEP_GOAL_STEP
  converted_sessions: integer | null
  raw_goal_reaches: integer | null
  denominator_from_first: integer | null
  denominator_from_previous: integer | null
  conversion_from_first: ratio | null
  conversion_from_previous: ratio | null
  report_scope_ref: string
  evidence_refs: [evidence_ref]
  status: OBSERVED | UNMAPPED | UNAVAILABLE
```

- Канонический numerator — число сессий, удовлетворивших стадии.
- Raw goal reaches сохраняются отдельно и не подменяют converted sessions.
- Любой ratio хранит exact numerator и denominator.
- `UNMAPPED`/`UNAVAILABLE` не преобразуется в zero.
- Потеря между этапами — арифметическое наблюдение, но причина потери остаётся неизвестной без отдельного дизайна.

## 11. UTM, посадочные и связь с Директом

### 11.1 Обязательные dimensions

При доступности API собираются:

- `utm_source` / `ym:s:UTMSource`;
- `utm_medium` / `ym:s:UTMMedium`;
- `utm_campaign` / `ym:s:UTMCampaign`;
- `utm_term` / `ym:s:UTMTerm`;
- `utm_content` / `ym:s:UTMContent`;
- landing/start URL и нормализованный landing family;
- traffic source/source engine;
- Direct dimensions для официально связанного трафика;
- device и применимый geography segment.

Raw UTM value и нормализованное значение сохраняются раздельно. Пустая, отсутствующая и ограниченная privacy-разглашением метка имеют разные состояния.

### 11.2 Классы связи

```text
BOTH_MATCH      — UTM и официальная Direct-связь согласованы
DIRECT_LINKED   — Direct-связь подтверждена, UTM неполна или отсутствует
UTM_LINKED      — UTM наблюдается, официальная Direct-связь не подтверждена
CONFLICT        — два способа дают несовместимую связь
UNATTRIBUTED    — сессия наблюдается, источник не установлен
UNKNOWN         — данные недоступны или ограничены
```

UTM описывает наблюдаемую разметку и **MUST NOT** сама доказывать причинность, инкрементальность или принадлежность к конкретному объекту Директа.

### 11.3 Влияние на будущий Draft

Историческая разметка не копируется автоматически. Новый Campaign Draft использует версионированный единый контракт:

```text
utm_source=yandex
utm_medium=cpc
utm_campaign={campaign_id}
utm_content={ad_id}
utm_term={keyword}
```

Точное техническое представление placeholders проверяет Direct Compiler. Изменение только этого технического контракта пересобирает связанные Draft, но не обязано менять Strategy или смысл Campaign Hypothesis.

## 12. Качество данных

Каждый report response сохраняет:

- exact request: ids, metrics, dimensions, filters, dates, timezone, attribution, accuracy;
- `sampled`, `sample_share`, `sample_size`, `sample_space`;
- `contains_sensitive_data`;
- `data_lag`;
- `total_rows` и признак округления;
- observed/fetched time, API/schema/extractor versions и response digest.

Состояния:

| Состояние | Значение | Допустимый вывод |
|---|---|---|
| `COMPLETE` | Сопоставимый ответ без material sampling/privacy/lag gaps | Описательные claims точного scope |
| `PARTIAL` | Часть dimensions/rows ограничена или UTM неполна | Только покрытая часть с limitation |
| `RARE` | Слишком мало наблюдений для устойчивого сравнительного вывода | Конфигурационные факты и точные counts; без обобщения |
| `STALE` | Окно или binding устарели относительно policy | Исторический контекст, не текущий claim |
| `UNAVAILABLE` | Отчёт или область не получены | Никакого нулевого значения |
| `CONFLICTING` | Несовместимые scope/goal/attribution/results | Обе версии + reconciliation или Gate |

Универсальный числовой minimum sessions/conversions не устанавливается. Claim, требующий статистического сравнения, должен иметь собственное versioned significance/uncertainty rule. Малый sample ограничивает claim, а не работоспособность измерения.

## 13. Допустимые и запрещённые утверждения

### 13.1 Допустимые описательные утверждения

При достаточном scope и качестве:

- точный счётчик и основная цель подтверждены официальным API;
- цель регистрирует выбранное тестовое действие;
- за exact period наблюдалось N сопоставимых сессий и M converted sessions;
- X из Y сессий прошли конкретный подтверждённый шаг;
- такой-то источник, UTM или landing наблюдался в exact segment;
- часть трафика не имеет полной разметки;
- между двумя наблюдаемыми стадиями есть арифметическая потеря;
- цель дублируется, конфликтует или относится к другому этапу;
- report sampled, privacy-limited, delayed, rare, stale или unavailable.

### 13.2 Только гипотезы

- конкретная посадочная или этап может требовать улучшения;
- неполная разметка может скрывать часть связи;
- наблюдаемая потеря может быть связана с содержанием, формой или технической проблемой;
- отдельный mechanism может улучшить будущий результат.

Такие statements получают classification `hypothesis`, альтернативные объяснения и ограничения.

### 13.3 Запрещённые выводы

- канал или landing вызвали конверсию;
- удаление/добавление канала даст определённый uplift;
- наблюдаемая конверсия является будущей конверсией Campaign Draft;
- отсутствующая строка означает ноль трафика или конверсий;
- Metrica показывает полную прибыль, qualified sales или CRM outcome без отдельного evidence;
- конкурент имеет такую же воронку, CPA, аудиторию или эффективность;
- attribution report доказывает инкрементальность;
- один сравнительный rate достаточен для изменения бюджета или разрешения публикации.

## 14. Выход в Analytics Evidence Snapshot

Домен `METRIKA` сохраняет:

```yaml
metrica_domain:
  schema_version: string
  contract_version: string
  observed_at: RFC3339
  measurement_binding: {...}
  counter_metadata:
    site: string
    mirrors: [string]
    status: string
    activity_status: string | UNKNOWN
    permission: read_scope
    timezone: IANA
    filters: bounded_summary
    available_period: {from: date | null, to: date | null}
  goal_catalog: [goal_candidate]
  report_views:
    all_channels: current_company_funnel | null
    direct_linked: current_company_funnel | null
    previous_comparison: current_company_funnel | null
    rare_traffic_context: current_company_funnel | null
  utm_quality:
    status: COMPLETE | PARTIAL | UNAVAILABLE | CONFLICTING
    linkage_counts: map
    missing_fields: [enum]
  claims: [claim_ref]
  evidence: [evidence_ref]
  gaps: [typed_gap]
  conflicts: [typed_conflict]
  versions: map
  input_digest: sha256
```

Provider IDs остаются в защищённых scope/binding fields и не превращаются в пользовательские или бизнес-факты.

## 15. Влияние на последующие этапы

### 15.1 Strategy Agent получает

- понятное название основной цели и qualified outcome;
- подтверждение/ограничение измеримости;
- наблюдаемую структуру источников и landing mix;
- текущую воронку и exact limitations;
- неполноту UTM и Direct linkage;
- Material Uncertainty и evidence refs.

Strategy Agent MAY изменить измеримый outcome, landing, exclusions, основное сообщение или measurement assumptions только в пределах подтверждённых фактов и текущего бизнес-входа. Он **MUST NOT** вывести из Метрики новый бюджет, target result cost или обещание эффективности.

### 15.2 Campaign Design Agent получает

- primary measurement binding;
- проверенные landing options;
- обязательный UTM/naming contract;
- наблюдаемые gaps как источники Campaign Hypothesis, но не как доказанные причины;
- exact measurement fields для Draft.

### 15.3 Campaign Hypothesis

Метрика MAY определить primary metric, baseline scope и измерительный контракт. Наблюдаемая потеря может породить Hypothesis только как проверяемый mechanism с альтернативами, а не как причинный факт.

### 15.4 Campaign Draft

Метрика влияет только на зависимые поля:

- measurement counter/goal binding;
- landing URL;
- tracking parameters;
- naming/UTM fields;
- измерительные и attribution notes, передаваемые в будущий launch preflight.

Она не разрешает публикацию, не меняет бюджет автоматически и не создаёт неполный Draft.

## 16. Редакции и зависимое аннулирование

Любое изменение counter, primary goal, attribution, report window, filters, UTM contract, funnel mapping или data-quality policy создаёт новую revision домена `METRIKA`. Изменение content digest создаёт новый `Analytics Evidence Snapshot` либо persisted replacement intent по действующему lifecycle.

Зависимый конус:

| Изменение | Аннулирование |
|---|---|
| Точный счётчик, primary goal, qualified outcome или регистрация события | Strategy и все зависимые Hypothesis + Draft |
| Material funnel claim, attribution semantics или business-relevant landing conclusion | Использующие claim Strategy/Hypothesis/Draft |
| Технический UTM/naming contract без изменения смысла | Связанные Draft и их `publish_fingerprint` |
| Только новый период с теми же material claims | Новая evidence revision и повторная проверка; смысловая пересборка не обязательна |
| Sampling/privacy/lag изменили допустимую силу consumed claim | Все результаты, которые опирались на прежнюю силу claim |
| Дополнительный необязательный breakdown без изменения consumed claims | Snapshot revision без аннулирования независимых результатов |

Dependency decision **MUST** определяться по consumed claim refs и material dependency signature, а не по факту любого технического изменения файла. Старые редакции остаются в системном следе, но никогда не смешиваются с текущими.

## 17. Повторы, резервные исходы и Human Decision Gate

- Временный безопасный API failure допускает до трёх инфраструктурных повторов с `Retry-After`.
- Schema drift, permission mismatch или counter conflict не маскируются повтором.
- Необязательный исторический report после исчерпания повторов становится `UNAVAILABLE`; человек не обязан восстанавливать его для нового бизнеса.
- Human Decision Gate допустим только для выбора между материально разными counter/goal meanings, недоступного обязательного read access или невозможности подтвердить регистрацию основной цели.
- Gate показывает рекомендацию, понятные labels, evidence, последствия и точное действие; provider IDs и credentials скрыты.
- Никакой fallback не создаёт/редактирует счётчик, цель, сайт или кампанию.

## 18. Компактный пользовательский контракт

### 18.1 Принцип

Dashboard **MUST** оставаться рабочим местом текущего бизнес-результата, а не аналитическим кабинетом Метрики. Отдельная страница, таблица всех целей, технический журнал или новый этап не создаются.

Внутри **«Сбор сведений»** показывается одна компактная карточка **«Метрика»**.

### 18.2 Основной вид

Не более пяти смысловых строк:

1. **Измерение:** понятные site + primary goal labels и краткий результат проверки.
2. **Период:** основной завершённый период либо «истории пока недостаточно».
3. **Воронка:** компактная цепочка наблюдаемых стадий с counts; только доступные стадии.
4. **Источники:** один краткий вывод о Direct/UTM/landing coverage.
5. **Влияние:** что именно учтено в Strategy/Hypothesis/Draft.

Качество выражается одной фразой рядом с выводом: «полные данные», «частичные данные», «редкие данные», «требует обновления» или «недоступно». Пользователю не показываются внутренние enum, provider ID, request parameters, digests, confidence vectors или списки технических ошибок.

### 18.3 Раскрытие

Одна необязательная ссылка **«Почему такой вывод»** раскрывает:

- период и attribution простыми словами;
- ограничения sampling/privacy/lag;
- названия использованных источников;
- какие решения агента поддержаны данными;
- какие утверждения сознательно не сделаны.

Исполнители, попытки, raw evidence и техническая диагностика остаются в очищенном системном следе и доступны чату для ответа на свободный вопрос.

### 18.4 Действие человека

Карточка показывает не более одного action packet и только когда:

- несколько материально разных счётчиков/целей нельзя выбрать автоматически;
- обязательный read access отсутствует;
- тестовое действие не регистрируется.

Неполные UTM, sampling, редкая история и отсутствие исторической воронки сами по себе не превращаются в пользовательскую задачу.

## 19. Сценарии приёмки для прототипа интерфейса

| Сценарий | Системный результат | Что видит человек | Draft |
|---|---|---|---|
| **Полный** | Binding verified, funnel complete | Цель, период, короткая воронка, источники, влияние | Допустим |
| **Частичный** | Binding verified, UTM/sampling/step partial | Тот же компактный блок + одна понятная limitation | Допустим без ложных claims |
| **Новый бизнес** | Binding и test event verified, history unavailable/rare | «Измерение работает; истории пока недостаточно», без пустого графика | Допустим |
| **Недоступный** | Exact binding/read/test blocked | Одна точная проблема и одно действие | Не формируется |
| **Несколько счётчиков** | Material counter conflict | Рекомендованный понятный выбор без IDs | Не формируется до решения |
| **Дублирующая цель** | Goal conflict | Какая бизнес-цель нужна и почему текущий выбор неоднозначен | Не формируется до решения |
| **UTM conflict** | Measurement works, traffic linkage conflicting | Краткое ограничение связи; future UTM contract показан как исправление Draft | Допустим, causal claims запрещены |
| **Stale report** | Binding verified, report stale | Измерение подтверждено; исторический вывод требует обновления | Допустим, stale claim не используется |

Прототип [«Проверить прозрачное отображение пайплайна в UI»](https://github.com/MOX-Studio/MOX-ADV/issues/311) **MUST** проверять эти состояния внутри общей карточки этапа, без отдельного конкурирующего интерфейса.

## 20. Согласование с принятыми решениями и передача в спецификацию

Контракт сохраняет решения:

- exact counter/goal и meaningful goal из задач привязки измерения;
- неизменяемый `Analytics Evidence Snapshot` как единственное аналитическое хранилище;
- Evidence Analyst + typed adapters + deterministic builder;
- отсутствие browser cabinets и внешних mutations;
- отсутствие partial Draft;
- один текущий пользовательский результат и компактный Dashboard.

Для будущей спецификации важно явно устранить три текущих расхождения реализации:

1. фиксированный minimum из трёх historical goal visits не должен сам блокировать Draft; он может ограничивать только claim;
2. ожидаемый `counter_id` не должен вводиться владельцем как provider identifier — требуется discovery и deterministic match;
3. `METRIKA` domain с verified binding, но unavailable history должен быть `PARTIAL/RARE`, а не общим hard-unavailable measurement state.

Текущий Wayfinder не реализует эти изменения.

## 21. Источники

### Официальные источники Яндекс

- [List of available tags — Management API](https://yandex.com/dev/metrika/en/management/openapi/counter/counters) — status, permission, search by name/site/mirrors, metadata счётчика.
- [Authorization](https://yandex.com/dev/metrika/en/intro/authorization) — `metrika:read` и access boundary.
- [List of goals](https://yandex.com/dev/metrika/en/management/openapi/goal/goals) — goal catalog и metadata.
- [What are goals?](https://yandex.com/support/metrica/en/general/goals) — conversion, converted session и goal semantics.
- [Checking a goal](https://yandex.com/support/metrica/en/general/check-goal) — проверка регистрации события и отражения в отчётах.
- [Multi-step goal](https://yandex.com/support/metrica/en/general/goal-steps) — последовательность подтверждённых шагов внутри одной сессии.
- [Funnels](https://yandex.com/support/metrica/en/reports/funnels) — first-step/previous-step conversion и segment dimensions.
- [Reports API table](https://yandex.com/dev/metrika/en/stat/openapi/data) — dates, timezone, filters, sampling, privacy и lag metadata.
- [Dimensions and metrics](https://yandex.com/dev/metrika/en/stat/attrandmetr/dim_all) — UTM, landing, source, goal и Direct dimensions.
- [Parametrization](https://yandex.com/dev/metrika/en/stat/param) — goal metrics и attribution models.
- [Sampling](https://yandex.com/dev/metrika/en/stat/sampling) — accuracy и sample metadata.
- [Statistical accuracy](https://www.yandex.com/support/metrica/en/reports/false-data) — запрет устойчивого вывода по единичным наблюдениям.
- [How to work with data](https://yandex.com/support/metrica/en/pro/data-work) — ретроспективное обновление и 99% завершённых сессий в среднем за три дня.

### Принятые источники проекта

- [`analytics-evidence-contract.md`](analytics-evidence-contract.md) — provenance, claims, sampling/privacy, source policy и Snapshot.
- [`yandex-direct-metrica-capabilities.md`](yandex-direct-metrica-capabilities.md) — attribution, limits, lag и API boundary.
- [`landing-page-advisory-analysis-contract.md`](landing-page-advisory-analysis-contract.md) — описательная, а не причинная роль поведения Метрики.
- [`CONTEXT.md`](../../CONTEXT.md) — Campaign Strategy, Campaign Hypothesis, Campaign Draft, Material Uncertainty и Human Decision Gate.
- [`ADR-0001`](../adr/0001-agent-owns-safe-work.md) — агент самостоятельно выполняет безопасное исследование и не превращает обычные пробелы в работу владельца.

## 22. Уверенность и остаточные ограничения

- **Высокая уверенность:** API boundary, counters/goals metadata, UTM dimensions, attribution parametrization, sampling/privacy/lag fields, goal registration check и запрет причинных claims.
- **Средне-высокая уверенность:** разделение measurement binding и historical analysis следует непосредственно из официальной семантики и принятых hard gates проекта.
- **Продуктовая политика:** окна 28/28/90, compact-card limit и dependency materiality являются версионируемым решением MOX-ADV, а не обещанием Яндекса.
- **Остаточное ограничение:** account-specific доступность fields, filters и report compatibility проверяется только future implementation preflight; текущий контракт не выполнял production API calls и не использовал credentials.
