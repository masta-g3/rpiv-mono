import type { Theme } from "@earendil-works/pi-coding-agent";
import type { MarkdownTheme } from "@earendil-works/pi-tui";
import { t } from "../../../state/i18n-bridge.js";
import type { QuestionData } from "../../../tool/types.js";
import {
	MAX_PREVIEW_HEIGHT_SIDE_BY_SIDE,
	MAX_PREVIEW_HEIGHT_STACKED,
	MarkdownContentCache,
	NOTES_AFFORDANCE_OVERHEAD,
} from "./markdown-content-cache.js";
import {
	BORDER_HORIZONTAL_OVERHEAD,
	BORDER_INNER_PADDING_HORIZONTAL,
	BORDER_VERTICAL_OVERHEAD,
	computeBoxDimensions,
	renderBorderedBox,
} from "./preview-box-renderer.js";
import type { PreviewLayoutMode } from "./preview-layout-decider.js";

/**
 * Affordance text shown below the bordered preview when focused on a preview-bearing option.
 * Re-exported by `preview-pane.ts` for the existing test surface.
 */
export const NOTES_AFFORDANCE_TEXT = "Notes: press n to add notes";

/** Content row budget for a layout mode: preview cap minus border + affordance overhead. */
function contentBudgetFor(mode: PreviewLayoutMode): number {
	const cap = mode === "side-by-side" ? MAX_PREVIEW_HEIGHT_SIDE_BY_SIDE : MAX_PREVIEW_HEIGHT_STACKED;
	return Math.max(1, cap - BORDER_VERTICAL_OVERHEAD - NOTES_AFFORDANCE_OVERHEAD);
}

/** Inner (padding-aware) content width for a total block width. */
function innerWidthFor(width: number): number {
	return Math.max(1, width - BORDER_HORIZONTAL_OVERHEAD - 2 * BORDER_INNER_PADDING_HORIZONTAL);
}

export type PreviewScrollAmount = -1 | 1 | "page-up" | "page-down" | "home" | "end";

export interface PreviewBlockRendererConfig {
	question: QuestionData;
	theme: Theme;
	markdownTheme: MarkdownTheme;
}

/**
 * Renders the bordered markdown preview block for a single question (one block per render call,
 * for the option at `optionIndex`). Owns a per-question `MarkdownContentCache`.
 *
 * NOT a `Component` — pure render-and-measure helper consumed by `PreviewPane`. The layout mode
 * is threaded as an explicit param (never re-derived from column width post-split).
 *
 * The affordance row is always emitted (visually empty when gated) so the preview block's row
 * count is height-stable across affordance-state transitions.
 */
export class PreviewBlockRenderer {
	private readonly theme: Theme;
	private readonly cache: MarkdownContentCache;
	private readonly scrollOffsets = new Map<number, number>();
	private readonly endPinned = new Set<number>();

	constructor(config: PreviewBlockRendererConfig) {
		this.theme = config.theme;
		this.cache = new MarkdownContentCache(config.question, config.theme, config.markdownTheme);
	}

	hasAnyPreview(): boolean {
		return this.cache.hasAnyPreview();
	}

	has(optionIndex: number): boolean {
		return this.cache.has(optionIndex);
	}

	invalidate(): void {
		this.cache.invalidate();
	}

	/**
	 * Height contribution of the preview block: `BORDER_VERTICAL_OVERHEAD + contentRows +
	 * NOTES_AFFORDANCE_OVERHEAD`. Always returns the same value as `renderBlock(...).length`
	 * — the affordance overhead is constant, not gated by `focused`/`notesVisible`.
	 */
	blockHeight(width: number, optionIndex: number, mode: PreviewLayoutMode, viewportRows?: number): number {
		const contentBudget = viewportRows ?? contentBudgetFor(mode);
		const innerWidth = innerWidthFor(width);
		const rawRows = this.cache.bodyFor(optionIndex, innerWidth).length;
		const contentRows = Math.min(rawRows, contentBudget);
		return BORDER_VERTICAL_OVERHEAD + contentRows + NOTES_AFFORDANCE_OVERHEAD;
	}

	/**
	 * Render the full preview block at `width`: bordered box + blank separator + affordance row.
	 * `focused` and `notesVisible` together gate the affordance text (visible only when the
	 * focused option carries a preview AND notes mode is inactive). The affordance row is ALWAYS
	 * emitted (as an empty string when gated) so the row count is invariant.
	 */
	renderBlock(
		width: number,
		optionIndex: number,
		mode: PreviewLayoutMode,
		focused: boolean,
		notesVisible: boolean,
		viewportRows?: number,
		previewFocused = false,
	): string[] {
		const contentBudget = Math.max(1, viewportRows ?? contentBudgetFor(mode));
		const maxInnerWidth = innerWidthFor(width);

		const raw = this.cache.bodyFor(optionIndex, maxInnerWidth);
		const maxStart = Math.max(0, raw.length - contentBudget);
		const start = this.endPinned.has(optionIndex)
			? maxStart
			: Math.min(this.scrollOffsets.get(optionIndex) ?? 0, maxStart);
		this.scrollOffsets.set(optionIndex, start);
		const contentLines = raw.slice(start, start + contentBudget);

		const { boxWidth } = computeBoxDimensions(contentLines, maxInnerWidth);
		const colorFn = (s: string) =>
			previewFocused ? this.theme.bg("selectedBg", this.theme.fg("accent", s)) : this.theme.fg("accent", s);
		const position =
			raw.length > contentBudget
				? { start: start + 1, end: start + contentLines.length, total: raw.length }
				: undefined;
		const boxedLines = renderBorderedBox(contentLines, boxWidth, colorFn, position);

		const showAffordance = focused && !notesVisible && this.cache.has(optionIndex);
		const affordance = showAffordance
			? this.theme.fg("muted", t("preview.notes_affordance", NOTES_AFFORDANCE_TEXT))
			: "";
		return [...boxedLines, "", affordance];
	}

	scroll(optionIndex: number, amount: PreviewScrollAmount, viewportRows: number, width: number): void {
		const budget = Math.max(1, viewportRows);
		const total = this.cache.bodyFor(optionIndex, innerWidthFor(width)).length;
		const current = this.scrollOffsets.get(optionIndex) ?? 0;
		const next =
			amount === "home"
				? 0
				: amount === "end"
					? total
					: current + (amount === "page-up" ? -budget : amount === "page-down" ? budget : amount);
		const maxStart = Math.max(0, total - budget);
		const clamped = Math.max(0, Math.min(next, maxStart));
		this.scrollOffsets.set(optionIndex, clamped);
		if (amount === "end" || ((amount === "page-down" || amount === 1) && clamped === maxStart)) {
			this.endPinned.add(optionIndex);
		} else {
			this.endPinned.delete(optionIndex);
		}
	}
}
