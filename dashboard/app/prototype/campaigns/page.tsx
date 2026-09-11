import type { Metadata } from "next";
import CampaignsPrototype from "./CampaignsPrototype";

export const metadata: Metadata = {
  title: "Portfolio-first прототип раздела «Кампании» — MOX-ADV",
  description: "Один throwaway-интерфейс инспекции будущих кампаний в четырёх состояниях данных.",
};

export default function CampaignsPrototypePage() {
  return <CampaignsPrototype />;
}
