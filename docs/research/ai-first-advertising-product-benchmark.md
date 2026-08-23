# AI-first advertising products: что перенять в P0 MOX-ADV

**Дата среза:** 23.08.2026

**Целевой модуль:** PRD [#149 «P0 · Подготовить стратегию и жизнеспособные рекламные кампании»](https://github.com/ElJeskos/MOX-ADV/issues/149)

**Режим:** product benchmark по первичным официальным источникам. Рекламные кабинеты не открывались, аккаунты и credentials не подключались, внешние записи и production API-вызовы не выполнялись.

## Короткий вывод

Ни один рассмотренный продукт не стоит копировать целиком. Лучший целевой P0 складывается из пяти разных паттернов:

1. **Google Ads conversational experience:** URL → редактируемое описание бизнеса → тематические группы, ключевые слова и готовые assets → review до публикации.
2. **Madgicx AI Marketer:** одна рекомендация как понятная история — почему, на каких данных, что именно изменится, что можно исправить перед launch.
3. **Microsoft Advertising Copilot API:** генерация рекомендации отделена от операции применения; Brand Kit и refinement существуют как отдельные типизированные объекты и calls.
4. **TikTok Smart+:** автоматизация включается по модулям, а не одной непрозрачной кнопкой «отдать всё AI».
5. **Yandex Direct combinatorial ads:** конечное семейство совместимых элементов вместо множества отдельных косметических объявлений, с предпросмотром и будущей статистикой по элементам.

Главное преимущество MOX-ADV уже сейчас — не генерация текста, а **trust boundary**: доказательства, exact authority, отсутствие ложного прогноза, официальный API-only contour и безопасный `create → suspend → semantic readback`. Это нужно сохранить. Рыночные продукты сильнее P0 в onboarding, creative workflow, brand controls и объяснении рекомендаций; слабее — в воспроизводимости, доказательствах и безопасной внешней записи.

### Рекомендуемое направление

Добавить в P0:

- URL-first agent brief с редактируемым описанием бизнеса;
- owner-visible **Brand & Claims Contract**;
- recommendation story `почему → evidence → точное изменение → последствия`;
- семейства creative assets с provenance и проверкой совместимости всех комбинаций;
- модульную карту автоматизации и точного контроля;
- honest fallback для нового рекламодателя без истории;
- learning-readiness до разбиения бюджета;
- preview полного Direct profile v1 до package authority.

Не переносить:

- proprietary «прогноз эффективности до запуска»;
- автоматическую смену цели, URL или бюджета без нового полномочия;
- default-on generated assets, которые нельзя полностью просмотреть;
- global `AI on/off` как замену typed authority;
- сотни вариаций или omnichannel launch в P0;
- выводы об эффективности конкурентов из публичных объявлений.

## 1. Как проводилось сравнение

В обзор включены две группы продуктов:

- **platform-native:** Yandex Direct, Google Ads, Meta Advantage+, TikTok Smart+, Microsoft Advertising Copilot/Performance Max, Amazon DSP Performance+;
- **independent AI-first products:** Madgicx AI Marketer, AdCreative.ai, Omneky.

Сравнивались не рекламные обещания, а продуктовые контракты:

1. Как начинается работа: URL, brief, account history или ручная анкета.
2. Что AI делает самостоятельно.
3. Как человек направляет и исправляет AI.
4. Как показываются evidence, recommendation и точное изменение.
5. Как устроены creative variants и brand controls.
6. Что происходит до и после внешней записи.
7. Какие действия включены по умолчанию.
8. Можно ли отделить recommendation от apply.
9. Как учитываются measurement, learning volume и uncertainty.
10. Какие паттерны совместимы с границей P0.

Все количественные uplift/accuracy claims ниже считаются **self-reported vendor evidence**, а не независимым доказательством качества продукта.

## 2. Сравнение продуктов

| Продукт | Сильный AI-first паттерн | Риск / ограничение | Решение для P0 |
|---|---|---|---|
| Yandex Campaign Master / Neuro Ads / combinatorial ads | URL или описание бизнеса → assets, audience и settings; native Direct projection; много элементов в одном combinatorial ad | Автоприменение рекомендаций может менять creative, targeting, Metrika goal и budget; часть Neuro Ads нельзя полностью preview до показов | **ADOPT native projection; ADAPT generation; REJECT implicit mutation** |
| Google conversational experience + AI Max / Performance Max | URL → editable business summary → themed ad groups and assets; granular brand/URL/location controls; source-aware reporting | Некоторые AI Max функции default-on; Final URL expansion может изменить destination и отключить pinned assets | **ADOPT journey and controls; keep exact P0 URL** |
| Meta Advantage+ | Один упрощённый campaign flow; full or partial automation; широкий delivery optimization | Default-on enhancements могут изменять text/media; сильная зависимость от platform black box | **ADAPT simplified setup; reject implicit owner-meaning changes** |
| TikTok Smart+ + Symphony | Full/partial/manual continuum; module-level toggles; URL-to-creative; creative-level reporting | Auto-add и mid-flight creative refresh уже относятся к serving optimization | **ADOPT modularity and provenance; defer auto-refresh to P1** |
| Microsoft Copilot + Performance Max | Recommendation API отделён от Add/Update APIs; URL + prompt + tone; Brand Kit; diagnostics and root-cause analysis | PMax требует conversion signals и learning period; cross-network automation слишком широка для P0 | **ADOPT typed recommend/refine/apply seam** |
| Amazon Performance+ / Creative Studio | Outcome-first setup, first-party signals, KPI controls, transparent campaign reporting | Продукт рассчитан на serving and optimization; performance claims vendor-authored | **ADAPT measurement/learning readiness; defer delivery optimization** |
| Madgicx AI Marketer | Daily audit → why → supporting data → editable exact recommendation → pre-launch review → launch | Meta-focused; post-launch optimizer; часть «learning» закрыта vendor logic | **ADOPT recommendation-story UX, not platform logic** |
| AdCreative.ai | Brand profile, rapid creative generation, heatmap and improvement suggestions | Proprietary pre-launch performance/awareness scores and competitor-performance framing conflict with PRD honesty | **REFERENCE creative critique; REJECT score as viability evidence** |
| Omneky | One brief → many on-brand image/video/UGC variants → launch → multimodal performance tags | Hundreds of variants and omnichannel writes violate thin P0 and learning-volume discipline | **ADAPT asset-family idea; reject scale and write breadth** |

## 3. Product-by-product findings

### 3.1. Yandex Direct: ближайший provider-native аналог

[Мастер кампаний](https://yandex.ru/support/direct/ru/campaign-master/about) начинает с URL или короткого описания бизнеса и автоматически предлагает объявления, аудиторию, время и места показа. Для продвижения сайта он подбирает до пяти вариантов заголовков и изображений и до трёх текстов; владелец может редактировать элементы и должен проверить, что они взаимно сочетаются ([официальная инструкция](https://yandex.ru/support/direct/ru/campaign-master/site)).

[Комбинаторное объявление](https://yandex.ru/support/direct/ru/unified-performance-campaign/create-comb-ad) собирает множество баннеров из ограниченного набора элементов: до семи заголовков, трёх текстов, пяти изображений и шести видео. Яндекс прямо требует, чтобы элементы сохраняли смысл в любых комбинациях, и предоставляет статистику по заголовкам, текстам, изображениям и видео.

[Нейрообъявления](https://yandex.ru/support/direct/ru/unified-performance-campaign/create-neuro-ad) генерируются из страницы, раздела, сайта или списка URL. Для одной страницы доступны все варианты; для большого source set — только примеры. Есть фразы-исключения, UTM и provider moderation, но часть результата может стать известна только после генерации или показов.

[Автоприменение рекомендаций](https://yandex.ru/support/direct/ru/campaigns/auto-recommendations) показывает главный анти-паттерн для MOX-ADV: базовая опция включается в новых кампаниях по умолчанию и после накопления статистики может менять creative elements, время, тематические слова и счётчик; расширенная — цели, targeting и weekly budget. Отключение опции не откатывает уже внесённые изменения.

**Что перенять:**

- URL-first начало;
- bounded asset slots и semantic compatibility matrix;
- preview по доступным placement/aspect ratios;
- source URL / excluded phrase / UTM как часть asset contract;
- downstream element-level reporting seam для P1.

**Что не переносить:**

- неполный preview выбранного пакета;
- автоматическую замену goal, budget, tracking или business claim;
- default-on external mutation;
- обещание, что pre-launch generation уже доказала эффективность.

### 3.2. Google Ads: лучший onboarding и steering contract

[Conversational experience](https://support.google.com/google-ads/answer/14145186?hl=en) использует последовательность:

1. владелец вводит landing page URL;
2. AI создаёт краткое описание бизнеса;
3. описание можно исправить;
4. AI предлагает тематические ad groups, keywords, headlines, descriptions, sitelinks и images;
5. человек направляет генерацию и принимает или исправляет результат до запуска.

Это самый близкий рыночный аналог agent-prefilled owner journey в PRD #149. Важный элемент — AI сначала показывает **своё понимание бизнеса**, а не сразу генерирует кампанию.

[AI Max](https://support.google.com/google-ads/answer/15910187?hl=en) добавляет не одну кнопку automation, а набор контролей: search-term matching, text customization, Final URL expansion, locations of interest, brand inclusions/exclusions, URL inclusions/exclusions. Reporting показывает source matching, headline и URL customer journey, selected landing page и generated asset performance.

[Performance Max asset groups](https://support.google.com/google-ads/answer/14528220?hl=en) формируют конечный набор assets вокруг одной темы или audience. Ad Strength оценивает полноту и разнообразие asset slots, но не должен копироваться как performance forecast.

**Что перенять:**

- editable AI understanding до deeper research;
- thematic group proposal, а не flat keyword dump;
- term/claim exclusions и brand guidelines;
- явные source labels: owner-provided, site-derived, AI-generated, provider-optimized;
- preview и возможность удалить generated asset;
- отдельные URL inclusion/exclusion controls как reference для destination policy.

**Что изменить для MOX-ADV:**

- P0 фиксирует exact destination; Final URL expansion не включается;
- generated copy не становится approved claim без evidence;
- каждый material AI control входит в profile v1 или получает `NOT_IMPLEMENTED`;
- Ad Strength превращается в **Creative Completeness**, не в показатель эффективности.

### 3.3. Meta Advantage+: лучший пример упрощения, но не прозрачности

Meta делит Advantage+ на [end-to-end и single-step automation](https://www.facebook.com/business/news/meta-advantage-explained-in-two-minutes). End-to-end setup автоматизирует audience, placements и campaign budget; single-step позволяет автоматизировать только часть процесса. В новом streamlined setup AI optimization становится частью обычного campaign flow, а не отдельным «ручным» продуктом ([официальное описание](https://www.facebook.com/business/news/supercharge-performance-advantage-opportunity-score)).

[Advantage+ Creative](https://www.facebook.com/business/help/297506218282224) может менять текст, изображения и видео для разных пользователей и placements. Enhancements могут быть включены по умолчанию; Meta рекомендует проверять preview и позволяет отключать их ([официальная инструкция отключения](https://www.facebook.com/business/help/1082295769403815)).

**Что перенять:**

- не заставлять владельца выбирать «manual или AI» в начале;
- ordinary flow всегда agent-first, но внутри явно видны управляемые capability modules;
- account-level constraints для возраста, географии и placements как hard policy, а не advice;
- единый business objective вместо ручного выбора transport settings.

**Что не переносить:**

- default-on изменения business copy;
- label `AI on` без раскрытия включённых действий;
- широкий audience expansion без explicit exclusions и measurement readiness;
- opportunity score как доказательство будущего результата.

### 3.4. TikTok Smart+: лучший control surface для modular automation

[Smart+](https://ads.tiktok.com/business/en-US/blog/smart-plus-ai-performance-solution) предлагает один buying flow с full, partial или manual automation. Targeting, budget и creative можно настраивать по модулям. Campaign structure поддерживает отдельные asset groups, а reporting различает Creative, Text и Enhancement.

[Symphony Automation](https://ads.tiktok.com/business/en-US/blog/symphony-automation) использует destination URL и historical library для Recommended Creatives, создаёт platform-ready video, улучшает размер, качество, music, translation и dubbing. Auto-add может обновлять assets во время serving. TikTok также заявляет built-in creative controls; AI-generated content маркируется и проходит safety review ([официальный newsroom](https://newsroom.tiktok.com/en-us/tiktok-symphony-updates)).

**Что перенять:**

- capability-level `AUTOMATIC / OWNER-GUIDED / DISABLED`;
- generated asset provenance и AI label;
- aspect-ratio/device suitability в creative readiness;
- будущую reporting dimension `creative × text × enhancement`;
- recommended gallery из own history + generated candidates.

**Что отложить до P1:**

- auto-add;
- creative fatigue refresh;
- mid-flight changes;
- performance-based «winner» selection.

### 3.5. Microsoft Advertising: лучший API seam

[Microsoft Advertising Generative AI API](https://learn.microsoft.com/en-us/advertising/guides/generative-ai?view=bingads-13) явно разделяет генерацию и запись:

- `CreateAssetGroupRecommendation` принимает final URLs, prompt и optional tone;
- возвращает proposed `AssetGroup` и image suggestions;
- refinement выполняется отдельными operations;
- фактическая запись происходит позже через `AddMedia`, `AddAssetGroups` или `UpdateAssetGroups`.

Есть типизированный [Brand Kit](https://learn.microsoft.com/en-us/advertising/guides/generative-ai?view=bingads-13) с brand voice, palette, fonts и images. [Copilot](https://about.ads.microsoft.com/en/tools/productivity/copilot-in-microsoft-advertising) объединяет conversational guidance, recommendations, generation, diagnostics, performance comparison и root-cause analysis.

[Performance Max](https://learn.microsoft.com/en-us/advertising/guides/performance-max?view=bingads-13) требует conversion setup, цели, budget, asset group и learning inputs. Официальные [best practices](https://learn.microsoft.com/en-us/advertising/msa-help/hlp_ba_proc_pmaxbestpractices) предупреждают не делать выводы из low-volume rows и short timeframes и описывают learning period в зависимости от conversion volume/cycle.

**Что перенять:**

- `recommend → refine → validate → apply` как разные contracts;
- Brand Kit как immutable input to creative generation;
- root-cause summary как будущий P1 output;
- learning-readiness, зависящую от business cycle, а не универсального числа дней;
- source URL + prompt + tone + output version как lineage.

### 3.6. Amazon Performance+: outcome и signal readiness

[Amazon DSP Performance+](https://advertising.amazon.com/library/guides/dsp-performance-plus) упрощает setup вокруг conversion goal, KPI, targeting tactics и first-party signals, сохраняя campaign-level reporting по inventory, creative, audience и geography. Amazon отдельно отмечает, что система не измеряет incrementality сама и требует дополнительных measurement solutions.

[Creative Studio](https://advertising.amazon.com/generative-ai-ad-solutions) использует conversational partner для product/audience research, concept/storyboard и multi-format asset generation.

**Что перенять:**

- один primary outcome для optimization и отдельные supporting funnel events;
- явный distinction между attribution/reporting и causal incrementality;
- signal readiness до выбора automated strategy;
- storyboard/concept preview до генерации финального asset.

**Что не переносить в P0:**

- real-time bidding and audience prediction;
- cross-inventory delivery;
- vendor performance claims как playbook rules.

### 3.7. Madgicx AI Marketer: лучший формат recommendation card

[AI Marketer](https://academy.madgicx.com/lessons/how-to-use-ai-marketer) ежедневно проверяет connected account и оформляет каждую рекомендацию в три части:

1. объяснение, почему действие предлагается;
2. supporting data и точный объект, который будет запущен, с возможностью редактирования;
3. settings и summary для pre-launch review.

После выполнения recommendation можно оценить; completed recommendations остаются отдельной историей.

Это почти готовый UX-паттерн для Human Decision Gate, но в MOX-ADV его нужно сузить: routine safe work не превращается в карточки одобрения, а rating не становится evidence о рекламной эффективности.

**Что перенять:**

- `Почему сейчас`;
- `На каких фактах`;
- `Что именно изменится`;
- `Что можно исправить`;
- `Что произойдёт после решения`;
- immutable completed/initial/corrected history.

**Что не переносить:**

- daily recommendation inbox в P0;
- one-click optimization вне exact authority;
- learning from thumbs/stars как автоматическую promotion policy.

### 3.8. AdCreative.ai: полезная creative critique, опасный score

[Creative Scoring AI](https://help.adcreative.ai/en/articles/8885776-what-is-creative-scoring-ai-and-how-to-use-it) показывает Performance Score, Awareness Score, heatmap и suggested improvements. Vendor утверждает, что score прогнозирует CTR и awareness на основе proprietary dataset.

[Ad Text API](https://api-docs.adcreative.ai/docs/features/ad-text-generation-api) полезен как reference для explicit generation inputs: product, description, audience, tone, language, CTA, custom restrictions and strategy.

**Что перенять:**

- visual attention heatmap как advisory hypothesis;
- objective-specific creative critique;
- редактируемые labels, если AI неправильно распознал logo/title/product;
- explicit copy constraints and prohibited phrases.

**Что не переносить:**

- proprietary pre-launch performance probability;
- score как замена live experiment;
- competitor-performance conclusions;
- формулировку «89–90% accuracy» без независимой calibration artifact.

### 3.9. Omneky: asset factory, а не P0 strategist

[Omneky](https://www.omneky.com/) позиционирует один brief как источник сотен on-brand image, video и UGC variations, последующий omnichannel launch и multimodal performance tagging.

**Что перенять:**

- один approved brief как root of all assets;
- reusable brand template;
- variant families вместо несвязанных prompts;
- future multimodal tags для анализа asset patterns.

**Что не переносить:**

- сотни variants на старте;
- omnichannel package;
- automatic launch across Meta/Google/TikTok/LinkedIn/Reddit;
- assumption, что creative scale компенсирует слабую economics/measurement readiness.

## 4. Что уже лучше сделано в MOX-ADV

По сравнению с рассмотренными продуктами текущий PRD сильнее в следующих местах:

1. **Pre-launch score не назван прогнозом.** AdCreative.ai и platform opportunity/ad-strength scores легко создают ложное ощущение предсказания результата. В P0 score только ранжирует comparable eligible Drafts.
2. **Evidence lineage.** Рыночные продукты редко показывают source, observation time, scope, freshness и uncertainty для material claim.
3. **Honest competitor boundary.** Публичные объявления не превращаются в знание competitor CPA, spend или profitability.
4. **Exact package authority.** Recommendation и внешняя запись связаны с конкретными revisions, а material edit инвалидирует полномочие.
5. **Non-serving acceptance.** `create → suspend → semantic readback` сильнее обычного «review then publish».
6. **Ambiguous write handling.** Нет blind retry и ложного success.
7. **Agent-owned safe work.** Владелец не получает recommendation inbox из routine retries, polling и evidence collection.

Эти отличия — не лишняя enterprise machinery, а ключевой product moat для владельца, который не умеет проверять рекламный кабинет.

## 5. Где P0 отстаёт от рынка

### 5.1. Нет отдельного editable AI understanding

Google и Yandex сначала формируют краткое понимание бизнеса из URL. В текущем P0 Model есть много evidence, но нет одного короткого owner-visible ответа:

> «Я понял ваш бизнес так; вот что буду рекламировать; вот что сознательно не включил».

### 5.2. Нет Brand & Claims Contract

Google имеет text guidelines и brand controls, Microsoft — Brand Kit, TikTok — creative control settings. P0 пока не фиксирует единый versioned contract:

- brand name and voice;
- обязательные и запрещённые формулировки;
- доказуемые factual claims;
- logo/colors/assets and ownership;
- regulated-category disclaimers;
- prohibited visual transformations;
- source and expiry of each constraint.

### 5.3. Creative workflow слишком похож на поля payload

Рыночные продукты показывают creative families, aspect ratios, asset breadth, generated gallery and combination preview. P0 должен оставаться exact, но owner interface должен работать не с «ResponsiveAd fields», а с понятными families:

- доверие/доказательство;
- основной business outcome;
- product differentiator;
- CTA;
- image/video theme;
- restrictions and message match.

### 5.4. Recommendation недостаточно похожа на decision story

У Madgicx сильнее narrative unit: why, data, exact change, editable settings, pre-launch summary. P0 Human Decision Gate содержит эти поля концептуально, но они должны стать единым визуальным и typed contract во всех material gates.

### 5.5. Нет owner-visible automation map

TikTok показывает module-level automation. P0 нужен собственный вариант без global switch:

| Capability | Режим P0 |
|---|---|
| Safe research reads | `AGENT_OWNED` |
| Business model drafting | `AGENT_OWNED + OWNER_CORRECTABLE` |
| Creative generation | `AGENT_OWNED + OWNER_EDITABLE` |
| Destination choice | `EXACT / NO EXPANSION` |
| Strategy approval | `HUMAN DECISION GATE` |
| Package creation | `EXACT ONE-TIME AUTHORITY` |
| Resume / serving / spend | `UNAVAILABLE IN P0` |

### 5.6. Не выделен new-advertiser cold start

Platform-native systems способны начать от URL и minimal signals. P0 должен честно разделить:

- **existing advertiser:** own history помогает demand, cost и overlap;
- **new advertiser:** history unavailable, поэтому fallback strategy, wider sensitivity, smaller shortlist и `TESTABLE_WITH_GAPS` до достаточной economics/measurement evidence.

## 6. Рекомендуемые изменения в PRD #149

Ниже — product recommendations; GitHub issue в рамках этого исследования не изменялся.

### 6.1. Новые или уточнённые user stories

1. **Editable AI understanding:** после URL/access onboarding владелец видит короткое описание того, как агент понял business, offer, audience, qualified outcome и exclusions, и исправляет material misunderstanding одним действием.
2. **Brand & Claims:** владелец видит подготовленные brand/claim restrictions; каждый generated asset проходит их до попадания в Draft.
3. **Generated asset provenance:** у каждого текста, изображения и видео видно происхождение: owner-provided, site-derived, account-history, stock, AI-generated or provider-generated.
4. **Creative compatibility:** владелец может preview все materially distinct combinations, а система доказывает, что каждый title/text/asset семантически совместим с остальными и landing.
5. **Recommendation story:** каждый Human Decision Gate содержит why now, supporting evidence, exact proposed delta, alternatives, consequences and recommendation.
6. **Modular automation map:** интерфейс показывает, что агент делает автоматически, что можно исправить и что недоступно без нового authority.
7. **Cold-start honesty:** новый рекламодатель не обязан иметь Direct history; unavailable history расширяет uncertainty и включает explicit fallback, но не превращается в zero.
8. **No implicit destination expansion:** P0 создаёт кампанию только на exact reviewed URL; provider URL expansion запрещён в profile v1.
9. **No implicit owner-meaning mutation:** generated/optimized asset не может менять offer, guarantee, price, target outcome, geography or disclaimer без новой Draft revision.
10. **Correction feedback without auto-learning:** причина owner correction сохраняется как observation, но не становится playbook rule без Promotion Policy.

### 6.2. Новые typed contracts

#### `OwnerBusinessBrief`

Короткая, редактируемая owner projection поверх Business Model:

```text
business summary
selected focus
qualified outcome
known exclusions
material assumptions
what the agent will research next
```

#### `BrandAndClaimsContract`

```text
brand identity
voice and tone
required phrases
forbidden phrases
claim → evidence links
legal/policy disclaimers
asset ownership/provenance
visual restrictions
review/expiry
```

#### `CreativeAssetFamily`

```text
family hypothesis
asset role
source/provenance
supported placements and aspect ratios
compatibility set
claim references
owner edits
provider projection pointers
```

#### `RecommendationStory`

```text
why_now
supporting_evidence
exact_delta
confidence_and_limits
alternatives
consequences
agent_recommendation
required_authority
```

#### `AutomationCapabilityMap`

```text
capability
mode: AGENT_OWNED | OWNER_CORRECTABLE | EXACT_AUTHORITY | UNAVAILABLE
scope
invalidation boundary
provider side effects
```

#### `LearningReadiness`

```text
primary outcome
supporting signals
conversion cycle
observed volume
budget sufficiency
packing/split decision
fallback strategy
uncertainty
```

### 6.3. Дополнения к acceptance

1. Незнакомый владелец после первого экрана может объяснить, как агент понял бизнес и что будет рекламировать.
2. Каждый generated asset показывает provenance и проходит Brand & Claims Contract.
3. Все комбинации profile v1 можно preview; нет семантически конфликтующих title/text/image/landing combinations.
4. Provider-generated or optimized meaning не появляется после package approval.
5. New advertiser path завершается честным fallback без invented history.
6. LearningReadiness блокирует budget-fragmenting split.
7. Human Decision Gate проходит comprehension test по формуле `why → evidence → exact delta → consequence`.
8. Ни один pre-launch creative score не описывается как expected CTR, CPA, ROI or winner.

## 7. Приоритет внедрения

### P0 — принять сейчас

| Приоритет | Изменение | Откуда взят паттерн | Зачем |
|---:|---|---|---|
| 1 | Editable AI understanding | Google conversational, Yandex Campaign Master | Сразу исправляет неверное понимание бизнеса |
| 2 | RecommendationStory | Madgicx | Делает Human Decision Gate понятным неспециалисту |
| 3 | BrandAndClaimsContract | Google AI Max, Microsoft Brand Kit | Защищает business meaning и factual claims |
| 4 | CreativeAssetFamily + compatibility | Yandex combinatorial, Google PMax | Даёт разнообразие без cosmetic Draft explosion |
| 5 | Generated asset provenance and preview | Google, TikTok, Yandex | Не допускает скрытых AI changes |
| 6 | AutomationCapabilityMap | TikTok Smart+, Meta single-step | Показывает границы агента без global AI switch |
| 7 | Cold-start path | Google/Yandex URL-first | Позволяет работать новому рекламодателю честно |
| 8 | LearningReadiness | Microsoft/Amazon/Yandex strategy guidance | Не дробит бюджет и не обещает невозможное обучение |

### P1 — подготовить seam, но не реализовывать в текущем модуле

- creative/text/enhancement performance reporting;
- root-cause analysis;
- fatigue detection and refresh proposal;
- mature winner selection;
- budget/bid optimization;
- governed auto-apply inside Mandate;
- incrementality/experiment analysis;
- owner correction outcomes as candidate Knowledge Claims.

### Не планировать как часть P0

- omnichannel launch;
- hundreds of generated variants;
- platform-cabinet browser automation;
- autonomous URL expansion;
- auto-added creative during serving;
- performance-based competitor intelligence without legitimate first-party data;
- proprietary uncalibrated success probability.

## 8. Целевой owner journey после переноса практик

```text
1. URL / access
   → AI показывает, как понял бизнес
   → владелец исправляет только material misunderstanding

2. Agent research
   → Business Model + economics
   → focus + evidence + cold-start limitations

3. Strategy
   → RecommendationStory
   → Brand & Claims Contract
   → one complete business decision

4. Campaign canvas
   → finite control/improvement hypotheses
   → creative families, source labels and combination preview
   → hard eligibility, evidence coverage, non-predictive rank

5. Exact package
   → exact URL and Direct profile v1
   → selected asset families and previews
   → create → suspend → semantic readback
   → no serving/spend/resume
```

Это сохраняет product promise PRD #149, но делает интерфейс конкурентнее: такой же простой старт, как у platform-native AI tools, при существенно более честной и безопасной внешней записи.

## 9. Источники

### Yandex Direct

- [Мастер кампаний](https://yandex.ru/support/direct/ru/campaign-master/about)
- [Конверсии и трафик для продвижения сайта](https://yandex.ru/support/direct/ru/campaign-master/site)
- [Комбинаторное объявление](https://yandex.ru/support/direct/ru/unified-performance-campaign/create-comb-ad)
- [Нейрообъявление](https://yandex.ru/support/direct/ru/unified-performance-campaign/create-neuro-ad)
- [Автоматическое применение рекомендаций](https://yandex.ru/support/direct/ru/campaigns/auto-recommendations)

### Google Ads

- [Conversational experience](https://support.google.com/google-ads/answer/14145186?hl=en)
- [How AI Max works](https://support.google.com/google-ads/answer/15910187?hl=en)
- [Performance Max asset-group best practices](https://support.google.com/google-ads/answer/14528220?hl=en)
- [Generative AI asset-group creation](https://support.google.com/google-ads/answer/14150602?hl=en)

### Meta

- [Meta Advantage+ explained](https://www.facebook.com/business/news/meta-advantage-explained-in-two-minutes)
- [Streamlined Advantage+ and opportunity score](https://www.facebook.com/business/news/supercharge-performance-advantage-opportunity-score)
- [Advantage+ Creative](https://www.facebook.com/business/help/297506218282224)
- [Turn off Advantage+ enhancements](https://www.facebook.com/business/help/1082295769403815)

### TikTok

- [Smart+ campaign controls](https://ads.tiktok.com/business/en-US/blog/smart-plus-ai-performance-solution)
- [Symphony Automation](https://ads.tiktok.com/business/en-US/blog/symphony-automation)
- [Symphony AI-generated content and safety](https://newsroom.tiktok.com/en-us/tiktok-symphony-updates)

### Microsoft Advertising

- [Generative AI API](https://learn.microsoft.com/en-us/advertising/guides/generative-ai?view=bingads-13)
- [Copilot in Microsoft Advertising](https://about.ads.microsoft.com/en/tools/productivity/copilot-in-microsoft-advertising)
- [Performance Max API](https://learn.microsoft.com/en-us/advertising/guides/performance-max?view=bingads-13)
- [Performance Max best practices](https://learn.microsoft.com/en-us/advertising/msa-help/hlp_ba_proc_pmaxbestpractices)

### Amazon Ads

- [DSP Performance+](https://advertising.amazon.com/library/guides/dsp-performance-plus)
- [Generative AI Creative Studio](https://advertising.amazon.com/generative-ai-ad-solutions)

### Independent products

- [Madgicx AI Marketer workflow](https://academy.madgicx.com/lessons/how-to-use-ai-marketer)
- [AdCreative.ai Creative Scoring](https://help.adcreative.ai/en/articles/8885776-what-is-creative-scoring-ai-and-how-to-use-it)
- [AdCreative.ai text generation API](https://api-docs.adcreative.ai/docs/features/ad-text-generation-api)
- [Omneky](https://www.omneky.com/)

## 10. Ограничения исследования

- Platform and SaaS sources describe their own products and may emphasize favorable outcomes.
- No account-level feature availability, rollout or region eligibility was verified.
- No independent benchmark of generated creative quality was found or accepted.
- Meta Help Center pages are partly JavaScript-rendered; claims were cross-checked against official Meta newsroom/help search excerpts.
- SaaS proprietary scores, datasets and claimed accuracy were not independently auditable.
- This report recommends product patterns, not source-code dependencies or provider integrations.
- GitHub issue #149, labels, branches and remote state were not changed.
