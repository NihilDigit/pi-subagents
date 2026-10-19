import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const ENTRY_TYPE = "pi-subagents:fast-mode";
const sessions = new Map<string, boolean>();

export function isOpenAIProvider(provider: string | undefined): boolean {
	return provider === "openai" || provider === "openai-codex";
}

export function setSessionFastMode(sessionId: string, enabled: boolean | undefined): void {
	if (enabled === undefined) sessions.delete(sessionId);
	else sessions.set(sessionId, enabled);
}

export function resolveChildFastMode(
	explicit: boolean | undefined,
	configured: boolean | undefined,
	parentSessionId: string | null | undefined,
	model: string | undefined,
): boolean | undefined {
	if (explicit !== undefined) return explicit;
	if (configured !== undefined) return configured;
	if (!parentSessionId || !isOpenAIProvider(model?.split("/")[0])) return undefined;
	return sessions.get(parentSessionId);
}

export function registerSessionFastMode(pi: ExtensionAPI): void {
	let currentSessionId: string | undefined;
	const showStatus = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		const active = sessions.get(ctx.sessionManager.getSessionId()) === true && isOpenAIProvider(ctx.model?.provider);
		ctx.ui.setStatus("pi-fast", active ? "priority" : undefined);
	};
	const restore = (ctx: ExtensionContext) => {
		const sessionId = ctx.sessionManager.getSessionId();
		if (currentSessionId && currentSessionId !== sessionId) sessions.delete(currentSessionId);
		currentSessionId = sessionId;
		let enabled: boolean | undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
			const data = entry.data as { enabled?: unknown } | undefined;
			if (typeof data?.enabled === "boolean") enabled = data.enabled;
		}
		setSessionFastMode(sessionId, enabled);
		showStatus(ctx);
	};
	pi.on("session_start", (_event, ctx) => restore(ctx));
	pi.on("session_tree", (_event, ctx) => restore(ctx));
	pi.on("model_select", (_event, ctx) => showStatus(ctx));
	pi.on("session_shutdown", () => {
		if (currentSessionId) sessions.delete(currentSessionId);
	});
	pi.on("before_provider_request", (event, ctx) => {
		if (sessions.get(ctx.sessionManager.getSessionId()) !== true || !isOpenAIProvider(ctx.model?.provider)) return;
		if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return;
		return { ...event.payload, service_tier: "priority" };
	});
	pi.registerCommand("fast", {
		description: "Toggle OpenAI priority requests; /fast on|off|status. New children inherit unless fast is explicitly set.",
		handler: async (args, ctx) => {
			const argument = args.trim().toLowerCase();
			const sessionId = ctx.sessionManager.getSessionId();
			const enabled = sessions.get(sessionId) === true;
			if (argument === "status") {
				ctx.ui.notify(`Fast: ${enabled ? "on (priority)" : "off"}${enabled && !isOpenAIProvider(ctx.model?.provider) ? " — inactive for this provider" : ""}.`, "info");
				return;
			}
			if (argument && argument !== "on" && argument !== "off") {
				ctx.ui.notify("Usage: /fast [on|off|status]", "warning");
				return;
			}
			const next = argument === "on" || (!argument && !enabled);
			if (next && !isOpenAIProvider(ctx.model?.provider)) {
				ctx.ui.notify("Fast mode requires an OpenAI model.", "warning");
				return;
			}
			setSessionFastMode(sessionId, next);
			pi.appendEntry(ENTRY_TYPE, { enabled: next });
			showStatus(ctx);
			ctx.ui.notify(`Fast ${next ? "on (priority)" : "off"}. New OpenAI children inherit; options.fast overrides per dispatch.`, "info");
		},
	});
}
