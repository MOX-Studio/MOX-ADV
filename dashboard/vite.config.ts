import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import { devServerConfig } from "./lib/dev-server";
import { LOCAL_WORDSTAT_START_URL } from "./lib/wordstat-service-readiness";
import { localWordstatServicePlugin } from "./scripts/local-wordstat-service.mjs";
import { localCodexDispatchPlugin } from "./scripts/local-codex-dispatch.mjs";
import { LOCAL_CODEX_DISPATCH_URL } from "./lib/codex-dispatch";

const LOCAL_D1_DATABASE_ID = "00000000-0000-4000-8000-000000000000";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: [
    {
      binding: "DB",
      database_name: "mox-adv-p0-local",
      database_id: LOCAL_D1_DATABASE_ID,
    },
  ],
};

export default defineConfig(async ({ command, mode }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  const runtime = loadEnv(mode, process.cwd(), "");

  return {
    server: devServerConfig(isCodexSeatbeltSandbox, process.env.P0_STABLE_LOCAL_RUNTIME === "1"),
    plugins: [
      localWordstatServicePlugin(runtime),
      localCodexDispatchPlugin(runtime),
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: {
          ...localBindingConfig,
          ...(command === "serve" ? { vars: { P0_WORDSTAT_AUTOSTART_URL: LOCAL_WORDSTAT_START_URL, P0_CODEX_DISPATCH_URL: LOCAL_CODEX_DISPATCH_URL, P0_CODEX_DISPATCH_TOKEN: runtime.P0_CODEX_DISPATCH_TOKEN || "" } } : {}),
        },
      }),
    ],
  };
});
