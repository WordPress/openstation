/**
 * `<os-user-profile>`'s form — the role-save flow and the profile
 * facts it reads off the app configs.
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
import { mountProfileFormAt } from './profile-form';

const tick = (): Promise< void > => Promise.resolve();
const wait = ( ms = 0 ): Promise< void > => new Promise( ( r ) => setTimeout( r, ms ) );

type Blob = Record< string, unknown >;
const REST = { restRoot: 'http://localhost/wp-json/', restNonce: 'nonce-abc' };
const FULL_EXTRA = {
	currentUserId: 1,
	editPostUrlBase: 'http://localhost/wp-admin/post.php',
	canPromote: true,
	assignableRoles: { administrator: 'Administrator', editor: 'Editor', author: 'Author' },
	allRoles: { administrator: 'Administrator', editor: 'Editor', author: 'Author' },
	locales: {},
	contactMethods: {},
	colorSchemes: {},
};

function setConfig( blobs: Record< string, Blob > ): void {
	( window as unknown as { openStationWindowConfig?: Record< string, Blob > } ).openStationWindowConfig = blobs;
}

const json = ( body: unknown ): Response =>
	new Response( JSON.stringify( body ), { status: 200, headers: { 'content-type': 'application/json' } } );

const insights = ( roles: string[] ) => ( {
	userId: 2,
	displayName: 'Peter Guila',
	avatarUrl: 'http://example/avatar.png',
	profileUrl: '',
	roles,
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

function stubFetch( handler: ( url: string, init?: RequestInit ) => Response ): ReturnType< typeof vi.fn > {
	const spy = vi.fn( async ( input: RequestInfo | URL, init?: RequestInit ) => handler( String( input ), init ) );
	( globalThis as unknown as { fetch: unknown } ).fetch = spy;
	return spy;
}

describe( 'the profile form — role save flow', () => {
	let host: HTMLElement;
	let profile: HTMLElement;

	beforeEach( () => {
		// The DOM shape `<os-user-profile>` creates: a form host AND a
		// sidebar aside host (the save re-fetches the aside).
		profile = document.createElement( 'div' );
		profile.className = 'os-user-profile';
		const layout = document.createElement( 'div' );
		layout.className = 'os-users__edit-layout';
		const aside = document.createElement( 'aside' );
		aside.setAttribute( 'data-os-user-profile-aside', '' );
		host = document.createElement( 'div' );
		host.setAttribute( 'data-os-user-profile-form', '' );
		layout.append( aside, host );
		profile.appendChild( layout );
		document.body.appendChild( profile );
		setConfig( { 'desktop-mode-user-edit': { ...REST, extra: FULL_EXTRA } } );
	} );

	afterEach( () => {
		profile.remove();
		vi.restoreAllMocks();
		delete ( window as unknown as { wp?: unknown } ).wp;
	} );

	test( 'a successful role save repaints the header chip with the new role', async () => {
		const fetchSpy = stubFetch( ( url, init ) => {
			if ( init?.method === 'POST' ) {
				return json( peter( { roles: [ 'author' ] } ) );
			}
			if ( url.includes( '/wp/v2/users/2' ) ) {
				return json( peter() );
			}
			if ( url.includes( '/insights' ) ) {
				return json( insights( [ 'author' ] ) );
			}
			return json( {} );
		} );

		await mountProfileFormAt( host, 2 );
		await tick();
		await wait( 0 );

		expect( host.querySelector( '[slot="header"]' )!.textContent ).toContain( 'editor' );

		// Pick "author" through the component's own listbox — the path
		// a user takes.
		const roleSelect = host.querySelector( 'os-select[name="roles[0]"]' ) as ( HTMLElement & { shadowRoot: ShadowRoot } ) | null;
		expect( roleSelect ).not.toBeNull();
		( roleSelect!.shadowRoot.querySelector( '.os-select__trigger' ) as HTMLButtonElement ).click();
		await tick();
		const authorRow = roleSelect!.shadowRoot.querySelector< HTMLElement >( '[role="option"][data-value="author"]' );
		expect( authorRow ).not.toBeNull();
		authorRow!.click();
		await tick();
		await tick();

		( host.querySelector( 'os-form' ) as HTMLElement & { submit: () => void } ).submit();
		await wait( 30 );

		const headerAfter = host.querySelector( '[slot="header"]' )!;
		expect( headerAfter.textContent ).toContain( 'author' );
		expect( headerAfter.textContent ).not.toContain( 'editor' );

		const postCall = fetchSpy.mock.calls.find( ( [ , init ] ) => ( init as RequestInit | undefined )?.method === 'POST' );
		expect( postCall ).toBeDefined();
		const body = JSON.parse( ( postCall![ 1 ] as RequestInit ).body as string );
		expect( body.roles ).toEqual( [ 'author' ] );
	} );

	test( 'the role select renders when editing someone else, even without canPromote in the config', async () => {
		// Capability gating belongs on the server — the UI surfaces the
		// control whenever the viewer is editing someone else.
		setConfig( {
			'desktop-mode-user-edit': {
				...REST,
				extra: { currentUserId: 1, allRoles: { administrator: 'Administrator', editor: 'Editor' }, locales: {}, contactMethods: {}, colorSchemes: {} },
			},
		} );
		stubFetch( () => json( peter() ) );
		await mountProfileFormAt( host, 2 );
		await tick();
		await wait( 0 );
		expect( host.querySelector( 'os-select[name="roles[0]"]' ) ).not.toBeNull();
	} );

	test( 'the facts merge the Users app config underneath the User Edit app config', async () => {
		// The component mounts in the Users app's Profile tab too: keys
		// the User Edit blob lacks are read from the Users blob.
		setConfig( {
			'desktop-mode-users': {
				...REST,
				extra: {
					currentUserId: 1,
					assignableRoles: { administrator: 'Administrator', editor: 'Editor', author: 'Author' },
					allRoles: { administrator: 'Administrator', editor: 'Editor', author: 'Author' },
					colorSchemes: { fresh: { name: 'Fresh', colors: [ '#1d2327' ] }, modern: { name: 'Modern', colors: [ '#1e1e1e' ] } },
				},
			},
			'desktop-mode-user-edit': { ...REST, extra: { currentUserId: 1, locales: {}, contactMethods: {} } },
		} );
		stubFetch( () => json( peter( { meta: { admin_color: 'fresh' } } ) ) );
		await mountProfileFormAt( host, 2 );
		await tick();
		await wait( 0 );
		const roleSelect = host.querySelector( 'os-select[name="roles[0]"]' );
		expect( roleSelect ).not.toBeNull();
		expect( roleSelect!.querySelectorAll( ':scope > os-option' ).length ).toBe( 3 );
		expect( host.querySelectorAll( '[role="radio"][data-scheme]' ).length ).toBe( 2 );
	} );

	test( 'the admin colour scheme picker and the personal options render when editing someone else (core profile.php)', async () => {
		setConfig( {
			'desktop-mode-user-edit': {
				...REST,
				extra: {
					...FULL_EXTRA,
					assignableRoles: { editor: 'Editor' },
					allRoles: { editor: 'Editor' },
					colorSchemes: {
						fresh: { name: 'Fresh', colors: [ '#1d2327' ] },
						modern: { name: 'Modern', colors: [ '#1e1e1e' ] },
						midnight: { name: 'Midnight', colors: [ '#25282b' ] },
					},
				},
			},
		} );
		stubFetch( () => json( peter( { meta: { admin_color: 'fresh' } } ) ) );
		await mountProfileFormAt( host, 2 );
		await tick();
		await wait( 0 );
		expect( host.querySelector( '[name="meta.admin_color"]' ) ).not.toBeNull();
		expect( host.querySelectorAll( '[role="radio"][data-scheme]' ).length ).toBe( 3 );
		expect( host.querySelector( '[name="meta.rich_editing"]' ) ).not.toBeNull();
		expect( host.querySelector( '[name="meta.syntax_highlighting"]' ) ).not.toBeNull();
		expect( host.querySelector( '[name="meta.show_admin_bar_front"]' ) ).not.toBeNull();
	} );

	test( 'meta checkbox values are saved as strings, not booleans (WP REST schema)', async () => {
		// `<os-form>` harvests a checkbox as a boolean; core's user-meta
		// schema for the personal-options keys is `string`. A boolean
		// failed the whole patch — and the role change in it.
		const fetchSpy = stubFetch( ( url, init ) => {
			if ( init?.method === 'POST' && url.includes( '/wp/v2/users/2' ) ) {
				return json( { id: 2, username: 'peter', roles: [ 'author' ], meta: { rich_editing: 'true' } } );
			}
			if ( url.includes( '/insights' ) ) {
				return json( insights( [ 'author' ] ) );
			}
			return json(
				peter( {
					meta: { rich_editing: 'true', syntax_highlighting: 'true', comment_shortcuts: 'false', show_admin_bar_front: 'true' },
				} ),
			);
		} );
		await mountProfileFormAt( host, 2 );
		await tick();
		await wait( 0 );
		( host.querySelector( 'os-form' ) as HTMLElement & { submit: () => void } ).submit();
		await wait( 30 );

		const postCall = fetchSpy.mock.calls.find( ( [ , init ] ) => ( init as RequestInit | undefined )?.method === 'POST' );
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

	test( 'a successful save routes the confirmation through wp.os.showToast — no inline banner', async () => {
		stubFetch( ( url, init ) => {
			if ( init?.method === 'POST' ) {
				return json( peter( { roles: [ 'author' ] } ) );
			}
			if ( url.includes( '/insights' ) ) {
				return json( insights( [ 'author' ] ) );
			}
			return json( peter() );
		} );
		const showToastSpy = vi.fn( () => () => undefined );
		( window as unknown as { wp?: unknown } ).wp = { os: { showToast: showToastSpy } };

		await mountProfileFormAt( host, 2 );
		await tick();
		await wait( 0 );
		expect( host.querySelector( '.os-user-edit__save-banner' ) ).toBeNull();
		expect( showToastSpy ).not.toHaveBeenCalled();

		( host.querySelector( 'os-form' ) as HTMLElement & { submit: () => void } ).submit();
		await wait( 30 );

		expect( showToastSpy ).toHaveBeenCalled();
		const calls = showToastSpy.mock.calls as unknown as Array< [ { message: string } ] >;
		const opts = calls[ calls.length - 1 ][ 0 ];
		expect( opts.message.toLowerCase() ).toContain( 'saved' );
		expect( host.querySelector( '.os-user-edit__save-banner' ) ).toBeNull();
	} );

	test( 'the role select stays hidden when the viewer is editing themselves', async () => {
		stubFetch( () => json( peter( { id: 1, username: 'admin', name: 'Admin', roles: [ 'administrator' ] } ) ) );
		await mountProfileFormAt( host, 1 );
		await tick();
		await wait( 0 );
		expect( host.querySelector( 'os-select[name="roles[0]"]' ) ).toBeNull();
	} );
} );
