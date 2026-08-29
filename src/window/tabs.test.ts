/**
 * Tests for the submenu tab strip's active-state matching
 * (`syncActiveTab`). The strip has to stay lit while the user moves
 * around *inside* a tab's page — `nav-menus.php?action=locations`,
 * `edit.php?paged=2` — without ever letting one submenu entry claim
 * another entry's page.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	handleTabStripClick,
	observeTabOverflow,
	syncActiveTab,
	updateTabOverflow,
} from './tabs';
import type { Window } from './index';

const ADMIN = window.location.origin + '/wp-admin/';

/**
 * Build a window stub carrying a submenu tab strip. Tabs are given in
 * click order; each entry is `[ label, url ]`.
 */
function mockTabbedWindow(
	tabs: [ string, string ][],
	activeTabId: string = 'primary',
): Window {
	const element = document.createElement( 'div' );
	const strip = document.createElement( 'nav' );
	strip.className = 'os-window__tabs';
	for ( const [ label, url ] of tabs ) {
		const tab = document.createElement( 'button' );
		tab.className = 'os-window__tab';
		tab.dataset.kind = 'submenu';
		tab.dataset.url = url;
		tab.textContent = label;
		strip.appendChild( tab );
	}
	element.appendChild( strip );
	return { element, _activeTabId: activeTabId } as unknown as Window;
}

/** Labels of every tab currently marked active. */
function activeLabels( win: Window ): string[] {
	return Array.from(
		win.element.querySelectorAll( '.os-window__tab--active' ),
	).map( ( el ) => el.textContent ?? '' );
}

describe( 'syncActiveTab', () => {
	test( 'exact URL match lights that tab', () => {
		const win = mockTabbedWindow( [
			[ 'Appearance', ADMIN + 'themes.php' ],
			[ 'Menus', ADMIN + 'nav-menus.php' ],
		] );

		syncActiveTab( win, ADMIN + 'nav-menus.php' );

		expect( activeLabels( win ) ).toEqual( [ 'Menus' ] );
	} );

	test( 'the chromeless flag never breaks the match', () => {
		const win = mockTabbedWindow( [
			[ 'Menus', ADMIN + 'nav-menus.php' ],
		] );

		syncActiveTab( win, ADMIN + 'nav-menus.php?openstation_chromeless=1' );

		expect( activeLabels( win ) ).toEqual( [ 'Menus' ] );
	} );

	test( 'sub-views of a tab keep it lit', () => {
		const win = mockTabbedWindow( [
			[ 'Appearance', ADMIN + 'themes.php' ],
			[ 'Widgets', ADMIN + 'widgets.php' ],
			[ 'Menus', ADMIN + 'nav-menus.php' ],
		] );

		// WP's own in-screen tabs on nav-menus.php.
		for ( const view of [
			'nav-menus.php?action=locations',
			'nav-menus.php?action=edit&menu=2',
			'nav-menus.php?menu=0&action=edit&_wpnonce=abc123',
		] ) {
			syncActiveTab( win, ADMIN + view );
			expect( activeLabels( win ) ).toEqual( [ 'Menus' ] );
		}
	} );

	test( 'pagination and feedback params keep a list tab lit', () => {
		const win = mockTabbedWindow( [
			[ 'All Posts', ADMIN + 'edit.php?post_type=post' ],
			[ 'Add Post', ADMIN + 'post-new.php?post_type=post' ],
		] );

		syncActiveTab( win, ADMIN + 'edit.php?post_type=post&paged=2&s=hello' );

		expect( activeLabels( win ) ).toEqual( [ 'All Posts' ] );
	} );

	test( 'navigating to post-new.php with or without post_type lights Add Post tab', () => {
		const win = mockTabbedWindow( [
			[ 'All Posts', ADMIN + 'edit.php' ],
			[ 'Add Post', ADMIN + 'post-new.php' ],
		] );

		syncActiveTab( win, ADMIN + 'post-new.php?post_type=post' );

		expect( activeLabels( win ) ).toEqual( [ 'Add Post' ] );
	} );

	test( 'identity params still separate sibling tabs', () => {
		const win = mockTabbedWindow( [
			[ 'Categories', ADMIN + 'edit-tags.php?taxonomy=category' ],
			[ 'Tags', ADMIN + 'edit-tags.php?taxonomy=post_tag' ],
		] );

		syncActiveTab(
			win,
			ADMIN + 'edit-tags.php?taxonomy=post_tag&paged=3',
		);

		expect( activeLabels( win ) ).toEqual( [ 'Tags' ] );
	} );

	test( 'sibling tabs separated only by `path` stay independent', () => {
		// The WooCommerce Analytics shape: every submenu entry shares
		// `page=wc-admin` and differs only in `path`. `path` is an
		// identity param, so these are distinct pages — a sub-view of
		// one must never light another.
		const wc = ADMIN + 'admin.php?page=wc-admin&path=';
		const win = mockTabbedWindow( [
			[ 'Overview', wc + '/analytics/overview' ],
			[ 'Products', wc + '/analytics/products' ],
			[ 'Revenue', wc + '/analytics/revenue' ],
		] );

		syncActiveTab( win, wc + '/analytics/products&period=month' );

		expect( activeLabels( win ) ).toEqual( [ 'Products' ] );
	} );

	test( 'the most specific matching tab wins', () => {
		// A plugin registering both a landing page and a deeper `tab=`
		// view as separate submenu entries.
		const win = mockTabbedWindow( [
			[ 'Mail', ADMIN + 'admin.php?page=mail' ],
			[ 'Email Test', ADMIN + 'admin.php?page=mail&tab=test' ],
		] );

		syncActiveTab( win, ADMIN + 'admin.php?page=mail&tab=test&retry=1' );

		expect( activeLabels( win ) ).toEqual( [ 'Email Test' ] );
	} );

	test( 'a tab never claims a URL that contradicts its own params', () => {
		const win = mockTabbedWindow( [
			[ 'Mail', ADMIN + 'admin.php?page=mail' ],
			[ 'Email Test', ADMIN + 'admin.php?page=mail&tab=test' ],
		] );

		// An unlisted `tab=` value belongs to the landing entry, not to
		// the Email Test entry.
		syncActiveTab( win, ADMIN + 'admin.php?page=mail&tab=logs' );

		expect( activeLabels( win ) ).toEqual( [ 'Mail' ] );
	} );

	test( 'a URL on no tab’s page keeps the current highlight', () => {
		const win = mockTabbedWindow( [
			[ 'Appearance', ADMIN + 'themes.php' ],
			[ 'Menus', ADMIN + 'nav-menus.php' ],
		] );

		// A fresh strip stays blank — there is nothing to keep.
		syncActiveTab( win, ADMIN + 'upload.php' );
		expect( activeLabels( win ) ).toEqual( [] );

		// A lit strip stays lit through an off-menu landing page.
		syncActiveTab( win, ADMIN + 'themes.php' );
		syncActiveTab( win, ADMIN + 'upload.php' );
		expect( activeLabels( win ) ).toEqual( [ 'Appearance' ] );
	} );

	test( 'a restored window on an off-menu plugin page lights its entry tab', () => {
		// After an F5 the window comes back parked on the redirect's
		// landing URL, with no optimistic click highlight to keep. An
		// `admin.php?page=…` URL off the menu is the owning plugin's
		// own onboarding surface, so the entry (first) tab lights.
		const win = mockTabbedWindow( [
			[ 'Home', ADMIN + 'admin.php?page=mailpoet-homepage' ],
			[ 'Emails', ADMIN + 'admin.php?page=mailpoet-newsletters' ],
		] );

		syncActiveTab(
			win,
			ADMIN + 'admin.php?page=mailpoet-landingpage&openstation_chromeless=1',
		);

		expect( activeLabels( win ) ).toEqual( [ 'Home' ] );
	} );

	test( 'an off-menu non-plugin page lights nothing', () => {
		// `post.php`, `revision.php`, … are genuinely outside every
		// tab — a blank strip is the honest answer there.
		const win = mockTabbedWindow( [
			[ 'Home', ADMIN + 'admin.php?page=mailpoet-homepage' ],
		] );

		syncActiveTab( win, ADMIN + 'post.php?post=5&action=edit' );

		expect( activeLabels( win ) ).toEqual( [] );
	} );

	test( 'an onboarding redirect keeps the clicked tab lit', () => {
		// The MailPoet shape: until its welcome wizard is done, every
		// MailPoet page redirects to `?page=mailpoet-landingpage`,
		// which no submenu entry lists. The tab the user clicked has
		// to survive the round trip.
		const win = mockTabbedWindow( [
			[ 'Home', ADMIN + 'admin.php?page=mailpoet-homepage' ],
			[ 'Emails', ADMIN + 'admin.php?page=mailpoet-newsletters' ],
		] );

		// Click "Emails" — lit optimistically before the load.
		syncActiveTab( win, ADMIN + 'admin.php?page=mailpoet-newsletters' );
		// The load event reports the redirect's landing URL.
		syncActiveTab(
			win,
			ADMIN + 'admin.php?page=mailpoet-landingpage&openstation_chromeless=1',
		);

		expect( activeLabels( win ) ).toEqual( [ 'Emails' ] );
	} );

	test( 'a foregrounded external tab clears every submenu tab', () => {
		const win = mockTabbedWindow(
			[ [ 'Menus', ADMIN + 'nav-menus.php' ] ],
			'ext-1',
		);

		syncActiveTab( win, ADMIN + 'nav-menus.php' );

		expect( activeLabels( win ) ).toEqual( [] );
	} );

	test( 'the site editor’s own route keeps the Editor tab lit', () => {
		// WordPress redirects `site-editor.php` to `…&p=/`, so the URL
		// the iframe lands on is never the URL the tab declares.
		const win = mockTabbedWindow( [
			[ 'Themes', ADMIN + 'themes.php' ],
			[ 'Add Theme', ADMIN + 'theme-install.php?browse=popular' ],
			[ 'Editor', ADMIN + 'site-editor.php' ],
		] );

		syncActiveTab(
			win,
			ADMIN + 'site-editor.php?openstation_chromeless=1&p=/',
		);
		expect( activeLabels( win ) ).toEqual( [ 'Editor' ] );

		syncActiveTab(
			win,
			ADMIN + 'site-editor.php?p=/wp_template/twentytwentyfive//home',
		);
		expect( activeLabels( win ) ).toEqual( [ 'Editor' ] );
	} );

	test( 'a clicked tab lights before the load reports back', () => {
		const win = mockTabbedWindow( [
			[ 'Add Theme', ADMIN + 'theme-install.php?browse=popular' ],
			[ 'Editor', ADMIN + 'site-editor.php' ],
		] );
		Object.assign( win as unknown as Record< string, unknown >, {
			iframe: document.createElement( 'iframe' ),
			_externalTabs: new Map(),
			markContentLoading: () => {},
		} );
		syncActiveTab( win, ADMIN + 'theme-install.php?browse=popular' );
		expect( activeLabels( win ) ).toEqual( [ 'Add Theme' ] );

		const editor = win.element.querySelectorAll( '.os-window__tab' )[ 1 ];
		handleTabStripClick( win, {
			target: editor,
			stopPropagation: () => {},
		} as unknown as Event );

		expect( activeLabels( win ) ).toEqual( [ 'Editor' ] );
	} );

	test( 'a page holding unsaved changes keeps its highlight and its spinner off', async () => {
		const win = mockTabbedWindow( [
			[ 'All Users', ADMIN + 'users.php' ],
			[ 'Add User', ADMIN + 'user-new.php' ],
			[ 'Profile', ADMIN + 'profile.php' ],
		] );
		const iframe = document.createElement( 'iframe' );
		const asked: { type?: string; requestId?: string }[] = [];
		Object.defineProperty( iframe, 'contentWindow', {
			value: {
				postMessage: ( m: unknown ) => {
					asked.push( m as { type?: string; requestId?: string } );
				},
			},
		} );
		const markContentLoading = vi.fn();
		Object.assign( win as unknown as Record< string, unknown >, {
			iframe,
			_externalTabs: new Map(),
			_iframeBridgeReady: true,
			_isDestroyed: false,
			_unsavedGuardPending: false,
			_deferredNavigationCommit: null,
			_deferNavigationCommit( commit: () => void ) {
				(
					win as unknown as Record< string, unknown >
				)._deferredNavigationCommit = commit;
			},
			markContentLoading,
		} );
		syncActiveTab( win, ADMIN + 'user-new.php' );
		expect( activeLabels( win ) ).toEqual( [ 'Add User' ] );

		const profile = win.element.querySelectorAll( '.os-window__tab' )[ 2 ];
		handleTabStripClick( win, {
			target: profile,
			stopPropagation: () => {},
		} as unknown as Event );

		// The frame is asked before anything is painted…
		await vi.waitFor( () => expect( asked ).toHaveLength( 1 ) );
		expect( asked[ 0 ].type ).toBe( 'os-bridge-beforeunload-query' );

		// …and answering "something is holding on" starts the
		// navigation without committing to it. The browser's own
		// prompt is now on screen; if the user cancels it, this is the
		// state the window is left in — the one it was already in.
		window.dispatchEvent(
			new MessageEvent( 'message', {
				data: {
					type: 'os-bridge-beforeunload-response',
					prevent: true,
					requestId: asked[ 0 ].requestId,
				},
				origin: window.location.origin,
			} ),
		);
		await vi.waitFor( () => expect( iframe.src ).toContain( 'profile.php' ) );

		expect( markContentLoading ).not.toHaveBeenCalled();
		expect( activeLabels( win ) ).toEqual( [ 'Add User' ] );

		// The user chose to leave after all: the frame reports a real
		// unload and the withheld paint lands.
		(
			win as unknown as { _deferredNavigationCommit: () => void }
		)._deferredNavigationCommit();

		expect( markContentLoading ).toHaveBeenCalledTimes( 1 );
		expect( activeLabels( win ) ).toEqual( [ 'Profile' ] );
	} );

	test( 'aria-selected tracks the active tab', () => {
		const win = mockTabbedWindow( [
			[ 'Appearance', ADMIN + 'themes.php' ],
			[ 'Menus', ADMIN + 'nav-menus.php' ],
		] );

		syncActiveTab( win, ADMIN + 'nav-menus.php?action=locations' );

		const selected = Array.from(
			win.element.querySelectorAll( '[aria-selected="true"]' ),
		).map( ( el ) => el.textContent );
		expect( selected ).toEqual( [ 'Menus' ] );
	} );
} );

/**
 * Build a bare strip with fixed scroll geometry. jsdom reports 0 for
 * every layout dimension, so the three properties `updateTabOverflow`
 * reads are defined outright — the function under test is the
 * arithmetic that turns them into an edge, not the layout engine.
 */
function mockStrip( {
	scrollWidth,
	clientWidth,
	scrollLeft,
	direction = 'ltr',
}: {
	scrollWidth: number;
	clientWidth: number;
	scrollLeft: number;
	direction?: 'ltr' | 'rtl';
} ): HTMLElement {
	const strip = document.createElement( 'nav' );
	strip.className = 'os-window__tabs';
	strip.style.direction = direction;
	Object.defineProperty( strip, 'scrollWidth', { value: scrollWidth } );
	Object.defineProperty( strip, 'clientWidth', { value: clientWidth } );
	Object.defineProperty( strip, 'scrollLeft', {
		value: scrollLeft,
		writable: true,
	} );
	document.body.appendChild( strip );
	return strip;
}

describe( 'updateTabOverflow', () => {
	test( 'a strip that fits carries no fade', () => {
		const strip = mockStrip( {
			scrollWidth: 400,
			clientWidth: 400,
			scrollLeft: 0,
		} );
		updateTabOverflow( strip );
		expect( strip.dataset.overflow ).toBeUndefined();
	} );

	test( 'scrolled hard left fades only the right edge', () => {
		const strip = mockStrip( {
			scrollWidth: 800,
			clientWidth: 400,
			scrollLeft: 0,
		} );
		updateTabOverflow( strip );
		expect( strip.dataset.overflow ).toBe( 'right' );
	} );

	test( 'scrolled hard right fades only the left edge', () => {
		const strip = mockStrip( {
			scrollWidth: 800,
			clientWidth: 400,
			scrollLeft: 400,
		} );
		updateTabOverflow( strip );
		expect( strip.dataset.overflow ).toBe( 'left' );
	} );

	test( 'scrolled mid-strip fades both edges', () => {
		const strip = mockStrip( {
			scrollWidth: 800,
			clientWidth: 400,
			scrollLeft: 200,
		} );
		updateTabOverflow( strip );
		expect( strip.dataset.overflow ).toBe( 'both' );
	} );

	test( 'sub-pixel shortfall at the end still counts as the end', () => {
		// A fractional clientWidth leaves scrollLeft a hair under its
		// maximum at the true end of the strip; without the epsilon
		// this paints a permanent "more this way" fade on the last tab.
		const strip = mockStrip( {
			scrollWidth: 800,
			clientWidth: 400,
			scrollLeft: 399.4,
		} );
		updateTabOverflow( strip );
		expect( strip.dataset.overflow ).toBe( 'left' );
	} );

	test( 'RTL at the inline start hides content on the left', () => {
		// RTL scrollLeft runs [ -max, 0 ]; at 0 the strip sits against
		// its right edge and everything hidden is to the left.
		const strip = mockStrip( {
			scrollWidth: 800,
			clientWidth: 400,
			scrollLeft: 0,
			direction: 'rtl',
		} );
		updateTabOverflow( strip );
		expect( strip.dataset.overflow ).toBe( 'left' );
	} );

	test( 'RTL at the inline end hides content on the right', () => {
		const strip = mockStrip( {
			scrollWidth: 800,
			clientWidth: 400,
			scrollLeft: -400,
			direction: 'rtl',
		} );
		updateTabOverflow( strip );
		expect( strip.dataset.overflow ).toBe( 'right' );
	} );

	test( 'a stale fade is cleared when the strip stops overflowing', () => {
		const strip = mockStrip( {
			scrollWidth: 400,
			clientWidth: 400,
			scrollLeft: 0,
		} );
		strip.dataset.overflow = 'both';
		updateTabOverflow( strip );
		expect( strip.dataset.overflow ).toBeUndefined();
	} );
} );

/**
 * The wiring, as opposed to the arithmetic above.
 *
 * `updateTabOverflow` is pure and easy to cover; `observeTabOverflow`
 * is where a regression hides, because it fails silently. A dropped
 * listener leaves a stale fade, and a teardown that misses an observer
 * keeps measuring a strip that is animating out of the document. Both
 * look fine in a screenshot.
 */
describe( 'observeTabOverflow', () => {
	let frames: Array< () => void >;
	let raf: typeof window.requestAnimationFrame;
	let caf: typeof window.cancelAnimationFrame;

	beforeEach( () => {
		frames = [];
		raf = window.requestAnimationFrame;
		caf = window.cancelAnimationFrame;
		// Hand-pumped frames — the real rAF never fires in jsdom, so the
		// scheduled measure would never run.
		window.requestAnimationFrame = ( ( cb: FrameRequestCallback ) => {
			frames.push( () => cb( 0 ) );
			return frames.length;
		} ) as typeof window.requestAnimationFrame;
		window.cancelAnimationFrame = ( () => {} ) as typeof window.cancelAnimationFrame;
	} );

	afterEach( () => {
		window.requestAnimationFrame = raf;
		window.cancelAnimationFrame = caf;
	} );

	/** Run every frame queued so far. */
	function flush(): void {
		const queued = frames;
		frames = [];
		for ( const run of queued ) {
			run();
		}
	}

	test( 'measures once on attach', () => {
		const strip = mockStrip( {
			scrollWidth: 800,
			clientWidth: 400,
			scrollLeft: 0,
		} );

		const stop = observeTabOverflow( strip );
		expect( strip.dataset.overflow ).toBeUndefined();

		flush();
		expect( strip.dataset.overflow ).toBe( 'right' );
		stop();
	} );

	test( 're-measures on scroll', () => {
		const strip = mockStrip( {
			scrollWidth: 800,
			clientWidth: 400,
			scrollLeft: 0,
		} );
		const stop = observeTabOverflow( strip );
		flush();

		( strip as unknown as { scrollLeft: number } ).scrollLeft = 400;
		strip.dispatchEvent( new Event( 'scroll' ) );
		flush();

		expect( strip.dataset.overflow ).toBe( 'left' );
		stop();
	} );

	test( 'coalesces a burst of scroll events into one measure', () => {
		const strip = mockStrip( {
			scrollWidth: 800,
			clientWidth: 400,
			scrollLeft: 0,
		} );
		const stop = observeTabOverflow( strip );
		flush();

		for ( let i = 0; i < 5; i++ ) {
			strip.dispatchEvent( new Event( 'scroll' ) );
		}

		expect( frames ).toHaveLength( 1 );
		stop();
	} );

	test( 'the teardown stops the scroll listener', () => {
		// `Window.close()` depends on this: the observers would
		// otherwise keep measuring a strip that has left the document.
		const strip = mockStrip( {
			scrollWidth: 800,
			clientWidth: 400,
			scrollLeft: 0,
		} );
		const stop = observeTabOverflow( strip );
		flush();

		stop();
		( strip as unknown as { scrollLeft: number } ).scrollLeft = 400;
		strip.dispatchEvent( new Event( 'scroll' ) );

		expect( frames ).toHaveLength( 0 );
		expect( strip.dataset.overflow ).toBe( 'right' );
	} );

	test( 'the teardown disconnects both observers', () => {
		const strip = mockStrip( {
			scrollWidth: 800,
			clientWidth: 400,
			scrollLeft: 0,
		} );
		const disconnects: string[] = [];
		const realRO = globalThis.ResizeObserver;
		const realMO = globalThis.MutationObserver;
		globalThis.ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {
				disconnects.push( 'resize' );
			}
		} as unknown as typeof ResizeObserver;
		globalThis.MutationObserver = class {
			observe() {}
			takeRecords() {
				return [];
			}
			disconnect() {
				disconnects.push( 'mutation' );
			}
		} as unknown as typeof MutationObserver;

		try {
			observeTabOverflow( strip )();
			expect( disconnects.sort() ).toEqual( [ 'mutation', 'resize' ] );
		} finally {
			globalThis.ResizeObserver = realRO;
			globalThis.MutationObserver = realMO;
		}
	} );

	test( 'survives an environment with no observers', () => {
		// jsdom without a shim, and older browsers. The strip keeps
		// whatever the initial measure decided rather than throwing.
		const strip = mockStrip( {
			scrollWidth: 800,
			clientWidth: 400,
			scrollLeft: 0,
		} );
		const realRO = globalThis.ResizeObserver;
		const realMO = globalThis.MutationObserver;
		// @ts-expect-error deliberately removing the globals
		delete globalThis.ResizeObserver;
		// @ts-expect-error deliberately removing the globals
		delete globalThis.MutationObserver;

		try {
			const stop = observeTabOverflow( strip );
			flush();
			expect( strip.dataset.overflow ).toBe( 'right' );
			expect( stop ).not.toThrow();
		} finally {
			globalThis.ResizeObserver = realRO;
			globalThis.MutationObserver = realMO;
		}
	} );
} );
