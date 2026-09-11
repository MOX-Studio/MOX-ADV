export const CODEX_LEGACY_OUTPUT: "tool-envelope-v1";
export const CODEX_NATIVE_OUTPUT: "single-tool-arguments-v1";
export type CodexOutputFormat = typeof CODEX_LEGACY_OUTPUT | typeof CODEX_NATIVE_OUTPUT;
export type CodexOutputTool = { name: string; input_schema: Record<string, unknown> };
export type CodexOutputPlan = {
  format: CodexOutputFormat;
  bound_tool: string | null;
  fallback_reason: string | null;
  deferred_constraints: string[];
  schema: Record<string, unknown>;
};
export function chooseCodexOutputPlan(tools: CodexOutputTool[], preferNative?: boolean): CodexOutputPlan;
export function resolveCodexOutputPlan(tools: CodexOutputTool[], format: unknown): CodexOutputPlan;
export function parseCodexFinalOutput(serialized: string, plan: CodexOutputPlan): { name: string; arguments: Record<string, unknown> };
