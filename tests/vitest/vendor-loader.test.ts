/**
 * The lazy vendor-script loader, and the one thing it must never do:
 * inject a second copy of a file the page already has.
 *
 * A bundle evaluated twice registers every `addAction` / `addFilter`
 * twice, and `@wordpress/hooks` appends rather than replaces on a
 * repeated namespace — so every subscriber runs twice. The symptom is
 * duplicated UI (two identical panels stacked in a folder, two badges
 * on one tile) and nothing about it points at script loading, which is
 * what made it expensive to find.
 *
 * It happens the moment a plugin names an already-enqueued handle as
 * its native window's `script` — a normal thing to do, and how the
 * WooCommerce Customer window is wired.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { loadVendorScript } from '../../src/wallpapers/vendor-loader';

const BUNDLE = 'http://example.test/wp-content/plugins/x/assets/js/a.min.js';

function scriptCount( pathFragment: string ): number {
	return Array.from(
		document.querySelectorAll< HTMLScriptElement >( 'script[src]' ),
	).filter( ( s ) => s.src.includes( pathFragment ) ).length;
}

describe( 'loadVendorScript — no double injection', () => {
	beforeEach( () => {
		document.head.innerHTML = '';
		document.body.innerHTML = '';
	} );

	afterEach( () => {
		document.head.innerHTML = '';
		document.body.innerHTML = '';
	} );

	test( 'a page-enqueued script is not injected again', async () => {
		// What `wp_enqueue_script()` prints: a plain tag with a `ver`
		// query and no `data-os-vendor` marker.
		const enqueued = document.createElement( 'script' );
		enqueued.src = `${ BUNDLE }?ver=0.9.8`;
		document.head.appendChild( enqueued );

		await loadVendorScript( BUNDLE );

		expect( scriptCount( '/a.min.js' ) ).toBe( 1 );
	} );

	test( 'the query string is not part of the identity', async () => {
		const enqueued = document.createElement( 'script' );
		enqueued.src = `${ BUNDLE }?ver=1.2.3`;
		document.head.appendChild( enqueued );

		// Same file, different `ver` — within one document that is the
		// same bundle, and loading it again would evaluate it again.
		await loadVendorScript( `${ BUNDLE }?ver=9.9.9` );

		expect( scriptCount( '/a.min.js' ) ).toBe( 1 );
	} );

	test( 'a different file is still injected', async () => {
		const enqueued = document.createElement( 'script' );
		enqueued.src = `${ BUNDLE }?ver=0.9.8`;
		document.head.appendChild( enqueued );

		const other =
			'http://example.test/wp-content/plugins/x/assets/js/b.min.js';
		// Not awaited: nothing fires `load` in jsdom for an injected
		// src, and the assertion is about the tag existing.
		void loadVendorScript( other );

		expect( scriptCount( '/b.min.js' ) ).toBe( 1 );
	} );

	test( 'the adopted tag is marked so re-entry short-circuits', async () => {
		// Its own URL: the loader memoizes resolved loads by URL for
		// the life of the module, so reusing another test's URL would
		// return that promise and never reach the adoption path.
		const url =
			'http://example.test/wp-content/plugins/x/assets/js/c.min.js';
		const enqueued = document.createElement( 'script' );
		enqueued.src = `${ url }?ver=0.9.8`;
		document.head.appendChild( enqueued );

		await loadVendorScript( url );

		expect( scriptCount( '/c.min.js' ) ).toBe( 1 );
		// Adopted, so the cheap `data-os-vendor` fast path catches it
		// next time instead of re-walking every script tag.
		expect( enqueued.dataset.osVendor ).toBe( url );
		expect( enqueued.dataset.loaded ).toBe( '1' );
	} );
} );
