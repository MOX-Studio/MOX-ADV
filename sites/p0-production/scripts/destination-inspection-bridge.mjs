#!/usr/bin/env node

import { timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createServer } from "node:http";
import { isIP } from "node:net";

import { chromium } from "playwright-core";

const CONTRACT_VERSION = "p0-destination-headless-playwright-v1";
const POLICY_VERSION = "first-party-public-advisory-browser-v1";
const CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MAX_BODY_BYTES = 100_000;
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

function publicAddress(value) {
  if (isIP(value) === 4) {
    const [a, b] = value.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19)));
  }
  if (isIP(value) === 6) {
    const normalized = value.toLowerCase();
    return normalized !== "::" && normalized !== "::1"
      && !normalized.startsWith("fc") && !normalized.startsWith("fd")
      && !normalized.startsWith("fe8") && !normalized.startsWith("fe9")
      && !normalized.startsWith("fea") && !normalized.startsWith("feb")
      && !normalized.startsWith("2001:db8:");
  }
  return false;
}

function cleanText(value, maximum = 4_000) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, maximum);
}

function validHostname(value) {
  const hostname = required(value, "Hostname", 253).toLowerCase();
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/u.test(hostname)) {
    throw new Error("Hostname is invalid.");
  }
  return hostname;
}

function safeUrl(value, allowedHosts) {
  const url = new URL(required(value, "URL", 2_000));
  if (url.protocol !== "https:" || url.username || url.password || !allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new Error("URL is outside the read-only public destination scope.");
  }
  if ([...url.searchParams.keys()].some((key) => /(?:token|secret|password|oauth|auth|api[_-]?key)/iu.test(key))) {
    throw new Error("URL contains sensitive query material.");
  }
  return url;
}

async function resolvePublic(hostname) {
  const rows = await lookup(validHostname(hostname), { all: true, verbatim: true });
  const addresses = [...new Set(rows.map((row) => row.address).filter(publicAddress))].sort();
  if (!addresses.length) throw new Error("Hostname has no public address.");
  return addresses;
}

function json(response, status, value) {
  const payload = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  response.end(payload);
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request body is invalid.");
  return value;
}

function authorized(request, bridgeToken) {
  const actual = Buffer.from(request.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${bridgeToken}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function inspect(input) {
  const policy = input.policy;
  if (!policy || typeof policy !== "object" || Array.isArray(policy) || policy.version !== POLICY_VERSION) {
    throw new Error("Destination policy is invalid.");
  }
  const allowedHosts = Array.isArray(policy.allowed_hosts)
    ? [...new Set(policy.allowed_hosts.map(validHostname))].sort()
    : [];
  if (!allowedHosts.length || allowedHosts.length > 4) throw new Error("Destination host scope is invalid.");
  const requestedUrl = safeUrl(input.url, allowedHosts).toString();
  const boundAddresses = {};
  for (const hostname of allowedHosts) {
    const declared = Array.isArray(policy.bound_addresses?.[hostname])
      ? policy.bound_addresses[hostname].map(String)
      : [];
    const current = await resolvePublic(hostname);
    if (!declared.length || declared.some((address) => !publicAddress(address)) || !current.some((address) => declared.includes(address))) {
      throw new Error("Destination DNS binding changed or is invalid.");
    }
    boundAddresses[hostname] = [...new Set(declared)].sort();
  }
  const maximumResponseBytes = integer(policy.maximum_response_bytes, "Maximum response bytes", 1, 5_000_000);
  const viewport = input.viewport;
  const formFactor = viewport?.form_factor === "mobile" ? "mobile" : viewport?.form_factor === "desktop" ? "desktop" : "";
  if (!formFactor) throw new Error("Viewport is invalid.");
  const width = integer(viewport.width, "Viewport width", 320, 4_000);
  const height = integer(viewport.height, "Viewport height", 320, 4_000);
  const deviceScaleFactor = Number(viewport.device_scale_factor);
  if (![1, 3].includes(deviceScaleFactor)) throw new Error("Device scale factor is invalid.");

  const resolverRules = allowedHosts.map((hostname) => {
    const address = boundAddresses[hostname].find((item) => isIP(item) === 4) ?? boundAddresses[hostname][0];
    return `MAP ${hostname} ${address}`;
  }).join(",");
  const browser = await chromium.launch({
    executablePath: CHROME_EXECUTABLE,
    headless: true,
    args: [`--host-resolver-rules=${resolverRules}`, "--disable-background-networking"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor,
      isMobile: formFactor === "mobile",
      hasTouch: formFactor === "mobile",
      javaScriptEnabled: true,
      ignoreHTTPSErrors: false,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const networkRequests = [];
    await page.route("**/*", async (route) => {
      const request = route.request();
      let url;
      try {
        url = safeUrl(request.url(), allowedHosts);
      } catch {
        await route.abort("blockedbyclient");
        return;
      }
      const method = request.method().toUpperCase();
      if (!['GET', 'HEAD'].includes(method) || request.postData() !== null) {
        await route.abort("blockedbyclient");
        return;
      }
      networkRequests.push({
        url: url.toString(),
        method,
        resource_type: request.resourceType(),
        headers: {},
        body_present: false,
        resolved_addresses: boundAddresses[url.hostname.toLowerCase()],
      });
      await route.continue();
    });
    const response = await page.goto(requestedUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (!response) throw new Error("Destination returned no document response.");
    const finalUrl = safeUrl(page.url(), allowedHosts).toString();
    const contentLength = Number(response.headers()["content-length"] ?? 0);
    if (Number.isFinite(contentLength) && contentLength > maximumResponseBytes) throw new Error("Destination response is too large.");
    const responseBody = await response.body();
    if (responseBody.length > maximumResponseBytes) throw new Error("Destination response is too large.");
    const redirectChain = [];
    let redirected = response.request();
    while (redirected) {
      redirectChain.unshift(safeUrl(redirected.url(), allowedHosts).toString());
      redirected = redirected.redirectedFrom();
    }
    const pageArtifact = await page.evaluate(() => {
      const label = (element) => String(element.innerText || element.getAttribute("aria-label") || element.getAttribute("value") || "").replace(/\s+/g, " ").trim();
      const ctas = [...document.querySelectorAll("a,button,input[type='submit'],input[type='button']")]
        .map((element) => ({ label: label(element).slice(0, 300), kind: element.tagName.toLowerCase() }))
        .filter((item) => item.label)
        .slice(0, 50);
      const forms = [...document.querySelectorAll("form")].slice(0, 20).map((form) => ({
        method: String(form.getAttribute("method") || "GET").toUpperCase(),
        action_kind: form.getAttribute("action") ? "DECLARED" : "CURRENT_PAGE",
        fields_count: form.querySelectorAll("input,select,textarea,button").length,
      }));
      const markup = document.documentElement?.outerHTML || "";
      return {
        title: document.title,
        headings: [...document.querySelectorAll("h1,h2,h3")].map(label).filter(Boolean).slice(0, 50),
        text_excerpt: String(document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 12_000),
        ctas,
        forms,
        metrika_tag_detected: /mc\.yandex|ym\s*\(|metrika/iu.test(markup),
      };
    });
    return {
      requested_url: requestedUrl,
      final_url: finalUrl,
      redirect_chain: redirectChain.length ? redirectChain : [requestedUrl],
      network_requests: networkRequests.slice(0, 500),
      response_bytes: responseBody.length,
      page: {
        title: cleanText(pageArtifact.title, 500),
        headings: pageArtifact.headings.map((item) => cleanText(item, 500)),
        text_excerpt: cleanText(pageArtifact.text_excerpt, 12_000),
        ctas: pageArtifact.ctas.map((item) => ({ label: cleanText(item.label, 300), kind: cleanText(item.kind, 50) })),
        forms: pageArtifact.forms,
        metrika_tag_detected: Boolean(pageArtifact.metrika_tag_detected),
        http_status: response.status(),
        content_type: cleanText(response.headers()["content-type"], 200),
      },
    };
  } finally {
    await browser.close();
  }
}

const host = required(process.env.P0_DESTINATION_BRIDGE_HOST ?? "127.0.0.1", "Bridge host", 100);
if (host !== "127.0.0.1") throw new Error("Destination inspection bridge must bind to 127.0.0.1.");
const port = integer(process.env.P0_DESTINATION_BRIDGE_PORT ?? "19247", "Bridge port", 1, 65_535);
const bridgeToken = required(process.env.P0_DESTINATION_BRIDGE_TOKEN, "Bridge token", 1_000);

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || !["/version", "/resolve", "/inspect"].includes(request.url ?? "")) {
    json(response, 404, { error: "Not found." });
    return;
  }
  if (!authorized(request, bridgeToken)) {
    json(response, 401, { error: "Unauthorized." });
    return;
  }
  if (active && request.url === "/inspect") {
    json(response, 409, { error: "A destination inspection is already active." });
    return;
  }
  try {
    const input = await body(request);
    if (request.url === "/version") {
      json(response, 200, { version: CONTRACT_VERSION });
      return;
    }
    if (request.url === "/resolve") {
      json(response, 200, { addresses: await resolvePublic(input.hostname) });
      return;
    }
    active = true;
    json(response, 200, { inspection: await inspect(input) });
  } catch {
    json(response, 502, { error: "Destination inspection failed closed." });
  } finally {
    if (request.url === "/inspect") active = false;
  }
});

server.requestTimeout = 2 * 60 * 1_000;
server.headersTimeout = 2 * 60 * 1_000 + 5_000;
server.listen(port, host, () => {
  process.stdout.write(`Destination inspection bridge listening on http://${host}:${port}\n`);
});
