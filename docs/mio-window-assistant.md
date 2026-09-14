# Window-scoped MIO

**Status: Experimental.**

MIO can live inside a specific window, answer from that window's Markdown help, and perform its explicitly registered actions. A focused window must opt in. Global WordPress Abilities and slash-command registries are not used for these actions.

## Register a window

Call `wp.os.mio.registerWindow(windowId, context)` after the window body is connected. Use the **instance id**, `ctx.windowId`, rather than the app's base id. Registration rejects a host outside that window's body and duplicate leases. Return `lease.dispose` from the app's teardown.

```typescript
import type { MioAbility, MioDocument } from 'openstation';

const documents: MioDocument[] = [
    { id: 'index.md', title: 'Guide', markdown: '# Guide\nSee [Layout](layout.md).' },
    { id: 'layout.md', title: 'Layout', markdown: '# Layout\nCompact keeps the controls close together.' },
];

// Inside defineApp({ mounted(ctx) { … } }):
const lease = wp.os.mio.registerWindow(ctx.windowId, {
    host: ctx.root,
    title: 'My app',
    prompt: () => `You are MIO in My app. Current page: ${ctx.state.page}. Help with this app only.`,
    documents,
    abilities: () => myActionsForCurrentUser(),
});
return () => lease.dispose();
```

`lease.openChat(): Promise<void>` opens this context's floating chat only while its window is focused. It requires MIO to already be enabled and waits for the lazy bundle; it never changes the on/off preference. The dock's MIO toggle controls the companion, launcher and chat together. Only a focused registered window with the MIO API and AI available gets the accessible **Ask MIO** button. Its idle background is translucent while its text retains contrast; hover uses the opaque chat hover surface. The mascot stays hidden inside an idle window, fading in only for an open chat or an explicit callout. Disabling MIO closes chat and cancels pending work immediately.

Every registration automatically adds a MIO portrait toggle to that window’s title bar. `enabled?: boolean` initializes the per-window choice (default `true`). Registration is the app author’s opt-in; it does not show a separate end-user consent prompt. The user enables MIO globally and can disable it per window, or the app can register with `enabled: false` to start that window disabled. `lease.isEnabled()` reads that local choice; `lease.setEnabled(boolean)` changes it. The diagonal slash means disabled in this window. The choice belongs to the live lease and is not persisted. Disabling locally cancels work and releases residency without changing the dock’s master preference. The master switch fades all these controls out/in and preserves each window’s choice; invisible controls cannot receive keyboard focus or activation.

`wp.os.mio.getWindowId(): string | null` reports the selected owner; `null` means desktop. While MIO is switched off there is no active owner; registrations remain available for the next enable. Existing appearance, position and toggle methods remain available.

## Availability switches

The dock’s MIO button and Features → **MIO API** share one per-user master switch (`mioEnabled`, default `false`). `mioApiEnabled` is a synchronized compatibility alias: either name can be patched, and `mioEnabled` wins if both are supplied. Switching off closes chat, cancels pending work, hides the mascot and window controls, and suspends leases. Re-enabling resumes existing leases and preserves per-window choices and callout dismissals.

`mioShowOnWallpaper` (default `true`) controls only the desktop mascot. Turn off **Show MIO on wallpaper** in Features or MIO’s **Make it yours** panel to keep window chat and explicit callouts available without a desktop companion. The MIO dock tile’s right-click menu also offers Show/Hide MIO on wallpaper, so the preference remains reachable while the mascot is hidden.

**Ask MIO** additionally requires `ai.enabled`, available AI support, and `aiAssistant.assistantProviderConfigured` (a configured connector with text generation and function calling). Missing any of these hides the launcher and prevents programmatic `openChat()`. Losing AI availability closes an open chat and cancels pending work, while residency, title-bar controls and explicit callouts keep working. Settings subscriptions and the existing `os-ai-status-changed` event reconcile these gates live. The authenticated turn endpoint enforces the MIO API preference and AI/connector gates too.

## Explicit control callouts

`lease.showCallout({ id, target, message, onDismiss? })` requests a tip beside a control. `target` is a live resolver returning an `HTMLElement` within the registered host, or `null` when that view is absent. This survives app DOM updates without retaining a detached node. The companion sits at the target’s trailing edge with its compact bubble facing inward, leaving the leading text clear. The close control is a borderless circle. The tip follows window movement, resizing and scrolling, and hides when its target leaves the window body. MIO uses the same unlimited-range spring as chat. The dark speech bubble matching the chat surface contains plain text and an accessible close control; it never invokes AI or moves keyboard focus on arrival.

Both the global and local enable switches still apply. Chat takes priority and suspends the tip. Closing chat restores an eligible tip. Dismissing remembers its `id` in this lease’s memory until the window is closed and reopened; switching tabs or toggling MIO does not erase dismissal. `lease.clearCallout()` withdraws a tip without dismissing it. `onDismiss` runs after dismissal, allowing caller-specific behavior. Only one callout is requested per lease at a time; a new request replaces the previous one.

```typescript
lease.showCallout({
    id: 'about-blog',
    target: () => ctx.state.tab === 'about'
        ? ctx.root.querySelector('.os-settings__about-journal-head') : null,
    message: 'Visit our blog!',
});
```

Preferences uses this exact pattern: every visit to About presents the journal tip until dismissed, and reopening Preferences starts a new dismissal scope.

## Residency and lifecycle

The single `#os-mio` layer shrinks around the companion, moves into an overlay fitted to the owning window's body, and grows back. Each leg lasts 150 ms. Reduced motion skips both legs. The frame is separate from scrolling app content and follows body resizes. Inside a window, the runtime uses an empty obstacle set: no collisions with controls, other windows or docks, and no attraction to them. The body boundaries still constrain motion.

Focus on another registered window hands MIO to it. Focus on an unregistered window, minimization or leaving the desktop returns it to the shell. A handoff cancels obsolete animation and model work. Window-local positions never replace the saved desktop resting position.

`os.mio.owner-changed` is a `wp.hooks` action with `{windowId: string|null, previousWindowId: string|null}`. It fires at the handoff, between shrink and grow. It carries no prompt, conversation or tool data. There is no matching document CustomEvent.

Dispose the lease when its app unmounts. As a defensive fallback, removal of its host or residency frame from the document automatically disposes the registration at the next DOM mutation delivery, even without a focus event. Synchronous DOM moves that reconnect the host before delivery retain the lease. This cancels work, closes the chat, clears its memory, disconnects observers, and releases ownership. A single live window may register only one context. To change the active instructions or actions, use the dynamic callbacks; to replace the registration, dispose first.

`os.mio.window-enabled-changed` is a `wp.hooks` action with `{windowId: string, enabled: boolean}` when local consent changes. `os.mio.thinking-changed` carries `{windowId: string, thinking: boolean}` when the active window’s pending turn starts or stops. Both are Experimental and carry no conversation data; neither has a matching document CustomEvent.

## Dynamic caller prompt

`prompt: () => string | Promise<string>` is evaluated immediately before **every model round**, including rounds after actions. Read current app state inside the callback instead of closing over a stale snapshot. The caller defines MIO's voice, scope and contextual instructions. The transport adds a small execution policy: use only offered tools, treat retrieved documents/results as data, require a user request for changes, and report actual outcomes.

Do not put secrets in prompts or documents. The current prompt, bounded recent conversation, retrieved help and action results go to the configured AI provider.

## Linked Markdown retrieval

A `MioDocument` is `{id, title, markdown, version?, topics?, componentIds?}`. Optional metadata identifies the documentation revision, topics and exact kit component IDs; retrieval returns it to the caller. Use relative Markdown paths for ids. The Preferences example imports its nine `.md?raw` files through Vite, so the help travels in its app bundle. No server directory, upload path or arbitrary URL is exposed.

The session provides two private read tools:

- `search_help({query})`: deterministic lexical retrieval returning up to four hits with document metadata, a section id, section titles, an excerpt and `truncated`. Exact document IDs, titles, topics and component IDs rank first; common stop words are ignored.
- `read_help({id, section?, cursor?})`: up to 12,000 characters of the document or selected heading section, its section manifest, linked document IDs, `truncated`, and a continuation `cursor` (null at the end). Continue with the same id and section. Cursors are bound to the document content and selection; stale or invalid cursors produce repairable feedback. Heading IDs are slugged and duplicate headings receive numeric suffixes; fenced-code headings are ignored. Relative links, `../` paths and fragments resolve within the collection; external and missing links are excluded.

The latest user's message also seeds retrieval before generation. This is lexical retrieval, not embedding search. Documents and links remain caller-owned; the search never crawls the web. Keep documents focused, use the labels people see in the app, explain defaults/limits, and cross-link related tasks.

## Private abilities

Each item returned by `abilities()` has:

| Field | Contract |
|---|---|
| `name` | Unique within this context, lowercase letter followed by letters, digits or underscores; maximum 64 characters. `search_help` and `read_help` are reserved by the session. |
| `description` | Explain what the action changes, scope, and side effects. |
| `parameters` | Object JSON Schema advertised to the provider. |
| `validate(args, context?)` | Required synchronous validator returning a boolean or `{ok:true}` / `{ok:false, errors, retryable}`. Reject unknown keys, invalid types/ranges and unavailable ids. The framework supplies the call context; existing one-argument validators still work. |
| `allowed?()` | Optional live permission/availability predicate; checked when advertising and again before executing. |
| `run(args, signal, context)` | Execute only after validation. Existing two-argument implementations still work. Honor cancellation before submitting writes; use the stable context IDs and revision to bind app-owned operations. |
| `effect?` | `read`, `validate`, `write` or `none` (nonpersistent UI operations). Omission conservatively means `write`. Reads can refresh; writes cannot be replayed automatically. |
| `history?(entry, context)` | Return a compact object replacing this call’s default history representation. `entry` contains name, callId, args and result. Preserve authoritative outcomes and use app-owned references for large documents. For a semantic no-effect rejection, compact data is attached to the mandatory error feedback. |

The action list is rebuilt each round and before each call. A model response cannot invoke unoffered tools or fall back to global commands. For server writes use the app's authenticated actions or existing REST endpoints; their capability and nonce checks remain authoritative. Browser registration is an application scope boundary, not isolation from another trusted same-origin plugin's JavaScript.

**These tools are not WordPress Abilities.** No `wp_register_ability()` or global command registration occurs. WordPress Abilities discovery cannot list them, and its execution route cannot invoke them. This is how write-capable MIO tools remain private while the separate site-wide AI search keeps its read-only WordPress ability policy.

## Chains, cancellation and honest results

The client allows at most sixteen attempted calls across eight provider rounds per user message. Rejected arguments consume the call budget. Three validation failures exhaust the per-turn correction allowance, even if the model opens another edit or calls a different validator. Two rejected candidates can therefore be repaired before the third candidate succeeds. A rejected call stops the remainder of that response's batch and returns feedback before any dependent action runs.

Argument errors use `{code, path, message, suggestion?}` (for example `$.fields[2].name`). Malformed JSON, a non-object envelope or arguments over 96,000 UTF-8 bytes are repairable only after identifying an offered, currently allowed tool. Oversized arguments require a smaller patch or draft reference, not silent slicing. Boolean `false` becomes a generic schema error at `$`; structured validators provide precise paths. Feedback is bounded to twenty errors, with bounded code/path/message/suggestion lengths. `retryable:false`, unavailable actions, permission failures and cancellation are terminal. An exception thrown by `run` is always terminal: it cannot establish that no write happened.

A tool performing semantic validation inside `run` may explicitly return `{effect:'none', status:'rejected', errors, retryable:true, data?}`. This means **no write was submitted** and shares the same correction allowance. Do not use this outcome for a timeout or uncertain server response. The same rejected candidate can receive feedback again until the budget is exhausted; it is never described as a completed save.

Reads and validation-only calls may repeat up to four times for the same name/arguments, within the overall call budget. Identical writes are compared with object keys normalized and are blocked once attempted, unless an explicit no-effect rejection proved that nothing was written. Failure messages distinguish completed reads, rejected candidates, confirmed writes and unknown write outcomes.

Successful writes return `{effect:'write', status:'confirmed', receipt, data?}`. Receipts are nonempty strings of at most 500 characters, unique per logical write. Reusing a receipt for another call is terminal and cannot count as another confirmed write. Prefer an authoritative server receipt. Existing `{saved:true, ...}` results remain accepted as explicit acknowledgements and receive a client call-ID receipt; that acknowledgement is **not server-side idempotency**. An unacknowledged write or `{effect:'write', status:'unknown'}` stops the turn. A successful non-writing no-op can return `{effect:'none', status:'completed', data?}`.

A chain is not a transaction. Earlier completed actions remain applied if a later one fails or the user presses Stop. Closing chat, moving focus or disposing the window aborts the pending request and prevents late replies from dispatching more actions. Already submitted server writes may still complete; cancellation is not rollback. Return meaningful results rather than an optimistic “done.” Each history result is serialized immediately, preserving historical read results even when later actions mutate the same store. Preferences waits for the existing save lifecycle and compares the requested values with the completed save’s `savedSettings` snapshot before returning a saved result. Its result includes `changed` and `changes: [{setting, before, after}]`, captured from before the optimistic update. Use this evidence to distinguish a change from an already-selected value; the dynamic prompt’s current state is refreshed after the action.

## Turn identity and operation lifecycle

`run` receives `{turnId, callId, idempotencyKey, windowId, revision, signal, limits, validationFailures, validationRemaining}` as its third argument. `turnId` is created by the shell once per user message; call IDs and idempotency keys identify individual invocations. Apps cannot reset the correction allowance by beginning another edit. Residency supplies the actual window instance ID. Optional `revision: () => string` is evaluated for the live document/window state; the app must enforce optimistic concurrency on the server as well.

A context may supply these synchronous observers:

- `onTurnBegin(context)` once before the first provider request.
- `onTurnAbort(context)` once when stopped, disposed or losing focus/availability. This fires immediately, including while a submitted write is unresolved.
- `onTurnEnd(summary)` once when the asynchronous turn settles, with `status` (`completed`, `failed`, `aborted`), call and validation counts, reads, confirmed writes and unknown write outcomes. If a transport never settles, abort still fires; end awaits settlement.
- `onOperation(operation)` when an identified call starts or resolves. Observer exceptions do not control execution or cause retries.

`lease.getOperations()` returns defensive copies of up to 64 content-free records: turn/call/idempotency IDs, window/revision, ability, declared effect, status and optional receipt. This memory-only ledger contains neither arguments nor conversation. It remains inspectable through a retained lease after disposal; it is released when the lease/session is garbage collected. Closing the window still clears the chat transcript.

Set `operationStatus: async (operation, signal) => outcome` to call your application's **read-only**, authenticated operation-status endpoint. `lease.inspectOperation(callId, signal?)` uses that resolver to reconcile an unresolved write; it never invokes `run`. A definitive no-effect rejection marks the operation rejected; an authoritative confirmation records its receipt. Repeated inspection of a confirmed operation returns the receipt, and a late cancellation/network failure cannot erase it. Status inspection can work through a retained lease after closing the window. For reconciliation across reloads, the application must retain its own operation identifiers and endpoint; MIO does not persist them.

Use `context.idempotencyKey` as the server's logical-operation key, alongside capability checks, current document revision and payload identity. A status endpoint must authorize access to that operation. Possessing an ID grants no permission, and an unknown outcome never authorizes automatic replay. The framework supplies these client extension points; it does not install a generic write or operation-status route on behalf of apps.

## Complete documents and request budgets

Default tool history retains the result, call identity and effect/status evidence; it does **not** resend the tool's full input arguments. An ability's `history` callback can retain `{editId, documentHash, byteLength, errors}` instead of another copy of YAML. A window's `compactHistory(history, turnContext)` may replace the complete model-facing history representation, for example retaining only the latest necessary full candidate while keeping older receipts and validation errors. These callbacks affect the model context, not the visible conversation. They are synchronous and application-owned; preserve any fields the model needs, or supply a read tool for their immutable resource reference. The framework never silently slices a form definition to fit.

Before every transport call, MIO measures serialized UTF-8 bytes against the PHP limits: prompt 16,000; transcript 96,000; tool definitions 96,000 (including PHP's Unicode/slash escaping); complete JSON request 220,000. The built-in transport checks again before HTTP. Overflow throws `MioBudgetError` with `code:'mio_request_budget'`, `scope`, `usedBytes`, `limitBytes` and `remainingBytes`. No provider request is sent and no candidate is silently truncated. A large committed result can still exceed the next-round budget; its receipt remains in the ledger for accurate reconciliation.

For larger forms, use app-owned draft resources, edit IDs, revisioned reads and diff/patch operations instead of repeating complete documents. The [form editing recipe](examples/mio-form-editing.md) demonstrates the lifecycle, repair and compaction contracts. The regression suite edits a complete UTF-8 document larger than 40 KB through two repair attempts and help reads without exceeding the transcript cap or dropping fields.

## Conversation and themed chat

MIO eases toward a chat anchor through the soft-body simulation’s damped spring, preserving position and momentum. The anchor has no distance cutoff: dragging takes precedence, and releasing returns MIO beside chat. Canvas resizes repaint synchronously before browser paint to avoid empty frames. Resizes retarget the spring; closing chat fades the mascot out, or resumes the caller’s active callout. The return spring retains the pre-chat position relative to the current window. A subsequent drag releases that return anchor. Handoffs and the master switch clear obsolete anchors. Narrow windows keep MIO’s original home when there is no room beside the panel.

A pending turn blends a visible pondering pose into the mascot itself: its silhouette breathes and tilts with its face, the eyes look around and softly narrow, and its existing ring colours sweep gently. Matching chat dots and a title-bar pulse accompany the mascot. The pose transforms only the drawing, preserving the physics position and chat anchor. Stop, close, focus changes and disabling MIO end this transient state. Reduced motion retains a static tilted, upward-looking expression and still dots. A disabled halo stays disabled; the face and silhouette still express thinking. Thinking never overwrites the user’s appearance settings.

The floating, nonmodal conversation uses the component kit's buttons and auto-growing textarea, the shared escaped Markdown renderer for assistant replies, a polite live log, a keyboard-accessible launcher, Escape to close, and Stop while a turn is running. New messages reveal their beginning rather than jumping to the end of a long reply; the reader then controls scrolling. It is separate from the decorative `aria-hidden` MIO canvas. Closing chat preserves its window's memory; closing the window or reloading removes it. Different windows never share backscroll.

The default `MioConversationStore` is bounded, in-memory storage with `read`, `write` and `clear`; the session accepts that interface internally as the future persistence seam. There is currently **no persistent store and no persistence opt-in on window registration**. Preferences never writes transcripts to localStorage, sessionStorage, user meta, options or logs. The `/mio/turn` route makes no application transcript records and returns `Cache-Control: no-store, private`. Provider retention and independently installed request logging are outside this application-level guarantee.

Declare overrides on the desktop theme or an ancestor; do not pin defaults on a component host:

| Token | Default source | Purpose |
|---|---|---|
| `--os-mio-chat-bg` | `--os-ui-modal-bg` | Conversation and launcher surface. |
| `--os-mio-chat-hover-bg` | 90% chat background, 10% foreground | Opaque hover surface for the launcher and ghost chat controls; keeps their label readable over light windows. |
| `--os-mio-chat-fg` | `--os-ui-modal-text` | Message text. |
| `--os-mio-chat-muted` | `--os-ui-modal-text-muted` | Context, status and privacy text. |
| `--os-mio-chat-border` | 40% accent | Subtle edge. |
| `--os-mio-chat-user-bg` | 15% accent | User message wash. |
| `--os-mio-chat-glow` | 10% dimmed accent | Ambient shadow. |
| `--os-mio-chat-radius` | Window radius, minimum 18px | Conversation corners. |

`--os-mio-launcher-bg` controls the translucent launcher surface. `--os-mio-callout-bg`, `--os-mio-callout-fg` and `--os-mio-callout-border` control the dark tip, readable text and accent edge.

Token declarations live only in `assets/css/variables.css`, scoped to `body.os-active`. Consuming rules retain WordPress-era literal fallbacks. Defaults derive from existing modal and accent tokens, so Legacy and other themes remain coherent without changing the frozen Legacy manifest.

## Transport

`POST desktop-mode/v1/mio/turn` accepts `{prompt, transcript, tools}` and returns `{message, calls:[{name, arguments}]}`. `arguments` is JSON text. The endpoint generates intentions only; it never dispatches a write. It uses the existing AI permission gate: authenticated user with `read`, compatible configured AI support, the user's enabled assistant preference, the MIO API preference and a compatible configured connector. REST cookie authentication requires the normal `X-WP-Nonce` header.

Limits: eight provider rounds and sixteen tool executions per message; 220 KB request body; 16 KB prompt; 96 KB transcript; at most 100 tool definitions totaling at most 96 KB. Invalid input returns 400, an oversized body 413, and an unoffered model tool 502. The existing `openstation_ai_model_config` filter receives `source: 'mio/window'` and a request id, without transcript fields. MIO does not emit the site's AI search logging hooks.

## Preferences as the reference app

See [`apps/os-settings/parts/mio.ts`](../apps/os-settings/parts/mio.ts), the action modules beside it, and the [linked user help](../apps/os-settings/help/index.md). The example covers all built-in non-destructive Preferences controls. File uploads deliberately open the picker for user selection; arbitrary third-party tab/dialog controls require their own validated actions. Deleting themes, purging shares and resetting all preferences are excluded.

Tests exercise context handoff, late replies, sequential saves, invalid arguments, capability loss, help links, private discovery and memory-only history. The worked recipe is [Register a window companion](examples/mio-window-assistant.md).

## Assistant response buttons

`MioWindowContext.responseActions(context)` optionally supplies frontend controls for a settled assistant message. It runs synchronously **once per message**, after constructing the final message and summary and before `onTurnEnd`. It receives `{messageId, summary, operations}`: a stable shell-generated message ID, a frozen turn summary and frozen, content-free operation snapshots from **this turn only**. It also runs for a retained failure reply, allowing an explicitly labelled read-only status control. It does not run after disposal or for discarded late replies. Throwing from the callback or returning an invalid descriptor cannot alter the answer or confirmed receipts.

Derive a success action from confirmed operations and an app-owned receipt-to-resource map. Never infer a saved resource from assistant prose, model arguments or the currently selected item. For a Preview button, require a completed turn without unknown writes and bind the original saved form ID in its closure. A failed validation must not create a success action; unknown saves require reconciliation first. The app owns this policy because read-only status/help controls are also useful after failure.

A `MioResponseAction` descriptor contains:

| Field | Contract |
|---|---|
| `id` | Unique within this message; nonblank string of at most 80 characters. |
| `label` | Plain text, 1–40 characters. Never interpreted as HTML. |
| `ariaLabel?` | Optional full accessible name, 1–160 characters. |
| `icon?` | Dashicon name with optional `dashicons-` prefix, using lowercase letters, digits and hyphens. Invalid names are omitted; unknown kit names show no glyph. No SVG, URLs or HTML. |
| `emphasis?` | `primary` or `secondary` (default). Only the first primary keeps that emphasis. |
| `effect` | `read` or `navigate`. The callback must not save, publish, submit or otherwise write. |
| `allowed?()` | Synchronous current permission/availability check at render and immediately before invocation. Exceptions deny access. |
| `run({signal, messageId, turnId})` | Frontend callback; no model request. Honor cancellation before fetching or opening a destination. |

The shell examines at most 100 descriptors, omits invalid entries and duplicate IDs, and retains at most three actions. Controls use `os-button` and existing chat/component tokens, wrap on narrow windows, and expose a “Suggested actions” group and polite per-action progress/error status. Availability is refreshed when rendering and on activation; app permissions still need authoritative server checks. Errors remain beside the button, preserve the assistant message and never enter provider history. Only another deliberate click retries an action. A pending button cannot start another invocation, including after cancellation while an app promise is still settling.

The shell invokes `run` directly in the click handler, preserving the user gesture until the callback's first await. Prefer a native preview window with a stable per-resource ID. Browser-tab fallbacks must preserve popup authorization themselves (for example opening a blank tab synchronously, navigating after an authenticated URL arrives, and closing it on failure). Successfully opening a destination may change focus and close this chat; that does not retroactively turn completed navigation into failure.

`MioChatMessage` gains optional `id` and `actionIds`. These are opaque references, not descriptors. Callbacks, labels, errors, nonce-bearing URLs and resource closures stay in a lease-local registry; the model-facing message history contains only role/text. Closing chat aborts pending button work but retains eligible callbacks for reopening. Disposing the lease removes them permanently. Evicting messages releases their callbacks; the registry retains actions for at most the last 40 messages even with a custom store. Store eviction is reconciled on message writes, render and click. Restoring serialized messages into another session cannot recreate controls. Stable message and button nodes preserve focus and scroll during status changes.

See [Preview a saved form](examples/mio-form-editing.md#preview-a-saved-form) for the consumer adapter. There is no provider/PHP transport change, no model-selected action catalog, and no write/destructive response-button API.

The MIO composer starts at one line and wraps up to two visible lines. Longer drafts scroll vertically inside the input. Enter sends; Shift+Enter adds a newline, and IME composition does not send. Sending clears and shrinks the input; resizing its window remeasures wrapping.
