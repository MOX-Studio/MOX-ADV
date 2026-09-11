import type { Metadata } from "next";
import P0Client from "../P0Client";

export const metadata: Metadata = { title: "Рабочая область агента — MOX-ADV", robots: { index: false, follow: false } };

export default function AgentWorkspace() {
  return <P0Client surface="agent" />;
}
