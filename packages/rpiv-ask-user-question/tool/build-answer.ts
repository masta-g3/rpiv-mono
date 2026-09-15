import type { AnswerInput } from "../events.js";
import type { QuestionAnswer, QuestionData } from "./types.js";

/** Callers validate indices; labels and previews always come from the original question. */
export function buildAnswer(q: QuestionData, input: AnswerInput): QuestionAnswer {
	const { questionIndex } = input;
	if (input.kind === "custom") return { questionIndex, question: q.question, kind: "custom", answer: input.text };
	if (input.kind === "multi")
		return {
			questionIndex,
			question: q.question,
			kind: "multi",
			answer: null,
			selected: [...new Set(input.optionIndices.map((i) => q.options[i].label))],
		};
	const o = q.options[input.optionIndex];
	return {
		questionIndex,
		question: q.question,
		kind: "option",
		answer: o.label,
		preview: o.preview && o.preview.length > 0 ? o.preview : undefined,
	};
}
