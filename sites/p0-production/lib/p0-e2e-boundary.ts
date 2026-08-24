export const P0_E2E_FIXTURE_SCENARIO = "mixed-correction";
export const P0_E2E_WORDSTAT_SCENARIOS = [
  P0_E2E_FIXTURE_SCENARIO,
  "mixed-correction-wordstat-partial",
  "mixed-correction-wordstat-quota-exhausted",
  "mixed-correction-wordstat-unavailable",
] as const;
export type P0E2EFixtureScenario = typeof P0_E2E_WORDSTAT_SCENARIOS[number];

export function localP0E2EFixtureScenario(
  requestUrl: string,
  configuredScenario: string | undefined,
) {
  const scenario = configuredScenario?.trim();
  if (!P0_E2E_WORDSTAT_SCENARIOS.includes(scenario as P0E2EFixtureScenario)) return null;
  const hostname = new URL(requestUrl).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1"
    ? scenario
    : null;
}
