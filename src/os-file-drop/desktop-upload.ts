/**
 * OS-file drop manager — desktop-storage uploader.
 *
 * The second upload sink next to `upload.ts` (Media Library):
 * POSTs one file per request to
 * `desktop-mode/v1/files/uploads` — real bytes into the user's
 * private desktop storage, with the placement created server-side.
 *
 * Fires the exact same `desktop-mode.drop.*` hook chain as the
 * Media Library path so the progress HUD and third-party
 * subscribers work unchanged, and ingests the returned placement
 * into the shared files store so the tile paints without waiting
 * for a heartbeat tick.
 *
 * XHR (not `wp.desktop.fetch`) for the same reason as `upload.ts`:
 * upload progress events only exist on XHR. See the eslint note
 * there; the HUD provides the activity-bus visibility.
 */

import { applyFilters, doAction } from '../hooks';
import { FILE_DROP_HOOKS } from './hooks';
import { UploadAbortedError, UploadCancelledError } from './upload';
import { upsertPlacement } from '../desktop-files/store';
import type { RestPlacementShape } from '../desktop-files/rest';
import type { DropContext, DropDialogFields } from './types';

interface DesktopUploadArgs {
	file: File;
	mime: string;
	fields: DropDialogFields;
	context: DropContext;
	/** Files REST base (`…/desktop-mode/v1/files`). */
	filesUrl: string;
	restNonce: string;
	/** Target folder id (0 = desktop root). */
	parentId: number;
	/** `a/b/c.ext` tree path — '' for flat uploads. */
	relativePath: string;
	/**
	 * Tile coordinates. Omit to let the server pick the next free
	 * grid slot (used for every file after the first in a batch).
	 */
	coords?: { x: number; y: number };
}

export interface DesktopUploadResult {
	placement: RestPlacementShape;
	storedFileId: number;
}

export async function uploadFileToDesktop(
	args: DesktopUploadArgs,
): Promise< DesktopUploadResult > {
	const initial = {
		file: args.file,
		mime: args.mime,
		fields: args.fields,
	};
	const filtered = applyFilters(
		FILE_DROP_HOOKS.BEFORE_UPLOAD,
		initial,
		args.context,
	) as typeof initial | null;
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
	body.append( 'parentId', String( args.parentId ) );
	if ( args.relativePath ) {
		body.append( 'relativePath', args.relativePath );
	}
	if ( args.coords ) {
		body.append( 'x', String( args.coords.x ) );
		body.append( 'y', String( args.coords.y ) );
	}

	const url = `${ args.filesUrl.replace( /\/$/, '' ) }/uploads`;

	return new Promise< DesktopUploadResult >( ( resolve, reject ) => {
		const xhr = new XMLHttpRequest();
		xhr.open( 'POST', url, true );
		xhr.withCredentials = true;
		xhr.setRequestHeader( 'X-WP-Nonce', args.restNonce );
		xhr.responseType = 'text';

		let aborted = false;
		const abort = (): void => {
			aborted = true;
			try {
				xhr.abort();
			} catch {
				/* already done */
			}
		};

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

		const fail = ( error: Error ): void => {
			doAction( FILE_DROP_HOOKS.UPLOAD_FAILED, {
				file: filtered.file,
				error,
				context: args.context,
			} );
			reject( error );
		};

		xhr.addEventListener( 'error', () => {
			if ( ! aborted ) {
				fail( new Error( 'Network error during upload.' ) );
			}
		} );
		xhr.addEventListener( 'abort', () => fail( new UploadAbortedError() ) );

		xhr.addEventListener( 'load', () => {
			if ( aborted ) {
				return;
			}
			if ( xhr.status < 200 || xhr.status >= 300 ) {
				fail( new Error( extractMessage( xhr, filtered.file.name ) ) );
				return;
			}
			let data: { placement?: RestPlacementShape; storedFileId?: number };
			try {
				data = JSON.parse( xhr.responseText ) as typeof data;
			} catch {
				fail( new Error( 'Could not parse server response.' ) );
				return;
			}
			if ( ! data.placement || typeof data.storedFileId !== 'number' ) {
				fail( new Error( 'Unexpected server response.' ) );
				return;
			}
			// Paint the tile now — no heartbeat wait.
			upsertPlacement( data.placement, 'local' );
			const result: DesktopUploadResult = {
				placement: data.placement,
				storedFileId: data.storedFileId,
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
 * Map a failed response to a user-facing message. Web-server 413s
 * (nginx `client_max_body_size`, PHP `post_max_size`) arrive with
 * HTML or empty bodies — never JSON — so status-based mapping runs
 * BEFORE JSON parsing.
 */
export function extractMessage( xhr: XMLHttpRequest, fileName: string ): string {
	if ( xhr.status === 413 ) {
		return `“${ fileName }” is larger than this server accepts.`;
	}
	const fallback = `Upload failed (HTTP ${ xhr.status }).`;
	const text = xhr.responseText;
	if ( ! text ) {
		return fallback;
	}
	try {
		const data = JSON.parse( text ) as { message?: string };
		if ( data && typeof data.message === 'string' && data.message ) {
			return data.message;
		}
	} catch {
		/* Non-JSON (proxy error page) — fall through. */
	}
	return fallback;
}
