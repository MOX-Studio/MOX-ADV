import type {
  LandingBrowserPolicy,
  LandingInspectionViewport,
  LandingPageInspection,
} from "./landing-advisory.ts";

export const DESTINATION_INSPECTION_CONTRACT_VERSION = "p0-destination-headless-playwright-v1";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface DestinationReadinessAdapter {
  availability: { available: boolean; reason: string | null };
  resolveHostname(hostname: string, signal: AbortSignal): Promise<string[]>;
  version(signal: AbortSignal): Promise<string>;
  inspect(input: {
    url: string;
    viewport: LandingInspectionViewport;
    policy: LandingBrowserPolicy;
    signal: AbortSignal;
  }): Promise<LandingPageInspection>;
}

function loopbackUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.hostname === "127.0.0.1" ? url : null;
  } catch {
    return null;
  }
}

async function jsonResponse(response: Response) {
  if (!response.ok) throw new Error(`Destination inspection bridge returned HTTP ${response.status}.`);
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Destination inspection bridge response is invalid.");
  return value as Record<string, unknown>;
}

export class LoopbackDestinationReadinessAdapter implements DestinationReadinessAdapter {
  readonly availability: DestinationReadinessAdapter["availability"];
  private readonly baseUrl: URL | null;
  private readonly token: string;
  private readonly fetcher: Fetcher;

  constructor(input: { url?: string; token?: string; fetcher?: Fetcher }) {
    this.baseUrl = loopbackUrl(String(input.url ?? ""));
    this.token = String(input.token ?? "").trim();
    this.fetcher = input.fetcher ?? fetch;
    this.availability = this.baseUrl && this.token
      ? { available: true, reason: null }
      : { available: false, reason: "Isolated destination inspection bridge is not configured." };
  }

  private async call(path: string, body: Record<string, unknown>, signal: AbortSignal) {
    if (!this.baseUrl || !this.token) throw new Error("DESTINATION_INSPECTION_UNAVAILABLE");
    const url = new URL(path, this.baseUrl);
    return jsonResponse(await this.fetcher(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      redirect: "manual",
      signal,
    }));
  }

  async version(signal: AbortSignal) {
    const response = await this.call("/version", {}, signal);
    return String(response.version ?? "");
  }

  async resolveHostname(hostname: string, signal: AbortSignal) {
    const response = await this.call("/resolve", { hostname }, signal);
    return Array.isArray(response.addresses) ? response.addresses.map(String) : [];
  }

  async inspect(input: {
    url: string;
    viewport: LandingInspectionViewport;
    policy: LandingBrowserPolicy;
    signal: AbortSignal;
  }) {
    const response = await this.call("/inspect", {
      url: input.url,
      viewport: input.viewport,
      policy: {
        version: input.policy.version,
        allowed_hosts: input.policy.allowed_hosts,
        bound_addresses: Object.fromEntries(
          input.policy.allowed_hosts.map((hostname) => [hostname, input.policy.boundAddresses(hostname)]),
        ),
        maximum_response_bytes: input.policy.profile.maximum_response_bytes,
      },
    }, input.signal);
    const inspection = response.inspection;
    if (!inspection || typeof inspection !== "object" || Array.isArray(inspection)) {
      throw new Error("Destination inspection bridge omitted the inspection artifact.");
    }
    return inspection as LandingPageInspection;
  }
}
