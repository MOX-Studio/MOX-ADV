import assert from "node:assert/strict";
import test from "node:test";

import { resolveHostnameWithDnsJson } from "../lib/public-dns.ts";

test("DNS preflight uses edge-compatible manual redirects and returns A/AAAA answers", async () => {
  const calls = [];
  const fetchDns = async (input, init) => {
    calls.push({ input: String(input), init });
    if (init?.redirect === "error") {
      throw new TypeError('Invalid redirect value: "error"');
    }
    const type = new URL(String(input)).searchParams.get("type");
    return Response.json({
      Status: 0,
      Answer: type === "A"
        ? [{ type: 1, data: "93.184.216.34" }]
        : [{ type: 28, data: "2606:2800:220:1:248:1893:25c8:1946" }],
    });
  };

  const addresses = await resolveHostnameWithDnsJson("example.com", fetchDns);

  assert.deepEqual(addresses, ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({ init }) => init?.redirect), ["manual", "manual"]);
  assert.ok(calls.every(({ init }) => init?.headers?.Accept === "application/dns-json"));
});

test("DNS preflight rejects redirects instead of following them", async () => {
  const fetchDns = async () => new Response(null, {
    status: 302,
    headers: { Location: "https://example.net/dns-query" },
  });

  await assert.rejects(
    resolveHostnameWithDnsJson("example.com", fetchDns),
    /DNS safety preflight недоступен/u,
  );
});
