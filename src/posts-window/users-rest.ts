/**
 * Native Users window — REST glue.
 *
 * Thin wrapper around `trackedFetch` for `/wp/v2/users` and the
 * three Users-window mutation endpoints (`bulk-role`,
 * `send-password-reset`, `resend-welcome`, `bulk-delete`). Mirrors
 * the per-window-client shape of `./rest.ts`.
 *
 * @public
 * @since 0.18.0
 */

import { trackedFetch } from '../tracked-fetch';
import type { PostsWindowConfig } from './rest';

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

export interface BulkRoleResultRow {
	ok: boolean;
	error?: string;
}

export interface BulkRoleResponse {
	role: string;
	results: Record< string, BulkRoleResultRow >;
}

export interface SimpleResult {
	ok: boolean;
	email?: string;
	error?: string;
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

export interface BulkDeleteResponse {
	results: Record< string, { ok: boolean; error?: string } >;
}

/**
 * Per-window Users REST client. Returned by {@link createUsersWindowClient}
 * and threaded through render code instead of imported as free
 * functions.
 *
 * @since 0.18.x
 */
export interface UsersWindowClient {
	readonly windowId: string;
	getConfig(): PostsWindowConfig;
	fetchUsers( params: UsersListParams ): Promise< UsersListResponse >;
	/**
	 * Fetch a single user row using the same `_fields` whitelist as
	 * {@link fetchUsers}. Returns `null` when the row is gone (e.g.
	 * the user was deleted between events). Used by the
	 * `desktop-mode.user.changed` live-refresh path to patch one row
	 * in place instead of re-fetching the whole page.
	 */
	fetchOneUser( id: number ): Promise< UserListItem | null >;
	bulkSetRole( ids: number[], role: string ): Promise< BulkRoleResponse >;
	sendPasswordReset( id: number ): Promise< SimpleResult >;
	resendWelcome( id: number ): Promise< SimpleResult >;
	createUser( body: CreateUserBody ): Promise< CreateUserResult >;
	bulkDeleteUsers(
		ids: number[],
		reassign?: number,
	): Promise< BulkDeleteResponse >;
}

/**
 * Build a Users REST client bound to a single window id.
 *
 * Defaults to `'desktop-mode-users'` to keep callers that don't yet
 * thread an explicit id working unchanged. Pass a different id for
 * any sibling window registered by a plugin that wants the same
 * Users surface (e.g. a per-blog users window on multisite).
 *
 * @since 0.18.x
 */
export function createUsersWindowClient(
	windowId: string = 'desktop-mode-users',
): UsersWindowClient {
	const getConfig = (): PostsWindowConfig => {
		const store = (
			window as unknown as {
				desktopModeWindowConfig?: Record< string, PostsWindowConfig >;
			}
		).desktopModeWindowConfig;
		const cfg = store?.[ windowId ];
		if ( ! cfg ) {
			throw new Error(
				`[${ windowId }] config blob is missing — was the window opened ` +
					'without registration? See ' +
					'`includes/users-window/window.php`.',
			);
		}
		return cfg;
	};

	const shellFetch = (
		input: RequestInfo,
		init?: RequestInit,
		options?: { source?: string; silent?: boolean },
	): Promise< Response > => {
		return trackedFetch( input, init, {
			windowId,
			source: options?.source ?? 'users-window/rest',
			silent: options?.silent,
		} );
	};

	const fetchUsers = async (
		params: UsersListParams,
	): Promise< UsersListResponse > => {
		const cfg = getConfig();
		// `usersUrl` is the semantically correct source for the Users
		// window; `postsUrl` is also set to `/wp/v2/users` in this
		// window's config but reading `usersUrl` makes the intent
		// obvious and is robust against future config-shape drift.
		const baseUrl = cfg.usersUrl || cfg.postsUrl;
		const url = new URL( baseUrl );

		for ( const [ key, value ] of Object.entries( cfg.queryArgs ?? {} ) ) {
			if ( typeof value === 'string' && value !== '' ) {
				url.searchParams.set( key, value );
			}
		}

		url.searchParams.set( 'page', String( Math.max( 1, params.page ) ) );
		url.searchParams.set(
			'per_page',
			String( Math.max( 1, params.perPage ) ),
		);
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

		const res = await shellFetch(
			url.toString(),
			{
				method: 'GET',
				credentials: 'same-origin',
				headers: {
					Accept: 'application/json',
					'X-WP-Nonce': cfg.restNonce,
				},
			},
			{ source: 'users-window/list' },
		);
		if ( ! res.ok ) {
			throw new Error(
				`[users-window] list fetch failed: ${ res.status }`,
			);
		}
		const items = ( await res.json() ) as UserListItem[];
		const total = parseInt( res.headers.get( 'X-WP-Total' ) ?? '0', 10 );
		const totalPages = parseInt(
			res.headers.get( 'X-WP-TotalPages' ) ?? '0',
			10,
		);
		return { items, total, totalPages };
	};

	const fetchOneUser = async (
		id: number,
	): Promise< UserListItem | null > => {
		const cfg = getConfig();
		const baseUrl = cfg.usersUrl || cfg.postsUrl;
		const url = new URL( `${ baseUrl.replace( /\/$/, '' ) }/${ id }` );
		// Carry the same `_fields` + `context` the list endpoint uses so
		// the patched row shape matches what `fetchUsers` produced.
		for ( const [ key, value ] of Object.entries( cfg.queryArgs ?? {} ) ) {
			if ( typeof value === 'string' && value !== '' ) {
				url.searchParams.set( key, value );
			}
		}
		const res = await shellFetch(
			url.toString(),
			{
				method: 'GET',
				credentials: 'same-origin',
				headers: {
					Accept: 'application/json',
					'X-WP-Nonce': cfg.restNonce,
				},
			},
			{ source: 'users-window/one', silent: true },
		);
		if ( res.status === 404 ) {
			return null;
		}
		if ( ! res.ok ) {
			throw new Error(
				`[users-window] one fetch failed: ${ res.status }`,
			);
		}
		return ( await res.json() ) as UserListItem;
	};

	const bulkSetRole = async (
		ids: number[],
		role: string,
	): Promise< BulkRoleResponse > => {
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
			throw new Error(
				`[users-window] bulk-role failed: ${ res.status }`,
			);
		}
		return ( await res.json() ) as BulkRoleResponse;
	};

	const sendPasswordReset = async (
		id: number,
	): Promise< SimpleResult > => {
		const cfg = getConfig();
		const base =
			( cfg as unknown as { sendResetUrlBase?: string } )
				.sendResetUrlBase ?? `${ cfg.restRoot }desktop-mode/v1/users/`;
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
	};

	const resendWelcome = async ( id: number ): Promise< SimpleResult > => {
		const cfg = getConfig();
		const base =
			( cfg as unknown as { sendResetUrlBase?: string } )
				.sendResetUrlBase ?? `${ cfg.restRoot }desktop-mode/v1/users/`;
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
	};

	const createUser = async (
		body: CreateUserBody,
	): Promise< CreateUserResult > => {
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
	};

	const bulkDeleteUsers = async (
		ids: number[],
		reassign?: number,
	): Promise< BulkDeleteResponse > => {
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
			throw new Error(
				`[users-window] bulk-delete failed: ${ res.status }`,
			);
		}
		return ( await res.json() ) as BulkDeleteResponse;
	};

	return {
		windowId,
		getConfig,
		fetchUsers,
		fetchOneUser,
		bulkSetRole,
		sendPasswordReset,
		resendWelcome,
		createUser,
		bulkDeleteUsers,
	};
}
