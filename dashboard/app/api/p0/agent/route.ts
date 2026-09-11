/** Retired multi-agent endpoint. No model is instantiated and no work is scheduled. */
export async function POST() {
  return Response.json({ code: "SINGLE_CODEX_REQUIRED", message: "Пайплайном управляет один Codex через рабочее состояние этапов." }, { status: 410 });
}
