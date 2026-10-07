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
import {
	bindNativeUrlRemap,
	isPersonViewClaimed,
	listNativeUrlRemaps,
	registerNativeUrlRemap,
	tryNativeUrlRemap,
	unregisterNativeUrlRemap,
} from '../../src/native-url-remap';
import type { OsSettingsSnapshot } from '../../src/settings/registry';

const PRODUCTS = 'cpt-product';
const CUSTOMERS = 'wc-customers';

interface WooGlobal {
	openStationWooConfig?: Record< string, unknown >;
}

function setConfig( extra: Record< string, unknown > = {} ): void {
	( window as unknown as WooGlobal ).openStationWooConfig = {
		restRoot: 'http://example.test/wp-json/desktop-mode/v1/woocommerce/',
		restNonce: 'nonce',
		canOrders: true,
		canCustomers: true,
		customerBands: [
			{ id: 'vip', label: 'VIP', order: 10, count: 2 },
			{ id: 'lapsed', label: 'Lapsed', order: 20, count: 5 },
			{ id: 'repeat', label: 'Repeat', order: 30, count: 9 },
			{ id: 'new', label: 'New', order: 40, count: 3 },
			{ id: 'none', label: 'No orders yet', order: 50, count: 1 },
		],
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

function stubOpenWindow( fn: () => boolean ): void {
	const w = window as unknown as { wp?: Record< string, unknown > };
	w.wp = w.wp ?? {};
	( w.wp as { os?: unknown } ).os = { openWindow: fn };
}

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

	beforeAll( async () => {
		installHooksStub();
		setConfig();
		stubSummary( {} );
		await import( '../../src/plugins/my-wordpress-woocommerce/index' );
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

	describe( 'orders list view', () => {
		test( 'shows the customer and the WooCommerce status instead of post columns', () => {
			setConfig( { orderStatuses: { 'wc-processing': 'Processing' } } );
			const postColumns = [ 'id', 'title', 'slug', 'author', 'status', 'date', 'modified', 'comments', 'words', 'actions' ]
				.map( ( id ) => ( { id, label: id, render: () => id } ) );
			const columns = applyFilters(
				'os.my-wordpress.list-columns',
				postColumns,
				{ id: 'wc-orders' },
			) as Array< { id: string; render: ( item: Record< string, unknown > ) => unknown } >;
			const cell = ( id: string ) =>
				columns.find( ( c ) => c.id === id )?.render( {

					status: 'publish',
					wcStatus: 'processing',
					customer: 'Ada',
				} );

			expect( columns.map( ( c ) => c.id ) ).toEqual( [
				'id', 'title', 'customer', 'status', 'date', 'modified', 'actions',
			] );
			expect( cell( 'status' ) ).toBe( 'Processing' );
			expect( cell( 'customer' ) ).toBe( 'Ada' );
			expect(
				applyFilters( 'os.my-wordpress.list-columns', postColumns, { id: 'posts' } ),
			).toBe( postColumns );
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

	describe( 'customers', () => {

		function customerRow( facts: Record< string, unknown > ) {
			return { id: 11, name: 'Ada', openstation_woo_customer: facts };
		}

		function decorateUser(
			item: Record< string, unknown >,
			entityId = CUSTOMERS,
			{ painted = true }: { painted?: boolean } = {},
		): HTMLElement {
			const tile = document.createElement( 'div' );
			if ( painted ) {
				const visual = document.createElement( 'span' );
				visual.className = 'os-file-tile__visual';
				tile.appendChild( visual );
			}
			const sub = document.createElement( 'span' );
			sub.className = 'os-my-wordpress__user-tile-sub';
			sub.textContent = 'Customer · 0 posts';
			tile.appendChild( sub );
			document.body.appendChild( tile );
			doAction( 'os.my-wordpress.list-tile', {
				tile,
				entityId,
				kind: 'user',
				item,
			} );
			return tile;
		}

		function repaint( tile: HTMLElement ): void {
			tile.querySelector( '.os-file-tile__visual' )?.remove();
			const visual = document.createElement( 'span' );
			visual.className = 'os-file-tile__visual';
			tile.prepend( visual );
			doAction( 'os.tile.rendered', { tile } );
		}

		test( 'the Customers grid drops the sub-line entirely', () => {
			const tile = decorateUser(
				customerRow( {
					band: 'repeat',
					orders: 4,
					spend: '£240.00',
					spendRaw: 240,
				} ),
			);

			expect(
				tile.querySelector( '.os-my-wordpress__user-tile-sub' ),
			).toBeNull();
		} );

		test( 'the Users grid keeps its sub-line', () => {
			const tile = decorateUser(
				customerRow( { band: 'vip', orders: 4, spend: '£240.00' } ),
				'users',
			);

			expect(
				tile.querySelector( '.os-my-wordpress__user-tile-sub' )
					?.textContent,
			).toBe( 'Customer · 0 posts' );
		} );

		test.each( [
			[ 'vip', 'VIP' ],
			[ 'lapsed', 'Lapsed' ],
		] )( 'the %s band earns a badge inside the avatar', ( band, label ) => {
			const tile = decorateUser(
				customerRow( { band, orders: 3, spend: '£90.00' } ),
			);
			const badge = tile.querySelector( '.os-woo-customer-band' );

			expect( badge ).not.toBeNull();
			expect( badge?.textContent ).toBe( label );
			expect( badge?.classList.contains(
				`os-woo-customer-band--${ band }`,
			) ).toBe( true );

			expect( badge?.parentElement?.className ).toContain(
				'os-file-tile__visual',
			);

			expect( tile.querySelector( 'os-ribbon' ) ).toBeNull();
		} );

		test( 'the badge survives a repaint', () => {
			const tile = decorateUser(
				customerRow( { band: 'vip', orders: 3, spend: '£90.00' } ),
			);

			repaint( tile );

			expect(
				tile.querySelectorAll( '.os-woo-customer-band' ),
			).toHaveLength( 1 );
		} );

		test( 'a tile decorated before it paints gets exactly one badge', () => {

			const tile = decorateUser(
				customerRow( { band: 'vip', orders: 3, spend: '£90.00' } ),
				CUSTOMERS,
				{ painted: false },
			);

			expect(
				tile.querySelectorAll( '.os-woo-customer-band' ),
			).toHaveLength( 0 );

			repaint( tile );

			const badges = tile.querySelectorAll( '.os-woo-customer-band' );
			expect( badges ).toHaveLength( 1 );
			expect( badges[ 0 ].parentElement?.className ).toContain(
				'os-file-tile__visual',
			);
		} );

		test( 'repeated paints never accumulate badges', () => {
			const tile = decorateUser(
				customerRow( { band: 'lapsed', orders: 1, spend: '£9.00' } ),
			);
			repaint( tile );
			repaint( tile );
			repaint( tile );

			expect(
				tile.querySelectorAll( '.os-woo-customer-band' ),
			).toHaveLength( 1 );
		} );

		test.each( [ 'repeat', 'new', 'none' ] )(
			'the %s band gets no badge — a mark on every tile is a mark on none',
			( band ) => {
				const tile = decorateUser(
					customerRow( { band, orders: 2, spend: '£20.00' } ),
				);

				expect(
					tile.querySelector( '.os-woo-customer-band' ),
				).toBeNull();
			},
		);

		test( 'the built-in Users section gets the same decoration', () => {
			const tile = decorateUser(
				customerRow( { band: 'vip', orders: 9, spend: '£900.00' } ),
				'users',
			);

			expect(
				tile.querySelector( '.os-woo-customer-band' ),
			).not.toBeNull();
		} );

		test( 'a user row with no facts is left alone', () => {
			const tile = decorateUser( { id: 11, name: 'Ada' }, 'users' );

			expect( tile.querySelector( '.os-woo-customer-band' ) ).toBeNull();
			expect(
				tile.querySelector( '.os-my-wordpress__user-tile-sub' )
					?.textContent,
			).toBe( 'Customer · 0 posts' );
		} );

		test( 'double-click on a customer opens the customer window', () => {

			const openWindow = vi.fn( () => true );
			stubOpenWindow( openWindow );

			const handled = applyFilters(
				'os.my-wordpress.user-activate',
				false,
				{
					entityId: CUSTOMERS,
					kind: 'user',
					item: { id: 11, name: 'Ada' },
				},
			);

			expect( handled ).toBe( true );
			expect( openWindow ).toHaveBeenCalledWith(
				'desktop-mode-woo-customer',
				expect.objectContaining( {

					params: { customerId: 11, customerName: 'Ada' },
				} ),
			);
		} );

		test( 'double-click in the Users folder is left alone', () => {

			const openWindow = vi.fn( () => true );
			stubOpenWindow( openWindow );

			expect(
				applyFilters( 'os.my-wordpress.user-activate', false, {
					entityId: 'users',
					kind: 'user',
					item: { id: 11, name: 'Ada' },
				} ),
			).toBe( false );
			expect( openWindow ).not.toHaveBeenCalled();
		} );

		test( 'the context menu drops the author-archive dead end', () => {
			const base = [
				{ id: 'footprint', label: 'Footprint', icon: 'a' },
				{ id: 'open-profile', label: 'Show profile', icon: 'b' },
				{ id: 'author-archive', label: 'Author archive', icon: 'c' },
			];
			const options = applyFilters(
				'os.my-wordpress.tile-context-menu',
				base,
				{
					entityId: CUSTOMERS,
					kind: 'user',
					item: customerRow( {
						band: 'vip',
						orders: 3,
						ordersUrl: 'http://example.test/wp-admin/orders',
					} ),
				},
			) as Array< { id: string } >;

			const ids = options.map( ( o ) => o.id );

			expect( ids ).not.toContain( 'author-archive' );
			expect( ids ).not.toContain( 'footprint' );
			expect( ids ).toContain( 'wc-customer-window' );
			expect( ids ).toContain( 'wc-customer-orders' );
			expect( ids ).toContain( 'open-profile' );
		} );

		test( 'the customer window renderer registers on the shell global', () => {
			const registry = (
				window as unknown as {
					openStationNativeWindows?: Record< string, unknown >;
				}
			 ).openStationNativeWindows;

			expect( typeof registry?.[ 'desktop-mode-woo-customer' ] ).toBe(
				'function',
			);
		} );

		test( 'the customer marker routes a person-URL to the customer window', () => {
			const openById = vi.fn().mockReturnValue( true );
			bindNativeUrlRemap( {
				getSnapshot: () => ( {} as OsSettingsSnapshot ),
				openById,
				adminUrl: 'http://example.test/wp-admin/',
			} );

			const claimed = tryNativeUrlRemap(
				'http://example.test/wp-admin/user-edit.php?user_id=11&os_person_view=wc-customer',
			);

			expect( claimed ).toBe( true );
			expect( openById ).toHaveBeenCalledWith(
				'desktop-mode-woo-customer',
				{ params: { customerId: 11 } },
			);
		} );

		test( 'both halves of the hand-off registered: the claim wins, the profile stands down', () => {

			const openById = vi.fn().mockReturnValue( true );
			const profileMatches = vi.fn( ( _url: string, parsed: URL ) => {
				if ( isPersonViewClaimed( parsed ) ) {
					return false;
				}
				return (
					parsed.pathname.endsWith( '/profile.php' ) ||
					( parsed.pathname.endsWith( '/user-edit.php' ) &&
						parsed.searchParams.has( 'user_id' ) )
				);
			} );

			const claim = listNativeUrlRemaps().find(
				( r ) => r.id === 'desktop-mode/woo-customer',
			);
			expect( claim ).toBeDefined();

			unregisterNativeUrlRemap( 'desktop-mode/woo-customer' );
			registerNativeUrlRemap( {
				id: 'desktop-mode-user-edit',
				nativeWindowId: 'desktop-mode-user-edit',
				matches: profileMatches,
			} );
			registerNativeUrlRemap( claim! );

			try {
				bindNativeUrlRemap( {
					getSnapshot: () => ( {} as OsSettingsSnapshot ),
					openById,
					adminUrl: 'http://example.test/wp-admin/',
				} );

				expect(
					tryNativeUrlRemap(
						'http://example.test/wp-admin/user-edit.php?user_id=11&os_person_view=wc-customer',
					),
				).toBe( true );
				expect( profileMatches ).toHaveBeenCalled();
				expect( openById ).toHaveBeenCalledWith(
					'desktop-mode-woo-customer',
					{ params: { customerId: 11 } },
				);

				openById.mockClear();
				expect(
					tryNativeUrlRemap(
						'http://example.test/wp-admin/user-edit.php?user_id=11',
					),
				).toBe( true );

				expect( openById ).toHaveBeenCalledWith(
					'desktop-mode-user-edit',
				);
			} finally {
				unregisterNativeUrlRemap( 'desktop-mode-user-edit' );
			}
		} );

		test( 'an unmarked person-URL is left to the profile editor', () => {
			const openById = vi.fn().mockReturnValue( true );
			bindNativeUrlRemap( {
				getSnapshot: () => ( {} as OsSettingsSnapshot ),
				openById,
				adminUrl: 'http://example.test/wp-admin/',
			} );

			expect(
				tryNativeUrlRemap(
					'http://example.test/wp-admin/user-edit.php?user_id=11',
				),
			).toBe( false );
			expect( openById ).not.toHaveBeenCalled();
		} );

		test( 'the customer window announces a `user` identity', () => {

			const set = vi.fn();
			const w = window as unknown as { wp?: Record< string, unknown > };
			w.wp = w.wp ?? {};
			( w.wp as { os?: unknown } ).os = { relations: { set } };

			const root = document.createElement( 'div' );
			root.id = 'wp-window-desktop-mode-woo-customer';
			const body = document.createElement( 'div' );
			const mount = document.createElement( 'div' );
			mount.setAttribute( 'data-os-woo-customer-root', '' );
			body.appendChild( mount );
			root.appendChild( body );
			document.body.appendChild( root );

			const render = (
				window as unknown as {
					openStationNativeWindows: Record<
						string,
						(
							body: HTMLElement,
							ctx?: {
								params?: Record<
									string,
									string | number | boolean
								>;
							},
						) => unknown
					>;
				}
			 ).openStationNativeWindows[ 'desktop-mode-woo-customer' ];
			render( body, {
				params: { customerId: 11, customerName: 'Ada' },
			} );

			expect( set ).toHaveBeenCalledWith(
				'desktop-mode-woo-customer',
				expect.objectContaining( { type: 'user', id: 11 } ),
			);
		} );

		test( 'a retarget beats a slow response for the customer it replaced', async () => {

			const bodies: Record< string, () => void > = {};
			vi.stubGlobal(
				'fetch',
				vi.fn( ( url: string ) =>
					new Promise< Response >( ( resolve ) => {
						const id = url.includes( '/11' ) ? '11' : '22';
						bodies[ id ] = () =>
							resolve(
								new Response(
									JSON.stringify( {
										name:
											'11' === id
												? 'Ada'
												: 'Grace',
										email: '',
										spend: '£1.00',
										orders: 1,
										band: 'new',
										bandLabel: 'New',
										firstOrder: '',
										lastOrder: '',
										daysSince: null,
										lastOrderNo: '',
										lastOrderUrl: '',
										lastOrderTotal: '',
										favourite: null,
										location: '',
										registered: '',
										ordersUrl: '',
										profileUrl: '',
										recent: [],
										billing: '',
										shipping: '',
									} ),
									{
										status: 200,
										headers: {
											'Content-Type':
												'application/json',
										},
									},
								),
							);
					} ),
				),
			);

			const root = document.createElement( 'div' );
			root.id = 'wp-window-desktop-mode-woo-customer';
			const body = document.createElement( 'div' );
			const mount = document.createElement( 'div' );
			mount.setAttribute( 'data-os-woo-customer-root', '' );
			body.appendChild( mount );
			root.appendChild( body );
			document.body.appendChild( root );

			const render = (
				window as unknown as {
					openStationNativeWindows: Record<
						string,
						(
							body: HTMLElement,
							ctx?: {
								params?: Record<
									string,
									string | number | boolean
								>;
							},
						) => unknown
					>;
				}
			 ).openStationNativeWindows[ 'desktop-mode-woo-customer' ];

			render( body, {
				params: { customerId: 11, customerName: 'Ada' },
			} );

			document.dispatchEvent(
				new CustomEvent( 'os-window-reopened', {
					detail: {
						windowId: 'desktop-mode-woo-customer',
						params: { customerId: 22, customerName: 'Grace' },
					},
				} ),
			);

			await vi.waitFor( () => {
				if ( ! bodies[ '11' ] || ! bodies[ '22' ] ) {
					throw new Error( 'requests not issued yet' );
				}
			} );

			bodies[ '22' ]();
			await vi.waitFor( () => {
				if ( mount.dataset.customerId !== '22' ) {
					throw new Error( 'second paint not applied' );
				}
			} );

			bodies[ '11' ]();
			for ( let i = 0; i < 5; i++ ) {
				await new Promise( ( r ) => setTimeout( r, 0 ) );
			}

			expect( mount.dataset.customerId ).toBe( '22' );
			expect( mount.textContent ).toContain( 'Grace' );
			expect( mount.textContent ).not.toContain( 'Ada' );
		} );

		test( 'a capped store says the bands were not counted, not zero', async () => {
			stubSummary( {
				revenue: '£10.00',
				processing: 0,
				outOfStock: 0,
				customers: 40000,
				bandsCapped: true,
			} );

			const container = document.createElement( 'div' );
			document.body.appendChild( container );
			doAction( 'os.my-wordpress.group-extras', {
				container,
				groupId: 'plugin:woocommerce',
				entityIds: [ CUSTOMERS ],
			} );

			await vi.waitFor( () => {
				const panel = container.querySelector( '.os-woo-panel' );
				if ( ! panel || panel.hasAttribute( 'aria-busy' ) ) {
					throw new Error( 'panel still loading' );
				}
			} );

			expect( container.textContent ).toContain( 'Not counted' );
			expect( container.textContent ).not.toContain( '0 · 0' );
		} );

		test( 'an uncapped store with no VIPs omits the row entirely', async () => {
			stubSummary( {
				revenue: '£10.00',
				processing: 0,
				outOfStock: 0,
				customers: 3,
				vips: 0,
				lapsed: 0,
			} );

			const container = document.createElement( 'div' );
			document.body.appendChild( container );
			doAction( 'os.my-wordpress.group-extras', {
				container,
				groupId: 'plugin:woocommerce',
				entityIds: [ CUSTOMERS ],
			} );

			await vi.waitFor( () => {
				const panel = container.querySelector( '.os-woo-panel' );
				if ( ! panel || panel.hasAttribute( 'aria-busy' ) ) {
					throw new Error( 'panel still loading' );
				}
			} );

			expect( container.textContent ).not.toContain( 'VIP · lapsed' );
			expect( container.textContent ).not.toContain( 'Not counted' );
		} );

		test( 'the customers dossier drops the author sections', () => {
			const sections = applyFilters(
				'os.my-wordpress.user-dossier-sections',
				[ 'bio', 'stats', 'activity', 'milestones', 'recent', 'terms' ],
				{ entityId: CUSTOMERS, kind: 'user', userId: 11 },
			);

			expect( sections ).toEqual( [ 'bio' ] );
		} );

		test( 'the Users section keeps its author sections', () => {
			const all = [
				'bio',
				'stats',
				'activity',
				'milestones',
				'recent',
				'terms',
			];
			expect(
				applyFilters( 'os.my-wordpress.user-dossier-sections', all, {
					entityId: 'users',
					kind: 'user',
					userId: 11,
				} ),
			).toEqual( all );
		} );

		test( 'the action row swaps the footprint for their orders', () => {
			const base = [
				{ id: 'footprint', label: 'Footprint', onSelect: () => {} },
				{ id: 'open-profile', label: 'Show profile', onSelect: () => {} },
			];
			const actions = applyFilters(
				'os.my-wordpress.user-preview-actions',
				base,
				{
					entityId: CUSTOMERS,
					kind: 'user',
					item: customerRow( {
						band: 'vip',
						orders: 3,
						spend: '£90.00',
						ordersUrl: 'http://example.test/wp-admin/orders',
					} ),
				},
			) as Array< { id: string; variant?: string } >;

			expect( actions.map( ( a ) => a.id ) ).toEqual( [
				'wc-orders',
				'open-profile',
			] );
			expect( actions[ 0 ].variant ).toBe( 'primary' );
		} );

		test( 'no orders means no dead-end button onto an empty list', () => {
			const base = [
				{ id: 'footprint', label: 'Footprint', onSelect: () => {} },
				{ id: 'open-profile', label: 'Show profile', onSelect: () => {} },
			];
			const actions = applyFilters(
				'os.my-wordpress.user-preview-actions',
				base,
				{
					entityId: CUSTOMERS,
					kind: 'user',
					item: customerRow( {
						band: 'none',
						orders: 0,
						spend: '',
						ordersUrl: '',
					} ),
				},
			) as Array< { id: string; variant?: string } >;

			expect( actions.map( ( a ) => a.id ) ).toEqual( [ 'open-profile' ] );

			expect( actions[ 0 ].variant ).toBe( 'primary' );
		} );

		test( 'a people surface whose rows carry no customer facts gets no money panel', () => {

			const container = document.createElement( 'div' );
			document.body.appendChild( container );
			doAction( 'os.my-wordpress.preview-extras', {
				slot: 'meta',
				container,
				entityId: 'users',
				kind: 'user',
				item: { id: 11 },
			} );
			expect( container.querySelector( '.os-woo-panel' ) ).toBeNull();
		} );

		test( 'a user preview asks for the customer summary', async () => {
			stubSummary( {
				type: 'customer',
				name: 'Ada',
				email: 'ada@example.test',
				band: 'vip',
				bandLabel: 'VIP',
				orders: 6,
				spend: '£600.00',
				aov: '£100.00',
				firstOrder: '2024-01-02T00:00:00',
				lastOrder: '2026-07-01T00:00:00',
				daysSince: 34,
				lastOrderNo: '1042',
				lastOrderUrl: 'http://example.test/wp-admin/order',
				lastOrderTotal: '£120.00',
				favourite: null,
				location: 'Lisbon, PT',
				registered: '2023-11-04T00:00:00',
				ordersUrl: 'http://example.test/wp-admin/orders',
				profileUrl: '',
			} );

			const container = document.createElement( 'div' );

			document.body.appendChild( container );

			doAction( 'os.my-wordpress.preview-extras', {
				slot: 'meta',
				container,
				entityId: CUSTOMERS,
				kind: 'user',
				item: { id: 11 },
			} );
			await vi.waitFor( () => {
				const panel = container.querySelector( '.os-woo-panel' );
				if ( ! panel || panel.hasAttribute( 'aria-busy' ) ) {
					throw new Error( 'panel still loading' );
				}
			} );
			expect(
				container.querySelector( '.os-woo-panel--customer' ),
			).not.toBeNull();

			const url = ( global.fetch as ReturnType< typeof vi.fn > ).mock
				.calls[ 0 ][ 0 ] as string;
			expect( url ).toContain( 'summary/customer/11' );
			expect( container.textContent ).toContain( '£600.00' );
			expect( container.textContent ).toContain( '6 orders' );
		} );

		test( 'the header slot stays empty for a person', () => {
			const container = document.createElement( 'div' );
			document.body.appendChild( container );
			doAction( 'os.my-wordpress.preview-extras', {
				slot: 'header',
				container,
				entityId: CUSTOMERS,
				kind: 'user',
				item: { id: 11 },
			} );

			expect( container.children ).toHaveLength( 0 );
		} );

		test( 'no panel for a viewer who may not see customer money', () => {
			setConfig( { canCustomers: false } );

			const container = document.createElement( 'div' );
			doAction( 'os.my-wordpress.preview-extras', {
				slot: 'meta',
				container,
				entityId: CUSTOMERS,
				kind: 'user',
				item: { id: 11 },
			} );

			expect( container.children ).toHaveLength( 0 );
		} );
	} );
} );
