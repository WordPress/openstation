/**
 * Featured-image tiles — an entry with a featured image renders the
 * image in place of the section dashicon, which is what turns a
 * WooCommerce Products folder into a photo grid.
 *
 * Drives the real render callback with a stubbed REST response so the
 * assertion covers the whole path: `_embed=wp:featuredmedia` payload →
 * `getThumbnail()` → `buildIconTile()` → `<os-tile>`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';

const WINDOW_ID = 'desktop-mode-my-wordpress';
const THUMB = 'http://example.test/uploads/shoe-300x300.jpg';

interface NativeWindowsGlobal {
	openStationNativeWindows?: Record<
		string,
		( ( body: HTMLElement ) => void | ( () => void ) ) | undefined
	>;
	openStationWindowConfig?: Record< string, unknown >;
}

function entityRow( id: number, withImage: boolean ) {
	return {
		id,
		title: { rendered: `Item ${ id }` },
		excerpt: { rendered: '' },
		date: '2026-01-01T00:00:00',
		status: 'publish',
		featured_media: withImage ? 99 : 0,
		link: `http://example.test/?p=${ id }`,
		_embedded: withImage
			? {
				'wp:featuredmedia': [
					{
						source_url: THUMB,
						media_details: {
							sizes: { medium: { source_url: THUMB } },
						},
					},
				],
			}
			: undefined,
	};
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

function config( thumbnails: boolean | undefined ) {
	return {
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
					...( thumbnails === undefined ? {} : { thumbnails } ),
				},
			],
			groups: [],
			perPage: 24,
			mediaPerPage: 48,
			previewActions: [],
		},
	};
}

/** Mount the window and drill into the Products section. */
async function openSection(): Promise< HTMLElement > {
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

	const tile = body.querySelector< HTMLElement >(
		'[data-entity-id="cpt-product"]',
	);
	tile?.dispatchEvent( new MouseEvent( 'dblclick', { bubbles: true } ) );

	// Let the list fetch settle.
	await vi.waitFor( () => {
		if ( ! body.querySelector( '[data-entry-id]' ) ) {
			throw new Error( 'entries not painted yet' );
		}
	} );
	return body;
}

describe( 'my-wordpress — featured-image tiles', () => {
	beforeEach( async () => {
		installHooksStub();
		vi.stubGlobal(
			'fetch',
			vi.fn( () =>
				Promise.resolve(
					new Response(
						JSON.stringify( [
							entityRow( 1, true ),
							entityRow( 2, false ),
						] ),
						{
							status: 200,
							headers: {
								'Content-Type': 'application/json',
								'X-WP-Total': '2',
								'X-WP-TotalPages': '1',
							},
						},
					),
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

	test( 'an entry with a featured image renders it in place of the icon', async () => {
		( window as unknown as NativeWindowsGlobal ).openStationWindowConfig =
			config( undefined );

		const body = await openSection();
		const withImage = body.querySelector( '[data-entry-id="1"]' );

		expect( withImage?.getAttribute( 'thumbnail' ) ).toBe( THUMB );
		const img = withImage?.querySelector< HTMLImageElement >(
			'.os-file-tile__preview',
		);
		expect( img?.getAttribute( 'src' ) ).toBe( THUMB );
	} );

	test( 'an entry without one falls back to the section icon', async () => {
		( window as unknown as NativeWindowsGlobal ).openStationWindowConfig =
			config( undefined );

		const body = await openSection();
		const withoutImage = body.querySelector( '[data-entry-id="2"]' );

		expect( withoutImage?.hasAttribute( 'thumbnail' ) ).toBe( false );
		expect(
			withoutImage?.querySelector( '.os-file-tile__icon' ),
		).not.toBeNull();
	} );

	test( 'a section can opt out with thumbnails: false', async () => {
		( window as unknown as NativeWindowsGlobal ).openStationWindowConfig =
			config( false );

		const body = await openSection();
		const withImage = body.querySelector( '[data-entry-id="1"]' );

		expect( withImage?.hasAttribute( 'thumbnail' ) ).toBe( false );
		expect(
			withImage?.querySelector( '.os-file-tile__icon' ),
		).not.toBeNull();
	} );
} );
