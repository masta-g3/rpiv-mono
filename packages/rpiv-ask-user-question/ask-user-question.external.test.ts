import { createMockPi } from "@juicesharp/rpiv-test-utils";
import { describe, expect, it, vi } from "vitest";
import { registerAskUserQuestionTool } from "./ask-user-question.js";
import type { AskUserResponse } from "./events.js";
import type { QuestionnaireResult } from "./tool/types.js";

const params = {
	questions: [
		{
			question: "Pick\r\none?",
			header: "Pick",
			options: [
				{ label: "A", description: "a", preview: "# Full\r\npreview" },
				{ label: "B", description: "b" },
			],
		},
	],
};
function setup() {
	const listeners = new Map<string, (data: unknown) => void>();
	const lifecycle = new Map<string, (...args: unknown[]) => unknown>();
	const { pi, captured } = createMockPi({
		events: {
			on: (name, fn) => {
				listeners.set(name, fn);
				return () => {
					listeners.delete(name);
				};
			},
			emit: (name, data) => {
				listeners.get(name)?.(data);
			},
		},
	});
	// Capture lifecycle independently of the tool-test harness implementation.
	pi.on = ((name: string, fn: (...args: unknown[]) => unknown) => {
		lifecycle.set(name, fn);
	}) as typeof pi.on;
	registerAskUserQuestionTool(pi);
	const tool = captured.tools.get("ask_user_question")!;
	function request(data: object) {
		let response: AskUserResponse | undefined;
		listeners.set("rpiv:ask-user:response", (value) => {
			response = value as AskUserResponse;
		});
		pi.events.emit("rpiv:ask-user:request", { version: 1, id: "r", ...data });
		return response;
	}
	let construct: (() => void) | undefined;
	let component: { handleInput(data: string): void } | undefined;
	const done = vi.fn();
	const remove = vi.fn();
	const ctx = {
		hasUI: true,
		mode: "tui",
		ui: {
			onTerminalInput: () => remove,
			custom: (factory: (...args: unknown[]) => typeof component) =>
				new Promise((resolve) => {
					construct = () => {
						component = factory(
							{ requestRender: vi.fn(), terminal: { columns: 120, rows: 30 } },
							{ fg: (_: string, s: string) => s, bg: (_: string, s: string) => s, bold: (s: string) => s },
							{ matches: (data: string, key: string) => data === "\x1b" && key === "tui.select.cancel" },
							(result: QuestionnaireResult) => {
								done(result);
								resolve(result);
							},
						);
					};
				}),
		},
	};
	return {
		tool,
		ctx,
		done,
		remove,
		request,
		lifecycle,
		construct: async () => {
			await vi.waitFor(() => expect(construct).toBeDefined());
			construct?.();
		},
		nativeCancel: () => component?.handleInput("\x1b"),
	};
}
describe("native completion bridge", () => {
	it("queries normalized full params only after lazy factory; external done produces canonical envelope and native cannot overwrite", async () => {
		const h = setup();
		const execution = h.tool.execute!("exact", params, undefined, undefined, h.ctx as never);
		expect(h.request({ kind: "query" })).toMatchObject({ pending: [] });
		await h.construct();
		expect(h.request({ kind: "query" })).toMatchObject({
			pending: [
				{
					toolCallId: "exact",
					params: { questions: [{ question: "Pick\none?", options: [{ preview: "# Full\npreview" }, {}] }] },
				},
			],
		});
		expect(
			h.request({
				kind: "submit",
				toolCallId: "exact",
				answers: [{ questionIndex: 0, kind: "option", optionIndex: 0, answer: "forged", preview: "forged" }],
			}),
		).toMatchObject({ accepted: true });
		h.nativeCancel();
		const result = await execution;
		expect(result.details).toMatchObject({
			cancelled: false,
			answers: [{ answer: "A", preview: "# Full\npreview" }],
		});
		expect(result.content[0]).toMatchObject({ text: expect.stringContaining("selected preview:") });
		expect(h.done).toHaveBeenCalledOnce();
		expect(h.remove).toHaveBeenCalledOnce();
	});
	it.each(["native", "abort", "session_start", "session_tree", "session_shutdown"])(
		"%s invalidates pending and dismisses the same UI once",
		async (kind) => {
			const h = setup();
			const controller = new AbortController();
			const execution = h.tool.execute!("exact", params, controller.signal, undefined, h.ctx as never);
			await h.construct();
			if (kind === "native") h.nativeCancel();
			else if (kind === "abort") controller.abort();
			else h.lifecycle.get(kind)?.({}, h.ctx);
			expect((await execution).details).toMatchObject({ cancelled: true });
			h.nativeCancel();
			controller.abort();
			expect(h.done).toHaveBeenCalledOnce();
			const response = h.request({ kind: "query" });
			if (kind === "session_shutdown") expect(response).toBeUndefined();
			else expect(response).toMatchObject({ pending: [] });
		},
	);
	it("abort during lazy construction never advertises and still resolves the overlay", async () => {
		const h = setup();
		const controller = new AbortController();
		const execution = h.tool.execute!("exact", params, controller.signal, undefined, h.ctx as never);
		controller.abort();
		await h.construct();
		expect((await execution).details).toMatchObject({ cancelled: true });
		expect(h.request({ kind: "query" })).toMatchObject({ pending: [] });
		expect(h.done).toHaveBeenCalledOnce();
	});
	it.each(["rpc", "json", "print"])("does not advertise remote capability in %s", async (mode) => {
		const h = setup();
		const ctx = { hasUI: mode === "rpc", mode, ui: { select: async () => undefined, input: async () => undefined } };
		await h.tool.execute!("exact", params, undefined, undefined, ctx as never);
		expect(h.request({ kind: "query" })).toMatchObject({ error: "unsupported" });
	});
});
