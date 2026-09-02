import assert from "node:assert/strict";
import test from "node:test";

import { collectHeadlessWordstatUiBatch } from "../lib/wordstat-ui-client.ts";

const researchPlan = {
  seeds: [{
    seed_id: "seed:stand",
    cluster_id: "cluster:stand",
    phrase: "застройка стенда иннопром",
    operator_profile: "PHRASE",
    dimension: "OFFER_LANGUAGE",
    device: "all",
  }],
  scope: {
    regions: [{ id: 54, name: "Свердловская область" }],
    seasonality: { from_date: "2024-09-01", to_date: "2026-08-31" },
  },
};

const runtime = {
  P0_WORDSTAT_BRIDGE_URL: "http://127.0.0.1:19246",
  P0_WORDSTAT_BRIDGE_TOKEN: "test-token",
};

test("headless Wordstat bridge request aborts at its bounded timeout", async () => {
  let signal = null;

  await assert.rejects(
    collectHeadlessWordstatUiBatch(researchPlan, runtime, {
      requestTimeoutMs: 5,
      fetchImpl: async (_url, init) => {
        signal = init.signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    }),
    /WORDSTAT_UI_REQUEST_TIMEOUT/u,
  );

  assert.equal(signal.aborted, true);
});
