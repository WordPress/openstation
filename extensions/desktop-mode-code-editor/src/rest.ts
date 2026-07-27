/**
 * Code Editor — REST glue.
 *
 * Single thin layer over `fetch()` so every endpoint inherits the
 * same `X-WP-Nonce` header, AbortController plumbing, and JSON
 * decoding. Callers see typed promises; errors surface as a typed
 * `RestError` with the WP error `code` for branching.
 *
 * @public
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
 * GET /desktop-mode-code-editor/v1/tree?path=<rel>
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
 * GET /desktop-mode-code-editor/v1/file?path=<rel>
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

// ---------------------------------------------------------------------------
// PHP symbol lookup
// ---------------------------------------------------------------------------

export type PhpSymbolKind = 'function' | 'action' | 'filter' | 'class' | 'constant';

/** List-mode entry — trim shape, no full PHPDoc. */
export interface PhpSymbolMatch {
	name: string;
	kind: PhpSymbolKind;
	signature: string;
	since: string;
	source: string;
}

export interface PhpSymbolsResponse {
	prefix: string;
	kinds: PhpSymbolKind[];
	count: number;
	matches: PhpSymbolMatch[];
}

/** Detail-mode entry — full PHPDoc + parameter list. */
export interface PhpSymbolDetail extends PhpSymbolMatch {
	doc: string;
	params?: Array< {
		name: string;
		optional: boolean;
		default: string | null;
		variadic: boolean;
		by_ref: boolean;
		type: string | null;
	} >;
	/** Workspace symbols only — relative path under the workspace root. */
	file?: string;
	/** Workspace symbols only — 1-indexed line of the declaration. */
	line?: number;
}

/**
 * GET /desktop-mode-code-editor/v1/php-symbols?prefix=…&kinds=…
 *
 * Returns the trimmed list shape (no full doc strings) — Monaco
 * fetches the heavy `PhpSymbolDetail` lazily via {@link fetchPhpSymbolDetail}
 * only when the user hovers / requests resolve.
 */
export function fetchPhpSymbols(
	prefix: string,
	kinds: PhpSymbolKind[],
	signal?: AbortSignal,
): Promise< PhpSymbolsResponse > {
	const params: Record< string, string > = { prefix };
	if ( kinds.length > 0 ) {
		params.kinds = kinds.join( ',' );
	}
	return getJson< PhpSymbolsResponse >(
		getConfig().phpSymbolsUrl,
		params,
		signal,
	);
}

/**
 * GET /desktop-mode-code-editor/v1/php-symbols/<name>
 *
 * Full record for one symbol — PHPDoc summary, parameters, source.
 * Drives the hover popover.
 */
export async function fetchPhpSymbolDetail(
	name: string,
	signal?: AbortSignal,
): Promise< PhpSymbolDetail > {
	const config = getConfig();
	const url = config.phpSymbolUrl + encodeURIComponent( name );

	const res = await fetch( url, {
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
		const obj = ( body ?? {} ) as { code?: string; message?: string };
		throw new RestError(
			obj.message ?? `HTTP ${ res.status }`,
			obj.code ?? 'wpdc_http_error',
			res.status,
			null,
		);
	}

	return body as PhpSymbolDetail;
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
 * POST /desktop-mode-code-editor/v1/file — write a file's contents.
 * The server registers both PUT and POST on this route; the client
 * sends POST because some hosts' WAFs block PUT requests containing
 * `<?php` strings.
 *
 * On a 409 conflict (file changed on disk since the editor opened
 * it) the thrown {@link RestError} carries `data` shaped as
 * {@link ConflictData} — caller can branch and offer "reload from
 * disk" / "overwrite anyway".
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
