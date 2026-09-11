export const COMPETITOR_DISCOVERY_TOOL = "p0_submit_competitor_discovery";
const EVIDENCE_RESEARCH_TOOLS = new Set([
  "p0_submit_business_evidence", COMPETITOR_DISCOVERY_TOOL, "p0_submit_competitor_assessment",
  "p0_submit_competitor_ranking", "p0_submit_evidence_analysis",
]);

export function isEvidenceResearch(tools: ReadonlyArray<{ name: string }>) {
  return tools.length === 1 && EVIDENCE_RESEARCH_TOOLS.has(tools[0].name);
}

/** Only this application-owned, closed result contract grants public web discovery. */
export function isPublicCompetitorDiscovery(tools: ReadonlyArray<{ name: string }>) {
  return tools.length === 1 && tools[0].name === COMPETITOR_DISCOVERY_TOOL;
}
