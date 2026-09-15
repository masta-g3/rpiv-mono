# Hosts and runtime behavior

Where the questionnaire renders, what it degrades to, and what happens when it cannot
render at all.

## Three environments

| Environment | What the model sees | What you see |
| --- | --- | --- |
| Interactive terminal | `ask_user_question` in its tool list | The full tabbed TUI overlay |
| RPC / ACP host (VS Code pendant, Zed, Paseo) | `ask_user_question` in its tool list | A sequence of the host's own native select and input dialogs |
| Non-interactive run (no UI) | Nothing — the tool is removed | Nothing |

### Terminal attention

After UI availability and questionnaire validation succeed, the package emits exactly one standard terminal BEL (`\x07`) immediately before the interactive wait begins. The signal is sent to `stdout` only when `process.stdout.isTTY` is true, so redirected output and non-TTY RPC streams stay untouched. A TTY-backed RPC dialog walker receives the same signal as the TUI path.

The BEL is best effort: if the synchronous terminal write fails, the questionnaire continues and its existing prompt/blocked lifecycle and result envelope are unchanged. The terminal configuration decides whether the BEL is audible, visual, or ignored. No BEL is emitted for missing UI, invalid questionnaires, or a failed TUI session load.

### Non-interactive runs

A `before_agent_start` hook reconciles the active tool set against `ctx.hasUI` before every
turn. When there is no UI, `ask_user_question` is stripped from the list so the model never
sees a tool it cannot use — better than offering it and auto-declining every call. When UI
comes back, the tool is restored. The reconciler is idempotent and leaves sibling tools
untouched.

A second guard lives inside the tool handler as a one-turn backstop: if a call somehow
arrives without UI, it returns `error: "no_ui"` and the text
`Error: UI not available (running in non-interactive mode)`.

### RPC and ACP hosts

RPC hosts report `hasUI: true` because Pi's dialog sub-protocol works there, but custom
terminal UI does not render. The package detects this two ways: hosts that advertise
`ctx.mode === "rpc"` route straight to the dialog walker, skipping the TUI import
entirely, and older RPC builds are caught by a backstop when custom UI resolves without
rendering anything. Either path requires the host to expose both `select` and `input`.

The walker asks one question per dialog and returns exactly the same result envelope the
TUI produces. Trade-offs inherent to the native primitives:

- No side-by-side preview pane. Previews are folded into the dialog title instead,
  truncated at 600 characters each.
- No tab bar and no Submit review tab — one dialog per question, in order.
- No notes. Both note kinds — per-question `n` on a question tab and global `n` on the
  Submit tab — are terminal-only; the host's native `select` and `input` primitives carry
  no note field.
- Multi-select is a free-text input: type the option numbers, comma-separated
  (`1,3`). Any token that is not a valid option index is treated as a typed custom answer,
  which is how the `Type something.` escape survives. An empty input commits an empty
  selection, matching `Next` with nothing toggled.
- Dismissing any dialog cancels the whole questionnaire, mirroring `Esc` in the TUI.

If the host can render neither custom UI nor dialogs, the call returns
`error: "no_custom_ui"` with text telling the model the user never saw the questions and
that it should ask them as plain chat text instead — explicitly not a decline.

## Conditional surfaces

Some parts of the dialog exist only under the right conditions:

| Surface | Appears when |
| --- | --- |
| Tab bar and Submit tab | The call carries more than one question |
| `Next` row | The question is multi-select |
| `Type something.` row | Always |
| Side-by-side preview | An option carries a `preview`, and terminal and pane are both ≥ 100 columns |
| Preview pane at all | Single-select questions only |
| Collapse shortcut | `collapseKey` is not `"off"` |
| Full overlay hide on collapse | The host also exposes raw terminal input (the only path that can reopen a hidden overlay); without it, collapsing shrinks the dialog to a visible one-line row instead |
| Localized chrome | `@juicesharp/rpiv-i18n` is installed |

## Loading and startup cost

The dialog's render graph costs roughly 560 ms to import, so it is loaded lazily — on the
first tool call, not when the extension registers. To keep that first call fast and safe,
the graph is also pre-warmed in the background two seconds after startup. The pre-warm
timer is unref'd, so it never holds a process open, and a failed pre-warm is swallowed:
the first real call re-imports and reports properly.

The pre-warm exists for a specific failure. Pi's module loader registers a module in its
graph cache *before* evaluating it and does not evict it if evaluation throws. If your
package manager replaces the dependency store while Pi is running, one failed import can
poison the cache for the rest of the process. Evaluating the graph early, while the paths
Pi resolved at boot still exist, keeps it in memory for the process lifetime and makes
that unreachable.

When it does happen, you get a structured envelope rather than a raw `TypeError`:

| `error` | Meaning | Fix |
| --- | --- | --- |
| `session_load_failed` | The dialog module could not be imported. | Repair the install if needed, then restart Pi. |
| `stale_module_cache` | The module cache went stale after an earlier failed import. | Restart Pi — this is unrecoverable in the running process. |

Both messages tell the model the questions were never shown and to ask them as plain chat
text instead of treating the failure as a decline.

## Optional external answers (patched fork)

The maintained `2.10.0-hub.1` fork retains the original package name,
`@juicesharp/rpiv-ask-user-question`. It adds a producer-owned Pi event-bus
protocol. It has no Hub dependency, network listener, or saved question store.
Native questionnaires and RPC dialogs keep their existing result format.

The public types and channel constants are exported from the package's `events`
subpath and main entry. Subscribe to responses **before** emitting a request:
responses can arrive synchronously. Match the response `id` to the request.

- Request channel: `rpiv:ask-user:request`.
- Response channel: `rpiv:ask-user:response`.
- Query: `{version: 1, id: string, kind: "query"}`.
- Submit: `{version: 1, id: string, kind: "submit", toolCallId: string, answers: AnswerInput[]}`.
- Query success: `{version: 1, id, ok: true, pending: [{toolCallId, params}]}`.
- Submit success: `{version: 1, id, ok: true, accepted: true}`.
- Failure: `{version: 1, id, ok: false, error: "invalid" | "stale" | "unsupported"}`.

`params` contains the full normalized, validated `QuestionParams`, including
previews. Each zero-based question index must appear exactly once in `answers`:

```ts
type AnswerInput =
  | { questionIndex: number; kind: "option"; optionIndex: number }
  | { questionIndex: number; kind: "custom"; text: string }
  | { questionIndex: number; kind: "multi"; optionIndices: number[] };
```

Single choices require a single-select question. Multi choices require a
multiselect question; empty selections are valid, repeated or out-of-range
indices are not. Custom text must be nonblank and is preserved verbatim.
Unknown fields are ignored; labels, question text and previews are always built
from the original request, never trusted from the answer sender.

Capability is TUI-only (`ctx.mode === "tui"` and `hasUI`). RPC, print, JSON and
older hosts without an explicit mode are unsupported. Before session startup,
queries also return unsupported. Only a native component with its completion
callback available appears in `pending`; lazy loading is not answerable.
Consumers can query after startup even if they missed the prompt notification.
Malformed messages without a string correlation ID get no reply. Unsupported
versions get `unsupported`.

The first full native or external submission wins. Native drafts are not synced.
Acceptance removes the pending request before invoking the same native `done`
callback, which resolves the actual tool and closes its overlay. Abort, session
replacement/tree navigation and shutdown cancel pending native waits. Shutdown
also removes the request listener. Late submissions are stale. There is no remote
cancel operation: closing an external form must leave the real question open.
The existing prompt and blocked notification payloads are unchanged.

### Distributing the fork

Build one npm tarball from this package and keep that exact immutable artifact
(with a recorded SHA-256) for both machines. Pi treats local files as extension
source files, so **do not pass the `.tgz` directly to `pi install`**. Use npm to
install it into a new, versioned directory, then register that package directory
with Pi. The original package's installed files remain untouched.

After installation is approved, use the same verified artifact on each machine:

```sh
# Verify this checksum against the maintainer's recorded SHA-256 first.
shasum -a 256 /path/to/juicesharp-rpiv-ask-user-question-2.10.0-hub.1.tgz
PATCH_HOME="$HOME/.local/share/pi-hub-questions/2.10.0-hub.1"
mkdir -p "$PATCH_HOME"
npm install --prefix "$PATCH_HOME" --save-exact \
  /path/to/juicesharp-rpiv-ask-user-question-2.10.0-hub.1.tgz
```

Close running Pi sessions before changing their package configuration. Save a
copy of Pi's settings, then use `pi list` to find the original source. Remove
that source with `pi remove <original-source>` and remove any explicit extension
path that also loads it. Only then register the replacement:

```sh
pi install "$PATCH_HOME/node_modules/@juicesharp/rpiv-ask-user-question"
```

**Never register both copies of `ask_user_question`.** Start Pi again and verify
that one questionnaire tool is available. To roll back, close Pi, remove the
replacement source, and restore the original source from the saved settings.
A local versioned directory does not follow upstream updates. Keep its npm lock
file with the artifact if matching the dependency graph across machines matters.
These instructions do not authorize or perform installation or publication.
Other monorepo packages keep their own release versions.
