/**
 * REST helpers for the Native User Edit window.
 *
 * Reads/writes go through core's `/wp/v2/users/<id>?context=edit`
 * endpoint so capability + validation rules match the rest-of-WP
 * source of truth. Insights come from our own
 * `/desktop-mode/v1/users/<id>/insights` endpoint.
 */

import { joinRestUrl } from '../rest-url';
import { trackedFetch } from '../tracked-fetch';
import type { PostsWindowConfig } from './rest';

export interface UserEditRecord {
	id: number;
	username: string;
	name: string;
	first_name: string;
	last_name: string;
	nickname?: string;
	email: string;
	url: string;
	description: string;
	locale: string;
	roles: string[];
	registered_date?: string;
	avatar_urls?: Record< string, string >;
	link?: string;
	slug?: string;
	meta?: Record< string, unknown >;
	[ key: string ]: unknown;
}

export interface UserInsightsPayload {
	userId: number;
	displayName: string;
	avatarUrl: string;
	profileUrl: string;
	roles: string[];
	capabilitiesCount: number;
	profileCompleteness: { filled: number; total: number; percent: number };
	stats: {
		posts: number;
		pages: number;
		attachments: number;
		commentsAuthored: number;
		commentsReceived: number;
		daysSinceRegistration: number | null;
		lastLoginAt: number | null;
		daysSinceLastLogin: number | null;
		registeredAt: number | null;
	};
	contentByMonth: Array< { month: string; count: number } >;
	recentPosts: Array< {
		id: number;
		title: string;
		status: string;
		type: string;
		dateGmt: string;
		commentCount: number;
		permalink: string;
		editUrl: string;
	} >;
	recentComments: Array< {
		id: number;
		postId: number;
		postTitle: string;
		excerpt: string;
		dateGmt: string;
		approved: boolean;
	} >;
	sessions: Array< {
		expiration: number;
		login: number;
		ip: string;
		ua: string;
		current: boolean;
	} >;
	applicationPasswords: {
		total: number;
		lastUsedAt: number | null;
		lastUsedName: string | null;
	};
}

export interface UserEditPatch {
	first_name?: string;
	last_name?: string;
	nickname?: string;
	name?: string;
	email?: string;
	url?: string;
	description?: string;
	locale?: string;
	roles?: string[];
	password?: string;
	slug?: string;
	meta?: Record< string, unknown >;
}

export interface UserEditSaveResult {
	ok: boolean;
	user?: UserEditRecord;
	error?: string;
	message?: string;
	fieldErrors?: Record< string, string >;
}

/**
 * Per-window User-edit REST client. Returned by
 * {@link createUserEditClient}.
 */
export interface UserEditClient {
	readonly windowId: string;
	getConfig(): PostsWindowConfig;
	fetchUser( id: number ): Promise< UserEditRecord >;
	saveUser(
		id: number,
		patch: UserEditPatch,
	): Promise< UserEditSaveResult >;
	fetchInsights(
		id: number,
		opts?: { fresh?: boolean },
	): Promise< UserInsightsPayload >;
}

/**
 * Build a User-edit REST client bound to a single window id.
 */
export function createUserEditClient(
	windowId: string = 'desktop-mode-user-edit',
): UserEditClient {
	const getConfig = (): PostsWindowConfig => {
		const store = (
			window as unknown as {
				openStationWindowConfig?: Record< string, PostsWindowConfig >;
			}
		).openStationWindowConfig;
		const cfg = store?.[ windowId ];
		if ( ! cfg ) {
			throw new Error(
				`[${ windowId }] config blob is missing — was the window opened ` +
					'without registration? See ' +
					'`includes/user-edit-window/window.php`.',
			);
		}
		return cfg;
	};

	const shellFetch = (
		input: RequestInfo,
		init?: RequestInit,
		source?: string,
	): Promise< Response > => {
		return trackedFetch( input, init, {
			windowId,
			source: source ?? 'user-edit-window/rest',
		} );
	};

	const fetchUser = async ( id: number ): Promise< UserEditRecord > => {
		const cfg = getConfig();
		const base =
			( cfg as unknown as { usersUrl?: string } ).usersUrl ??
			joinRestUrl( cfg.restRoot, 'wp/v2/users' );
		const url = joinRestUrl( base, `${ id }?context=edit` );
		const res = await shellFetch(
			url,
			{
				method: 'GET',
				credentials: 'same-origin',
				headers: {
					Accept: 'application/json',
					'X-WP-Nonce': cfg.restNonce,
				},
			},
			'user-edit-window/load',
		);
		if ( ! res.ok ) {
			throw new Error( `[user-edit] load failed: ${ res.status }` );
		}
		return ( await res.json() ) as UserEditRecord;
	};

	const saveUser = async (
		id: number,
		patch: UserEditPatch,
	): Promise< UserEditSaveResult > => {
		const cfg = getConfig();
		const base =
			( cfg as unknown as { usersUrl?: string } ).usersUrl ??
			joinRestUrl( cfg.restRoot, 'wp/v2/users' );
		const res = await shellFetch(
			joinRestUrl( base, `${ id }?context=edit` ),
			{
				method: 'POST', // PUT == POST for WP REST when X-HTTP-Method-Override is unsupported.
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': cfg.restNonce,
					'X-HTTP-Method-Override': 'PUT',
				},
				body: JSON.stringify( patch ),
			},
			'user-edit-window/save',
		);
		if ( ! res.ok ) {
			const data = ( await res.json().catch( () => ( {} ) ) ) as {
				code?: string;
				message?: string;
				data?: { params?: Record< string, string > };
			};
			const fieldErrors: Record< string, string > = {};
			const params = data.data?.params;
			if ( params && typeof params === 'object' ) {
				for ( const [ k, v ] of Object.entries( params ) ) {
					fieldErrors[ k ] = String( v );
				}
			}
			return {
				ok: false,
				error: data.code ?? `http_${ res.status }`,
				message: data.message,
				fieldErrors,
			};
		}
		const user = ( await res.json() ) as UserEditRecord;
		return { ok: true, user };
	};

	const fetchInsights = async (
		id: number,
		opts: { fresh?: boolean } = {},
	): Promise< UserInsightsPayload > => {
		const cfg = getConfig();
		const base =
			( cfg as unknown as { insightsUrlBase?: string } )
				.insightsUrlBase ?? joinRestUrl( cfg.restRoot, 'desktop-mode/v1/users/' );
		const url = new URL( joinRestUrl( base, `${ id }/insights` ) );
		if ( opts.fresh ) {
			url.searchParams.set( 'fresh', '1' );
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
			'user-edit-window/insights',
		);
		if ( ! res.ok ) {
			throw new Error( `[user-edit] insights failed: ${ res.status }` );
		}
		return ( await res.json() ) as UserInsightsPayload;
	};

	return {
		windowId,
		getConfig,
		fetchUser,
		saveUser,
		fetchInsights,
	};
}
