import type { Metadata } from "next";
import PrototypeClient from "./PrototypeClient";

export const metadata: Metadata = {
  title: "PROTOTYPE · Production-модуль P0 · MOX-ADV",
  description:
    "Выбранный прототип пути владельца для подготовки стратегии и жизнеспособных рекламных кампаний.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Prd149PrototypePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const requestedStage = first(params.stage);
  const initialStage = (["goal", "learned", "strategy", "campaigns", "review"] as const).find((item) => item === requestedStage) || "goal";

  return <PrototypeClient initialStage={initialStage} />;
}
