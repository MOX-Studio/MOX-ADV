type DirectAuditState = {
  status?: unknown;
  next_retry_at?: unknown;
} | null | undefined;

export function directPreflightRefreshState(
  audit: DirectAuditState,
  nowMs = Date.now(),
) {
  if (audit?.status !== "PENDING") {
    return { pending: false, delay_ms: null } as const;
  }
  const retryAt = typeof audit.next_retry_at === "string"
    ? Date.parse(audit.next_retry_at)
    : Number.NaN;
  const requestedDelay = Number.isFinite(retryAt)
    ? retryAt - nowMs + 250
    : 1_500;
  return {
    pending: true,
    delay_ms: Math.min(15_000, Math.max(1_000, requestedDelay)),
  } as const;
}
