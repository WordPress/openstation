/**
 * Tile renderer — `placement.meta.iconUrl` precedence.
 *
 * The favicon resolver attaches a base64 data URI to the
 * placement's meta during `link` creation; the tile renderer
 * must paint that data URI in place of the file type's generic
 * dashicon.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';

const PNG_DATA_URI =
	'data:image/png;base64,' +
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWMQEhT' +
	'wDwACzwExt7K1+QAAAABJRU5ErkJggg==';

interface PlacementOpts {
	icon: string;
	meta: Record< string, unknown > | null;
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
		meta: opts.meta,
		file: {
			type: 'link',
			ref: `https://example.test/${ id }`,
			title: 'example.test',
			icon: opts.icon,
			previewUrl: '',
			exists: true,
		},
	};
}

describe( 'file-tile — meta.iconUrl precedence', () => {
	beforeEach( () => {
		installHooksStub();
	} );

	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'meta.iconUrl renders an <img> with the data URI as src', async () => {
		const { fileTile, registry } = await load();
		registry.registerType( { type: 'link', label: 'Web link', sort: 70 } );

		const tile = fileTile.buildTile(
			makePlacement( 1, {
				icon: 'dashicons-admin-links',
				meta: { iconUrl: PNG_DATA_URI },
			} ),
			0,
		);
		document.body.appendChild( tile );

		const img = tile.querySelector< HTMLImageElement >(
			'img.desktop-mode-file-tile__icon',
		);
		expect( img ).not.toBeNull();
		expect( img!.src ).toBe( PNG_DATA_URI );
		expect( tile.hasAttribute( 'favicon' ) ).toBe( true );
		expect(
			tile.querySelector( '.desktop-mode-file-tile__visual--favicon' ),
		).not.toBeNull();
		// `<img>` is `draggable=true` by default — leaving it that
		// way lets the browser hijack the parent tile's pointer
		// gesture with a native image-drag, breaking rearrange.
		expect( img!.draggable ).toBe( false );
		// The dashicon span must NOT be present — meta wins.
		expect(
			tile.querySelector( 'span.desktop-mode-file-tile__icon.dashicons' ),
		).toBeNull();
	} );

	test( 'empty meta.iconUrl falls back to file.icon() dashicon', async () => {
		const { fileTile, registry } = await load();
		registry.registerType( { type: 'link', label: 'Web link', sort: 70 } );

		const tile = fileTile.buildTile(
			makePlacement( 2, {
				icon: 'dashicons-admin-links',
				meta: { iconUrl: '' },
			} ),
			0,
		);
		document.body.appendChild( tile );

		const iconEl = tile.querySelector< HTMLElement >(
			'.desktop-mode-file-tile__icon',
		);
		expect( iconEl ).not.toBeNull();
		expect( iconEl!.classList.contains( 'dashicons' ) ).toBe( true );
		expect( iconEl!.classList.contains( 'dashicons-admin-links' ) ).toBe( true );
		expect( tile.hasAttribute( 'favicon' ) ).toBe( false );
	} );

	test( 'missing meta falls back to file.icon() dashicon', async () => {
		const { fileTile, registry } = await load();
		registry.registerType( { type: 'link', label: 'Web link', sort: 70 } );

		const tile = fileTile.buildTile(
			makePlacement( 3, {
				icon: 'dashicons-admin-links',
				meta: null,
			} ),
			0,
		);
		document.body.appendChild( tile );

		const iconEl = tile.querySelector< HTMLElement >(
			'.desktop-mode-file-tile__icon',
		);
		expect( iconEl ).not.toBeNull();
		expect( iconEl!.classList.contains( 'dashicons-admin-links' ) ).toBe( true );
	} );

	test( 'whitespace-only meta.iconUrl falls back to dashicon', async () => {
		const { fileTile, registry } = await load();
		registry.registerType( { type: 'link', label: 'Web link', sort: 70 } );

		const tile = fileTile.buildTile(
			makePlacement( 4, {
				icon: 'dashicons-admin-links',
				meta: { iconUrl: '   ' },
			} ),
			0,
		);
		document.body.appendChild( tile );

		const iconEl = tile.querySelector< HTMLElement >(
			'.desktop-mode-file-tile__icon',
		);
		expect( iconEl ).not.toBeNull();
		expect( iconEl!.classList.contains( 'dashicons-admin-links' ) ).toBe( true );
	} );
} );
