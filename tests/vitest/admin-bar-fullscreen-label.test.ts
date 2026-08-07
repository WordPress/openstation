/**
 * The Fullscreen admin-bar button's label has to survive the tooltip
 * rewrite.
 *
 * `assets/js/admin-bar.js` runs two passes over the same node.
 * `wireTooltipsFor()` moves the server-rendered `title` onto
 * `data-desktop-tooltip` (what the pure-CSS tooltip in `admin-bar.php`
 * renders) and `aria-label` (the accessible name), then drops `title`
 * so the native OS tooltip stops competing. `paintFullscreen()` then
 * relabels the button on every `fullscreenchange`.
 *
 * Those two only agree if the repaint writes the same three attributes
 * the wiring left behind. Writing `title` alone — which is what it used
 * to do — left the tooltip and the accessible name describing the
 * opposite action, and re-added the native tooltip on top of ours
 * (GH#493).
 *
 * The file is a plain-JS IIFE with no exports (it's loaded by the
 * server as a `<script>`, and it's one of the two hand-written files
 * under `assets/js/`), so we mount the admin-bar markup the server
 * renders and evaluate the real shipped source against it.
 *
 * Evaluating it means we also inherit its side effects — notably the
 * snap-checkbox poll, which re-arms every 60ms until `wp.os
 * .windowManager` appears. A fixture without one left that poll
 * running after the file finished, and the first tick past teardown
 * dereferenced a `window` that no longer existed: an unhandled
 * `ReferenceError` that vitest reports against the whole run. So the
 * fixture publishes a manager, the way the shell does. That is both
 * the honest fixture and the fix.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE = readFileSync(
	resolve( __dirname, '../../assets/js/admin-bar.js' ),
	'utf8'
);

/** The i18n bag `openstation_admin_bar_config()` ships to the script. */
const I18N = {
	enterFullscreen: 'Fullscreen',
	exitFullscreen: 'Exit fullscreen',
	enterTitle: 'Enter fullscreen',
	exitTitle: 'Exit fullscreen',
};

/**
 * Renders the admin bar the way `admin_bar_menu` does. The toggle and
 * the layout menu are both load-bearing for the fixture: the script
 * returns early without either, and the server renders all three
 * together whenever the shell is active. The Fullscreen button's only
 * label is the `title` on its `.ab-item`.
 *
 * The snap item is here for the same reason the manager stub is —
 * the script paints it on startup, and a fixture that omits it is a
 * page the script never actually runs against.
 */
function mountAdminBar(): void {
	document.body.innerHTML = `
		<div id="wpadminbar">
			<ul id="wp-admin-bar-top-secondary">
				<li id="wp-admin-bar-os-toggle">
					<a class="ab-item" href="#">Toggle</a>
				</li>
				<li id="wp-admin-bar-desktop-fullscreen" class="desktop-fullscreen-btn">
					<a class="ab-item" role="menuitem" href="#" title="Enter fullscreen">
						<span class="ab-icon dashicons dashicons-fullscreen-alt" aria-hidden="true"></span>
					</a>
				</li>
				<li id="wp-admin-bar-desktop-layout-menu">
					<a class="ab-item" href="#" title="Arrange windows"></a>
					<div class="ab-sub-wrapper"><ul>
						<li id="wp-admin-bar-desktop-layout-snap" class="os-layout-snap">
							<a class="ab-item" href="#"
								>Snap to grid <span class="os-layout-checkbox">☐</span></a
							>
						</li>
					</ul></div>
				</li>
			</ul>
		</div>
	`;
}

/**
 * Publish the slice of `wp.os` the script polls for. Without this the
 * poll never terminates — see the note at the top of the file.
 */
function publishManager( snapEnabled: boolean ): void {
	( window as unknown as Record< string, unknown > ).wp = {
		os: { windowManager: { isSnapEnabled: () => snapEnabled } },
	};
}

function fsLink(): HTMLAnchorElement {
	return document.querySelector(
		'#wp-admin-bar-desktop-fullscreen .ab-item'
	) as HTMLAnchorElement;
}

/**
 * jsdom implements neither `fullscreenElement` nor the request/exit
 * methods, so we stand in for the browser: define the property and let
 * each test drive it before firing the event the script listens on.
 */
function setFullscreen( on: boolean ): void {
	Object.defineProperty( document, 'fullscreenElement', {
		value: on ? document.documentElement : null,
		configurable: true,
	} );
	document.dispatchEvent( new Event( 'fullscreenchange' ) );
}

function runAdminBarScript(): void {
	// eslint-disable-next-line no-new-func -- the shipped file is an
	// IIFE with no exports; evaluating it is the only way to test it.
	new Function( SOURCE )();
}

describe( 'admin-bar Fullscreen button label', () => {
	beforeEach( () => {
		( window as unknown as Record< string, unknown > )
			.openStationAdminBar = { i18n: I18N };
		publishManager( false );
		mountAdminBar();
	} );

	afterEach( () => {
		document.body.innerHTML = '';
		document.body.className = '';
		delete ( window as unknown as Record< string, unknown > )
			.openStationAdminBar;
		delete ( window as unknown as Record< string, unknown > ).wp;
	} );

	test( 'wiring moves the server title onto the tooltip + aria-label', () => {
		runAdminBarScript();

		const link = fsLink();
		expect( link.hasAttribute( 'title' ) ).toBe( false );
		expect( link.getAttribute( 'data-desktop-tooltip' ) ).toBe(
			'Enter fullscreen'
		);
		expect( link.getAttribute( 'aria-label' ) ).toBe( 'Enter fullscreen' );
	} );

	test( 'entering fullscreen repaints tooltip and accessible name', () => {
		runAdminBarScript();
		setFullscreen( true );

		const link = fsLink();
		expect(
			document.getElementById( 'wp-admin-bar-desktop-fullscreen' )
				?.classList.contains( 'is-fullscreen' )
		).toBe( true );
		expect( link.getAttribute( 'data-desktop-tooltip' ) ).toBe(
			'Exit fullscreen'
		);
		expect( link.getAttribute( 'aria-label' ) ).toBe( 'Exit fullscreen' );
	} );

	test( 'the repaint does not resurrect the native title tooltip', () => {
		runAdminBarScript();
		setFullscreen( true );

		// Both tooltips visible at once was the other half of GH#493:
		// ours from the data attribute, the browser's from `title`.
		expect( fsLink().hasAttribute( 'title' ) ).toBe( false );
	} );

	test( 'exiting fullscreen restores the enter label', () => {
		runAdminBarScript();
		setFullscreen( true );
		setFullscreen( false );

		const link = fsLink();
		expect(
			document.getElementById( 'wp-admin-bar-desktop-fullscreen' )
				?.classList.contains( 'is-fullscreen' )
		).toBe( false );
		expect( link.getAttribute( 'data-desktop-tooltip' ) ).toBe(
			'Enter fullscreen'
		);
		expect( link.getAttribute( 'aria-label' ) ).toBe( 'Enter fullscreen' );
		expect( link.hasAttribute( 'title' ) ).toBe( false );
	} );
} );

/**
 * The snap-checkbox poll waits for the shell to publish
 * `wp.os.windowManager`. It has to give up: on a page where the shell
 * never boots, an unbounded poll is a 60ms timer that outlives
 * everything, and in this suite it outlived the jsdom environment and
 * threw `ReferenceError: window is not defined` from a torn-down
 * global.
 */
describe( 'admin-bar snap-checkbox poll', () => {
	beforeEach( () => {
		( window as unknown as Record< string, unknown > )
			.openStationAdminBar = { i18n: I18N };
		mountAdminBar();
	} );

	afterEach( () => {
		vi.useRealTimers();
		document.body.innerHTML = '';
		delete ( window as unknown as Record< string, unknown > )
			.openStationAdminBar;
		delete ( window as unknown as Record< string, unknown > ).wp;
	} );

	function checkbox(): HTMLElement {
		return document.querySelector(
			'#wp-admin-bar-desktop-layout-snap .os-layout-checkbox'
		) as HTMLElement;
	}

	test( 'paints the persisted preference once the manager appears', () => {
		vi.useFakeTimers();
		runAdminBarScript();

		// Nothing to read yet, so the box keeps its server-rendered
		// state and the poll re-arms.
		expect( checkbox().textContent ).toBe( '☐' );
		expect( vi.getTimerCount() ).toBe( 1 );

		publishManager( true );
		vi.advanceTimersByTime( 60 );

		expect( checkbox().textContent ).toBe( '☑' );
		expect(
			document
				.getElementById( 'wp-admin-bar-desktop-layout-snap' )
				?.getAttribute( 'aria-checked' )
		).toBe( 'true' );
		// Resolved — nothing left waking the event loop.
		expect( vi.getTimerCount() ).toBe( 0 );
	} );

	test( 'gives up when the shell never publishes a manager', () => {
		vi.useFakeTimers();
		runAdminBarScript();

		expect( vi.getTimerCount() ).toBe( 1 );
		// Well past the ten-second bound.
		vi.advanceTimersByTime( 30000 );

		expect( vi.getTimerCount() ).toBe( 0 );
		// Never painted — which is exactly what polling forever would
		// have achieved, minus the timer.
		expect( checkbox().textContent ).toBe( '☐' );
	} );
} );
