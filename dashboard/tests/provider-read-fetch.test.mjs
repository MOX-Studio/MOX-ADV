import assert from "node:assert/strict";
import test from "node:test";
import { providerReadFetcher } from "../lib/provider-read-fetch.ts";

test("provider reads preserve request data and every caller cancellation source", async () => {
  for (const cancelledSource of ["owner", "request"]) {
    const owner = new AbortController();
    const request = new AbortController();
    let observed;
    const fetcher = providerReadFetcher({ signal: owner.signal, fetcher: async (url, init) => {
      observed = { url, init };
      return new Response("{}", { headers: { "Content-Type": "application/json" } });
    } });
    await fetcher("https://provider.example/read", { method: "POST", body: "exact request", signal: request.signal });
    assert.equal(observed.init.method, "POST");
    assert.equal(observed.init.body, "exact request");
    assert.equal(observed.init.signal.aborted, false);
    const reason = new Error("Stopped by owner");
    (cancelledSource === "owner" ? owner : request).abort(reason);
    assert.equal(observed.init.signal.reason, reason);
  }
});

test("a stalled response body times out after headers instead of keeping the collector pending", async () => {
  const fetcher = providerReadFetcher({ timeoutMs: 15, fetcher: async (_url, init) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"pending":'));
      init.signal.addEventListener("abort", () => controller.error(init.signal.reason), { once: true });
    },
  })) });
  // AbortSignal.timeout uses an unref'd timer in Node; keep only this test's deadline alive.
  let timer;
  try {
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Request did not settle")), 1000); });
    await assert.rejects(Promise.race([(await fetcher("https://provider.example/read")).json(), deadline]), { name: "TimeoutError" });
  } finally { clearTimeout(timer); }
});

test("a request cancelled before dispatch never reaches the provider", () => {
  const owner = new AbortController();
  owner.abort(new Error("Already stopped"));
  let calls = 0;
  const fetcher = providerReadFetcher({ signal: owner.signal, fetcher: async () => { calls += 1; return new Response(); } });
  assert.throws(() => fetcher("https://provider.example/read"), /Already stopped/u);
  assert.equal(calls, 0);
});
