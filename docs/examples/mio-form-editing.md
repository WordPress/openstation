# Repairable form edits with MIO

**Status: Experimental.** See [Window-scoped MIO](../mio-window-assistant.md) for the complete contract.

This example assumes an application-owned `forms` adapter. It is not a global MIO tool or a WordPress Ability. The adapter uses authenticated app actions or `wp.os.fetch`, and its server checks the acting user's capability, document ownership, expected revision and idempotency key. `forms.operationStatus` is a read-only endpoint. The application already owns the draft being edited.

```typescript
import type { MioAbility, MioOperationOutcome } from 'openstation';

const saveForm: MioAbility = {
    name: 'save_form_edit',
    effect: 'write',
    description: 'Validate and save an edit to the current form. Preserve all other fields.',
    parameters: {
        type: 'object',
        properties: {
            editId: { type: 'string' },
            baseRevision: { type: 'string' },
            patch: { type: 'string', description: 'App-defined field patch, not a replacement form.' },
        },
        required: ['editId', 'baseRevision', 'patch'],
        additionalProperties: false,
    },
    allowed: () => forms.canEdit(),
    validate: (args) => {
        const keys = ['editId', 'baseRevision', 'patch'];
        if (Object.keys(args).length !== keys.length ||
            !keys.every(key => typeof args[key] === 'string')) {
            return {
                ok: false,
                retryable: true,
                errors: [{
                    code: 'edit_envelope', path: '$',
                    message: 'Provide only editId, baseRevision and patch as strings.',
                    suggestion: 'Read the current form for its edit ID and revision.',
                }],
            };
        }
        return true;
    },
    run: async (args, signal, operation): Promise<MioOperationOutcome> => {
        // The adapter must not retry a timeout automatically. The server binds
        // the key to the payload and revision, then records a durable receipt.
        const result = await forms.validateAndSave({
            editId: args.editId,
            baseRevision: args.baseRevision,
            patch: args.patch,
            turnId: operation.turnId,
            idempotencyKey: operation.idempotencyKey,
            signal,
        });
        if (result.kind === 'validation-error') {
            // Only return this when the server guarantees NO write occurred.
            // It consumes the same turn budget even if editId changes.
            return {
                effect: 'none', status: 'rejected', retryable: true,
                errors: result.errors,
            };
        }
        return {
            effect: 'write', status: 'confirmed', receipt: result.receipt,
            data: { editId: result.editId, revision: result.revision },
        };
    },
    history: ({ result }) => ({ result }),
};

const lease = wp.os.mio.registerWindow(ctx.windowId, {
    host: ctx.root,
    title: 'Form editor',
    revision: () => forms.currentRevision(),
    prompt: () => `Help edit this form. Current revision: ${forms.currentRevision()}.`,
    documents: [{
        id: 'fields/date.md', title: 'Date field', version: 'schema-r2',
        topics: ['validation', 'forms'], componentIds: ['os-date-picker'],
        markdown: dateFieldHelp,
    }],
    abilities: () => [
        {
            name: 'read_current_form', effect: 'read',
            description: 'Read the complete current draft, edit ID and revision.',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
            validate: args => Object.keys(args).length === 0,
            run: (_args, signal) => forms.readCurrent(signal),
        },
        saveForm,
    ],
    onTurnBegin: turn => forms.showTurnProgress(turn.turnId),
    onTurnAbort: turn => forms.markTurnStopped(turn.turnId),
    onTurnEnd: summary => forms.showTurnSummary(summary),
    onOperation: operation => forms.observeOperation(operation),
    operationStatus: (operation, signal) =>
        forms.operationStatus(operation.idempotencyKey, signal),
    compactHistory: history => {
        // Preserve the latest COMPLETE read; remove only superseded copies.
        // Older save receipts and precise argument errors remain as evidence.
        const lastRead = history.outcomes.findLastIndex(
            entry => (entry as { name?: string }).name === 'read_current_form'
        );
        return {
            ...history,
            outcomes: history.outcomes.filter(
                (entry, index) => (entry as { name?: string }).name !== 'read_current_form' || index === lastRead
            ),
        };
    },
});
```

The name assertions above describe entries produced by this app; validate external history before using the same pattern. Keep full documents intact when they are still needed. If even one document plus context does not fit, offer revisioned resource reads and field/diff operations; do not slice the definition. `history` can replace large successful tool results with an immutable `{editId, documentHash, byteLength}` reference when the app supplies a corresponding read operation. `compactHistory` must preserve correction feedback and authoritative receipts.

The shell gives one user message three validation failures, sixteen calls and eight model rounds. Starting a fresh edit resource does not reset those counters. Each actual invocation receives a distinct call/idempotency ID; a duplicate write cannot be repeated just by reordering JSON keys. The server must still reject stale revisions and bind its idempotency key to the same payload. Client-side deduplication is not a replacement for server concurrency control.

If the user closes the editor while a request is in flight, retain only the operation metadata your app needs for reconciliation. A retained lease can call `await lease.inspectOperation(callId)` after disposal; this invokes only `forms.operationStatus`, never `validateAndSave`. The application can also query its endpoint after reload using its own stored IDs. Confirmed receipts survive late network errors. An unknown outcome means “inspect status,” not “submit the same draft again.”

## Preview a saved form

Extend the adapter above with `responseActions`. The following is consumer code for an application-owned Forms API; OpenStation does not ship the external Forms plugin. Remember the saved form ID **inside the successful save callback**, keyed by the authoritative receipt. Keep this map bounded (for example the latest 64 receipts) and clear it when disposing the editor. If an older receipt has been evicted, omit its action. Do not persist preview URLs or use a model-supplied form ID.

```typescript
const savedFormsByReceipt = new Map<string, number>();

// Inside saveForm.run, after validateAndSave returns an authoritative success:
savedFormsByReceipt.set(result.receipt, result.formId);
while (savedFormsByReceipt.size > 64) {
    savedFormsByReceipt.delete(savedFormsByReceipt.keys().next().value!);
}
// Then return the confirmed MioOperationOutcome shown above.

// Add this property to the window registration:
responseActions: ({summary, operations}) => {
    if (summary.status !== 'completed' || summary.unknownWrites > 0) return [];
    const saved = [...operations].reverse().find(operation =>
        operation.ability === 'save_form_edit' &&
        operation.status === 'confirmed' &&
        operation.receipt && savedFormsByReceipt.has(operation.receipt)
    );
    if (!saved?.receipt) return [];
    const formId = savedFormsByReceipt.get(saved.receipt)!;
    return [{
        id: 'preview-saved-form', label: 'Preview',
        ariaLabel: 'Preview the saved form', icon: 'dashicons-visibility',
        emphasis: 'primary', effect: 'navigate',
        allowed: () => ctx.root.isConnected && forms.canEdit(),
        run: async ({signal}) => {
            // Authenticated read; extend this app wrapper to accept AbortSignal.
            // The server must reject a deleted form or revoked permission.
            const form = await forms.getForm(formId, signal);
            signal.throwIfAborted();
            // App-owned native opener, keyed by form.id to reuse its window.
            openPreviewWindow(form.id, form.title, form.previewUrl);
        },
    }];
},
```

Use the native `openPreviewWindow` directly. A convenience helper that first saves dirty content would make this read/navigation button perform an undeclared write. Preview addresses the latest **saved** definition of the bound form, even after switching the editor to another form. It does not reconstruct the historical revision at the time of the chat message. Refresh its nonced URL through authenticated WordPress on each click; do not bake it into the conversation.

Duplicate clicks share one pending invocation. Once it finishes, a later click can focus the same preview again. Closing chat aborts the read; reopening the same live conversation restores eligible actions. Disposing the editor removes its callbacks. A local fetch/opening failure appears alongside the button, leaves the saved reply intact, and never invokes the provider or automatically retries.

## Choose after a conflict

**Experimental.** When the user edits the form while MIO is working, the save above fails its revision check. Instead of ending the turn in an error, the app can keep MIO's candidate and end the turn with a question the user answers with a button. "Apply" is a [`write` response action](../mio-window-assistant.md#response-buttons-that-write); "Keep" is a `read` action in the same [choice group](../mio-window-assistant.md#choice-groups).

```typescript
// `lease` is the registration above.
const supportsWrite = (lease.responseActionEffects ?? ['read', 'navigate']).includes('write');
const conflicts = new Map<string, { editId: string; patch: string }>(); // keyed by turnId

// Inside saveForm.run, when the server reports a revision conflict and wrote nothing:
if (result.kind === 'revision-conflict' && supportsWrite) {
    conflicts.set(operation.turnId, { editId: args.editId as string, patch: args.patch as string });
    // A completed no-effect result lets the turn finish with the question.
    return {
        effect: 'none', status: 'completed',
        data: { conflict: true, instruction: 'The user changed the form meanwhile. Ask whether to apply your changes over theirs or keep their edits. Buttons will be shown; do not retry the save.' },
    };
}

// Add this property to the window registration:
responseActions: ({summary}) => {
    const conflict = conflicts.get(summary.turnId);
    if (!conflict || summary.status !== 'completed') return [];
    return [
        {
            id: 'apply-mio-changes', label: "Apply MIO's changes",
            effect: 'write', group: 'conflict', emphasis: 'primary',
            description: 'Applying replaces the edits you made since MIO started.',
            allowed: () => ctx.root.isConnected && forms.canEdit(),
            run: async ({signal, turnId, idempotencyKey}): Promise<MioOperationOutcome> => {
                // The server binds the key to this payload, so a retry after a
                // retryable rejection cannot apply it twice.
                const result = await forms.validateAndSave({
                    ...conflict, baseRevision: forms.currentRevision(), turnId, idempotencyKey, signal,
                });
                if (result.kind === 'saved') {
                    conflicts.delete(turnId);
                    return { effect: 'write', status: 'confirmed', receipt: result.receipt };
                }
                if (result.kind === 'validation-error') {
                    return { effect: 'none', status: 'rejected', retryable: true, errors: result.errors };
                }
                // Timeouts and anything else: let the user check before retrying.
                return { effect: 'write', status: 'unknown' };
            },
        },
        {
            id: 'keep-my-edits', label: 'Keep my edits', effect: 'read', group: 'conflict',
            run: ({turnId}) => { conflicts.delete(turnId); },
        },
    ];
},
```

Only a real click runs "Apply", and only while its message is the newest in the conversation; asking MIO anything else retires it. Choosing either button retires the other. The click makes no model request. The write is recorded in `getOperations()` as `response:apply-mio-changes` with `source: 'response-action'`, so an unknown outcome reconciles through `forms.operationStatus` like any other save, and the next turn tells the model which button the user chose. Clear `conflicts` when disposing the editor.

Check `responseActionEffects` before returning the conflict result. On an older shell the write button would be dropped, leaving a question with no way to answer it; fall back to the ordinary rejected outcome there.
