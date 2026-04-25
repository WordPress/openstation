/**
 * Code Editor — REST glue.
 *
 * Single thin layer over `fetch()` so every endpoint inherits the
 * same `X-WP-Nonce` header, AbortController plumbing, and JSON
 * decoding. Callers see typed promises; errors surface as a typed
 * `RestError` with the WP error `code` for branching.
 *
 * @public
 * @since 0.18.0
 */

import type { CodeEditorConfig } from './monaco-bootstrap';

export interface TreeEntry {
	name: string;
	path: string;
	type: 'dir' | 'file';
	size: number;
	mtime: number;
	allowed: boolean;
}

export interface TreeResponse {
	path: string;
	entries: TreeEntry[];
}

export interface FileResponse {
	path: string;
	content: string;
	mtime: number;
	size: number;
	encoding: string;
}

/** Typed REST error — carries the server's WP_Error `code` for branching. */
export class RestError extends Error {
	public readonly code: string;
	public readonly status: number;
	public readonly data: unknown;

	constructor( message: string, code: string, status: number, data: unknown ) {
		super( message );
		this.name = 'RestError';
		this.code = code;
		this.status = status;
		this.data = data;
	}
}

function getConfig(): CodeEditorConfig {
	const config = window.wpDesktopCodeEditorConfig;
	if ( ! config ) {
		throw new Error(
			'wp-desktop-code-editor: wpDesktopCodeEditorConfig missing — is the editor enqueued?',
		);
	}
	return config;
}

async function getJson< T >(
	url: string,
	params: Record< string, string >,
	signal?: AbortSignal,
): Promise< T > {
	const config = getConfig();
	const u = new URL( url );
	for ( const [ k, v ] of Object.entries( params ) ) {
		u.searchParams.set( k, v );
	}

	const res = await fetch( u.toString(), {
		method: 'GET',
		credentials: 'same-origin',
		headers: {
			Accept: 'application/json',
			'X-WP-Nonce': config.restNonce,
		},
		signal,
	} );

	let body: unknown = null;
	try {
		body = await res.json();
	} catch {
		body = null;
	}

	if ( ! res.ok ) {
		const obj = ( body ?? {} ) as {
			code?: string;
			message?: string;
			data?: unknown;
		};
		throw new RestError(
			obj.message ?? `HTTP ${ res.status }`,
			obj.code ?? 'wpdc_http_error',
			res.status,
			obj.data ?? null,
		);
	}

	return body as T;
}

/**
 * GET /wp-desktop/v1/code/tree?path=<rel>
 */
export function fetchTree(
	path: string,
	signal?: AbortSignal,
): Promise< TreeResponse > {
	return getJson< TreeResponse >(
		getConfig().treeUrl,
		{ path },
		signal,
	);
}

/**
 * GET /wp-desktop/v1/code/file?path=<rel>
 */
export function fetchFile(
	path: string,
	signal?: AbortSignal,
): Promise< FileResponse > {
	return getJson< FileResponse >(
		getConfig().fileUrl,
		{ path },
		signal,
	);
}

/** Server's response to a successful save. */
export interface SaveResponse {
	path: string;
	mtime: number;
	size: number;
}

/** Error data shape on a 409 conflict. */
export interface ConflictData {
	server_mtime: number;
	server_content: string;
	server_size: number;
}

/**
 * Encode a JS string to base64. UTF-safe — `btoa()` alone fails on
 * any non-ASCII character; we go through TextEncoder and then base64
 * the bytes.
 */
function utf8ToBase64( str: string ): string {
	const bytes = new TextEncoder().encode( str );
	let bin = '';
	for ( let i = 0; i < bytes.length; i++ ) {
		bin += String.fromCharCode( bytes[ i ] );
	}
	return btoa( bin );
}

/**
 * POST /wp-desktop/v1/code/file — write a file's contents.
 *
 * On a 409 conflict (file changed on disk since the editor opened
 * it) the thrown {@link RestError} carries `data` shaped as
 * {@link ConflictData} — caller can branch and offer "reload from
 * disk" / "overwrite anyway".
 *
 * @since 0.18.0
 */
export async function saveFile(
	path: string,
	content: string,
	mtime: number,
	signal?: AbortSignal,
): Promise< SaveResponse > {
	const config = getConfig();

	const res = await fetch( config.fileUrl, {
		method: 'POST',
		credentials: 'same-origin',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			'X-WP-Nonce': config.restNonce,
		},
		body: JSON.stringify( {
			path,
			content_b64: utf8ToBase64( content ),
			mtime,
		} ),
		signal,
	} );

	let body: unknown = null;
	try {
		body = await res.json();
	} catch {
		body = null;
	}

	if ( ! res.ok ) {
		const obj = ( body ?? {} ) as {
			code?: string;
			message?: string;
			data?: unknown;
		};
		throw new RestError(
			obj.message ?? `HTTP ${ res.status }`,
			obj.code ?? 'wpdc_http_error',
			res.status,
			obj.data ?? null,
		);
	}

	return body as SaveResponse;
}
