import assert from "node:assert/strict";
import test from "node:test";
import {
	isToTicketsIssue,
	isUnblockedTicket,
	parentIssueNumber,
	takeTaskPrompt,
	unblockedTickets,
	type ImplementationIssue,
	type ImplementationTicket,
} from "./model.ts";

const ticketBody = `## Parent

Part of #100.

## What to build

A complete vertical slice.

## Acceptance criteria

- [ ] Observable behavior works.

## Blocked by

- None — can start immediately.
`;

function issue(overrides: Partial<ImplementationIssue> = {}): ImplementationIssue {
	return {
		number: 112,
		title: "Исполнять подтверждённый пакет",
		url: "https://github.com/ElJeskos/MOX-ADV/issues/112",
		state: "open",
		assignees: [],
		labels: ["ready-for-agent"],
		body: ticketBody,
		...overrides,
	};
}

function ticket(overrides: Partial<ImplementationTicket> = {}): ImplementationTicket {
	return { ...issue(), blockers: [], ...overrides };
}

test("recognizes the /to-tickets issue shape and excludes specs and Wayfinder tickets", () => {
	assert.equal(isToTicketsIssue(issue()), true);
	assert.equal(isToTicketsIssue(issue({ body: "## Problem Statement\n\nLarge parent spec." })), false);
	assert.equal(isToTicketsIssue(issue({ labels: ["ready-for-agent", "wayfinder:task"] })), false);
	assert.equal(isToTicketsIssue(issue({ labels: [] })), false);
	assert.equal(isToTicketsIssue(issue({ state: "closed" })), false);
});

test("frontier contains every open /to-tickets issue without an open native blocker", () => {
	const ready = ticket({ number: 112 });
	const assigned = ticket({ number: 111, assignees: ["ElJeskos"] });
	const blocked = ticket({
		number: 113,
		blockers: [issue({ number: 112, title: "Open blocker", state: "open" })],
	});
	const closedBlocker = ticket({
		number: 114,
		blockers: [issue({ number: 109, title: "Closed blocker", state: "closed" })],
	});
	const closed = ticket({ number: 115, state: "closed" });

	assert.equal(isUnblockedTicket(ready), true);
	assert.equal(isUnblockedTicket(blocked), false);
	assert.deepEqual(
		unblockedTickets([ready, assigned, blocked, closedBlocker, closed]).map((item) => item.number),
		[111, 112, 114],
	);
});

test("extracts the parent spec reference when present", () => {
	assert.equal(parentIssueNumber(ticketBody), 100);
	assert.equal(parentIssueNumber("## What to build\n\nStandalone task."), undefined);
});

test("selection starts Pi's implement skill", () => {
	assert.equal(
		takeTaskPrompt("https://github.com/ElJeskos/MOX-ADV/issues/112"),
		"/skill:implement возьми в работу задачу https://github.com/ElJeskos/MOX-ADV/issues/112",
	);
});
