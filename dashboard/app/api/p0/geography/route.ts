import { productionGeographySuggestions, userKey } from "../../../../lib/p0";

export async function GET(request: Request) {
  try {
    userKey(request);
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (query.length > 100) return Response.json({ message: "Слишком длинный поисковый запрос." }, { status: 400 });
    const options = await productionGeographySuggestions(query);
    return Response.json({ options }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ message: "Не удалось загрузить варианты географии." }, { status: 503 });
  }
}
