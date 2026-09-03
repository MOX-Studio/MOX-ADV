import assert from "node:assert/strict";
import test from "node:test";

import {
  AccessReadinessService,
  accessProfileForOwner,
} from "../lib/access-readiness.ts";
import { P0OwnerJourney } from "../lib/p0-owner-journey.ts";

class MemoryAccessStore {
  constructor() { this.rows = new Map(); }
  async load(key) { return structuredClone(this.rows.get(key) ?? null); }
  async initialize(key, row) {
    if (this.rows.has(key)) return false;
    this.rows.set(key, structuredClone(row));
    return true;
  }
  async compareAndSwap(key, expectedRevision, row) {
    if (this.rows.get(key)?.revision !== expectedRevision) return false;
    this.rows.set(key, structuredClone(row));
    return true;
  }
}

const discovery = {
  scopes: {
    direct: { granted: true },
    metrika: { granted: true },
    wordstat: { granted: true },
  },
  accounts: [
    { provider_identity: "client-login-4242", label: "Промышленная выставка", detail: "Реклама выставки" },
    { provider_identity: "client-login-other", label: "Другой бизнес", detail: "Отдельный рекламодатель" },
  ],
  counters: [
    { provider_identity: "counter-1717", label: "owner.example", detail: "Основной сайт" },
  ],
};

function adapter(overrides = {}) {
  return {
    async discover() { return structuredClone(discovery); },
    async verifyBinding({ accountIdentity, counterIdentity }) {
      return {
        direct: { matched: accountIdentity === "client-login-4242", scope_granted: true },
        metrika: { matched: counterIdentity === "counter-1717", scope_granted: true },
        wordstat: { scope_granted: true },
      };
    },
    ...overrides,
  };
}

function service(overrides = {}, store = new MemoryAccessStore()) {
  let tick = 0;
  return new AccessReadinessService({
    store,
    adapter: adapter(overrides),
    now: () => `2026-08-24T10:00:${String(tick++).padStart(2, "0")}.000Z`,
  });
}

test("existing advertiser consent discovers business choices, verifies exact binding, and revokes fail closed", async () => {
  const access = service();
  let state = await access.choosePath("owner", "EXISTING_ADVERTISER");
  assert.equal(state.status, "CONSENT_REQUIRED");
  assert.deepEqual(state.requested_scopes, ["DIRECT_READ", "METRIKA_READ", "WORDSTAT_READ"]);

  state = await access.grantConsent("owner", state.revision);
  assert.equal(state.status, "SELECTION_REQUIRED");
  assert.equal(state.discovery.accounts.length, 2);
  assert.equal(state.discovery.counters.length, 1);
  assert.doesNotMatch(JSON.stringify(access.project(state)), /client-login|counter-1717/u);

  const account = access.project(state).accountChoices[0];
  const counter = access.project(state).counterChoices[0];
  state = await access.selectBinding("owner", state.revision, account.handle, counter.handle);
  assert.equal(state.status, "READY");
  assert.equal(accessProfileForOwner(state).evidence_scope.direct, "AVAILABLE");

  state = await access.activate("owner", state.revision);
  assert.equal(state.status, "ACTIVE");
  state = await access.revoke("owner", state.revision);
  assert.equal(state.status, "REVOKED");
  assert.deepEqual(accessProfileForOwner(state).evidence_scope, {
    direct: "UNAVAILABLE",
    metrika: "UNAVAILABLE",
    wordstat: "UNAVAILABLE",
    account_history: "UNAVAILABLE",
  });
});

test("scope drift and wrong-account binding fail closed without widening evidence scope", async () => {
  let wordstatGranted = true;
  const drifting = service({
    async verifyBinding() {
      return {
        direct: { matched: true, scope_granted: true },
        metrika: { matched: true, scope_granted: true },
        wordstat: { scope_granted: wordstatGranted },
      };
    },
  });
  let state = await drifting.choosePath("owner", "EXISTING_ADVERTISER");
  state = await drifting.grantConsent("owner", state.revision);
  const projection = drifting.project(state);
  state = await drifting.selectBinding("owner", state.revision, projection.accountChoices[0].handle, projection.counterChoices[0].handle);
  assert.equal(state.status, "READY");
  state = await drifting.activate("owner", state.revision);
  wordstatGranted = false;
  state = await drifting.get("owner", true);
  assert.equal(state.status, "ACTIVE_LIMITED");
  assert.equal(accessProfileForOwner(state).evidence_scope.wordstat, "UNAVAILABLE");
  assert.equal(accessProfileForOwner(state).evidence_scope.direct, "AVAILABLE");
  wordstatGranted = true;
  state = await drifting.get("owner", true);
  assert.equal(state.status, "ACTIVE");

  const wrong = service({
    async verifyBinding() {
      return {
        direct: { matched: false, scope_granted: true },
        metrika: { matched: true, scope_granted: true },
        wordstat: { scope_granted: true },
      };
    },
  });
  state = await wrong.choosePath("owner", "EXISTING_ADVERTISER");
  state = await wrong.grantConsent("owner", state.revision);
  const wrongProjection = wrong.project(state);
  state = await wrong.selectBinding("owner", state.revision, wrongProjection.accountChoices[0].handle, wrongProjection.counterChoices[0].handle);
  assert.equal(state.status, "BLOCKED");
  assert.equal(accessProfileForOwner(state).evidence_scope.direct, "UNAVAILABLE");
});

function emptyApplication() {
  return {
    queries: 0,
    async query() {
      this.queries += 1;
      return {
        revision: 0,
        state: {
          context_state: null,
          site_analysis: null,
          business_model: null,
          strategy: null,
          strategy_questionnaire: null,
          recommendation_set: null,
          shortlist: null,
          package_review: null,
          human_decision_gate: null,
          package_execution: null,
          package_corrections: [],
          analytics_evidence_snapshot: null,
        },
        workflow: { allowed_commands: ["analyze_site"] },
        shortlist_controls: [],
      };
    },
    async command() { throw new Error("not expected"); },
  };
}

test("typed owner journey keeps consent, discovered choices and revocation in one opaque primary-action seam", async () => {
  const application = emptyApplication();
  const access = service();
  const journey = new P0OwnerJourney(application, { accessReadiness: access });
  let projection = await journey.query("owner");
  assert.equal(application.queries, 0);
  assert.equal(projection.accessReadiness.status, "choose-path");
  assert.equal(projection.primaryAction.fields[0].options[0].label, "Уже запускали рекламу");

  projection = await journey.submit("owner", {
    handle: projection.primaryAction.handle,
    values: { advertiserPath: "existing" },
  });
  assert.equal(projection.accessReadiness.status, "needs-consent");
  assert.equal(projection.cards[0].kind, "human-decision-gate");

  projection = await journey.submit("owner", { handle: projection.primaryAction.handle, values: {} });
  assert.equal(projection.accessReadiness.status, "needs-selection");
  const accountOption = projection.primaryAction.fields.find((field) => field.key === "accountChoice").options[0];
  const counterOption = projection.primaryAction.fields.find((field) => field.key === "counterChoice").options[0];
  assert.match(accountOption.value, /^choice_/u);
  assert.doesNotMatch(JSON.stringify(projection), /client-login|counter-1717|OAuth|Bearer/iu);

  projection = await journey.submit("owner", {
    handle: projection.primaryAction.handle,
    values: { accountChoice: accountOption.value, counterChoice: counterOption.value },
  });
  assert.equal(projection.accessReadiness.status, "ready");
  projection = await journey.submit("owner", {
    handle: projection.primaryAction.handle,
    values: { accessDecision: "continue" },
  });
  assert.equal(application.queries, 1);
  assert.equal(projection.accessReadiness.status, "ready");
  assert.equal(projection.primaryAction.fields.some((field) => field.key === "accessDecision"), true);

  projection = await journey.submit("owner", {
    handle: projection.primaryAction.handle,
    values: { accessDecision: "revoke" },
  });
  assert.equal(projection.accessReadiness.status, "revoked");
  assert.equal(application.queries, 2);
  assert.doesNotMatch(JSON.stringify(projection), /client-login|counter-1717|OAuth|Bearer/iu);
});

test("new advertiser has an explicit cold-start profile whose absent history is unavailable, never zero", async () => {
  const access = service();
  const state = await access.choosePath("owner", "NEW_ADVERTISER");
  assert.equal(state.status, "ACTIVE");
  const profile = accessProfileForOwner(state);
  assert.equal(profile.path, "NEW_ADVERTISER");
  assert.equal(profile.evidence_scope.account_history, "UNAVAILABLE");
  assert.equal(profile.limitations.some((item) => /истори/iu.test(item)), true);
  assert.doesNotMatch(JSON.stringify(profile), /(?:campaign|visit|conversion)[^}]*:\s*0/iu);

  const application = emptyApplication();
  const journeyAccess = service();
  const journey = new P0OwnerJourney(application, { accessReadiness: journeyAccess });
  let projection = await journey.query("new-owner");
  projection = await journey.submit("new-owner", {
    handle: projection.primaryAction.handle,
    values: { advertiserPath: "new" },
  });
  assert.equal(projection.accessReadiness.path, "new");
  assert.equal(projection.accessReadiness.history.availability, "Недоступна");
  assert.match(projection.accessReadiness.history.explanation, /не нулев/u);
  assert.equal(projection.primaryAction.label, "Исследовать бизнес и предложить цель");
  assert.doesNotMatch(JSON.stringify(projection), /(?:campaign|visit|conversion)[^}]*:\s*0/iu);
});
