/**
 * OS-file drop manager — hook constants.
 *
 * Re-exported as part of `HOOKS` in `src/hooks.ts` (see the
 * `FILE_DROP_*` keys). Defined here close to the manager so
 * the file-drop subsystem owns the names that ship in the
 * public hook surface.
 */

export const FILE_DROP_HOOKS = {
	/**
	 * Filter — fires once per drop, after the manager has parsed
	 * the OS `DataTransfer` into `File[]` and BEFORE the mime /
	 * size filter runs.
	 *
	 * Signature: `(files: File[], ctx: DropContext) => File[]`.
	 * Return an empty array to abort the drop silently.
	 */
	FILES_DETECTED: 'os.drop.files-detected',

	/**
	 * Action — fires after the mime / size filter has rejected
	 * one or more files. Payload: `{ rejections: DropRejection[],
	 * context: DropContext }`. The shell toasts a default message;
	 * subscribers can surface a custom UX (a side panel with the
	 * list, an analytics call).
	 */
	FILES_REJECTED: 'os.drop.files-rejected',

	/**
	 * Filter — fires per file before the upload dialog renders.
	 * Receives `DropFileEntry` (the underlying file + the
	 * manager's default `fields`). Mutate `fields` (or return a
	 * new object) to change what the user sees in the form.
	 *
	 * Signature: `(entry: DropFileEntry, ctx: DropContext)
	 *             => DropFileEntry`.
	 */
	DIALOG_FIELDS: 'os.drop.dialog-fields',

	/**
	 * Filter — last call before the manager `POST`s to
	 * `wp/v2/media`. Receives `{ file: File, fields:
	 * DropDialogFields, mime: string }`. Return `null` to cancel
	 * the upload entirely (e.g. a plugin handled it via a
	 * different endpoint).
	 *
	 * Signature: `(payload, ctx: DropContext) => payload | null`.
	 */
	BEFORE_UPLOAD: 'os.drop.before-upload',

	/**
	 * Action — fires once `BEFORE_UPLOAD` has cleared and the XHR
	 * is `open()`ed, immediately before `send()`. Payload:
	 * `{ file: File, fields: DropDialogFields, context: DropContext,
	 * abort: () => void }`. The `abort` handle aborts the in-flight
	 * request; the manager rejects with `UploadAbortedError` and
	 * fires `UPLOAD_FAILED` with that error.
	 *
	 * Pair with `UPLOAD_PROGRESS` to drive a progress UI; pair with
	 * `AFTER_UPLOAD` / `UPLOAD_FAILED` to know when the upload ends.
	 */
	UPLOAD_STARTED: 'os.drop.upload-started',

	/**
	 * Action — fires for every `XMLHttpRequestUpload.progress` event.
	 * Payload: `{ file: File, fields: DropDialogFields, context:
	 * DropContext, loaded: number, total: number, indeterminate:
	 * boolean }`. `total` is `0` and `indeterminate` is `true` when
	 * the request body length isn't known (rare for multipart, but
	 * possible on transcoding proxies); subscribers should treat
	 * that as an indeterminate state.
	 *
	 * A synthetic 100%-loaded event is dispatched once the `upload`
	 * stream emits `load` so a HUD can show a definite "wrapping up"
	 * state while the server finishes the response.
	 */
	UPLOAD_PROGRESS: 'os.drop.upload-progress',

	/**
	 * Action — fires after a successful upload. Payload:
	 * `{ file: File, result: DropUploadResult, fields:
	 * DropDialogFields, context: DropContext }`.
	 *
	 * The `file` field carries the same `File` reference that
	 * `UPLOAD_STARTED` / `UPLOAD_PROGRESS` exposed (i.e. the
	 * payload returned by the `BEFORE_UPLOAD` filter, in case a
	 * plugin swapped the file). Subscribers tracking per-file
	 * state — progress HUDs, sequence counters — should match on
	 * this identity rather than the filename: two drops of
	 * `photo.jpg` from different folders would otherwise route
	 * each other's success event to the wrong row.
	 *
	 * that destructured `{ result, fields, context }` keeps working.
	 */
	AFTER_UPLOAD: 'os.drop.after-upload',

	/**
	 * Action — fires after an upload fails. Payload:
	 * `{ file: File, error: Error, context: DropContext }`.
	 * `error` is an `UploadAbortedError` when the failure came
	 * from the caller invoking the `abort()` handle on
	 * `UPLOAD_STARTED`.
	 *
	 * `file` carries the same identity as `UPLOAD_STARTED` /
	 * `UPLOAD_PROGRESS` / `AFTER_UPLOAD` — the post-`BEFORE_UPLOAD`
	 * `File`, in case a plugin swapped it. Match by reference, not
	 * filename: a HUD that keys its row map on the started-File
	 * needs the same key here, otherwise the row stays stuck in
	 * "running" after a failure when a `BEFORE_UPLOAD` filter
	 * replaced the file.
	 */
	UPLOAD_FAILED: 'os.drop.upload-failed',
} as const;
