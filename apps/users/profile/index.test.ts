/**
 * `<os-user-profile>` — the element's lifecycle: idle without an id,
 * one mount per id with the record and the insights fetched ONCE each,
 * a retarget that re-mounts once, the properties the host feeds, and
 * an aside that refreshes ITSELF after a save (not the first aside in
 * the document), and the plugin sections embedded below the form.
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
import { isFormDirty, refreshUntouched, shouldRenarrow, snapshotForm } from './plugin-sections-form';
import { createSharedStore } from '../../../src/shared-store';
import { readFootprintTarget } from '../../../src/open-targets/footprint-target';

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

function mountProfile(
	userId: number | null,
	host?: { fetch: ( p: string, i?: RequestInit ) => Promise< Response >; config?: ProfileConfig },
): OsUserProfile {
	const el = document.createElement( 'os-user-profile' ) as OsUserProfile;
	if ( userId ) {
		el.setAttribute( 'user-id', String( userId ) );
	}
	document.body.appendChild( el );
	if ( host ) {
		el.config = host.config ?? config;
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
	delete ( window as unknown as { wp?: unknown } ).wp;
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

	test( 'the aside offers the activity footprint only when the facts allow it, and hands the person to WP Explorer', async () => {
		const openWindow = vi.fn( () => true );
		( window as unknown as { wp?: unknown } ).wp = { os: { createSharedStore, openWindow } };

		const gated = fakeFetch();
		const a = mountProfile( 2, { fetch: gated.fetch, config: { ...config, canViewFootprint: false } } );
		const allowed = fakeFetch( { 3: 'Jane Doe' } );
		const b = mountProfile( 3, { fetch: allowed.fetch, config: { ...config, canViewFootprint: true } } );
		await wait( 10 );

		expect( a.querySelector( '[data-os-user-profile-footprint]' ) ).toBeNull();
		const door = b.querySelector< HTMLElement >( '[data-os-user-profile-footprint]' );
		expect( door?.textContent ).toContain( 'View activity footprint' );

		door?.click();
		expect( openWindow ).toHaveBeenCalledWith( 'my-wordpress', expect.objectContaining( { source: expect.any( String ) } ) );
		expect( readFootprintTarget() ).toMatchObject( { userId: 3, userName: 'Jane Doe' } );
	} );

	test( 'embeds the plugin sections of the screen the person is edited on, and reloads them after a save', async () => {
		const urls: string[] = [];
		const embedAdminPage = vi.fn( ( host: HTMLElement, url: string ) => {
			urls.push( url );
			host.replaceChildren( document.createElement( 'iframe' ) );
			return () => host.replaceChildren();
		} );
		( window as unknown as { wp?: unknown } ).wp = { os: { embedAdminPage } };
		const pluginSections = { own: true, others: false, adminUrl: 'http://example.test/wp-admin/' };
		const ownUrl = 'http://example.test/wp-admin/profile.php?openstation_profile_sections=1&openstation_chromeless=1';

		const own = mountProfile( 1, { fetch: fakeFetch().fetch, config: { ...config, pluginSections } } );
		const other = mountProfile( 3, { fetch: fakeFetch().fetch, config: { ...config, pluginSections } } );
		await wait( 10 );
		expect( urls ).toEqual( [ ownUrl ] );
		expect( other.querySelector< HTMLElement >( '[data-os-user-profile-plugins]' )?.hidden ).toBe( true );

		// The embedded page posts the core fields it loaded with: with no
		// edits in it, a save from the form reloads it.
		( own.querySelector( 'os-form' ) as HTMLElement & { submit: () => void } ).submit();
		await wait( 30 );
		expect( own.querySelector( '[data-os-user-profile-plugins] iframe' )?.getAttribute( 'src' ) ).toBe( ownUrl );

		const editor = mountProfile( 3, { fetch: fakeFetch().fetch, config: { ...config, pluginSections: { ...pluginSections, others: true } } } );
		await wait( 10 );
		expect( urls[ 1 ] ).toBe( 'http://example.test/wp-admin/user-edit.php?user_id=3&openstation_profile_sections=1&openstation_chromeless=1' );
		expect( editor.querySelector< HTMLElement >( '[data-os-user-profile-plugins]' )?.hidden ).toBe( false );
	} );

	test( 'opens the embedded page’s off-site links in a new tab and leaves admin links to the embed', async () => {
		( window as unknown as { wp?: unknown } ).wp = {
			os: {
				embedAdminPage: ( host: HTMLElement ) => {
					host.replaceChildren( document.createElement( 'iframe' ) );
					return () => host.replaceChildren();
				},
			},
		};
		const open = vi.spyOn( window, 'open' ).mockImplementation( () => null );
		const el = mountProfile( 1, { fetch: fakeFetch().fetch, config: { ...config, pluginSections: { own: true, adminUrl: 'http://example.test/wp-admin/' } } } );
		await wait( 10 );
		const frame = el.querySelector( '[data-os-user-profile-plugins] iframe' ) as HTMLIFrameElement;
		const post = ( data: unknown ): void => {
			window.dispatchEvent( new MessageEvent( 'message', { data, origin: window.location.origin, source: frame.contentWindow } ) );
		};

		post( { type: 'os-iframe-admin-link', url: `${ window.location.origin }/wp-admin/options-general.php`, label: 'Settings' } );
		expect( open ).not.toHaveBeenCalled();
		post( { type: 'os-external-link', url: 'https://example.org/docs' } );
		expect( open ).toHaveBeenCalledWith( 'https://example.org/docs', '_blank', 'noopener' );
	} );
} );

describe( 'the embedded profile form', () => {
	const formIn = ( html: string ): HTMLFormElement => {
		const doc = document.implementation.createHTMLDocument( '' );
		doc.body.innerHTML = `<form id="your-profile">${ html }</form>`;
		return doc.getElementById( 'your-profile' ) as HTMLFormElement;
	};

	test( 'is narrowed again once, and only when the page is the profile form', () => {
		const whole = formIn( '<input name="email" />' ).ownerDocument;
		const narrowed = formIn( '<span id="os-profile-sections-start"></span>' ).ownerDocument;
		const invalid = document.implementation.createHTMLDocument( '' );
		invalid.body.textContent = 'Invalid user ID.';

		expect( shouldRenarrow( whole, true, false ) ).toBe( true );
		expect( shouldRenarrow( whole, true, true ) ).toBe( false );
		expect( shouldRenarrow( narrowed, true, false ) ).toBe( false );
		expect( shouldRenarrow( invalid, true, false ) ).toBe( false );
		expect( shouldRenarrow( whole, false, false ) ).toBe( false );
	} );

	test( 'keeps the user’s edits and takes fresh values for every field left alone', () => {
		const live = formIn( '<input name="email" value="old@example.test" /><input type="checkbox" name="opt" /><input name="plugin_field" value="a" />' );
		const snapshot = snapshotForm( live );
		expect( isFormDirty( live, snapshot ) ).toBe( false );

		( live.elements.namedItem( 'plugin_field' ) as HTMLInputElement ).value = 'edited';
		expect( isFormDirty( live, snapshot ) ).toBe( true );

		const fresh = formIn( '<input name="email" value="new@example.test" /><input type="checkbox" name="opt" checked /><input name="plugin_field" value="a" />' );
		refreshUntouched( live, snapshot, fresh );
		expect( ( live.elements.namedItem( 'email' ) as HTMLInputElement ).value ).toBe( 'new@example.test' );
		expect( ( live.elements.namedItem( 'opt' ) as HTMLInputElement ).checked ).toBe( true );
		expect( ( live.elements.namedItem( 'plugin_field' ) as HTMLInputElement ).value ).toBe( 'edited' );
	} );
} );
