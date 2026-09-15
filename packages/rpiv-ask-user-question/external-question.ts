import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type AnswerInput, ASK_USER_REQUEST_EVENT, ASK_USER_RESPONSE_EVENT, type AskUserResponse } from "./events.js";
import { buildAnswer } from "./tool/build-answer.js";
import type { QuestionnaireResult, QuestionParams } from "./tool/types.js";

function validateAnswers(value: unknown, params: QuestionParams): AnswerInput[] | undefined {
	if (!Array.isArray(value) || value.length !== params.questions.length) return;
	const seen = new Set<number>();
	for (const a of value) {
		if (!a || typeof a !== "object" || !Number.isInteger(a.questionIndex)) return;
		const q = params.questions[a.questionIndex];
		if (!q || seen.has(a.questionIndex)) return;
		seen.add(a.questionIndex);
		const validIndex = (i: unknown) => typeof i === "number" && Number.isInteger(i) && i >= 0 && i < q.options.length;
		if (a.kind === "custom") {
			if (typeof a.text !== "string" || !a.text.trim()) return;
		} else if (a.kind === "option") {
			if (q.multiSelect || !validIndex(a.optionIndex)) return;
		} else if (a.kind === "multi") {
			if (
				!q.multiSelect ||
				!Array.isArray(a.optionIndices) ||
				!Array.from(a.optionIndices).every(validIndex) ||
				new Set(a.optionIndices).size !== a.optionIndices.length
			)
				return;
		} else return;
	}
	return [...value].sort((a, b) => a.questionIndex - b.questionIndex);
}

export function registerExternalQuestions(pi: ExtensionAPI) {
	let supported = false;
	let active = true;
	const calls = new Set<{ cancel: () => void }>();
	const pending = new Map<string, { params: QuestionParams; settle: (result: QuestionnaireResult) => void }>();
	function clear() {
		for (const call of [...calls]) call.cancel();
	}
	const unsubscribe = pi.events.on(ASK_USER_REQUEST_EVENT, (data: unknown) => {
		if (!data || typeof data !== "object") return;
		const r = data as Record<string, unknown>;
		if (typeof r.id !== "string") return;
		const reply = (
			body:
				| Omit<Extract<AskUserResponse, { ok: false }>, "version" | "id">
				| { ok: true; pending: Array<{ toolCallId: string; params: QuestionParams }> }
				| { ok: true; accepted: true },
		) => pi.events.emit(ASK_USER_RESPONSE_EVENT, { version: 1, id: r.id, ...body });
		if (r.version !== 1 || !supported) return reply({ ok: false, error: "unsupported" });
		if (r.kind === "query")
			return reply({
				ok: true,
				pending: [...pending].map(([toolCallId, call]) => ({ toolCallId, params: structuredClone(call.params) })),
			});
		if (r.kind !== "submit" || typeof r.toolCallId !== "string" || !Array.isArray(r.answers))
			return reply({ ok: false, error: "invalid" });
		const call = pending.get(r.toolCallId);
		if (!call) return reply({ ok: false, error: "stale" });
		const answers = validateAnswers(r.answers, call.params);
		if (!answers) return reply({ ok: false, error: "invalid" });
		call.settle({
			cancelled: false,
			answers: answers.map((a) => buildAnswer(call.params.questions[a.questionIndex], a)),
		});
		reply({ ok: true, accepted: true });
	});
	function setSupported(value: boolean) {
		supported = active && value;
	}
	function shutdown() {
		active = false;
		supported = false;
		unsubscribe();
		clear();
	}
	pi.on("session_start", (_event, ctx) => {
		clear();
		setSupported(ctx.hasUI && ctx.mode === "tui");
	});
	pi.on("session_tree", () => clear());
	pi.on("session_shutdown", shutdown);
	return {
		setSupported,
		shutdown,
		create(toolCallId: string, params: QuestionParams, signal?: AbortSignal) {
			let done: ((result: QuestionnaireResult) => void) | undefined;
			let result: QuestionnaireResult | undefined;
			const call = { cancel: () => settle({ answers: [], cancelled: true }) };
			function removePending() {
				if (pending.get(toolCallId)?.settle === settle) pending.delete(toolCallId);
			}
			function settle(value: QuestionnaireResult) {
				if (result) return;
				result = value;
				removePending();
				calls.delete(call);
				signal?.removeEventListener("abort", call.cancel);
				done?.(value);
			}
			calls.add(call);
			signal?.addEventListener("abort", call.cancel, { once: true });
			if (signal?.aborted || !active) call.cancel();
			return {
				settle,
				bind(callback: (value: QuestionnaireResult) => void) {
					done = callback;
					if (result) done(result);
					else if (supported) pending.set(toolCallId, { params, settle });
				},
				dispose: call.cancel,
			};
		},
	};
}
