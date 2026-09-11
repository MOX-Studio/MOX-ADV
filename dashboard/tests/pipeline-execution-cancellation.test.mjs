import assert from "node:assert/strict";
import test from "node:test";
import { abortPipelineExecution, runPipelineExecutionOnce } from "../lib/pipeline-execution-cancellation.ts";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test("concurrent execution requests share one model/collector operation and release it on completion", async () => {
  const done = deferred();
  let calls = 0;
  const input = { ownerKey: "owner-dedupe", runId: "run", async work() { calls += 1; return done.promise; } };
  const first = runPipelineExecutionOnce(input);
  const second = runPipelineExecutionOnce(input);
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  done.resolve("verified");
  assert.equal(await first, "verified");
  assert.equal(await second, "verified");
  assert.equal(abortPipelineExecution(input.ownerKey, input.runId), false);
});

test("STOP cancels only the exact owner/run and waits for owned cleanup before releasing admission", async () => {
  const cleanup = deferred();
  let firstSignal;
  let otherSignal;
  const firstInput = { ownerKey: "owner-stop", runId: "run", async work(signal) { firstSignal = signal; await cleanup.promise; return "cleaned"; } };
  const first = runPipelineExecutionOnce(firstInput);
  const other = runPipelineExecutionOnce({ ownerKey: "other-owner", runId: "run", async work(signal) { otherSignal = signal; await cleanup.promise; return "other"; } });
  await Promise.resolve();
  assert.equal(abortPipelineExecution("owner-stop", "wrong-run"), false);
  assert.equal(abortPipelineExecution("owner-stop", "run"), true);
  assert.equal(firstSignal.aborted, true);
  assert.equal(otherSignal.aborted, false);
  assert.equal(runPipelineExecutionOnce(firstInput), first);
  assert.equal(abortPipelineExecution("owner-stop", "run"), false);
  cleanup.resolve();
  assert.deepEqual(await Promise.all([first, other]), ["cleaned", "other"]);
});

test("a durable cancellation flag reaches work even when local STOP was handled elsewhere", async () => {
  let checks = 0;
  const result = await runPipelineExecutionOnce({
    ownerKey: "owner-durable-stop", runId: "run", cancellationPollMs: 2,
    async checkCancelled() { checks += 1; return checks === 2; },
    async work(signal) {
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      return signal.reason.name;
    },
  });
  assert.equal(result, "AbortError");
  assert.equal(checks, 2);
});

test("transient cancellation-state read failure cannot become an invented STOP", async () => {
  let checks = 0;
  let signal;
  const done = deferred();
  const result = runPipelineExecutionOnce({
    ownerKey: "owner-state-read", runId: "run", cancellationPollMs: 2,
    async checkCancelled() { checks += 1; if (checks === 1) throw new Error("temporary read failure"); done.resolve(); return false; },
    async work(currentSignal) { signal = currentSignal; await done.promise; return "completed"; },
  });
  assert.equal(await result, "completed");
  assert.equal(signal.aborted, false);
  assert.equal(checks, 2);
});
