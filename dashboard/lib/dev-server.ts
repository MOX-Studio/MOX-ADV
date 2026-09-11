export function devServerConfig(seatbeltSandbox: boolean, stableRuntime = false) {
  // Long pipeline checks must not lose their Worker when source or env files change.
  // Restart this opt-in runtime explicitly to load a new code/configuration revision.
  return {
    // Vite 8 auto-enables forwarding under coding agents. On disconnect its
    // forwarding error can recursively trigger another unhandled-error event.
    // Keep browser errors in DevTools; avoid an unbounded error/retry stream.
    forwardConsole: false,
    watch: {
      ignored: [
        "**/.wrangler/**",
        ...(stableRuntime ? ["**/.env*", "**/*.md", "**/*.log"] : []),
      ],
      ...(seatbeltSandbox ? { useFsEvents: false, usePolling: true } : {}),
    },
  };
}
