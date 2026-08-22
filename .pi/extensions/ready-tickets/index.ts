import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ReplacedSessionContext,
} from "@earendil-works/pi-coding-agent";
import { BorderedLoader, DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import {
	isToTicketsIssue,
	parentIssueNumber,
	takeTaskPrompt,
	unblockedTickets,
	type ImplementationIssue,
	type ImplementationTicket,
	type IssueState,
} from "./model.ts";

interface RawGitHubIssue {
	number: number;
	title: string;
	state: string;
	body?: string;
	html_url?: string;
	url?: string;
	assignees?: Array<{ login?: string } | string>;
	labels?: Array<{ name?: string } | string>;
}

const GH_TIMEOUT_MS = 20_000;

function normalizeIssue(issue: RawGitHubIssue): ImplementationIssue {
	const state: IssueState = issue.state.toLowerCase() === "closed" ? "closed" : "open";
	return {
		number: issue.number,
		title: issue.title,
		url: issue.html_url || issue.url || "",
		state,
		body: issue.body || "",
		assignees: (issue.assignees || [])
			.map((assignee) => (typeof assignee === "string" ? assignee : assignee.login || ""))
			.filter(Boolean),
		labels: (issue.labels || [])
			.map((label) => (typeof label === "string" ? label : label.name || ""))
			.filter(Boolean),
	};
}

async function ghText(
	pi: ExtensionAPI,
	cwd: string,
	args: string[],
	signal?: AbortSignal,
): Promise<string> {
	const result = await pi.exec("gh", args, { cwd, signal, timeout: GH_TIMEOUT_MS });
	if (result.code !== 0) {
		const details = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
		throw new Error(details);
	}
	return result.stdout.trim();
}

async function ghJson<T>(
	pi: ExtensionAPI,
	cwd: string,
	args: string[],
	signal?: AbortSignal,
): Promise<T> {
	const text = await ghText(pi, cwd, args, signal);
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new Error(`Некорректный JSON от gh ${args.join(" ")}`);
	}
}

async function resolveRepo(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string> {
	const repo = await ghText(
		pi,
		cwd,
		["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
		signal,
	);
	if (!/^[^/]+\/[^/]+$/.test(repo)) throw new Error("Не удалось определить GitHub-репозиторий.");
	return repo;
}

async function listCandidates(
	pi: ExtensionAPI,
	cwd: string,
	repo: string,
	signal?: AbortSignal,
): Promise<ImplementationIssue[]> {
	const issues = await ghJson<RawGitHubIssue[]>(
		pi,
		cwd,
		[
			"issue",
			"list",
			"--repo",
			repo,
			"--state",
			"open",
			"--label",
			"ready-for-agent",
			"--limit",
			"100",
			"--json",
			"number,title,url,state,body,assignees,labels",
		],
		signal,
	);
	return issues.map(normalizeIssue).filter(isToTicketsIssue);
}

async function listBlockers(
	pi: ExtensionAPI,
	cwd: string,
	repo: string,
	ticketNumber: number,
	signal?: AbortSignal,
): Promise<ImplementationIssue[]> {
	const issues = await ghJson<RawGitHubIssue[]>(
		pi,
		cwd,
		["api", `repos/${repo}/issues/${ticketNumber}/dependencies/blocked_by?per_page=100`],
		signal,
	);
	return issues.map(normalizeIssue);
}

async function loadReadyTickets(
	pi: ExtensionAPI,
	cwd: string,
	signal?: AbortSignal,
): Promise<ImplementationTicket[]> {
	const repo = await resolveRepo(pi, cwd, signal);
	const candidates = await listCandidates(pi, cwd, repo, signal);
	const tickets = await Promise.all(
		candidates.map(async (ticket): Promise<ImplementationTicket> => ({
			...ticket,
			blockers: await listBlockers(pi, cwd, repo, ticket.number, signal),
		})),
	);
	return unblockedTickets(tickets);
}

function ticketDescription(ticket: ImplementationTicket): string {
	const parent = parentIssueNumber(ticket.body);
	const assignment =
		ticket.assignees.length === 0
			? "не назначена"
			: `назначена ${ticket.assignees.map((login) => `@${login}`).join(", ")}`;
	return `${parent ? `спек #${parent}` : "implementation ticket"} · ${assignment}`;
}

async function showTicketPicker(
	ctx: ExtensionCommandContext,
	tickets: ImplementationTicket[],
): Promise<ImplementationTicket | undefined> {
	const items: SelectItem[] = tickets.map((ticket) => ({
		value: String(ticket.number),
		label: `#${ticket.number} ${ticket.title}`,
		description: ticketDescription(ticket),
	}));

	const selected = await ctx.ui.custom<string | null>((tui, theme, _keybindings, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
		container.addChild(new Text(theme.fg("accent", theme.bold("◆ Фронтир реализации")), 1, 0));
		container.addChild(
			new Text(theme.fg("muted", `${tickets.length} незаблокированных задач`), 1, 0),
		);

		const list = new SelectList(items, Math.min(items.length, 12), {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		});
		list.onSelect = (item) => done(item.value);
		list.onCancel = () => done(null);
		container.addChild(list);
		container.addChild(
			new Text(theme.fg("dim", "↑↓ выбрать · Enter начать /implement · Esc закрыть"), 1, 0),
		);
		container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				list.handleInput(data);
				tui.requestRender();
			},
		};
	});

	return selected ? tickets.find((ticket) => String(ticket.number) === selected) : undefined;
}

async function startImplementationSession(
	ctx: ExtensionCommandContext,
	ticket: ImplementationTicket,
): Promise<void> {
	const parentSession = ctx.sessionManager.getSessionFile();
	let replacementContext: ReplacedSessionContext | undefined;

	try {
		const result = await ctx.newSession({
			...(parentSession ? { parentSession } : {}),
			withSession: async (freshContext) => {
				replacementContext = freshContext;
				await freshContext.sendUserMessage(takeTaskPrompt(ticket.url), {
					expandPromptTemplates: true,
				});
			},
		});
		if (result.cancelled) ctx.ui.notify("Создание implementation-сессии отменено.", "info");
	} catch (error) {
		const message = `Не удалось начать /implement: ${error instanceof Error ? error.message : String(error)}`;
		(replacementContext || ctx).ui.notify(message, "error");
	}
}

export default function readyTicketsPicker(pi: ExtensionAPI): void {
	pi.registerCommand("ready", {
		description: "Выбрать незаблокированную задачу /to-tickets и начать /implement",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/ready доступен только в интерактивном режиме Pi.", "error");
				return;
			}

			let failure: unknown;
			const tickets = await ctx.ui.custom<ImplementationTicket[] | null>(
				(tui, theme, _keybindings, done) => {
					const loader = new BorderedLoader(
						tui,
						theme,
						"Загружаю незаблокированные implementation-задачи…",
					);
					loader.onAbort = () => done(null);
					void loadReadyTickets(pi, ctx.cwd, loader.signal)
						.then(done)
						.catch((error) => {
							if (loader.signal.aborted) return;
							failure = error;
							done(null);
						});
					return loader;
				},
			);

			if (failure) {
				ctx.ui.notify(
					`Implementation frontier: ${failure instanceof Error ? failure.message : String(failure)}`,
					"error",
				);
				return;
			}
			if (!tickets) return;
			if (tickets.length === 0) {
				ctx.ui.notify("Нет открытых незаблокированных задач из /to-tickets.", "info");
				return;
			}

			const choice = await showTicketPicker(ctx, tickets);
			if (!choice) return;
			await startImplementationSession(ctx, choice);
		},
	});
}
