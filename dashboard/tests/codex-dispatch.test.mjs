import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalCodexDispatcher } from "../scripts/local-codex-dispatch.mjs";
import { dispatchToCodex, codexExecutionLabel, LOCAL_CODEX_DISPATCH_URL } from "../lib/codex-dispatch.ts";

const thread = "11111111-1111-4111-8111-111111111111";
const runId = "pipeline-22222222-2222-4222-8222-222222222222";
const input = { run_id: runId, request_id: `${runId}:start` };

test("dispatch queues the existing thread once across concurrent requests and manager restarts", async t => {
  const root = await mkdtemp(join(tmpdir(), "mox-dispatch-")); t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const options = { dashboardRoot: root, runtime: { P0_CODEX_CONTROLLER_THREAD_ID: thread }, run: async (...args) => { calls.push(args); } };
  const dispatcher = createLocalCodexDispatcher(options);
  const results = await Promise.all([dispatcher(input), dispatcher(input), dispatcher(input)]);
  assert.equal(calls.length, 1); assert(results.every(r => r.status === "QUEUED"));
  await createLocalCodexDispatcher(options)(input); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1].slice(0, 4), ["queue", "--thread", thread, "--message"]);
  assert(calls[0][1][4].includes(runId)); assert(calls[0][1][4].includes("не начинай его заново"));
  assert(!calls[0][1].includes("exec")); assert(!calls[0][1].includes("--model")); assert.equal(calls[0][2].shell, undefined);
});

test("definite queue failure is retryable, while an uncertain timeout does not duplicate the message", async t => {
  const root = await mkdtemp(join(tmpdir(), "mox-dispatch-failure-")); t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0;
  const options = { dashboardRoot: root, runtime: { P0_CODEX_CONTROLLER_THREAD_ID: thread }, run: async () => { if (++calls === 1) throw Object.assign(new Error("offline"), { code: 1 }); } };
  await assert.rejects(createLocalCodexDispatcher(options)(input), /did not acknowledge/);
  await createLocalCodexDispatcher(options)(input); assert.equal(calls, 2);
  const uncertain = { ...input, run_id: runId.replace(/2/g, "3"), request_id: `${runId.replace(/2/g, "3")}:start` };
  options.run = async () => { throw Object.assign(new Error("timeout"), { killed: true, signal: "SIGTERM" }); };
  await assert.rejects(createLocalCodexDispatcher(options)(uncertain), /did not acknowledge/);
  await assert.rejects(createLocalCodexDispatcher(options)(uncertain), /reconciliation/);
});

test("the queue target and message cannot be supplied by a Dashboard request", async t => {
  const root = await mkdtemp(join(tmpdir(), "mox-dispatch-input-")); t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0;
  const dispatcher = createLocalCodexDispatcher({ dashboardRoot: root, runtime: { P0_CODEX_CONTROLLER_THREAD_ID: thread }, run: async () => { calls++; } });
  await assert.rejects(dispatcher({ ...input, thread, message: "run something else" }), /Invalid/);
  await assert.rejects(dispatcher({ run_id: "$(echo unsafe)", request_id: "x" }), /Invalid/);
  assert.equal(calls, 0);
});

test("Worker dispatch requires the authenticated canonical endpoint and a matching queue receipt", async () => {
  const runtime = { P0_CODEX_DISPATCH_URL: LOCAL_CODEX_DISPATCH_URL, P0_CODEX_DISPATCH_TOKEN: "test-only-token" };
  await dispatchToCodex(runtime, input, async (url, init) => {
    assert.equal(url, LOCAL_CODEX_DISPATCH_URL); assert.equal(init.headers.Authorization, "Bearer test-only-token");
    assert.equal(init.redirect, "manual"); assert.deepEqual(JSON.parse(init.body), input);
    return Response.json({ status: "QUEUED", request_id: input.request_id });
  });
  await assert.rejects(dispatchToCodex({ ...runtime, P0_CODEX_DISPATCH_URL: "https://outside.example/" }, input), /не настроена/);
  await assert.rejects(dispatchToCodex(runtime, input, async () => Response.json({ status: "QUEUED", request_id: "other" })), /Не удалось/);
});

test("queued or unclaimed preparation is never presented as active collection", () => {
  assert.equal(codexExecutionLabel({ phase: "READY", controllerActive: false }), "Ожидает агента");
  assert.equal(codexExecutionLabel({ phase: "READY", dispatch: { status: "QUEUED" } }), "В очереди");
  assert.equal(codexExecutionLabel({ phase: "READY", controllerActive: true }), "У агента");
  assert.equal(codexExecutionLabel({ phase: "COLLECTING" }), "Сбор источников");
  assert.equal(codexExecutionLabel({ phase: "READY", dispatch: { status: "FAILED" } }), "Ошибка передачи");
});
