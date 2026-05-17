/**
 * OS-file drop manager — uploader.
 *
 * Thin wrapper around `wp/v2/media` that:
 *
 *   1. Runs the `desktop-mode.drop.before-upload` filter (a
 *      plugin can return `null` to cancel or swap the file out).
 *   2. POSTs a `multipart/form-data` body so the dialog's
 *      pre-filled `title`, `alt_text`, `caption`, and
 *      `description` are persisted alongside the binary in a
 *      single round-trip (the alternative — raw body + a
 *      follow-up PATCH — leaks half-attached media on failure).
 *   3. Fires `desktop-mode.drop.after-upload` /
 *      `desktop-mode.drop.upload-failed` on the way out.
 *
 * @since 0.30.0
 */

import { applyFilters, doAction } from '../hooks';
import { trackedFetch } from '../tracked-fetch';
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

	let response: Response;
	try {
		response = await trackedFetch(
			args.mediaUrl,
			{
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'X-WP-Nonce': args.restNonce },
				body,
			},
			{ source: 'desktop-mode/os-file-drop' },
		);
	} catch ( err ) {
		const error = err instanceof Error ? err : new Error( String( err ) );
		doAction( FILE_DROP_HOOKS.UPLOAD_FAILED, {
			file: args.file,
			error,
			context: args.context,
		} );
		throw error;
	}

	if ( ! response.ok ) {
		const message = await extractMessage( response );
		const error = new Error( message );
		doAction( FILE_DROP_HOOKS.UPLOAD_FAILED, {
			file: args.file,
			error,
			context: args.context,
		} );
		throw error;
	}

	const data = ( await response.json() ) as {
		id: number;
		source_url: string;
		mime_type?: string;
		title?: { rendered?: string };
		media_details?: { file?: string };
	};
	const result: DropUploadResult = {
		id: data.id,
		url: data.source_url,
		mime: data.mime_type || filtered.mime,
		title: data.title?.rendered || filtered.fields.title,
		filename: data.media_details?.file || filtered.fields.filename,
	};

	doAction( FILE_DROP_HOOKS.AFTER_UPLOAD, {
		result,
		fields: filtered.fields,
		context: args.context,
	} );

	return result;
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

async function extractMessage( response: Response ): Promise< string > {
	const fallback = `Upload failed (HTTP ${ response.status }).`;
	try {
		const data = ( await response.json() ) as { message?: string };
		if ( data && typeof data.message === 'string' ) {
			return data.message;
		}
	} catch {
		/* fall through */
	}
	return fallback;
}
