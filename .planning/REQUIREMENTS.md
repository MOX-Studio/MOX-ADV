# Requirements: MOX-ADV P0 Completion

**Scope:** только `P0 — Стратегия и создание рекламных кампаний`
**Source of truth for scope:** `.planning/PROJECT.md`
**Core value:** владелец получает подготовленную агентом бизнес-рекомендацию и принимает только решения, которые действительно требуют его authority или знания.

## 1. Trusted neural agent

- [ ] **AGT-01**: P0 использует один реальный provider-neutral neural model loop `model → typed tool → validated observation`, а не выдаёт deterministic extractors за AI-агента.
- [ ] **AGT-02**: Модель планирует, интерпретирует evidence и предлагает действия; только P0 application contract авторизует tools, проверяет schemas, сохраняет state, выполняет side effects и объявляет final truth.
- [ ] **AGT-03**: Агент получает узкие typed tools для разрешённой работы P0 и не получает произвольные HTTP, browser, SQL, shell, provider или site-write tools.
- [ ] **AGT-04**: Objective, checkpoints, observations, source references, budgets и stop reasons сохраняются durable; безопасные reads, report queues и moderation polling продолжаются после restart/compaction.
- [ ] **AGT-05**: Public pages и tool output считаются untrusted evidence и не могут менять objective, policy, authority или tool permissions.
- [ ] **AGT-06**: Model/tool/time/cost/quota budgets ограничены; исчерпание бюджета приводит к честному bounded stop, а не к скрытому неполному результату.

## 2. Data collection and analytics

- [ ] **ANL-01**: Агент строит ограниченный каталог materially distinct products/services/offers с audience, qualified outcome, economics, destination, current promotion и unresolved facts.
- [ ] **ANL-02**: При нескольких значимых предложениях агент формирует comparable focus cards, раздельно показывая market opportunity, launch readiness и evidence coverage, рекомендует редактируемый initial focus и сохраняет альтернативы/blocked options с причинами.
- [ ] **ANL-03**: Агент автономно собирает bounded public competitor set и наблюдает товары, предложения, сообщения, ad-visible patterns и destinations с source/time/scope/limitations; чужие spend, CPC, conversions, CPA, ROI и profitability остаются unknown.
- [ ] **ANL-04**: P0 выполняет полный релевантный read-only Direct audit через официальные paginated APIs: campaigns, groups, criteria/keywords/autotargeting, ads/assets, settings/restrictions и asynchronous reports/search queries.
- [ ] **ANL-05**: Агент готовит bounded multi-seed Wordstat plan по продуктам, проблемам, high-intent, brand/non-brand, exclusions, region, device и seasonality; official top/dynamics/regions evidence сохраняет точный scope.
- [ ] **ANL-06**: Frequency хранится как source-scoped observation/lower bound; missing rows, quota и provider failures означают `UNAVAILABLE`, а не нулевой спрос.
- [ ] **ANL-07**: Comparable cost candidates выводятся из Direct audit и квалифицируются deterministic-кодом по phrase, geography, placement, strategy и season; provider и first-party ranges не смешиваются и содержат source/date/currency/VAT/sample size.
- [ ] **ANL-08**: Auction assumptions оформляются отдельными typed hypotheses с evidence, assumptions, uncertainty, affected Drafts и verification path и не выдаются за provider facts.
- [ ] **ANL-09**: Metrika readiness проверяет exact counter/site binding, funnel goals, primary optimization goal semantics, recent reaches, value/revenue readiness, attribution, tracking, sampling/privacy/lag и optional offline-conversion readiness.
- [ ] **ANL-10**: Для каждого focus определяется exact destination: existing site page, existing landing, `FUTURE_LANDING_REQUIRED` или invalid/unrelated target.
- [ ] **ANL-11**: Existing destination получает deterministic checks и отдельно labelled neural hypotheses по offer/message match, CTA/action path, forms, measurement, access, performance, accessibility, prominence, hierarchy и readability; результат содержит не более трёх приоритетных corrections.
- [ ] **ANL-12**: Первый активный curated P0 playbook содержит только принятые official-source правила с applicability, source, review/expiry, contradiction handling и eval fixture.
- [ ] **ANL-13**: P0 применяет active playbook, но не повышает собственные pre-launch observations, edits или moderation outcomes до новых execution rules автоматически.

## 3. Questionnaire and formalization

- [ ] **FRM-01**: Рекомендованная агентом цель кампании находится среди первых owner-visible полей, объясняется evidence и остаётся напрямую редактируемой.
- [ ] **FRM-02**: Каноническая Strategy schema остаётся полной и стабильной, но interaction является adaptive: агент заполняет discoverable facts и задаёт по одному вопросу только по unresolved material business decision.
- [ ] **FRM-03**: Prepared question содержит recommendation, evidence, confidence, alternatives и consequences; blank questionnaire не используется как способ сбора discoverable facts.
- [ ] **FRM-04**: Владелец может изменить goal, focus, offer, audience, qualified result, exclusions, geography, period, destination, budget, target result cost и core message до Strategy approval.
- [ ] **FRM-05**: Material Context/Model edit инвалидирует зависимые Strategy/Drafts; material Strategy edit создаёт новую immutable revision, пересчитывает Recommendation Set и очищает shortlist; material Draft edit меняет только Draft revision и зависимые score/package artifacts.
- [ ] **FRM-06**: Один Strategy Human Decision Gate фиксирует complete business intent; routine facts и безопасные reads не требуют отдельного approval.
- [ ] **FRM-07**: Owner-facing UI показывает findings, recommendation, business consequence, required decision, next action и outcome без technical identities, raw diagnostics и implementation terminology.

## 4. Marketing strategy development

- [ ] **STR-01**: Агент формирует одну полную canonical Campaign Strategy с focus, business outcome, offer, audience, qualified result, exclusions, demand clusters, positioning, placements, geography, schedule/seasonality, budget/economics, attribution, measurement и destination.
- [ ] **STR-02**: Каждое material Strategy value имеет internal trace к approved owner input или Analytics Evidence Snapshot; unsupported values явно отмечены.
- [ ] **STR-03**: Выбор objective, bidding approach и Search/Network/Maps/other eligible placements основан на measurement quality, conversion volume, economics, attribution, budget, demand, seasonality, destination readiness и exact account capabilities.
- [ ] **STR-04**: Sparse conversion/cost evidence создаёт explicit fallback strategy или Material Uncertainty Gate, а не fabricated certainty и не неподходящую conversion strategy.
- [ ] **STR-05**: Competitor, demand, auction, creative, targeting и placement hypotheses типизированы и содержат mechanism, evidence, assumptions, uncertainty, affected Drafts и verification path.
- [ ] **STR-06**: P0 не использует post-launch outcomes и не заявляет actual effectiveness или winner до serving; это граница следующего модуля.

## 5. Marketing strategy realization

- [ ] **CAM-01**: Approved Strategy revision детерминированно создаёт finite Recommendation Set materially distinct Campaign Drafts; каждый candidate получает terminal visible/hidden/blocked disposition.
- [ ] **CAM-02**: Long-tail demand группируется по общим goal, economics, geography, destination, message и management; отдельный Draft появляется только при material delivery difference и evidence-backed capacity.
- [ ] **CAM-03**: Каждый Draft представляет ровно одну будущую реальную campaign и содержит полный supported publish projection без silent subset.
- [ ] **CAM-04**: Exact account capability matrix классифицирует Direct features как supported, conditionally eligible, unavailable или not implemented и объясняет выбранный core profile.
- [ ] **CAM-05**: Core production profile поддерживает current eligible combinatorial/`RESPONSIVE_AD` creation и semantic readback; legacy `TEXT_AD` не является production acceptance substrate.
- [ ] **CAM-06**: Applicable targeting, autotargeting/brand settings, sitelinks/callouts/assets, negatives, tracking, monitoring, goals/attribution, placements, geography и schedule включаются только после capability/eligibility check; selected unsupported fields блокируют publication.
- [ ] **CAM-07**: Hard eligibility выполняется до scoring и включает lineage, destination/measurement readiness, demand, account capability, policy/legal constraints, duplicate protection, projection validity и non-serving safety.
- [ ] **CAM-08**: Comparable eligible Drafts получают deterministic pre-launch score/rank, evidence coverage и sensitivity bounds со статусом `VIABLE`, `TESTABLE_WITH_GAPS`, `INSUFFICIENT_EVIDENCE` или `BLOCKED`; score не называется прогнозом эффективности.
- [ ] **CAM-09**: Ranked campaign canvas позволяет открыть полную projection в drawer, редактировать каждое publishable поле, видеть delta, hidden reasons, filters/sort и не терять lineage.
- [ ] **CAM-10**: Владелец вручную добавляет, исключает и возвращает Drafts; publish-blocked Draft нельзя поместить в shortlist.
- [ ] **CAM-11**: Persistent shortlist и package review показывают exact selected Draft revisions/fingerprints, Strategy revision, account binding, capability profile и material consequences.

## 6. Safe package execution

- [ ] **EXE-01**: Один exact package Human Decision Gate фиксирует ordered selection и authority; любое material изменение после review инвалидирует Gate.
- [ ] **EXE-02**: Package не считается транзакцией: каждый Draft имеет независимый durable execution record, outcome, provider issues и reconciliation state.
- [ ] **EXE-03**: Для каждого item intent сохраняется до network mutation; затем campaign создаётся, немедленно suspend, подтверждается `State=SUSPENDED`, и только после этого создаются supported child objects.
- [ ] **EXE-04**: Final semantic readback подтверждает полный supported graph и отсутствие silent field loss; ambiguous write/readback удерживает account lock и не повторяется вслепую.
- [ ] **EXE-05**: Moderation продолжается asynchronously из durable checkpoint; `PREACCEPTED`/`MODERATION` остаются pending, correction создаёт новую Draft revision и требует новый exact Gate.
- [ ] **EXE-06**: P0 interface/allowlist не содержит `Campaigns.resume`; каждая созданная campaign заканчивает P0 подтверждённо non-serving без impressions/spend.

## 7. Acceptance

- [ ] **ACC-01**: Build, lint, contracts и official-shape provider fixtures проходят без production credentials и real writes.
- [ ] **ACC-02**: Agent evals покрывают unfamiliar business, multiple offers, sparse/conflicting evidence, prompt injection, tool misuse, provider quota/queue, unnecessary owner question, restart/compaction и false certainty.
- [ ] **ACC-03**: Полный пятишаговый путь проходит через UI Playwright в 1920×1080 без direct state/API manipulation, horizontal overflow, console/page errors и inaccessible primary controls.
- [ ] **ACC-04**: Rendered owner HTML не содержит IDs, hashes, schemas, API methods, raw payloads/journals и internal codes; complete redacted evidence остаётся доступным во внутренних artifacts.
- [ ] **ACC-05**: Product MVP acceptance формирует editable canvas минимум с одним `VIABLE` Draft, sufficient evidence, complete current Direct projection, reproducible shortlist и exact package review.
- [ ] **ACC-06**: После отдельного явного разрешения live acceptance фиксирует official-API requests/readbacks, terminal item outcomes и final `SUSPENDED` каждой созданной campaign без resume, serving и spend.

## Отсечённые требования

- **OUT-01 — P1:** post-launch campaign management, optimization, bids/budgets, experiments и выбор actual winner.
- **OUT-02 — P2:** unified monitoring и human intervention для рекламы и SEO.
- **OUT-03 — P3:** автоматическое изменение текстов сайта, написание/публикация статей и интеграция с paid-article/link marketplaces.
- **OUT-04 — Future landing:** разработка, изменение и публикация внешнего лендинга; P0 заканчивает correction plan или future-landing brief.
- **OUT-05 — Future channels:** VK и другие рекламные каналы.
- **OUT-06 — Integration:** замена P0 Test Scenario внутри Integrated Prototype до отдельного post-acceptance milestone.
- **OUT-07 — Serving:** `Campaigns.resume`, показы и расходы.
- **OUT-08 — Other:** browser automation кабинетов Яндекса, mobile/responsive design, multi-account/RBAC/enterprise workflows.

## Traceability

| Phase | Requirements |
|---|---|
| Phase 1 — Data Collection and Analytics | AGT-01..06, ANL-01..13 |
| Phase 2 — Questionnaire and Formalization | FRM-01..07 |
| Phase 3 — Marketing Strategy Development | STR-01..06 |
| Phase 4 — Marketing Strategy Realization | CAM-01..11, EXE-01..06 |
| Phase 5 — Deterministic P0 Acceptance | ACC-01..05 |
| Phase 6 — Authorized Live P0 Acceptance | ACC-06 |

**Coverage:** 55 in-scope requirements; 55 mapped; 0 unmapped.

---
*Обновлено: 2026-08-22 после scope cut требований владельца.*
