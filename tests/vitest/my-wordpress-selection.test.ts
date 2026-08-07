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

describe( 'my-wordpress — multi-selection', () => {
	beforeEach( async () => {
		installHooksStub();
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
				const body = href.includes( 'wp/v2/posts' )
					? JSON.stringify( POSTS )
					: '[]';
				return Promise.resolve(
					new Response( body, {
						status: 200,
						headers: {
							'X-WP-Total': String( POSTS.length ),
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
} );
