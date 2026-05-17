/**
 * OS-file drop manager — hook constants.
 *
 * Re-exported as part of `HOOKS` in `src/hooks.ts` (see the
 * `FILE_DROP_*` keys). Defined here close to the manager so
 * the file-drop subsystem owns the names that ship in the
 * public hook surface.
 *
 * @since 0.30.0
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
	FILES_DETECTED: 'desktop-mode.drop.files-detected',

	/**
	 * Action — fires after the mime / size filter has rejected
	 * one or more files. Payload: `{ rejections: DropRejection[],
	 * context: DropContext }`. The shell toasts a default message;
	 * subscribers can surface a custom UX (a side panel with the
	 * list, an analytics call).
	 */
	FILES_REJECTED: 'desktop-mode.drop.files-rejected',

	/**
	 * Filter — fires per file before the upload dialog renders.
	 * Receives `DropFileEntry` (the underlying file + the
	 * manager's default `fields`). Mutate `fields` (or return a
	 * new object) to change what the user sees in the form.
	 *
	 * Signature: `(entry: DropFileEntry, ctx: DropContext)
	 *             => DropFileEntry`.
	 */
	DIALOG_FIELDS: 'desktop-mode.drop.dialog-fields',

	/**
	 * Filter — last call before the manager `POST`s to
	 * `wp/v2/media`. Receives `{ file: File, fields:
	 * DropDialogFields, mime: string }`. Return `null` to cancel
	 * the upload entirely (e.g. a plugin handled it via a
	 * different endpoint).
	 *
	 * Signature: `(payload, ctx: DropContext) => payload | null`.
	 */
	BEFORE_UPLOAD: 'desktop-mode.drop.before-upload',

	/**
	 * Action — fires after a successful upload. Payload:
	 * `{ result: DropUploadResult, fields: DropDialogFields,
	 * context: DropContext }`.
	 */
	AFTER_UPLOAD: 'desktop-mode.drop.after-upload',

	/**
	 * Action — fires after an upload fails. Payload:
	 * `{ file: File, error: Error, context: DropContext }`.
	 */
	UPLOAD_FAILED: 'desktop-mode.drop.upload-failed',
} as const;
