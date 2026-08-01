/**
 * Extension seams on the site window's post-kind preview pane and its
 * folder view — the contract the WooCommerce integration (and any
 * third-party plugin) builds on.
 *
 * `preview-extras` already existed for the media pane; these tests
 * cover it firing for post-kind previews too, plus the new
 * `group-extras` action on the folder view.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import {
	addAction,
	addFilter,
	removeAction,
	removeFilter,
} from '../../src/hooks';

const WINDOW_ID = 'desktop-mode-my-wordpress';
const NS = 'test/slots';

interface NativeWindowsGlobal {
	desktopModeNativeWindows?: Record<
		string,
		( ( body: HTMLElement ) => void | ( () => void ) ) | undefined
	>;
	desktopModeWindowConfig?: Record< string, unknown >;
}

const DETAIL: Record< string, unknown > = {
	id: 7,
	title: { rendered: 'Running Shoe' },
	content: { rendered: '<p>A shoe.</p>' },
	excerpt: { rendered: '' },
	date: '2026-01-01T00:00:00',
	status: 'publish',
	link: 'http://example.test/?p=7',
	featured_media: 0,
};

/** Swap the fixture the stubbed fetch serves for the detail request. */
let detailFixture: Record< string, unknown > = DETAIL;

function installTemplateMarkup( host: HTMLElement ): void {
	host.innerHTML = `
		<div class="desktop-mode-my-wordpress" data-desktop-mode-my-wordpress-root>
			<header data-desktop-mode-my-wordpress-breadcrumbs></header>
			<div class="desktop-mode-my-wordpress__body" data-desktop-mode-my-wordpress-body>
				<div class="desktop-mode-my-wordpress__loading" data-desktop-mode-my-wordpress-loading hidden></div>
			</div>
			<div class="desktop-mode-folder-status-bar" data-desktop-mode-my-wordpress-status></div>
		</div>
	`;
}

function mount(): HTMLElement {
	const cb = ( window as unknown as NativeWindowsGlobal )
		.desktopModeNativeWindows?.[ WINDOW_ID ];
	if ( typeof cb !== 'function' ) {
		throw new Error( 'render callback not registered' );
	}
	const body = document.createElement( 'div' );
	body.className = 'desktop-mode-window__body';
	installTemplateMarkup( body );
	document.body.appendChild( body );
	cb( body );
	return body;
}

function dblclickTile( body: HTMLElement, label: string ): void {
	const tile = [ ...body.querySelectorAll< HTMLElement >( 'wpd-tile' ) ].find(
		( t ) =>
			(
				t.querySelector( '.desktop-mode-file-tile__label' )
					?.textContent ?? ''
			).startsWith( label ),
	);
	if ( ! tile ) {
		throw new Error( `no tile labelled ${ label }` );
	}
	tile.dispatchEvent( new MouseEvent( 'dblclick', { bubbles: true } ) );
}

describe( 'my-wordpress — preview + group extension slots', () => {
	beforeEach( async () => {
		detailFixture = DETAIL;
		installHooksStub();
		( window as unknown as NativeWindowsGlobal ).desktopModeWindowConfig = {
			[ WINDOW_ID ]: {
				restRoot: 'http://example.test/wp-json/',
				restNonce: 'nonce',
				editPostUrlBase: 'http://example.test/wp-admin/post.php',
				editUserUrlBase: 'http://example.test/wp-admin/user-edit.php',
				siteName: 'Example',
				entities: [
					{
						id: 'cpt-product',
						label: 'Products',
						icon: 'dashicons-cart',
						restPath: 'wp/v2/product',
						kind: 'post',
						post_type: 'product',
						group: 'plugin:woocommerce',
						groupLabel: 'Woo',
						groupIcon: 'dashicons-admin-plugins',
						groupOrder: 15,
					},
				],
				groups: [
					{
						id: 'plugin:woocommerce',
						label: 'Woo',
						icon: 'dashicons-admin-plugins',
						order: 15,
					},
				],
				perPage: 24,
				mediaPerPage: 48,
				previewActions: [],
			},
		};
		vi.stubGlobal(
			'fetch',
			vi.fn( ( input: RequestInfo ) => {
				const url = String( input );
				// Detail fetch → the single product; list fetch → one row.
				const body = /\/product\/7\b/.test( url )
					? JSON.stringify( detailFixture )
					: JSON.stringify( [ DETAIL ] );
				return Promise.resolve(
					new Response( body, {
						status: 200,
						headers: {
							'Content-Type': 'application/json',
							'X-WP-Total': '1',
							'X-WP-TotalPages': '1',
						},
					} ),
				);
			} ),
		);
		await import( '../../src/my-wordpress/index' );
	} );

	afterEach( () => {
		removeAction( 'desktop-mode.my-wordpress.preview-extras', NS );
		removeAction( 'desktop-mode.my-wordpress.group-extras', NS );
		removeAction( 'desktop-mode.my-wordpress.list-tile', NS );
		removeFilter( 'desktop-mode.my-wordpress.list-bands', NS );
		document.body.innerHTML = '';
		clearHooksStub();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	} );

	test( 'group-extras fires with the group id and its member sections', () => {
		const seen: Array< Record< string, unknown > > = [];
		addAction(
			'desktop-mode.my-wordpress.group-extras',
			NS,
			( payload: Record< string, unknown > ) => {
				seen.push( payload );
				( payload.container as HTMLElement ).textContent = 'store panel';
			},
		);

		const body = mount();
		dblclickTile( body, 'Woo' );

		expect( seen ).toHaveLength( 1 );
		expect( seen[ 0 ].groupId ).toBe( 'plugin:woocommerce' );
		expect( seen[ 0 ].entityIds ).toEqual( [ 'cpt-product' ] );
		expect(
			body.querySelector( '.desktop-mode-my-wordpress__group-extras' )
				?.textContent,
		).toBe( 'store panel' );
	} );

	test( 'preview-extras fires all three slots for a post-kind preview', async () => {
		const slots: string[] = [];
		addAction(
			'desktop-mode.my-wordpress.preview-extras',
			NS,
			( payload: Record< string, unknown > ) => {
				slots.push( String( payload.slot ) );
			},
		);

		const body = mount();
		dblclickTile( body, 'Woo' );
		dblclickTile( body, 'Products' );

		await vi.waitFor( () => {
			if ( ! body.querySelector( '[data-entry-id="7"]' ) ) {
				throw new Error( 'tiles not painted' );
			}
		} );

		body.querySelector< HTMLElement >( '[data-entry-id="7"]' )?.click();

		await vi.waitFor( () => {
			if ( ! slots.includes( 'footer' ) ) {
				throw new Error( 'slots not fired' );
			}
		} );

		expect( slots ).toEqual( [ 'header', 'meta', 'footer' ] );
	} );

	test( 'preview-extras carries the entity and the item being previewed', async () => {
		let payload: Record< string, unknown > | null = null;
		addAction(
			'desktop-mode.my-wordpress.preview-extras',
			NS,
			( p: Record< string, unknown > ) => {
				if ( p.slot === 'header' ) {
					payload = p;
				}
			},
		);

		const body = mount();
		dblclickTile( body, 'Woo' );
		dblclickTile( body, 'Products' );

		await vi.waitFor( () => {
			if ( ! body.querySelector( '[data-entry-id="7"]' ) ) {
				throw new Error( 'tiles not painted' );
			}
		} );
		body.querySelector< HTMLElement >( '[data-entry-id="7"]' )?.click();

		await vi.waitFor( () => {
			if ( ! payload ) {
				throw new Error( 'header slot not fired' );
			}
		} );

		const fired = payload as unknown as Record< string, unknown >;
		expect( fired.entityId ).toBe( 'cpt-product' );
		expect( fired.kind ).toBe( 'post' );
		expect( ( fired.item as { id: number } ).id ).toBe( 7 );
		expect( fired.container ).toBeInstanceOf( HTMLElement );
	} );

	test( 'a post type without editor support still renders its preview', async () => {
		// Regression: WooCommerce's `shop_coupon` supports only
		// `title`, so its REST rows carry no `content` key at all.
		// Reading `.rendered` off the missing field threw before the
		// article was appended, and the whole pane rendered blank —
		// panels included.
		detailFixture = {
			id: 7,
			title: { rendered: 'SUMMER20' },
			date: '2026-01-01T00:00:00',
			status: 'publish',
			link: 'http://example.test/?p=7',
			featured_media: 0,
		};

		const slots: string[] = [];
		addAction(
			'desktop-mode.my-wordpress.preview-extras',
			NS,
			( payload: Record< string, unknown > ) => {
				slots.push( String( payload.slot ) );
			},
		);

		const body = mount();
		dblclickTile( body, 'Woo' );
		dblclickTile( body, 'Products' );

		await vi.waitFor( () => {
			if ( ! body.querySelector( '[data-entry-id="7"]' ) ) {
				throw new Error( 'tiles not painted' );
			}
		} );
		body.querySelector< HTMLElement >( '[data-entry-id="7"]' )?.click();

		await vi.waitFor( () => {
			if (
				! body.querySelector( '.desktop-mode-my-wordpress__article' )
			) {
				throw new Error( 'article not rendered' );
			}
		} );

		expect(
			body.querySelector( '.desktop-mode-my-wordpress__article-title' )
				?.textContent,
		).toBe( 'SUMMER20' );
		// The slots still fire, so a plugin panel is the thing the
		// user sees for a content-less type.
		expect( slots ).toEqual( [ 'header', 'meta', 'footer' ] );
		// No empty content div where there is no content.
		expect(
			body.querySelector(
				'.desktop-mode-my-wordpress__article-content',
			),
		).toBeNull();
	} );

	test( 'list-bands splits tiles into labelled bands in order', async () => {
		addFilter(
			'desktop-mode.my-wordpress.list-bands',
			NS,
			() => ( {
				bands: [
					{ id: 'late', label: 'Late', order: 20 },
					{ id: 'early', label: 'Early', order: 10 },
				],
				assign: ( item: Record< string, unknown > ) =>
					Number( item.id ) === 7 ? 'late' : 'early',
			} ),
		);

		const body = mount();
		dblclickTile( body, 'Woo' );
		dblclickTile( body, 'Products' );

		await vi.waitFor( () => {
			if ( ! body.querySelector( '[data-entry-id="7"]' ) ) {
				throw new Error( 'tiles not painted' );
			}
		} );

		const rendered = [
			...body.querySelectorAll< HTMLElement >(
				'.desktop-mode-my-wordpress__band',
			),
		];
		// Only the band that actually received a row is rendered, and
		// the tile landed inside it rather than on the root canvas.
		expect( rendered.map( ( b ) => b.dataset.bandId ) ).toEqual( [ 'late' ] );
		expect(
			rendered[ 0 ].querySelector( '[data-entry-id="7"]' ),
		).not.toBeNull();
		expect(
			rendered[ 0 ].querySelector(
				'.desktop-mode-my-wordpress__band-count',
			)?.textContent,
		).toBe( '1' );
	} );

	test( 'searching a banded section rebuilds its bands', async () => {
		// Regression: the search swap emptied the root container,
		// which detached the band sections — but the band map still
		// pointed at them, so the new results were appended into
		// orphaned canvases whose layouts still held the previous
		// rows' occupied cells. The grid came back overlapping and
		// unscrollable.
		addFilter(
			'desktop-mode.my-wordpress.list-bands',
			NS,
			() => ( {
				bands: [ { id: 'all', label: 'All', order: 10, count: 1 } ],
				assign: () => 'all',
			} ),
		);

		const body = mount();
		dblclickTile( body, 'Woo' );
		dblclickTile( body, 'Products' );

		await vi.waitFor( () => {
			if ( ! body.querySelector( '[data-entry-id="7"]' ) ) {
				throw new Error( 'tiles not painted' );
			}
		} );

		const bandBefore = body.querySelector( '.desktop-mode-my-wordpress__band' );
		expect( bandBefore?.isConnected ).toBe( true );

		const input = body.querySelector< HTMLInputElement >(
			'.desktop-mode-my-wordpress__list-toolbar-search-input',
		);
		expect( input, 'search input present' ).not.toBeNull();
		input!.value = 'shoe';
		input!.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		await vi.waitFor( () => {
			const band = body.querySelector( '.desktop-mode-my-wordpress__band' );
			if ( ! band || band === bandBefore ) {
				throw new Error( 'bands not rebuilt yet' );
			}
		} );

		const bands = [
			...body.querySelectorAll( '.desktop-mode-my-wordpress__band' ),
		];
		// Exactly one band, freshly built, and the result tile lives
		// inside it rather than loose on the root canvas.
		expect( bands ).toHaveLength( 1 );
		expect( bands[ 0 ] ).not.toBe( bandBefore );
		expect( bands[ 0 ].querySelector( '[data-entry-id="7"]' ) ).not.toBeNull();
		// The detached band must not still be referenced anywhere in
		// the tree.
		expect( bandBefore?.isConnected ).toBe( false );
	} );

	test( 'list-tile fires with the tile already in the DOM', async () => {
		// Regression: the action used to fire while the tile was still
		// detached. `<wpd-tile>` paints on connect and its paint drops
		// every `<wpd-ribbon>` child it finds, so a ribbon added
		// beforehand was deleted the moment the tile was appended —
		// the decoration simply never appeared.
		let connected: boolean | null = null;
		addAction(
			'desktop-mode.my-wordpress.list-tile',
			NS,
			( payload: Record< string, unknown > ) => {
				connected = ( payload.tile as HTMLElement ).isConnected;
			},
		);

		const body = mount();
		dblclickTile( body, 'Woo' );
		dblclickTile( body, 'Products' );

		await vi.waitFor( () => {
			if ( connected === null ) {
				throw new Error( 'list-tile not fired' );
			}
		} );

		expect( connected ).toBe( true );
	} );

	test( 'list-tile fires per tile and can decorate it', async () => {
		const seen: number[] = [];
		addAction(
			'desktop-mode.my-wordpress.list-tile',
			NS,
			( payload: Record< string, unknown > ) => {
				seen.push( Number( ( payload.item as { id: number } ).id ) );
				const badge = document.createElement( 'span' );
				badge.className = 'test-badge';
				badge.textContent = 'OUT OF STOCK';
				( payload.tile as HTMLElement ).appendChild( badge );
			},
		);

		const body = mount();
		dblclickTile( body, 'Woo' );
		dblclickTile( body, 'Products' );

		await vi.waitFor( () => {
			if ( ! body.querySelector( '[data-entry-id="7"]' ) ) {
				throw new Error( 'tiles not painted' );
			}
		} );

		expect( seen ).toEqual( [ 7 ] );
		expect(
			body.querySelector( '[data-entry-id="7"] .test-badge' )?.textContent,
		).toBe( 'OUT OF STOCK' );
	} );

	test( 'a subscriber can paint into the header slot', async () => {
		addAction(
			'desktop-mode.my-wordpress.preview-extras',
			NS,
			( payload: Record< string, unknown > ) => {
				if ( payload.slot !== 'header' ) {
					return;
				}
				const el = document.createElement( 'div' );
				el.className = 'test-woo-panel';
				el.textContent = 'SKU SHOE-42';
				( payload.container as HTMLElement ).appendChild( el );
			},
		);

		const body = mount();
		dblclickTile( body, 'Woo' );
		dblclickTile( body, 'Products' );

		await vi.waitFor( () => {
			if ( ! body.querySelector( '[data-entry-id="7"]' ) ) {
				throw new Error( 'tiles not painted' );
			}
		} );
		body.querySelector< HTMLElement >( '[data-entry-id="7"]' )?.click();

		await vi.waitFor( () => {
			if ( ! body.querySelector( '.test-woo-panel' ) ) {
				throw new Error( 'panel not painted' );
			}
		} );

		const panel = body.querySelector( '.test-woo-panel' );
		expect( panel?.textContent ).toBe( 'SKU SHOE-42' );
		// Header slot sits above the rendered content, not after it.
		const article = body.querySelector( '.desktop-mode-my-wordpress__article' );
		const slotEl = article?.querySelector(
			'.desktop-mode-my-wordpress__article-slot--header',
		);
		const content = article?.querySelector(
			'.desktop-mode-my-wordpress__article-content',
		);
		expect(
			slotEl &&
				content &&
				slotEl.compareDocumentPosition( content ) &
					Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	} );
} );
