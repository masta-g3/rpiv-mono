import type { Theme } from "@earendil-works/pi-coding-agent";
import type { MarkdownTheme } from "@earendil-works/pi-tui";
import { makeTheme } from "@juicesharp/rpiv-test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

let markdownConstructed = 0;
vi.mock("@earendil-works/pi-tui", async (orig) => {
	const actual = (await orig()) as Record<string, unknown>;
	class FakeMarkdown {
		constructor(public text: string) {
			markdownConstructed++;
		}
		render(width: number): string[] {
			const lines = this.text.startsWith("line 1\n") ? this.text.split("\n") : [this.text];
			return lines.map((line) => `MD[${width}]:${line.slice(0, Math.max(0, width - 4))}`);
		}
		invalidate(): void {}
		setText(t: string): void {
			this.text = t;
		}
	}
	return { ...actual, Markdown: FakeMarkdown };
});

import type { QuestionData } from "../../../tool/types.js";
import { NOTES_AFFORDANCE_TEXT, PreviewBlockRenderer } from "./preview-block-renderer.js";

const theme = makeTheme() as unknown as Theme;
const markdownTheme = {
	heading: (t: string) => t,
	link: (t: string) => t,
	linkUrl: (t: string) => t,
	code: (t: string) => t,
	codeBlock: (t: string) => t,
	codeBlockBorder: (t: string) => t,
	quote: (t: string) => t,
	quoteBorder: (t: string) => t,
	hr: (t: string) => t,
	listBullet: (t: string) => t,
	bold: (t: string) => t,
	italic: (t: string) => t,
	strikethrough: (t: string) => t,
	underline: (t: string) => t,
} as unknown as MarkdownTheme;

const previewQuestion: QuestionData = {
	question: "pick",
	header: "pick",
	options: [
		{ label: "A", description: "", preview: "## A\n\nbody A" },
		{ label: "B", description: "", preview: "## B\n\nbody B" },
		{ label: "C", description: "" },
	],
};

const noPreviewQuestion: QuestionData = {
	question: "pick",
	header: "pick",
	options: [
		{ label: "A", description: "" },
		{ label: "B", description: "" },
	],
};

beforeEach(() => {
	markdownConstructed = 0;
});

describe("PreviewBlockRenderer — preview gating", () => {
	it("hasAnyPreview returns true when at least one option carries preview", () => {
		const r = new PreviewBlockRenderer({ question: previewQuestion, theme, markdownTheme });
		expect(r.hasAnyPreview()).toBe(true);
	});

	it("hasAnyPreview returns false when no option carries preview", () => {
		const r = new PreviewBlockRenderer({ question: noPreviewQuestion, theme, markdownTheme });
		expect(r.hasAnyPreview()).toBe(false);
	});

	it("has(i) is true for preview-bearing option, false for option without preview", () => {
		const r = new PreviewBlockRenderer({ question: previewQuestion, theme, markdownTheme });
		expect(r.has(0)).toBe(true);
		expect(r.has(2)).toBe(false);
	});
});

describe("PreviewBlockRenderer.renderBlock", () => {
	it("emits bordered box + blank + affordance when focused on preview-bearing option", () => {
		const r = new PreviewBlockRenderer({ question: previewQuestion, theme, markdownTheme });
		const lines = r.renderBlock(60, 0, "side-by-side", true, false);
		expect(lines.some((l) => l.startsWith("┌"))).toBe(true);
		expect(lines.some((l) => l.startsWith("└"))).toBe(true);
		expect(lines.some((l) => l.includes(NOTES_AFFORDANCE_TEXT))).toBe(true);
	});

	it("hides affordance when notesVisible=true (notes mode active)", () => {
		const r = new PreviewBlockRenderer({ question: previewQuestion, theme, markdownTheme });
		const lines = r.renderBlock(60, 0, "side-by-side", true, true);
		expect(lines.some((l) => l.includes(NOTES_AFFORDANCE_TEXT))).toBe(false);
	});

	it("hides affordance when focused=false (cursor elsewhere)", () => {
		const r = new PreviewBlockRenderer({ question: previewQuestion, theme, markdownTheme });
		const lines = r.renderBlock(60, 0, "side-by-side", false, false);
		expect(lines.some((l) => l.includes(NOTES_AFFORDANCE_TEXT))).toBe(false);
	});

	it("hides affordance when focused option lacks a preview (height contract preserved)", () => {
		const r = new PreviewBlockRenderer({ question: previewQuestion, theme, markdownTheme });
		const linesA = r.renderBlock(60, 0, "side-by-side", true, false);
		const linesB = r.renderBlock(60, 2, "side-by-side", true, false);
		expect(linesA.some((l) => l.includes(NOTES_AFFORDANCE_TEXT))).toBe(true);
		expect(linesB.some((l) => l.includes(NOTES_AFFORDANCE_TEXT))).toBe(false);
		expect(linesA.length).toBe(linesB.length);
	});
});

describe("PreviewBlockRenderer scrolling", () => {
	const longQuestion: QuestionData = {
		question: "pick",
		header: "pick",
		options: [
			{ label: "A", description: "", preview: Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n") },
		],
	};

	it("renders a position range with overflow cues and scrolls by line, page, and endpoint", () => {
		const r = new PreviewBlockRenderer({ question: longQuestion, theme, markdownTheme });
		const first = r.renderBlock(60, 0, "side-by-side", false, false, 5).join("\n");
		expect(first).toContain("lines 1–5 of 30");
		expect(first).toContain("↓");
		r.scroll(0, 1, 5, 60);
		expect(r.renderBlock(60, 0, "side-by-side", false, false, 5).join("\n")).toContain("lines 2–6 of 30");
		r.scroll(0, "page-down", 5, 60);
		expect(r.renderBlock(60, 0, "side-by-side", false, false, 5).join("\n")).toContain("lines 7–11 of 30");
		r.scroll(0, "end", 5, 60);
		const end = r.renderBlock(60, 0, "side-by-side", false, false, 5).join("\n");
		expect(end).toContain("lines 26–30 of 30");
		expect(end).toContain("↑");
	});
});

describe("PreviewBlockRenderer.blockHeight", () => {
	it("matches renderBlock(...).length under all gating combinations", () => {
		const r = new PreviewBlockRenderer({ question: previewQuestion, theme, markdownTheme });
		for (const idx of [0, 1, 2]) {
			for (const mode of ["side-by-side", "stacked"] as const) {
				expect(r.blockHeight(60, idx, mode)).toBe(r.renderBlock(60, idx, mode, true, false).length);
			}
		}
	});
});

describe("PreviewBlockRenderer — cache lifecycle", () => {
	it("creates one Markdown per option lazily; revisit hits cache", () => {
		const r = new PreviewBlockRenderer({ question: previewQuestion, theme, markdownTheme });
		r.renderBlock(60, 0, "side-by-side", true, false);
		expect(markdownConstructed).toBe(1);
		r.renderBlock(60, 1, "side-by-side", true, false);
		expect(markdownConstructed).toBe(2);
		r.renderBlock(60, 0, "side-by-side", true, false);
		expect(markdownConstructed).toBe(2);
	});

	it("invalidate() does NOT delete instances; subsequent renders re-use cache", () => {
		const r = new PreviewBlockRenderer({ question: previewQuestion, theme, markdownTheme });
		r.renderBlock(60, 0, "side-by-side", true, false);
		expect(markdownConstructed).toBe(1);
		r.invalidate();
		r.renderBlock(60, 0, "side-by-side", true, false);
		expect(markdownConstructed).toBe(1);
	});
});
