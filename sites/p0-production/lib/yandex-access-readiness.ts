import type {
  AccessBindingVerification,
  AccessDiscovery,
  AccessReadinessAdapter,
} from "./access-readiness.ts";
import { cleanText } from "./text.ts";
import { validateWordstatProviderScope } from "./market-evidence.ts";
import {
  verifyDirectAccountBinding,
  verifyMetrikaCounterBinding,
} from "./yandex-context.ts";

type Fetcher = typeof fetch;

type YandexAccessConfiguration = {
  directToken: string;
  directExpectedAccount?: string;
  directCampaignId?: string;
  directBusinessLabel?: string;
  metrikaToken: string;
  metrikaExpectedCounterId?: string;
  metrikaGoalId: string;
  wordstatUiBridgeUrl: string;
  wordstatUiBridgeToken: string;
  wordstatRegionIds: unknown[];
  wordstatRegionNames: unknown[];
  wordstatDevice: unknown;
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
      this.verifyDirectReadBinding(input.accountIdentity),
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
        matched: directValue?.matched === true && directValue.account === input.accountIdentity,
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
    if (payload.error) {
      const error = record(payload.error);
      if (Number(error.error_code) === 3228) return this.discoverConfiguredDirectAccount();
      throw new Error("Direct official API rejected account discovery.");
    }
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

  private async discoverConfiguredDirectAccount() {
    const account = cleanText(this.configuration.directExpectedAccount ?? "", 255);
    const campaignId = cleanText(this.configuration.directCampaignId ?? "", 100);
    if (!account || !campaignId) {
      throw new Error("Direct Pro unavailable and exact configured campaign read proof is not configured.");
    }
    await this.verifyConfiguredDirectCampaignRead(account, campaignId);
    return [{
      provider_identity: account,
      label: cleanText(this.configuration.directBusinessLabel || "Основной рекламный аккаунт", 255),
      detail: "Доступная реклама этого бизнеса",
    }];
  }

  private async verifyDirectReadBinding(accountIdentity: string) {
    const expectedAccount = cleanText(this.configuration.directExpectedAccount ?? "", 255);
    if (expectedAccount && accountIdentity !== expectedAccount) {
      throw new Error("Selected Direct account does not match the exact server-side binding.");
    }
    try {
      const verified = await verifyDirectAccountBinding({
        token: this.configuration.directToken,
        expectedAccount: accountIdentity,
      }, this.fetcher, this.now);
      return { account: verified.account, matched: verified.binding.matched };
    } catch {
      const campaignId = cleanText(this.configuration.directCampaignId ?? "", 100);
      if (!expectedAccount || !campaignId) throw new Error("Direct read binding is unavailable.");
      await this.verifyConfiguredDirectCampaignRead(accountIdentity, campaignId);
      return { account: accountIdentity, matched: true as const };
    }
  }

  private async verifyConfiguredDirectCampaignRead(account: string, campaignId: string) {
    if (!this.configuration.directToken) throw new Error("Direct server credential is unavailable.");
    const payload = await jsonResponse(await this.fetcher("https://api.direct.yandex.com/json/v501/campaigns", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.configuration.directToken}`,
        "Client-Login": account,
        Accept: "application/json",
        "Accept-Language": "ru",
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        method: "get",
        params: {
          SelectionCriteria: { Ids: [campaignId] },
          FieldNames: ["Id", "Type", "Status", "State"],
        },
      }),
    }), "Direct");
    if (payload.error) throw new Error("Direct official API rejected configured campaign read proof.");
    const campaigns = list(record(payload.result).Campaigns)
      .map(record)
      .filter((campaign) => String(campaign.Id ?? "") === campaignId);
    if (campaigns.length !== 1) throw new Error("Direct official API did not confirm the exact configured campaign.");
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
    validateWordstatProviderScope({
      regionIds: this.configuration.wordstatRegionIds,
      regionNames: this.configuration.wordstatRegionNames,
      device: this.configuration.wordstatDevice,
    });
    if (!this.configuration.wordstatUiBridgeUrl || !this.configuration.wordstatUiBridgeToken) {
      throw new Error("Headless Wordstat UI bridge is unavailable.");
    }
    const url = new URL(this.configuration.wordstatUiBridgeUrl);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
      throw new Error("Headless Wordstat UI bridge must use loopback HTTP.");
    }
    const health = new URL("/health", url);
    const payload = await jsonResponse(await this.fetcher(health, {
      method: "GET",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${this.configuration.wordstatUiBridgeToken}`,
        Accept: "application/json",
      },
    }), "Wordstat UI bridge");
    if (payload.ok !== true || payload.provider !== "yandex-wordstat-ui" || payload.transport !== "HEADLESS_PLAYWRIGHT") {
      throw new Error("Headless Wordstat UI bridge did not confirm its production transport.");
    }
  }
}
