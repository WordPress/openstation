/**
 * OS-file drop manager — uploader.
 *
 * Thin wrapper around `wp/v2/media` that:
 *
 *   1. Runs the `desktop-mode.drop.before-upload` filter (a
 *      plugin can return `null` to cancel or swap the file out).
 *   2. POSTs a `multipart/form-data` body via `XMLHttpRequest` so
 *      the `upload.progress` event surface is observable. The
 *      single-shot multipart write keeps the dialog's pre-filled
 *      `title`, `alt_text`, `caption`, and `description` attached
 *      to the binary in one round-trip (the alternative — raw body
 *      + a follow-up PATCH — leaks half-attached media on failure).
 *   3. Emits `desktop-mode.drop.upload-started` at send time with an
 *      `abort()` handle, `desktop-mode.drop.upload-progress` on every
 *      progress event, and `desktop-mode.drop.after-upload` /
 *      `desktop-mode.drop.upload-failed` on the way out.
 *
 * `fetch` cannot be substituted here — the spec exposes upload
 * progress only via XHR's `upload.onprogress` callback (the Streams-
 * based fetch upload-progress proposal isn't yet broadly supported,
 * and our floating HUD needs determinate bars). Activity-bus
 * attribution for the request lives in the manager's surrounding
 * `wp.desktop.activity.publish` calls — XHR doesn't route through
 * `wp.desktop.fetch` by design.
 *
 * @since 0.30.0
 */

import { applyFilters, doAction } from '../hooks';
import { FILE_DROP_HOOKS } from './hooks';
import type {
	DropContext,
	DropDialogFields,
	DropUploadResult,
} from './types';

interface UploadArgs {
	file: File;
	mime: string;
	fields: DropDialogFields;
	context: DropContext;
	mediaUrl: string;
	restNonce: string;
}

interface BeforeUploadPayload {
	file: File;
	mime: string;
	fields: DropDialogFields;
}

export async function uploadFile(
	args: UploadArgs,
): Promise< DropUploadResult > {
	const initial: BeforeUploadPayload = {
		file: args.file,
		mime: args.mime,
		fields: args.fields,
	};
	const filtered = applyFilters(
		FILE_DROP_HOOKS.BEFORE_UPLOAD,
		initial,
		args.context,
	) as BeforeUploadPayload | null;

	if ( ! filtered ) {
		throw new UploadCancelledError();
	}

	const body = new FormData();
	const renamed = filtered.fields.filename !== filtered.file.name
		? new File( [ filtered.file ], filtered.fields.filename, {
			type: filtered.mime || filtered.file.type,
		} )
		: filtered.file;
	body.append( 'file', renamed );
	body.append( 'title', filtered.fields.title );
	body.append( 'alt_text', filtered.fields.altText );
	body.append( 'caption', filtered.fields.caption );
	body.append( 'description', filtered.fields.description );

	return new Promise< DropUploadResult >( ( resolve, reject ) => {
		const xhr = new XMLHttpRequest();
		xhr.open( 'POST', args.mediaUrl, true );
		xhr.withCredentials = true;
		xhr.setRequestHeader( 'X-WP-Nonce', args.restNonce );
		xhr.responseType = 'text';

		let aborted = false;
		// Body-fully-sent flag — set when `upload.load` fires. After
		// this point the server may have already stored the attachment,
		// so an `xhr.abort()` won't actually undo the upload. We deal
		// with that by letting the request finish and DELETE-ing the
		// resulting attachment in the load handler below.
		let bodyFullySent = false;
		let cancelRequested = false;
		const abort = (): void => {
			cancelRequested = true;
			if ( bodyFullySent ) {
				// Too late to bin the request on the wire — wait for
				// the server's response so we know the attachment id,
				// then delete it. The xhr's `load` handler below sees
				// `cancelRequested` and routes accordingly.
				return;
			}
			aborted = true;
			try {
				xhr.abort();
			} catch {
				/* already done */
			}
		};

		// `upload-started` lands AFTER `open()` but BEFORE `send()` so
		// subscribers can attach their own onprogress observers via the
		// hook bus and get a working `abort()` handle in the same tick.
		doAction( FILE_DROP_HOOKS.UPLOAD_STARTED, {
			file: filtered.file,
			fields: filtered.fields,
			context: args.context,
			abort,
		} );

		xhr.upload.addEventListener( 'progress', ( e: ProgressEvent ) => {
			doAction( FILE_DROP_HOOKS.UPLOAD_PROGRESS, {
				file: filtered.file,
				fields: filtered.fields,
				context: args.context,
				loaded: e.loaded,
				total: e.lengthComputable ? e.total : 0,
				indeterminate: ! e.lengthComputable,
			} );
		} );

		// Some browsers fire `load` on the upload stream slightly before
		// the response body arrives — surface a synthetic 100% there so
		// the HUD doesn't sit at 99% during server-side processing.
		// We also use this to flip `bodyFullySent` so a late `abort()`
		// switches to the "wait + delete" path.
		xhr.upload.addEventListener( 'load', () => {
			bodyFullySent = true;
			doAction( FILE_DROP_HOOKS.UPLOAD_PROGRESS, {
				file: filtered.file,
				fields: filtered.fields,
				context: args.context,
				loaded: filtered.file.size,
				total: filtered.file.size,
				indeterminate: false,
			} );
		} );

		xhr.addEventListener( 'error', () => {
			if ( aborted ) {
				return;
			}
			const error = new Error( 'Network error during upload.' );
			doAction( FILE_DROP_HOOKS.UPLOAD_FAILED, {
				// `filtered.file` — same identity as UPLOAD_STARTED /
				// _PROGRESS / AFTER_UPLOAD. A BEFORE_UPLOAD filter
				// that swapped the File would otherwise route this
				// failure to a row keyed by the original (pre-swap)
				// File, leaving the HUD row stuck in "running".
				file: filtered.file,
				error,
				context: args.context,
			} );
			reject( error );
		} );

		xhr.addEventListener( 'abort', () => {
			const error = new UploadAbortedError();
			doAction( FILE_DROP_HOOKS.UPLOAD_FAILED, {
				// `filtered.file` — same identity as UPLOAD_STARTED /
				// _PROGRESS / AFTER_UPLOAD. A BEFORE_UPLOAD filter
				// that swapped the File would otherwise route this
				// failure to a row keyed by the original (pre-swap)
				// File, leaving the HUD row stuck in "running".
				file: filtered.file,
				error,
				context: args.context,
			} );
			reject( error );
		} );

		xhr.addEventListener( 'load', () => {
			if ( aborted ) {
				return;
			}
			if ( xhr.status < 200 || xhr.status >= 300 ) {
				const message = extractXhrMessage( xhr );
				const error = new Error( message );
				doAction( FILE_DROP_HOOKS.UPLOAD_FAILED, {
					file: filtered.file,
					error,
					context: args.context,
				} );
				reject( error );
				return;
			}
			let data: {
				id: number;
				source_url: string;
				mime_type?: string;
				title?: { rendered?: string };
				media_details?: { file?: string };
			};
			try {
				data = JSON.parse( xhr.responseText );
			} catch ( err ) {
				const error =
					err instanceof Error
						? err
						: new Error( 'Could not parse server response.' );
				doAction( FILE_DROP_HOOKS.UPLOAD_FAILED, {
					file: filtered.file,
					error,
					context: args.context,
				} );
				reject( error );
				return;
			}
			// Late-cancel cleanup. The user clicked Cancel after the
			// body had been fully sent — the server still went on to
			// create the attachment. DELETE it before we surface
			// success / fire AFTER_UPLOAD, so live-refresh subscribers
			// (My WordPress media-list, classic Media Library iframe)
			// never see a "cancelled" file. Force=true skips trash so
			// the cleanup is final.
			if ( cancelRequested && data.id ) {
				void deleteAttachment(
					args.mediaUrl,
					args.restNonce,
					data.id,
				);
				const error = new UploadAbortedError();
				doAction( FILE_DROP_HOOKS.UPLOAD_FAILED, {
					file: filtered.file,
					error,
					context: args.context,
				} );
				reject( error );
				return;
			}
			const result: DropUploadResult = {
				id: data.id,
				url: data.source_url,
				mime: data.mime_type || filtered.mime,
				title: data.title?.rendered || filtered.fields.title,
				filename: data.media_details?.file || filtered.fields.filename,
			};
			doAction( FILE_DROP_HOOKS.AFTER_UPLOAD, {
				file: filtered.file,
				result,
				fields: filtered.fields,
				context: args.context,
			} );
			resolve( result );
		} );

		xhr.send( body );
	} );
}

/**
 * Marker thrown by `uploadFile` when a `before-upload` filter
 * returned `null`. Callers can `instanceof`-check this and
 * silently move on (the filter is by definition declaring
 * "I handled this; the manager shouldn't fall through").
 */
export class UploadCancelledError extends Error {
	constructor() {
		super( 'Upload cancelled by desktop-mode.drop.before-upload filter.' );
		this.name = 'UploadCancelledError';
	}
}

/**
 * Marker thrown by `uploadFile` when the caller invoked the
 * `abort()` handle exposed via the `upload-started` action (e.g.
 * a HUD "Cancel" button). Distinct from `UploadCancelledError` so
 * subscribers can tell "the filter blocked this" apart from "the
 * user cancelled mid-flight".
 *
 * @since 0.31.0
 */
export class UploadAbortedError extends Error {
	constructor() {
		super( 'Upload aborted by the caller.' );
		this.name = 'UploadAbortedError';
	}
}

/**
 * Best-effort cleanup for a "late cancel" — the upload's body had
 * already been received by the server when the user pressed Cancel,
 * so we DELETE the attachment that was created. Force=true so the
 * file is removed outright instead of sitting in trash (which would
 * itself surface in the user's Media Library). Failures here are
 * silent; the attachment will eventually be visible to the user and
 * they can delete it manually. We deliberately don't route through
 * `trackedFetch` — this is invisible cleanup, not user activity.
 */
function deleteAttachment(
	mediaUrl: string,
	restNonce: string,
	id: number,
): Promise< void > {
	const url = `${ mediaUrl.replace( /\/$/, '' ) }/${ id }?force=true`;
	const cleanup = new XMLHttpRequest();
	cleanup.open( 'DELETE', url, true );
	cleanup.withCredentials = true;
	cleanup.setRequestHeader( 'X-WP-Nonce', restNonce );
	return new Promise( ( resolve ) => {
		cleanup.addEventListener( 'loadend', () => {
			// Cleanup failures are recoverable from the user's
			// perspective (they can delete the file manually), so
			// we don't reject — but a warning makes the "phantom
			// attachment" class of bug discoverable instead of
			// silent for plugin authors investigating.
			if ( cleanup.status < 200 || cleanup.status >= 300 ) {
				// eslint-disable-next-line no-console
				console.warn(
					`[os-file-drop] late-cancel cleanup failed for attachment ${ id } (HTTP ${ cleanup.status }). The attachment remains in the Media Library; delete it manually.`,
				);
			}
			resolve();
		} );
		cleanup.addEventListener( 'error', () => {
			// eslint-disable-next-line no-console
			console.warn(
				`[os-file-drop] late-cancel cleanup network error for attachment ${ id }. The attachment remains in the Media Library; delete it manually.`,
			);
			resolve();
		} );
		try {
			cleanup.send();
		} catch ( err ) {
			// eslint-disable-next-line no-console
			console.warn(
				`[os-file-drop] late-cancel cleanup could not be dispatched for attachment ${ id }:`,
				err,
			);
			resolve();
		}
	} );
}

function extractXhrMessage( xhr: XMLHttpRequest ): string {
	const fallback = `Upload failed (HTTP ${ xhr.status }).`;
	const text = xhr.responseText;
	if ( ! text ) {
		return fallback;
	}
	try {
		const data = JSON.parse( text ) as { message?: string };
		if ( data && typeof data.message === 'string' ) {
			return data.message;
		}
	} catch {
		/* fall through */
	}
	return fallback;
}
