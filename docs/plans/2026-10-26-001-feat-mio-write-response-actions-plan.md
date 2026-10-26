---
title: "feat: MIO response buttons that write — a choice after a conflict"
type: feat
status: proposal
date: 2026-10-26
---

# feat: MIO response buttons that write — a choice after a conflict

**Status:** proposal for the OpenStation MIO API. Reviewed 26 October 2026 against `origin/trunk` at `0750d9ef`. It builds on the shipped response buttons. Every change is additive and optional.

## Why

An app's write can fail because the user changed the document while MIO was working. Forms is one example: someone edits a field while MIO is validating a new version of the form. Today the turn can only end in an error, and the work MIO did is lost.

The app should be able to end that turn with a question and two buttons instead:

> The form changed while I was working. Apply my changes over yours, or keep your edits?
>
> **[ Apply MIO's changes ]** [ Keep my edits ]
> Applying replaces the edits you made since MIO started.

The first button saves. The shell currently drops any response action whose effect is not `read` or `navigate` (`src/mio/assistant/response-actions.ts:71`), and the contract says callbacks must never write. This proposal adds a narrowly scoped `write` action that only a user can trigger.

## Summary of changes

| # | Change | Files |
|---|---|---|
| 1 | `effect: 'write'` on `MioResponseAction`, with a typed outcome | `src/mio/assistant/types.ts`, `src/mio/assistant/response-actions.ts` |
| 2 | `group` for mutually exclusive choices | `src/mio/assistant/types.ts`, `src/mio/assistant/response-actions.ts` |
| 3 | `description` for app-written consequence text | `src/mio/assistant/types.ts`, `src/mio/assistant/response-action-row.ts`, chat styles |
| 4 | Write actions recorded in the operations ledger | `src/mio/assistant/response-actions.ts`, `src/mio/assistant/session.ts`, `src/mio/assistant/operations.ts` |
| 5 | The chosen action reported to the model on the next turn | `src/mio/assistant/session.ts` (history assembly) |
| 6 | Feature detection: `MioWindowLease.responseActionEffects` | `src/mio/assistant/types.ts`, the lease factory (`src/mio/residency.ts`), `src/public-api.ts` |
| 7 | Docs and tests | `docs/mio-window-assistant.md`, `docs/javascript-reference.md`, `docs/api-index.md`, `docs/examples/mio-form-editing.md` |

No provider, PHP or transport change is needed.

## 1. Write effect and outcome

```ts
export interface MioResponseAction {
	id: string;
	label: string;
	ariaLabel?: string;
	icon?: string;
	emphasis?: 'primary' | 'secondary';
	/** `write` may save. It runs only from a trusted user click. */
	effect: 'read' | 'navigate' | 'write';
	/** Actions sharing a group are one choice; see section 2. */
	group?: string;
	/** Plain-text consequence, 1–160 characters; see section 3. */
	description?: string;
	allowed?: () => boolean;
	/** `write` callbacks must return a MioOperationOutcome. */
	run: ( context: MioResponseActionContext ) => void | MioOperationOutcome | Promise<void | MioOperationOutcome>;
}

export interface MioResponseActionContext {
	signal: AbortSignal;
	messageId: string;
	turnId: string;
	/** Present for `write` only. */
	callId?: string;
	/** Present for `write` only. Stable for this action entry, including retries. */
	idempotencyKey?: string;
}
```

Rules for `write` actions:

- **Only a user can trigger one.** The row's click handler runs a write only when `event.isTrusted` is `true`. No model output, tool result, render pass or `allowed()` call may invoke it, and there is no auto-run.
- **At most one write action per message.** If a descriptor list has more than one, the shell drops every write after the first. Read and navigate actions are unaffected.
- **Only the latest assistant message.** Write actions are available only while their message is the newest assistant message in the conversation. Sending a new message retires them, with a status such as "No longer available." This stops a stale draft from being applied after the conversation has moved on. `allowed()` can be stricter, but not looser.
- **Typed outcome.** The callback returns one of the existing `MioOperationOutcome` shapes:
  - `{ effect: 'write', status: 'confirmed', receipt }`: saved. The shell shows "Done." and retires the action.
  - `{ effect: 'write', status: 'unknown' }`: the save may or may not have happened. The shell retires the button, shows "Couldn't confirm the result. Check before trying again." and leaves reconciliation to `inspectOperation`.
  - `{ effect: 'none', status: 'rejected', errors, retryable }`: nothing was written. The shell shows the first error message. When `retryable` is `true`, another deliberate click retries with the same `idempotencyKey`.
- **A thrown error, a missing outcome or a malformed outcome counts as `unknown`.** This is the opposite of read actions, where a throw is just a local error. A write callback that fails quietly must never look like "nothing happened".
- **Cancellation is not rollback.** Closing the chat aborts the signal, but a write that has already started keeps its pending entry. The shell records whatever outcome eventually settles, even after the chat has closed, and shows it on reopen. It must not clear the status on abort the way read actions do today. If the lease is disposed while a write is pending, the ledger entry becomes `unknown`.
- **No model round.** Clicking never starts a provider request and never counts against the turn's round, call or validation budget.

## 2. Choice groups

Actions on the same message with the same `group` string are alternatives:

- While any action in the group is pending, the others are disabled.
- When an action in the group finishes as `confirmed` or `completed` — which for read/navigate means it resolved without throwing — every action in the group is retired. The chosen one keeps its status text and the others disappear. That makes the choice final and visible, and stops someone from clicking "Apply" after "Keep my edits".
- A rejected write, or a read action that throws, leaves the group open.
- `group` uses the same character rules as `id` and applies within one message only.

"Keep my edits" is a `read` action in the same group. Its callback discards app-held state and returns without writing.

## 3. Consequence text

`description` is plain text, never HTML, rendered once below the action row in the existing secondary text style. If several actions have a `description`, render the first one only. The app writes this text, not the model, so it stays accurate even when the model's prose is vague. A write action that has a description is linked to it with `aria-describedby`.

## 4. Operations ledger

A write action is a write, so it goes through the same ledger as ability writes:

- On click, the shell records a `MioOperation` with `ability: 'response:<action id>'`, `effect: 'write'`, `status: 'running'`, the originating `turnId`, the window ID and the current `revision()`. It then calls `onOperation`.
- The settled outcome updates that entry: `confirmed` with its receipt, `unknown`, or `rejected`. `onOperation` fires again.
- `getOperations()` and `inspectOperation( callId )` cover these entries, and `operationStatus` reconciles an unknown response-action write exactly as it does an ability write.
- Add `source: 'ability' | 'response-action'` to `MioOperation` so apps and logs can tell the two apart. Existing entries are `'ability'`.

## 5. Next-turn history

If the user clicks a write action, or any action in a choice group, and then asks MIO something else, the model should know what happened. Otherwise it may claim that nothing was applied. When the shell builds the next turn's history, it appends one compact record per settled action since the previous turn:

```json
{ "source": "response-action", "label": "Apply MIO's changes", "effect": "write", "status": "confirmed" }
```

This record is written by the shell, carries no callback, URL or receipt body, and is never presented as user text. Pass it to `compactHistory` like any other outcome.

## 6. Feature detection

Apps need to know whether the shell supports write actions during the turn, so the tool result can tell the model to ask the question instead of reporting a dead end. Older shells silently drop write descriptors, so the app would otherwise show a question with no buttons.

```ts
export interface MioWindowLease {
	/** Effects this shell renders for response actions. */
	readonly responseActionEffects: readonly ( 'read' | 'navigate' | 'write' )[];
}
```

Shells from before this change don't have the property. Apps treat a missing property as `[ 'read', 'navigate' ]`.

## 7. Docs to update

- `docs/mio-window-assistant.md` § Assistant response buttons: update the `effect` row and add `group` and `description`. Replace the sentence "no write/destructive response-button API" with the write rules above.
- `docs/javascript-reference.md`: the new fields, the `MioResponseActionContext` additions, `MioOperation.source` and `MioWindowLease.responseActionEffects`.
- `docs/api-index.md`: list write response actions as **Experimental**.
- `docs/examples/mio-form-editing.md`: add a conflict-choice example next to Preview.

## Acceptance tests

- [ ] A write descriptor is kept, and older apps that return only read/navigate actions behave exactly as before.
- [ ] A second write descriptor on the same message is dropped.
- [ ] A write runs only from a trusted click. Calling `run` programmatically, from render or from a synthetic event does nothing.
- [ ] A write action on an older message is retired when a new user message is sent.
- [ ] `confirmed` retires the whole group and records a confirmed ledger entry with its receipt.
- [ ] `rejected` with `retryable` allows a second click, which reuses the same `idempotencyKey`.
- [ ] A throw, a missing outcome or a malformed outcome is recorded as `unknown` and retires the button.
- [ ] Closing the chat mid-write keeps the pending entry; the late outcome is recorded and shown on reopen. Disposing the lease marks it `unknown`.
- [ ] Within a group, a pending action disables its siblings, and a completed "Keep" action retires the "Apply" sibling.
- [ ] The click makes no provider request and uses none of the turn's budget.
- [ ] The next turn's history contains the shell-authored action record, and nothing executable.
- [ ] `inspectOperation` and `operationStatus` reconcile an unknown response-action write.
- [ ] `responseActionEffects` includes `write`.
- [ ] Keyboard, focus restoration, RTL and narrow-window layout match the existing response rows, and `description` is announced with the write button.
