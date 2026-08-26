/**
 * Tests for the service worker's admin-asset-cache policy
 * (`src/pwa/sw-policy.ts`).
 *
 * The policy is the correctness boundary of the shared asset cache:
 * a URL classified too eagerly caches something dynamic (nonce drift,
 * stale uploads); one classified too shyly just forfeits the speedup.
 * These tests pin the classification matrix, the own-plugin
 * precedence, and the response-hygiene rules so a future edit that
 * loosens any of them fails loudly.
 */

import { describe, expect, it } from 'vitest';

import {
	classifyAdminAssetRequest,
	isCacheableResponse,
	readSwConfig,
} from '../../src/pwa/sw-policy';

const OWN = '/wp-content/plugins/desktop-mode/';

function classify( url: string ) {
	return classifyAdminAssetRequest( new URL( url ), OWN );
}

describe( 'classifyAdminAssetRequest', () => {
	it( 'classifies the concat loader endpoints cache-first', () => {
		expect(
			classify(
				'https://site.test/wp-admin/load-scripts.php?c=1&load%5Bchunk_0%5D=jquery-core,jquery-migrate,utils&ver=6.7.1',
			),
		).toBe( 'core-cache-first' );
		expect(
			classify(
				'https://site.test/wp-admin/load-styles.php?c=1&dir=ltr&load%5Bchunk_0%5D=dashicons,admin-bar,common&ver=6.7.1',
			),
		).toBe( 'core-cache-first' );
	} );

	it( 'requires ver on the loader endpoints', () => {
		expect(
			classify( 'https://site.test/wp-admin/load-scripts.php?load%5B%5D=jquery-core' ),
		).toBe( 'bypass' );
	} );

	it( 'classifies versioned core statics cache-first', () => {
		expect(
			classify( 'https://site.test/wp-admin/css/forms.min.css?ver=6.7.1' ),
		).toBe( 'core-cache-first' );
		expect(
			classify(
				'https://site.test/wp-includes/js/dist/i18n.min.js?ver=5e580eb46a90c2b997e6',
			),
		).toBe( 'core-cache-first' );
	} );

	it( 'matches subdirectory installs (path includes, not startsWith)', () => {
		expect(
			classify( 'https://site.test/site2/wp-admin/css/forms.min.css?ver=6.7.1' ),
		).toBe( 'core-cache-first' );
		expect(
			classify( 'https://site.test/wp/wp-includes/css/buttons.min.css?ver=6.7.1' ),
		).toBe( 'core-cache-first' );
	} );

	it( 'classifies RTL variants like their LTR siblings', () => {
		expect(
			classify( 'https://site.test/wp-admin/css/common-rtl.min.css?ver=6.7.1' ),
		).toBe( 'core-cache-first' );
	} );

	it( 'classifies versioned plugin/theme assets stale-while-revalidate', () => {
		expect(
			classify(
				'https://site.test/wp-content/plugins/woocommerce/assets/css/admin.css?ver=9.5.1',
			),
		).toBe( 'content-swr' );
		expect(
			classify(
				'https://site.test/wp-content/themes/twentytwentyfive/style.css?ver=1.0',
			),
		).toBe( 'content-swr' );
	} );

	it( 'keeps own-plugin precedence — never reclassified', () => {
		// Own assets must stay with the pre-existing precache /
		// network-first / SWR branches in sw.ts, versioned or not.
		expect(
			classify( `https://site.test${ OWN }assets/css/desktop.css?ver=123` ),
		).toBe( 'own-plugin' );
		expect(
			classify( `https://site.test${ OWN }assets/js/desktop.min.js` ),
		).toBe( 'own-plugin' );
	} );

	it( 'bypasses dynamic admin endpoints', () => {
		expect(
			classify( 'https://site.test/wp-admin/admin-ajax.php?action=heartbeat' ),
		).toBe( 'bypass' );
		expect( classify( 'https://site.test/wp-admin/edit.php?ver=1' ) ).toBe(
			'bypass',
		);
	} );

	it( 'bypasses uploads even when versioned', () => {
		expect(
			classify(
				'https://site.test/wp-content/uploads/2026/08/photo-150x150.jpg?ver=1',
			),
		).toBe( 'bypass' );
	} );

	it( 'bypasses unversioned static URLs — no immutability contract', () => {
		expect(
			classify( 'https://site.test/wp-admin/css/forms.min.css' ),
		).toBe( 'bypass' );
		expect(
			classify(
				'https://site.test/wp-content/plugins/woocommerce/assets/css/admin.css',
			),
		).toBe( 'bypass' );
	} );

	it( 'bypasses front-end and unrelated paths', () => {
		expect( classify( 'https://site.test/some/page.css?ver=1' ) ).toBe(
			'bypass',
		);
	} );
} );

describe( 'isCacheableResponse', () => {
	it( 'accepts a plain 200', () => {
		expect( isCacheableResponse( 200, 'basic', false, null ) ).toBe( true );
		expect(
			isCacheableResponse( 200, 'basic', false, 'public, max-age=31536000' ),
		).toBe( true );
	} );

	it( 'rejects partial content and redirects', () => {
		expect( isCacheableResponse( 206, 'basic', false, null ) ).toBe( false );
		expect( isCacheableResponse( 200, 'basic', true, null ) ).toBe( false );
		expect( isCacheableResponse( 304, 'basic', false, null ) ).toBe( false );
	} );

	it( 'rejects opaque and error types', () => {
		expect( isCacheableResponse( 200, 'opaque', false, null ) ).toBe( false );
		expect( isCacheableResponse( 200, 'error', false, null ) ).toBe( false );
	} );

	it( 'honours no-store and private', () => {
		expect(
			isCacheableResponse( 200, 'basic', false, 'no-store' ),
		).toBe( false );
		expect(
			isCacheableResponse( 200, 'basic', false, 'Private, max-age=0' ),
		).toBe( false );
	} );
} );

describe( 'readSwConfig', () => {
	const FALLBACK = 'https://site.test/wp-content/plugins/desktop-mode/';

	it( 'defaults to off + fallback URL on a missing preamble', () => {
		expect( readSwConfig( undefined, FALLBACK ) ).toEqual( {
			adminAssetCache: false,
			windowPrewarm: false,
			pluginUrl: FALLBACK,
		} );
		expect( readSwConfig( 'garbage', FALLBACK ).adminAssetCache ).toBe(
			false,
		);
	} );

	it( 'only enables on a literal true', () => {
		expect(
			readSwConfig( { adminAssetCache: true }, FALLBACK ).adminAssetCache,
		).toBe( true );
		expect(
			readSwConfig( { adminAssetCache: '1' }, FALLBACK ).adminAssetCache,
		).toBe( false );
	} );

	it( 'reads the hover-prewarm flag independently of the cache flag', () => {
		const cfg = readSwConfig(
			{ adminAssetCache: false, windowPrewarm: true },
			FALLBACK,
		);
		expect( cfg.windowPrewarm ).toBe( true );
		expect( cfg.adminAssetCache ).toBe( false );
		expect(
			readSwConfig( { windowPrewarm: 1 }, FALLBACK ).windowPrewarm,
		).toBe( false );
	} );

	it( 'accepts a valid pluginUrl and normalises the trailing slash', () => {
		expect(
			readSwConfig(
				{ pluginUrl: 'https://example.org/app/plugins/desktop-mode' },
				FALLBACK,
			).pluginUrl,
		).toBe( 'https://example.org/app/plugins/desktop-mode/' );
	} );

	it( 'keeps the fallback on a non-URL pluginUrl', () => {
		expect(
			readSwConfig( { pluginUrl: '/relative/only/' }, FALLBACK ).pluginUrl,
		).toBe( FALLBACK );
	} );
} );
