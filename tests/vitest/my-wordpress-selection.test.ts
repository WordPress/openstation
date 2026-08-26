/**
 * Multi-selection inside the My WordPress window: entity lists get
 * the same gestures and the same intersected menu the desktop does.
 *
 * Same harness as `my-wordpress-groups.test.ts` — load the bundle,
 * invoke the registered render callback, drive the painted tiles with
 * real events.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';

const WINDOW_ID = 'desktop-mode-my-wordpress';

interface NativeWindowsGlobal {
	openStationNativeWindows?: Record<
		string,
		( ( body: HTMLElement ) => void | ( () => void ) ) | undefined
	>;
	openStationWindowConfig?: Record< string, unknown >;
}

const POSTS = [
	{
		id: 11,
		title: { rendered: 'First' },
		status: 'publish',
		date: '2024-01-01T00:00:00',
		link: 'http://example.test/1',
	},
	{
		id: 12,
		title: { rendered: 'Second' },
		status: 'draft',
		date: '2024-01-02T00:00:00',
		link: 'http://example.test/2',
	},
	{
		id: 13,
		title: { rendered: 'Third' },
		status: 'publish',
		date: '2024-01-03T00:00:00',
		link: 'http://example.test/3',
	},
];

const USERS = [
	{
		id: 21,
		name: 'Ada Lovelace',
		slug: 'ada',
		description: '',
		link: 'http://example.test/author/ada',
		avatar_urls: { '96': 'http://example.test/ada.png' },
	},
	{
		id: 22,
		name: 'Grace Hopper',
		slug: 'grace',
		description: '',
		link: 'http://example.test/author/grace',
		avatar_urls: { '96': 'http://example.test/grace.png' },
	},
];

function installTemplateMarkup( host: HTMLElement ): void {
	host.innerHTML = `
		<div class="desktop-mode-my-wordpress" data-os-my-wordpress-root>
			<header data-os-my-wordpress-breadcrumbs></header>
			<div class="os-my-wordpress__body" data-os-my-wordpress-body>
				<div class="os-my-wordpress__loading" data-os-my-wordpress-loading hidden></div>
			</div>
			<div class="os-folder-status-bar" data-os-my-wordpress-status></div>
		</div>
	`;
}

function mountWindow(): HTMLElement {
	const cb = ( window as unknown as NativeWindowsGlobal )
		.openStationNativeWindows?.[ WINDOW_ID ];
	if ( typeof cb !== 'function' ) {
		throw new Error( 'render callback not registered' );
	}
	const body = document.createElement( 'div' );
	body.className = 'os-window__body';
	installTemplateMarkup( body );
	document.body.appendChild( body );
	cb( body );
	return body;
}

function dblclickTile( body: HTMLElement, label: string ): void {
	const tile = [ ...body.querySelectorAll< HTMLElement >( 'os-tile' ) ].find(
		( t ) =>
			(
				t.querySelector( '.os-file-tile__label' )?.textContent ?? ''
			).startsWith( label ),
	);
	if ( ! tile ) {
		throw new Error( `no tile labelled ${ label }` );
	}
	tile.dispatchEvent( new MouseEvent( 'dblclick', { bubbles: true } ) );
}

function entryTile( body: HTMLElement, id: number ): HTMLElement {
	const tile = body.querySelector< HTMLElement >( `[data-entry-id="${ id }"]` );
	if ( ! tile ) {
		throw new Error( `no entry tile ${ id }` );
	}
	return tile;
}

function click( el: Element, init: MouseEventInit = {} ): void {
	el.dispatchEvent( new MouseEvent( 'click', { bubbles: true, ...init } ) );
}

function rightClick( el: Element ): void {
	el.dispatchEvent(
		new MouseEvent( 'contextmenu', {
			bubbles: true,
			clientX: 5,
			clientY: 5,
		} ),
	);
}

function menuIds(): string[] {
	const menu = document.querySelector( 'os-context-menu' );
	return Array.from(
		menu?.querySelectorAll( 'os-context-menu-option' ) ?? [],
	).map( ( o ) => ( o as HTMLElement ).dataset.menuItemId ?? '' );
}

function statusLabels( body: HTMLElement ): string[] {
	return Array.from(
		body.querySelectorAll( '.os-folder-status-bar__label' ),
	).map( ( n ) => n.textContent ?? '' );
}

/** Open the Posts section and wait for the first page to paint. */
async function openPosts( body: HTMLElement ): Promise< void > {
	dblclickTile( body, 'Posts' );
	await vi.waitFor( () => {
		if ( ! body.querySelector( '[data-entry-id]' ) ) {
			throw new Error( 'entries not painted yet' );
		}
	} );
}

/**
 * Wait for the preview pane to finish painting a person.
 *
 * Also what keeps the harness honest: the dossier render is async and
 * ends by firing hooks, so a test that returns while one is in flight
 * has it land after `afterEach` has torn `window.wp` down.
 */
async function awaitUserPreview(
	body: HTMLElement,
	name: string,
): Promise< void > {
	await vi.waitFor( () => {
		const preview = body.querySelector( '.os-my-wordpress__preview' );
		if ( ! preview?.textContent?.includes( name ) ) {
			throw new Error( 'preview not painted yet' );
		}
	} );
}

/** Open the People section and wait for the first page to paint. */
async function openPeople( body: HTMLElement ): Promise< void > {
	dblclickTile( body, 'People' );
	await vi.waitFor( () => {
		if ( ! body.querySelector( '[data-entry-id]' ) ) {
			throw new Error( 'people not painted yet' );
		}
	} );
}

describe( 'my-wordpress — multi-selection', () => {
	beforeEach( async () => {
		installHooksStub();
		// The bundle registers its document-level listeners (the
		// live-trash pruner among them) only when the shell namespace
		// exists, so the harness has to supply one.
		( window as unknown as { wp: { os: Record< string, unknown > } } ).wp.os =
			{};
		( window as unknown as NativeWindowsGlobal ).openStationWindowConfig = {
			[ WINDOW_ID ]: {
				restRoot: 'http://example.test/wp-json/',
				restNonce: 'nonce',
				editPostUrlBase: 'http://example.test/wp-admin/post.php',
				editUserUrlBase: 'http://example.test/wp-admin/user-edit.php',
				siteName: 'Example',
				entities: [
					{
						id: 'posts',
						label: 'Posts',
						icon: 'dashicons-admin-post',
						restPath: 'wp/v2/posts',
						kind: 'post',
						post_type: 'post',
					},
					// A `user`-kind section — the shape the built-in Users
					// list and WooCommerce's Customers list both render
					// through.
					{
						id: 'people',
						label: 'People',
						icon: 'dashicons-admin-users',
						restPath: 'wp/v2/users',
						kind: 'user',
					},
				],
				groups: [],
				perPage: 24,
				mediaPerPage: 48,
				previewActions: [],
			},
		};
		vi.stubGlobal(
			'fetch',
			vi.fn( ( url: unknown ) => {
				const href = String( url );
				let body = '[]';
				let total = 0;
				if ( href.includes( 'desktop-mode/v1/user-stats/' ) ) {
					// No dossier stats in the harness. The preview pane
					// has a documented fallback for exactly this (a site
					// where the route is unavailable), and it is the path
					// under test here: it still has to name the person.
					return Promise.resolve(
						new Response( '{}', {
							status: 404,
							headers: { 'Content-Type': 'application/json' },
						} ),
					);
				}
				if ( href.includes( 'wp/v2/posts' ) ) {
					body = JSON.stringify( POSTS );
					total = POSTS.length;
				} else if ( href.includes( 'wp/v2/users' ) ) {
					body = JSON.stringify( USERS );
					total = USERS.length;
				}
				return Promise.resolve(
					new Response( body, {
						status: 200,
						headers: {
							'X-WP-Total': String( total ),
							'X-WP-TotalPages': '1',
							'Content-Type': 'application/json',
						},
					} ),
				);
			} ),
		);
		await import( '../../src/my-wordpress/index' );
	} );

	afterEach( () => {
		document.body.innerHTML = '';
		clearHooksStub();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	} );

	test( 'ctrl-click selects several entries', async () => {
		const body = mountWindow();
		await openPosts( body );
		click( entryTile( body, 11 ) );
		click( entryTile( body, 12 ), { metaKey: true } );
		expect( entryTile( body, 11 ).hasAttribute( 'selected' ) ).toBe( true );
		expect( entryTile( body, 12 ).hasAttribute( 'selected' ) ).toBe( true );
		expect( entryTile( body, 13 ).hasAttribute( 'selected' ) ).toBe( false );
	} );

	test( 'shift-click extends the range', async () => {
		const body = mountWindow();
		await openPosts( body );
		click( entryTile( body, 11 ) );
		click( entryTile( body, 13 ), { shiftKey: true } );
		expect( entryTile( body, 12 ).hasAttribute( 'selected' ) ).toBe( true );
	} );

	test( 'the status bar reports the selection size', async () => {
		const body = mountWindow();
		await openPosts( body );
		click( entryTile( body, 11 ) );
		click( entryTile( body, 12 ), { metaKey: true } );
		expect( statusLabels( body ) ).toContain( '2 selected' );
	} );

	test( 'the preview pane summarizes a multi-selection', async () => {
		const body = mountWindow();
		await openPosts( body );
		click( entryTile( body, 11 ) );
		click( entryTile( body, 12 ), { metaKey: true } );
		const preview = body.querySelector( '.os-my-wordpress__preview' );
		expect( preview?.textContent ).toContain( '2 items selected' );
		// Status breakdown is what decides which bulk actions apply.
		expect( preview?.textContent ).toContain( 'publish' );
		expect( preview?.textContent ).toContain( 'draft' );
	} );

	test( 'a multi-selection menu keeps only the multi-safe actions', async () => {
		const body = mountWindow();
		await openPosts( body );
		// #11 is published, #12 is a draft.
		click( entryTile( body, 11 ) );
		click( entryTile( body, 12 ), { metaKey: true } );
		rightClick( entryTile( body, 12 ) );
		// `navigate-into` is single-item and drops out. So do the two
		// status actions, but for a subtler reason: "Publish" is only
		// offered for entries that aren't published and "Switch to
		// Draft" only for entries that aren't drafts, so a set holding
		// one of each has neither in common.
		expect( menuIds() ).toEqual( [
			'open',
			'bulk-edit',
			'copy-links',
			'trash',
		] );
	} );

	test( 'a status action survives a set that agrees about status', async () => {
		const body = mountWindow();
		await openPosts( body );
		// #11 and #13 are both published.
		click( entryTile( body, 11 ) );
		click( entryTile( body, 13 ), { metaKey: true } );
		rightClick( entryTile( body, 13 ) );
		expect( menuIds() ).toContain( 'to-draft' );
		expect( menuIds() ).not.toContain( 'publish' );
	} );

	test( 'a single-entry menu carries the full action set', async () => {
		const body = mountWindow();
		await openPosts( body );
		click( entryTile( body, 11 ) );
		rightClick( entryTile( body, 11 ) );
		expect( menuIds() ).toEqual( [
			'open',
			'navigate-into',
			'bulk-edit',
			'to-draft',
			'copy-links',
			'trash',
		] );
	} );

	test( 'right-clicking outside the selection replaces it', async () => {
		const body = mountWindow();
		await openPosts( body );
		click( entryTile( body, 11 ) );
		click( entryTile( body, 12 ), { metaKey: true } );
		rightClick( entryTile( body, 13 ) );
		expect( entryTile( body, 13 ).hasAttribute( 'selected' ) ).toBe( true );
		expect( entryTile( body, 11 ).hasAttribute( 'selected' ) ).toBe( false );
		// The menu is the single-entry one, for the tile just clicked.
		expect( menuIds() ).toContain( 'navigate-into' );
	} );

	test( 'clicking the empty canvas clears the selection', async () => {
		const body = mountWindow();
		await openPosts( body );
		click( entryTile( body, 11 ) );
		const list = body.querySelector( '.os-my-wordpress__list' );
		click( list! );
		expect( entryTile( body, 11 ).hasAttribute( 'selected' ) ).toBe( false );
	} );

	// A user tile is keyed the same way an entry tile is — the section's
	// selection controller reads `data-entry-id` and nothing else. When
	// the tile didn't carry one, every click on a person was swallowed:
	// no highlight, no status count, and a preview pane that stayed on
	// its placeholder, which is how the WooCommerce Customers grid read
	// as broken.
	test( 'a user tile carries the key its canvas selects by', async () => {
		const body = mountWindow();
		await openPeople( body );
		const tile = [
			...body.querySelectorAll< HTMLElement >( 'os-tile[type="user"]' ),
		].find( ( t ) => t.dataset.userId === '21' );
		expect( tile?.dataset.entryId ).toBe( '21' );
	} );

	test( 'single-clicking a user selects it', async () => {
		const body = mountWindow();
		await openPeople( body );
		click( entryTile( body, 21 ) );
		expect( entryTile( body, 21 ).hasAttribute( 'selected' ) ).toBe( true );
		expect( entryTile( body, 22 ).hasAttribute( 'selected' ) ).toBe( false );
		expect( statusLabels( body ) ).toContain( '1 selected' );
		await awaitUserPreview( body, 'Ada Lovelace' );
	} );

	test( 'selecting a user paints the preview pane', async () => {
		const body = mountWindow();
		await openPeople( body );
		click( entryTile( body, 21 ) );
		await awaitUserPreview( body, 'Ada Lovelace' );
	} );

	test( 'ctrl-click selects several users', async () => {
		const body = mountWindow();
		await openPeople( body );
		click( entryTile( body, 21 ) );
		click( entryTile( body, 22 ), { metaKey: true } );
		expect( entryTile( body, 21 ).hasAttribute( 'selected' ) ).toBe( true );
		expect( entryTile( body, 22 ).hasAttribute( 'selected' ) ).toBe( true );
		expect( statusLabels( body ) ).toContain( '2 selected' );
	} );

	// Entry ids are unique per section, not per site. The trash
	// broadcast reaches every live list body, so a post id must not
	// take out the same-numbered user tile.
	test( 'a trash broadcast prunes only its own section', async () => {
		const body = mountWindow();
		await openPeople( body );
		document.dispatchEvent(
			new CustomEvent( 'os-my-wordpress-entity-trashed', {
				detail: { entityId: 'posts', id: 21 },
			} ),
		);
		expect( entryTile( body, 21 ) ).toBeTruthy();

		document.dispatchEvent(
			new CustomEvent( 'os-my-wordpress-entity-trashed', {
				detail: { entityId: 'people', id: 21 },
			} ),
		);
		expect(
			body.querySelector( '[data-entry-id="21"]' ),
		).toBeNull();
	} );
} );
