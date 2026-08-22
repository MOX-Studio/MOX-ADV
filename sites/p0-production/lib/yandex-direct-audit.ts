import JSONbig from "json-bigint";

import {
  DirectAuditProviderError,
  type DirectAuditCollection,
  type DirectAuditGetPageInput,
  type DirectAuditGetPageResult,
  type DirectAuditReadProvider,
  type DirectAuditReportDefinition,
  type DirectAuditReportResult,
} from "./direct-audit.ts";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const DIRECT_COLLECTION_SERVICES: Record<DirectAuditCollection, string> = {
  campaigns: "Campaigns",
  adgroups: "AdGroups",
  audiencetargets: "AudienceTargets",
  keywords: "Keywords",
  ads: "Ads",
  sitelinks: "Sitelinks",
  adimages: "AdImages",
  vcards: "VCards",
  creatives: "Creatives",
  adextensions: "AdExtensions",
};

const codec = JSONbig({ useNativeBigInt: true, alwaysParseAsBig: true });

function required(value: string, label: string) {
  const result = value.trim();
  if (!result) throw new Error(`${label} is required for Direct read authority.`);
  return result;
}

function safeJson(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(safeJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, safeJson(item)]));
}

function directRequestValue(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => (/Ids?$/u.test(key) && typeof item === "string" && /^\d+$/u.test(item))
      ? BigInt(item)
      : directRequestValue(item, key));
  }
  if (!value || typeof value !== "object") {
    if (/Id$/u.test(key) && typeof value === "string" && /^\d+$/u.test(value)) return BigInt(value);
    return value;
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, item]) => [
    childKey,
    directRequestValue(item, childKey),
  ]));
}

function header(response: Response, name: string) {
  return response.headers.get(name) ?? response.headers.get(name.toLowerCase());
}

function retryMilliseconds(response: Response, name: "retryIn" | "Retry-After") {
  const raw = header(response, name);
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1_000) : null;
}

function retryAt(nowValue: string, milliseconds: number | null) {
  const timestamp = Date.parse(nowValue);
  const delay = milliseconds ?? 5_000;
  return new Date(timestamp + delay).toISOString();
}

function providerMessage(payload: Record<string, unknown>) {
  const error = payload.error && typeof payload.error === "object" && !Array.isArray(payload.error)
    ? payload.error as Record<string, unknown>
    : {};
  return String(error.error_detail ?? error.error_string ?? error.message ?? "Direct API rejected the read request.");
}

function warningItems(value: unknown, output: Array<{ code: string; message: string }> = []) {
  if (Array.isArray(value)) {
    for (const item of value) warningItems(item, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "Warnings" && Array.isArray(item)) {
      for (const rawWarning of item) {
        const warning = rawWarning && typeof rawWarning === "object" && !Array.isArray(rawWarning)
          ? rawWarning as Record<string, unknown>
          : {};
        output.push({
          code: String(warning.Code ?? warning.code ?? "DIRECT_WARNING").slice(0, 100),
          message: String(warning.Details ?? warning.Message ?? warning.message ?? "Direct provider warning").slice(0, 500),
        });
      }
    } else {
      warningItems(item, output);
    }
  }
  return output;
}

async function parsedDirectJson(response: Response) {
  const raw = await response.text();
  try {
    return safeJson(codec.parse(raw)) as Record<string, unknown>;
  } catch {
    throw new DirectAuditProviderError({
      code: "DIRECT_RESPONSE_INVALID",
      message: "Direct API returned invalid JSON for a read operation.",
      disposition: "UNAVAILABLE",
      retry_at: null,
    });
  }
}

function classifyHttp(response: Response, nowValue: string): never {
  if (response.status === 429) {
    throw new DirectAuditProviderError({
      code: "DIRECT_RATE_LIMITED",
      message: "Direct read quota is temporarily exhausted.",
      disposition: "RETRYABLE",
      retry_at: retryAt(nowValue, retryMilliseconds(response, "Retry-After")),
    });
  }
  if (response.status === 403 || response.status === 401) {
    throw new DirectAuditProviderError({
      code: "DIRECT_PARTIAL_PERMISSION",
      message: `Direct read authority does not permit this operation (HTTP ${response.status}).`,
      disposition: "UNAVAILABLE",
      retry_at: null,
    });
  }
  if (response.status >= 500) {
    throw new DirectAuditProviderError({
      code: "DIRECT_TEMPORARY_FAILURE",
      message: `Direct API temporarily failed a safe read (HTTP ${response.status}).`,
      disposition: "RETRYABLE",
      retry_at: retryAt(nowValue, retryMilliseconds(response, "Retry-After")),
    });
  }
  throw new DirectAuditProviderError({
    code: "DIRECT_READ_REJECTED",
    message: `Direct API rejected a safe read (HTTP ${response.status}).`,
    disposition: "UNAVAILABLE",
    retry_at: null,
  });
}

export class YandexDirectReadApi implements DirectAuditReadProvider {
  private readonly token: string;
  private readonly account: string;
  private readonly fetcher: FetchLike;
  private readonly now: () => string;

  constructor(input: {
    token: string;
    account: string;
    fetcher: FetchLike;
    now: () => string;
  }) {
    this.token = required(input.token, "Direct OAuth token");
    this.account = required(input.account, "Direct advertiser account");
    this.fetcher = input.fetcher;
    this.now = input.now;
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      "Client-Login": this.account,
      Accept: "application/json",
      "Accept-Language": "ru",
      "Content-Type": "application/json; charset=utf-8",
    };
  }

  async getPage(input: DirectAuditGetPageInput): Promise<DirectAuditGetPageResult> {
    const expectedService = DIRECT_COLLECTION_SERVICES[input.collection];
    if (input.semantic_method !== "get" || !expectedService || input.service !== expectedService) {
      throw new DirectAuditProviderError({
        code: "DIRECT_METHOD_NOT_ALLOWED",
        message: "Direct audit adapter permits only its closed read-only get operations.",
        disposition: "UNAVAILABLE",
        retry_at: null,
      });
    }
    const endpoint = `https://api.direct.yandex.com/json/v501/${expectedService.toLowerCase()}`;
    let response: Response;
    try {
      response = await this.fetcher(endpoint, {
        method: "POST",
        headers: this.headers(),
        body: codec.stringify({ method: "get", params: directRequestValue(input.params) }),
      });
    } catch {
      throw new DirectAuditProviderError({
        code: "DIRECT_TEMPORARY_FAILURE",
        message: "Direct API network read failed temporarily.",
        disposition: "RETRYABLE",
        retry_at: retryAt(this.now(), 5_000),
      });
    }
    if (!response.ok) classifyHttp(response, this.now());
    const payload = await parsedDirectJson(response);
    if (payload.error) {
      throw new DirectAuditProviderError({
        code: "DIRECT_READ_REJECTED",
        message: providerMessage(payload),
        disposition: "UNAVAILABLE",
        retry_at: null,
      });
    }
    const result = payload.result && typeof payload.result === "object" && !Array.isArray(payload.result)
      ? payload.result as Record<string, unknown>
      : {};
    const objects = result[input.result_key];
    if (!Array.isArray(objects)) {
      throw new DirectAuditProviderError({
        code: "DIRECT_RESPONSE_INVALID",
        message: `${input.service}.get did not return result.${input.result_key}.`,
        disposition: "UNAVAILABLE",
        retry_at: null,
      });
    }
    const limitedByValue = result.LimitedBy;
    const limitedBy = limitedByValue === null || limitedByValue === undefined
      ? null
      : Number(limitedByValue);
    if (limitedBy !== null && !Number.isSafeInteger(limitedBy)) {
      throw new DirectAuditProviderError({
        code: "DIRECT_RESPONSE_INVALID",
        message: `${input.service}.get returned an invalid LimitedBy cursor.`,
        disposition: "UNAVAILABLE",
        retry_at: null,
      });
    }
    return {
      objects: objects.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)),
      limited_by: limitedBy,
      warnings: warningItems(payload).slice(0, 100),
      request_id: header(response, "RequestId"),
      units: header(response, "Units"),
    };
  }

  async requestReport(definition: DirectAuditReportDefinition): Promise<DirectAuditReportResult> {
    if (!["auto", "offline"].includes(definition.processing_mode)) {
      throw new DirectAuditProviderError({
        code: "DIRECT_METHOD_NOT_ALLOWED",
        message: "Direct report audit permits only auto or offline read processing.",
        disposition: "UNAVAILABLE",
        retry_at: null,
      });
    }
    let response: Response;
    try {
      response = await this.fetcher("https://api.direct.yandex.com/json/v5/reports", {
        method: "POST",
        headers: {
          ...this.headers(),
          processingMode: definition.processing_mode,
          returnMoneyInMicros: "false",
          skipReportHeader: "true",
          skipColumnHeader: "false",
          skipReportSummary: "true",
        },
        body: JSON.stringify(definition.request),
      });
    } catch {
      throw new DirectAuditProviderError({
        code: "DIRECT_TEMPORARY_FAILURE",
        message: "Direct Reports API network read failed temporarily.",
        disposition: "RETRYABLE",
        retry_at: retryAt(this.now(), 5_000),
      });
    }
    if (![200, 201, 202].includes(response.status)) classifyHttp(response, this.now());
    const body = response.status === 200 ? await response.text() : null;
    return {
      http_status: response.status as 200 | 201 | 202,
      retry_in_ms: response.status === 200 ? null : retryMilliseconds(response, "retryIn"),
      body,
      warnings: [],
      request_id: header(response, "RequestId"),
      units: header(response, "Units"),
    };
  }
}
