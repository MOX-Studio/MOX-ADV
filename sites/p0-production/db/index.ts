import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Start the local application with its Vite development command so the configured local binding is injected."
    );
  }

  return drizzle(env.DB, { schema });
}
