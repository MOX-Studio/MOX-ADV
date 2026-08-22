# Roadmap: MOX-ADV P0 Completion

## Цель

Завершить существующий P0 production candidate как AI-first модуль: агент автономно собирает разрешённые evidence, предлагает рекламный фокус и цель, формирует утверждаемую Strategy, создаёт конечное редактируемое полотно Campaign Drafts, оценивает их pre-launch viability, готовит exact package и умеет безопасно создать его через официальный Direct API без запуска показов.

План развивает текущий authoritative application contract и существующие safety/evidence/canvas/package seams. Он не создаёт новую реализацию P0.

## Scope boundary

**Внутри:** четыре сабмодуля P0, deterministic product MVP acceptance и отдельно разрешённая live acceptance.
**Снаружи:** P1 optimization/winner selection, P2 monitoring, P3 SEO, landing development, Dashboard integration, VK, serving/spend.

Подробный scope cut: `.planning/PROJECT.md`.
Проверяемые требования: `.planning/REQUIREMENTS.md`.

## Порядок и gates

```text
Phase 1 Analytics
→ Phase 2 Formalization
→ Phase 3 Strategy
→ Phase 4 Realization
→ Phase 5 Deterministic MVP Acceptance
→ Phase 6 Authorized Live Evidence
```

- Следующая phase начинается только после executable acceptance предыдущей.
- Каждый plan ниже — самостоятельный vertical slice для одного fresh implementation session после публикации через `to-tickets`.
- Каждый slice сохраняет accepted baseline и добавляет tests на authoritative seam до UI wiring.
- Provider unavailability может завершить evidence slice честным `UNAVAILABLE`; silent omission и fabricated certainty не являются успешным исходом.
- Phase 5 даёт product MVP verdict. Phase 6 требует отдельного человеческого разрешения и доказывает production behavior, но не превращает pre-launch viability в actual effectiveness.

---

## Phase 1 — Data Collection and Analytics

**Goal:** один bounded neural agent автономно собирает достаточное evidence, чтобы рекомендовать рекламный фокус и exact destination, сохраняя application contract единственным источником authority и final truth.

**Requirements:** AGT-01..06, ANL-01..13
**Entry:** существующий deterministic P0 baseline.
**Exit gate:** unfamiliar-business run завершается durable Strategy-ready evidence handoff либо одним подготовленным Material Uncertainty Gate; все источники имеют provenance, а неизвестное остаётся unknown.

### 01-01 — Trusted agent runtime and durable run state

**Outcome:** provider-neutral `P0AgentRuntime`, typed tool registry, objective/checkpoint/observation/budget state и resumable loop работают через `p0-application.ts`.

**Implementation seam:**
- model adapter interface без provider-specific domain logic;
- tool schemas и permission policy в trusted application layer;
- D1 run/checkpoint/observation/budget persistence;
- stop/resume/compaction rules;
- untrusted-content and prompt-injection boundary.

**Acceptance evidence:** contract tests доказывают bounded tool use, unauthorized-tool denial, budget stop, restart continuation и невозможность модели объявить final truth или расширить authority.

### 01-02 — Product/service inventory and focus opportunity cards

**Depends on:** 01-01.

**Outcome:** агент строит materially distinct offer inventory и рекомендует launch-now focus, сохраняя альтернативы с readiness/evidence gaps.

**Implementation seam:** extend `business-model.ts`, `analytics-evidence.ts` и application state; opportunity, readiness и evidence coverage — отдельные dimensions.

**Acceptance evidence:** fixtures для одного и нескольких продуктов, близких SKU, разных audiences/economics/destinations, tie и insufficient evidence; owner может изменить material focus.

### 01-03 — Bounded public competitor and market observations

**Depends on:** 01-01, 01-02.

**Outcome:** production contour сам формирует bounded competitor candidate set и сохраняет observable products/offers/messages/ad/destination patterns.

**Implementation seam:** typed public-search/read tools поверх allowlisted HTTPS research; source/time/query/region/limitations; saturation/evidence budgets; no credentials/forms.

**Acceptance evidence:** direct competitors, substitutes, no-result, blocked page, conflicting claims и prompt injection; UI никогда не показывает invented competitor spend/conversions/CPA/ROI или «успешность» как факт.

### 01-04 — Complete Direct account and report audit

**Depends on:** 01-01.

**Outcome:** официальный API audit охватывает relevant campaigns, groups, criteria, keywords/autotargeting, ads/assets, settings/restrictions и asynchronous reports/search queries.

**Implementation seam:** paginated `get` adapters до отсутствия `LimitedBy`, persisted report requests/retry timing, bounded summaries + artifact references, exact advertiser/account binding.

**Acceptance evidence:** multi-page official-shape fixtures, HTTP 201/202 queues, partial permissions, long IDs, warnings, rate limits и safe restart; browser cabinet не используется.

### 01-05 — Wordstat, comparable cost and auction evidence

**Depends on:** 01-02, 01-04.

**Outcome:** агент формирует bounded multi-seed research plan; harness собирает top/dynamics/regions, квалифицирует comparable cost и сохраняет auction hypotheses отдельно от observations.

**Implementation seam:** extend `market-evidence.ts`; deterministic scope/dedupe/operator validation; comparable candidates из Direct audit; source-labelled provider/first-party ranges без averaging.

**Acceptance evidence:** region/device/seasonality, missing rows, quota, null AuctionBids, comparable/no-comparable CPC, duplicate queries и lower-bound semantics; zero не подменяет unavailable.

### 01-06 — Metrika readiness, destination classification and landing analysis

**Depends on:** 01-01, 01-02, 01-04.

**Outcome:** P0 проверяет measurement readiness, выбирает exact destination и выдаёт максимум три конкретные landing corrections либо `FUTURE_LANDING_REQUIRED` brief.

**Implementation seam:** typed Metrika readiness tool; production adapter для pinned Lighthouse/axe isolated run; bounded neural visual review; deterministic facts отдельно от hypotheses.

**Acceptance evidence:** exact/wrong counter binding, missing or weak goal, sampling/lag, existing page, dedicated landing, invalid target, future landing, inaccessible page, poor CTA/performance/accessibility; landing output не меняет score напрямую и не изменяет сайт.

### 01-07 — Active official-source playbook and analytics handoff

**Depends on:** 01-03, 01-04, 01-05, 01-06.

**Outcome:** первый approved P0 playbook release активен, а Analytics Evidence Snapshot готов к формализации Strategy.

**Implementation seam:** extend `campaign-playbook.ts`; source/applicability/review/expiry/contradiction/eval metadata; content-addressed handoff с claim→evidence→raw provenance и decision-specific sufficiency.

**Acceptance evidence:** expired, contradicted, quarantined и no-active-release cases fail closed; model observations не становятся rules; complete and partially unavailable evidence имеют честные Strategy-ready/decision-required outcomes.

---

## Phase 2 — Questionnaire and Formalization

**Goal:** показать владельцу рекомендованную цель и готовую бизнес-формализацию, спрашивая только то, что агент не может разрешить сам и что materially меняет Strategy/package.

**Requirements:** FRM-01..07
**Depends on:** Phase 1.
**Exit gate:** одна complete canonical Strategy revision готова к approval; owner-facing flow не требует discoverable facts и не показывает technical identity.

### 02-01 — Business-only owner projection

**Outcome:** пять экранов отвечают на «что узнал агент / что рекомендует / почему важно / нужно ли решение / что дальше / какой outcome».

**Implementation seam:** business view models поверх authoritative document; technical fields остаются только в redacted internal artifacts; provider failures переводятся в business impact + next safe action.

**Acceptance evidence:** rendered HTML/accessible snapshot не содержит IDs, hashes, schemas, API methods, provider payloads, journals, internal codes и raw diagnostics; audit artifacts сохраняют lineage.

### 02-02 — Goal-first adaptive formalization

**Depends on:** 02-01.

**Outcome:** goal и recommended focus видны в начале; canonical Strategy schema заполнена агентом, а UI задаёт по одному prepared question только для material unresolved values.

**Implementation seam:** fixed internal Strategy schema + adaptive interaction state; recommendation/evidence/confidence/alternatives/consequences; owner edits for all business-owned fields.

**Acceptance evidence:** known values produce no question; budget/economics/qualified-outcome ambiguity produces one decision; goal remains editable; no blank eleven-field form.

### 02-03 — Revision cascade and exact Strategy approval

**Depends on:** 02-02.

**Outcome:** Context/Model/Strategy/Draft changes имеют предсказуемую materiality и invalidation; один Strategy Gate фиксирует complete intent.

**Implementation seam:** preserve compare-and-swap revisions; named recomputation impact before save; Strategy regeneration and shortlist reset; concurrent-tab conflict.

**Acceptance evidence:** material/non-material edits, stale tab, changed focus/goal/budget/destination и approval invalidation; routine evidence update не требует лишнего human gate.

---

## Phase 3 — Marketing Strategy Development

**Goal:** превратить принятый focus и evidence в одну полную explainable Strategy и конечный набор typed advertising hypotheses.

**Requirements:** STR-01..06
**Depends on:** Phase 2.
**Exit gate:** approved Strategy содержит все business and delivery constraints, explicit fallback при sparse evidence и finite fan-out inputs без post-launch winner claims.

### 03-01 — Focus-aware canonical Strategy synthesis

**Outcome:** агент синтезирует complete Strategy по focus, outcome, offer, audience, demand, positioning, economics, geography, schedule/seasonality, destination и measurement.

**Implementation seam:** provider-neutral structured generation validated against canonical Strategy schema; field-level evidence trace; unsupported values become prepared decisions.

**Acceptance evidence:** unfamiliar business, multiple offers, sparse economics, conflicting owner/site/Direct facts и changed focus; deterministic schema rejects invented/unsupported material values.

### 03-02 — Evidence-driven Yandex strategy and placement decision

**Depends on:** 03-01.

**Outcome:** objective, bidding approach и eligible placements выбираются по Metrika readiness, conversion volume, budget/economics, attribution, demand, seasonality, destination и capability evidence.

**Implementation seam:** versioned playbook decision rules + agent explanation; explicit click/higher-funnel fallback; no one-size-fits-all strategy.

**Acceptance evidence:** sufficient/insufficient conversion volume, missing value, wrong goal semantics, Search-only/Network/Maps eligibility, seasonal and cost-unknown cases.

### 03-03 — Typed hypothesis set and fan-out input

**Depends on:** 03-01, 03-02.

**Outcome:** competitor, demand, auction, creative, targeting и placement hypotheses имеют mechanism, evidence, uncertainty, affected Drafts и verification path; finite axes готовы к realization.

**Implementation seam:** closed hypothesis schemas and one-factor treatment semantics; competitive control only with sufficient public evidence, иначе `STRATEGY_BASELINE_FALLBACK`.

**Acceptance evidence:** no competitors, weak public patterns, auction uncertainty, conflicting evidence и combinatorial alternatives; ни одна hypothesis не называется proven winner/effectiveness.

---

## Phase 4 — Marketing Strategy Realization

**Goal:** реализовать approved Strategy как finite editable campaign canvas с current Direct projections, viability, shortlist, exact package authority и safe non-serving execution.

**Requirements:** CAM-01..11, EXE-01..06
**Depends on:** Phase 3.
**Exit gate:** минимум один realistic fixture может получить complete `VIABLE` projection; approved package проходит durable create→suspend→readback→children→moderation path без serving.

### 04-01 — Exact Direct capability matrix and current core projection

**Outcome:** exact account/profile matrix выбирает supported/conditional/unavailable/not-implemented features; core creation profile использует current eligible `RESPONSIVE_AD` contour.

**Implementation seam:** replace legacy production `TEXT_AD` profile; combinatorial titles/texts/assets and semantic normalization; targeting/autotargeting, negatives, tracking, goals/attribution, placements, schedule/geography and eligible extensions behind explicit capability checks.

**Acceptance evidence:** supported, conditionally eligible, provider-normalized и unsupported selected fields; no silent drop; current official-shape add/get fixtures and native 64-bit IDs.

### 04-02 — Finite fan-out and viability contract

**Depends on:** 04-01.

**Outcome:** Strategy compiles into materially distinct control/improvement Drafts with complete dispositions, delivery-key packing, hard eligibility и explainable pre-launch viability.

**Implementation seam:** extend `campaign-fanout.ts`, `campaign-viability.ts`, `campaign-draft-fields.ts`; eligibility before score; status quartet; sensitivity/evidence coverage; canonical projection fingerprint.

**Acceptance evidence:** duplicate/overlap, no material delta, long-tail packing/split, insufficient demand/evidence, unsupported capability, ties, hidden reasons и at least one defensibly `VIABLE` fixture.

### 04-03 — Editable campaign canvas, revisions and shortlist

**Depends on:** 04-02.

**Outcome:** ranked cards + right drawer показывают business hypothesis, viability, evidence, frequency/cost и все publishable fields; manual edit revises/rescores; shortlist exact and reversible.

**Implementation seam:** extend existing canvas and decision-gate seams; filters/sort/hidden outcomes; field-level delta; persistent shortlist footer and exact package review.

**Acceptance evidence:** keyboard-accessible 1920×1080 interaction, add/exclude/restore, blocked shortlist denial, edit/revision/fingerprint change, stale Gate invalidation, no technical noise.

### 04-04 — Safe package execution for current projections

**Depends on:** 04-01, 04-03.

**Outcome:** existing per-item execution safely handles the new complete projection and preserves package authority, outcomes, moderation, correction and reconciliation.

**Implementation seam:** adapt existing `campaign-package-execution.ts`, `execution-safety.ts` and provider normalization; persist intent; add→suspend→SUSPENDED readback before children; full graph readback; asynchronous moderation; correction with renewed Gate.

**Acceptance evidence:** all success, provider rejection, contained partial outcome, system failure, PREACCEPTED/MODERATION pending, ambiguous add/readback lock, restart, correction/resubmission, final suspension loss и proof that resume is impossible.

---

## Phase 5 — Deterministic P0 Acceptance

**Goal:** принять product MVP без production credentials, external network и real writes.

**Requirements:** ACC-01..05
**Depends on:** Phase 4.
**Exit gate:** полный current-module acceptance artifact доказывает четыре сабмодуля, safe agent behavior, business-only UI и минимум один editable `VIABLE` Draft.

### 05-01 — Agent, evidence and safety eval suite

**Outcome:** eval harness измеряет task success, grounding, unnecessary questions, tool selection, permission correctness, false certainty, restart, cost/latency и human intervention rate.

**Acceptance evidence:** unfamiliar business, multiple offers/audiences, sparse/conflicting evidence, malicious page, competitor/Wordstat/cost unavailable, measurement gaps, hidden-tool attempt, oversized result/compaction, moderation rejection и no-resume invariant.

### 05-02 — Full deterministic business UI and MVP verdict

**Depends on:** 05-01.

**Outcome:** Playwright проходит пять шагов в 1920×1080 только через UI и сохраняет machine-readable artifact с evidence/Strategy/Draft/package lineage.

**Acceptance evidence:** build/lint/contracts/provider fixtures green; no console/page/overflow/a11y errors; no technical identity in rendered HTML; editable canvas содержит ≥1 `VIABLE` Draft с complete current projection; shortlist/package review reproducible; no external writes.

**Product milestone:** после этого slice P0 имеет MVP verdict по критерию владельца.

---

## Phase 6 — Authorized Live P0 Acceptance

**Goal:** отдельно доказать official-API package creation и terminal non-serving outcomes.

**Requirements:** ACC-06
**Depends on:** Phase 5 и явное разрешение владельца.
**Exit gate:** live artifact подтверждает exact authority, provider outcomes и final `SUSPENDED`; любое unknown/reconciliation/non-terminal состояние остаётся PENDING/FAIL.

### 06-01 — One explicitly authorized official-API acceptance

**Outcome:** один exact package проходит через production UI/contract с durable requests/readbacks, moderation и redacted evidence.

**Acceptance evidence:** confirmed business context, account binding, credentials и exact Gate; terminal outcome каждого selected Draft; минимум одна accepted initial campaign при допустимом package verdict; каждая созданная campaign `SUSPENDED`; no resume, impressions or spend.

---

## Progress

| Phase | Vertical plans | Status |
|---|---:|---|
| 1. Data Collection and Analytics | 7 | Ready to plan |
| 2. Questionnaire and Formalization | 3 | Blocked by Phase 1 |
| 3. Marketing Strategy Development | 3 | Blocked by Phase 2 |
| 4. Marketing Strategy Realization | 4 | Blocked by Phase 3 |
| 5. Deterministic P0 Acceptance | 2 | Blocked by Phase 4 |
| 6. Authorized Live P0 Acceptance | 1 | Blocked by Phase 5 + human authority |
| **Total** | **20** | **0 complete** |

## Delivery handoff

1. Владелец принимает этот refinement plan и scope cut.
2. План синхронизируется с GitHub spec #100; конкурирующий frontier #116/#117 приостанавливается или пересобирается.
3. `to-tickets` публикует 20 approved vertical slices или согласованное укрупнение, сохраняя native blockers и один-session sizing.
4. `implement` выполняет один unblocked slice за fresh session с TDD на указанных seams.
5. После Phase 5 фиксируется product MVP verdict; Phase 6 запускается только после отдельного разрешения.
6. Dashboard integration планируется отдельным post-acceptance milestone и не смешивается с текущим P0 completion backlog.

---
*Обновлено: 2026-08-22; требования владельца отсечены до границ текущего модуля и разложены на 20 vertical slices.*
