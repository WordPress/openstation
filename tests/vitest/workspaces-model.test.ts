/**
 * Workspaces — the model, as a table.
 *
 * Three rules this file exists to pin, because breaking any of them
 * is silent:
 *
 * 1. **A template resolves against the live navigation**, so the
 *    Commerce desk on a site without WooCommerce is a smaller desk
 *    rather than four permission errors.
 * 2. **A workspace narrows the view, it never edits the settings.**
 *    `workspacePlacements` returns a NEW map and leaves the user's own
 *    `navPlacement` untouched — the identity check below is the whole
 *    guarantee that switching desks and back is lossless.
 * 3. **Controls are never hidden.** A workspace that could hide
 *    Overview, System, Trash or Exit could strand the user on a desk
 *    with no way to change it.
 */

import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import type { NavItem, NavKind, NavPlacement } from '../../src/nav';
import {
	blankWorkspaceProfile,
	captureWorkspaceAppearance,
	itemMatchesToken,
	resolveAppIds,
	resolveLaunches,
	workspaceAppCatalog,
	withWorkspaceApp,
	withWorkspaceWidget,
	workspaceAppearance,
	workspaceMayHide,
	workspacePlacements,
	workspaceRestrictsItem,
	workspaceWidgetIds,
	WORKSPACE_LAYOUTS,
} from '../../src/workspaces';
import type { WorkspaceProfile } from '../../src/workspaces';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';

function item(
	id: string,
	kind: NavKind = 'plugin',
	extra: Partial< NavItem > = {},
): NavItem {
	return { id, kind, title: id, icon: 'dashicons-admin-generic', ...extra };
}

/** A site with a store, a course plugin and the usual core menus. */
function fullSite(): NavItem[] {
	return [
		item( 'index-php', 'core', {
			title: 'Dashboard',
			menu: menu( 'index.php' ),
		} ),
		item( 'edit-php', 'core', {
			title: 'Posts',
			menu: menu( 'edit.php' ),
		} ),
		item( 'upload-php', 'core', {
			title: 'Media',
			menu: menu( 'upload.php' ),
		} ),
		item( 'options-general-php', 'core', {
			title: 'Settings',
			menu: menu( 'options-general.php' ),
		} ),
		item( 'woocommerce', 'plugin', {
			title: 'WooCommerce',
			menu: menu( 'admin.php?page=wc-orders' ),
		} ),
		item( 'edit-php-post-type-product', 'plugin', {
			title: 'Products',
			menu: menu( 'edit.php?post_type=product' ),
		} ),
		item( 'sensei', 'plugin', {
			title: 'Sensei LMS',
			menu: menu( 'admin.php?page=sensei' ),
		} ),
		item( 'edit-php-post-type-course', 'plugin', {
			title: 'Courses',
			menu: menu( 'edit.php?post_type=course' ),
		} ),
		item( 'os-overview', 'control', { title: 'Workspaces' } ),
		item( 'os-exit', 'control', { title: 'Exit', locked: true } ),
	];
}

function menu( url: string ) {
	return {
		id: url,
		title: url,
		icon: 'dashicons-admin-generic',
		url,
		badge: 0,
		submenu: [],
		isCore: false,
	};
}

beforeEach( () => installHooksStub() );
afterEach( () => clearHooksStub() );

describe( 'matching', () => {
	test( 'a token finds an item by url, by id, or by title', () => {
		const products = item( 'edit-php-post-type-product', 'plugin', {
			title: 'Products',
			menu: menu( 'edit.php?post_type=product' ),
		} );
		expect( itemMatchesToken( products, 'post_type=product' ) ).toBe( true );
		expect( itemMatchesToken( products, 'edit-php-post-type' ) ).toBe( true );
		// Title matching is what makes a plugin with an opaque slug
		// findable by the word a human would use for it.
		expect( itemMatchesToken( products, 'products' ) ).toBe( true );
		expect( itemMatchesToken( products, 'sensei' ) ).toBe( false );
	} );

	test( 'an empty token matches nothing', () => {
		// Otherwise `''.includes` is true for every item and one stray
		// entry in a template silently selects the whole admin.
		expect( itemMatchesToken( item( 'x' ), '' ) ).toBe( false );
		expect( itemMatchesToken( item( 'x' ), '   ' ) ).toBe( false );
	} );

	test( 'resolveAppIds dedupes and keeps item order', () => {
		const items = fullSite();
		const ids = resolveAppIds( items, [ 'woocommerce', 'product', 'wc-' ] );
		expect( ids ).toEqual( [
			'woocommerce',
			'edit-php-post-type-product',
		] );
	} );

	test( 'resolveLaunches drops entries whose app is missing', () => {
		// The core-only site: the commerce entries find nothing and
		// simply do not open.
		const coreOnly = fullSite().filter(
			( i ) => ! i.id.includes( 'woo' ) && ! i.id.includes( 'product' ),
		);
		const launches = resolveLaunches( coreOnly, [
			{ match: 'wc-orders' },
			{ match: 'post_type=product', url: 'edit.php?post_type=product' },
			{ match: 'edit.php', url: 'post-new.php', title: 'New draft' },
		] );
		expect( launches ).toHaveLength( 1 );
		expect( launches[ 0 ].url ).toBe( 'post-new.php' );
		expect( launches[ 0 ].title ).toBe( 'New draft' );
	} );

	test( 'a native app with no nav item still opens, by its registered id', () => {
		const natives = [ { id: 'desktop-mode-os-settings', title: 'OpenStation Preferences', icon: '' } ];
		const launches = resolveLaunches( fullSite(), [ { match: 'desktop-mode-os-settings' }, { match: 'nothing-here' } ], natives );
		expect( launches ).toHaveLength( 1 );
		expect( launches[ 0 ].url ).toBe( '' );
		expect( launches[ 0 ].item.windowId ).toBe( 'desktop-mode-os-settings' );
	} );

	test( 'the app catalogue: every app, native or not, once', () => {
		const items: NavItem[] = [
			item( 'menu-posts', 'core', { windowId: 'edit-php', menu: { id: 'menu-posts', title: 'Posts', icon: '', url: 'http://x.test/wp-admin/edit.php', badge: 0, submenu: [ { title: 'Add Post', url: 'http://x.test/wp-admin/post-new.php' } ], isCore: true } as NavItem[ 'menu' ] } ),
			item( 'os-system', 'control' ),
			item( 'os-exit', 'control', { locked: true } ),
			item( 'desktop-mode-recycle-bin', 'control', { title: 'Trash', windowId: 'desktop-mode-recycle-bin' } ),
			item( 'my-wordpress', 'app', { windowId: 'my-wordpress' } ),
		];
		const natives = [
			{ id: 'desktop-mode-recycle-bin', title: 'Trash', icon: '' },
			{ id: 'my-wordpress', title: 'WP Explorer', icon: '' },
			{ id: 'desktop-mode-posts', title: 'Posts', icon: '' },
			{ id: 'desktop-mode-os-settings', title: 'OpenStation Preferences', icon: '' },
			{ id: 'openstation-workspaces', title: 'Workspaces', icon: '' },
		];
		const apps = workspaceAppCatalog( items, natives, new Set( [ 'desktop-mode-posts' ] ), 'http://x.test/wp-admin/' );
		expect( apps.map( ( a ) => [ a.id, a.dock ] ) ).toEqual( [
			[ 'menu-posts', true ],
			[ 'desktop-mode-recycle-bin', true ],
			[ 'my-wordpress', true ],
			[ 'desktop-mode-os-settings', false ],
		] );
		// An app is its main page first, then its tabs.
		expect( apps[ 0 ].pages ).toEqual( [
			{ title: 'menu-posts', url: 'edit.php' },
			{ title: 'Add Post', url: 'post-new.php' },
		] );
	} );

	test( 'a launch with no explicit url opens the matched item', () => {
		const launches = resolveLaunches( fullSite(), [
			{ match: 'wc-orders' },
		] );
		expect( launches[ 0 ].url ).toBe( 'admin.php?page=wc-orders' );
		expect( launches[ 0 ].title ).toBe( 'WooCommerce' );
	} );
} );

describe( 'visibility', () => {
	const base: Record< string, NavPlacement > = { 'edit-php': 'desktop' };

	test( 'a desk that shows everything returns the map untouched', () => {
		// Identity, not a copy: the dispatcher recomputes on every
		// window open, close and focus change, and the overwhelmingly
		// common case is a plain Space.
		expect( workspacePlacements( base, fullSite(), null ) ).toBe( base );
		expect(
			workspacePlacements( base, fullSite(), blankWorkspaceProfile() ),
		).toBe( base );
	} );

	test( 'a narrowed desk hides what it does not name', () => {
		const profile: WorkspaceProfile = {
			...blankWorkspaceProfile(),
			apps: { mode: 'only', ids: [ 'woocommerce' ] },
		};
		const next = workspacePlacements( base, fullSite(), profile );
		expect( next[ 'sensei' ] ).toBe( 'hidden' );
		expect( next[ 'edit-php' ] ).toBe( 'hidden' );
		expect( next[ 'woocommerce' ] ).toBeUndefined();
		// The user's own map is not touched — this is what makes
		// switching desks and back lossless.
		expect( base ).toEqual( { 'edit-php': 'desktop' } );
	} );

	test( 'controls and locked items survive every narrowing', () => {
		const profile: WorkspaceProfile = {
			...blankWorkspaceProfile(),
			apps: { mode: 'only', ids: [] },
		};
		const next = workspacePlacements( {}, fullSite(), profile );
		expect( next[ 'os-overview' ] ).toBeUndefined();
		expect( next[ 'os-exit' ] ).toBeUndefined();
		expect( workspaceMayHide( item( 'x', 'control' ) ) ).toBe( false );
		expect( workspaceMayHide( item( 'x', 'core', { locked: true } ) ) ).toBe(
			false,
		);
		expect( workspaceMayHide( item( 'x', 'plugin' ) ) ).toBe( true );
		// Trash is an app in a control's tile: a workspace picks it.
		expect( workspaceMayHide( item( 'desktop-mode-recycle-bin', 'control', { windowId: 'desktop-mode-recycle-bin' } ) ) ).toBe( true );
	} );

	test( '"Hide settings" hides the restricted screens, even ones the desk keeps', () => {
		const profile: WorkspaceProfile = {
			...blankWorkspaceProfile(),
			apps: { mode: 'only', ids: [ 'edit-php', 'options-general-php' ] },
			restricted: true,
		};
		const lists = { screens: [ 'options-general.php' ], apps: [ 'desktop-mode-os-settings' ] };
		( window as unknown as { openStationConfig: unknown } ).openStationConfig = {
			workspaceRestricted: lists,
		};
		try {
			const next = workspacePlacements( {}, fullSite(), profile );
			expect( next[ 'options-general-php' ] ).toBe( 'hidden' );
			expect( next[ 'edit-php' ] ).toBeUndefined();
			// On a desk that shows everything, it still hides settings.
			const all = workspacePlacements( {}, fullSite(), {
				...blankWorkspaceProfile(),
				restricted: true,
			} );
			expect( all[ 'options-general-php' ] ).toBe( 'hidden' );
			expect( all[ 'woocommerce' ] ).toBeUndefined();
			expect(
				workspaceRestrictsItem( item( 'prefs', 'plugin', { windowId: 'desktop-mode-os-settings' } ), lists ),
			).toBe( true );
		} finally {
			delete ( window as unknown as { openStationConfig?: unknown } ).openStationConfig;
		}
	} );

	test( 'withWorkspaceApp adds and removes without duplicating', () => {
		let profile: WorkspaceProfile = {
			...blankWorkspaceProfile(),
			apps: { mode: 'only', ids: [ 'a' ] },
		};
		profile = withWorkspaceApp( profile, 'b', true );
		expect( profile.apps.ids ).toEqual( [ 'a', 'b' ] );
		// Already on — same object back, no second copy.
		expect( withWorkspaceApp( profile, 'b', true ) ).toBe( profile );
		profile = withWorkspaceApp( profile, 'a', false );
		expect( profile.apps.ids ).toEqual( [ 'b' ] );
	} );

	test( 'a desk with no widget opinion leaves the column alone', () => {
		expect( workspaceWidgetIds( null ) ).toBeNull();
		expect( workspaceWidgetIds( blankWorkspaceProfile() ) ).toBeNull();
		// A profile written before workspaces had widgets: the field is
		// simply absent, and that must mean "the user's own column",
		// not "an empty one".
		const legacy = { ...blankWorkspaceProfile() };
		delete legacy.widgets;
		expect( workspaceWidgetIds( legacy ) ).toBeNull();
	} );

	test( 'a desk with its own widgets names them exactly', () => {
		const profile: WorkspaceProfile = {
			...blankWorkspaceProfile(),
			widgets: { mode: 'only', ids: [ 'clock', 'desktop-mode/drafts' ] },
		};
		expect( workspaceWidgetIds( profile ) ).toEqual( [
			'clock',
			'desktop-mode/drafts',
		] );
	} );

	test( 'withWorkspaceWidget adds and removes without duplicating', () => {
		let profile: WorkspaceProfile = {
			...blankWorkspaceProfile(),
			widgets: { mode: 'only', ids: [ 'clock' ] },
		};
		profile = withWorkspaceWidget( profile, 'desktop-mode/notes', true );
		expect( profile.widgets?.ids ).toEqual( [
			'clock',
			'desktop-mode/notes',
		] );
		expect( withWorkspaceWidget( profile, 'clock', true ) ).toBe( profile );
		profile = withWorkspaceWidget( profile, 'clock', false );
		expect( profile.widgets?.ids ).toEqual( [ 'desktop-mode/notes' ] );
	} );

	test( 'adding a widget to a desk with no column of its own is a no-op', () => {
		// It would silently adopt whatever the user's column happened
		// to hold as this workspace's permanent answer.
		const profile = blankWorkspaceProfile();
		expect( withWorkspaceWidget( profile, 'clock', true ) ).toBe( profile );
	} );

	test( 'a desk with no look of its own overrides nothing', () => {
		expect( workspaceAppearance( null ) ).toBeNull();
		expect( workspaceAppearance( blankWorkspaceProfile() ) ).toBeNull();
		const legacy = { ...blankWorkspaceProfile() };
		delete legacy.appearance;
		expect( workspaceAppearance( legacy ) ).toBeNull();
	} );

	test( 'a workspace may carry every setting, but never the theme ledger or a made-up key', () => {
		const profile: WorkspaceProfile = {
			...blankWorkspaceProfile(),
			appearance: {
				wallpaper: 'mono',
				openWindowsAs: 'focused',
				navPlacement: { 'edit-php': 'hidden' },
				heartbeatRate: 30,
				// Shell-owned: writing it would re-arm a theme's seed.
				appliedThemeRecommendations: [ 'x' ],
				// Not a setting at all.
				notASetting: true,
			} as WorkspaceProfile[ 'appearance' ],
		};
		expect( workspaceAppearance( profile ) ).toEqual( {
			wallpaper: 'mono',
			openWindowsAs: 'focused',
			navPlacement: { 'edit-php': 'hidden' },
			heartbeatRate: 30,
		} );
	} );

	test( 'capture takes every setting off a snapshot', () => {
		const captured = captureWorkspaceAppearance( {
			wallpaper: 'aurora',
			dockBehavior: 'dynamic',
			navOrder: [ 'a', 'b' ],
			developerModeEnabled: true,
			appliedThemeRecommendations: [ 'x' ],
		} );
		expect( captured ).toEqual( {
			wallpaper: 'aurora',
			dockBehavior: 'dynamic',
			navOrder: [ 'a', 'b' ],
			developerModeEnabled: true,
		} );
	} );

	test( 'adding an app to a desk that shows everything is a no-op', () => {
		// There is nothing to add TO, and flipping the desk into
		// narrowed mode would hide every app the user was not looking
		// at at that moment.
		const profile = blankWorkspaceProfile();
		expect( withWorkspaceApp( profile, 'a', true ) ).toBe( profile );
	} );
} );
