import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";

import { createLocalWordstatService, localWordstatServicePlugin } from "../scripts/local-wordstat-service.mjs";
import { createWordstatUiBridge } from "../scripts/wordstat-ui-bridge.mjs";
import { ensureWordstatServiceReady, LOCAL_WORDSTAT_START_URL } from "../lib/wordstat-service-readiness.ts";

async function listen(server, port = 0) {
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

async function fixture(t) {
  const reservation = createServer();
  const port = await listen(reservation);
  await close(reservation);
  const runtime = {
    P0_WORDSTAT_BRIDGE_URL: `http://127.0.0.1:${port}`,
    P0_WORDSTAT_BRIDGE_TOKEN: "fixture-wordstat-token",
  };
  const created = [];
  const manager = createLocalWordstatService({
    runtime, dashboardRoot: "/unused-fixture",
    loadBridge: async () => ({
      createWordstatUiBridge(options) {
        const bridge = createWordstatUiBridge({ ...options, collectPlan() { throw new Error("Unexpected provider collection."); } });
        created.push(bridge);
        return bridge;
      },
    }),
  });
  t.after(() => manager.close());
  return { port, runtime, manager, created };
}

test("pipeline readiness starts a stopped bridge once, waits for health, reuses it and releases its listener", async (t) => {
  const { runtime, manager, created } = await fixture(t);
  assert.equal(created.length, 0);
  await assert.rejects(fetch(`${runtime.P0_WORDSTAT_BRIDGE_URL}/health`));
  await Promise.all(Array.from({ length: 5 }, () => manager.ensureReady()));
  assert.equal(created.length, 1);
  assert.equal((await (await fetch(`${runtime.P0_WORDSTAT_BRIDGE_URL}/health`)).json()).active, false);
  await manager.ensureReady();
  assert.equal(created.length, 1);
  await manager.close();
  await assert.rejects(fetch(`${runtime.P0_WORDSTAT_BRIDGE_URL}/health`));
});

test("an independently launched bridge is reused and remains running after the Dashboard manager closes", async (t) => {
  const { runtime, manager, created, port } = await fixture(t);
  const external = createWordstatUiBridge({ bridgeToken: runtime.P0_WORDSTAT_BRIDGE_TOKEN });
  await listen(external, port);
  t.after(() => close(external));
  await manager.ensureReady();
  assert.equal(created.length, 0);
  await manager.close();
  assert.equal((await fetch(`${runtime.P0_WORDSTAT_BRIDGE_URL}/health`)).status, 200);
});

test("wrong bridge credentials fail readiness without replacing the existing listener", async (t) => {
  const { manager, created, port } = await fixture(t);
  const external = createWordstatUiBridge({ bridgeToken: "different-token" });
  await listen(external, port);
  t.after(() => close(external));
  await assert.rejects(manager.ensureReady(), /key does not match/);
  assert.equal(created.length, 0);
  assert.equal(external.listening, true);
});

test("a conflicting port fails cleanly and the next pipeline start can retry after it is freed", async (t) => {
  const { manager, created, port } = await fixture(t);
  const unrelated = createServer((_request, response) => response.end("unrelated service"));
  await listen(unrelated, port);
  t.after(() => close(unrelated));
  await assert.rejects(manager.ensureReady(), /port is occupied/);
  assert.equal(created.length, 0);
  await close(unrelated);
  await manager.ensureReady();
  assert.equal(created.length, 1);
});

test("readiness keeps the start pending until the service confirms and reports failures without credentials", async () => {
  let release;
  let completed = false;
  const readiness = new Promise((resolve) => { release = resolve; });
  const runtime = { P0_WORDSTAT_AUTOSTART_URL: LOCAL_WORDSTAT_START_URL, P0_WORDSTAT_BRIDGE_TOKEN: "secret-fixture" };
  const pending = ensureWordstatServiceReady(runtime, async (url, init) => {
    assert.equal(url, LOCAL_WORDSTAT_START_URL);
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "manual");
    assert.equal(init.headers.Authorization, "Bearer secret-fixture");
    await readiness;
    return Response.json({ ok: true, provider: "yandex-wordstat-ui" });
  }).then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(completed, false);
  release();
  await pending;
  assert.equal(completed, true);
  for (const result of [Response.json({ ok: false }, { status: 503 }), Response.json({ ok: true, provider: "wrong" })]) {
    await assert.rejects(ensureWordstatServiceReady(runtime, async () => result), (error) => {
      assert.match(error.message, /Не удалось запустить локальный сервис Wordstat/);
      assert.doesNotMatch(error.message, /secret-fixture/);
      return true;
    });
  }
  await ensureWordstatServiceReady({}, async () => { throw new Error("Production must not call the local manager."); });
  await assert.rejects(ensureWordstatServiceReady({ ...runtime, P0_WORDSTAT_AUTOSTART_URL: "https://example.com" }), /Некорректный адрес/);
});

test("local startup middleware rejects unauthenticated requests before service creation and passes ordinary requests through", async () => {
  let middleware;
  const errors = [];
  const plugin = localWordstatServicePlugin({ P0_WORDSTAT_BRIDGE_TOKEN: "fixture-token" });
  plugin.configureServer({
    config: { root: "/unused-fixture", logger: { error(message) { errors.push(message); } } },
    middlewares: { use(value) { middleware = value; } },
  });
  const response = {
    status: 0, setHeader() {},
    writeHead(status) { this.status = status; return this; },
    end(body) { assert.deepEqual(JSON.parse(body), { ok: false }); },
  };
  await middleware({ url: "/__local/wordstat/ensure", method: "POST", headers: {} }, response, () => assert.fail());
  assert.equal(response.status, 403);
  assert.deepEqual(errors, ["[Wordstat] Local startup authorization rejected."]);
  let passed = false;
  await middleware({ url: "/api/p0", method: "GET" }, response, () => { passed = true; });
  assert.equal(passed, true);
  await plugin.closeBundle();
});
