/**
 * `<os-user-profile>`'s form — the role-save flow over the host the
 * element hands it.
 *
 * The bug the first test guards against: an admin opens the editor
 * for another user, picks a new role, saves. The server updates the
 * role, but the header chip (rendered from the pre-save snapshot)
 * silently stays on the OLD role — which reads as "the update didn't
 * take". The form re-paints the header from the saved record.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import '../../../src/ui/components/os-form/os-form';
import '../../../src/ui/components/os-select/os-select';
import '../../../src/ui/components/os-text-field/os-text-field';
import '../../../src/ui/components/os-textarea/os-textarea';
import '../../../src/ui/components/os-checkbox-label/os-checkbox-label';
import '../../../src/ui/components/os-button/os-button';
import { mountProfileFormAt } from './form';
import type { ProfileConfig, ProfileHost } from './types';

const tick = (): Promise< void > => Promise.resolve();
const wait = ( ms = 0 ): Promise< void > => new Promise( ( r ) => setTimeout( r, ms ) );

const FULL_CONFIG: ProfileConfig = {
	currentUserId: 1,
	canPromote: true,
	assignableRoles: { administrator: 'Administrator', editor: 'Editor', author: 'Author' },
	allRoles: { administrator: 'Administrator', editor: 'Editor', author: 'Author' },
	locales: {},
	contactMethods: {},
	colorSchemes: {},
};

const json = ( body: unknown ): Response =>
	new Response( JSON.stringify( body ), { status: 200, headers: { 'content-type': 'application/json' } } );

const peter = ( over: Record< string, unknown > = {} ) => ( {
	id: 2,
	username: 'peter',
	name: 'Peter Guila',
	first_name: 'Peter',
	last_name: 'Guila',
	nickname: 'Peter',
	email: 'p@example.com',
	url: '',
	description: '',
	locale: 'en_US',
	roles: [ 'editor' ],
	avatar_urls: {},
	meta: {},
	...over,
} );

function hostWith( handler: ( path: string, init?: RequestInit ) => Response, config: ProfileConfig = FULL_CONFIG ) {
	const fetch = vi.fn( async ( path: string, init?: RequestInit ) => handler( path, init ) );
	const toast = vi.fn();
	const host: ProfileHost = { config, fetch, toast };
	return { host, fetch, toast };
}

describe( 'the profile form — role save flow', () => {
	let formHost: HTMLElement;

	beforeEach( () => {
		formHost = document.createElement( 'div' );
		formHost.setAttribute( 'data-os-user-profile-form', '' );
		document.body.appendChild( formHost );
	} );

	afterEach( () => {
		document.body.replaceChildren();
		vi.restoreAllMocks();
	} );

	test( 'a successful role save repaints the header chip with the new role and tells the host', async () => {
		const { host, fetch } = hostWith( ( path, init ) => {
			if ( init?.method === 'POST' ) {
				return json( peter( { roles: [ 'author' ] } ) );
			}
			if ( path.includes( '/application-passwords' ) ) {
				return json( { items: [] } );
			}
			return json( peter() );
		} );
		const onSaved = vi.fn();

		await mountProfileFormAt( formHost, 2, host, { onSaved } );
		await tick();
		await wait( 0 );

		expect( formHost.querySelector( '[slot="header"]' )!.textContent ).toContain( 'Editor' );

		// Pick "author" through the component's own listbox — the path
		// a user takes.
		const roleSelect = formHost.querySelector( 'os-select[name="roles[0]"]' ) as ( HTMLElement & { shadowRoot: ShadowRoot } ) | null;
		expect( roleSelect ).not.toBeNull();
		( roleSelect!.shadowRoot.querySelector( '.os-select__trigger' ) as HTMLButtonElement ).click();
		await tick();
		const authorRow = roleSelect!.shadowRoot.querySelector< HTMLElement >( '[role="option"][data-value="author"]' );
		expect( authorRow ).not.toBeNull();
		authorRow!.click();
		await tick();
		await tick();

		( formHost.querySelector( 'os-form' ) as HTMLElement & { submit: () => void } ).submit();
		await wait( 30 );

		const headerAfter = formHost.querySelector( '[slot="header"]' )!;
		expect( headerAfter.textContent ).toContain( 'Author' );
		expect( headerAfter.textContent ).not.toContain( 'Editor' );

		const postCall = fetch.mock.calls.find( ( [ , init ] ) => ( init as RequestInit | undefined )?.method === 'POST' );
		expect( postCall ).toBeDefined();
		const body = JSON.parse( ( postCall![ 1 ] as RequestInit ).body as string );
		expect( body.roles ).toEqual( [ 'author' ] );
		expect( onSaved ).toHaveBeenCalledTimes( 1 );
		expect( host.toast ).toHaveBeenCalledWith( 'Profile saved.', 'success' );
	} );

	test( 'the role select renders when editing someone else, even without canPromote in the config', async () => {
		// Capability gating belongs on the server — the UI surfaces the
		// control whenever the viewer is editing someone else.
		const { host } = hostWith( () => json( peter() ), {
			currentUserId: 1,
			allRoles: { administrator: 'Administrator', editor: 'Editor' },
			locales: {},
			contactMethods: {},
			colorSchemes: {},
		} );
		await mountProfileFormAt( formHost, 2, host );
		await tick();
		await wait( 0 );
		expect( formHost.querySelector( 'os-select[name="roles[0]"]' ) ).not.toBeNull();
	} );

	test( 'the admin colour scheme picker and the personal options render when editing someone else (core profile.php)', async () => {
		const { host } = hostWith( () => json( peter( { meta: { admin_color: 'fresh' } } ) ), {
			...FULL_CONFIG,
			colorSchemes: {
				fresh: { name: 'Fresh', colors: [ '#1d2327' ] },
				modern: { name: 'Modern', colors: [ '#1e1e1e' ] },
				midnight: { name: 'Midnight', colors: [ '#25282b' ] },
			},
		} );
		await mountProfileFormAt( formHost, 2, host );
		await tick();
		await wait( 0 );
		expect( formHost.querySelector( '[name="meta.admin_color"]' ) ).not.toBeNull();
		expect( formHost.querySelectorAll( '[role="radio"][data-scheme]' ).length ).toBe( 3 );
		expect( formHost.querySelector( '[name="meta.rich_editing"]' ) ).not.toBeNull();
		expect( formHost.querySelector( '[name="meta.syntax_highlighting"]' ) ).not.toBeNull();
		expect( formHost.querySelector( '[name="meta.show_admin_bar_front"]' ) ).not.toBeNull();
		// No network-only affordance on a single site.
		expect( formHost.querySelector( '[name="meta.is_super_admin"]' ) ).toBeNull();
	} );

	test( 'Revert puts the picked colour scheme back to the saved one', async () => {
		const { host } = hostWith( () => json( peter( { meta: { admin_color: 'fresh' } } ) ), {
			...FULL_CONFIG,
			colorSchemes: { fresh: { name: 'Fresh', colors: [] }, modern: { name: 'Modern', colors: [] } },
		} );
		await mountProfileFormAt( formHost, 2, host );
		await tick();
		await wait( 0 );
		const tile = ( slug: string ): HTMLElement => formHost.querySelector< HTMLElement >( `[role="radio"][data-scheme="${ slug }"]` )!;
		tile( 'modern' ).click();
		expect( tile( 'modern' ).getAttribute( 'aria-checked' ) ).toBe( 'true' );
		expect( formHost.querySelector( '[name="meta.admin_color"]' )?.getAttribute( 'value' ) ).toBe( 'modern' );

		( formHost.querySelector( 'os-form' ) as HTMLElement & { reset: () => void } ).reset();
		await tick();
		expect( tile( 'fresh' ).getAttribute( 'aria-checked' ) ).toBe( 'true' );
		expect( tile( 'modern' ).getAttribute( 'aria-checked' ) ).toBe( 'false' );
		expect( formHost.querySelector( '[name="meta.admin_color"]' )?.getAttribute( 'value' ) ).toBe( 'fresh' );
	} );

	test( 'meta checkbox values are saved as strings, not booleans (WP REST schema)', async () => {
		// `<os-form>` harvests a checkbox as a boolean; core's user-meta
		// schema for the personal-options keys is `string`. A boolean
		// failed the whole patch — and the role change in it.
		const { host, fetch } = hostWith( ( path, init ) => {
			if ( init?.method === 'POST' && path.includes( 'wp/v2/users/2' ) ) {
				return json( { id: 2, username: 'peter', roles: [ 'author' ], meta: { rich_editing: 'true' } } );
			}
			if ( path.includes( '/application-passwords' ) ) {
				return json( { items: [] } );
			}
			return json(
				peter( { meta: { rich_editing: 'true', syntax_highlighting: 'true', comment_shortcuts: 'false', show_admin_bar_front: 'true' } } ),
			);
		} );
		await mountProfileFormAt( formHost, 2, host );
		await tick();
		await wait( 0 );
		( formHost.querySelector( 'os-form' ) as HTMLElement & { submit: () => void } ).submit();
		await wait( 30 );

		const postCall = fetch.mock.calls.find( ( [ , init ] ) => ( init as RequestInit | undefined )?.method === 'POST' );
		expect( postCall ).toBeDefined();
		const body = JSON.parse( ( postCall![ 1 ] as RequestInit ).body as string );
		expect( body.meta ).toBeDefined();
		for ( const [ key, value ] of Object.entries( body.meta ) ) {
			expect( typeof value, `meta.${ key } must be a string` ).toBe( 'string' );
		}
		for ( const key of [ 'rich_editing', 'syntax_highlighting', 'comment_shortcuts', 'show_admin_bar_front' ] ) {
			expect( body.meta[ key ] ).toMatch( /^(true|false)$/ );
		}
	} );

	test( 'a failed save reports through the host toast and keeps the form open', async () => {
		const { host, toast } = hostWith( ( path, init ) => {
			if ( init?.method === 'POST' ) {
				return new Response( JSON.stringify( { code: 'rest_user_invalid_email', message: 'Invalid email address.' } ), { status: 400 } );
			}
			if ( path.includes( '/application-passwords' ) ) {
				return json( { items: [] } );
			}
			return json( peter() );
		} );
		vi.spyOn( console, 'warn' ).mockImplementation( () => undefined );
		await mountProfileFormAt( formHost, 2, host );
		await tick();
		await wait( 0 );
		( formHost.querySelector( 'os-form' ) as HTMLElement & { submit: () => void } ).submit();
		await wait( 30 );
		expect( toast ).toHaveBeenCalledWith( 'Invalid email address.', 'error' );
		expect( formHost.querySelector( 'os-form' ) ).not.toBeNull();
	} );

	test( 'the role select stays hidden when the viewer is editing themselves', async () => {
		const { host } = hostWith( () => json( peter( { id: 1, username: 'admin', name: 'Admin', roles: [ 'administrator' ] } ) ) );
		await mountProfileFormAt( formHost, 1, host );
		await tick();
		await wait( 0 );
		expect( formHost.querySelector( 'os-select[name="roles[0]"]' ) ).toBeNull();
	} );
} );
