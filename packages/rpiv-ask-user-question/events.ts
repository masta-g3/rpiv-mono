/**
 * Public event contract for @juicesharp/rpiv-ask-user-question.
 *
 * STABILITY POLICY — applies to every event in the `rpiv:*` namespace.
 *
 *   1. Channel names are immutable. Once shipped, never rename.
 *   2. Payload changes are append-only. Listeners MUST tolerate unknown
 *      fields. New fields ship as optional (`?:`).
 *   3. Breaking changes (rename, retype, remove a field; change emission
 *      semantics) require a NEW channel, e.g. `rpiv:ask-user:prompt.v2`,
 *      with dual-emit during a deprecation window.
 *   4. Notification payloads version via channel name only. The optional
 *      request/reply protocol below explicitly carries `version: 1`.
 *   5. Payloads must be JSON-safe: primitives, arrays, plain objects.
 *      No Set/Map/Date/class instances — payloads must survive JSON
 *      serialization when listeners forward them across process or
 *      network boundaries.
 *
 * Naming: `rpiv:<package-or-tool>:<phase>`, lowercase, hyphen-separated.
 * Aligns with Pi's `"my-extension:status"` example and UniPi's `unipi:*`.
 */

export const ASK_USER_PROMPT_EVENT = "rpiv:ask-user:prompt" as const;

export interface AskUserPromptEventPayload {
	questions: ReadonlyArray<AskUserPromptQuestion>;
}

/**
 * Emitted while the questionnaire is awaiting user input (TUI `ui.custom` and
 * RPC dialog walker). Cleared with `{ active: false }` in `finally` so listeners
 * can distinguish blocked-on-human from working.
 */
export const ASK_USER_BLOCKED_EVENT = "rpiv:ask-user:blocked" as const;

export interface AskUserBlockedEventPayload {
	/** True while input is awaited; false when the wait ends (answer, cancel, or error). */
	active: boolean;
}

export interface AskUserPromptQuestion {
	/**
	 * The full question text as the agent authored it, with line terminators
	 * normalized at tool entry (`\r\n` → `\n`, lone `\r` removed — #192). The
	 * same normalization applies to `header` and every option field below.
	 */
	question: string;
	/** The short chip/tag shown next to the question. */
	header: string;
	/** True iff the user may pick multiple options. Normalized from optional. */
	multiSelect: boolean;
	options: ReadonlyArray<AskUserPromptOption>;
}

export interface AskUserPromptOption {
	label: string;
	description: string;
	/** True iff the option carries rich preview content (content not shipped). */
	hasPreview: boolean;
}

/** Optional native-TUI request/reply protocol. Unlike notifications, replies carry a wire version. */
export const ASK_USER_REQUEST_EVENT = "rpiv:ask-user:request" as const;
export const ASK_USER_RESPONSE_EVENT = "rpiv:ask-user:response" as const;

export type AnswerInput =
	| { questionIndex: number; kind: "option"; optionIndex: number }
	| { questionIndex: number; kind: "custom"; text: string }
	| { questionIndex: number; kind: "multi"; optionIndices: number[] };

export type AskUserRequest = { version: 1; id: string } & (
	| { kind: "query" }
	| { kind: "submit"; toolCallId: string; answers: AnswerInput[] }
);
export type AskUserResponse = { version: 1; id: string } & (
	| { ok: true; pending: Array<{ toolCallId: string; params: import("./tool/types.js").QuestionParams }> }
	| { ok: true; accepted: true }
	| { ok: false; error: "invalid" | "stale" | "unsupported" }
);
