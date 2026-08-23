import { env } from "cloudflare:workers";
import { localP0E2EFixtureScenario } from "../../../lib/p0-e2e-boundary";
import {
  ownerOverview as productionOwnerOverview,
  submitOwnerAction as productionSubmitOwnerAction,
  userKey,
} from "../../../lib/p0";

function failure() {
  return {
    message: "Действие не выполнено. Обновите страницу и повторите текущее бизнес-решение.",
  };
}

function localFixtureScenario(request: Request) {
  return localP0E2EFixtureScenario(
    request.url,
    (env as unknown as { P0_E2E_FIXTURE_SCENARIO?: string })
      .P0_E2E_FIXTURE_SCENARIO,
  );
}

async function fixtureBackend(request: Request) {
  const scenario = localFixtureScenario(request);
  if (!scenario) return null;
  const fixture = await import("../../../lib/p0-e2e-runtime");
  const key = userKey(request);
  return {
    overview: () => fixture.fixtureOwnerOverview(scenario, key),
    applyAction: (payload: Record<string, unknown>) => fixture.fixtureSubmitOwnerAction(scenario, key, payload),
  };
}

export async function GET(request: Request) {
  try {
    const fixture = await fixtureBackend(request);
    const value = fixture
      ? await fixture.overview()
      : await productionOwnerOverview(userKey(request));
    return Response.json(value);
  } catch {
    return Response.json(failure(), { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const fixture = await fixtureBackend(request);
    const value = fixture
      ? await fixture.applyAction(payload)
      : await productionSubmitOwnerAction(userKey(request), payload);
    return Response.json(value, { status: 201 });
  } catch {
    return Response.json(failure(), { status: 409 });
  }
}
