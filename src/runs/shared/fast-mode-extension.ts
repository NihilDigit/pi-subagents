import type { BeforeProviderRequestEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isOpenAIProvider, setSessionFastMode } from "../../shared/fast-mode.ts";

export function rewriteFastModeProviderRequest(event: BeforeProviderRequestEvent, ctx?: ExtensionContext): unknown {
	if (ctx && !isOpenAIProvider(ctx.model?.provider)) return event.payload;
	if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return event.payload;
	return { ...event.payload, service_tier: "priority" };
}

export default function registerSubagentFastModeExtension(pi: ExtensionAPI): void {
	pi.on("before_provider_request", rewriteFastModeProviderRequest);
	let sessionId: string | undefined;
	pi.on("session_start", (_event, ctx) => {
		sessionId = ctx.sessionManager.getSessionId();
		setSessionFastMode(sessionId, true);
	});
	pi.on("session_shutdown", () => {
		if (sessionId) setSessionFastMode(sessionId, undefined);
	});
}
