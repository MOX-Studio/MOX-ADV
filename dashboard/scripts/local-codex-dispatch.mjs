import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { LOCAL_CODEX_DISPATCH_PATH } from "../lib/codex-dispatch.ts";

const execute = promisify(execFile);
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;

export function controllerWakeMessage(runId) {
  return `Сигнал MOX-ADV: пользователь запустил подготовку ${runId}. Продолжи этот запуск в /Users/sviridov/Documents/MOX-ADV через UI http://127.0.0.1:19243/. Сначала прочитай AGENTS.md и docs/agents/single-codex-pipeline.md. Ты — тот же управляющий Codex: не создавай агентов или модельные циклы. Проверь текущий запуск через UI; если он остановлен, завершён или заменён другим, не начинай его заново. Возьми свободное управление, выполни сбор и необходимые исследования, затем стратегию и кампании до сохранённого результата. Конечная задача агента — создать сильные объявления и настройки, которые по имеющимся данным лучше всего ведут к точной цели владельца в её сроке и бюджете. Сравни существенные варианты, проверь сильнейшие возражения и исправь недостатки. Применяй campaign_optimization из материалов каждого этапа; продолжай после каждого сохранения без промежуточных указаний владельца. Если есть repair_context, продолжи сохранённую доработку. Не считай успешную компиляцию доказательством эффективности. Сохрани цель и подтверждённые вводные владельца. Только реальные данные, если в материалах запуска не разрешён тест. Загрузка объявлений в Директ, публикация и расходы не входят в задачу. Если этот сигнал пришёл во время другой работы в той же сессии, продолжи подготовку после неё.`;
}

export function createLocalCodexDispatcher({ runtime, dashboardRoot, run = execute }) {
  const inFlight = new Map();
  return async function dispatch(input) {
    const thread = String(runtime.P0_CODEX_CONTROLLER_THREAD_ID ?? "");
    if (!uuid.test(thread) || !input || Object.keys(input).sort().join(",") !== "request_id,run_id"
      || !/^pipeline-[0-9a-f-]{36}$/u.test(input.run_id) || !uuid.test(input.run_id.slice(9)) || input.request_id !== `${input.run_id}:start`) throw new Error("Invalid controller dispatch.");
    if (inFlight.has(input.request_id)) return inFlight.get(input.request_id);
    const job = (async () => {
      const directory = resolve(dashboardRoot, ".wrangler/codex-dispatch");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const path = resolve(directory, createHash("sha256").update(`${thread}:${input.request_id}`).digest("hex") + ".json");
      const previous = await readFile(path, "utf8").then(JSON.parse).catch(error => { if (error.code === "ENOENT") return null; throw error; });
      if (previous?.status === "QUEUED") return { status: "QUEUED", request_id: input.request_id };
      // An interrupted send is uncertain; do not silently duplicate it.
      if (previous?.status === "SENDING") throw new Error("Controller dispatch outcome needs reconciliation.");
      await writeFile(path, JSON.stringify({ ...input, status: "SENDING" }), { mode: 0o600 });
      try {
        await run(runtime.P0_CODEX_CLI || "codex", ["queue", "--thread", thread, "--message", controllerWakeMessage(input.run_id)], {
          cwd: resolve(dashboardRoot, ".."), timeout: 20_000, maxBuffer: 64 * 1024, windowsHide: true,
        });
      } catch (error) {
        // A timeout may follow acceptance: retain SENDING instead of claiming failure.
        if (!error.killed && error.signal !== "SIGTERM") await writeFile(path, JSON.stringify({ ...input, status: "FAILED" }), { mode: 0o600 });
        throw new Error("The existing Codex session did not acknowledge dispatch.");
      }
      const receipt = { status: "QUEUED", request_id: input.request_id };
      await writeFile(path + ".next", JSON.stringify(receipt), { mode: 0o600 });
      await rename(path + ".next", path);
      return receipt;
    })();
    inFlight.set(input.request_id, job);
    try { return await job; } finally { inFlight.delete(input.request_id); }
  };
}

/** @returns {import('vite').Plugin} */
export function localCodexDispatchPlugin(runtime) {
  return { name: "mox-local-codex-dispatch", apply: "serve", enforce: "pre", configureServer(server) {
    const dispatch = createLocalCodexDispatcher({ runtime, dashboardRoot: server.config.root });
    server.middlewares.use(async (request, response, next) => {
      if (request.url !== LOCAL_CODEX_DISPATCH_PATH) return next();
      response.setHeader("Cache-Control", "no-store"); response.setHeader("Content-Type", "application/json");
      const token = String(runtime.P0_CODEX_DISPATCH_TOKEN ?? ""), expected = Buffer.from(`Bearer ${token}`), actual = Buffer.from(request.headers.authorization ?? "");
      if (request.method !== "POST" || !token || expected.length !== actual.length || !timingSafeEqual(expected, actual)) { response.writeHead(403).end('{"ok":false}'); return; }
      try {
        const chunks = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > 4096) throw new Error("Request too large."); chunks.push(chunk); }
        const result = await dispatch(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        response.writeHead(200).end(JSON.stringify(result));
      } catch { server.config.logger.error("[Codex] Не удалось передать запуск управляющей сессии."); response.writeHead(503).end('{"ok":false}'); }
    });
  } };
}
