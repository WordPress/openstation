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

		let bodyFullySent = false;
		let cancelRequested = false;
		const abort = (): void => {
			cancelRequested = true;
			if ( bodyFullySent ) {
				return;
			}
			aborted = true;
			try {
				xhr.abort();
			} catch {

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

				file: filtered.file,
				error,
				context: args.context,
			} );
			reject( error );
		} );

		xhr.addEventListener( 'abort', () => {
			const error = new UploadAbortedError();
			doAction( FILE_DROP_HOOKS.UPLOAD_FAILED, {

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

export class UploadCancelledError extends Error {
	constructor() {
		super( 'Upload cancelled by os.drop.before-upload filter.' );
		this.name = 'UploadCancelledError';
	}
}

export class UploadAbortedError extends Error {
	constructor() {
		super( 'Upload aborted by the caller.' );
		this.name = 'UploadAbortedError';
	}
}

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
			if ( cleanup.status < 200 || cleanup.status >= 300 ) {
				console.warn(
					`[os-file-drop] late-cancel cleanup failed for attachment ${ id } (HTTP ${ cleanup.status }). The attachment remains in the Media Library; delete it manually.`,
				);
			}
			resolve();
		} );
		cleanup.addEventListener( 'error', () => {
			console.warn(
				`[os-file-drop] late-cancel cleanup network error for attachment ${ id }. The attachment remains in the Media Library; delete it manually.`,
			);
			resolve();
		} );
		try {
			cleanup.send();
		} catch ( err ) {
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

	}
	return fallback;
}
