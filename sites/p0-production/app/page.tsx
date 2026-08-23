import type { Metadata } from "next";
import P0Client from "./P0Client";

export const metadata: Metadata = {
  title: "Стратегия и рекламные кампании — MOX-ADV",
  description:
    "Производственный Dashboard MOX-ADV: пять бизнес-этапов от цели до безопасного создания рекламных кампаний.",
};

export default function Home() {
  return <P0Client />;
}
