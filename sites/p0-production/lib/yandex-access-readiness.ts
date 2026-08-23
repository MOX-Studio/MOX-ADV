import type {
  AccessBindingVerification,
  AccessDiscovery,
  AccessReadinessAdapter,
} from "./access-readiness.ts";
import { cleanText } from "./text.ts";
import {
  verifyDirectAccountBinding,
  verifyMetrikaCounterBinding,
} from "./yandex-context.ts";

type Fetcher = typeof fetch;

type YandexAccessConfiguration = {
  directToken: string;
  directExpectedAccount?: string;
  directBusinessLabel?: string;
  metrikaToken: string;
  metrikaExpectedCounterId?: string;
  metrikaGoalId: string;
  wordstatToken: string;
  wordstatClientId: string;
};

async function jsonResponse(response: Response, label: string) {
  if (!response.ok) throw new Error(`${label} official API returned HTTP ${response.status}.`);
  return response.json() as Promise<Record<string, unknown>>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export class YandexAccessReadinessAdapter implements AccessReadinessAdapter {
  private readonly configuration: YandexAccessConfiguration;
  private readonly fetcher: Fetcher;
  private readonly now: () => string;

  constructor(
    configuration: YandexAccessConfiguration,
    fetcher: Fetcher = fetch,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.configuration = configuration;
    this.fetcher = fetcher;
    this.now = now;
  }

  async discover(): Promise<AccessDiscovery> {
    const [direct, metrika, wordstat] = await Promise.allSettled([
      this.discoverDirectAccounts(),
      this.discoverMetrikaCounters(),
      this.verifyWordstatScope(),
    ]);
    return {
      scopes: {
        direct: { granted: direct.status === "fulfilled" },
        metrika: { granted: metrika.status === "fulfilled" },
        wordstat: { granted: wordstat.status === "fulfilled" },
      },
      accounts: direct.status === "fulfilled" ? direct.value : [],
      counters: metrika.status === "fulfilled" ? metrika.value : [],
    };
  }

  async verifyBinding(input: { accountIdentity: string; counterIdentity: string }): Promise<AccessBindingVerification> {
    const direct = await Promise.allSettled([
      verifyDirectAccountBinding({
        token: this.configuration.directToken,
        expectedAccount: input.accountIdentity,
      }, this.fetcher, this.now),
      verifyMetrikaCounterBinding({
        token: this.configuration.metrikaToken,
        expectedCounterId: input.counterIdentity,
        expectedGoalId: this.configuration.metrikaGoalId,
      }, this.fetcher, this.now),
      this.verifyWordstatScope(),
    ]);
    const directValue = direct[0].status === "fulfilled" ? direct[0].value : null;
    const metrikaValue = direct[1].status === "fulfilled" ? direct[1].value : null;
    return {
      direct: {
        matched: directValue?.binding.matched === true && directValue.account === input.accountIdentity,
        scope_granted: direct[0].status === "fulfilled",
      },
      metrika: {
        matched: metrikaValue?.binding.matched === true && metrikaValue.counter_id === input.counterIdentity,
        scope_granted: direct[1].status === "fulfilled",
      },
      wordstat: { scope_granted: direct[2].status === "fulfilled" },
    };
  }

  private async discoverDirectAccounts() {
    if (!this.configuration.directToken) throw new Error("Direct server credential is unavailable.");
    const payload = await jsonResponse(await this.fetcher("https://api.direct.yandex.com/json/v501/clients", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.configuration.directToken}`,
        Accept: "application/json",
        "Accept-Language": "ru",
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ method: "get", params: { FieldNames: ["Login", "ClientInfo"] } }),
    }), "Direct");
    if (payload.error) throw new Error("Direct official API rejected account discovery.");
    return list(record(payload.result).Clients).map((value) => {
      const client = record(value);
      const identity = cleanText(String(client.Login ?? ""), 255);
      const apiLabel = cleanText(String(client.ClientInfo ?? ""), 255);
      return {
        provider_identity: identity,
        label: apiLabel || cleanText(this.configuration.directBusinessLabel ?? "Основной рекламный аккаунт", 255),
        detail: "Доступная реклама этого бизнеса",
      };
    }).filter((choice) => choice.provider_identity
      && (!this.configuration.directExpectedAccount
        || choice.provider_identity === this.configuration.directExpectedAccount));
  }

  private async discoverMetrikaCounters() {
    if (!this.configuration.metrikaToken) throw new Error("Metrika server credential is unavailable.");
    const payload = await jsonResponse(await this.fetcher("https://api-metrika.yandex.net/management/v1/counters", {
      headers: { Authorization: `OAuth ${this.configuration.metrikaToken}`, Accept: "application/json" },
    }), "Metrika");
    return list(payload.counters).map((value) => {
      const counter = record(value);
      const identity = cleanText(String(counter.id ?? ""), 100);
      const site = cleanText(String(counter.site ?? ""), 255);
      const name = cleanText(String(counter.name ?? ""), 255);
      return {
        provider_identity: identity,
        label: name || site || "Основной сайт",
        detail: site ? `Аналитика сайта ${site}` : "Доступная аналитика бизнеса",
      };
    }).filter((choice) => choice.provider_identity
      && (!this.configuration.metrikaExpectedCounterId
        || choice.provider_identity === this.configuration.metrikaExpectedCounterId));
  }

  private async verifyWordstatScope() {
    if (!this.configuration.wordstatToken || !this.configuration.wordstatClientId) {
      throw new Error("Wordstat server credential is unavailable.");
    }
    await jsonResponse(await this.fetcher("https://api.wordstat.yandex.net/v1/regions", {
      headers: {
        Authorization: `Bearer ${this.configuration.wordstatToken}`,
        "Client-Id": this.configuration.wordstatClientId,
        Accept: "application/json",
      },
    }), "Wordstat");
  }
}
