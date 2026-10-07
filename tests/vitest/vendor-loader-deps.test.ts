import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadVendorScript } from '../../src/wallpapers/vendor-loader';

let appended: string[];

beforeEach( () => {
	appended = [];
	document.head.innerHTML = '';

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

		expect( appended ).toEqual( [
			'/wp-includes/js/dist/api-fetch.min.js',
			'/widget-three.js',
		] );
	} );

	it( 'skips a concatenated handle passed as the bundle itself', async () => {

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

		await expect(
			loadVendorScript( 'https://site.test/memo.js', {
				deps: [ { url: 'https://site.test/dep.js' } ],
			} ),
		).resolves.toBeUndefined();

		expect( appended ).toEqual( [ '/dep.js', '/memo.js' ] );
	} );
} );
