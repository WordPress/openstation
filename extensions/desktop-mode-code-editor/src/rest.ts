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
	const config = window.openStationCodeEditorConfig;
	if ( ! config ) {
		throw new Error(
			'os-code-editor: openStationCodeEditorConfig missing — is the editor enqueued?',
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
			obj.code ?? 'osc_http_error',
			res.status,
			obj.data ?? null,
		);
	}

	return body as T;
}

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

export type PhpSymbolKind = 'function' | 'action' | 'filter' | 'class' | 'constant';

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

	file?: string;

	line?: number;
}

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
			obj.code ?? 'osc_http_error',
			res.status,
			null,
		);
	}

	return body as PhpSymbolDetail;
}

export interface SaveResponse {
	path: string;
	mtime: number;
	size: number;
}

export interface ConflictData {
	server_mtime: number;
	server_content: string;
	server_size: number;
}

function utf8ToBase64( str: string ): string {
	const bytes = new TextEncoder().encode( str );
	let bin = '';
	for ( let i = 0; i < bytes.length; i++ ) {
		bin += String.fromCharCode( bytes[ i ] );
	}
	return btoa( bin );
}

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
			obj.code ?? 'osc_http_error',
			res.status,
			obj.data ?? null,
		);
	}

	return body as SaveResponse;
}
