export const LOCAL_CODEX_DISPATCH_PATH = "/__local/codex/dispatch";
export const LOCAL_CODEX_DISPATCH_URL = `http://127.0.0.1:19243${LOCAL_CODEX_DISPATCH_PATH}`;
export type CodexDispatchRequest = { run_id: string; request_id: string };
export type CodexDispatchReceipt = { status: "QUEUED"; request_id: string };

export function codexExecutionLabel(workspace: { phase: string; controllerActive?: boolean; dispatch?: { status: string } }) {
  if (workspace.phase === "COLLECTING") return "Сбор источников";
  if (workspace.phase === "COMMITTING") return "Сохранение";
  if (workspace.controllerActive) return "У агента";
  if (workspace.dispatch?.status === "PENDING") return "Передача агенту";
  if (workspace.dispatch?.status === "FAILED") return "Ошибка передачи";
  if (workspace.dispatch?.status === "QUEUED") return "В очереди";
  return "Ожидает агента";
}

/** Wakes the existing controller; no model invocation or Dashboard state access. */
export async function dispatchToCodex(runtime: Record<string, string | undefined>, request: CodexDispatchRequest, fetchImpl: typeof fetch = fetch): Promise<CodexDispatchReceipt> {
  if (runtime.P0_CODEX_DISPATCH_URL !== LOCAL_CODEX_DISPATCH_URL || !runtime.P0_CODEX_DISPATCH_TOKEN) throw new Error("Передача агенту не настроена.");
  const response = await fetchImpl(LOCAL_CODEX_DISPATCH_URL, {
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(25_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${runtime.P0_CODEX_DISPATCH_TOKEN}` },
    body: JSON.stringify(request),
  });
  const result = await response.json().catch(() => null) as CodexDispatchReceipt | null;
  if (!response.ok || result?.status !== "QUEUED" || result.request_id !== request.request_id) throw new Error("Не удалось передать запуск агенту. Повторите передачу.");
  return result;
}
