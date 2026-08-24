import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMeasurementDestinationReadiness,
  verifyMeasurementDestinationReadiness,
} from "../lib/measurement-destination-readiness.ts";
import { PINNED_LANDING_TOOL_VERSIONS } from "../lib/landing-advisory.ts";

const ADDRESS = ["93.184.216.34"];

function strategy() {
  return {
    strategy_revision_id: "campaign-strategy-r7",
    answers: [
      { field_id: "business_goal", value: "Получать квалифицированные заявки" },
      { field_id: "advertised_offer", value: "Участие в промышленной выставке" },
      { field_id: "qualified_result", value: "Отправленная заявка на участие" },
      { field_id: "landing_page", value: "https://owner.example/participate" },
      { field_id: "core_message", value: "Найдите новых покупателей на выставке" },
    ],
  };
}

function context(overrides = {}) {
  return {
    metrika: {
      ready: true,
      authority: "VERIFIED",
      access: "YANDEX_METRIKA_MANAGEMENT_AND_REPORTS_API",
      counter_id: "424242",
      goal_id: "1717",
      observed_at: "2026-08-21T10:00:00.000Z",
      binding: { expected_counter_id: "424242", api_counter_id: "424242", matched: true },
      goal_binding: { expected_goal_id: "1717", api_goal_id: "1717", matched: true },
      goal_definition: {
        source: "YANDEX_METRIKA_MANAGEMENT_API",
        name: "Отправленная заявка на участие",
        type: "FORM",
        default_price: 25000,
        is_retargeting: false,
        conditions: [{ type: "EXACT", value: "participate-form" }],
        steps: [],
        provider_metadata_complete: true,
      },
      goal_catalog: [{
        id: "1717",
        name: "Отправленная заявка на участие",
        type: "FORM",
        default_price: 25000,
        is_retargeting: false,
        conditions: [{ type: "EXACT", value: "participate-form" }],
        steps: [],
      }],
      goal_catalog_complete: true,
      goal_catalog_total: 1,
      ...overrides,
    },
    performance: {
      period_start: "2026-08-01",
      period_end: "2026-08-20",
      display_metrics: { visits: "30", goal_visits: "4", goal_value: "120000" },
      provenance: {
        source_kind: "METRIKA_REPORTS_API",
        observed_at: "2026-08-21T10:00:00.000Z",
        attribution: "last_direct_click_order_dimension",
        timezone: "Europe/Moscow",
        dimensions: ["ym:s:date", "ym:s:lastDirectClickOrder"],
        filters: "ym:s:lastDirectClickOrder=='77'",
        sampling: {
          metadata_complete: true,
          sampled: false,
          contains_sensitive_data: false,
          sample_share: 1,
          sample_size: 30,
          sample_space: 30,
          data_lag: 0,
        },
      },
    },
  };
}

function adapter(overrides = {}) {
  return {
    availability: { available: true, reason: null },
    async resolveHostname() { return ADDRESS; },
    async versions() { return { ...PINNED_LANDING_TOOL_VERSIONS }; },
    async inspect(input) {
      input.policy.authorizeRequest({ url: input.url, method: "GET", resource_type: "document", headers: {}, body_present: false, resolved_addresses: ADDRESS });
      return {
        requested_url: input.url,
        final_url: input.url,
        redirect_chain: [input.url],
        network_requests: [{ url: input.url, method: "GET", resource_type: "document", headers: {}, body_present: false, resolved_addresses: ADDRESS }],
        response_bytes: 1024,
        page: {
          title: "Участие в промышленной выставке",
          headings: ["Найдите новых покупателей на выставке"],
          text_excerpt: "Отправьте заявку на участие в промышленной выставке.",
          ctas: [{ label: "Оставить заявку", kind: "button" }],
          forms: [{ method: "POST", action_kind: "same_page", fields_count: 4 }],
          metrika_tag_detected: true,
          http_status: 200,
          content_type: "text/html",
        },
        hypotheses: input.viewport.form_factor === "mobile" ? [{ dimension: "CTA_ACTION", title: "Проверить заметность кнопки", detail: "На малом экране кнопка может быть ниже первого экрана." }] : [],
      };
    },
    ...overrides,
  };
}

async function build({ metrika = context(), inspection = adapter(), servedDevices = ["desktop", "mobile"] } = {}) {
  let tick = 0;
  return buildMeasurementDestinationReadiness({
    strategy: strategy(),
    context: metrika,
    contextSiteUrl: "https://owner.example/",
    servedDevices,
    adapter: inspection,
    now: () => `2026-08-21T10:00:${String(tick++).padStart(2, "0")}.000Z`,
  });
}

test("exact measurement and relevant existing landing are ready for every served device scope", async () => {
  const result = await build();
  assert.equal(result.status, "READY");
  assert.equal(result.measurement.status, "READY");
  assert.equal(result.measurement.checks.every((check) => check.status === "PASS" || check.status === "NOT_APPLICABLE"), true);
  assert.deepEqual(result.destination.device_scopes.map((scope) => [scope.device, scope.classification, scope.status]), [
    ["desktop", "EXISTING_LANDING", "READY"],
    ["mobile", "EXISTING_LANDING", "READY"],
  ]);
  assert.equal(result.destination.priority_corrections.length <= 3, true);
  assert.equal(result.destination.deterministic_observations.every((item) => item.kind === "DETERMINISTIC_OBSERVATION"), true);
  assert.equal(result.destination.neural_hypotheses.every((item) => item.kind === "NEURAL_HYPOTHESIS"), true);
  assert.equal(await verifyMeasurementDestinationReadiness(result), true);
});

test("sparse weak goal is a blocker with a concrete measurement repair plan and no write action", async () => {
  const weak = context({
    goal_definition: {
      source: "YANDEX_METRIKA_MANAGEMENT_API",
      name: "Просмотр страницы",
      type: "URL",
      default_price: null,
      is_retargeting: false,
      conditions: [{ type: "CONTAIN", value: "/participate" }],
      steps: [],
      provider_metadata_complete: true,
    },
    goal_catalog: [{ id: "1717", name: "Просмотр страницы", type: "URL", default_price: null, is_retargeting: false, conditions: [{ type: "CONTAIN", value: "/participate" }], steps: [] }],
  });
  weak.performance.display_metrics.goal_visits = "1";
  const result = await build({ metrika: weak });
  assert.equal(result.measurement.status, "BLOCKED");
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.measurement.checks.some((check) => check.code === "GOAL_SEMANTICS" && check.status === "FAIL"));
  assert.ok(result.measurement.checks.some((check) => check.code === "RECENT_REACHES" && check.status === "FAIL"));
  assert.ok(result.repair_plan.some((item) => /подтвердить одну существующую основную цель|проверить достижение/iu.test(item.action)));
  assert.equal(result.external_changes_performed, false);
  assert.doesNotMatch(JSON.stringify(result), /create goal|goal creation|изменить сайт автоматически/iu);
});

test("duplicate or materially ambiguous goals block without an arbitrary choice and prepare an owner decision", async (t) => {
  await t.test("duplicate", async () => {
    const duplicate = context({
      goal_catalog: [
        { id: "1717", name: "Отправленная заявка на участие", type: "FORM", default_price: 25000, is_retargeting: false, conditions: [{ type: "EXACT", value: "participate-form" }], steps: [] },
        { id: "1818", name: "Отправленная заявка на участие", type: "FORM", default_price: 25000, is_retargeting: false, conditions: [{ type: "EXACT", value: "participate-form" }], steps: [] },
      ],
    });
    const result = await build({ metrika: duplicate });
    assert.ok(result.measurement.checks.some((check) => check.code === "GOAL_DUPLICATION" && check.status === "FAIL"));
    assert.equal(result.measurement.status, "BLOCKED");
    assert.ok(result.human_decision_gate);
    assert.match(result.human_decision_gate.evidence.join(" "), /две цели|1717|1818/iu);
    assert.equal(result.human_decision_gate.options.length >= 2, true);
  });

  await t.test("unknown semantic stage", async () => {
    const ambiguous = context({
      goal_definition: {
        source: "YANDEX_METRIKA_MANAGEMENT_API",
        name: "Успешное действие",
        type: "ACTION",
        default_price: null,
        is_retargeting: false,
        conditions: [{ type: "EXACT", value: "success" }],
        steps: [],
        provider_metadata_complete: true,
      },
      goal_catalog: [
        { id: "1717", name: "Успешное действие", type: "ACTION", default_price: null, is_retargeting: false, conditions: [{ type: "EXACT", value: "success" }], steps: [] },
        { id: "1818", name: "Отправленная заявка на участие", type: "FORM", default_price: null, is_retargeting: false, conditions: [{ type: "EXACT", value: "participate-form" }], steps: [] },
      ],
    });
    const result = await build({ metrika: ambiguous });
    assert.ok(result.measurement.checks.some((check) => check.code === "GOAL_SEMANTICS" && check.status === "UNKNOWN"));
    assert.ok(result.human_decision_gate);
    assert.match(result.human_decision_gate.recommendation, /не переключать|заблокир/iu);
    assert.ok(result.human_decision_gate.options.some((option) => /Отправленная заявка/iu.test(option.option)));
    assert.equal(result.external_changes_performed, false);
  });
});

test("missing exact attribution prepares a material decision instead of inventing a traffic link", async () => {
  const missing = context();
  missing.performance.provenance.attribution = "unspecified";
  missing.performance.provenance.dimensions = [];
  missing.performance.provenance.filters = "";
  const result = await build({ metrika: missing });
  assert.ok(result.measurement.checks.some((check) => check.code === "ATTRIBUTION" && check.status === "UNKNOWN"));
  assert.ok(result.human_decision_gate);
  assert.match(result.human_decision_gate.evidence.join(" "), /атрибуц|область трафика/iu);
});

test("desktop/mobile destination mismatch blocks the served mobile scope", async () => {
  const mismatch = adapter({
    async inspect(input) {
      const base = await adapter().inspect(input);
      if (input.viewport.form_factor === "mobile") {
        base.page.title = "Новости компании";
        base.page.headings = ["Архив новостей"];
        base.page.text_excerpt = "Корпоративные новости и вакансии.";
        base.page.ctas = [];
        base.page.forms = [];
      }
      return base;
    },
  });
  const result = await build({ inspection: mismatch });
  assert.equal(result.destination.device_scopes.find((scope) => scope.device === "desktop").classification, "EXISTING_LANDING");
  assert.equal(result.destination.device_scopes.find((scope) => scope.device === "mobile").classification, "INVALID_UNRELATED");
  assert.equal(result.status, "BLOCKED");
});

test("unsafe private targets and redirect drift fail closed before readiness", async (t) => {
  await t.test("private DNS", async () => {
    const result = await build({ inspection: adapter({ async resolveHostname() { return ["127.0.0.1"]; } }) });
    assert.equal(result.destination.status, "SAFETY_BLOCKED");
    assert.equal(result.destination.device_scopes.every((scope) => scope.classification === null), true);
    assert.equal(result.status, "BLOCKED");
  });
  await t.test("redirect drift", async () => {
    const result = await build({ inspection: adapter({
      async inspect(input) {
        const base = await adapter().inspect(input);
        base.final_url = "https://unrelated.example/offer";
        base.redirect_chain.push(base.final_url);
        base.network_requests.push({ url: base.final_url, method: "GET", resource_type: "document", headers: {}, body_present: false, resolved_addresses: ADDRESS });
        return base;
      },
    }) });
    assert.equal(result.destination.status, "SAFETY_BLOCKED");
    assert.equal(result.status, "BLOCKED");
  });
});

test("unavailable pinned adapter stays unavailable, never zero or ready", async () => {
  const result = await build({ inspection: adapter({ availability: { available: false, reason: "Isolated inspector is unavailable." } }) });
  assert.equal(result.destination.status, "UNAVAILABLE");
  assert.equal(result.destination.device_scopes.every((scope) => scope.classification === null && scope.status === "UNAVAILABLE"), true);
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.limitations.some((item) => /недоступ/iu.test(item)));
});
