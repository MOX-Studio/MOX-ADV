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
        name: "Отправленная заявка на участие",
        type: "ACTION",
        semantic_role: "PRIMARY_BUSINESS_RESULT",
        funnel_stage: "QUALIFIED_LEAD",
        funnel_complete: true,
      },
      value_tracking: { relevant: true, status: "READY", currency: "RUB" },
      offline_conversion: { relevant: false, status: "NOT_APPLICABLE" },
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
  const weak = context({ goal_definition: { name: "Просмотр страницы", type: "PAGE_VIEW", semantic_role: "MICRO_CONVERSION", funnel_stage: "AWARENESS", funnel_complete: false } });
  weak.performance.display_metrics.goal_visits = "1";
  const result = await build({ metrika: weak });
  assert.equal(result.measurement.status, "BLOCKED");
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.measurement.checks.some((check) => check.code === "GOAL_SEMANTICS" && check.status === "FAIL"));
  assert.ok(result.measurement.checks.some((check) => check.code === "RECENT_REACHES" && check.status === "FAIL"));
  assert.ok(result.repair_plan.some((item) => /выбрать существующую основную цель|проверить достижение/iu.test(item.action)));
  assert.equal(result.external_changes_performed, false);
  assert.doesNotMatch(JSON.stringify(result), /create goal|goal creation|изменить сайт автоматически/iu);
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
