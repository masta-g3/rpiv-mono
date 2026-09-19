# Scroll questionnaire previews

## Outcome

Implemented keyboard-first preview scrolling in the maintained Hub fork of `rpiv-ask-user-question`, using the existing picker, preview renderers, reducer, and dialog focus window.

- Tab switches choices/preview focus; arrows scroll one line, Page Up/Down scroll a page, and Home/End reach endpoints.
- Enter leaves preview focus without answering. Left/right arrows retain question-tab navigation.
- Highlighted borders, displayed-line ranges, and overflow cues replace inaccessible hidden-line truncation.
- Preview height adapts to the terminal, including short stacked layouts and wrapped questions. Each option retains its scroll position; the end remains anchored across resize.
- Updated user controls/layout docs and added the approved local guidance against accepting zero-test verification.
- Hardened the pre-push coverage hook after the task exposed leaked repository-local Git variables: the hook now clears only Git's documented local variables before tests, with a regression test that executes the real hook under a poisoned environment.

Mouse support was explicitly deferred: this fork's Pi 0.80.6 dependencies have no native mouse-event API. No raw mouse parser, dependency upgrade, fullscreen viewer, or live installation change was introduced. Existing answer, notes, custom-input, collapse, and Hub producer contracts remain intact.

## Verification and review

- Unchanged base `23af834e`: 37 question-package test files / 689 tests passed in a temporary archive. The initial workspace test script had run no tests; durable local guidance now requires the root Vitest path and an executed-test count.
- Final question-package suite: 37 files / 708 tests passed. Final monorepo suite after hook hardening: 273 files / 6,685 tests passed.
- TypeScript, Biome on changed TypeScript, and `git diff --check` passed.
- Isolated real-terminal smoke passed at 120×30, 80×24, 80×18, 80×16, 80×14, and 80×12: scrolling, endpoints, resize, per-option offsets, and Enter safety.
- Review reproduced wrapped-heading clipping, corrected rendered-height measurement, and added seven single-/multi-question reachability cases at narrow/wide short sizes.
- Code critic and docs critic returned LGTM. Temporary validation artifacts were removed. The hook regression failed before its source fix and passed after it.

## Scope and repository

Untracked task; no feature backlog record. Work stayed in the user-approved existing checkout `~/Code/agents/rpiv-mono/agent-work/worktrees/cockpit-013/rpiv-mono`, branch `cockpit-013`. The user approved a new PR against `main` in `masta-g3/rpiv-mono`; installation and merge remain separate actions.
