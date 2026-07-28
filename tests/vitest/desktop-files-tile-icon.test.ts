/**
 * Regression test for the desktop-file tile icon renderer.
 *
 * Pre-0.8.2, `buildTile` in `src/desktop-files/file-tile.ts` glued
 * any non-empty `file.icon()` value onto a `dashicons` class via a
 * sanitizer that stripped slashes / colons / dots. A file-type
 * declaring its `icon` as an http(s) URL or a
 * `data:image/svg+xml;base64,…` data URI ended up with a class
 * like `dashicons httplocalhost8889wp-contentpluginswpd-tumblr…`
 * — broken empty square at render time.
 *
 * The fix routes the icon through the canonical `renderIcon()`
 * dispatch (the same one the wallpaper rail and the dock use),
 * so URL / data URI / dashicons / letter-badge fallback all
 * paint correctly.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';

const SVG_DATA_URI =
	'data:image/svg+xml;base64,' +
	btoa(
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>',
	);

const URL_ICON = 'https://example.test/wp-content/plugins/wpd-tumblr/assets/icon.svg';

interface PlacementOpts {
	icon: string;
}

async function load() {
	vi.resetModules();
	return {
		fileTile: await import( '../../src/desktop-files/file-tile' ),
		registry: await import( '../../src/desktop-files/registry' ),
	};
}

function makePlacement( id: number, opts: PlacementOpts ) {
	return {
		id,
		parentId: 0,
		x: id * 10,
		y: id * 20,
		sortOrder: 0,
		updatedAtMs: 1,
		meta: null,
		file: {
			type: 'shortcut',
			ref: `wpd-tumblr-${ id }`,
			title: 'Tumblr',
			icon: opts.icon,
			previewUrl: '',
			exists: true,
		},
	};
}

describe( 'file-tile icon dispatch (regression — data URI / URL handling)', () => {
	beforeEach( () => {
		installHooksStub();
	} );

	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
		vi.unstubAllGlobals();
	} );

	test( 'data:image/svg+xml URI renders as a background-image, not a Dashicons class', async () => {
		const { fileTile, registry } = await load();
		registry.registerType( { type: 'shortcut', label: 'Shortcut', sort: 100 } );

		const tile = fileTile.buildTile( makePlacement( 1, { icon: SVG_DATA_URI } ), 0 );
		document.body.appendChild( tile );

		const iconEl = tile.querySelector< HTMLElement >( '.desktop-mode-file-tile__icon' );
		expect( iconEl ).not.toBeNull();
		expect( iconEl!.classList.contains( 'dashicons' ) ).toBe( false );
		expect( iconEl!.style.backgroundImage ).toContain( 'data:image/svg+xml;base64,' );
	} );

	test( 'http(s) URL renders as <img>, not a malformed Dashicons class', async () => {
		const { fileTile, registry } = await load();
		registry.registerType( { type: 'shortcut', label: 'Shortcut', sort: 100 } );

		const tile = fileTile.buildTile( makePlacement( 2, { icon: URL_ICON } ), 0 );
		document.body.appendChild( tile );

		// The icon now appears as an <img>, NOT a span with a glued class.
		const img = tile.querySelector< HTMLImageElement >(
			'img.desktop-mode-file-tile__icon',
		);
		expect( img ).not.toBeNull();
		expect( img!.src ).toBe( URL_ICON );
		// And there is NO span carrying the malformed Dashicons class.
		const malformed = tile.querySelector(
			'span.desktop-mode-file-tile__icon.dashicons',
		);
		expect( malformed ).toBeNull();
	} );

	test( 'Dashicons class still routes through the dashicons span path', async () => {
		const { fileTile, registry } = await load();
		registry.registerType( { type: 'shortcut', label: 'Shortcut', sort: 100 } );

		const tile = fileTile.buildTile(
			makePlacement( 3, { icon: 'dashicons-star-filled' } ),
			0,
		);
		document.body.appendChild( tile );

		const iconEl = tile.querySelector< HTMLElement >( '.desktop-mode-file-tile__icon' );
		expect( iconEl ).not.toBeNull();
		expect( iconEl!.classList.contains( 'dashicons' ) ).toBe( true );
		expect( iconEl!.classList.contains( 'dashicons-star-filled' ) ).toBe( true );
	} );
} );
