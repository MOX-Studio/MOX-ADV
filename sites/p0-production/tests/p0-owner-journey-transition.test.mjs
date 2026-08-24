import assert from "node:assert/strict";
import test from "node:test";

import {
  ownerActionDescriptor,
  ownerPublicBrandName,
  P0OwnerJourney,
  strategyLandingRequiresContextReanalysis,
} from "../lib/p0-owner-journey.ts";

test("does not expose strategy approval when Product Focus has no viable exact destination", () => {
  const descriptor = ownerActionDescriptor({
    revision: 8,
    state: {
      context_state: { status: "GOAL_CONFIRMED" },
      business_model: {
        source: "REAL_SITE_RESEARCH_PLUS_OWNER_CONFIRMATION",
        owner_contract: { fields: {}, questions: [] },
      },
      product_focus: {
        decision_status: "HUMAN_DECISION_REQUIRED",
        selected_offer_id: null,
        focus_opportunities: {
          cards: [{
            offer_id: "blocked-offer",
            label: "Предложение без посадочной",
            launch_readiness: { status: "BLOCKED", blockers: ["Допустимая точная посадочная страница не подтверждена."] },
          }],
        },
      },
      site_analysis: { url: "https://example.com/" },
      strategy: null,
    },
    workflow: {
      allowed_commands: ["save_business_model"],
    },
  });

  assert.equal(descriptor.kind, "analyze-business");
  assert.equal(descriptor.label, "Проверить посадочную страницу");
  assert.equal(descriptor.fields[0].key, "website");
});

test("asks the owner to restore one concrete offer when Product Focus has no cards", () => {
  const descriptor = ownerActionDescriptor({
    revision: 9,
    state: {
      context_state: { status: "GOAL_CONFIRMED" },
      business_model: {
        source: "REAL_SITE_RESEARCH_PLUS_OWNER_CONFIRMATION",
        owner_contract: { fields: {}, questions: [] },
      },
      product_focus: {
        decision_status: "HUMAN_DECISION_REQUIRED",
        selected_offer_id: null,
        focus_opportunities: { cards: [] },
      },
      strategy: null,
    },
    workflow: { allowed_commands: ["save_business_model"] },
  });

  assert.equal(descriptor.kind, "confirm-business-model");
  assert.equal(descriptor.label, "Уточнить рекламируемое предложение");
});

test("exposes an explicit Product Focus choice when viable options require an owner decision", () => {
  const descriptor = ownerActionDescriptor({
    revision: 9,
    state: {
      context_state: { status: "GOAL_CONFIRMED" },
      business_model: {
        source: "REAL_SITE_RESEARCH_PLUS_OWNER_CONFIRMATION",
        owner_contract: { fields: {}, questions: [] },
      },
      product_focus: {
        decision_status: "HUMAN_DECISION_REQUIRED",
        selected_offer_id: null,
        focus_opportunities: {
          recommended_offer_id: "offer-branding",
          cards: [
            {
              offer_id: "offer-branding",
              label: "Комплексный брендинг для компаний",
              launch_readiness: { status: "READY" },
            },
            {
              offer_id: "offer-blocked",
              label: "Неподтверждённая услуга",
              launch_readiness: { status: "BLOCKED" },
            },
          ],
        },
      },
      strategy: null,
    },
    workflow: { allowed_commands: ["select_focus"] },
  });

  assert.equal(descriptor.kind, "select-focus");
  assert.equal(descriptor.label, "Выбрать рекламный фокус");
  assert.deepEqual(descriptor.fields[0].options, [{
    value: "offer-branding",
    label: "Комплексный брендинг для компаний",
  }]);
  assert.equal(descriptor.fields[0].value, "offer-branding");
});

test("public competitor brand names preserve legitimate uppercase identities", () => {
  assert.equal(ownerPublicBrandName("DDVB"), "DDVB");
  assert.equal(ownerPublicBrandName("REDIN"), "REDIN");
  assert.equal(ownerPublicBrandName("P0_INTERNAL_SCHEMA"), "техническая деталь");
});

test("a strategy landing on another business requires fresh Context research", () => {
  const state = { site_analysis: { url: "https://www.apple.com/government/" } };

  assert.equal(strategyLandingRequiresContextReanalysis(state, "https://mox-studio.ru/branding"), true);
  assert.equal(strategyLandingRequiresContextReanalysis(state, "https://apple.com/business/"), false);
  assert.equal(strategyLandingRequiresContextReanalysis(state, "https://store.apple.com/shop"), false);
});

test("owner action handles bind to the application revision after agent-owned safe progress", async () => {
  let current = {
    revision: 1,
    state: {
      context_state: null,
      package_corrections: [],
    },
    workflow: { allowed_commands: [] },
    shortlist_controls: [],
    revision_history: [],
  };
  const application = {
    async query() {
      return structuredClone(current);
    },
    async command(_ownerKey, payload) {
      assert.equal(payload.expected_revision, current.revision);
      current = { ...current, revision: current.revision + 1 };
      return structuredClone(current);
    },
  };
  const journey = new P0OwnerJourney(application, {
    agentProjection: async () => {
      current = { ...current, revision: current.revision + 1 };
      return null;
    },
  });

  const first = await journey.query("owner-race");
  assert.ok(first.primaryAction);
  const second = await journey.submit("owner-race", {
    handle: first.primaryAction.handle,
    values: { website: "https://example.com/" },
  });
  assert.ok(second.primaryAction);
  await journey.submit("owner-race", {
    handle: second.primaryAction.handle,
    values: { website: "https://example.com/" },
  });
});
