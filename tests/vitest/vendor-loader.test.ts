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

		await loadVendorScript( `${ BUNDLE }?ver=9.9.9` );

		expect( scriptCount( '/a.min.js' ) ).toBe( 1 );
	} );

	test( 'a different file is still injected', async () => {
		const enqueued = document.createElement( 'script' );
		enqueued.src = `${ BUNDLE }?ver=0.9.8`;
		document.head.appendChild( enqueued );

		const other =
			'http://example.test/wp-content/plugins/x/assets/js/b.min.js';

		void loadVendorScript( other );

		expect( scriptCount( '/b.min.js' ) ).toBe( 1 );
	} );

	test( 'the same path on a different origin is a different bundle', () => {

		const first = document.createElement( 'script' );
		first.src = 'http://cdn-one.test/dist/index.js?ver=1';
		document.head.appendChild( first );

		void loadVendorScript( 'http://cdn-two.test/dist/index.js' );

		expect( scriptCount( '/dist/index.js' ) ).toBe( 2 );

		expect( first.dataset.osVendor ).toBeUndefined();
	} );

	test( 'a protocol-relative URL resolves against the document', () => {

		const url =
			'http://example.test/wp-content/plugins/x/assets/js/d.min.js';
		const enqueued = document.createElement( 'script' );
		enqueued.src = '//example.test/wp-content/plugins/x/assets/js/d.min.js';
		document.head.appendChild( enqueued );

		void loadVendorScript( url );

		expect( scriptCount( '/d.min.js' ) ).toBe( 1 );
	} );

	test( 'the adopted tag is marked so re-entry short-circuits', async () => {

		const url =
			'http://example.test/wp-content/plugins/x/assets/js/c.min.js';
		const enqueued = document.createElement( 'script' );
		enqueued.src = `${ url }?ver=0.9.8`;
		document.head.appendChild( enqueued );

		await loadVendorScript( url );

		expect( scriptCount( '/c.min.js' ) ).toBe( 1 );

		expect( enqueued.dataset.osVendor ).toBe( url );
		expect( enqueued.dataset.loaded ).toBe( '1' );
	} );
} );

describe( 'loadVendorScript — alias dependencies', () => {
	beforeEach( () => {
		document.head.innerHTML = '';
		document.body.innerHTML = '';
	} );

	afterEach( () => {
		document.head.innerHTML = '';
		document.body.innerHTML = '';
	} );

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

		expect( inlineTags() ).toEqual( [
			'var xL10n={};',
			'window.xConfig={a:1};',
			'window.xConfigReady=true;',
		] );
		expect( scriptCount( '/alias-a.js' ) ).toBe( 1 );

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
