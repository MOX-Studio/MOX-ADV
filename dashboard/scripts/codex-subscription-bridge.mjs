#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_BODY_BYTES = 1_000_000;
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
const timeoutMs = integer(process.env.P0_CODEX_TIMEOUT_MS ?? "105000", "Codex timeout", 1_000, 115_000);

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
  const prompt = required(body.prompt, "Codex prompt", 800_000);
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
  return { model, prompt, tools };
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

async function executeCodex({ model, prompt, tools }) {
  const directory = await mkdtemp(join(tmpdir(), "mox-codex-subscription-"));
  const schemaPath = join(directory, "output-schema.json");
  const outputPath = join(directory, "output.json");
  const schema = {
    type: "object",
    properties: {
      tool_name: { type: "string", enum: tools.map((tool) => tool.name) },
      arguments_json: { type: "string" },
    },
    required: ["tool_name", "arguments_json"],
    additionalProperties: false,
  };
  await writeFile(schemaPath, JSON.stringify(schema), "utf8");

  let stdout = "";
  let stderr = "";
  let child;
  try {
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
    child.stdout.on("data", (chunk) => {
      try {
        stdout = appendBounded(stdout, chunk, MAX_STDOUT_BYTES, "Codex stdout");
      } catch {
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (chunk) => {
      try {
        stderr = appendBounded(stderr, chunk, MAX_STDERR_BYTES, "Codex stderr");
      } catch {
        child.kill("SIGKILL");
      }
    });
    child.stdin.end(prompt);

    const exitCode = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Codex subscription turn timed out."));
      }, timeoutMs);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });
    if (exitCode !== 0) {
      throw new Error(`Codex subscription turn failed with exit code ${exitCode}${stderr ? "." : ""}`);
    }

    const final = record(JSON.parse(await readFile(outputPath, "utf8")));
    const name = required(final.tool_name, "Codex tool name", 128);
    if (!tools.some((tool) => tool.name === name)) throw new Error("Codex selected a tool outside the allowed set.");
    let argumentsValue;
    try {
      argumentsValue = JSON.parse(required(final.arguments_json, "Codex tool arguments", 200_000));
    } catch {
      throw new Error("Codex tool arguments are not valid JSON.");
    }
    if (!argumentsValue || typeof argumentsValue !== "object" || Array.isArray(argumentsValue)) {
      throw new Error("Codex tool arguments must be an object.");
    }

    const events = stdout.split(/\r?\n/u).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
    const completed = [...events].reverse().find((event) => event?.type === "turn.completed");
    const usage = record(completed?.usage);
    return {
      call: {
        id: `codex-subscription:${randomUUID()}`,
        name,
        arguments: argumentsValue,
      },
      usage: {
        input_tokens: Math.max(0, Math.trunc(Number(usage.input_tokens ?? 0) || 0)),
        output_tokens: Math.max(0, Math.trunc(Number(usage.output_tokens ?? 0) || 0)),
      },
    };
  } finally {
    if (child && child.exitCode === null) child.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
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
  try {
    const turn = validateTurn(await requestBody(request));
    json(response, 200, await executeCodex(turn));
  } catch (error) {
    console.error(JSON.stringify({
      event: "turn_failed",
      error: error instanceof Error ? error.message : "Codex subscription turn failed.",
    }));
    json(response, 503, { error: "Codex subscription turn failed." });
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
