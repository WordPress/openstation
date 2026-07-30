/**
 * Icon-resolver + letter-badge fallback tests for `src/dock.ts`.
 *
 * The resolver is a private method so we exercise it through the
 * public `Dock` constructor — render the dock, inspect the produced
 * DOM. That also catches any caller/callee skew between
 * `createItemButton` / `createSystemItemButton` and the icon path.
 *
 * The title→hue hash is exported directly — it's a pure function and
 * the hash stability is a public contract (same plugin, same colour
 * across reloads), so it gets its own tests.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Dock, type DockItem } from '../../src/dock';
import { hashTitleToHue } from '../../src/ui/util/hash-hue';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';

// Minimal WindowManager stub. The icon resolver never consults the
// manager, so the Dock doesn't need the real one — just enough
// surface to satisfy the constructor + updateActiveStates().
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
		document.body.innerHTML = '';
	} );

	test( 'dashicons class renders a dashicon span', () => {
		const { container } = mountDock( [ makeItem( { icon: 'dashicons-chart-bar' } ) ] );
		const icon = container.querySelector( '.dashicons' );
		expect( icon ).not.toBeNull();
		expect( icon?.className ).toContain( 'dashicons-chart-bar' );
		expect( container.querySelector( '.desktop-mode-dock__item-letter' ) ).toBeNull();
	} );

	test( 'inline SVG data URI paints as a currentColor mask', () => {
		// Not a `filter: brightness(0) invert(1)` background any more:
		// that flattened plugin art to WHITE, a colour no theme could
		// name. A mask flattens the same way — alpha only — and takes
		// the tile's glyph colour, so these follow
		// `--desktop-mode-dock-icon-color` like the dashicons do.
		const svg = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
		const { container } = mountDock( [ makeItem( { icon: `data:image/svg+xml;base64,${ svg }` } ) ] );
		const icon = container.querySelector< HTMLElement >( '.desktop-mode-dock__item-mask' );
		expect( icon ).not.toBeNull();
		expect( icon?.style.getPropertyValue( 'mask' ) ).toContain(
			'data:image/svg+xml;base64,',
		);
		expect( icon?.style.backgroundColor ).toBe( 'currentcolor' );
	} );

	test( 'raw CSS url(...) value reaches the mask unwrapped (live-activation harvest path)', () => {
		// includes/render/chromeless-bridge.php harvests the iframe's
		// computed `::before { background-image }` for plugins whose
		// menu icon is registered via CSS (icon = 'none'/'div'). The
		// harvested value is a raw `url(...)` string and must reach the
		// dock without going through a data-URI re-encode. The wrapper
		// is stripped before validation — `isMaskableIcon()` rejects
		// the quotes and parens, not the URL inside them.
		const { container } = mountDock( [
			makeItem( {
				icon: 'url("data:image/svg+xml;base64,PHN2Zy8+")',
				title: 'All in One WP Migration',
			} ),
		] );
		const icon = container.querySelector< HTMLElement >(
			'.desktop-mode-dock__item-mask',
		);
		expect( icon ).not.toBeNull();
		expect( icon?.style.getPropertyValue( 'mask' ) ).toContain(
			'data:image/svg+xml;base64,PHN2Zy8+',
		);
		// And it must NOT have collapsed to the gear or a letter badge.
		expect( container.querySelector( '.desktop-mode-dock__item-letter' ) ).toBeNull();
		expect(
			container.querySelector( '.dashicons-admin-generic' ),
		).toBeNull();
	} );

	test( 'raw CSS url(...) accepts a URL-encoded SVG data URI', () => {
		// The harvest also needs to round-trip non-base64 data URIs
		// (some plugins use `data:image/svg+xml,<percent-encoded>` in
		// their CSS). Percent-encoded payloads carry no literal quote,
		// paren or space, so they mask like any other.
		const url = 'url("data:image/svg+xml,%3Csvg/%3E")';
		const { container } = mountDock( [ makeItem( { icon: url } ) ] );
		const icon = container.querySelector< HTMLElement >(
			'.desktop-mode-dock__item-mask',
		);
		expect( icon ).not.toBeNull();
		expect( icon?.style.getPropertyValue( 'mask' ) ).toContain(
			'data:image/svg+xml,%3Csvg/%3E',
		);
	} );

	test( 'an unmaskable URL still falls back to the filtered span', () => {
		// A data URI with literal `<`/`>` (some plugins skip the
		// encoding) cannot be interpolated into a CSS `url("…")`
		// safely. The background-image path and its whitening filter
		// remain, so the icon degrades instead of disappearing.
		const { container } = mountDock( [
			makeItem( { icon: 'url("data:image/svg+xml,<svg/>")' } ),
		] );
		const icon = container.querySelector< HTMLElement >(
			'.desktop-mode-dock__item-svg',
		);
		expect( icon ).not.toBeNull();
		expect( icon?.style.backgroundImage ).toContain( 'data:image/svg+xml,' );
		expect( container.querySelector( '.desktop-mode-dock__item-mask' ) ).toBeNull();
	} );

	test( 'http URL renders an <img>', () => {
		const { container } = mountDock( [
			makeItem( { icon: 'http://localhost/plugin-icon.png' } ),
		] );
		const img = container.querySelector< HTMLImageElement >(
			'img.desktop-mode-dock__item-img',
		);
		expect( img ).not.toBeNull();
		expect( img?.src ).toContain( '/plugin-icon.png' );
	} );

	test( 'missing icon falls back to a letter badge from the title', () => {
		const { container } = mountDock( [ makeItem( { icon: '', title: 'Jetpack' } ) ] );
		const badge = container.querySelector< HTMLElement >(
			'.desktop-mode-dock__item-letter',
		);
		expect( badge ).not.toBeNull();
		expect( badge?.textContent ).toBe( 'J' );
		// Background gradient was written inline and references HSL.
		expect( badge?.style.background ).toContain( 'linear-gradient' );
		expect( badge?.style.background ).toContain( 'hsl' );
	} );

	test( "'none' icon falls back to the letter badge", () => {
		const { container } = mountDock( [ makeItem( { icon: 'none', title: 'WooCommerce' } ) ] );
		expect(
			container.querySelector< HTMLElement >( '.desktop-mode-dock__item-letter' )
				?.textContent,
		).toBe( 'W' );
	} );

	test( "'div' sentinel icon falls back to the letter badge", () => {
		const { container } = mountDock( [ makeItem( { icon: 'div', title: 'Yoast SEO' } ) ] );
		expect(
			container.querySelector< HTMLElement >( '.desktop-mode-dock__item-letter' )
				?.textContent,
		).toBe( 'Y' );
	} );

	test( 'malformed SVG data URI falls back to the letter badge', () => {
		// Payload isn't valid base64 — resolver rejects it and falls
		// through to the letter badge rather than shipping a broken image.
		const { container } = mountDock( [
			makeItem( { icon: 'data:image/svg+xml;base64,not-b64!', title: 'Queue' } ),
		] );
		const badge = container.querySelector< HTMLElement >(
			'.desktop-mode-dock__item-letter',
		);
		expect( badge ).not.toBeNull();
		expect( badge?.textContent ).toBe( 'Q' );
	} );

	test( 'letter uppercases and accepts non-ASCII first characters', () => {
		const { container } = mountDock( [
			makeItem( { icon: '', title: 'über-analytics' } ),
		] );
		expect(
			container.querySelector< HTMLElement >( '.desktop-mode-dock__item-letter' )
				?.textContent,
		).toBe( 'Ü' );
	} );

	test( 'empty title degrades to ? on the fallback badge', () => {
		const { container } = mountDock( [ makeItem( { icon: '', title: '   ' } ) ] );
		expect(
			container.querySelector< HTMLElement >( '.desktop-mode-dock__item-letter' )
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
		// Twelve realistic plugin names — we don't guarantee perfect
		// distribution, but we do guarantee they're not all collapsed
		// to the same hue. "All distinct" is stronger than the
		// contract but a useful smoke signal that the hash is working.
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
		// Two collisions worth of slack — the algorithm is a weak
		// hash, but still shouldn't collapse real-world titles to a
		// single bucket.
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
		expect( container.querySelectorAll( '.desktop-mode-dock__item' ).length ).toBe( 2 );

		dock.replaceItems( [
			makeItem( { id: 'plugin-c', title: 'Commerce', icon: 'dashicons-cart' } ),
		] );

		const tiles = container.querySelectorAll( '.desktop-mode-dock__item' );
		expect( tiles.length ).toBe( 1 );
		const slug = ( tiles[ 0 ] as HTMLElement ).dataset.menuSlug;
		expect( slug ).toBe( 'plugin-c' );
	} );

	test( 'clears everything when passed an empty list', () => {
		const { container, dock } = mountDock( [
			makeItem( { id: 'plugin-a', title: 'Analytics', icon: 'dashicons-chart-bar' } ),
		] );
		expect( container.querySelectorAll( '.desktop-mode-dock__item' ).length ).toBe( 1 );

		dock.replaceItems( [] );
		expect( container.querySelectorAll( '.desktop-mode-dock__item' ).length ).toBe( 0 );
	} );

	test( 'preserves system items across a menu replacement', () => {
		const { container, dock } = mountDock( [
			makeItem( { id: 'plugin-a', title: 'Analytics', icon: 'dashicons-chart-bar' } ),
		] );
		dock.appendSystemItem( {
			id: 'os-settings',
			title: 'OS Settings',
			icon: 'dashicons-admin-generic',
			onOpen: () => undefined,
		} );

		// Menu item + separator + system item.
		expect(
			container.querySelector( '.desktop-mode-dock__item--system' ),
		).not.toBeNull();
		expect( container.querySelector( '.desktop-mode-dock__separator' ) ).not.toBeNull();

		dock.replaceItems( [
			makeItem( { id: 'plugin-c', title: 'Commerce', icon: 'dashicons-cart' } ),
		] );

		// After replacement: new menu tile + original separator + original system tile.
		const tiles = container.querySelectorAll( '.desktop-mode-dock__item' );
		expect( tiles.length ).toBe( 2 ); // 1 menu + 1 system
		expect(
			container.querySelector( '.desktop-mode-dock__item--system' ),
		).not.toBeNull();
		expect( container.querySelector( '.desktop-mode-dock__separator' ) ).not.toBeNull();

		// Menu item must come BEFORE the separator (rendering order).
		const sep = container.querySelector( '.desktop-mode-dock__separator' );
		const sys = container.querySelector( '.desktop-mode-dock__item--system' );
		const menuTile = container.querySelector(
			'.desktop-mode-dock__item:not(.desktop-mode-dock__item--system)',
		);
		expect( sep ).not.toBeNull();
		expect( sys ).not.toBeNull();
		expect( menuTile ).not.toBeNull();
		// DOM position check — menu tile < separator < system tile
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
			.querySelectorAll( '.desktop-mode-dock__tooltip' )
			.forEach( ( el ) => el.remove() );
	} );

	// The dock no longer carries orientation modifier classes — placement
	// is driven by `data-desktop-mode-dock-placement` on the shell root and
	// CSS keys off that. The runtime artifact of orientation is the
	// tooltip anchor class, which flips so the label sits outside the
	// rail on whichever edge it hugs.

	test( 'left orientation: tooltip has no anchor modifier (default = right of tile)', () => {
		mountDock(
			[ makeItem( { icon: 'dashicons-admin-post' } ) ],
			'left',
		);
		const tip = document.querySelector( '.desktop-mode-dock__tooltip' );
		expect( tip ).not.toBeNull();
		expect( tip?.classList.contains( 'desktop-mode-dock__tooltip--above' ) ).toBe( false );
		expect( tip?.classList.contains( 'desktop-mode-dock__tooltip--before' ) ).toBe( false );
	} );

	test( 'right orientation: tooltip carries --before anchor', () => {
		mountDock(
			[ makeItem( { icon: 'dashicons-admin-post' } ) ],
			'right',
		);
		const tip = document.querySelector( '.desktop-mode-dock__tooltip' );
		expect( tip?.classList.contains( 'desktop-mode-dock__tooltip--before' ) ).toBe( true );
	} );

	test( 'bottom orientation: tooltip carries --above anchor', () => {
		mountDock(
			[ makeItem( { icon: 'dashicons-admin-post' } ) ],
			'bottom',
		);
		const tip = document.querySelector( '.desktop-mode-dock__tooltip' );
		expect( tip?.classList.contains( 'desktop-mode-dock__tooltip--above' ) ).toBe( true );
	} );
} );
