/**
 * Recycle Bin — REST glue.
 *
 * Thin wrapper around `fetch()` that injects the WP REST nonce, JSON
 * content type, and uniform error handling. Every HTTP call from the
 * window goes through here so credentials/nonce handling stays in one
 * place.
 *
 * @since 0.19.0
 */

declare global {
	interface Window {
		wpDesktopRecycleBinConfig?: {
			restNonce: string;
			listUrl: string;
			restoreUrl: string;
			purgeUrl: string;
			emptyUrl: string;
		};
	}
}

export interface RecycleBinItem {
	id: number;
	type: string;
	title: string;
	subtitle: string;
	mime: string;
	preview: string;
	icon: string;
	deleted_at: string;
	deleted_by: string;
	deleted_by_id: number;
	can_restore: boolean;
	can_purge: boolean;
	edit_link: string;
	[ key: string ]: unknown;
}

export interface ListResponse {
	items: RecycleBinItem[];
	total: number;
}

export interface BulkResponse {
	ok: number[];
	errors: Array< { id: number; code: string; message: string } >;
}

export interface EmptyResponse {
	purged: number;
	skipped: number;
	remaining: number;
}

function config(): NonNullable< Window[ 'wpDesktopRecycleBinConfig' ] > {
	const cfg = window.wpDesktopRecycleBinConfig;
	if ( ! cfg ) {
		throw new Error(
			'wpDesktopRecycleBinConfig is missing — the recycle-bin bundle was loaded outside of desktop mode.',
		);
	}
	return cfg;
}

async function request< T >( url: string, init: RequestInit ): Promise< T > {
	const cfg = config();
	const response = await fetch( url, {
		...init,
		credentials: 'same-origin',
		headers: {
			'X-WP-Nonce': cfg.restNonce,
			Accept: 'application/json',
			...( init.body ? { 'Content-Type': 'application/json' } : {} ),
			...( init.headers ?? {} ),
		},
	} );

	if ( ! response.ok ) {
		// Surface WP_Error JSON when present; fall back to the status
		// line otherwise. Either way callers get a thrown Error they
		// can show inline.
		let message = `${ response.status } ${ response.statusText }`;
		try {
			const json = ( await response.json() ) as { message?: string };
			if ( json && typeof json.message === 'string' ) {
				message = json.message;
			}
		} catch {
			// Ignore — non-JSON body, use the status line.
		}
		throw new Error( message );
	}

	return ( await response.json() ) as T;
}

export function fetchList( params: {
	page?: number;
	perPage?: number;
	type?: string;
	search?: string;
} = {} ): Promise< ListResponse > {
	const url = new URL( config().listUrl );
	if ( params.page ) {
		url.searchParams.set( 'page', String( params.page ) );
	}
	if ( params.perPage ) {
		url.searchParams.set( 'per_page', String( params.perPage ) );
	}
	if ( params.type ) {
		url.searchParams.set( 'type', params.type );
	}
	if ( params.search ) {
		url.searchParams.set( 'search', params.search );
	}
	return request< ListResponse >( url.toString(), { method: 'GET' } );
}

/**
 * `{ id, type }` pair the REST endpoints accept. `type` is the
 * row's `type` field (e.g. `'post' | 'page' | 'attachment' |
 * 'comment'`). Sending the type with each id lets the server
 * dispatch to the right restore/purge function — comments go
 * through `wp_untrash_comment`, posts through `wp_untrash_post`.
 */
export interface RecycleBinItemRef {
	id: number;
	type: string;
}

export function restoreItems(
	items: RecycleBinItemRef[],
): Promise< BulkResponse > {
	return request< BulkResponse >( config().restoreUrl, {
		method: 'POST',
		body: JSON.stringify( { items } ),
	} );
}

export function purgeItems(
	items: RecycleBinItemRef[],
): Promise< BulkResponse > {
	return request< BulkResponse >( config().purgeUrl, {
		method: 'POST',
		body: JSON.stringify( { items } ),
	} );
}

export function emptyBin(): Promise< EmptyResponse > {
	return request< EmptyResponse >( config().emptyUrl, {
		method: 'POST',
		body: JSON.stringify( {} ),
	} );
}
