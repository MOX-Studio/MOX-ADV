#!/usr/bin/env node

import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import { collectHeadlessWordstatPlan } from "./wordstat-headless-collection.mjs";
import { buildWordstatCollectionPlan } from "./wordstat-ui-collector.mjs";

const MAX_BODY_BYTES = 1_000_000;
let active = false;

function required(value, label, maximum) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maximum) throw new Error(`${label} is invalid.`);
  return normalized;
}

function integer(value, label, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${label} is invalid.`);
  return parsed;
}

const host = required(process.env.P0_WORDSTAT_BRIDGE_HOST ?? "127.0.0.1", "Bridge host", 100);
if (host !== "127.0.0.1") throw new Error("Wordstat UI bridge must bind to 127.0.0.1.");
const port = integer(process.env.P0_WORDSTAT_BRIDGE_PORT ?? "19246", "Bridge port", 1, 65_535);
const bridgeToken = required(process.env.P0_WORDSTAT_BRIDGE_TOKEN, "Bridge token", 1_000);
const repositoryRoot = process.env.P0_WORDSTAT_REPOSITORY_ROOT ?? process.cwd();
const artifactRoot = process.env.P0_WORDSTAT_ARTIFACT_ROOT;

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function authorized(request) {
  const actual = Buffer.from(request.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${bridgeToken}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Request body is invalid.");
  return parsed;
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    json(response, 200, { ok: true, provider: "yandex-wordstat-ui", transport: "HEADLESS_PLAYWRIGHT", active });
    return;
  }
  if (request.method !== "POST" || request.url !== "/collect") {
    json(response, 404, { error: "Not found." });
    return;
  }
  if (!authorized(request)) {
    json(response, 401, { error: "Unauthorized." });
    return;
  }
  if (active) {
    json(response, 409, { error: "A Wordstat collection is already active.", code: "PROFILE_CLONE_BUSY" });
    return;
  }
  active = true;
  try {
    const input = await body(request);
    const plan = buildWordstatCollectionPlan(input.plan_input);
    const batch = await collectHeadlessWordstatPlan({
      plan,
      runId: required(input.run_id, "Run ID", 255),
      repositoryRoot,
      ...(artifactRoot ? { artifactRoot } : {}),
    });
    json(response, 200, { batch });
  } catch (error) {
    const code = String(error?.code ?? "UNAVAILABLE").replace(/[^A-Z0-9_]/gu, "").slice(0, 100) || "UNAVAILABLE";
    json(response, code === "PROFILE_CLONE_BUSY" ? 409 : 502, { error: "Wordstat UI collection failed closed.", code });
  } finally {
    active = false;
  }
});

server.requestTimeout = 15 * 60 * 1_000;
server.headersTimeout = 15 * 60 * 1_000 + 5_000;
server.listen(port, host, () => {
  process.stdout.write(`Wordstat UI bridge listening on http://${host}:${port}\n`);
});
