#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCodexFinalOutput, resolveCodexOutputPlan } from "../lib/codex-subscription-protocol.mjs";
import { isPublicCompetitorDiscovery, isEvidenceResearch } from "../lib/public-web-research.ts";

const MAX_BODY_BYTES = 5_000_000;
const MAX_STDOUT_BYTES = 5_000_000;
const MAX_STDERR_BYTES = 64_000;

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

const host = required(process.env.P0_CODEX_BRIDGE_HOST ?? "127.0.0.1", "Bridge host", 100);
if (host !== "127.0.0.1") throw new Error("Codex subscription bridge must bind to 127.0.0.1.");
const port = integer(process.env.P0_CODEX_BRIDGE_PORT ?? "19244", "Bridge port", 0, 65_535);
const bridgeToken = required(process.env.P0_CODEX_BRIDGE_TOKEN, "Bridge token", 1_000);
const codexExecutable = required(process.env.CODEX_EXECUTABLE ?? "codex", "Codex executable", 2_000);
const defaultTimeoutMs = integer(process.env.P0_CODEX_TIMEOUT_MS ?? "105000", "Codex timeout", 1_000, 115_000);

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
  const value = request.headers.authorization ?? "";
  const expected = `Bearer ${bridgeToken}`;
  const left = Buffer.from(value);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function requestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function validateTurn(value) {
  const body = record(value);
  const model = required(body.model, "Codex model", 200);
  if (!/^[A-Za-z0-9._:-]+$/u.test(model)) throw new Error("Codex model is invalid.");
  const prompt = required(body.prompt, "Codex prompt", MAX_BODY_BYTES);
  if (!Array.isArray(body.tools) || body.tools.length < 1 || body.tools.length > 32) {
    throw new Error("Codex tools are invalid.");
  }
  const tools = body.tools.map((raw) => {
    const tool = record(raw);
    const name = required(tool.name, "Tool name", 128);
    if (!/^p0_[a-z0-9_]+$/u.test(name)) throw new Error("Tool name is outside the P0 namespace.");
    return {
      name,
      description: required(tool.description, "Tool description", 2_000),
      input_schema: record(tool.input_schema),
    };
  });
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length) throw new Error("Tool names must be unique.");
  const output = resolveCodexOutputPlan(tools, body.output_format);
  if (body.timeout_ms === null && !isEvidenceResearch(tools)) throw new Error("Untimed execution is reserved for evidence research.");
  const timeoutMs = body.timeout_ms === null ? null : body.timeout_ms === undefined ? defaultTimeoutMs
    : integer(body.timeout_ms, "Requested Codex timeout", 1_000, 290_000);
  return { model, prompt, tools, output, timeoutMs };
}

function codexEnvironment() {
  const allowed = [
    "HOME", "PATH", "TMPDIR", "USER", "LOGNAME", "LANG", "LC_ALL", "SHELL",
    "CODEX_HOME", "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY",
    "SSL_CERT_FILE", "SSL_CERT_DIR",
  ];
  return Object.fromEntries(allowed
    .filter((name) => typeof process.env[name] === "string")
    .map((name) => [name, process.env[name]]));
}

function appendBounded(current, chunk, maximum, label) {
  const next = current + chunk.toString();
  if (Buffer.byteLength(next) > maximum) throw new Error(`${label} exceeded its limit.`);
  return next;
}

async function executeCodex({ model, prompt, tools, output, timeoutMs }, signal) {
  const publicDiscovery = isPublicCompetitorDiscovery(tools);
  const completedWebCalls = new Set();
  const startedAt = Date.now();
  const requestId = randomUUID();
  let spawnedAt = null;
  let firstEventAt = null;
  let phase = "PREPARATION";
  let failureCode = null;
  const lastEvents = [];
  let usage = {};
  const eventTypes = new Set(["thread.started", "turn.started", "turn.completed", "turn.failed", "item.started", "item.updated", "item.completed", "error"]);
  const itemTypes = new Set(["agent_message", "reasoning", "command_execution", "mcp_tool_call", "file_change", "web_search", "todo_list", "error"]);
  const count = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;
  const diagnostic = (event, extra = {}) => console.error(JSON.stringify({
    event,
    request_id: requestId,
    model,
    tool_names: tools.map((tool) => tool.name),
    output_format: output.format,
    prompt_bytes: Buffer.byteLength(prompt),
    timeout_ms: timeoutMs,
    duration_ms: Date.now() - startedAt,
    process_start_ms: spawnedAt === null ? null : spawnedAt - startedAt,
    first_event_ms: firstEventAt === null ? null : firstEventAt - startedAt,
    phase,
    last_event_types: [...lastEvents],
    usage: { input_tokens: count(usage.input_tokens), cached_input_tokens: count(usage.cached_input_tokens), output_tokens: count(usage.output_tokens) },
    ...extra,
  }));
  diagnostic("codex_turn_started");
  let directory;
  let stdout = "";
  let stderr = "";
  let eventCursor = 0;
  let child;
  const cancel = () => { failureCode = "CODEX_TURN_CANCELLED"; child?.kill("SIGKILL"); };
  const observeEvent = (line) => {
    try {
      const event = record(JSON.parse(line));
      if (!eventTypes.has(event.type)) return;
      if (firstEventAt === null) firstEventAt = Date.now();
      if (event.type === "turn.started") phase = "MODEL_OUTPUT";
      const itemType = record(event.item).type;
      if (event.type === "item.completed" && ["web_search", "web_search_call"].includes(itemType)) {
        completedWebCalls.add(record(event.item).id ?? `web:${completedWebCalls.size}`);
      }
      lastEvents.push(`${event.type}${itemTypes.has(itemType) ? `:${itemType}` : ""}`);
      if (lastEvents.length > 8) lastEvents.shift();
      if (event.type === "turn.completed") usage = record(event.usage);
    } catch { /* JSON event contents are never logged. */ }
  };
  try {
    signal?.throwIfAborted();
    directory = await mkdtemp(join(tmpdir(), "mox-codex-subscription-"));
    const schemaPath = join(directory, "output-schema.json");
    const outputPath = join(directory, "output.json");
    await writeFile(schemaPath, JSON.stringify(output.schema), "utf8");
    phase = "PROCESS_STARTUP";
    child = spawn(codexExecutable, [
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
      "--sandbox", "read-only",
      "--cd", directory,
      "--model", model,
      "-c", "model_reasoning_effort=\"low\"",
      ...["shell_tool", "shell_snapshot", "plugins", "hooks", "multi_agent"].flatMap((feature) => ["--disable", feature]),
      "-c", publicDiscovery ? "web_search=\"live\"" : "web_search=\"disabled\"",
      "-c", "tools.view_image=false",
      "--output-schema", schemaPath,
      "--output-last-message", outputPath,
      "--color", "never",
      "--json",
      "-",
    ], {
      cwd: directory,
      env: codexEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.once("spawn", () => { spawnedAt = Date.now(); phase = "CLI_STARTUP"; });
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    child.stdout.on("data", (chunk) => {
      try {
        stdout = appendBounded(stdout, chunk, MAX_STDOUT_BYTES, "Codex stdout");
        for (let newline = stdout.indexOf("\n", eventCursor); newline >= 0; newline = stdout.indexOf("\n", eventCursor)) {
          const line = stdout.slice(eventCursor, newline);
          eventCursor = newline + 1;
          observeEvent(line);
        }
      } catch {
        failureCode = "CODEX_STDOUT_LIMIT";
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (chunk) => {
      try {
        stderr = appendBounded(stderr, chunk, MAX_STDERR_BYTES, "Codex stderr");
      } catch {
        failureCode = "CODEX_STDERR_LIMIT";
        child.kill("SIGKILL");
      }
    });
    child.stdin.end(prompt);

    const exitCode = await new Promise((resolve, reject) => {
      const timeout = timeoutMs === null ? undefined : setTimeout(() => {
        failureCode = "CODEX_TURN_TIMEOUT";
        child.kill("SIGKILL");
        reject(new Error("CODEX_TURN_TIMEOUT"));
      }, timeoutMs);
      child.once("error", () => {
        if (timeout !== undefined) clearTimeout(timeout);
        reject(new Error("CODEX_PROCESS_SPAWN_FAILED"));
      });
      child.once("close", (code) => {
        if (timeout !== undefined) clearTimeout(timeout);
        resolve(code);
      });
    });
    if (exitCode !== 0) {
      throw new Error(failureCode ?? "CODEX_PROCESS_FAILED");
    }
    if (eventCursor < stdout.length) observeEvent(stdout.slice(eventCursor));

    phase = "OUTPUT_VALIDATION";
    if (publicDiscovery && completedWebCalls.size === 0) throw new Error("CODEX_WEB_RESEARCH_MISSING");
    const final = parseCodexFinalOutput(await readFile(outputPath, "utf8"), output);
    diagnostic("codex_turn_completed", { completed_web_calls: completedWebCalls.size });
    return {
      ...(publicDiscovery ? { public_research: { completed_web_calls: completedWebCalls.size } } : {}),
      output_format: output.format,
      call: {
        id: `codex-subscription:${randomUUID()}`,
        name: final.name,
        arguments: final.arguments,
      },
      usage: {
        input_tokens: Math.max(0, Math.trunc(Number(usage.input_tokens ?? 0) || 0)),
        output_tokens: Math.max(0, Math.trunc(Number(usage.output_tokens ?? 0) || 0)),
      },
    };
  } catch (error) {
    const code = failureCode ?? (error instanceof Error && /^CODEX_[A-Z_]+$/u.test(error.message) ? error.message : "CODEX_EXECUTION_FAILED");
    diagnostic("codex_turn_failed", { failure_code: code });
    throw Object.assign(new Error(code), { diagnosticRecorded: true, responseInvalid: phase === "OUTPUT_VALIDATION" });
  } finally {
    signal?.removeEventListener("abort", cancel);
    if (child && child.exitCode === null) child.kill("SIGKILL");
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    json(response, 200, { ok: true, provider: "codex-subscription" });
    return;
  }
  if (request.method !== "POST" || request.url !== "/turn") {
    json(response, 404, { error: "Not found." });
    return;
  }
  if (!authorized(request)) {
    json(response, 401, { error: "Unauthorized." });
    return;
  }
  const controller = new AbortController();
  response.once("close", () => { if (!response.writableFinished) controller.abort(new Error("Client cancelled the research request.")); });
  try {
    const turn = validateTurn(await requestBody(request));
    json(response, 200, await executeCodex(turn, controller.signal));
  } catch (error) {
    const outputInvalid = error?.responseInvalid === true;
    const configurationInvalid = error?.diagnosticRecorded !== true;
    if (configurationInvalid) console.error(JSON.stringify({ event: "codex_turn_rejected", failure_code: "CODEX_REQUEST_INVALID" }));
    json(response, configurationInvalid ? 400 : outputInvalid ? 422 : 503, {
      error: "Codex subscription turn failed.",
      code: configurationInvalid ? "MODEL_CONFIGURATION_INVALID" : outputInvalid ? "MODEL_RESPONSE_INVALID" : "MODEL_PROVIDER_FAILED",
    });
  }
});

server.listen(port, host, () => {
  const address = server.address();
  const actualPort = address && typeof address === "object" ? address.port : port;
  console.log(JSON.stringify({ event: "listening", host, port: actualPort }));
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
