/**
 * `<os-user-profile>` — the element's lifecycle: idle without an id,
 * one mount per id with the record and the insights fetched ONCE each,
 * a retarget that re-mounts once, the properties the host feeds, and
 * an aside that refreshes ITSELF after a save (not the first aside in
 * the document).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import '../../../src/ui/components/os-form/os-form';
import '../../../src/ui/components/os-select/os-select';
import '../../../src/ui/components/os-text-field/os-text-field';
import '../../../src/ui/components/os-textarea/os-textarea';
import '../../../src/ui/components/os-checkbox-label/os-checkbox-label';
import '../../../src/ui/components/os-button/os-button';
// A side-effect import: the module's evaluation is what defines the
// tag, and a type-only use of the class would let the import be elided.
import './index';
import type { OsUserProfile } from './index';
import type { ProfileConfig } from './types';

const wait = ( ms = 0 ): Promise< void > => new Promise( ( r ) => setTimeout( r, ms ) );

const json = ( body: unknown ): Response =>
	new Response( JSON.stringify( body ), { status: 200, headers: { 'content-type': 'application/json' } } );

const record = ( id: number, over: Record< string, unknown > = {} ) => ( {
	id,
	username: `user${ id }`,
	name: `User ${ id }`,
	first_name: '',
	last_name: '',
	nickname: `user${ id }`,
	email: `u${ id }@example.com`,
	url: '',
	description: '',
	locale: 'en_US',
	roles: [ 'editor' ],
	avatar_urls: {},
	meta: {},
	...over,
} );

const insights = ( id: number, name = `User ${ id }` ) => ( {
	userId: id,
	displayName: name,
	avatarUrl: 'http://example/avatar.png',
	profileUrl: '',
	roles: [ 'editor' ],
	capabilitiesCount: 1,
	profileCompleteness: { filled: 1, total: 5, percent: 20 },
	stats: {
		posts: 0,
		pages: 0,
		attachments: 0,
		commentsAuthored: 0,
		commentsReceived: 0,
		daysSinceRegistration: 0,
		lastLoginAt: null,
		daysSinceLastLogin: null,
		registeredAt: null,
	},
	contentByMonth: [],
	recentPosts: [],
	recentComments: [],
	sessions: [],
	applicationPasswords: { total: 0, lastUsedAt: null, lastUsedName: null },
} );

const config: ProfileConfig = {
	currentUserId: 1,
	assignableRoles: { editor: 'Editor', author: 'Author' },
	allRoles: { editor: 'Editor', author: 'Author' },
	locales: {},
	contactMethods: {},
	colorSchemes: {},
};

/** A fetch that answers by path and counts what was asked. */
function fakeFetch( names: Record< number, string > = {} ) {
	const calls: string[] = [];
	const fetch = vi.fn( async ( path: string, init?: RequestInit ) => {
		calls.push( `${ init?.method ?? 'GET' } ${ path }` );
		const id = Number( /users\/(\d+)/.exec( path )?.[ 1 ] ?? 0 );
		if ( path.includes( '/insights' ) ) {
			return json( insights( id, names[ id ] ) );
		}
		if ( path.includes( '/application-passwords' ) ) {
			return json( { items: [] } );
		}
		if ( init?.method === 'POST' ) {
			return json( record( id, { name: names[ id ] ?? `User ${ id }` } ) );
		}
		return json( record( id ) );
	} );
	return { fetch, calls };
}

function mountProfile( userId: number | null, host?: { fetch: ( p: string, i?: RequestInit ) => Promise< Response > } ): OsUserProfile {
	const el = document.createElement( 'os-user-profile' ) as OsUserProfile;
	if ( userId ) {
		el.setAttribute( 'user-id', String( userId ) );
	}
	document.body.appendChild( el );
	if ( host ) {
		el.config = config;
		el.fetch = host.fetch;
		el.toast = () => undefined;
	}
	return el;
}

beforeEach( () => {
	( globalThis as unknown as { fetch: unknown } ).fetch = vi.fn( async () => json( {} ) );
} );

afterEach( () => {
	document.body.replaceChildren();
	vi.restoreAllMocks();
} );

describe( '<os-user-profile>', () => {
	test( 'renders its layout shell and idles without a user-id', async () => {
		const { fetch } = fakeFetch();
		const el = mountProfile( null, { fetch } );
		await wait( 0 );
		expect( el.querySelector( '[data-os-user-profile-layout]' ) ).not.toBeNull();
		expect( el.querySelector( '[data-os-user-profile-aside]' ) ).not.toBeNull();
		expect( fetch ).not.toHaveBeenCalled();
	} );

	test( 'mounts once per id, fetching the record and the insights ONCE each through the host’s fetch', async () => {
		const { fetch, calls } = fakeFetch();
		const el = mountProfile( 2, { fetch } );
		// The properties land in the same task as the attribute; the
		// mount waits a microtask for them, so the first fetch is the
		// host's, not the shell fallback.
		await wait( 10 );
		expect( calls.filter( ( c ) => c.includes( '/insights' ) ) ).toEqual( [ 'GET desktop-mode/v1/users/2/insights' ] );
		expect( calls.filter( ( c ) => c.startsWith( 'GET wp/v2/users/2' ) ).length ).toBe( 1 );
		expect( el.querySelector( 'os-form' ) ).not.toBeNull();
		expect( el.querySelector( '[data-os-user-profile-aside]' )?.textContent ).toContain( 'User 2' );
		expect( el.querySelector( '[data-os-user-profile-activity]' )?.textContent ).toContain( 'Recent activity' );

		// A repaint that sets the same attribute again mounts nothing.
		el.setAttribute( 'user-id', '2' );
		await wait( 10 );
		expect( calls.filter( ( c ) => c.includes( '/insights' ) ).length ).toBe( 1 );
	} );

	test( 'flipping user-id re-mounts once on the new person', async () => {
		const { fetch, calls } = fakeFetch();
		const el = mountProfile( 2, { fetch } );
		await wait( 10 );
		el.setAttribute( 'user-id', '9' );
		await wait( 10 );
		expect( calls.filter( ( c ) => c.includes( '/insights' ) ) ).toEqual( [
			'GET desktop-mode/v1/users/2/insights',
			'GET desktop-mode/v1/users/9/insights',
		] );
		expect( el.querySelector( '[data-os-user-profile-aside]' )?.textContent ).toContain( 'User 9' );
		expect( el.querySelector( 'os-text-field[name="username"]' )?.getAttribute( 'value' ) ).toBe( 'user9' );
	} );

	test( 'a save refreshes the aside of the element that saved — not the first aside in the document', async () => {
		const first = fakeFetch();
		const second = fakeFetch();
		const a = mountProfile( 2, { fetch: first.fetch } );
		const b = mountProfile( 3, { fetch: second.fetch } );
		await wait( 10 );
		expect( a.querySelector( '[data-os-user-profile-aside]' )?.textContent ).toContain( 'User 2' );

		// Save from the SECOND element: only its insights are re-fetched.
		( b.querySelector( 'os-form' ) as HTMLElement & { submit: () => void } ).submit();
		await wait( 30 );
		expect( second.calls.filter( ( c ) => c.includes( '/insights' ) ) ).toEqual( [
			'GET desktop-mode/v1/users/3/insights',
			'GET desktop-mode/v1/users/3/insights?fresh=1',
		] );
		expect( first.calls.filter( ( c ) => c.includes( '/insights' ) ).length ).toBe( 1 );
	} );
} );
