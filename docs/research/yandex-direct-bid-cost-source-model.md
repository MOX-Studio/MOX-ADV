# Допустимые источники и модель анализа рекламных ставок Яндекс Директа

**Ticket:** [GitHub #312 «Определить допустимые источники и модель анализа рекламных ставок»](https://github.com/MOX-Studio/MOX-ADV/issues/312)
**Срез исследования:** 2026-08-31
**Назначение:** исследовательское решение Wayfinder и нормативный P0-контракт; не реализация и не прогноз эффективности.
**Нормативные слова:** **MUST / MUST NOT / SHOULD / MAY** имеют обязательный / запрещающий / рекомендуемый / разрешающий смысл.

## Summary

P0 может читать собственные фактические настройки и статистику рекламодателя через Direct Management API v5 и Reports v501. Для существующего `KeywordId` `KeywordBids.get` условно даёт текущую пользовательскую ставку и аукционные сценарии Search/Network, но не даёт сигнал для ещё не созданной фразы; `AuctionBids.Price` — сценарная цена клика для объёма трафика, а не исторически списанный CPC и не прогноз результата ([официальный `KeywordBids.get`](https://yandex.com/dev/direct/doc/en/keywordbids/get)).

Предзапусковая стоимость не является обязательным полем полного Campaign Draft: при подтверждённых business-owned бюджете, периоде и экономике результатом может быть полный Draft с `prelaunch_cost=UNAVAILABLE` и ограниченной бюджетом проверкой без прогноза. Однако отсутствие бюджета блокирует publishable экономическую конфигурацию, отсутствие target result cost блокирует стратегии, которым он нужен, а конфликт источников стоимости блокирует только зависящее от него решение — не исследовательский Draft целиком.

Legacy v4/Live 4 документирован только условно: текущая страница v5 прямо направляет budget forecast и keyword selection к методам v4, а справочник v5 также указывает, что эти возможности находятся в Live 4. Это доказывает наличие официальной документационной поверхности, но не подтверждает доступность конкретному аккаунту, SLA, пригодность для новой интеграции или разрешение проекта. Поэтому capability имеет статус `CONDITIONAL`, а operational status P0 остаётся `UNAVAILABLE` до отдельного read-only preflight; Live 4 нельзя ставить выше v5/first-party history по умолчанию ([v5 statistics best practice](https://yandex.com/dev/direct/doc/en/best-practice/statistics), [официальный справочник v5](https://yandex.com/dev/direct/doc/en/concepts/about)).

---

## 1. Как читать решения

Каждый тезис ниже маркирован:

- **Документированный факт** — прямо следует из первичной официальной документации Яндекса.
- **Вывод** — консервативное следствие из нескольких документированных фактов или отсутствия поля/метода в документированном интерфейсе.
- **Проектное решение** — нормативная политика MOX-ADV, не приписываемая Яндексу.

Статусы capability:

- **SUPPORTED** — официальный текущий API прямо документирует нужное чтение в указанном scope.
- **CONDITIONAL** — capability существует, но только для конкретных объектов, стратегий, размещений, полей или при иных проверяемых условиях.
- **UNAVAILABLE** — текущий разрешённый P0-контур не имеет документированной capability; отсутствие данных не равно нулю.

---

## 2. Строгая типология денежных сущностей

| Тип | Нормативное значение | Разрешённый первичный источник | Что типом не является |
|---|---|---|---|
| `actual_bid` | Фактически сохранённая **пользовательская ставка** для существующего критерия: `Search.Bid`, `Network.Bid` либо `Keywords.get.Bid/ContextBid`; money micros в валюте пользователя | `KeywordBids.get`, `Keywords.get` | Не фактически списанный CPC; слово `actual` относится к readback настройки, а не к цене клика |
| `bid_ceiling` | Верхнее ограничение ставки автоматической/ограниченной стратегии (`BidCeiling`), если поле предусмотрено конкретной strategy structure | `Campaigns.get` / `Strategies.get` | Не средний CPC, не гарантируемая максимальная цена каждого результата, не budget |
| `auction_proxy` | Текущий условный аукционный сценарий: Search `AuctionBidItem.{TrafficVolume,Bid,Price}` либо Network `CoverageItem.{Probability,Bid}` для существующего `KeywordId` | `KeywordBids.get` | Не историческое списание, не forecast кликов/конверсий/CPA, не сигнал для несуществующего keyword |
| `historical_cpc` | Наблюдавшаяся собственная стоимость клика за период: `AvgCpc` либо детерминированный `Cost/Clicks` в одном согласованном report scope | Direct Reports v501 | Не ставка, не предзапусковая цена новой фразы, не конкурентный CPC |
| `external_estimate` | Оценка лицензированного внешнего поставщика с договором, методологией, locator и scope | Licensed external source | Не факт Яндекса, не first-party observation; не может повышаться до `auction_proxy`/`historical_cpc` |
| `target_result_cost` | Business-owned безопасная целевая/предельная стоимость квалифицированного результата, подтверждённая владельцем или его экономической моделью | Owner decision / owner-provided business artifact | Не CPC, не ставка, не автоматически наблюдаемая CPA |
| `CPA` | Только с подтипом: `historical_cpa = CostPerConversion` в согласованном Reports scope; `strategy_target_cpa = AverageCpa/Cpa` в настройках стратегии | Direct Reports / Campaigns or Strategies Management API | Нельзя объединять actual и target CPA одним полем; нельзя подменять `target_result_cost` |
| `budget` | Ограничение расхода: weekly/custom-period/daily budget конкретной кампании или стратегии | Campaigns/Strategies Management API либо owner decision для Draft | Не ставка и не прогноз расхода; заданный budget не обещает, что он будет освоен |

**Документированный факт.** `KeywordBids.get` называет `Search.Bid` и `Network.Bid` ставками, установленными пользователем; `AuctionBids` содержит ставки и actual CPC для разных traffic volumes, а `Coverage` — ставки для процентов охвата Network. Все значения умножены на 1 000 000 ([`KeywordBids.get`](https://yandex.com/dev/direct/doc/en/keywordbids/get)).

**Документированный факт.** Unified campaign возвращает отдельные структуры `WbMaximumClicks`, `WbMaximumConversionRate`, `AverageCpc`, `AverageCpa`, `PayForConversion` и в допустимых структурах `WeeklySpendLimit`, `BidCeiling`, `GoalId`, `AverageCpc`, `AverageCpa`/`Cpa`; денежные настройки задаются в валюте пользователя × 1 000 000 ([`Campaigns.get`: UnifiedCampaign](https://yandex.ru/dev/direct/doc/en/campaigns/get-unified-campaign)).

**Проектное решение.** В UI и артефакте MUST показываться точный `semantic_type`; нейтральные поля `cost`, `price`, `ставка` без типа запрещены.

---

## 3. Capability matrix

| Capability | Статус | Документированный факт / условие | Контракт MOX-ADV |
|---|---|---|---|
| Собственная историческая стоимость, клики и CPA | **SUPPORTED** | Reports v501 возвращает статистику аккаунта; monetary fields включают `AvgCpc`, `Cost`, `CostPerConversion`, а report type задаёт группировку ([Reports](https://yandex.com/dev/direct/doc/en/reports), [report fields](https://yandex.com/dev/direct/doc/en/fields-list), [report types](https://yandex.com/dev/direct/doc/en/type)) | Только exact advertiser scope; сохранять request spec, period, grouping, attribution/goal, currency, VAT и sample size |
| Фактическая сохранённая ставка существующего keyword | **SUPPORTED** | `KeywordBids.get` принимает `KeywordIds`/`AdGroupIds`/`CampaignIds`, возвращает `Search.Bid` и `Network.Bid`; чтение допустимо при manual и automatic strategy ([`KeywordBids.get`](https://yandex.com/dev/direct/doc/en/keywordbids/get)) | Тип `actual_bid`; не называть списанным CPC |
| Search auction proxy существующего keyword | **CONDITIONAL** | `AuctionBids` возвращается для существующего keyword, но `null` для autotargeting, rarely served group и image-only group; нельзя запрашивать при Search `SERVING_OFF` ([`KeywordBids.get`](https://yandex.com/dev/direct/doc/en/keywordbids/get)) | Тип `auction_proxy`; один `KeywordId`, timestamp и traffic-volume scenario обязательны |
| Network coverage proxy существующего keyword | **CONDITIONAL** | `Coverage` может быть `null` при `RARELY_SERVED`, `SERVING_OFF`, `NETWORK_DEFAULT` и autotargeting ([`KeywordBids.get`](https://yandex.com/dev/direct/doc/en/keywordbids/get)) | Не смешивать с Search и не преобразовывать probability в клики |
| Auction proxy для ещё не созданного keyword | **UNAVAILABLE** | `KeywordBids.get` выбирает только существующие IDs; `Keywords.add` создаёт объект и лишь после успеха возвращает его `Id` ([`KeywordBids.get`](https://yandex.com/dev/direct/doc/en/keywordbids/get), [`Keywords.add`](https://yandex.com/dev/direct/doc/en/keywords/add)) | Нельзя создавать внешний объект ради research-ticket; до создания exact signal = unavailable |
| Auction proxy для новой фразы через «похожий» существующий keyword | **UNAVAILABLE** как exact; **CONDITIONAL** как comparable proxy | API привязывает auction data к конкретному `KeywordId`, а не к произвольной строке | Разрешено лишь `auction_proxy_comparable` после строгой scope-проверки; label MUST раскрывать, что это другой keyword |
| Manual keyword bid write | **CONDITIONAL** | `Keywords.add` позволяет `Bid`/`ContextBid` только для соответствующих manual strategies; при automatic strategy переданные значения не применяются ([`Keywords.add`](https://yandex.com/dev/direct/doc/en/keywords/add)) | Research read-only; capability учитывается только при проектировании, не исполняется |
| Automatic strategy exact keyword bids | **UNAVAILABLE** как actuator | При automatic strategy ставки задаются автоматически; `KeywordBids.get` позволяет read, но ручное изменение стратегии ограничено ([strategy overview](https://yandex.com/dev/direct/doc/en/objects/campaign-strategies), [`Keywords.add`](https://yandex.com/dev/direct/doc/en/keywords/add)) | Управлять objective, goal, budget и поддерживаемыми ceilings, а не выдумывать keyword bid |
| Campaign/portfolio strategy settings и ceilings | **CONDITIONAL** | Набор структур зависит от campaign/placement/strategy; `BidCeiling` nillable и не у каждой стратегии ([Unified campaign get](https://yandex.ru/dev/direct/doc/en/campaigns/get-unified-campaign), [`Strategies.get`](https://yandex.com/dev/direct/doc/en/strategies/get)) | Exact account/type/placement preflight; отсутствие поля не равно нулевому ceiling |
| Currency и технические границы | **SUPPORTED** | Monetary management values — micros в валюте пользователя; currency limits доступны через `Dictionaries.get` ([currency dictionary](https://yandex.com/dev/direct/doc/en/dictionaries/get), [`KeywordBids.get`](https://yandex.com/dev/direct/doc/en/keywordbids/get)) | Хранить integer micros + ISO 4217; FX-конверсия только отдельным лицензированным source/time |
| VAT в Direct Reports | **SUPPORTED** | `IncludeVAT` управляет VAT для перечисленных report monetary fields; Metrica-derived Revenue от него не зависит ([Reports money](https://yandex.com/dev/direct/doc/en/money)) | `vat_treatment` обязателен для report cost |
| VAT для Management bid/ceiling | **UNAVAILABLE** как явно документированная report-equivalent семантика | Management docs указывают валюту и micros, но рассмотренная документация не задаёт эквивалент `IncludeVAT` для bid/ceiling ([`KeywordBids.get`](https://yandex.com/dev/direct/doc/en/keywordbids/get), [Reports money](https://yandex.com/dev/direct/doc/en/money)) | Помечать `VAT_NOT_SPECIFIED_BY_ENDPOINT`; не нормализовать с report cost догадкой |
| Direct Reports sampling flag | **UNAVAILABLE** | Reports документирует TSV, groupings, row/page limits и online/offline lifecycle, но не sampling flag ([Reports](https://yandex.com/dev/direct/doc/en/reports), [report specification](https://yandex.com/dev/direct/doc/en/spec)) | Не заявлять «unsampled»; хранить `sampling_disclosure=NOT_EXPOSED`, rows/clicks и completeness checks |
| Freshness historical statistics | **CONDITIONAL** | Данные обычно стабилизируются за 3 дня и могут исправляться позднее; Яндекс рекомендует reread/AUTO ([freshness](https://yandex.com/dev/direct/doc/en/actual)) | Последние 3 дня provisional; evidence TTL не подменяет platform revision window |
| Query history | **CONDITIONAL** | `SEARCH_QUERY_PERFORMANCE_REPORT` группируется по `AdGroupId` и `Query`; поле Query доступно за последние 180 дней ([report type](https://yandex.com/dev/direct/doc/en/type), [restrictions](https://yandex.com/dev/direct/doc/en/restrictions)) | Query — наблюдавшийся trigger, не keyword phrase и не Wordstat phrase |
| Legacy Live 4 budget forecast | **CONDITIONAL** документально; operationally **UNAVAILABLE** для P0 до preflight | Текущие v5 best-practice и справочник прямо направляют budget forecast/keyword selection к методам v4/Live 4, но не обещают доступность конкретному аккаунту, SLA или пригодность новой интеграции ([statistics best practice](https://yandex.com/dev/direct/doc/en/best-practice/statistics), [справочник v5](https://yandex.com/dev/direct/doc/en/concepts/about)) | До отдельной проверки доступа, условий и exact scope держать источник в quarantine; не выбирать по умолчанию и не ставить выше v5/first-party history |
| Wordstat CPC/bid/budget | **UNAVAILABLE** | Wordstat v1 документирует top requests, dynamics и regions, но не CPC/bid/budget fields ([Wordstat API v1](https://yandex.com/support2/wordstat/en/content/api-structure)) | Wordstat MUST NOT входить в cost candidates |
| Ставки, бюджеты, CPC, CPA и результаты конкурентов | **UNAVAILABLE** без прямого законного источника | Рассмотренные Direct APIs требуют права к собственному advertiser account ([Direct overview](https://yandex.com/dev/direct/doc/en/concepts/overview)) | Публичное объявление не доказывает внутреннюю экономику конкурента |

---

## 4. Источники и допустимый вес

### 4.1 Собственные Direct Reports / Management API

**SUPPORTED / highest evidence quality.** Разрешены только OAuth-authorized read calls точного владельца и `Client-Login`/account scope.

- Management: `actual_bid`, `bid_ceiling`, strategy target CPA/CPC, campaign/strategy budget, currency and object state.
- Reports: `historical_cpc`, historical actual CPA, cost/click/conversion observations.
- `KeywordBids.get`: `auction_proxy` только для существующего keyword и только с документированными null/placement restrictions.

Каждый record MUST содержать endpoint, method, request digest, account/client, IDs, response locator, RequestId если доступен, observed time, raw micros и transform.

### 4.2 Owner-provided artifact

**CONDITIONAL.** Разрешён immutable export/отчёт владельца, если есть generation time, advertiser scope, period, metric definition, currency, VAT, dimensions, sample size, digest и подтверждение владельца. Он может доказать `target_result_cost`, `budget` или lower-tier `historical_cpc`; скриншот/таблица без scope не доказывает cost.

Owner artifact MUST NOT изображаться как API observation. Если официальный API доступен, API SHOULD иметь приоритет для platform facts; artifact остаётся corroboration или fallback.

### 4.3 Licensed external source

**CONDITIONAL / lower tier.** Разрешён только как `external_estimate`, если зафиксированы provider, license/terms, access right, methodology/version, query/geo/device/placement/period scope, currency/VAT, sample size, observed_at и immutable locator/digest. Он не становится factual Yandex capability, не смешивается с own Direct observations и не доказывает конкурентов.

### 4.4 UNAVAILABLE

Значение MUST быть `UNAVAILABLE`, а не `0`, если:

- keyword ещё не создан и нет существующего сопоставимого first-party observation;
- `AuctionBids`/`Coverage` вернул `null` по документированному ограничению;
- нет exact account authorization;
- source stale, scope-incompatible, currency/VAT-incompatible или без sample;
- доступен только Wordstat frequency;
- доступен legacy Live 4 reference без подтверждённого текущего operational contract;
- утверждение касается внутренних ставок/бюджетов/результатов конкурента без прямого легитимного источника.

---

## 5. Сопоставимость: обязательная размерность

Два cost observation сопоставимы только если каждое поле ниже имеет `SAME`, допустимое versioned `MAPPED`, либо observation отклоняется. `UNKNOWN` не является `SAME`.

| Размерность | Требование |
|---|---|
| Phrase / query | Сохранять original keyword с операторами, negative words и match semantics. `Query` report — фактический запрос; `Keyword` — критерий; Wordstat phrase — demand aggregate. Exact query ↔ keyword equivalence нельзя предполагать |
| Geography | Official region IDs и hierarchy snapshot; различать targeting location и observed user/location dimension. Текстовые названия без ID — только owner artifact lower tier |
| Device | Desktop/mobile/tablet/other либо exact report dimension; all-device aggregate нельзя сравнивать с device slice без пересчёта из совместимых строк |
| Search / Network | Отдельные populations. Search `AuctionBids` и Network `Coverage` никогда не объединяются |
| Placement | SearchResults/ProductGallery/DynamicPlaces/Maps/SearchOrganizationList/Network и report `Placement`; смешение требует отдельного aggregate, не «один CPC» |
| Strategy | Manual, `WB_MAXIMUM_CLICKS`, `AVERAGE_CPC`, conversion strategy и т. п.; смена strategy создаёт новый scope. Bid ceiling сохраняется отдельно |
| Period / season | Exact `[from,to]`, timezone, weekday mix и named season. Текущие auction scenarios нельзя называть историческим периодом; historical comparison требует comparable season |
| Currency | Exact ISO 4217. Разные валюты — несовместимы без отдельного licensed FX source и timestamp |
| VAT | `INCLUDED`, `EXCLUDED`, `NOT_APPLICABLE`, `NOT_SPECIFIED_BY_ENDPOINT`. Unknown VAT не сравнивается с known VAT как денежный факт |
| Sample size | Для history: clicks и rows/days; для query: query rows/clicks; для auction proxy: число `KeywordId` и traffic-volume scenarios. Один proxy item — не empirical sample |
| Advertiser/object | Exact owner account, campaign, ad group, keyword/autotargeting IDs. Межаккаунтный перенос — только external/comparable estimate |
| Data maturity | Reports: последние 3 дня provisional; corrections checked. Auction proxy: observed_at + короткий project TTL; stale не выбирается |
| Attribution/goal | Обязательно для CPA/conversion metrics; одинаковые goal IDs и attribution. Для CPC поле явно `NOT_APPLICABLE`, но report spec сохраняется |

**Документированный факт.** Reports поддерживает period selection и aggregation по `Date`, `Week`, `Month`, `Quarter`, `Year` ([report period](https://yandex.com/dev/direct/doc/en/period)); report types используют single attribution каждого impression/click к одному criterion/region и т. п. ([report type](https://yandex.com/dev/direct/doc/en/type)).

**Проектное решение.** Источники с разным scope MUST NOT усредняться. Допускается несколько параллельных observations с разными labels; выбирается максимум один источник для одного P0 decision.

---

## 6. P0 source priority и fallback policy

### 6.1 Приоритет для предстартовой оценки покупательной способности бюджета

1. **`DIRECT_REPORTS_OWN_HISTORICAL_CPC`** — свежий, зрелый, достаточно объёмный historical observation из того же account и максимально совпадающего phrase/query cluster, geo, device, placement, strategy и season. Это наблюдавшийся CPC, а не forecast новой кампании.
2. **`KEYWORDBIDS_V5_CURRENT_AUCTION_PROXY`** — exact existing `KeywordId`, exact placement и traffic-volume/coverage scenario. Используется как current scenario, когда historical observation отсутствует или задача именно про текущую auction surface.
3. **`OWNER_PROVIDED_DIRECT_EXPORT`** — только если API read недоступен и artifact проходит provenance/scope checks.
4. **`LICENSED_EXTERNAL_ESTIMATE`** — только indicative sensitivity; никогда не API fact.
5. **`UNAVAILABLE`** — честный default.

**Проектное решение.** Это не универсальная «истина по цене»: если вопрос — «какая ставка сейчас сохранена», выбирается `actual_bid`; если «какой ceiling задан», выбирается `bid_ceiling`; если «что реально платили», выбирается `historical_cpc`. Несовпадающие semantics не участвуют в одном precedence list.

### 6.2 Запрещённые fallback

- MUST NOT использовать `target_result_cost / предполагаемую конверсию` для выдуманного CPC.
- MUST NOT выводить clicks, conversions, CPA, revenue или effectiveness из `auction_proxy`.
- MUST NOT считать недоступное нулём или midpoint наблюдением. Midpoint допустим только как явно раскрытая sensitivity convention.
- MUST NOT усреднять Direct Reports, KeywordBids, artifact и external estimate.
- MUST NOT использовать Wordstat как CPC, bid или budget.
- MUST NOT использовать ставки/бюджеты/результаты конкурентов без прямого лицензированного источника с правом доступа; даже тогда тип остаётся `external_estimate` или owner-provided observation, не знанием об аукционе.
- MUST NOT использовать legacy Live 4 как default или highest-priority source.

### 6.3 Freshness

- Historical Reports за последние три дня MUST иметь `PROVISIONAL`; зрелый диапазон SHOULD исключать эти дни или отдельно их показывать ([Direct freshness](https://yandex.com/dev/direct/doc/en/actual)).
- `Query` старше 180 дней недоступен в Reports и не может обещаться ([Reports restrictions](https://yandex.com/dev/direct/doc/en/restrictions)).
- Для `auction_proxy` Яндекс не публикует в рассмотренной документации SLA актуальности. P0 MUST задавать собственный короткий TTL и показывать `observed_at`; TTL — project decision, не API fact.
- Direct Reports не раскрывает sampling flag. P0 MUST показывать фактический sample (`clicks`, rows, days) и `sampling_disclosure=NOT_EXPOSED`, а не утверждать `unsampled`.

---

## 7. Draft, business input и блокировки

### 7.1 Полный Draft допустим без стоимости

**Проектное решение.** `prelaunch_cost=UNAVAILABLE` допускает полный, редактируемый и owner-reviewable Campaign Draft, если определены offer, audience, qualified result, exclusions, geo, period, landing, exact Direct projection, measurement status, **weekly/custom-period budget ceiling** и безопасная strategy capability. Такой Draft:

- MUST показывать `cost_status=UNAVAILABLE` и причины;
- MAY использовать bounded traffic-validation strategy;
- MUST NOT обещать clicks/results/CPA/profit;
- MUST NOT получать наблюдаемый cost score; comparative sensitivity может использовать disclosed unknown range, но label обязан говорить «не прогноз»;
- может быть structurally complete, но publish eligibility оценивается отдельными gates.

### 7.2 Требуется точечный business input

Owner Decision Gate нужен только для business-owned значения:

- нет максимального weekly/custom-period `budget` → спросить ровно допустимый предел расхода;
- выбрана strategy, которой нужен target CPA/result cost, но `target_result_cost` не подтверждён → спросить предел стоимости qualified result;
- owner выбирает manual strategy, но нет безопасного `actual_bid`/ceiling решения → предложить автоматическую bounded alternative либо запросить конкретный максимальный bid; нельзя подставлять auction proxy молча;
- currency/VAT business interpretation owner artifact неясна → запросить пояснение только к artifact, а не к API capability.

### 7.3 Блокируется конкретная экономическая конфигурация

- Нет budget → блокируется publishable campaign configuration и external spend, но не исследовательский Draft.
- Нет target result cost → блокируются `AVERAGE_CPA`/`PAY_FOR_CONVERSION` и любые claims об economics; `WB_MAXIMUM_CLICKS` bounded draft может остаться допустимым при подтверждённом budget.
- Нет exact goal/measurement readiness → блокируются conversion strategies и claim «готово к оптимизации», но не обязательно safe non-serving Draft.
- Нет manual bid и нет допустимого proxy → блокируется manual-bid projection; automatic bounded strategy может быть fallback.
- Конфликт cost observations → блокируется выбор диапазона и cost-dependent ranking/configuration; конфликт MUST NOT автоматически уничтожать полный Draft, если Draft не требует CPC/ceiling.
- Unsupported Direct capability → блокируется только соответствующая campaign/placement/strategy projection.

**Проектное решение.** `Draft completeness`, `economic configuration eligibility`, `publish eligibility` и `effectiveness claim eligibility` MUST быть четырьмя разными статусами. Это предотвращает ложную логику «нет CPC → нет Draft» и обратную ошибку «есть auction price → известна эффективность».

---

## 8. Что разрешено показывать владельцу

В collapsed summary разрешено:

- semantic label: «Сохранённая ставка», «Ограничение ставки», «Текущий аукционный сценарий», «Исторический CPC», «Внешняя оценка», «Целевая стоимость результата», «Фактический CPA», «Бюджет»;
- range/value, ISO currency, VAT treatment, micros transform;
- source class и exact owner scope без токенов/секретов;
- phrase/query label, official region IDs/display, device, Search/Network/placement, strategy, period/season;
- sample size, freshness/provisional badge, observed_at;
- `SUPPORTED / CONDITIONAL / UNAVAILABLE`, null reason и fallback consequence;
- фразы «не прогноз эффективности», «не стоимость результата», «данные другого keyword» где применимо.

В drill-down разрешено:

- endpoint/method, request digest, response row/object locator, IDs, field names, transforms, candidate dispositions и rejection reasons;
- owner artifact locator/digest/license policy;
- deterministic rationale и project rule/version.

Запрещено показывать:

- OAuth tokens, credentials, лишние PII;
- chain-of-thought;
- конкурентные ставки, бюджеты, CPC, CPA, conversions/revenue как известные без легитимного прямого source;
- Wordstat frequency рядом с валютным знаком или как cost;
- `AuctionBids.Price` под названием «прогноз CPC кампании»;
- один score без semantic types, uncertainty и blockers.

---

## 9. Аудит текущей реализации #262/#263

### 9.1 Что уже соответствует контракту

1. **[OK] `sites/p0-production/lib/campaign-strategy.ts`** — `StrategyPrelaunchCostDecision` разделяет CPC proxy и `target_result_cost`, всегда фиксирует `effectiveness_forecast: false`, запрещает подмену через `target_result_cost_used_as_keyword_cost: false`; состояния `QUALIFIED_RANGE`, `BOUNDED_TRAFFIC_FALLBACK`, `OWNER_ECONOMICS_EDIT_REQUIRED`, `COST_EVIDENCE_BLOCKED` раскрыты тестами.
2. **[OK] `sites/p0-production/lib/campaign-viability.ts`** — owner-facing contract маркирует score как `COMPARATIVE PRELAUNCH PRIORITY / NOT A PREDICTION`, раскрывает cost scope, source, currency, VAT, sample и не использует CPC/target-result-cost ratio как прогноз.
3. **[OK] `sites/p0-production/tests/campaign-strategy.test.mjs`** — покрыты qualified range, unavailable bounded fallback, economics edit и conflict fail-closed.
4. **[OK] `sites/p0-production/tests/campaign-viability.test.mjs`** — покрыты optional unavailable cost как midpoint sensitivity, scope isolation, source/sample disclosure и запрет смешения keyword cost с target result cost.
5. **[OK] `sites/p0-production/tests/fixtures/direct/keyword-bids.json`** — fixture корректно сохраняет `TrafficVolume`, `Bid`, `Price` в micros и exact IDs.

### 9.2 Findings

1. **[BLOCKER] `sites/p0-production/lib/market-evidence.ts` — legacy Live 4 стоит первым в исполняемом `COST_PRECEDENCE`; `analytics-evidence.ts` повторяет этот порядок в provenance.** Текущая последовательность `LEGACY_LIVE4_SCENARIO → KEYWORDBIDS_V5_CURRENT_PROXY → DIRECT_HISTORY_OWN_EMPIRICAL` превращает условную документационную поверхность в предпочтительный production source без account-specific preflight. Проектное решение этого документа: удалить Live 4 из выбираемых P0 candidates или держать только в quarantined `UNAVAILABLE/UNVERIFIED_LEAD` до отдельной проверки. [v5 statistics](https://yandex.com/dev/direct/doc/en/best-practice/statistics) · [справочник v5](https://yandex.com/dev/direct/doc/en/concepts/about)
2. **[HIGH] `sites/p0-production/lib/market-evidence.ts` — priority history/proxy не соответствует semantic-purpose policy.** Универсальный first-qualified precedence выбирает current auction proxy раньше фактической собственной history. Нужен decision-purpose discriminator: historical paid CPC → Reports history; current existing-keyword scenario → KeywordBids. Источники нельзя ранжировать одной шкалой для разных semantic types.
3. **[HIGH] `sites/p0-production/lib/campaign-strategy.ts` — `semantic` всегда `KEYWORD_COST_PER_CLICK_AUCTION_PROXY`.** Qualified `DIRECT_HISTORY_OWN_EMPIRICAL` в тесте также получает auction-proxy semantic. Это смешивает `historical_cpc` и `auction_proxy`; поле должно наследовать строгий тип выбранного observation.
4. **[HIGH] `sites/p0-production/lib/campaign-strategy.ts` — qualification слишком поверхностна.** `buildStrategyPrelaunchCostDecision` проверяет status/range/source/currency, но не валидирует обязательные phrase/query, geo, device, Search/Network, placement, strategy, period/season, VAT, sample adequacy и freshness. Она доверяет upstream object; контракт границы должен быть schema-validated или проверен invariant-ами.
5. **[HIGH] `sites/p0-production/lib/campaign-strategy.ts` и `campaign-viability.ts` — cost conflict блокирует весь Draft/score.** Для конфигурации, не использующей CPC/ceiling, это шире необходимого. Должны отдельно блокироваться cost selection и cost-dependent economic configuration; structurally complete non-serving Draft остаётся reviewable.
6. **[MEDIUM] `sites/p0-production/lib/analytics-evidence.ts` — фиксированная generic freshness 3/30 дней не выражает разные semantics.** Трёхдневное окно Direct относится к стабилизации Reports, а не к freshness `KeywordBids` auction proxy. Нужны отдельные policies: report maturity/correction и project TTL proxy.
7. **[MEDIUM] `sites/p0-production/tests/analytics-evidence.test.mjs` — нет явного regression test, что Wordstat никогда не входит в cost candidates.** Текущие Wordstat tests проверяют unavailable frequency, но не cost-source denylist.
8. **[MEDIUM] `sites/p0-production/tests/analytics-evidence.test.mjs` — нет прямого cross-source test для priority, no averaging и semantic preservation.** Нужны одновременно history + KeywordBids + legacy/external candidates с проверкой purpose-specific selection и rejection dispositions.
9. **[MEDIUM] `sites/p0-production/tests/fixtures/direct/keyword-bids.json` — fixture не покрывает документированные null cases.** Нужны autotargeting, `RARELY_SERVED`, image-only/Search off и Network `SERVING_OFF/NETWORK_DEFAULT` cases, чтобы `null` оставался `UNAVAILABLE`, не `0`.

---

## 10. Нормативная схема observation и decision

```yaml
cost_observation:
  observation_id: string
  semantic_type: actual_bid|bid_ceiling|auction_proxy|historical_cpc|external_estimate|target_result_cost|historical_cpa|strategy_target_cpa|budget
  source_class: direct_management_api|direct_reports_api|owner_provided_artifact|licensed_external_source
  source_locator: {service, method, object_or_row_locator, request_digest}
  owner_scope: {client_login, campaign_id?, ad_group_id?, keyword_id?}
  scope:
    phrase: {kind: keyword|query|cluster, original, operators?, mapping_rule?}
    geo: {region_ids: [], basis: targeting|observed_location}
    devices: []
    channel: SEARCH|NETWORK
    placements: []
    strategy: {type, revision_or_observed_at}
    period: {from?, to?, timezone?, season_label?}
  money: {low_micros?, high_micros?, value_micros?, currency, vat_treatment}
  sample: {unit: clicks|rows|days|keyword_ids|scenarios, value, secondary: {}}
  freshness: {observed_at, maturity: MATURE|PROVISIONAL|NOT_APPLICABLE, ttl_status}
  provenance: {raw_digest, immutable_pointer, license_or_terms_url?}
  capability_status: SUPPORTED|CONDITIONAL|UNAVAILABLE
  limitations: []

cost_decision:
  purpose: CURRENT_SAVED_BID|CURRENT_AUCTION_SCENARIO|HISTORICAL_PAID_CPC|BID_CEILING|BUDGET_AFFORDABILITY
  status: SELECTED|UNAVAILABLE|CONFLICTING
  selected_observation_id: string|null
  candidate_dispositions: [{observation_id, disposition, reason_codes: []}]
  averaging_allowed: false
  effectiveness_forecast: false
```

`UNAVAILABLE` observation MAY be represented as a gap rather than a fake money record. Zero money is valid only when официальный source действительно вернул zero и семантика поля допускает zero; отсутствие/null никогда не преобразуется в zero.

---

## 11. Acceptance checks для будущей реализации

- Every money value has `semantic_type`, currency, unit/micros transform and VAT disclosure.
- Existing-keyword `KeywordBids` candidates retain exact `KeywordId`, channel and scenario; not-created keyword returns `UNAVAILABLE` without write.
- Search and Network never share one range.
- `historical_cpc`, `auction_proxy`, `actual_bid`, `bid_ceiling`, target/actual CPA, `target_result_cost` and `budget` never alias.
- Wordstat connector cannot emit a money candidate.
- Legacy Live 4 cannot be selected in P0.
- Competitor internals are `UNAVAILABLE` unless a legitimate direct source is attached; public ad observation is insufficient.
- Scope mismatch, stale, unknown currency/VAT or inadequate sample produces rejection, not averaging.
- Reports last three days are provisional and Query window is bounded by official availability.
- Direct Reports output does not claim `unsampled`; sample/completeness is disclosed.
- Missing CPC permits full reviewable Draft when budget and safe strategy are known.
- Missing budget blocks publish economics; missing target result cost blocks only strategies/claims that require it.
- Owner UI states source, semantic, scope, freshness, uncertainty and «не прогноз эффективности».

---

## Sources

### Kept: primary official Yandex sources

- [KeywordBids.get](https://yandex.com/dev/direct/doc/en/keywordbids/get) — exact fields, IDs, micros and null/strategy/placement limitations.
- [Keywords.add](https://yandex.com/dev/direct/doc/en/keywords/add) — existing-object boundary and manual/automatic bid behavior.
- [UnifiedCampaign get parameters](https://yandex.ru/dev/direct/doc/en/campaigns/get-unified-campaign) — strategy structures, CPA/CPC targets, budgets and bid ceilings.
- [Campaign strategies](https://yandex.com/dev/direct/doc/en/objects/campaign-strategies) — manual versus automatic control boundary.
- [Strategies.get](https://yandex.com/dev/direct/doc/en/strategies/get) — portfolio strategy settings and supported field families.
- [Reports service](https://yandex.com/dev/direct/doc/en/reports), [types](https://yandex.com/dev/direct/doc/en/type), [fields](https://yandex.com/dev/direct/doc/en/fields-list), [period](https://yandex.com/dev/direct/doc/en/period) — historical metric capability and aggregation.
- [Money output](https://yandex.com/dev/direct/doc/en/money) — currency, micros, rounding and VAT.
- [Reports restrictions](https://yandex.com/dev/direct/doc/en/restrictions), [freshness](https://yandex.com/dev/direct/doc/en/actual) — availability, lag and correction boundary.
- [Dictionaries.get](https://yandex.com/dev/direct/doc/en/dictionaries/get) — currencies and technical limits.
- [Statistics and analysis](https://yandex.com/dev/direct/doc/en/best-practice/statistics), [справочник v5](https://yandex.com/dev/direct/doc/en/concepts/about) — exact legacy Live 4 documentation boundary.
- [Wordstat API v1](https://yandex.com/support2/wordstat/en/content/api-structure) — proves documented demand methods/fields and absence of a CPC/bid/budget interface in that API.
- [Direct API overview](https://yandex.com/dev/direct/doc/en/concepts/overview) — owner-authorized account boundary.

### Kept: local primary implementation and tests

- `sites/p0-production/lib/analytics-evidence.ts` — current source precedence/evidence normalization for #262.
- `sites/p0-production/lib/campaign-strategy.ts` — current owner-facing prelaunch cost decision for #263.
- `sites/p0-production/lib/campaign-viability.ts` — current comparative score and eligibility behavior.
- `sites/p0-production/tests/analytics-evidence.test.mjs`, `campaign-strategy.test.mjs`, `campaign-viability.test.mjs`, `tests/fixtures/direct/keyword-bids.json` — current asserted contract.

### Dropped

- Vendor bid managers, SEO/PPC blogs, API wrappers and aggregators — secondary/unofficial; excluded from capability claims.
- Adobe/Appsflyer and other platform guides — third-party descriptions; excluded.
- Search snippets without an opened official page — discovery only, not evidence.
- Public competitor pages/ads — cannot prove internal bids, budgets, CPC, CPA or outcomes.

---

## Gaps и residual risks

1. Account-specific `KeywordBids.get`, campaign strategy availability and null cases were not tested against production credentials; this research proves documented capability, not availability in a specific account.
2. Официальная документация не публикует SLA freshness для `AuctionBids`/`Coverage`; P0 TTL remains a project decision requiring empirical validation.
3. Официальная Reports documentation reviewed here does not expose a sampling flag; absence of the flag cannot prove the report is unsampled.
4. VAT equivalence between Management bids/ceilings and Reports monetary fields is not explicitly established by the reviewed official pages. Cross-endpoint comparison must remain blocked or explicitly `VAT_NOT_SPECIFIED_BY_ENDPOINT` until a direct official source resolves it.
5. Live 4 links remain present in current v5 documentation, but operational support/access for a new P0 integration is not established. Conservative status remains `UNAVAILABLE`.
6. Licensed external sources are allowed by project policy only as `external_estimate`; no particular provider or license was assessed.
