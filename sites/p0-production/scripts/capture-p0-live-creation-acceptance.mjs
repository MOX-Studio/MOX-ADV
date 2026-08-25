import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { readLiveDeliveryVerification } from "../lib/live-delivery-verification.ts";
import { buildLiveCreationAcceptanceArtifact } from "../lib/p0-live-creation-acceptance.ts";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("Usage: node scripts/capture-p0-live-creation-acceptance.mjs <trusted-input.json> <artifact.json>");
}

const input = JSON.parse(await readFile(resolve(inputPath), "utf8"));
if (input.evidence_mode === "LIVE_OFFICIAL_API"
  && (!Array.isArray(input.delivery_verifications)
    || input.delivery_verifications.length !== input.package_execution.items.length)) {
  const token = process.env.YANDEX_DIRECT_OAUTH_TOKEN ?? "";
  const account = process.env.YANDEX_DIRECT_CLIENT_LOGIN ?? "";
  const dateFrom = String(input.package_execution.started_at ?? input.generated_at).slice(0, 10);
  const dateTo = String(input.generated_at).slice(0, 10);
  input.delivery_verifications = [];
  for (const item of input.package_execution.items) {
    if (!item.provider_ids?.campaign_id) throw new Error("Live package item is missing its exact campaign ID.");
    input.delivery_verifications.push(await readLiveDeliveryVerification({
      itemExecutionId: item.item_execution_id,
      campaignId: item.provider_ids.campaign_id,
      config: { token, account },
      dateFrom,
      dateTo,
      observedAt: input.generated_at,
    }));
  }
}
const artifact = await buildLiveCreationAcceptanceArtifact(input);
await writeFile(resolve(outputPath), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

if (input.evidence_mode === "LIVE_OFFICIAL_API" && artifact.status !== "READY_FOR_OWNER_CHECKPOINT") {
  throw new Error("Live artifact is not checkpoint-ready; ambiguous, non-suspended, non-zero delivery, resume, or incomplete evidence remains.");
}

process.stdout.write(`${artifact.status}\n`);
