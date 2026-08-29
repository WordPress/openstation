/**
 * What the document has already run — including what Core hid.
 *
 * WordPress concatenates every script below `wp-includes/js/` and
 * `wp-admin/js/` into a single `load-scripts.php` response, and does
 * so by default in wp-admin. The packages inside it have no
 * `<script src>` of their own, so a path-only presence test says
 * "not here" for `wp-hooks` on a stock admin screen, the lazy loader
 * appends it, and re-running it replaces `window.wp.hooks` — every
 * subscriber registered at boot goes deaf while the actions keep
 * firing on the new registry.
 *
 * The blob names its handles in its own query string. These pin that
 * we read them back the way `wp-admin/load-scripts.php` does.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
	concatenatedScriptHandles,
	findScriptByPath,
	isScriptInDocument,
} from '../../src/script-presence';

/** Append a `<script src>` exactly as the document would carry it. */
function printScript( src: string ): void {
	const tag = document.createElement( 'script' );
	tag.src = src;
	document.head.append( tag );
}

/**
 * The concat blob `_print_scripts()` emits: the comma-joined handle
 * list, cut into `chunk_N` query params every 128 characters.
 */
function printConcatBlob( handles: string[] ): void {
	const list = handles.join( ',' );
	const chunks = list.match( /.{1,128}/g ) ?? [];
	const query = chunks
		.map( ( chunk, index ) => `&load%5Bchunk_${ index }%5D=${ chunk }` )
		.join( '' );
	printScript(
		`https://site.test/wp-admin/load-scripts.php?c=1${ query }&ver=6.9`,
	);
}

beforeEach( () => {
	document.head.innerHTML = '';
} );

describe( 'concatenatedScriptHandles', () => {
	it( 'reads the handles out of a load-scripts.php blob', () => {
		printConcatBlob( [ 'wp-hooks', 'wp-i18n', 'jquery-core' ] );

		expect( concatenatedScriptHandles() ).toEqual(
			new Set( [ 'wp-hooks', 'wp-i18n', 'jquery-core' ] ),
		);
	} );

	it( 'joins the chunks before splitting on commas', () => {
		// `_print_scripts()` cuts the list every 128 characters with
		// no regard for handle boundaries, so a name routinely spans
		// two chunks. Splitting each chunk on its own would yield
		// `wp-ho` and `oks` and match nothing.
		const handles = [
			...Array.from( { length: 12 }, ( _, i ) => `filler-handle-${ i }` ),
			'wp-hooks',
			'wp-i18n',
		];
		printConcatBlob( handles );

		expect( concatenatedScriptHandles() ).toEqual( new Set( handles ) );
	} );

	it( 'orders chunks numerically, not lexicographically', () => {
		// Past `chunk_9` a string sort interleaves `chunk_10` between
		// `chunk_1` and `chunk_2`, which rejoins the list in the wrong
		// order and mangles the names at every seam. The comma count
		// survives either way, so only the names themselves show it.
		const handles = Array.from(
			{ length: 90 },
			( _, i ) => `some-plugin-handle-${ i }`,
		);
		printConcatBlob( handles );

		expect( concatenatedScriptHandles() ).toEqual( new Set( handles ) );
	} );

	it( 'ignores the stylesheet loader', () => {
		printScript(
			'https://site.test/wp-admin/load-styles.php?c=1&load%5Bchunk_0%5D=common,forms&ver=6.9',
		);

		expect( concatenatedScriptHandles().size ).toBe( 0 );
	} );

	it( 'is empty on a SCRIPT_DEBUG page, where nothing is concatenated', () => {
		printScript( 'https://site.test/wp-includes/js/dist/hooks.js?ver=6.9' );

		expect( concatenatedScriptHandles().size ).toBe( 0 );
	} );
} );

describe( 'isScriptInDocument', () => {
	it( 'matches a standalone tag by origin and path', () => {
		printScript(
			'https://site.test/wp-includes/js/dist/api-fetch.min.js?ver=6.9',
		);

		expect(
			isScriptInDocument( {
				url: 'https://site.test/wp-includes/js/dist/api-fetch.min.js',
				handle: 'wp-api-fetch',
			} ),
		).toBe( true );
	} );

	it( 'matches a concatenated package by handle', () => {
		// The reported break: nothing in the DOM has this path, and
		// the package is in the tab all the same.
		printConcatBlob( [ 'wp-hooks', 'wp-i18n' ] );

		expect(
			findScriptByPath(
				'https://site.test/wp-includes/js/dist/hooks.min.js',
			),
		).toBeNull();
		expect(
			isScriptInDocument( {
				url: 'https://site.test/wp-includes/js/dist/hooks.min.js',
				handle: 'wp-hooks',
			} ),
		).toBe( true );
	} );

	it( 'says no for a package the page never printed', () => {
		printConcatBlob( [ 'wp-hooks', 'wp-i18n' ] );

		expect(
			isScriptInDocument( {
				url: 'https://site.test/wp-includes/js/dist/data.min.js',
				handle: 'wp-data',
			} ),
		).toBe( false );
	} );

	it( 'says no for a ref carrying no evidence at all', () => {
		printConcatBlob( [ 'wp-hooks' ] );

		expect( isScriptInDocument( {} ) ).toBe( false );
	} );

	it( 'still answers from the URL alone when no handle is known', () => {
		printScript( 'https://site.test/wp-content/plugins/acme/widget.js' );

		expect(
			isScriptInDocument( {
				url: 'https://site.test/wp-content/plugins/acme/widget.js?ver=2',
			} ),
		).toBe( true );
	} );

	it( 'keeps origin part of the identity', () => {
		printScript( 'https://cdn.test/dist/index.js' );

		expect(
			isScriptInDocument( { url: 'https://site.test/dist/index.js' } ),
		).toBe( false );
	} );

	it( 'sees a blob printed after the first query', () => {
		expect( isScriptInDocument( { handle: 'wp-hooks' } ) ).toBe( false );

		printConcatBlob( [ 'wp-hooks' ] );

		expect( isScriptInDocument( { handle: 'wp-hooks' } ) ).toBe( true );
	} );
} );
