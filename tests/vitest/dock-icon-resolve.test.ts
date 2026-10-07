import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Dock, type DockItem } from '../../src/dock';
import { hashTitleToHue } from '../../src/ui/util/hash-hue';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';

function makeManagerStub() {
	return {
		getFocused: () => null,
		getAllByBaseId: () => [],
		getAll: () => [],
		getById: () => undefined,
		getActiveDesktopId: () => 'default-1',
	} as unknown as ConstructorParameters< typeof Dock >[ 1 ];
}

function makeItem( overrides: Partial< DockItem > = {} ): DockItem {
	return {
		id: 'some-plugin',
		title: 'Analytics',
		icon: '',
		url: 'http://localhost/wp-admin/admin.php?page=some-plugin',
		badge: 0,
		submenu: [],
		multi: false,
		...overrides,
	};
}

function mountDock(
	items: DockItem[],
	orientation: 'left' | 'right' | 'bottom' = 'bottom',
) {
	const container = document.createElement( 'nav' );
	document.body.appendChild( container );
	const dock = new Dock( container, makeManagerStub(), items, 'http://localhost/wp-admin/', orientation );
	return { container, dock };
}

describe( 'dock icon resolution', () => {
	beforeEach( () => installHooksStub() );
	afterEach( () => {
		clearHooksStub();
		vi.restoreAllMocks();
		document.body.innerHTML = '';
	} );

	test( 'dashicons class renders a dashicon span', () => {
		const { container } = mountDock( [ makeItem( { icon: 'dashicons-chart-bar' } ) ] );
		const icon = container.querySelector( '.dashicons' );
		expect( icon ).not.toBeNull();
		expect( icon?.className ).toContain( 'dashicons-chart-bar' );
		expect( container.querySelector( '.os-dock__item-letter' ) ).toBeNull();
	} );

	test( 'inline SVG data URI paints as a currentColor mask', () => {

		const svg = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
		const { container } = mountDock( [ makeItem( { icon: `data:image/svg+xml;base64,${ svg }` } ) ] );
		const icon = container.querySelector< HTMLElement >( '.os-dock__item-mask' );
		expect( icon ).not.toBeNull();
		expect( icon?.style.getPropertyValue( 'mask' ) ).toContain(
			'data:image/svg+xml;base64,',
		);
		expect( icon?.style.backgroundColor ).toBe( 'currentcolor' );
	} );

	test( 'raw CSS url(...) value reaches the mask unwrapped (live-activation harvest path)', () => {

		const { container } = mountDock( [
			makeItem( {
				icon: 'url("data:image/svg+xml;base64,PHN2Zy8+")',
				title: 'All in One WP Migration',
			} ),
		] );
		const icon = container.querySelector< HTMLElement >(
			'.os-dock__item-mask',
		);
		expect( icon ).not.toBeNull();
		expect( icon?.style.getPropertyValue( 'mask' ) ).toContain(
			'data:image/svg+xml;base64,PHN2Zy8+',
		);

		expect( container.querySelector( '.os-dock__item-letter' ) ).toBeNull();
		expect(
			container.querySelector( '.dashicons-admin-generic' ),
		).toBeNull();
	} );

	test( 'raw CSS url(...) accepts a URL-encoded SVG data URI', () => {

		const url = 'url("data:image/svg+xml,%3Csvg/%3E")';
		const { container } = mountDock( [ makeItem( { icon: url } ) ] );
		const icon = container.querySelector< HTMLElement >(
			'.os-dock__item-mask',
		);
		expect( icon ).not.toBeNull();
		expect( icon?.style.getPropertyValue( 'mask' ) ).toContain(
			'data:image/svg+xml,%3Csvg/%3E',
		);
	} );

	test( 'an unmaskable URL still falls back to the filtered span', () => {

		const { container } = mountDock( [
			makeItem( { icon: 'url("data:image/svg+xml,<svg/>")' } ),
		] );
		const icon = container.querySelector< HTMLElement >(
			'.os-dock__item-svg',
		);
		expect( icon ).not.toBeNull();
		expect( icon?.style.backgroundImage ).toContain( 'data:image/svg+xml,' );
		expect( container.querySelector( '.os-dock__item-mask' ) ).toBeNull();
	} );

	test( 'a gear item takes the ::before mask the hidden admin menu paints', () => {

		const url = 'http://localhost/wp-admin/admin.php?page=elementor-home';
		const menu = document.createElement( 'ul' );
		menu.id = 'adminmenu';
		menu.innerHTML = `<li class="menu-top"><a href="${ url }"><div class="wp-menu-image dashicons-before dashicons-admin-generic"></div></a></li>`;
		document.body.appendChild( menu );
		const wrap = menu.querySelector( '.wp-menu-image' );
		const real = window.getComputedStyle.bind( window );
		vi.spyOn( window, 'getComputedStyle' ).mockImplementation( ( el, pseudo ) =>
			el === wrap && pseudo === '::before'
				? ( {
					backgroundImage: 'none',
					maskImage: 'url("data:image/svg+xml;base64,PHN2Zy8+")',
				} as CSSStyleDeclaration )
				: real( el, pseudo ),
		);

		const { container } = mountDock( [ makeItem( { icon: 'dashicons-admin-generic', url } ) ] );

		const icon = container.querySelector< HTMLElement >( '.os-dock__item-mask' );
		expect( icon?.style.getPropertyValue( 'mask' ) ).toContain( 'data:image/svg+xml;base64,PHN2Zy8+' );
		expect( container.querySelector( '.dashicons-admin-generic' ) ).toBeNull();
	} );

	test( 'http URL renders an <img>', () => {
		const { container } = mountDock( [
			makeItem( { icon: 'http://localhost/plugin-icon.png' } ),
		] );
		const img = container.querySelector< HTMLImageElement >(
			'img.os-dock__item-img',
		);
		expect( img ).not.toBeNull();
		expect( img?.src ).toContain( '/plugin-icon.png' );
	} );

	test( 'missing icon falls back to a letter badge from the title', () => {
		const { container } = mountDock( [ makeItem( { icon: '', title: 'Jetpack' } ) ] );
		const badge = container.querySelector< HTMLElement >(
			'.os-dock__item-letter',
		);
		expect( badge ).not.toBeNull();
		expect( badge?.textContent ).toBe( 'J' );

		expect( badge?.style.background ).toContain( 'linear-gradient' );
		expect( badge?.style.background ).toContain( 'hsl' );
	} );

	test( "'none' icon falls back to the letter badge", () => {
		const { container } = mountDock( [ makeItem( { icon: 'none', title: 'WooCommerce' } ) ] );
		expect(
			container.querySelector< HTMLElement >( '.os-dock__item-letter' )
				?.textContent,
		).toBe( 'W' );
	} );

	test( "'div' sentinel icon falls back to the letter badge", () => {
		const { container } = mountDock( [ makeItem( { icon: 'div', title: 'Yoast SEO' } ) ] );
		expect(
			container.querySelector< HTMLElement >( '.os-dock__item-letter' )
				?.textContent,
		).toBe( 'Y' );
	} );

	test( 'malformed SVG data URI falls back to the letter badge', () => {

		const { container } = mountDock( [
			makeItem( { icon: 'data:image/svg+xml;base64,not-b64!', title: 'Queue' } ),
		] );
		const badge = container.querySelector< HTMLElement >(
			'.os-dock__item-letter',
		);
		expect( badge ).not.toBeNull();
		expect( badge?.textContent ).toBe( 'Q' );
	} );

	test( 'letter uppercases and accepts non-ASCII first characters', () => {
		const { container } = mountDock( [
			makeItem( { icon: '', title: 'über-analytics' } ),
		] );
		expect(
			container.querySelector< HTMLElement >( '.os-dock__item-letter' )
				?.textContent,
		).toBe( 'Ü' );
	} );

	test( 'empty title degrades to ? on the fallback badge', () => {
		const { container } = mountDock( [ makeItem( { icon: '', title: '   ' } ) ] );
		expect(
			container.querySelector< HTMLElement >( '.os-dock__item-letter' )
				?.textContent,
		).toBe( '?' );
	} );
} );

describe( 'hashTitleToHue', () => {
	test( 'is deterministic — same input → same output', () => {
		expect( hashTitleToHue( 'Jetpack' ) ).toBe( hashTitleToHue( 'Jetpack' ) );
		expect( hashTitleToHue( 'WooCommerce' ) ).toBe( hashTitleToHue( 'WooCommerce' ) );
	} );

	test( 'produces a value in [0, 360)', () => {
		for ( const title of [ 'A', 'Jetpack', 'WooCommerce', 'Yoast', 'überwatch', 'plugin-with-dashes' ] ) {
			const hue = hashTitleToHue( title );
			expect( hue ).toBeGreaterThanOrEqual( 0 );
			expect( hue ).toBeLessThan( 360 );
			expect( Number.isInteger( hue ) ).toBe( true );
		}
	} );

	test( 'empty string resolves to a neutral hue', () => {
		expect( hashTitleToHue( '' ) ).toBe( 214 );
	} );

	test( 'tends to spread titles across the hue wheel', () => {

		const titles = [
			'Jetpack',
			'Yoast',
			'WooCommerce',
			'Elementor',
			'Akismet',
			'Wordfence',
			'Contact Form 7',
			'BuddyPress',
			'bbPress',
			'WP Super Cache',
			'Redirection',
			'Query Monitor',
		];
		const hues = titles.map( hashTitleToHue );
		const unique = new Set( hues );

		expect( unique.size ).toBeGreaterThanOrEqual( titles.length - 2 );
	} );
} );

describe( 'Dock.replaceItems', () => {
	beforeEach( () => installHooksStub() );
	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'rebuilds menu tiles with the new list', () => {
		const { container, dock } = mountDock( [
			makeItem( { id: 'plugin-a', title: 'Analytics', icon: 'dashicons-chart-bar' } ),
			makeItem( { id: 'plugin-b', title: 'Backup', icon: 'dashicons-backup' } ),
		] );
		expect( container.querySelectorAll( '.os-dock__item' ).length ).toBe( 2 );

		dock.replaceItems( [
			makeItem( { id: 'plugin-c', title: 'Commerce', icon: 'dashicons-cart' } ),
		] );

		const tiles = container.querySelectorAll( '.os-dock__item' );
		expect( tiles.length ).toBe( 1 );
		const slug = ( tiles[ 0 ] as HTMLElement ).dataset.menuSlug;
		expect( slug ).toBe( 'plugin-c' );
	} );

	test( 'clears everything when passed an empty list', () => {
		const { container, dock } = mountDock( [
			makeItem( { id: 'plugin-a', title: 'Analytics', icon: 'dashicons-chart-bar' } ),
		] );
		expect( container.querySelectorAll( '.os-dock__item' ).length ).toBe( 1 );

		dock.replaceItems( [] );
		expect( container.querySelectorAll( '.os-dock__item' ).length ).toBe( 0 );
	} );

	test( 'preserves system items across a menu replacement', () => {
		const { container, dock } = mountDock( [
			makeItem( { id: 'plugin-a', title: 'Analytics', icon: 'dashicons-chart-bar' } ),
		] );
		dock.appendSystemItem( {
			id: 'os-system',
			title: 'System',
			icon: 'dashicons-admin-generic',
			navKind: 'control',
			onOpen: () => undefined,
		} );

		expect(
			container.querySelector( '.os-dock__item--system' ),
		).not.toBeNull();
		expect( container.querySelector( '.os-dock__separator' ) ).not.toBeNull();

		dock.replaceItems( [
			makeItem( { id: 'plugin-c', title: 'Commerce', icon: 'dashicons-cart' } ),
		] );

		const tiles = container.querySelectorAll( '.os-dock__item' );
		expect( tiles.length ).toBe( 2 );
		expect(
			container.querySelector( '.os-dock__item--system' ),
		).not.toBeNull();
		expect( container.querySelector( '.os-dock__separator' ) ).not.toBeNull();

		const sep = container.querySelector( '.os-dock__separator' );
		const sys = container.querySelector( '.os-dock__item--system' );
		const menuTile = container.querySelector(
			'.os-dock__item:not(.os-dock__item--system)',
		);
		expect( sep ).not.toBeNull();
		expect( sys ).not.toBeNull();
		expect( menuTile ).not.toBeNull();

		expect(
			menuTile!.compareDocumentPosition( sep! ) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			sep!.compareDocumentPosition( sys! ) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	} );
} );

describe( 'dock orientation tooltip anchor', () => {
	beforeEach( () => installHooksStub() );
	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
		document
			.querySelectorAll( '.os-dock__tooltip' )
			.forEach( ( el ) => el.remove() );
	} );

	test( 'left orientation: tooltip has no anchor modifier (default = right of tile)', () => {
		mountDock(
			[ makeItem( { icon: 'dashicons-admin-post' } ) ],
			'left',
		);
		const tip = document.querySelector( '.os-dock__tooltip' );
		expect( tip ).not.toBeNull();
		expect( tip?.classList.contains( 'os-dock__tooltip--above' ) ).toBe( false );
		expect( tip?.classList.contains( 'os-dock__tooltip--before' ) ).toBe( false );
	} );

	test( 'right orientation: tooltip carries --before anchor', () => {
		mountDock(
			[ makeItem( { icon: 'dashicons-admin-post' } ) ],
			'right',
		);
		const tip = document.querySelector( '.os-dock__tooltip' );
		expect( tip?.classList.contains( 'os-dock__tooltip--before' ) ).toBe( true );
	} );

	test( 'bottom orientation: tooltip carries --above anchor', () => {
		mountDock(
			[ makeItem( { icon: 'dashicons-admin-post' } ) ],
			'bottom',
		);
		const tip = document.querySelector( '.os-dock__tooltip' );
		expect( tip?.classList.contains( 'os-dock__tooltip--above' ) ).toBe( true );
	} );
} );
