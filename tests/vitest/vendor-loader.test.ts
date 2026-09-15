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

	test( 'the same path on a different origin is a different bundle', () => {
		// `loadVendorScript` is public API and vendor bundles have
		// generic paths — two CDNs both serving `/dist/index.js` is
		// not a hypothetical. Matching on pathname alone would adopt
		// the first as the second and never load it.
		const first = document.createElement( 'script' );
		first.src = 'http://cdn-one.test/dist/index.js?ver=1';
		document.head.appendChild( first );

		void loadVendorScript( 'http://cdn-two.test/dist/index.js' );

		expect( scriptCount( '/dist/index.js' ) ).toBe( 2 );
		// The pre-existing tag belongs to the other origin and must
		// not have been adopted as ours.
		expect( first.dataset.osVendor ).toBeUndefined();
	} );

	test( 'a protocol-relative URL resolves against the document', () => {
		// `//example.test/…` is same-origin here, so it IS the same
		// bundle — origin matching must resolve, not string-compare.
		const url =
			'http://example.test/wp-content/plugins/x/assets/js/d.min.js';
		const enqueued = document.createElement( 'script' );
		enqueued.src = '//example.test/wp-content/plugins/x/assets/js/d.min.js';
		document.head.appendChild( enqueued );

		void loadVendorScript( url );

		expect( scriptCount( '/d.min.js' ) ).toBe( 1 );
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

/**
 * A src-less alias dependency — `wp_register_script( $h, false )` plus
 * `wp_add_inline_script()`, the shape a plugin's config blob commonly
 * takes — has nothing to fetch. Its inline data is what the bundle
 * declaring it needs, and it must run once: not never (the AllTerrain
 * Forms builder opened after a live activation with no
 * `window.allTerrainForms`), and not once per bundle that declares it.
 */
describe( 'loadVendorScript — alias dependencies', () => {
	beforeEach( () => {
		document.head.innerHTML = '';
		document.body.innerHTML = '';
	} );

	afterEach( () => {
		document.head.innerHTML = '';
		document.body.innerHTML = '';
	} );

	/**
	 * The dependency walk is a promise chain — each dependency waits
	 * for the one before it — so even an alias's synchronous replay
	 * lands a task later. Nothing fires `load` in jsdom for an
	 * injected src, so the returned promise itself never settles here.
	 */
	const flush = () => new Promise( ( r ) => setTimeout( r, 0 ) );

	function inlineTags(): string[] {
		return Array.from(
			document.querySelectorAll< HTMLScriptElement >(
				'script[data-os-vendor-inline]',
			),
		).map( ( tag ) => tag.textContent ?? '' );
	}

	test( 'replays an alias dependency in print order, with nothing fetched', async () => {
		const url = 'http://example.test/wp-content/plugins/x/assets/js/alias-a.js';
		void loadVendorScript( url, {
			deps: [
				{
					handle: 'x-config',
					url: '',
					l10n: [ 'var xL10n={};' ],
					before: [ 'window.xConfig={a:1};' ],
					after: [ 'window.xConfigReady=true;' ],
				},
			],
		} );
		await flush();

		// The alias's data precedes the bundle tag, in print order.
		expect( inlineTags() ).toEqual( [
			'var xL10n={};',
			'window.xConfig={a:1};',
			'window.xConfigReady=true;',
		] );
		expect( scriptCount( '/alias-a.js' ) ).toBe( 1 );
		// No `<script src>` was appended for the alias itself.
		expect( scriptCount( 'x-config' ) ).toBe( 0 );
	} );

	test( 'an alias is replayed once however many bundles declare it', async () => {
		const alias = {
			handle: 'x-shared-config',
			url: '',
			before: [ 'window.xShared=1;' ],
		};
		void loadVendorScript(
			'http://example.test/wp-content/plugins/x/assets/js/alias-b.js',
			{ deps: [ alias ] },
		);
		void loadVendorScript(
			'http://example.test/wp-content/plugins/x/assets/js/alias-c.js',
			{ deps: [ alias ] },
		);
		await flush();

		expect( inlineTags().filter( ( c ) => c === 'window.xShared=1;' ) ).toHaveLength(
			1,
		);
	} );

	test( 'an alias Core already printed is not replayed', async () => {
		// What `wp_print_scripts()` left behind for the alias at boot.
		const printed = document.createElement( 'script' );
		printed.id = 'x-boot-config-js-before';
		printed.textContent = 'window.xBoot={};';
		document.head.appendChild( printed );

		void loadVendorScript(
			'http://example.test/wp-content/plugins/x/assets/js/alias-d.js',
			{
				deps: [
					{ handle: 'x-boot-config', url: '', before: [ 'window.xBoot={};' ] },
				],
			},
		);
		await flush();

		expect( inlineTags() ).toEqual( [] );
		expect( scriptCount( '/alias-d.js' ) ).toBe( 1 );
	} );
} );
