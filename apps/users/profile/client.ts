/**
 * `<os-user-profile>` — the REST calls, over the host's fetch, and the
 * small helpers the profile parts share.
 */

import { copyText, formatDate } from '@openstation/app';
import '../../../src/ui/components/os-relative-time/os-relative-time';
import type {
	AppPasswordItem,
	ProfileHost,
	UserEditPatch,
	UserEditRecord,
	UserEditSaveResult,
	UserInsightsPayload,
} from './types';

/** `GET wp/v2/users/<id>?context=edit`. */
export async function fetchUser( host: ProfileHost, id: number ): Promise< UserEditRecord > {
	const res = await host.fetch( `wp/v2/users/${ id }?context=edit` );
	if ( ! res.ok ) {
		throw new Error( `[user-edit] load failed: ${ res.status }` );
	}
	return ( await res.json() ) as UserEditRecord;
}

/** `PUT wp/v2/users/<id>` — core's validation and capability rules. */
export async function saveUser( host: ProfileHost, id: number, patch: UserEditPatch ): Promise< UserEditSaveResult > {
	const res = await host.fetch( `wp/v2/users/${ id }?context=edit`, {
		method: 'POST',
		headers: { 'X-HTTP-Method-Override': 'PUT', 'Content-Type': 'application/json' },
		body: JSON.stringify( patch ),
	} );
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
export async function fetchInsights( host: ProfileHost, id: number, fresh = false ): Promise< UserInsightsPayload > {
	const res = await host.fetch( `desktop-mode/v1/users/${ id }/insights${ fresh ? '?fresh=1' : '' }` );
	if ( ! res.ok ) {
		throw new Error( `[user-edit] insights failed: ${ res.status }` );
	}
	return ( await res.json() ) as UserInsightsPayload;
}

/** `POST desktop-mode/v1/users/<id>/destroy-sessions`. */
export async function destroySessions( host: ProfileHost, id: number, scope: 'others' | 'all' ): Promise< void > {
	const res = await host.fetch( `desktop-mode/v1/users/${ id }/destroy-sessions`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( { scope } ),
	} );
	if ( ! res.ok ) {
		throw new Error( `http_${ res.status }` );
	}
}

/** `GET desktop-mode/v1/users/<id>/application-passwords`. */
export async function listAppPasswords( host: ProfileHost, id: number ): Promise< AppPasswordItem[] > {
	const res = await host.fetch( `desktop-mode/v1/users/${ id }/application-passwords` );
	if ( ! res.ok ) {
		return [];
	}
	const data = ( await res.json() ) as { items?: AppPasswordItem[] };
	return data.items ?? [];
}

/** `POST desktop-mode/v1/users/<id>/application-passwords` — the unhashed password, once. */
export async function createAppPassword( host: ProfileHost, id: number, name: string ): Promise< string > {
	const res = await host.fetch( `desktop-mode/v1/users/${ id }/application-passwords`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( { name } ),
	} );
	if ( ! res.ok ) {
		throw new Error( `http_${ res.status }` );
	}
	const data = ( await res.json() ) as { password: string };
	return data.password;
}

/** `DELETE desktop-mode/v1/users/<id>/application-passwords/<uuid>`. */
export async function revokeAppPassword( host: ProfileHost, id: number, uuid: string ): Promise< void > {
	const res = await host.fetch( `desktop-mode/v1/users/${ id }/application-passwords/${ uuid }`, { method: 'DELETE' } );
	if ( ! res.ok ) {
		throw new Error( `http_${ res.status }` );
	}
}

// ─── Shared helpers ──────────────────────────────────────────────────

/**
 * A server datetime as a millisecond epoch, or `NaN` when it is empty,
 * malformed or WordPress's `0000-00-00` zero date — the caller renders
 * "—" rather than fabricating "just now". Handles the SQL shape (space
 * separator, no zone) by normalising to ISO UTC.
 */
export function serverDateMs( value: string | number | null | undefined ): number {
	if ( typeof value === 'number' ) {
		return value > 0 ? value * 1000 : NaN;
	}
	const iso = String( value ?? '' );
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

/**
 * "3 days ago" that keeps ticking: an `<os-relative-time>` on a unix
 * timestamp (seconds) or a server datetime, with the exact date as its
 * tooltip; a dash when the value is not a time.
 */
export function relativeTimeNode( value: string | number | null | undefined ): HTMLElement {
	const ms = serverDateMs( value );
	if ( ! Number.isFinite( ms ) ) {
		const dash = document.createElement( 'span' );
		dash.textContent = '—';
		return dash;
	}
	const el = document.createElement( 'os-relative-time' );
	el.setAttribute( 'datetime', new Date( ms ).toISOString() );
	el.title = formatDate( ms, 'datetime' );
	return el;
}

/** Put text on the clipboard, best effort — the framework's honest copy, fire-and-forget. */
export function copyQuietly( text: string ): void {
	void copyText( text ).catch( () => false );
}
