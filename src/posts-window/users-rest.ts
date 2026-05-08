/**
 * Native Users window — REST glue.
 *
 * Thin wrapper around `trackedFetch` for `/wp/v2/users` and the
 * three Users-window mutation endpoints (`bulk-role`,
 * `send-password-reset`, `resend-welcome`, `bulk-delete`). Mirrors
 * the shape of `./rest.ts` for Posts; kept separate so Users can
 * grow its own helpers without bloating the Posts surface.
 *
 * @public
 * @since 0.18.0
 */

import { trackedFetch } from '../tracked-fetch';
import { getActiveWindowId, getConfig } from './rest';

export type UserPresence = 'online' | 'inactive' | 'offline';

export interface UserStats {
	posts: number;
	pages: number;
	comments: number;
}

export interface UserListItem {
	id: number;
	name: string;
	slug: string;
	email?: string;
	url?: string;
	description?: string;
	roles: string[];
	registered_date?: string;
	avatar_urls?: Record< string, string >;
	desktop_mode_user_stats?: UserStats;
	/** UTC unix timestamp; null when never recorded. */
	desktop_mode_last_login?: number | null;
	desktop_mode_presence?: UserPresence;
	desktop_mode_can_edit?: boolean;
	/** Role slugs the viewer can assign to this row. */
	desktop_mode_assignable_roles?: string[];
	[ key: string ]: unknown;
}

export interface UsersListResponse {
	items: UserListItem[];
	total: number;
	totalPages: number;
}

export interface UsersListParams {
	page: number;
	perPage: number;
	search?: string;
	/** Role slugs to include (multi-select). */
	roles?: string[];
	/** REST orderby: id|name|registered_date|email|slug. */
	orderby?: string;
	order?: 'asc' | 'desc';
}

interface RequestOptions extends RequestInit {
	source?: string;
	silent?: boolean;
}

function shellFetch(
	input: RequestInfo,
	init?: RequestInit,
	options?: { source?: string; silent?: boolean },
): Promise< Response > {
	return trackedFetch( input, init, {
		windowId: getActiveWindowId(),
		source: options?.source ?? 'users-window/rest',
		silent: options?.silent,
	} );
}

/**
 * Fetch a page of users from `/wp/v2/users`. Reads `total` /
 * `totalPages` from the response headers, same pattern as
 * `./rest.ts:fetchPosts`.
 *
 * @since 0.18.0
 */
export async function fetchUsers(
	params: UsersListParams,
): Promise< UsersListResponse > {
	const cfg = getConfig();
	const url = new URL( cfg.postsUrl );

	for ( const [ key, value ] of Object.entries( cfg.queryArgs ?? {} ) ) {
		if ( typeof value === 'string' && value !== '' ) {
			url.searchParams.set( key, value );
		}
	}

	url.searchParams.set( 'page', String( Math.max( 1, params.page ) ) );
	url.searchParams.set( 'per_page', String( Math.max( 1, params.perPage ) ) );
	if ( params.search ) {
		url.searchParams.set( 'search', params.search );
	}
	if ( params.roles && params.roles.length > 0 ) {
		// Core's `/wp/v2/users` accepts `roles[]=editor&roles[]=author`.
		for ( const r of params.roles ) {
			url.searchParams.append( 'roles', r );
		}
	}
	if ( params.orderby ) {
		url.searchParams.set( 'orderby', params.orderby );
	}
	if ( params.order ) {
		url.searchParams.set( 'order', params.order );
	}

	const init: RequestOptions = {
		method: 'GET',
		credentials: 'same-origin',
		headers: {
			Accept: 'application/json',
			'X-WP-Nonce': cfg.restNonce,
		},
	};

	const res = await shellFetch( url.toString(), init, {
		source: 'users-window/list',
	} );
	if ( ! res.ok ) {
		throw new Error( `[users-window] list fetch failed: ${ res.status }` );
	}
	const items = ( await res.json() ) as UserListItem[];
	const total = parseInt( res.headers.get( 'X-WP-Total' ) ?? '0', 10 );
	const totalPages = parseInt(
		res.headers.get( 'X-WP-TotalPages' ) ?? '0',
		10,
	);
	return { items, total, totalPages };
}

export interface BulkRoleResultRow {
	ok: boolean;
	error?: string;
}

export interface BulkRoleResponse {
	role: string;
	results: Record< string, BulkRoleResultRow >;
}

/**
 * `POST /desktop-mode/v1/users/bulk-role`. Server enforces
 * per-target permission via `editable_roles` — the response
 * always carries a per-id outcome map so partial success is
 * representable. Pass an empty `ids` array to short-circuit.
 *
 * @since 0.18.0
 */
export async function bulkSetRole(
	ids: number[],
	role: string,
): Promise< BulkRoleResponse > {
	const cfg = getConfig();
	const url =
		( cfg as unknown as { bulkRoleUrl?: string } ).bulkRoleUrl ??
		`${ cfg.restRoot }desktop-mode/v1/users/bulk-role`;
	const res = await shellFetch(
		url,
		{
			method: 'POST',
			credentials: 'same-origin',
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': cfg.restNonce,
			},
			body: JSON.stringify( { ids, role } ),
		},
		{ source: 'users-window/bulk-role' },
	);
	if ( ! res.ok ) {
		throw new Error( `[users-window] bulk-role failed: ${ res.status }` );
	}
	return ( await res.json() ) as BulkRoleResponse;
}

export interface SimpleResult {
	ok: boolean;
	email?: string;
	error?: string;
}

/**
 * `POST /desktop-mode/v1/users/<id>/send-password-reset`.
 *
 * @since 0.18.0
 */
export async function sendPasswordReset( id: number ): Promise< SimpleResult > {
	const cfg = getConfig();
	const base =
		( cfg as unknown as { sendResetUrlBase?: string } ).sendResetUrlBase ??
		`${ cfg.restRoot }desktop-mode/v1/users/`;
	const res = await shellFetch(
		`${ base }${ id }/send-password-reset`,
		{
			method: 'POST',
			credentials: 'same-origin',
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': cfg.restNonce,
			},
		},
		{ source: 'users-window/send-password-reset' },
	);
	if ( ! res.ok ) {
		const body = await res.json().catch( () => ( {} ) );
		return {
			ok: false,
			error:
				typeof ( body as { code?: string } ).code === 'string'
					? ( body as { code: string } ).code
					: `http_${ res.status }`,
		};
	}
	const data = ( await res.json() ) as { ok: boolean; email?: string };
	return { ok: data.ok === true, email: data.email };
}

/**
 * `POST /desktop-mode/v1/users/<id>/resend-welcome`.
 *
 * @since 0.18.0
 */
export async function resendWelcome( id: number ): Promise< SimpleResult > {
	const cfg = getConfig();
	const base =
		( cfg as unknown as { sendResetUrlBase?: string } ).sendResetUrlBase ??
		`${ cfg.restRoot }desktop-mode/v1/users/`;
	const res = await shellFetch(
		`${ base }${ id }/resend-welcome`,
		{
			method: 'POST',
			credentials: 'same-origin',
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': cfg.restNonce,
			},
		},
		{ source: 'users-window/resend-welcome' },
	);
	if ( ! res.ok ) {
		const body = await res.json().catch( () => ( {} ) );
		return {
			ok: false,
			error:
				typeof ( body as { code?: string } ).code === 'string'
					? ( body as { code: string } ).code
					: `http_${ res.status }`,
		};
	}
	const data = ( await res.json() ) as { ok: boolean; email?: string };
	return { ok: data.ok === true, email: data.email };
}

export interface CreateUserBody {
	username: string;
	email: string;
	first_name?: string;
	last_name?: string;
	url?: string;
	locale?: string;
	password?: string;
	role?: string;
	send_notification?: boolean;
}

export interface CreateUserResult {
	ok: boolean;
	user_id?: number;
	email?: string;
	error?: string;
	message?: string;
}

/**
 * `POST /desktop-mode/v1/users`. Creates a new WordPress user with
 * the supplied fields. Server-side enforces `create_users` cap +
 * `editable_roles` per role choice.
 *
 * @since 0.18.0
 */
export async function createUser(
	body: CreateUserBody,
): Promise< CreateUserResult > {
	const cfg = getConfig();
	const url =
		( cfg as unknown as { createUserUrl?: string } ).createUserUrl ??
		`${ cfg.restRoot }desktop-mode/v1/users`;
	const res = await shellFetch(
		url,
		{
			method: 'POST',
			credentials: 'same-origin',
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': cfg.restNonce,
			},
			body: JSON.stringify( body ),
		},
		{ source: 'users-window/create' },
	);
	if ( ! res.ok ) {
		const data = await res.json().catch( () => ( {} ) );
		const code = ( data as { code?: string } ).code;
		const message = ( data as { message?: string } ).message;
		return {
			ok: false,
			error: typeof code === 'string' ? code : `http_${ res.status }`,
			message: typeof message === 'string' ? message : undefined,
		};
	}
	const data = ( await res.json() ) as {
		ok: boolean;
		user_id?: number;
		email?: string;
	};
	return {
		ok: data.ok === true,
		user_id: data.user_id,
		email: data.email,
	};
}

export interface BulkDeleteResponse {
	results: Record< string, { ok: boolean; error?: string } >;
}

/**
 * `POST /desktop-mode/v1/users/bulk-delete`. On single-site this
 * hard-deletes; on multisite it removes from the current blog only.
 * Optional `reassign` reassigns the deleted users' content to the
 * given user id.
 *
 * @since 0.18.0
 */
export async function bulkDeleteUsers(
	ids: number[],
	reassign?: number,
): Promise< BulkDeleteResponse > {
	const cfg = getConfig();
	const url =
		( cfg as unknown as { bulkDeleteUrl?: string } ).bulkDeleteUrl ??
		`${ cfg.restRoot }desktop-mode/v1/users/bulk-delete`;
	const body: Record< string, unknown > = { ids };
	if ( typeof reassign === 'number' && reassign > 0 ) {
		body.reassign = reassign;
	}
	const res = await shellFetch(
		url,
		{
			method: 'POST',
			credentials: 'same-origin',
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': cfg.restNonce,
			},
			body: JSON.stringify( body ),
		},
		{ source: 'users-window/bulk-delete' },
	);
	if ( ! res.ok ) {
		throw new Error( `[users-window] bulk-delete failed: ${ res.status }` );
	}
	return ( await res.json() ) as BulkDeleteResponse;
}
