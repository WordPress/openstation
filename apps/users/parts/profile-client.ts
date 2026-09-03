/**
 * `<os-user-profile>` — the shell it talks to.
 *
 * The component mounts in two windows (the User Edit app, and the
 * Users app's Profile tab), and as a custom element it lives outside
 * either session: it cannot call `ctx.fetch`. It reads the REST root,
 * the nonce and the profile facts (roles, locales, colour schemes,
 * contact methods) off the app config blobs the framework ships
 * (`wp.os.getWindowConfig( id )`, the same store the runtime reads),
 * preferring the User Edit app's so the spinner lights the right
 * title bar, and requests through the shell's tracked fetch.
 */

import { joinRestUrl } from '../../../src/rest-url';
import { trackedFetch } from '../../../src/tracked-fetch';
import { __, copyText, sprintf } from '@openstation/app';
import type {
	AppPasswordItem,
	ProfileConfig,
	UserEditPatch,
	UserEditRecord,
	UserEditSaveResult,
	UserInsightsPayload,
} from './types';

export const USER_EDIT_ID = 'desktop-mode-user-edit';
export const USERS_ID = 'desktop-mode-users';

interface AppConfigBlob {
	restRoot?: string;
	restNonce?: string;
	extra?: ProfileConfig;
	[ key: string ]: unknown;
}

function configBlob( id: string ): AppConfigBlob | undefined {
	const store = ( window as unknown as {
		openStationWindowConfig?: Record< string, AppConfigBlob | undefined >;
	} ).openStationWindowConfig;
	return store?.[ id ];
}

/**
 * The window whose config the component reads — the User Edit app's
 * when it is registered, else the Users app's (the Profile tab).
 */
export function profileWindowId(): string {
	return configBlob( USER_EDIT_ID ) ? USER_EDIT_ID : USERS_ID;
}

/**
 * The profile facts, merged: the Users app's underneath the User Edit
 * app's, so every key has a backstop whichever window the component
 * happens to live in.
 */
export function resolveProfileConfig(): ProfileConfig {
	const users = configBlob( USERS_ID );
	const edit = configBlob( USER_EDIT_ID );
	return {
		...( ( users?.extra ?? {} ) as ProfileConfig ),
		...( ( edit?.extra ?? {} ) as ProfileConfig ),
	};
}

function restBase(): { root: string; nonce: string } {
	const blob = configBlob( USER_EDIT_ID ) ?? configBlob( USERS_ID );
	return {
		root: String( blob?.restRoot ?? '' ),
		nonce: String( blob?.restNonce ?? '' ),
	};
}

/**
 * A REST request against the site's root, attributed to the profile
 * window so its spinner shows.
 */
export function profileFetch(
	path: string,
	init: RequestInit = {},
	source = 'user-edit-window/rest',
	silent = false,
): Promise< Response > {
	const { root, nonce } = restBase();
	const headers = new Headers( init.headers );
	if ( ! headers.has( 'Accept' ) ) {
		headers.set( 'Accept', 'application/json' );
	}
	if ( nonce && ! headers.has( 'X-WP-Nonce' ) ) {
		headers.set( 'X-WP-Nonce', nonce );
	}
	if ( init.body && ! headers.has( 'Content-Type' ) ) {
		headers.set( 'Content-Type', 'application/json' );
	}
	return trackedFetch(
		joinRestUrl( root, path ),
		{ credentials: 'same-origin', ...init, headers },
		{ windowId: profileWindowId(), source, silent },
	);
}

/** `GET wp/v2/users/<id>?context=edit`. */
export async function fetchUser( id: number ): Promise< UserEditRecord > {
	const res = await profileFetch( `wp/v2/users/${ id }?context=edit`, {}, 'user-edit-window/load' );
	if ( ! res.ok ) {
		throw new Error( `[user-edit] load failed: ${ res.status }` );
	}
	return ( await res.json() ) as UserEditRecord;
}

/** `PUT wp/v2/users/<id>` — core's validation and capability rules. */
export async function saveUser( id: number, patch: UserEditPatch ): Promise< UserEditSaveResult > {
	const res = await profileFetch(
		`wp/v2/users/${ id }?context=edit`,
		{
			method: 'POST',
			headers: { 'X-HTTP-Method-Override': 'PUT' },
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
		for ( const [ key, value ] of Object.entries( data.data?.params ?? {} ) ) {
			fieldErrors[ key ] = String( value );
		}
		return { ok: false, error: data.code ?? `http_${ res.status }`, message: data.message, fieldErrors };
	}
	return { ok: true, user: ( await res.json() ) as UserEditRecord };
}

/** `GET desktop-mode/v1/users/<id>/insights`. */
export async function fetchInsights( id: number, fresh = false ): Promise< UserInsightsPayload > {
	const res = await profileFetch(
		`desktop-mode/v1/users/${ id }/insights${ fresh ? '?fresh=1' : '' }`,
		{},
		'user-edit-window/insights',
	);
	if ( ! res.ok ) {
		throw new Error( `[user-edit] insights failed: ${ res.status }` );
	}
	return ( await res.json() ) as UserInsightsPayload;
}

/** `POST desktop-mode/v1/users/<id>/destroy-sessions`. */
export async function destroySessions( id: number, scope: 'others' | 'all' ): Promise< void > {
	const res = await profileFetch(
		`desktop-mode/v1/users/${ id }/destroy-sessions`,
		{ method: 'POST', body: JSON.stringify( { scope } ) },
		'user-edit-window/destroy-sessions',
	);
	if ( ! res.ok ) {
		throw new Error( `http_${ res.status }` );
	}
}

/** `GET desktop-mode/v1/users/<id>/application-passwords`. */
export async function listAppPasswords( id: number ): Promise< AppPasswordItem[] > {
	const res = await profileFetch( `desktop-mode/v1/users/${ id }/application-passwords`, {}, 'user-edit-window/app-pw-list', true );
	if ( ! res.ok ) {
		return [];
	}
	const data = ( await res.json() ) as { items?: AppPasswordItem[] };
	return data.items ?? [];
}

/** `POST desktop-mode/v1/users/<id>/application-passwords` — the unhashed password, once. */
export async function createAppPassword( id: number, name: string ): Promise< string > {
	const res = await profileFetch(
		`desktop-mode/v1/users/${ id }/application-passwords`,
		{ method: 'POST', body: JSON.stringify( { name } ) },
		'user-edit-window/app-pw-create',
	);
	if ( ! res.ok ) {
		throw new Error( `http_${ res.status }` );
	}
	const data = ( await res.json() ) as { password: string };
	return data.password;
}

/** `DELETE desktop-mode/v1/users/<id>/application-passwords/<uuid>`. */
export async function revokeAppPassword( id: number, uuid: string ): Promise< void > {
	const res = await profileFetch(
		`desktop-mode/v1/users/${ id }/application-passwords/${ uuid }`,
		{ method: 'DELETE' },
		'user-edit-window/app-pw-revoke',
	);
	if ( ! res.ok ) {
		throw new Error( `http_${ res.status }` );
	}
}

// ─── Shared helpers ──────────────────────────────────────────────────

/**
 * A transient notice through the shell's toast surface. 5s for
 * success, 8s for error so the user has time to read the reason.
 */
export function toast( body: string, kind: 'success' | 'error' | 'info' = 'info' ): void {
	const api = window.wp?.os;
	if ( api?.showToast ) {
		let duration: number | undefined;
		if ( kind === 'error' ) {
			duration = 8000;
		} else if ( kind === 'success' ) {
			duration = 5000;
		}
		api.showToast( { message: body, duration } );
		return;
	}
	// eslint-disable-next-line no-console
	console.info( '[users]', body );
}

/** "3 d ago" for a unix timestamp; "—" when it is not one. */
export function relativeTime( ts: number ): string {
	if ( ! Number.isFinite( ts ) ) {
		return '—';
	}
	const delta = Math.floor( Date.now() / 1000 ) - ts;
	if ( delta < 60 ) {
		return __( 'just now' );
	}
	if ( delta < 3600 ) {
		// translators: %d is a number of minutes.
		return sprintf( __( '%d min ago' ), Math.floor( delta / 60 ) );
	}
	if ( delta < 86400 ) {
		// translators: %d is a number of hours.
		return sprintf( __( '%d h ago' ), Math.floor( delta / 3600 ) );
	}
	if ( delta < 86400 * 30 ) {
		// translators: %d is a number of days.
		return sprintf( __( '%d d ago' ), Math.floor( delta / 86400 ) );
	}
	if ( delta < 86400 * 365 ) {
		// translators: %d is a number of months.
		return sprintf( __( '%d mo ago' ), Math.floor( delta / ( 86400 * 30 ) ) );
	}
	// translators: %d is a number of years.
	return sprintf( __( '%d y ago' ), Math.floor( delta / ( 86400 * 365 ) ) );
}

/**
 * A server datetime as a millisecond epoch, or `NaN` when it is
 * empty, malformed or WordPress's `0000-00-00` zero date — the caller
 * renders "—" rather than fabricating "just now". Handles the SQL
 * shape (space separator, no zone) by normalising to ISO UTC.
 */
export function msFromIso( iso: string ): number {
	if ( ! iso || iso.startsWith( '0000-00-00' ) ) {
		return NaN;
	}
	let normalized = iso.includes( ' ' ) ? iso.replace( ' ', 'T' ) : iso;
	if ( ! /Z$/.test( normalized ) && ! /[+-]\d{2}:?\d{2}$/.test( normalized ) ) {
		normalized += 'Z';
	}
	const parsed = Date.parse( normalized );
	return Number.isFinite( parsed ) ? parsed : NaN;
}

/** `relativeTime` over a server datetime string, "—" when unparseable. */
export function relativeFromIso( iso: string ): string {
	const ms = msFromIso( iso );
	return Number.isFinite( ms ) ? relativeTime( Math.floor( ms / 1000 ) ) : '—';
}

/**
 * Strong-password generator — WP core's `wp_generate_password`
 * character set with symbols enabled.
 */
export function generateStrongPassword( length: number ): string {
	const all = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*-_=+';
	const buf = new Uint32Array( length );
	crypto.getRandomValues( buf );
	let out = '';
	for ( let i = 0; i < length; i += 1 ) {
		out += all[ buf[ i ] % all.length ];
	}
	return out;
}

/** Put text on the clipboard, best effort — the framework's honest copy, fire-and-forget. */
export function copyQuietly( text: string ): void {
	void copyText( text ).catch( () => false );
}
