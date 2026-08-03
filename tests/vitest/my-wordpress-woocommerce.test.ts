/**
 * The WooCommerce integration bundle.
 *
 * Exercises the module itself rather than the generic hook contracts
 * it rides on: band resolution from the server-shipped config, the
 * stock ribbon and its survival across a tile repaint, and the panel's
 * behaviour when the summary payload is missing or malformed — which a
 * plugin filtering `openstation_my_wordpress_woo_summary` can cause.
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import { applyFilters, doAction } from '../../src/hooks';

const PRODUCTS = 'cpt-product';

interface WooGlobal {
	openStationWooConfig?: Record< string, unknown >;
}

function setConfig( extra: Record< string, unknown > = {} ): void {
	( window as unknown as WooGlobal ).openStationWooConfig = {
		restRoot: 'http://example.test/wp-json/desktop-mode/v1/woocommerce/',
		restNonce: 'nonce',
		canOrders: true,
		productBands: [
			{
				id: 'stock:outofstock',
				label: 'Out of stock',
				order: 10,
				tone: 'danger',
				count: 2,
			},
			{ id: 'cat:apparel', label: 'Apparel', order: 110, count: 5 },
		],
		couponBands: [
			{ id: 'coupon:active', label: 'Active', order: 10, count: 1 },
		],
		...extra,
	};
}

/** A product list row carrying the server-decided band + stock facts. */
function productRow( facts: Record< string, unknown > ) {
	return { id: 7, openstation_woo: facts };
}

function stubSummary( body: unknown, status = 200 ): void {
	vi.stubGlobal(
		'fetch',
		vi.fn( () =>
			Promise.resolve(
				new Response( JSON.stringify( body ), {
					status,
					headers: { 'Content-Type': 'application/json' },
				} ),
			),
		),
	);
}

/** Fire the tile-decoration action the bundle subscribes to. */
function decorate( item: Record< string, unknown > ): HTMLElement {
	const tile = document.createElement( 'div' );
	document.body.appendChild( tile );
	doAction( 'os.my-wordpress.list-tile', {
		tile,
		entityId: PRODUCTS,
		kind: 'post',
		item,
	} );
	return tile;
}

describe( 'my-wordpress — WooCommerce integration', () => {
	// Installed once, not per test: Vitest caches the side-effect
	// import, so the bundle's `addAction`/`addFilter` calls run exactly
	// once for the whole file. Clearing the bus between tests would
	// strand every test after the first without any subscribers.
	beforeAll( async () => {
		installHooksStub();
		setConfig();
		stubSummary( {} );
		await import( '../../src/my-wordpress/integrations/woocommerce' );
	} );

	afterAll( () => clearHooksStub() );

	beforeEach( () => {
		setConfig();
		stubSummary( {} );
	} );

	afterEach( () => {
		document.body.innerHTML = '';
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	} );

	describe( 'banding', () => {
		test( 'products band from the server-shipped list', () => {
			const banding = applyFilters(
				'os.my-wordpress.list-bands',
				null,
				{ id: PRODUCTS },
			) as { bands: unknown[]; assign: ( i: unknown ) => string | null };

			expect( banding ).not.toBeNull();
			expect( banding.bands ).toHaveLength( 2 );
			// The band comes off the row, decided server-side by the
			// same rules that ordered the collection.
			expect(
				banding.assign( productRow( { band: 'cat:apparel' } ) ),
			).toBe( 'cat:apparel' );
		} );

		test( 'a row with no band field falls through rather than throwing', () => {
			const banding = applyFilters(
				'os.my-wordpress.list-bands',
				null,
				{ id: PRODUCTS },
			) as { assign: ( i: unknown ) => string | null };

			expect( banding.assign( { id: 1 } ) ).toBeNull();
		} );

		test( 'sections this integration does not own are left alone', () => {
			expect(
				applyFilters( 'os.my-wordpress.list-bands', null, {
					id: 'posts',
				} ),
			).toBeNull();
		} );
	} );

	describe( 'stock ribbon', () => {
		test.each( [
			[ { band: '', stockStatus: 'outofstock', stockLevel: 0 }, 'danger' ],
			[
				{ band: '', stockStatus: 'onbackorder', stockLevel: null },
				'warning',
			],
			[
				{ band: '', stockStatus: 'instock', stockLevel: 2 },
				'warning',
			],
			[
				{
					band: '',
					stockStatus: 'instock',
					stockLevel: null,
					onSale: true,
				},
				'success',
			],
		] )( 'stamps a %o ribbon', ( facts, tone ) => {
			const tile = decorate( productRow( facts ) );
			const ribbon = tile.querySelector( 'os-ribbon' );

			expect( ribbon ).not.toBeNull();
			expect( ribbon?.getAttribute( 'tone' ) ).toBe( tone );
			// `top-start`, so it can't collide with the tile's own
			// post-status ribbon on `top-end`.
			expect( ribbon?.getAttribute( 'placement' ) ).toBe( 'top-start' );
		} );

		test( 'a healthy product gets no ribbon', () => {
			const tile = decorate(
				productRow( {
					band: '',
					stockStatus: 'instock',
					stockLevel: 40,
					onSale: false,
				} ),
			);

			expect( tile.querySelector( 'os-ribbon' ) ).toBeNull();
		} );

		test( 'the ribbon is restored after the tile repaints', () => {
			// `<os-tile>._paint()` drops every direct `<os-ribbon>`
			// child before rebuilding, and it repaints on selection —
			// so a decoration that isn't re-stamped simply vanishes.
			const tile = decorate(
				productRow( {
					band: '',
					stockStatus: 'outofstock',
					stockLevel: 0,
				} ),
			);
			expect( tile.querySelector( 'os-ribbon' ) ).not.toBeNull();

			tile.querySelector( 'os-ribbon' )?.remove();
			doAction( 'os.tile.rendered', { tile } );

			expect( tile.querySelector( 'os-ribbon' ) ).not.toBeNull();
		} );

		test( 'a tile from another section is not decorated', () => {
			const tile = document.createElement( 'div' );
			doAction( 'os.my-wordpress.list-tile', {
				tile,
				entityId: 'posts',
				kind: 'post',
				item: productRow( { band: '', stockStatus: 'outofstock' } ),
			} );

			expect( tile.querySelector( 'os-ribbon' ) ).toBeNull();
		} );
	} );

	describe( 'preview panel', () => {
		/** Fire the preview slot and wait for the panel to settle. */
		async function paint( entityId = PRODUCTS ): Promise< HTMLElement > {
			const container = document.createElement( 'div' );
			document.body.appendChild( container );
			doAction( 'os.my-wordpress.preview-extras', {
				slot: 'header',
				container,
				entityId,
				kind: 'post',
				item: { id: 7 },
			} );
			await vi.waitFor( () => {
				const panel = container.querySelector( '.os-woo-panel' );
				if ( ! panel || panel.hasAttribute( 'aria-busy' ) ) {
					throw new Error( 'panel still loading' );
				}
			} );
			return container;
		}

		test( 'the shell is painted synchronously so nothing shifts', () => {
			const container = document.createElement( 'div' );
			doAction( 'os.my-wordpress.preview-extras', {
				slot: 'header',
				container,
				entityId: PRODUCTS,
				kind: 'post',
				item: { id: 7 },
			} );

			// Present and reserving its height before the request has
			// had any chance to resolve.
			const panel = container.querySelector( '.os-woo-panel' );
			expect( panel ).not.toBeNull();
			expect( panel?.getAttribute( 'aria-busy' ) ).toBe( 'true' );
			expect(
				panel?.querySelectorAll(
					'.os-woo-panel__row--placeholder',
				).length,
			).toBeGreaterThan( 0 );
		} );

		test( 'renders a product summary', async () => {
			stubSummary( {
				type: 'product',
				sku: 'SHOE-42',
				price: '€89.90',
				regular: '€120.00',
				onSale: true,
				stockStatus: 'instock',
				stockLabel: 'In stock',
				stockLevel: 14,
				sold: 231,
				rating: 4.2,
				reviews: 18,
				productType: 'Variable',
				variations: 3,
				categories: [ 'Shoes' ],
				permalink: 'http://example.test/shoe',
				editUrl: 'http://example.test/wp-admin/post.php?post=7',
			} );

			const container = await paint();
			const text = container.textContent ?? '';

			expect( text ).toContain( 'SHOE-42' );
			expect( text ).toContain( '231 units' );
			expect( text ).toContain( '4.2' );
			// Stock reads through `<os-badge>`, not a bespoke pill.
			expect(
				container.querySelector( 'os-badge' )?.getAttribute( 'tone' ),
			).toBe( 'success' );
		} );

		test( 'a failed request shows the error row, not a stuck skeleton', async () => {
			stubSummary( { code: 'nope' }, 500 );

			const container = await paint();

			expect(
				container.querySelector( '.os-woo-panel__error' ),
			).not.toBeNull();
			expect(
				container.querySelectorAll(
					'.os-woo-panel__row--placeholder',
				),
			).toHaveLength( 0 );
		} );

		test( 'a malformed payload shows the error row, not a stuck skeleton', async () => {
			// `openstation_my_wordpress_woo_summary` is a documented
			// filter over this payload, so a plugin can drop the very
			// fields the row builders read. That used to throw inside
			// the render callback and leave the panel on placeholders
			// forever.
			vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
			stubSummary( { type: 'product' } );

			const container = await paint();

			expect(
				container.querySelector( '.os-woo-panel__error' ),
			).not.toBeNull();
			expect(
				container.querySelectorAll(
					'.os-woo-panel__row--placeholder',
				),
			).toHaveLength( 0 );
		} );

		test( 'sections this integration does not own get no panel', () => {
			const container = document.createElement( 'div' );
			doAction( 'os.my-wordpress.preview-extras', {
				slot: 'header',
				container,
				entityId: 'posts',
				kind: 'post',
				item: { id: 7 },
			} );

			expect( container.children ).toHaveLength( 0 );
		} );

		test( 'only the header slot paints a panel', () => {
			const container = document.createElement( 'div' );
			doAction( 'os.my-wordpress.preview-extras', {
				slot: 'footer',
				container,
				entityId: PRODUCTS,
				kind: 'post',
				item: { id: 7 },
			} );

			expect( container.children ).toHaveLength( 0 );
		} );
	} );
} );
