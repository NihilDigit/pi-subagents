import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerSessionFastMode, resolveChildFastMode, setSessionFastMode } from "../../src/shared/fast-mode.ts";

function harness(provider = "openai") {
	const id = randomUUID();
	const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>();
	let command: { handler(args: string, ctx: ExtensionContext): Promise<void> };
	const entries: Array<{ type: string; customType: string; data: unknown }> = [];
	const notices: string[] = [];
	const pi = {
		on(name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) {
			const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list);
		},
		registerCommand(name: string, definition: typeof command) { assert.equal(name, "fast"); command = definition; },
		appendEntry(customType: string, data: unknown) { entries.push({ type: "custom", customType, data }); },
	} as unknown as ExtensionAPI;
	const ctx = { model: { provider, id: "probe" },
		sessionManager: { getSessionId: () => id, getBranch: () => entries },
		ui: { setStatus() {}, notify(text: string) { notices.push(text); } },
	} as unknown as ExtensionContext;
	registerSessionFastMode(pi);
	const emit = (name: string, event = {}) => handlers.get(name)?.map((handler) => handler(event, ctx));
	emit("session_start");
	return { id, ctx, entries, notices, emit, run: (args = "") => command.handler(args, ctx) };
}

test("fast is opt-in, toggles the request field, and does not mutate the original payload", async () => {
	const h = harness();
	const payload = { model: "probe", input: [] };
	assert.equal(h.emit("before_provider_request", { payload })?.[0], undefined);
	assert.equal(resolveChildFastMode(undefined, undefined, h.id, "openai/probe"), undefined);
	await h.run();
	assert.deepEqual(h.emit("before_provider_request", { payload })?.[0], { ...payload, service_tier: "priority" });
	assert.equal("service_tier" in payload, false);
	await h.run();
	assert.equal(h.emit("before_provider_request", { payload })?.[0], undefined);
	assert.equal(h.entries.length, 2);
	h.emit("session_shutdown");
});

test("children inherit the session default and explicit dispatch/profile flags win", async () => {
	const h = harness();
	await h.run("on");
	assert.equal(resolveChildFastMode(undefined, undefined, h.id, "openai/probe:high"), true);
	assert.equal(resolveChildFastMode(undefined, undefined, h.id, "openai-codex/probe"), true);
	assert.equal(resolveChildFastMode(false, true, h.id, "openai/probe"), false);
	assert.equal(resolveChildFastMode(undefined, false, h.id, "openai/probe"), false);
	assert.equal(resolveChildFastMode(undefined, undefined, h.id, "anthropic/probe"), undefined);
	assert.equal(resolveChildFastMode(undefined, undefined, "another-session", "openai/probe"), undefined);
	h.emit("session_shutdown");
	assert.equal(resolveChildFastMode(undefined, undefined, h.id, "openai/probe"), undefined);
});

test("session branches restore explicit mode and non-OpenAI requests keep their original payload", async () => {
	const h = harness();
	await h.run("on");
	h.emit("session_start");
	assert.equal(resolveChildFastMode(undefined, undefined, h.id, "openai/probe"), true);
	(h.ctx.model as { provider: string }).provider = "anthropic";
	assert.equal(h.emit("before_provider_request", { payload: { model: "other" } })?.[0], undefined);
	h.entries.splice(0);
	h.emit("session_tree");
	assert.equal(resolveChildFastMode(undefined, undefined, h.id, "openai/probe"), undefined);
	h.emit("session_shutdown");
});

test("unsupported provider and invalid arguments never enable priority", async () => {
	const h = harness("anthropic");
	await h.run("on");
	assert.match(h.notices.at(-1)!, /requires an OpenAI model/);
	assert.equal(h.entries.length, 0);
	await h.run("invalid");
	assert.match(h.notices.at(-1)!, /Usage/);
	await h.run("off");
	assert.equal(h.entries.length, 1);
	h.emit("session_shutdown");
	setSessionFastMode(h.id, undefined);
});

test("starting a saved session restores its choice and detaches the old session", async () => {
	const h = harness(); await h.run("on");
	const resumedId = randomUUID();
	(h.ctx.sessionManager as unknown as { getSessionId(): string }).getSessionId = () => resumedId;
	h.emit("session_start");
	assert.equal(resolveChildFastMode(undefined, undefined, h.id, "openai/probe"), undefined);
	assert.equal(resolveChildFastMode(undefined, undefined, resumedId, "openai/probe"), true);
	h.emit("session_shutdown");
});
