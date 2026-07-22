/**
 * URL-aware window reuse in {@link WindowManager.open}.
 *
 * `open()` on a baseId that's already on screen used to focus the
 * existing window unconditionally — dropping the requested URL on
 * the floor. The canonical casualty: the post-install "Activate"
 * link (`plugins.php?action=activate&plugin=…&_wpnonce=…`) clicked
 * while a Plugins window was already open focused that window and
 * the activation never ran.
 *
 * These tests pin the new contract:
 *
 *   - same URL (modulo chromeless / portal / `_wp_http_referer`
 *     params and param order) → focus only, no navigation;
 *   - the window's home / dock landing URL → focus only, even when
 *     the iframe has sub-navigated elsewhere (a dock click must not
 *     yank the window back to its landing page);
 *   - any other URL → the existing iframe navigates to it in place,
 *     and the `desktop-mode-window-reopened` detail reports
 *     `navigated: true`.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

const ORIGIN = window.location.origin;
const PLUGINS_URL = `${ ORIGIN }/wp-admin/plugins.php`;
const ACTIVATE_URL = `${ ORIGIN }/wp-admin/plugins.php?action=activate&plugin=hello%2Fhello.php&_wpnonce=abc123`;

function openConfig( overrides: Partial<{ url: string; parentUrl: string }> = {} ) {
	return {
		id: 'plugins-php',
		baseId: 'plugins-php',
		url: overrides.url ?? PLUGINS_URL,
		parentUrl: overrides.parentUrl ?? PLUGINS_URL,
		title: 'Plugins',
		icon: 'dashicons-admin-plugins',
	};
}

/**
 * Replace the iframe's `contentWindow` with a controllable fake so
 * the test can (a) pin what `getCurrentUrl()` reports and (b) record
 * `location.assign()` calls. jsdom's real iframe never leaves
 * `about:blank` and its `location.assign` is a not-implemented
 * no-op, so the fake is the only way to observe the navigation.
 */
function fakeContentWindow(
	iframe: HTMLIFrameElement,
	currentHref: string,
): string[] {
	const assigned: string[] = [];
	Object.defineProperty( iframe, 'contentWindow', {
		configurable: true,
		value: {
			location: {
				href: currentHref,
				assign: ( url: string ) => {
					assigned.push( url );
				},
			},
		},
	} );
	return assigned;
}

describe( 'WindowManager — URL-aware reuse on open()', () => {
	let desktop: HTMLElement;
	let manager: WindowManager;
	let reopenedDetails: Array<{
		windowId: string;
		baseId: string;
		wasMinimized: boolean;
		navigated: boolean;
	}>;
	const onReopened = ( e: Event ) => {
		reopenedDetails.push( ( e as CustomEvent ).detail );
	};

	beforeEach( () => {
		installHooksStub();
		desktop = document.createElement( 'div' );
		desktop.id = 'desktop-mode-area';
		Object.defineProperty( desktop, 'getBoundingClientRect', {
			value: () =>
				( {
					left: 0,
					top: 0,
					right: 1600,
					bottom: 900,
					width: 1600,
					height: 900,
					x: 0,
					y: 0,
					toJSON: () => ( {} ),
				} ) as DOMRect,
		} );
		Object.defineProperty( desktop, 'clientWidth', { value: 1600, configurable: true } );
		Object.defineProperty( desktop, 'clientHeight', { value: 900, configurable: true } );
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
		reopenedDetails = [];
		document.addEventListener( 'desktop-mode-window-reopened', onReopened );
	} );

	afterEach( () => {
		document.removeEventListener( 'desktop-mode-window-reopened', onReopened );
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktop.remove();
		clearHooksStub();
	} );

	test( 're-open with the same URL focuses without navigating', async () => {
		const win = await manager.open( openConfig() );
		const assigned = fakeContentWindow(
			win.iframe!,
			`${ PLUGINS_URL }?desktop_mode_chromeless=1`,
		);
		const srcBefore = win.iframe!.src;

		const again = await manager.open( openConfig() );

		expect( again ).toBe( win );
		expect( assigned ).toEqual( [] );
		expect( win.iframe!.src ).toBe( srcBefore );
		expect( reopenedDetails ).toHaveLength( 1 );
		expect( reopenedDetails[ 0 ].navigated ).toBe( false );
	} );

	test( 're-open with the home URL does not yank a sub-navigated window back', async () => {
		const win = await manager.open( openConfig() );
		// The user paged / filtered inside the window since opening it.
		const assigned = fakeContentWindow(
			win.iframe!,
			`${ PLUGINS_URL }?plugin_status=active&paged=2&desktop_mode_chromeless=1`,
		);

		// Dock click — same landing URL the tile always carries.
		await manager.open( openConfig() );

		expect( assigned ).toEqual( [] );
		expect( reopenedDetails ).toHaveLength( 1 );
		expect( reopenedDetails[ 0 ].navigated ).toBe( false );
	} );

	test( 'an action URL navigates the existing iframe instead of just focusing', async () => {
		const win = await manager.open( openConfig() );
		const assigned = fakeContentWindow(
			win.iframe!,
			`${ PLUGINS_URL }?desktop_mode_chromeless=1`,
		);

		const again = await manager.open( openConfig( { url: ACTIVATE_URL } ) );

		// Same window — no duplicate spawned.
		expect( again ).toBe( win );
		expect( manager.getAll() ).toHaveLength( 1 );
		// …but the iframe actually navigated to the action URL.
		expect( assigned ).toHaveLength( 1 );
		const target = new URL( assigned[ 0 ] );
		expect( target.searchParams.get( 'action' ) ).toBe( 'activate' );
		expect( target.searchParams.get( '_wpnonce' ) ).toBe( 'abc123' );
		expect( target.searchParams.get( 'desktop_mode_chromeless' ) ).toBe( '1' );
		expect( reopenedDetails ).toHaveLength( 1 );
		expect( reopenedDetails[ 0 ].navigated ).toBe( true );
	} );

	test( 'a `_wp_http_referer`-only difference does not navigate', async () => {
		const win = await manager.open( openConfig() );
		const assigned = fakeContentWindow(
			win.iframe!,
			`${ PLUGINS_URL }?desktop_mode_chromeless=1`,
		);

		// Cross-window links get `_wp_http_referer` stamped on by the
		// admin-link dispatcher — it's a redirect hint, not a
		// different destination.
		await manager.open(
			openConfig( {
				url: `${ PLUGINS_URL }?_wp_http_referer=%2Fwp-admin%2Findex.php`,
			} ),
		);

		expect( assigned ).toEqual( [] );
		expect( reopenedDetails ).toHaveLength( 1 );
		expect( reopenedDetails[ 0 ].navigated ).toBe( false );
	} );

	test( 'a torn-down contentWindow falls back to iframe.src assignment', async () => {
		const win = await manager.open( openConfig() );
		Object.defineProperty( win.iframe!, 'contentWindow', {
			configurable: true,
			value: null,
		} );

		await manager.open( openConfig( { url: ACTIVATE_URL } ) );

		const target = new URL( win.iframe!.src );
		expect( target.searchParams.get( 'action' ) ).toBe( 'activate' );
		expect( target.searchParams.get( 'desktop_mode_chromeless' ) ).toBe( '1' );
		expect( reopenedDetails[ 0 ].navigated ).toBe( true );
	} );

	test( 'a cross-origin URL is refused — focus only, no navigation', async () => {
		const win = await manager.open( openConfig() );
		const assigned = fakeContentWindow(
			win.iframe!,
			`${ PLUGINS_URL }?desktop_mode_chromeless=1`,
		);
		const srcBefore = win.iframe!.src;

		await manager.open(
			openConfig( { url: 'https://evil.example/wp-admin/plugins.php?action=activate' } ),
		);

		expect( assigned ).toEqual( [] );
		expect( win.iframe!.src ).toBe( srcBefore );
		expect( reopenedDetails[ 0 ].navigated ).toBe( false );
	} );
} );
