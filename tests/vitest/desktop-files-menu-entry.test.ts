/**
 * Unit tests for `findMenuEntryForUrl()` — the admin-menu lookup
 * that URL-based openers (wallpaper shortcut tiles, desktop icons)
 * use to enrich their window configs with `submenu` / `parentUrl` /
 * `multi`, so tile-opened windows get the same in-window tab strip
 * a dock open produces.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';

// Same-origin as the jsdom environment — the shortcut opener
// window.open()s cross-origin URLs instead of opening a window.
const ADMIN_URL = `${ window.location.origin }/wp-admin/`;

const TOOLS_ITEM = {
	id: 'menu-tools',
	title: 'Tools',
	icon: 'dashicons-admin-tools',
	url: `${ ADMIN_URL }tools.php`,
	badge: 0,
	submenu: [
		{ title: 'Import', url: `${ ADMIN_URL }import.php` },
		{
			title: 'Sweep',
			url: `${ ADMIN_URL }tools.php?page=wp-sweep%2Fadmin.php`,
		},
	],
	multi: false,
};

const POSTS_ITEM = {
	id: 'menu-posts',
	title: 'Posts',
	icon: 'dashicons-admin-post',
	url: `${ ADMIN_URL }edit.php`,
	badge: 0,
	submenu: [ { title: 'Add New', url: `${ ADMIN_URL }post-new.php` } ],
	multi: true,
};

type WindowWithGlobals = Window & {
	wp?: unknown;
	openStationConfig?: unknown;
};

function stubGlobals( {
	viaApi,
	viaConfig,
}: {
	viaApi?: unknown[];
	viaConfig?: unknown[];
} ): void {
	const w = window as WindowWithGlobals;
	w.wp = viaApi
		? {
				os: {
					getMenuItems: () => viaApi,
					config: { adminUrl: ADMIN_URL },
				},
		  }
		: undefined;
	w.openStationConfig = viaConfig
		? { adminUrl: ADMIN_URL, dockItems: viaConfig }
		: undefined;
}

async function load() {
	vi.resetModules();
	return import( '../../src/desktop-files/menu-entry' );
}

afterEach( () => {
	const w = window as WindowWithGlobals;
	delete w.wp;
	delete w.openStationConfig;
} );

describe( 'findMenuEntryForUrl', () => {
	test( 'matches a top-level item by URL', async () => {
		stubGlobals( { viaApi: [ POSTS_ITEM, TOOLS_ITEM ] } );
		const { findMenuEntryForUrl } = await load();
		const entry = findMenuEntryForUrl( `${ ADMIN_URL }tools.php` );
		expect( entry?.id ).toBe( 'menu-tools' );
		expect( entry?.submenu ).toHaveLength( 2 );
	} );

	test( 'returns the PARENT item for a submenu child URL', async () => {
		stubGlobals( { viaApi: [ POSTS_ITEM, TOOLS_ITEM ] } );
		const { findMenuEntryForUrl } = await load();
		const entry = findMenuEntryForUrl( `${ ADMIN_URL }import.php` );
		expect( entry?.id ).toBe( 'menu-tools' );
	} );

	test( 'ignores transient query params when matching', async () => {
		stubGlobals( { viaApi: [ TOOLS_ITEM ] } );
		const { findMenuEntryForUrl } = await load();
		const entry = findMenuEntryForUrl(
			`${ ADMIN_URL }tools.php?openstation_chromeless=1`,
		);
		expect( entry?.id ).toBe( 'menu-tools' );
	} );

	test( 'returns null when nothing matches', async () => {
		stubGlobals( { viaApi: [ POSTS_ITEM ] } );
		const { findMenuEntryForUrl } = await load();
		expect(
			findMenuEntryForUrl( `${ ADMIN_URL }options-general.php` ),
		).toBeNull();
	} );

	test( 'falls back to the boot config snapshot when the API is absent', async () => {
		stubGlobals( { viaConfig: [ TOOLS_ITEM ] } );
		const { findMenuEntryForUrl } = await load();
		const entry = findMenuEntryForUrl( `${ ADMIN_URL }tools.php` );
		expect( entry?.id ).toBe( 'menu-tools' );
	} );

	test( 'returns null when no adminUrl is available anywhere', async () => {
		const { findMenuEntryForUrl } = await load();
		expect( findMenuEntryForUrl( `${ ADMIN_URL }tools.php` ) ).toBeNull();
	} );
} );

describe( 'shortcut opener enrichment', () => {
	test( 'passes submenu/parentUrl/multi from the matching dock item', async () => {
		const open = vi.fn();

		vi.resetModules();
		const { installHooksStub, clearHooksStub } = await import(
			'./helpers/hooks-stub'
		);
		// installHooksStub REPLACES window.wp — attach `desktop` after.
		installHooksStub();
		( window.wp as unknown as Record< string, unknown > ).os = {
			getMenuItems: () => [ POSTS_ITEM, TOOLS_ITEM ],
			config: { adminUrl: ADMIN_URL },
			windowManager: { open },
		};
		const openers = await import( '../../src/desktop-files/openers' );
		const { registerBuiltInFileOpeners } = await import(
			'../../src/desktop-files/built-in-openers'
		);
		const { DefaultDesktopFile } = await import(
			'../../src/desktop-files/file'
		);
		registerBuiltInFileOpeners();

		const opener = openers.resolveOpener( 'shortcut' );
		expect( opener ).not.toBeNull();
		const file = new DefaultDesktopFile(
			{
				type: 'shortcut',
				ref: 'dock-promoted:menu-tools',
				title: 'Tools',
				icon: 'dashicons-admin-tools',
				previewUrl: '',
				exists: true,
				shortcutUrl: `${ ADMIN_URL }tools.php`,
			} as ConstructorParameters< typeof DefaultDesktopFile >[ 0 ],
			'shortcut',
		);
		if ( opener?.handler.kind === 'js' ) {
			await opener.handler.open( file );
		}

		expect( open ).toHaveBeenCalledTimes( 1 );
		const cfg = open.mock.calls[ 0 ][ 0 ];
		expect( cfg.url ).toBe( `${ ADMIN_URL }tools.php` );
		expect( cfg.parentUrl ).toBe( `${ ADMIN_URL }tools.php` );
		expect( cfg.submenu ).toHaveLength( 2 );
		expect( cfg.multi ).toBe( false );
		clearHooksStub();
	} );

	test( 'omits enrichment gracefully when no dock entry matches', async () => {
		const open = vi.fn();

		vi.resetModules();
		const { installHooksStub, clearHooksStub } = await import(
			'./helpers/hooks-stub'
		);
		installHooksStub();
		( window.wp as unknown as Record< string, unknown > ).os = {
			getMenuItems: () => [ POSTS_ITEM ],
			config: { adminUrl: ADMIN_URL },
			windowManager: { open },
		};
		const openers = await import( '../../src/desktop-files/openers' );
		const { registerBuiltInFileOpeners } = await import(
			'../../src/desktop-files/built-in-openers'
		);
		const { DefaultDesktopFile } = await import(
			'../../src/desktop-files/file'
		);
		registerBuiltInFileOpeners();

		const opener = openers.resolveOpener( 'shortcut' );
		const file = new DefaultDesktopFile(
			{
				type: 'shortcut',
				ref: 'dock-promoted:menu-settings',
				title: 'Settings',
				icon: 'dashicons-admin-settings',
				previewUrl: '',
				exists: true,
				shortcutUrl: `${ ADMIN_URL }options-general.php`,
			} as ConstructorParameters< typeof DefaultDesktopFile >[ 0 ],
			'shortcut',
		);
		if ( opener?.handler.kind === 'js' ) {
			await opener.handler.open( file );
		}

		expect( open ).toHaveBeenCalledTimes( 1 );
		const cfg = open.mock.calls[ 0 ][ 0 ];
		expect( cfg.url ).toBe( `${ ADMIN_URL }options-general.php` );
		expect( cfg.parentUrl ).toBe( `${ ADMIN_URL }options-general.php` );
		expect( cfg.submenu ).toBeUndefined();
		expect( cfg.multi ).toBe( false );
		clearHooksStub();
	} );
} );
