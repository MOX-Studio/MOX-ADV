type DnsJsonFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type DnsJsonResponse = {
  Status?: number;
  Answer?: Array<{ type?: number; data?: string }>;
};

export async function resolveHostnameWithDnsJson(
  hostname: string,
  fetchDns: DnsJsonFetch,
): Promise<string[]> {
  const responses = await Promise.all(["A", "AAAA"].map(async (type) => {
    const query = new URLSearchParams({ name: hostname, type });
    const response = await fetchDns(`https://cloudflare-dns.com/dns-query?${query}`, {
      headers: { Accept: "application/dns-json" },
      redirect: "manual",
    });
    if (!response.ok) throw new Error("DNS safety preflight недоступен.");
    const payload = await response.json() as DnsJsonResponse;
    if (payload.Status !== 0 && payload.Status !== 3) {
      throw new Error("DNS safety preflight вернул ошибку.");
    }
    const expectedType = type === "A" ? 1 : 28;
    return (payload.Answer ?? [])
      .filter((item) => item.type === expectedType)
      .map((item) => String(item.data ?? ""))
      .filter(Boolean);
  }));
  return responses.flat();
}
