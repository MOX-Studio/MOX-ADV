export type IssueState = "open" | "closed";

export interface ImplementationIssue {
	number: number;
	title: string;
	url: string;
	state: IssueState;
	assignees: string[];
	labels: string[];
	body: string;
}

export interface ImplementationTicket extends ImplementationIssue {
	blockers: ImplementationIssue[];
}

const TO_TICKETS_HEADINGS = ["What to build", "Acceptance criteria", "Blocked by"] as const;

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasHeading(body: string, heading: string): boolean {
	return new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "im").test(body);
}

export function isToTicketsIssue(issue: ImplementationIssue): boolean {
	return (
		issue.state === "open" &&
		issue.labels.includes("ready-for-agent") &&
		!issue.labels.some((label) => label.startsWith("wayfinder:")) &&
		TO_TICKETS_HEADINGS.every((heading) => hasHeading(issue.body, heading))
	);
}

export function isUnblockedTicket(ticket: ImplementationTicket): boolean {
	return isToTicketsIssue(ticket) && !ticket.blockers.some((blocker) => blocker.state === "open");
}

export function unblockedTickets(tickets: ImplementationTicket[]): ImplementationTicket[] {
	return tickets.filter(isUnblockedTicket).sort((left, right) => left.number - right.number);
}

export function parentIssueNumber(body: string): number | undefined {
	const match = body.match(/^Part of #(\d+)\.\s*$/m);
	return match ? Number(match[1]) : undefined;
}

export function takeTaskPrompt(issueUrl: string): string {
	return `/skill:implement возьми в работу задачу ${issueUrl}`;
}
