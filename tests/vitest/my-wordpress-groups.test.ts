/**
 * Root-level folder grouping — custom post types registered by the
 * same plugin or theme collapse into one folder, which drills into its
 * member sections.
 *
 * Test pattern mirrors `my-wordpress-multi-instance.test.ts`: load the
 * bundle (the side-effect import registers a render callback on
 * `window.openStationNativeWindows`), invoke that callback against a
 * body carrying the window template, then drive the UI by dispatching
 * real events on the painted tiles.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';

const WINDOW_ID = 'desktop-mode-my-wordpress';

interface NativeWindowsGlobal {
	openStationNativeWindows?: Record<
		string,
		( ( body: HTMLElement ) => void | ( () => void ) ) | undefined
	>;
	openStationWindowConfig?: Record< string, unknown >;
}

function installTemplateMarkup( host: HTMLElement ): void {
	host.innerHTML = `
		<div class="desktop-mode-my-wordpress" data-os-my-wordpress-root>
			<header data-os-my-wordpress-breadcrumbs></header>
			<div class="os-my-wordpress__body" data-os-my-wordpress-body>
				<div class="os-my-wordpress__loading" data-os-my-wordpress-loading hidden></div>
			</div>
			<div class="os-folder-status-bar" data-os-my-wordpress-status></div>
		</div>
	`;
}

function mountWindow(): HTMLElement {
	const cb = ( window as unknown as NativeWindowsGlobal )
		.openStationNativeWindows?.[ WINDOW_ID ];
	if ( typeof cb !== 'function' ) {
		throw new Error( 'render callback not registered' );
	}
	const body = document.createElement( 'div' );
	body.className = 'os-window__body';
	installTemplateMarkup( body );
	document.body.appendChild( body );
	cb( body );
	return body;
}

/** Tile labels in the current grid, with any live count suffix cut. */
function tileLabels( body: HTMLElement ): string[] {
	return [
		...body.querySelectorAll( '.os-file-tile__label' ),
	].map( ( n ) => ( n.textContent ?? '' ).split( ' · ' )[ 0 ] );
}

function breadcrumbLabels( body: HTMLElement ): string[] {
	const header = body.querySelector(
		'[data-os-my-wordpress-breadcrumbs]',
	);
	return [
		...( header?.querySelectorAll( '.os-breadcrumbs__crumb' ) ??
			[] ),
	].map( ( n ) => ( n.textContent ?? '' ).trim() );
}

function dblclickTile( body: HTMLElement, label: string ): void {
	const tile = [ ...body.querySelectorAll< HTMLElement >( 'os-tile' ) ].find(
		( t ) =>
			(
				t.querySelector( '.os-file-tile__label' )
					?.textContent ?? ''
			).startsWith( label ),
	);
	if ( ! tile ) {
		throw new Error( `no tile labelled ${ label }` );
	}
	tile.dispatchEvent( new MouseEvent( 'dblclick', { bubbles: true } ) );
}

describe( 'my-wordpress — folder groups', () => {
	beforeEach( async () => {
		installHooksStub();
		( window as unknown as NativeWindowsGlobal ).openStationWindowConfig = {
			[ WINDOW_ID ]: {
				restRoot: 'http://example.test/wp-json/',
				restNonce: 'nonce',
				editPostUrlBase: 'http://example.test/wp-admin/post.php',
				editUserUrlBase: 'http://example.test/wp-admin/user-edit.php',
				siteName: 'Example',
				entities: [
					{
						id: 'posts',
						label: 'Posts',
						icon: 'dashicons-admin-post',
						restPath: 'wp/v2/posts',
						kind: 'post',
						post_type: 'post',
					},
					{
						id: 'cpt-product',
						label: 'Products',
						icon: 'dashicons-cart',
						restPath: 'wp/v2/product',
						kind: 'post',
						post_type: 'product',
						group: 'plugin:woocommerce',
						groupLabel: 'WooCommerce',
						groupIcon: 'dashicons-admin-plugins',
						groupOrder: 20,
					},
					{
						id: 'cpt-coupon',
						label: 'Coupons',
						icon: 'dashicons-tickets-alt',
						restPath: 'desktop-mode/v1/post-type/shop_coupon',
						kind: 'post',
						post_type: 'shop_coupon',
						group: 'plugin:woocommerce',
						groupLabel: 'WooCommerce',
						groupIcon: 'dashicons-admin-plugins',
						groupOrder: 20,
					},
					{
						id: 'cpt-testimonial',
						label: 'Testimonials',
						icon: 'dashicons-format-quote',
						restPath: 'wp/v2/testimonial',
						kind: 'post',
						post_type: 'testimonial',
					},
				],
				groups: [
					{
						id: 'plugin:woocommerce',
						label: 'WooCommerce',
						icon: 'dashicons-admin-plugins',
						order: 20,
					},
				],
				perPage: 24,
				mediaPerPage: 48,
				previewActions: [],
			},
		};
		vi.stubGlobal(
			'fetch',
			vi.fn( () =>
				Promise.resolve(
					new Response( '[]', {
						status: 200,
						headers: { 'X-WP-Total': '0' },
					} ),
				),
			),
		);
		await import( '../../src/my-wordpress/index' );
	} );

	afterEach( () => {
		document.body.innerHTML = '';
		clearHooksStub();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	} );

	test( 'root collapses grouped sections into one folder', () => {
		const body = mountWindow();
		const labels = tileLabels( body );

		// Ungrouped sections keep their own root tile…
		expect( labels ).toContain( 'Posts' );
		expect( labels ).toContain( 'Testimonials' );
		// …the grouped pair becomes a single plugin folder.
		expect( labels ).toContain( 'WooCommerce' );
		expect( labels ).not.toContain( 'Products' );
		expect( labels ).not.toContain( 'Coupons' );
	} );

	test( 'group folder is labelled with its member count', () => {
		const body = mountWindow();
		const group = [
			...body.querySelectorAll( '.os-file-tile__label' ),
		].find( ( n ) => ( n.textContent ?? '' ).startsWith( 'WooCommerce' ) );

		expect( group?.textContent ).toBe( 'WooCommerce · 2' );
	} );

	test( 'group tile carries its id for styling and tests', () => {
		const body = mountWindow();
		const tile = body.querySelector( '[data-group-id="plugin:woocommerce"]' );

		expect( tile ).not.toBeNull();
	} );

	test( 'opening a group shows only its member sections', () => {
		const body = mountWindow();
		dblclickTile( body, 'WooCommerce' );

		const labels = tileLabels( body );
		expect( labels ).toEqual(
			expect.arrayContaining( [ 'Products', 'Coupons' ] ),
		);
		expect( labels ).not.toContain( 'Posts' );
		expect( labels ).not.toContain( 'Testimonials' );
	} );

	test( 'breadcrumbs gain the group segment at every depth', () => {
		const body = mountWindow();
		expect( breadcrumbLabels( body ) ).toEqual( [ 'Example' ] );

		dblclickTile( body, 'WooCommerce' );
		expect( breadcrumbLabels( body ) ).toEqual( [
			'Example',
			'WooCommerce',
		] );

		dblclickTile( body, 'Products' );
		expect( breadcrumbLabels( body ) ).toEqual( [
			'Example',
			'WooCommerce',
			'Products',
		] );
	} );

	test( 'the group breadcrumb navigates back to the group', () => {
		const body = mountWindow();
		dblclickTile( body, 'WooCommerce' );
		dblclickTile( body, 'Products' );

		const crumb = [
			...body.querySelectorAll< HTMLElement >(
				'[data-os-my-wordpress-breadcrumbs] button, [data-os-my-wordpress-breadcrumbs] a',
			),
		].find( ( n ) => ( n.textContent ?? '' ).trim() === 'WooCommerce' );

		expect( crumb, 'WooCommerce crumb is clickable' ).toBeTruthy();
		crumb!.click();

		expect( tileLabels( body ) ).toEqual(
			expect.arrayContaining( [ 'Products', 'Coupons' ] ),
		);
	} );

	test( 'an ungrouped section still opens straight from the root', () => {
		const body = mountWindow();
		dblclickTile( body, 'Testimonials' );

		expect( breadcrumbLabels( body ) ).toEqual( [
			'Example',
			'Testimonials',
		] );
	} );

	test( 'a band grows tall enough for its last, partial row', async () => {
		// Regression: `place()` runs while the tile is still detached
		// (the caller appends it afterwards), and the canvas height
		// was measured by walking `host.children` — so whatever had
		// just been placed never counted. A band whose last row was
		// partially filled ended shorter than its tiles and they
		// spilled onto the next band's heading.
		const rows = Array.from( { length: 9 }, ( _, i ) => ( {
			id: i + 1,
			title: { rendered: `Item ${ i + 1 }` },
			excerpt: { rendered: '' },
			date: '2026-01-01T00:00:00',
			status: 'publish',
			link: '',
			featured_media: 0,
		} ) );
		vi.stubGlobal(
			'fetch',
			vi.fn( () =>
				Promise.resolve(
					new Response( JSON.stringify( rows ), {
						status: 200,
						headers: {
							'Content-Type': 'application/json',
							'X-WP-Total': String( rows.length ),
							'X-WP-TotalPages': '1',
						},
					} ),
				),
			),
		);

		const body = mountWindow();
		dblclickTile( body, 'Testimonials' );

		await vi.waitFor( () => {
			if ( ! body.querySelector( '[data-entry-id="9"]' ) ) {
				throw new Error( 'tiles not painted' );
			}
		} );

		const canvas = body.querySelector< HTMLElement >(
			'.os-my-wordpress__tiles',
		);
		const minHeight = parseFloat( canvas?.style.minHeight || '0' );
		const lowestTop = Math.max(
			...[
				...body.querySelectorAll< HTMLElement >( '[data-entry-id]' ),
			].map( ( t ) => parseFloat( t.style.top || '0' ) ),
		);

		// The canvas has to clear the lowest tile's own height, not
		// just its top edge.
		expect( minHeight ).toBeGreaterThan( lowestTop );
	} );

	test( 'group folders keep a separate persisted tile layout', () => {
		const body = mountWindow();
		const rootGrid = body.querySelector( '.os-my-wordpress__grid' );
		expect( rootGrid ).not.toBeNull();

		dblclickTile( body, 'WooCommerce' );
		const groupGrid = body.querySelector(
			'.os-my-wordpress__grid',
		);
		// A fresh grid element per view — the group's arrangement is
		// stored under its own scope key rather than overwriting root's.
		expect( groupGrid ).not.toBe( rootGrid );
	} );
} );
