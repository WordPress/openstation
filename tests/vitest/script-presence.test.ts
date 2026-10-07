import { beforeEach, describe, expect, it } from 'vitest';
import {
	concatenatedScriptHandles,
	findScriptByPath,
	isScriptInDocument,
	printedScriptHandleInDocument,
} from '../../src/script-presence';

function printScript( src: string ): void {
	const tag = document.createElement( 'script' );
	tag.src = src;
	document.head.append( tag );
}

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

		const handles = [
			...Array.from( { length: 12 }, ( _, i ) => `filler-handle-${ i }` ),
			'wp-hooks',
			'wp-i18n',
		];
		printConcatBlob( handles );

		expect( concatenatedScriptHandles() ).toEqual( new Set( handles ) );
	} );

	it( 'orders chunks numerically, not lexicographically', () => {

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

describe( 'printedScriptHandleInDocument', () => {

	function printInline( id: string, code: string ): void {
		const tag = document.createElement( 'script' );
		tag.id = id;
		tag.textContent = code;
		document.head.append( tag );
	}

	it( 'sees an alias handle through the inline tag Core printed for it', () => {

		printInline( 'acme-config-js-before', 'window.acmeConfig={};' );

		expect( printedScriptHandleInDocument( 'acme-config' ) ).toBe( true );
		expect( isScriptInDocument( { handle: 'acme-config', url: '' } ) ).toBe(
			true,
		);
	} );

	it( 'sees a file handle through the id on its own tag', () => {
		const tag = document.createElement( 'script' );
		tag.id = 'acme-widget-js';
		tag.src = 'https://site.test/wp-content/plugins/acme/widget.js?ver=1';
		document.head.append( tag );

		expect( printedScriptHandleInDocument( 'acme-widget' ) ).toBe( true );
	} );

	it( 'accepts every inline position Core stamps', () => {
		for ( const suffix of [ '-js-after', '-js-extra', '-js-translations' ] ) {
			document.head.innerHTML = '';
			printInline( `acme${ suffix }`, '1;' );
			expect( printedScriptHandleInDocument( 'acme' ) ).toBe( true );
		}
	} );

	it( 'says no for a handle nothing was printed under', () => {
		printInline( 'other-js-before', '1;' );

		expect( printedScriptHandleInDocument( 'acme-config' ) ).toBe( false );
		expect( isScriptInDocument( { handle: 'acme-config' } ) ).toBe( false );
	} );

	it( 'ignores a non-script element that happens to carry the id', () => {
		const div = document.createElement( 'div' );
		div.id = 'acme-js';
		document.body.append( div );

		expect( printedScriptHandleInDocument( 'acme' ) ).toBe( false );
		div.remove();
	} );
} );
