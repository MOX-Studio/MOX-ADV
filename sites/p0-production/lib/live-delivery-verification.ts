import JSONbigFactory from "json-bigint";

import type { DirectConfig } from "./direct-write.ts";
import type { LiveDeliveryVerification } from "./p0-live-creation-acceptance.ts";

const JSONbig = JSONbigFactory({ useNativeBigInt: true });
const REPORT_ENDPOINT = "https://api.direct.yandex.com/json/v5/reports";

export class LiveDeliveryVerificationError extends Error {
  readonly code: string;
  readonly retry_in_seconds: number | null;

  constructor(code: string, message: string, retryInSeconds: number | null = null) {
    super(message);
    this.name = "LiveDeliveryVerificationError";
    this.code = code;
    this.retry_in_seconds = retryInSeconds;
  }
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`));
}

function reportNumber(value: string) {
  const normalized = value.trim().replaceAll(" ", "").replace(",", ".");
  const parsed = Number(normalized || "0");
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new LiveDeliveryVerificationError("P0_LIVE_DELIVERY_REPORT_INVALID", "Direct report contains an invalid non-negative metric.");
  }
  return parsed;
}

function parseReport(tsv: string, campaignId: string) {
  const rows = tsv.replace(/^\uFEFF/u, "").trim().split(/\r?\n/u).filter(Boolean);
  if (!rows.length) return { impressions: 0, spend_rub: 0 };
  const headers = rows[0].split("\t");
  const campaignIndex = headers.indexOf("CampaignId");
  const impressionsIndex = headers.indexOf("Impressions");
  const costIndex = headers.indexOf("Cost");
  if (campaignIndex < 0 || impressionsIndex < 0 || costIndex < 0) {
    throw new LiveDeliveryVerificationError("P0_LIVE_DELIVERY_REPORT_INVALID", "Direct report is missing CampaignId, Impressions, or Cost.");
  }
  let impressions = 0;
  let spendRub = 0;
  for (const line of rows.slice(1)) {
    const columns = line.split("\t");
    if (String(columns[campaignIndex] ?? "") !== campaignId) {
      throw new LiveDeliveryVerificationError("P0_LIVE_DELIVERY_REPORT_SCOPE_MISMATCH", "Direct report returned another campaign identity.");
    }
    impressions += reportNumber(columns[impressionsIndex] ?? "0");
    spendRub += reportNumber(columns[costIndex] ?? "0");
  }
  if (!Number.isSafeInteger(impressions)) {
    throw new LiveDeliveryVerificationError("P0_LIVE_DELIVERY_REPORT_INVALID", "Direct impressions are not a safe integer.");
  }
  return { impressions, spend_rub: spendRub };
}

export async function readLiveDeliveryVerification(input: {
  itemExecutionId: string;
  campaignId: string;
  config: DirectConfig;
  dateFrom: string;
  dateTo: string;
  fetcher?: typeof fetch;
  observedAt?: string;
}): Promise<LiveDeliveryVerification> {
  if (!input.config.token || !input.config.account) {
    throw new LiveDeliveryVerificationError("P0_WRITE_CREDENTIAL_MISSING", "Direct credentials are not configured for the bounded report read.");
  }
  if (!/^\d+$/u.test(input.campaignId) || !input.itemExecutionId.trim()) {
    throw new LiveDeliveryVerificationError("P0_LIVE_DELIVERY_SCOPE_INVALID", "Exact campaign and item execution identities are required.");
  }
  if (!validDate(input.dateFrom) || !validDate(input.dateTo) || input.dateFrom > input.dateTo) {
    throw new LiveDeliveryVerificationError("P0_LIVE_DELIVERY_SCOPE_INVALID", "Direct report date range is invalid.");
  }
  const response = await (input.fetcher ?? fetch)(REPORT_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.config.token}`,
      "Client-Login": input.config.account,
      Accept: "text/tab-separated-values",
      "Accept-Language": "ru",
      "Content-Type": "application/json; charset=utf-8",
      processingMode: "auto",
      returnMoneyInMicros: "false",
      skipReportHeader: "true",
      skipColumnHeader: "false",
      skipReportSummary: "true",
    },
    body: JSONbig.stringify({
      params: {
        SelectionCriteria: {
          DateFrom: input.dateFrom,
          DateTo: input.dateTo,
          Filter: [{ Field: "CampaignId", Operator: "EQUALS", Values: [BigInt(input.campaignId)] }],
        },
        FieldNames: ["CampaignId", "Impressions", "Cost"],
        ReportName: `MOX ADV P0 live acceptance ${input.itemExecutionId.slice(0, 40)}`,
        ReportType: "CAMPAIGN_PERFORMANCE_REPORT",
        DateRangeType: "CUSTOM_DATE",
        Format: "TSV",
        IncludeVAT: "YES",
        IncludeDiscount: "NO",
      },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (response.status === 201 || response.status === 202) {
    const retry = Number(response.headers.get("retryIn") ?? response.headers.get("Retry-In") ?? "60");
    throw new LiveDeliveryVerificationError(
      "P0_LIVE_DELIVERY_REPORT_PENDING",
      "Direct accepted the bounded delivery report but it is not ready yet.",
      Number.isFinite(retry) && retry > 0 ? retry : 60,
    );
  }
  if (!response.ok) {
    throw new LiveDeliveryVerificationError("P0_LIVE_DELIVERY_REPORT_FAILED", `Direct delivery report returned HTTP ${response.status}.`);
  }
  const metrics = parseReport(await response.text(), input.campaignId);
  return {
    item_execution_id: input.itemExecutionId,
    source: "YANDEX_DIRECT_REPORTS_API",
    observed_at: input.observedAt ?? new Date().toISOString(),
    ...metrics,
  };
}
