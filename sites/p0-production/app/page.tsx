import type { Metadata } from "next";
import P0Client from "./P0Client";

export const metadata: Metadata = {
  title: "Путь владельца — MOX-ADV",
  description:
    "Пять бизнес-этапов от цели до проверки и безопасного создания рекламных кампаний.",
};

export default function Home() {
  return <P0Client />;
}
