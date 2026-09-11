type ActiveExecution = {
  controller: AbortController;
  promise: Promise<unknown>;
};

const registryKey = Symbol.for("mox-adv.pipeline-execution-cancellation.v1");
const runtime = globalThis as unknown as Record<symbol, unknown>;
const executions = (runtime[registryKey] ??= new Map<string, ActiveExecution>()) as Map<string, ActiveExecution>;
const keyFor = (ownerKey: string, runId: string) => JSON.stringify([ownerKey, runId]);

/** One owned execution per run, shared by repeated requests in this runtime. */
export function runPipelineExecutionOnce<T>(input: {
  ownerKey: string;
  runId: string;
  work: (signal: AbortSignal) => Promise<T>;
  checkCancelled?: () => Promise<boolean>;
  cancellationPollMs?: number;
}): Promise<T> {
  const key = keyFor(input.ownerKey, input.runId);
  const existing = executions.get(key);
  if (existing) return existing.promise as Promise<T>;
  const pollMs = input.cancellationPollMs ?? 2_000;
  if (!Number.isSafeInteger(pollMs) || pollMs < 1) throw new Error("Invalid pipeline cancellation polling interval.");
  const controller = new AbortController();
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const execution: ActiveExecution = { controller, promise: Promise.resolve() };
  const poll = async () => {
    if (settled || controller.signal.aborted) return;
    try {
      // The durable flag also reaches a worker when STOP was handled by another instance.
      const cancelled = await input.checkCancelled?.();
      if (!settled && cancelled) controller.abort(new DOMException("Pipeline run was stopped or superseded.", "AbortError"));
    } catch {
      // A failed state read is not evidence that the owner requested cancellation.
    } finally {
      if (!settled && !controller.signal.aborted) timer = setTimeout(() => { void poll(); }, pollMs);
    }
  };
  execution.promise = Promise.resolve().then(() => {
    controller.signal.throwIfAborted();
    return input.work(controller.signal);
  }).finally(() => {
    settled = true;
    if (timer !== null) clearTimeout(timer);
    if (executions.get(key) === execution) executions.delete(key);
  });
  executions.set(key, execution);
  if (input.checkCancelled) timer = setTimeout(() => { void poll(); }, pollMs);
  return execution.promise as Promise<T>;
}

/** Abort only the matching run; keep its admission occupied until its work cleans up. */
export function abortPipelineExecution(ownerKey: string, runId: string): boolean {
  const execution = executions.get(keyFor(ownerKey, runId));
  if (!execution || execution.controller.signal.aborted) return false;
  execution.controller.abort(new DOMException("Pipeline run was stopped by the owner.", "AbortError"));
  return true;
}
