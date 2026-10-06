# A confirmed session-save loop, with an unconfirmed connection to uploads

The session saver can starve JavaScript's event loop after request setup throws synchronously. The next `flush()` repeatedly awaits an already-settled promise. Moving cleanup into the promise's `finally()` prevents the stale reference.

This is a confirmed defect, but **it is not yet an explanation for the reported Media/Gutenberg upload freeze**. The reproduction deliberately injects a synchronous request-setup error. Ordinary network failures reject a promise asynchronously and do not take this path. Neither retained heap growth nor Chrome's Wait/Kill dialog was measured in this reproduction.

## The failure sequence

In `src/boot/session-saver.ts`, the original assignment was:

```js
activeSave = (async () => {
    try {
        await trackedFetch(/* ... */);
    } catch (error) {
        // Report the failed save.
    } finally {
        activeSave = null;
    }
})();
```

If the request function throws before returning a promise, the async function runs its catch and finally before its caller assigns `activeSave`. The assignment then overwrites `null` with the settled promise. On the next flush:

```js
while (activeSave) {
    await activeSave;
}
```

Nothing clears that reference. Each `await` queues another microtask, and the loop prevents timers and rendering from getting their turn. This is microtask starvation; the evidence does not establish recursive call-stack growth or a retained-memory leak.

The fix attaches cleanup with `.finally(...)` to the returned promise. Cleanup therefore runs after the assignment, including when request setup throws synchronously.

## Chrome comparison

Tested in Chrome 154 on macOS. The fixture bundles the actual session-saver source before and after the change, substitutes its external dependencies, and makes the first request throw synchronously. It invokes a second flush after the first failure has been handled.

Each version runs in a dedicated worker so a defective loop cannot freeze the user's editing tab. A timer in the host page terminates each worker after 500 ms. The worker also schedules its own zero-delay timer immediately before the second flush.

| Observation | Original code | Fixed code |
|---|---|---|
| First synchronous error handled | Yes | Yes |
| Second flush completed within the 500 ms window | No | Yes |
| Worker's zero-delay timer fired | No | Yes |
| External termination required to stop the loop | Yes | No loop remained |

The fixed flush reported 0 ms at the available timer resolution. That is below-resolution completion in a synthetic fixture, not a claim of zero execution cost. The 500 ms cutoff is a safety bound, not the duration of a production freeze.

## Regression coverage and limits

`tests/vitest/session-saver-flush.test.ts` checks that a second flush completes after a synchronous request exception. It failed on the original source and passed with the cleanup change. A bounded microtask check and an explicit recovery save allow the old implementation to fail the test without hanging the test runner itself.

Validation: both session-saver suites pass (18 tests); the complete JavaScript suite passes (6,510 tests in 528 files); build, lint and TypeScript checks pass. Lint retains existing file-length warnings.

The known in-tree flush caller is the shell's reload-after-deploy flow. No observed upload action has been shown to reach this loop. The unresolved investigation is still the user's recursive, heap-growing freeze during natural OpenStation use.
