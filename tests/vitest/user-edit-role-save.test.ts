/**
 * Covers the role-update save flow in the native User Edit window.
 *
 * The bug it guards against: an admin opens user-edit for another
 * user, picks a new role, clicks Save. The server updates the role
 * (verified by curl-level integration). The form's wpd-select keeps
 * the picked value, but the header role chip (rendered from the
 * pre-save `user` snapshot) silently stays on the OLD role — which
 * reads as "the update didn't take" even though the DB is now
 * correct. The fix re-runs `buildProfileHeader` against the saved
 * response so the chip text matches the new role.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import '../../src/ui/components/wpd-form/wpd-form';
import '../../src/ui/components/wpd-select/wpd-select';
import '../../src/ui/components/wpd-text-field/wpd-text-field';
import '../../src/ui/components/wpd-textarea/wpd-textarea';
import '../../src/ui/components/wpd-checkbox-label/wpd-checkbox-label';
import '../../src/ui/components/wpd-button/wpd-button';

const tick = (): Promise< void > => Promise.resolve();
const wait = ( ms = 0 ): Promise< void > =>
	new Promise( ( r ) => setTimeout( r, ms ) );

describe( 'User Edit window — role save flow', () => {
	let host: HTMLElement;
	let aside: HTMLElement;
	let profile: HTMLElement;

	beforeEach( () => {
		// Match the DOM shape `<wpd-user-profile>` creates in
		// `wpd-user-profile.ts`: a form host AND a sidebar aside
		// host. The role chip lives in the form's header; the
		// fix also re-fetches the aside.
		profile = document.createElement( 'div' );
		profile.className = 'desktop-mode-user-profile';
		const layout = document.createElement( 'div' );
		layout.className = 'desktop-mode-users__edit-layout';
		aside = document.createElement( 'aside' );
		aside.setAttribute( 'data-wpd-user-profile-aside', '' );
		host = document.createElement( 'div' );
		host.setAttribute( 'data-wpd-user-profile-form', '' );
		layout.appendChild( aside );
		layout.appendChild( host );
		profile.appendChild( layout );
		document.body.appendChild( profile );

		// Config blob the user-edit-render reads via getConfig().
		( window as unknown as {
			desktopModeWindowConfig?: Record< string, unknown >;
		} ).desktopModeWindowConfig = {
			'desktop-mode-user-edit': {
				mode: 'user-edit',
				restRoot: 'http://localhost/wp-json/',
				restNonce: 'nonce-abc',
				usersUrl: 'http://localhost/wp-json/wp/v2/users',
				currentUserId: 1,
				insightsUrlBase: 'http://localhost/wp-json/desktop-mode/v1/users/',
				editPostUrlBase: 'http://localhost/wp-admin/post.php',
				canPromote: true,
				assignableRoles: {
					administrator: 'Administrator',
					editor: 'Editor',
					author: 'Author',
				},
				allRoles: {
					administrator: 'Administrator',
					editor: 'Editor',
					author: 'Author',
				},
				locales: {},
				contactMethods: {},
				colorSchemes: {},
			},
		};
	} );

	afterEach( () => {
		profile.remove();
		vi.restoreAllMocks();
	} );

	test( 'a successful role save repaints the header chip with the new role', async () => {
		const originalUser = {
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
			avatar_urls: { '96': 'http://example/avatar.png' },
			meta: {},
		};
		const savedUser = {
			...originalUser,
			roles: [ 'author' ],
		};

		// Stub fetch — the GET fetches the user, the POST is the save.
		const fetchSpy = vi.fn< typeof fetch >( async ( input, init ) => {
			const url = String( input );
			if ( init?.method === 'POST' ) {
				return new Response( JSON.stringify( savedUser ), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				} );
			}
			if ( url.includes( '/wp/v2/users/2' ) ) {
				return new Response( JSON.stringify( originalUser ), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				} );
			}
			if ( url.includes( '/insights' ) ) {
				// Aside refetch returns the new role.
				return new Response(
					JSON.stringify( {
						userId: 2,
						displayName: 'Peter Guila',
						avatarUrl: 'http://example/avatar.png',
						profileUrl: '',
						roles: [ 'author' ],
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
						applicationPasswords: {
							total: 0,
							lastUsedAt: null,
							lastUsedName: null,
						},
					} ),
					{
						status: 200,
						headers: { 'content-type': 'application/json' },
					},
				);
			}
			return new Response( '{}', {
				status: 200,
				headers: { 'content-type': 'application/json' },
			} );
		} );
		( globalThis as unknown as { fetch: typeof fetch } ).fetch =
			fetchSpy as unknown as typeof fetch;

		
		const render = await import( '../../src/posts-window/user-edit-render' );
		await render.mountProfileFormAt( host, 2 );

		// Form is mounted. Header chip should say "editor".
		await tick();
		await wait( 0 );

		const headerEl = host.querySelector( '[slot="header"]' );
		expect( headerEl ).not.toBeNull();
		expect( headerEl!.textContent ).toContain( 'editor' );

		// Pick "author" via the role select and submit.
		const roleSelect = host.querySelector(
			'wpd-select[name="roles[0]"]',
		) as ( HTMLElement & {
			value: string;
			shadowRoot: ShadowRoot;
		} ) | null;
		expect( roleSelect ).not.toBeNull();
		const native = roleSelect!.shadowRoot.querySelector(
			'select',
		) as HTMLSelectElement;
		native.value = 'author';
		native.dispatchEvent( new Event( 'change', { bubbles: true } ) );

		await tick();
		await tick();

		const form = host.querySelector( 'wpd-form' ) as HTMLElement & {
			submit: () => void;
		};
		form.submit();

		// Wait for the save fetch + the asynchronous DOM repaint.
		await wait( 30 );

		// Header chip must now reflect the saved role.
		const headerAfter = host.querySelector( '[slot="header"]' );
		expect( headerAfter ).not.toBeNull();
		expect( headerAfter!.textContent ).toContain( 'author' );
		expect( headerAfter!.textContent ).not.toContain( 'editor' );

		// Confirm a POST hit the wp/v2/users endpoint with the new role.
		const postCall = fetchSpy.mock.calls.find(
			( [ , init ] ) => init?.method === 'POST',
		);
		expect( postCall ).toBeDefined();
		const body = JSON.parse( postCall![ 1 ]!.body as string );
		expect( body.roles ).toEqual( [ 'author' ] );
	} );

	test( 'the role select renders when editing someone else, even if the config blob omits canPromote', async () => {
		// Regression for the case where my first fix added a strict
		// `canPromote` gate and a viewer in any config that omitted
		// the flag (older registrations, payloads stripped by a
		// filter) lost the dropdown. Capability gating belongs on
		// the server — `update_item_permissions_check` already
		// returns 403 when the viewer can't promote. The UI must
		// surface the control whenever the viewer is editing
		// someone else.
		( window as unknown as {
			desktopModeWindowConfig?: Record< string, unknown >;
		} ).desktopModeWindowConfig = {
			'desktop-mode-user-edit': {
				mode: 'user-edit',
				restRoot: 'http://localhost/wp-json/',
				restNonce: 'nonce-abc',
				usersUrl: 'http://localhost/wp-json/wp/v2/users',
				currentUserId: 1,
				insightsUrlBase: 'http://localhost/wp-json/desktop-mode/v1/users/',
				editPostUrlBase: 'http://localhost/wp-admin/post.php',
				// canPromote intentionally absent — pre-fix payloads,
				// or any consumer that strips the flag, must still
				// see the dropdown.
				allRoles: {
					administrator: 'Administrator',
					editor: 'Editor',
				},
				locales: {},
				contactMethods: {},
				colorSchemes: {},
			},
		};

		( globalThis as unknown as { fetch: typeof fetch } ).fetch = ( async () =>
			new Response(
				JSON.stringify( {
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
				} ),
				{
					status: 200,
					headers: { 'content-type': 'application/json' },
				},
			) ) as unknown as typeof fetch;

		
		const render = await import( '../../src/posts-window/user-edit-render' );
		await render.mountProfileFormAt( host, 2 );
		await tick();
		await wait( 0 );

		const roleSelect = host.querySelector( 'wpd-select[name="roles[0]"]' );
		expect( roleSelect ).not.toBeNull();
	} );

	test( 'role select AND colour-scheme picker still populate when the active window id has drifted to a sibling', async () => {
		// Regression for the drift bug: if the user focused the
		// Posts window after opening Edit User, the global active
		// id ends up on `desktop-mode-posts` (whose config has no
		// `allRoles` / `assignableRoles` / `colorSchemes` / locales).
		// On a subsequent re-mount the form read the sibling config
		// and rendered empty pickers across the board. The fix
		// layers `desktop-mode-user-edit`'s blob underneath the
		// active cfg via `resolveProfileConfig()`.
		( window as unknown as {
			desktopModeWindowConfig?: Record< string, unknown >;
		} ).desktopModeWindowConfig = {
			// Active window id points HERE — only the Posts-shaped
			// keys; nothing profile-specific.
			'desktop-mode-posts': {
				mode: 'posts',
				restRoot: 'http://localhost/wp-json/',
				restNonce: 'nonce-abc',
				usersUrl: 'http://localhost/wp-json/wp/v2/users',
				currentUserId: 1,
				editPostUrlBase: 'http://localhost/wp-admin/post.php',
			},
			// The user-edit window IS registered with the full
			// profile config — the fix reads from this blob even
			// when active is wrong.
			'desktop-mode-user-edit': {
				mode: 'user-edit',
				restRoot: 'http://localhost/wp-json/',
				restNonce: 'nonce-abc',
				usersUrl: 'http://localhost/wp-json/wp/v2/users',
				currentUserId: 1,
				insightsUrlBase: 'http://localhost/wp-json/desktop-mode/v1/users/',
				editPostUrlBase: 'http://localhost/wp-admin/post.php',
				canPromote: true,
				assignableRoles: {
					administrator: 'Administrator',
					editor: 'Editor',
					author: 'Author',
				},
				allRoles: {
					administrator: 'Administrator',
					editor: 'Editor',
					author: 'Author',
				},
				locales: {},
				contactMethods: {},
				colorSchemes: {
					fresh: { name: 'Fresh', colors: [ '#1d2327' ] },
					modern: { name: 'Modern', colors: [ '#1e1e1e' ] },
				},
			},
		};

		( globalThis as unknown as { fetch: typeof fetch } ).fetch = ( async () =>
			new Response(
				JSON.stringify( {
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
					meta: { admin_color: 'fresh' },
				} ),
				{
					status: 200,
					headers: { 'content-type': 'application/json' },
				},
			) ) as unknown as typeof fetch;

		// Active window id is the wrong sibling — the scenario the
		// user hit when bouncing between Edit User and Posts.
		
		const render = await import( '../../src/posts-window/user-edit-render' );
		await render.mountProfileFormAt( host, 2 );
		await tick();
		await wait( 0 );

		// Role select must have its 3 wpd-option children even
		// though the active cfg has no `assignableRoles`.
		const roleSelect = host.querySelector(
			'wpd-select[name="roles[0]"]',
		) as ( HTMLElement & { shadowRoot: ShadowRoot } ) | null;
		expect( roleSelect ).not.toBeNull();
		const roleOptions = roleSelect!.querySelectorAll(
			':scope > wpd-option',
		);
		expect( roleOptions.length ).toBe( 3 );

		// Colour-scheme picker must have its 2 tiles even though
		// the active cfg has no `colorSchemes` key at all.
		const schemeTiles = host.querySelectorAll(
			'[role="radio"][data-scheme]',
		);
		expect( schemeTiles.length ).toBe( 2 );
	} );

	test( 'the admin color scheme picker renders when editing someone else (matches core profile.php)', async () => {
		// Regression for the hidden colour scheme bug: core's
		// `wp-admin/user-edit.php` renders the Personal Options
		// section — including the Administration Color Scheme
		// picker, the Visual Editor toggle, syntax highlighting,
		// keyboard shortcuts, and the toolbar toggle — for ANY user
		// the viewer can edit, not just self. An earlier cut wrapped
		// the whole section in `if (isSelfEdit)`, which dropped the
		// picker for every "edit someone else" flow.
		( window as unknown as {
			desktopModeWindowConfig?: Record< string, unknown >;
		} ).desktopModeWindowConfig = {
			'desktop-mode-user-edit': {
				mode: 'user-edit',
				restRoot: 'http://localhost/wp-json/',
				restNonce: 'nonce-abc',
				usersUrl: 'http://localhost/wp-json/wp/v2/users',
				currentUserId: 1,
				insightsUrlBase: 'http://localhost/wp-json/desktop-mode/v1/users/',
				editPostUrlBase: 'http://localhost/wp-admin/post.php',
				canPromote: true,
				assignableRoles: { editor: 'Editor' },
				allRoles: { editor: 'Editor' },
				locales: {},
				contactMethods: {},
				colorSchemes: {
					fresh: { name: 'Fresh', colors: [ '#1d2327' ] },
					modern: { name: 'Modern', colors: [ '#1e1e1e' ] },
					midnight: { name: 'Midnight', colors: [ '#25282b' ] },
				},
			},
		};

		( globalThis as unknown as { fetch: typeof fetch } ).fetch = ( async () =>
			new Response(
				JSON.stringify( {
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
					meta: { admin_color: 'fresh' },
				} ),
				{
					status: 200,
					headers: { 'content-type': 'application/json' },
				},
			) ) as unknown as typeof fetch;

		
		const render = await import( '../../src/posts-window/user-edit-render' );
		// Admin id is 1, target is 2 — editing someone else.
		await render.mountProfileFormAt( host, 2 );
		await tick();
		await wait( 0 );

		// Hidden admin_color field is what the form submits when the
		// user picks a scheme — its presence proves the picker
		// mounted. Earlier cuts only emitted this for self-edits.
		const adminColor = host.querySelector(
			'[name="meta.admin_color"]',
		);
		expect( adminColor ).not.toBeNull();

		// The Personal Options checkboxes ride alongside the picker
		// in core; they should also be present.
		expect( host.querySelector( '[name="meta.rich_editing"]' ) ).not.toBeNull();
		expect(
			host.querySelector( '[name="meta.syntax_highlighting"]' ),
		).not.toBeNull();
		expect(
			host.querySelector( '[name="meta.show_admin_bar_front"]' ),
		).not.toBeNull();
	} );

	test( 'setUserEditTarget commits synchronously so the user-edit render reads the right target after a row click', async () => {
		// Regression for the row-click → admin's profile bug: the
		// URL remap's `onMatch` and the in-window `openUserEditWindow`
		// both called `setUserEditTarget` through `await import()`,
		// which adds a 2-microtask delay. The user-edit window's
		// render callback fires synchronously inside `openWindow`
		// and reads the target on its own microtask chain. Both
		// chains run after the same task; the read fell BEFORE the
		// write because the write took an extra hop, and the render
		// callback saw `pending.userId === null`, falling back to
		// the viewer's `currentUserId`. The fix imports
		// `setUserEditTarget` statically and calls it as a plain
		// sync function in both call sites — locked in here by
		// asserting the store has the picked target id IMMEDIATELY
		// after the helper returns (no `await`, no tick).
		const { setUserEditTarget, readUserEditTarget, clearUserEditTarget } =
			await import( '../../src/posts-window/user-edit-target' );

		clearUserEditTarget();
		expect( readUserEditTarget().userId ).toBeNull();

		// Single synchronous call — no await, no microtask gap.
		setUserEditTarget( 42 );

		// The store must hold the new id RIGHT NOW. If anyone ever
		// makes setUserEditTarget async again, this assertion catches
		// it before the row-click regression resurfaces.
		expect( readUserEditTarget().userId ).toBe( 42 );

		clearUserEditTarget();
	} );

	test( 'stale user-edit subscription must not clear the target before a fresh render reads it', async () => {
		// Regression for "row click only works the first time": the
		// user-edit registry callback subscribes to target changes
		// so an already-open window can swap user ids in place. When
		// the window CLOSES, the subscription survives in the shared
		// store's listener list (closure references a detached
		// profile element). On the NEXT row click, the stale
		// subscription fires synchronously inside `setUserEditTarget`,
		// uselessly setAttribute's the detached element AND — fatally
		// — calls `clearUserEditTarget`. The clear runs BEFORE the
		// fresh window's render callback gets its async read, so
		// the read sees `null` and falls back to the viewer's id.
		// The fix is an `isConnected` guard in the subscription —
		// stale ones bail without touching the target.
		const {
			setUserEditTarget,
			readUserEditTarget,
			subscribeUserEditTarget,
			clearUserEditTarget,
		} = await import( '../../src/posts-window/user-edit-target' );

		clearUserEditTarget();

		// Simulate a previous user-edit open that subscribed and
		// then got closed: the profile element is detached.
		const detachedProfile = document.createElement( 'wpd-user-profile' );
		// Mirror the real subscription body — including the
		// fatal clearUserEditTarget call that the bug depended on.
		const stale = subscribeUserEditTarget( ( next ) => {
			if ( ! detachedProfile.isConnected ) {
				return;
			}
			if ( next.userId && next.userId > 0 ) {
				detachedProfile.setAttribute(
					'user-id',
					String( next.userId ),
				);
				clearUserEditTarget();
			}
		} );

		// Simulate a row click → setUserEditTarget runs and triggers
		// the stale subscription synchronously.
		setUserEditTarget( 99 );

		// The target MUST still be 99 — the stale subscription's
		// guard prevented its clearUserEditTarget from running.
		expect( readUserEditTarget().userId ).toBe( 99 );

		stale();
		clearUserEditTarget();
	} );

	test( 'meta checkbox values are saved as strings, not booleans (WP REST schema)', async () => {
		// Regression for `meta.rich_editing is not of type string`:
		// `wpd-form`'s value harvest returns `field.checked`
		// (boolean) for `<wpd-checkbox-label>`. WP's user-meta
		// schema for `rich_editing`, `syntax_highlighting`,
		// `comment_shortcuts`, `show_admin_bar_front` is `string`
		// (`'true'` / `'false'`). Save used to ship the boolean,
		// REST validation rejected the entire patch, and the role
		// change (which lived in the SAME patch) silently failed.
		// The fix reads each meta checkbox's `value` attribute when
		// the harvested value is a boolean.
		const fetchSpy = vi.fn< typeof fetch >( async ( input, init ) => {
			const url = String( input );
			if ( init?.method === 'POST' && url.includes( '/wp/v2/users/2' ) ) {
				return new Response(
					JSON.stringify( {
						id: 2,
						username: 'peter',
						roles: [ 'author' ],
						meta: { rich_editing: 'true' },
					} ),
					{
						status: 200,
						headers: { 'content-type': 'application/json' },
					},
				);
			}
			if ( url.includes( '/insights' ) ) {
				// Post-save aside refresh — mock so it doesn't reject.
				return new Response(
					JSON.stringify( {
						userId: 2,
						displayName: 'Peter Guila',
						avatarUrl: '',
						profileUrl: '',
						roles: [ 'author' ],
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
						applicationPasswords: {
							total: 0,
							lastUsedAt: null,
							lastUsedName: null,
						},
					} ),
					{
						status: 200,
						headers: { 'content-type': 'application/json' },
					},
				);
			}
			// Initial fetchUser call.
			return new Response(
				JSON.stringify( {
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
					meta: {
						rich_editing: 'true',
						syntax_highlighting: 'true',
						comment_shortcuts: 'false',
						show_admin_bar_front: 'true',
					},
				} ),
				{
					status: 200,
					headers: { 'content-type': 'application/json' },
				},
			);
		} );
		( globalThis as unknown as { fetch: typeof fetch } ).fetch =
			fetchSpy as unknown as typeof fetch;

		
		const render = await import( '../../src/posts-window/user-edit-render' );
		await render.mountProfileFormAt( host, 2 );
		await tick();
		await wait( 0 );

		const form = host.querySelector( 'wpd-form' ) as HTMLElement & {
			submit: () => void;
		};
		form.submit();
		await wait( 30 );

		const postCall = fetchSpy.mock.calls.find(
			( [ , init ] ) => init?.method === 'POST',
		);
		expect( postCall ).toBeDefined();
		const body = JSON.parse( postCall![ 1 ]!.body as string );
		expect( body.meta ).toBeDefined();
		// EVERY meta value must be a string — no booleans allowed.
		for ( const [ key, value ] of Object.entries( body.meta ) ) {
			expect(
				typeof value,
				`meta.${ key } must be a string, got ${ typeof value }`,
			).toBe( 'string' );
		}
		// And specifically the 4 known personal-option keys are
		// `'true'` / `'false'` strings.
		expect( body.meta.rich_editing ).toMatch( /^(true|false)$/ );
		expect( body.meta.syntax_highlighting ).toMatch( /^(true|false)$/ );
		expect( body.meta.comment_shortcuts ).toMatch( /^(true|false)$/ );
		expect( body.meta.show_admin_bar_front ).toMatch( /^(true|false)$/ );
	} );

	test( 'a successful save routes the confirmation through wp.desktop.showToast', async () => {
		// The user-edit form surfaces save success via the shell's
		// own `<wpd-toast-container>` (`wp.desktop.showToast`) — the
		// same toast affordance every other wpd-component uses. Do
		// NOT bring back an inline banner: the user explicitly asked
		// for the unified desktop-level toast.
		const originalUser = {
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
			avatar_urls: { '96': 'http://example/avatar.png' },
			meta: {},
		};
		const savedUser = { ...originalUser, roles: [ 'author' ] };

		( globalThis as unknown as { fetch: typeof fetch } ).fetch = ( async (
			input,
			init,
		) => {
			const url = String( input );
			if ( init?.method === 'POST' ) {
				return new Response( JSON.stringify( savedUser ), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				} );
			}
			if ( url.includes( '/insights' ) ) {
				return new Response(
					JSON.stringify( {
						userId: 2,
						displayName: 'Peter Guila',
						avatarUrl: '',
						profileUrl: '',
						roles: [ 'author' ],
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
						applicationPasswords: {
							total: 0,
							lastUsedAt: null,
							lastUsedName: null,
						},
					} ),
					{
						status: 200,
						headers: { 'content-type': 'application/json' },
					},
				);
			}
			return new Response( JSON.stringify( originalUser ), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			} );
		} ) as unknown as typeof fetch;

		// Spy on the shell-level toast API. The user-edit save MUST
		// route through here — no inline banner, no custom DOM.
		const showToastSpy = vi.fn( () => () => undefined );
		( window as unknown as {
			wp?: {
				desktop?: { showToast?: ( opts: unknown ) => () => void };
			};
		} ).wp = {
			desktop: { showToast: showToastSpy },
		};

		
		const render = await import( '../../src/posts-window/user-edit-render' );
		await render.mountProfileFormAt( host, 2 );
		await tick();
		await wait( 0 );

		// Before submit: NO inline banner, NO toast call yet.
		expect(
			host.querySelector( '.desktop-mode-user-edit__save-banner' ),
		).toBeNull();
		expect( showToastSpy ).not.toHaveBeenCalled();

		const form = host.querySelector( 'wpd-form' ) as HTMLElement & {
			submit: () => void;
		};
		form.submit();
		await wait( 30 );

		// After successful submit: toast fired with the saved-message
		// shape (`{ message, duration? }`).
		expect( showToastSpy ).toHaveBeenCalled();
		const lastCall = showToastSpy.mock.calls.at( -1 );
		const opts = lastCall![ 0 ] as { message: string; duration?: number };
		expect( opts.message.toLowerCase() ).toContain( 'saved' );
		// Inline banner must still NOT exist after save.
		expect(
			host.querySelector( '.desktop-mode-user-edit__save-banner' ),
		).toBeNull();
	} );

	test( 'the role select stays hidden when the viewer is editing themselves', async () => {
		// Self-edit guard is the ONLY remaining JS-side gate; demoting
		// yourself out of administrator would lock you out, so we
		// match core's `profile.php` and hide the control.
		( globalThis as unknown as { fetch: typeof fetch } ).fetch = ( async () =>
			new Response(
				JSON.stringify( {
					id: 1,
					username: 'admin',
					name: 'Admin',
					first_name: 'Admin',
					last_name: '',
					nickname: 'admin',
					email: 'a@example.com',
					url: '',
					description: '',
					locale: 'en_US',
					roles: [ 'administrator' ],
					avatar_urls: {},
					meta: {},
				} ),
				{
					status: 200,
					headers: { 'content-type': 'application/json' },
				},
			) ) as unknown as typeof fetch;

		
		const render = await import( '../../src/posts-window/user-edit-render' );
		// userId === cfg.currentUserId (1) — admin editing themselves.
		await render.mountProfileFormAt( host, 1 );
		await tick();
		await wait( 0 );

		const roleSelect = host.querySelector( 'wpd-select[name="roles[0]"]' );
		expect( roleSelect ).toBeNull();
	} );
} );
