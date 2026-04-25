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
