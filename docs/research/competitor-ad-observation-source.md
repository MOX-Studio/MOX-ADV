# Рабочий источник наблюдений за рекламой конкурентов

**Ticket:** [«Определить рабочий источник наблюдений за рекламой конкурентов»](https://github.com/MOX-Studio/MOX-ADV/issues/313)
**Срез исследования:** 2026-08-31
**Назначение:** исследовательское решение для этапа «Сбор информации»; не реализация и не юридическое заключение.

## Решение

> **P0-источник: `UNAVAILABLE_NO_APPROVED_SOURCE`.**

На дату проверки не подтверждена официальная либо явно разрешённая публичная поверхность/API, которая воспроизводимо возвращает **фактически показанные объявления конкурентов** для заранее объявленной выборки `query × geography × device × date/time` и предоставляет требуемые поля объявления и показа.

Это не означает, что объявление невозможно увидеть вручную. Это означает, что найденные официальные поверхности нельзя принять как поддерживаемый автоматический P0-feed фактических конкурентных показов.

Разрешённые fallback:

1. `OWNER_PROVIDED_ARTIFACT` — вручную предоставленный владельцем исходный публичный артефакт с provenance и неизменяемым digest;
2. `LICENSED_PROVIDER` — только конкретный провайдер, успешно прошедший проверку terms, acquisition method, provenance, покрытия и права downstream use;
3. иначе — честный `UNAVAILABLE_NO_APPROVED_SOURCE`, а не нулевая видимость рекламы и не подмена публичным позиционированием сайта.

Yandex Search API остаётся допустимым источником обычной поисковой выдачи и контекста, но **не** источником `PUBLIC_AD_OBSERVATION`. Автоматический сбор `yandex.ru/search`, включая `/search/ads`, запрещён до отдельного предварительного согласия Яндекса с нужным scope.

## Матрица источников и capabilities

| Источник | Автоматический доступ | Фактический конкурентный показ | `query` | География | Устройство | Время показа | Рекламные поля и locator | P0-статус |
|---|---|---:|---:|---|---|---|---|---|
| Yandex Search API | Разрешён по договору и квотам | Не обещан контрактом; API-ответ может отличаться от ручной выдачи | Да | `region` лишь влияет на ранжирование документов | Нет типизированного selector; `user_agent` — только значение заголовка | `period` относится к давности документов, не к факту показа | Только `raw_data` XML/HTML; нет типизированных `ad`, advertiser, placement, landing или impression locator | Не использовать для `PUBLIC_AD_OBSERVATION` |
| Публичная страница Поиска Яндекса | Автоматические запросы вне Search API запрещены без предварительного согласия | Ручная страница может содержать промообъявления, но отражает один сессионный рендер | Видимый запрос | Зависит от сессии и сигналов | Зависит от сессии и сигналов | Время ручного наблюдения | Маркер/оформление видны только в конкретном рендере | Только `OWNER_PROVIDED_ARTIFACT` |
| `yandex.ru/search/ads` («Все объявления») | Отдельный разрешённый API/контракт автоматизации не подтверждён; путь находится под `/search` | Справка Директа не называет страницу журналом фактически состоявшихся показов | Не подтверждено как стабильный контракт | Не подтверждено | Не подтверждено | Нет исторического контракта | Нет документированной схемы/API | Не использовать как feed |
| Direct API v5 | OAuth от имени конкретного пользователя Директа | Только объекты и статистика доступного рекламодателя/агентства | Для собственных данных | Для собственных данных | Для собственных данных | Для собственных данных | Объекты авторизованного аккаунта | Не источник конкурентов |
| ОРД Яндекса / ЕРИР | Ролевой кабинет/API для подачи и просмотра относящихся к участнику сведений | Не публичная библиотека конкурентных объявлений | Нет публичного query-level feed | Нет публичного feed | Нет публичного feed | Нет публичного feed | `erid` полезен как locator уже полученного артефакта, но не как discovery feed | Не источник конкурентов |
| `OWNER_PROVIDED_ARTIFACT` | Ручное получение владельцем; автоматизация MOX-ADV не требуется | Подтверждает только один наблюдённый рендер | Должен быть зафиксирован | Owner-attested | Owner-attested | Да, если зафиксировано | Raw artifact + digest + видимый marker/`erid`/координаты | Допустимый single-sample fallback |
| `LICENSED_PROVIDER` | Только в пределах проверенного договора | Зависит от доказанного acquisition method | Обязательно | Обязательно с методом определения | Обязательно | Обязательно | Provider ID + raw pointer/digest | Условно допустим после due diligence |

## Primary evidence

### 1. Публичная выдача может содержать рекламу, но не является воспроизводимым feed

[Лицензия на использование поисковой системы Яндекса](https://yandex.ru/legal/termsofuse/ru/) в п. 2.5 говорит, что страница результатов поиска **может** содержать промообъявления со специальными отметками или оформлением, позволяющими отличить их от результатов поиска. Та же лицензия:

- в п. 5.2 перечисляет сигналы, влияющие на персонализацию, включая запрос, историю, клики, устройство, геолокацию и cookie;
- в п. 6.4 не гарантирует исчерпывающий ответ, абсолютную точность и актуальность;
- в п. 6.6 запрещает автоматические запросы к Поиску иначе как по правилам Yandex Search API.

[Справка Директа о местах показа](https://yandex.ru/support/direct/ru/general/positions) подтверждает, что реклама может появляться в разных секциях и форматах поисковой страницы, а макет выбирается алгоритмически для каждого запроса. [Справка о ставках](https://yandex.ru/support/direct/ru/troubleshooting/bidding) уточняет, что торги проводятся при каждом показе.

**Следствие для контракта:** ручной рендер — это одно наблюдение конкретной сессии. Он не доказывает постоянную кампанию, полное покрытие аукциона, targeting, ставку, бюджет, конверсии или эффективность.

### 2. Search API разрешён для автоматических запросов, но не обещает рекламный блок

Применимая на дату проверки [редакция условий Yandex Search API от 09.08.2026](https://yandex.ru/legal/cloud_terms_search_api/ru/09082026/) разрешает использовать результаты в продукте клиента при сохранении порядка (п. 3.2), предупреждает, что API-результат может отличаться от ручного запроса (п. 3.4), и запрещает иные автоматические запросы без предварительного согласия Яндекса (п. 3.5). Опубликованная следующая редакция с датой вступления 07.09.2026 сохраняет эти ограничения.

Официальная protobuf-схема Yandex Cloud:

- [`search_query.proto`](https://github.com/yandex-cloud/cloudapi/blob/master/yandex/cloud/searchapi/v2/search_query.proto) задаёт текст запроса, поисковый домен, семейный фильтр, страницу и исправление опечаток;
- [`search_service.proto`](https://github.com/yandex-cloud/cloudapi/blob/master/yandex/cloud/searchapi/v2/search_service.proto) добавляет сортировку, группировку документов, `region`, язык, XML/HTML, `user_agent`, metadata и период;
- `WebSearchResponse` содержит ровно одно прикладное поле: `bytes raw_data` с результатами в XML или HTML.

В официальном wire contract нет типизированных `ad`, `ad_marker`, `advertiser`, `headline`, `ad_text`, `displayed_url`, `landing_url`, `placement`, `erid`, `impression_id` или `impression_time`. `region` описан только как ID, влияющий на правила ранжирования **документов**; `user_agent` — как значение HTTP-заголовка. Поэтому они не подтверждают фактическую геолокацию или устройство показа рекламы.

Даже если реклама когда-либо появится внутри конкретного `FORMAT_HTML`, её DOM-parsing останется недокументированным extraction contract и не превратит ответ в официальный ad feed.

Текущие [квоты Search API](https://github.com/yandex-cloud/docs/blob/master/en/_includes/search-api-limits.md) ограничивают, в частности, синхронный поиск 10 запросами в секунду и 10 000 в час. Квоты разрешённого канала не устраняют semantic gap рекламного наблюдения.

### 3. Автоматизировать публичную SERP нельзя без отдельного согласия

Договорные п. 6.6 Лицензии Поиска и п. 3.5 условий Search API — достаточная граница. Дополнительно текущий [`robots.txt`](https://yandex.ru/robots.txt) для `User-agent: *` закрывает `/search` и `/xmlsearch`.

`robots.txt` сам по себе не заменяет договор, но согласуется с явным запретом. Headless browser, ротация IP, CAPTCHA-solving, скрытые endpoint-ы и имитация пользователя не являются допустимым P0-каналом.

Страница [«Все объявления»](https://yandex.ru/search/ads) упомянута в справке Директа как место, где могут показываться объявления со ставкой ниже минимальной цены поиска. Однако официальный документ не называет её историей фактических показов, не задаёт схему query/geo/device/time и не разрешает автоматический сбор. Поэтому она не проходит P0-критерии.

### 4. Direct API ограничен авторизованным пользователем

[Официальная справка Direct API](https://yandex.ru/support/direct/ru/alternative-interfaces/api) говорит, что запросы выполняются приложением от имени пользователя Директа — рекламодателя или агентства — и OAuth-токен разрешает доступ к данным конкретного пользователя.

**Следствие:** API годится для собственных Campaign Facts и статистики, но не даёт права или метода читать кампании и фактические показы конкурентов.

### 5. ОРД/ЕРИР — ролевой учёт, а не публичная ad library

[Страница Яндекса о маркировке](https://yandex.ru/adv/ad-labeling) описывает кабинет ОРД как интерфейс регистрации креативов, передачи статистики и просмотра объектов, **поданных через кабинет**. Она также указывает, что каждый участник рекламной цепочки получает доступ к относящейся непосредственно к нему информации.

[Справка ОРД о креативах](https://yandex.ru/support2/ord/ru/cards/creative) формулирует поверхность как карточки «зарегистрированных вами креативов». [Условия Яндекс ОРД](https://yandex.ru/legal/ord_terms/ru/) регулируют подачу собственных или уполномоченно подаваемых данных в ЕРИР.

`erid` можно сохранить как сильный locator, если он виден в уже полученном разрешённом артефакте, но официальный публичный discovery/search API по конкурентным креативам и query-level показам не подтверждён.

## Observation protocol

### 1. Предобъявленная выборка

До получения любого артефакта фиксируются:

- конечный `candidate_set` конкурентов и правило включения;
- точные запросы без последующего cherry-picking;
- region ID/город и метод определения географии;
- устройство, ОС, браузер, точный `user_agent` и viewport, если источник это сообщает;
- локальное окно наблюдения с IANA timezone;
- запланированные слоты/попытки;
- допустимый `source_class` и версия source-policy.

Один артефакт занимает ровно один слот. Повторный сбор не перезаписывает прошлое наблюдение.

### 2. Freshness и повторный сбор

У источника нет подтверждённого универсального SLA свежести, поэтому P0 не выдумывает TTL. Каждый запрос наблюдения объявляет `analysis_window: [from, to)` и расписание слотов. Наблюдение:

- `CURRENT_FOR_DECLARED_WINDOW`, если `observed_at` попадает в окно;
- `STALE`, если оно старше окна;
- `UNKNOWN_TIME`, если время нельзя подтвердить.

Технический retry повторяет тот же заранее объявленный слот в пределах `tolerance_seconds`; он не продолжается до появления рекламы. Для мониторинга используется одинаковая матрица `query × geo × device × slot`. Все попытки, включая ошибки и отсутствие рекламного блока, входят в coverage.

Отсутствие рекламы в успешно полученном артефакте — `NOT_OBSERVED_IN_SAMPLE`, а не «конкурент не рекламируется». CAPTCHA, 403, пустой ответ или parse failure — техническая недоступность, а не нулевое наблюдение.

### 3. Минимальный Evidence Record

```yaml
observation_id: urn:mox:public-ad-observation:<uuid>
request_id: urn:mox:observation-request:<uuid>
source_class: OWNER_PROVIDED_ARTIFACT | LICENSED_PROVIDER
source_name: string
terms_snapshot: {url: string, checked_at: RFC3339, digest: sha256}
provenance:
  obtained_by: owner | provider
  obtained_at: RFC3339
  observed_at: RFC3339 | null
  confidence: owner_attested | provider_attested
sample:
  candidate_set_rule: string
  competitor_id: string
  query: string
  geography: {value: string, region_id: string | null, method: string}
  device: {class: desktop | mobile | tablet | unknown, user_agent: string | null, viewport: string | null}
  slot: {from: RFC3339, to: RFC3339, timezone: IANA}
raw:
  media_type: string
  immutable_pointer: string
  sha256: sha256
  byte_length: integer
extraction:
  method: manual_span | ocr | provider_schema
  version: string
  ad_marker: string | null
  headline: string | null
  text: string | null
  displayed_url: string | null
  landing_url: string | null
  advertiser: string | null
  placement: string | null
  erid: string | null
  locator: string | null
coverage:
  status: OBSERVED | NOT_OBSERVED_IN_SAMPLE | PARTIAL | UNAVAILABLE
  completed_attempts: integer
  planned_attempts: integer
  missing_slots: [string]
quality_flags: [string]
```

Digest вычисляется по исходным байтам до OCR, нормализации и redaction. Для redacted copy хранится отдельный digest и ссылка на parent digest. Секреты, cookie и персональные данные не входят в рабочий Evidence Record.

### 4. Locator drift

Приоритет locator:

1. видимый `erid`, если он присутствует;
2. стабильный ID лицензированного провайдера;
3. raw digest + timestamp + координаты/текстовый span;
4. CSS/XPath — только диагностическая подсказка.

`displayed_url`, click-tracking URL и `landing_url` хранятся раздельно. Исчезновение locator или изменение DOM создаёт `LOCATOR_DRIFT`; extractor не угадывает соответствие и не переписывает прежний артефакт.

### 5. Prompt injection

Рекламный текст, HTML, OCR, landing и provider payload всегда `UNTRUSTED_DATA`. Extractor:

- не исполняет найденные инструкции, JavaScript, macro или tool calls;
- не раскрывает prompts, токены, cookie, пути и другие секреты;
- отделяет raw payload от инструкций модели структурным envelope;
- валидирует результат по закрытой схеме и сохраняет span/координаты извлечения;
- помечает `PROMPT_INJECTION_DETECTED`, сохраняя неизменяемый исходник.

## Failure states

Закрытый минимальный enum:

- `UNAVAILABLE_NO_APPROVED_SOURCE`;
- `TERMS_NOT_VERIFIED`;
- `PROVENANCE_MISSING`;
- `AUTHORIZATION_MISSING`;
- `RATE_LIMITED`;
- `SOURCE_BLOCKED_OR_CAPTCHA`;
- `PROVIDER_OUTAGE`;
- `NOT_OBSERVED_IN_SAMPLE`;
- `PARTIAL_COVERAGE`;
- `STALE`;
- `UNKNOWN_TIME`;
- `RAW_ARTIFACT_MISSING`;
- `DIGEST_MISMATCH`;
- `PARSE_FAILED`;
- `LOCATOR_DRIFT`;
- `PROMPT_INJECTION_DETECTED`;
- `SCHEMA_MISMATCH`.

Ни одно из этих состояний не превращается в нулевую видимость рекламы.

## Семантическая граница

### `PUBLIC_AD_OBSERVATION`

Допустимо только при наличии разрешённого raw artifact, явного рекламного marker/оформления, provenance, digest, `observed_at`, точного sample scope и восстановимого locator/span. Claim ограничен формой:

> «В артефакте A для sample S в момент T наблюдалось объявление с текстом H».

### `HYPOTHESIS_FROM_PUBLIC_POSITIONING`

Используется, когда доступны только публичные страницы конкурента и его собственное позиционирование. Нельзя называть это рекламным показом, рекламной кампанией или доказательством распространённости рекламного приёма.

### `UNKNOWN_INTERNAL_CAMPAIGN`

Всегда остаются неизвестными без прямого легитимного источника:

- структура кампании и targeting;
- ключевые фразы/минус-фразы;
- ставки, бюджет и стратегия назначения ставок;
- показы за пределами точного sample;
- клики, конверсии, CPA, ROI и эффективность;
- постоянство или длительность кампании.

## Влияние на общий пайплайн

Для следующего решения [«Определить место анализа рекламы конкурентов и ставок в пайплайне Campaign Draft»](https://github.com/MOX-Studio/MOX-ADV/issues/314):

- подэтап competitive-ad collection по умолчанию возвращает `UNAVAILABLE_NO_APPROVED_SOURCE`;
- это не блокирует Strategy или полный Campaign Draft, если публичное рекламное наблюдение не является объективно обязательным бизнес-входом;
- генератор использует `PUBLIC_AD_OBSERVATION` только при owner artifact или прошедшем due diligence provider;
- публичное позиционирование остаётся `HYPOTHESIS_FROM_PUBLIC_POSITIONING`;
- отсутствие источника не создаёт control, prevalence claim или факт «рекламы нет»;
- появление нового источника инвалидирует только зависимые competitive claims/Hypotheses/Drafts по версионированной lineage и запускает пересборку, а не молчаливое дополнение.

Получение отдельного письменного согласия Яндекса или due diligence конкретного лицензированного провайдера — возможная будущая работа. Для destination карты #297 она не является prerequisite: P0-контракт может быть передан дальше с честным `UNAVAILABLE` и разрешёнными fallback.

## Источники

### Kept

- [Лицензия на использование поисковой системы Яндекса](https://yandex.ru/legal/termsofuse/ru/) — наличие промо на SERP, персонализация, отсутствие гарантий, запрет автоматических запросов вне Search API.
- [Условия Yandex Search API, действующие с 09.08.2026](https://yandex.ru/legal/cloud_terms_search_api/ru/09082026/) — разрешённый автоматический канал, различие API/ручной выдачи, запрет иных автоматических способов.
- [Yandex Cloud `search_service.proto`](https://github.com/yandex-cloud/cloudapi/blob/master/yandex/cloud/searchapi/v2/search_service.proto) и [`search_query.proto`](https://github.com/yandex-cloud/cloudapi/blob/master/yandex/cloud/searchapi/v2/search_query.proto) — официальный wire contract.
- [Квоты Search API](https://github.com/yandex-cloud/docs/blob/master/en/_includes/search-api-limits.md) — текущие квоты и лимиты.
- [Места показа рекламы на Поиске Яндекса](https://yandex.ru/support/direct/ru/general/positions) и [объём трафика и ставки](https://yandex.ru/support/direct/ru/troubleshooting/bidding) — вариативность макета и аукцион при каждом показе.
- [API Яндекс Директа](https://yandex.ru/support/direct/ru/alternative-interfaces/api) — OAuth и доступ от имени конкретного пользователя.
- [Маркировка рекламы](https://yandex.ru/adv/ad-labeling), [креативы ОРД](https://yandex.ru/support2/ord/ru/cards/creative) и [условия ОРД](https://yandex.ru/legal/ord_terms/ru/) — ролевой учёт, не публичный конкурентный feed.
- [`robots.txt` Яндекса](https://yandex.ru/robots.txt) — `/search` и `/xmlsearch` закрыты для crawler; дополнительная, не самостоятельная policy-проверка.
- `docs/research/analytics-evidence-contract.md`, закрытые #264/#265 и `CONTEXT.md` — существующие границы evidence, sampling и терминология MOX-ADV.

### Dropped

- поисковые snippets — только навигация к первичным URL;
- SEO-обзоры и сервисы конкурентной разведки — не доказывают разрешённость acquisition method;
- сторонние парсеры Yandex XML/HTML — не контракт Яндекса;
- CAPTCHA и наблюдаемое поведение скрытых endpoint-ов — не evidence о поддерживаемой capability;
- неизвестный «licensed provider» без конкретного договора и provenance — не источник, а только допустимый класс fallback.

## Gaps и остаточные риски

1. Не получено отдельное письменное согласие Яндекса на автоматизированное ad observation с требуемым scope.
2. Может существовать непубличный партнёрский продукт; без официального договора и спецификации он не P0-source.
3. Ни один конкретный лицензированный провайдер не прошёл due diligence.
4. Search API HTML/XML, квоты, тарифы и правовые документы могут измениться; source-policy требует датированного snapshot и повторной проверки.
5. Отрицательный verdict ограничен опубликованными официальными материалами на дату среза и не является утверждением об абсолютном несуществовании источника.
