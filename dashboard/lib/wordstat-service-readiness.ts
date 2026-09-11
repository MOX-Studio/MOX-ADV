export const LOCAL_WORDSTAT_START_PATH = "/__local/wordstat/ensure";
export const LOCAL_WORDSTAT_START_URL = `http://127.0.0.1:19243${LOCAL_WORDSTAT_START_PATH}`;

type WordstatServiceRuntime = {
  P0_WORDSTAT_AUTOSTART_URL?: string;
  P0_WORDSTAT_BRIDGE_TOKEN?: string;
};

// Only local development installs a Node service manager. Deployed Workers use
// their explicitly provisioned bridge and cannot start local processes.
export async function ensureWordstatServiceReady(
  runtime: WordstatServiceRuntime,
  fetchImpl: typeof fetch = fetch,
) {
  const endpoint = runtime.P0_WORDSTAT_AUTOSTART_URL;
  if (!endpoint) return;
  if (endpoint !== LOCAL_WORDSTAT_START_URL) {
    throw new Error("Некорректный адрес локального запуска Wordstat.");
  }
  const token = runtime.P0_WORDSTAT_BRIDGE_TOKEN?.trim();
  if (!token) throw new Error("Не настроен ключ локального сервиса Wordstat.");
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      redirect: "manual",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Wordstat service readiness returned HTTP ${response.status}.`);
    const result = await response.json() as { ok?: boolean; provider?: string };
    if (result.ok !== true || result.provider !== "yandex-wordstat-ui") {
      throw new Error("Unexpected Wordstat service response.");
    }
  } catch (error) {
    console.error("[Wordstat] Local startup failed:", error instanceof Error ? error.message : "unknown error");
    throw new Error("Не удалось запустить локальный сервис Wordstat. Повторите запуск; если ошибка сохраняется, проверьте настройки сервиса и занятость его порта.");
  }
}
