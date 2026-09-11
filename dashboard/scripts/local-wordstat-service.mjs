import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { LOCAL_WORDSTAT_START_PATH } from "../lib/wordstat-service-readiness.ts";

const PROVIDER = "yandex-wordstat-ui";

function configuration(runtime) {
  const token = String(runtime.P0_WORDSTAT_BRIDGE_TOKEN ?? "").trim();
  const url = new URL(String(runtime.P0_WORDSTAT_BRIDGE_URL ?? ""));
  if (!token || token.length > 1_000 || url.protocol !== "http:" || url.hostname !== "127.0.0.1"
    || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Invalid local Wordstat bridge configuration.");
  }
  const port = Number(url.port || 80);
  if (port === 19243) throw new Error("Wordstat cannot use the Dashboard port.");
  return { token, url, port };
}

// The listener is owned by the Dashboard's Node runtime, not the Cloudflare
// Worker. No browser/profile is opened until the existing /collect operation.
export function createLocalWordstatService({ runtime, dashboardRoot, loadBridge = async () => (
  import(pathToFileURL(resolve(dashboardRoot, "scripts/wordstat-ui-bridge.mjs")).href)
) }) {
  let ownedServer;
  let starting;
  let closed = false;

  async function healthy({ url, token }) {
    let response;
    try {
      response = await fetch(new URL("/health", url), {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(1_500),
      });
    } catch (error) {
      if (error.cause?.code === "ECONNREFUSED") return false;
      throw new Error("Wordstat bridge did not answer its readiness check.");
    }
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true || result?.provider !== PROVIDER
      || result?.transport !== "HEADLESS_PLAYWRIGHT") {
      throw new Error("Wordstat bridge port is occupied or its key does not match.");
    }
    return true;
  }

  async function start() {
    const config = configuration(runtime);
    if (await healthy(config)) return;
    if (closed) throw new Error("Local Wordstat manager is closed.");
    const { createWordstatUiBridge } = await loadBridge();
    if (closed) throw new Error("Local Wordstat manager is closed.");
    const server = createWordstatUiBridge({
      bridgeToken: config.token,
      repositoryRoot: runtime.P0_WORDSTAT_REPOSITORY_ROOT || dashboardRoot,
      artifactRoot: runtime.P0_WORDSTAT_ARTIFACT_ROOT || undefined,
    });
    ownedServer = server;
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      await healthy(config);
    } catch (error) {
      ownedServer = undefined;
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      // Another local manager may have won the port while we were starting.
      if (error.code === "EADDRINUSE" && await healthy(config)) return;
      throw error;
    }
  }

  return {
    async ensureReady() {
      if (closed) throw new Error("Local Wordstat manager is closed.");
      // Concurrent pipeline starts share one attempt; a failed attempt can retry.
      starting ??= start().finally(() => { starting = undefined; });
      await starting;
    },
    async close() {
      closed = true;
      await starting?.catch(() => {});
      const server = ownedServer;
      ownedServer = undefined;
      if (!server) return; // Never stop a separately launched bridge.
      // Closing active responses triggers the collector's abort/cleanup path.
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** @returns {import('vite').Plugin} */
export function localWordstatServicePlugin(runtime) {
  let service;
  return {
    name: "mox-local-wordstat-service",
    apply: "serve",
    enforce: "pre",
    configureServer(server) {
      service = createLocalWordstatService({ runtime, dashboardRoot: server.config.root });
      server.middlewares.use(async (request, response, next) => {
        if (request.url !== LOCAL_WORDSTAT_START_PATH) return next();
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        const token = String(runtime.P0_WORDSTAT_BRIDGE_TOKEN ?? "").trim();
        const expected = Buffer.from(`Bearer ${token}`);
        const actual = Buffer.from(request.headers.authorization ?? "");
        if (request.method !== "POST" || !token || actual.length !== expected.length
          || !timingSafeEqual(actual, expected)) {
          server.config.logger.error("[Wordstat] Local startup authorization rejected.");
          response.writeHead(403).end(JSON.stringify({ ok: false }));
          return;
        }
        try {
          await service.ensureReady();
          response.writeHead(200).end(JSON.stringify({ ok: true, provider: PROVIDER }));
        } catch {
          server.config.logger.error("[Wordstat] Не удалось подготовить локальный сервис: проверьте его настройки и порт.");
          response.writeHead(503).end(JSON.stringify({ ok: false }));
        }
      });
    },
    async closeBundle() {
      await service?.close();
    },
  };
}
