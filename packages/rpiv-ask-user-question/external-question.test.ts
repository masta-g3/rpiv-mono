import { createMockPi } from "@juicesharp/rpiv-test-utils";
import { describe, expect, it, vi } from "vitest";
import { registerExternalQuestions } from "./external-question.js";
import type { QuestionParams } from "./tool/types.js";

const params: QuestionParams = {
	questions: [
		{
			question: "Pick?",
			header: "Pick",
			options: [
				{ label: "A", description: "a", preview: "# Full preview" },
				{ label: "B", description: "b" },
			],
		},
	],
};
function setup() {
	const listeners = new Map<string, (data: unknown) => void>();
	const emit = vi.fn((name: string, data: unknown) => listeners.get(name)?.(data));
	const { pi, captured } = createMockPi({
		events: {
			emit,
			on: vi.fn((name, fn) => {
				listeners.set(name, fn);
				return () => {
					listeners.delete(name);
				};
			}),
		},
	});
	const bridge = registerExternalQuestions(pi);
	bridge.setSupported(true);
	function request(data: object) {
		emit("rpiv:ask-user:request", { version: 1, id: "r", ...data });
		return emit.mock.calls.filter(([name]) => name === "rpiv:ask-user:response").at(-1)?.[1];
	}
	return { bridge, request, listeners, captured };
}
describe("external question contract", () => {
	it("advertises only after binding and removes before reentrant done; first completion wins", () => {
		const { bridge, request } = setup();
		const call = bridge.create("tc", params);
		expect(request({ kind: "query" })).toEqual({ version: 1, id: "r", ok: true, pending: [] });
		const done = vi.fn(() => expect(request({ kind: "query" })).toMatchObject({ pending: [] }));
		call.bind(done);
		expect(request({ kind: "query" })).toMatchObject({ pending: [{ toolCallId: "tc", params }] });
		expect(
			request({ kind: "submit", toolCallId: "tc", answers: [{ questionIndex: 0, kind: "option", optionIndex: 0 }] }),
		).toMatchObject({ ok: true, accepted: true });
		expect(done).toHaveBeenCalledWith({
			cancelled: false,
			answers: [{ questionIndex: 0, question: "Pick?", kind: "option", answer: "A", preview: "# Full preview" }],
		});
		call.settle({ cancelled: true, answers: [] });
		expect(request({ kind: "submit", toolCallId: "tc", answers: [] })).toMatchObject({ error: "stale" });
		expect(done).toHaveBeenCalledOnce();
	});
	it.each(
		[
			[],
			[{ questionIndex: 1, kind: "option", optionIndex: 0 }],
			[{ questionIndex: 0, kind: "option", optionIndex: -1 }],
			[{ questionIndex: 0, kind: "option", optionIndex: 0.5 }],
			[{ questionIndex: 0, kind: "custom", text: "  " }],
			[{ questionIndex: 0, kind: "multi", optionIndices: [] }],
			[
				{ questionIndex: 0, kind: "option", optionIndex: 0 },
				{ questionIndex: 0, kind: "option", optionIndex: 1 },
			],
		].map((answers) => ({ answers })),
	)("rejects incomplete or invalid answers %j", ({ answers }) => {
		const { bridge, request } = setup();
		const done = vi.fn();
		bridge.create("tc", params).bind(done);
		expect(request({ kind: "submit", toolCallId: "tc", answers })).toMatchObject({ error: "invalid" });
		expect(done).not.toHaveBeenCalled();
	});
	it("accepts custom and empty multi; rejects duplicate selections", () => {
		const { bridge, request } = setup();
		const done = vi.fn();
		bridge
			.create("tc", { questions: [params.questions[0], { ...params.questions[0], multiSelect: true }] })
			.bind(done);
		const answers = [
			{ questionIndex: 0, kind: "custom", text: " literal " },
			{ questionIndex: 1, kind: "multi", optionIndices: [0, 0] },
		];
		expect(request({ kind: "submit", toolCallId: "tc", answers })).toMatchObject({ error: "invalid" });
		answers[1].optionIndices = [];
		expect(request({ kind: "submit", toolCallId: "tc", answers })).toMatchObject({ accepted: true });
		expect(done.mock.calls[0][0].answers).toMatchObject([{ answer: " literal " }, { selected: [], answer: null }]);
	});
	it("isolates calls; native wins; abort before bind and shutdown dismiss once", () => {
		const { bridge, request, listeners } = setup();
		const signal = new AbortController();
		const a = bridge.create("a", params, signal.signal);
		const b = bridge.create("b", params);
		const da = vi.fn();
		const db = vi.fn();
		signal.abort();
		a.bind(da);
		b.bind(db);
		expect(da).toHaveBeenCalledWith({ cancelled: true, answers: [] });
		expect(request({ kind: "query" })).toMatchObject({ pending: [{ toolCallId: "b" }] });
		b.settle({ cancelled: false, answers: [] });
		expect(request({ kind: "submit", toolCallId: "b", answers: [] })).toMatchObject({ error: "stale" });
		const c = bridge.create("c", params);
		const dc = vi.fn();
		c.bind(dc);
		bridge.shutdown();
		c.settle({ cancelled: false, answers: [] });
		expect(dc).toHaveBeenCalledOnce();
		expect(db).toHaveBeenCalledOnce();
		expect(listeners.size).toBe(0);
	});
	it("validates complete indexes, derives multiselect labels, and protects query snapshots", () => {
		const { bridge, request } = setup();
		const done = vi.fn();
		bridge
			.create("tc", { questions: [params.questions[0], { ...params.questions[0], multiSelect: true }] })
			.bind(done);
		const query = request({ kind: "query" }) as { pending: Array<{ params: QuestionParams }> };
		query.pending[0].params.questions[0].options[0].label = "forged";
		expect(
			request({
				kind: "submit",
				toolCallId: "tc",
				answers: [
					{ questionIndex: 0, kind: "option", optionIndex: 0 },
					{ questionIndex: 0, kind: "custom", text: "duplicate" },
				],
			}),
		).toMatchObject({ error: "invalid" });
		expect(
			request({
				kind: "submit",
				toolCallId: "tc",
				answers: [
					{ questionIndex: 1, kind: "multi", optionIndices: [1, 0] },
					{ questionIndex: 0, kind: "option", optionIndex: 0 },
				],
			}),
		).toMatchObject({ accepted: true });
		expect(done.mock.calls[0][0].answers).toMatchObject([
			{ questionIndex: 0, answer: "A" },
			{ questionIndex: 1, selected: ["B", "A"] },
		]);
	});
	it("disposed lazy calls cannot reappear or remove a replacement call", () => {
		const { bridge, request } = setup();
		const old = bridge.create("tc", params);
		old.dispose();
		bridge.create("tc", params).bind(vi.fn());
		old.bind(vi.fn());
		old.dispose();
		expect(request({ kind: "query" })).toMatchObject({ pending: [{ toolCallId: "tc" }] });
	});
	it("rejects unsupported hosts and versions; preserves correlation IDs", () => {
		const { bridge, request } = setup();
		expect(request({ kind: "query", version: 2, id: "other" })).toEqual({
			version: 1,
			id: "other",
			ok: false,
			error: "unsupported",
		});
		bridge.setSupported(false);
		expect(request({ kind: "query" })).toMatchObject({ error: "unsupported" });
	});
});
