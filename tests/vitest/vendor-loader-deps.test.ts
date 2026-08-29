/**
 * A lazily-delivered bundle gets its declared packages first.
 *
 * WordPress resolves a script's dependencies when it ENQUEUES it, so a
 * normally-printed bundle finds its packages already on the page. A
 * handle delivered only through this loader never goes through that:
 * one URL was injected and nothing else, so a widget declaring
 * `wp-api-fetch` found `wp.apiFetch` undefined at mount.
 *
 * It used to work by accident — Core's ⌘K palette put the whole
 * Gutenberg runtime on every admin page until it was deferred. See
 * `docs/migration-wp-package-globals.md`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadVendorScript } from '../../src/wallpapers/vendor-loader';

/** Injected script tags, in the order the loader appended them. */
let appended: string[];

beforeEach( () => {
	appended = [];
	document.head.innerHTML = '';
	// Resolve every injected script on the next tick, as a real
	// `load` event would.
	vi.spyOn( document.head, 'appendChild' ).mockImplementation( ( node ) => {
		const el = node as HTMLScriptElement;
		if ( el.tagName === 'SCRIPT' && el.src ) {
			appended.push( new URL( el.src, 'https://site.test' ).pathname );
			queueMicrotask( () => el.dispatchEvent( new Event( 'load' ) ) );
		}
		return node;
	} );
} );

afterEach( () => {
	vi.restoreAllMocks();
} );

describe( 'loadVendorScript — dependency closure', () => {
	it( 'loads declared packages before the bundle, in order', async () => {
		await loadVendorScript( 'https://site.test/widget.js', {
			deps: [
				{ url: 'https://site.test/wp-includes/js/dist/hooks.js' },
				{ url: 'https://site.test/wp-includes/js/dist/i18n.js' },
				{ url: 'https://site.test/wp-includes/js/dist/api-fetch.js' },
			],
		} );

		expect( appended ).toEqual( [
			'/wp-includes/js/dist/hooks.js',
			'/wp-includes/js/dist/i18n.js',
			'/wp-includes/js/dist/api-fetch.js',
			'/widget.js',
		] );
	} );

	it( 'skips a package the page already carries', async () => {
		// The page printed api-fetch itself; re-injecting would
		// evaluate it twice, and re-running a package wipes what was
		// registered against the first copy.
		const existing = document.createElement( 'script' );
		existing.src = 'https://site.test/wp-includes/js/dist/api-fetch.js?ver=6.9';
		document.head.append( existing );
		appended = [];

		await loadVendorScript( 'https://site.test/widget-two.js', {
			deps: [ { url: 'https://site.test/wp-includes/js/dist/api-fetch.js' } ],
		} );

		expect( appended ).toEqual( [ '/widget-two.js' ] );
	} );

	it( 'skips a package Core concatenated into load-scripts.php', async () => {
		// The wp-admin default. `wp-hooks` is in the tab, inside the
		// concat blob, with no tag carrying its path — so the loader
		// has to recognize it by handle. Appending it again assigns a
		// fresh registry to `window.wp.hooks` and every subscriber
		// registered at boot stops hearing its own events.
		const blob = document.createElement( 'script' );
		blob.src =
			'https://site.test/wp-admin/load-scripts.php?c=1&load%5Bchunk_0%5D=wp-hooks,wp-i18n,jquery-core&ver=6.9';
		document.head.append( blob );
		appended = [];

		await loadVendorScript( 'https://site.test/widget-three.js', {
			deps: [
				{
					handle: 'wp-hooks',
					url: 'https://site.test/wp-includes/js/dist/hooks.min.js',
				},
				{
					handle: 'wp-api-fetch',
					url: 'https://site.test/wp-includes/js/dist/api-fetch.min.js',
				},
			],
		} );

		// api-fetch is genuinely absent and still loads; only the
		// concatenated one is skipped.
		expect( appended ).toEqual( [
			'/wp-includes/js/dist/api-fetch.min.js',
			'/widget-three.js',
		] );
	} );

	it( 'skips a concatenated handle passed as the bundle itself', async () => {
		// The command-palette replay walks a manifest of Core handles
		// as top-level loads rather than as anyone's dependencies. A
		// handle of its own, so the URL memo from the case above
		// cannot be what makes this pass.
		const blob = document.createElement( 'script' );
		blob.src =
			'https://site.test/wp-admin/load-scripts.php?c=1&load%5Bchunk_0%5D=wp-dom-ready&ver=6.9';
		document.head.append( blob );
		appended = [];

		await loadVendorScript(
			'https://site.test/wp-includes/js/dist/dom-ready.min.js',
			{ handle: 'wp-dom-ready' },
		);

		expect( appended ).toEqual( [] );
	} );

	it( 'is a no-op for a bundle that declares nothing', async () => {
		await loadVendorScript( 'https://site.test/plain.js' );

		expect( appended ).toEqual( [ '/plain.js' ] );
	} );

	it( 'does not deadlock on its own memo', async () => {
		// The dependency walk stores its promise under the bundle's own
		// URL before loading it. Re-entering `loadVendorScript` for that
		// URL would await the promise being constructed.
		await expect(
			loadVendorScript( 'https://site.test/memo.js', {
				deps: [ { url: 'https://site.test/dep.js' } ],
			} ),
		).resolves.toBeUndefined();

		expect( appended ).toEqual( [ '/dep.js', '/memo.js' ] );
	} );
} );
