/**
 * Workspaces — the model, as a table.
 *
 * Three rules this file exists to pin, because breaking any of them
 * is silent:
 *
 * 1. **A template resolves against the live navigation**, so the Woo
 *    desk on a site without WooCommerce is a smaller desk rather than
 *    four permission errors.
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
	findWorkspacePreset,
	itemMatchesToken,
	listWorkspacePresets,
	registerWorkspacePreset,
	resolveAppIds,
	resolveLaunches,
	unregisterWorkspacePreset,
	withWorkspaceApp,
	withWorkspaceWidget,
	workspaceAppearance,
	workspaceMayHide,
	workspacePlacements,
	workspaceProfileFromPreset,
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
		item( 'os-overview', 'control', { title: 'Overview' } ),
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
		// The core-only site: the Woo entries find nothing and simply
		// do not open.
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

	test( 'a launch with no explicit url opens the matched item', () => {
		const launches = resolveLaunches( fullSite(), [
			{ match: 'wc-orders' },
		] );
		expect( launches[ 0 ].url ).toBe( 'admin.php?page=wc-orders' );
		expect( launches[ 0 ].title ).toBe( 'WooCommerce' );
	} );
} );

describe( 'presets', () => {
	test( 'the three shipped desks are there, in order', () => {
		expect( listWorkspacePresets().map( ( p ) => p.id ) ).toEqual( [
			'woo',
			'sensei',
			'longreads',
		] );
	} );

	test( 'every shipped layout is a real one', () => {
		for ( const preset of listWorkspacePresets() ) {
			expect( WORKSPACE_LAYOUTS ).toContain( preset.layout );
		}
	} );

	test( 'a registered preset sorts by order and can be removed', () => {
		registerWorkspacePreset( {
			id: 'support',
			label: 'Support',
			description: '',
			icon: 'dashicons-sos',
			color: '',
			apps: [],
			windows: [],
			layout: 'columns',
		} );
		// Default order 0 leads — a site that installed a workspace on
		// purpose should see it first.
		expect( listWorkspacePresets()[ 0 ].id ).toBe( 'support' );
		unregisterWorkspacePreset( 'support' );
		expect(
			listWorkspacePresets().some( ( p ) => p.id === 'support' ),
		).toBe( false );
	} );

	test( 'a profile read from Woo narrows to commerce plus the essentials', () => {
		const preset = findWorkspacePreset( 'woo' )!;
		const profile = workspaceProfileFromPreset( preset, fullSite() );
		expect( profile.apps.mode ).toBe( 'only' );
		expect( profile.apps.ids ).toContain( 'woocommerce' );
		expect( profile.apps.ids ).toContain( 'edit-php-post-type-product' );
		// Dashboard, Media and Settings ride along with every template:
		// a desk with no way to reach them is a dead end.
		expect( profile.apps.ids ).toContain( 'index-php' );
		expect( profile.apps.ids ).toContain( 'upload-php' );
		expect( profile.apps.ids ).toContain( 'options-general-php' );
		// …and the course plugin does not.
		expect( profile.apps.ids ).not.toContain( 'sensei' );
		expect( profile.layout ).toBe( 'columns' );
		// The launch list has not run yet.
		expect( profile.provisioned ).toBe( false );
	} );

	test( 'a template degrades on a site missing the apps it names', () => {
		const coreOnly = fullSite().filter( ( i ) => 'core' === i.kind );
		const profile = workspaceProfileFromPreset(
			findWorkspacePreset( 'woo' )!,
			coreOnly,
		);
		// Still a workspace, still narrowed — just to what exists.
		expect( profile.apps.mode ).toBe( 'only' );
		expect( profile.apps.ids ).toEqual( [
			'index-php',
			'upload-php',
			'options-general-php',
		] );
	} );

	test( 'Longreads is the writing desk', () => {
		const preset = findWorkspacePreset( 'longreads' )!;
		expect( preset.layout ).toBe( 'focus' );
		// It opens with a blank page, not with the library.
		expect( preset.windows[ 0 ].url ).toBe( 'post-new.php' );
		// Its instruments are about the page, not the audience — the
		// point of the whole template is what it leaves out.
		expect( preset.widgets ).toContain( 'desktop-mode/drafts' );
		expect( preset.widgets ).not.toContain( 'desktop-mode/site-views' );
	} );

	test( 'a template with widgets gives the desk its own column', () => {
		const profile = workspaceProfileFromPreset(
			findWorkspacePreset( 'woo' )!,
			fullSite(),
		);
		expect( profile.widgets?.mode ).toBe( 'only' );
		expect( profile.widgets?.ids ).toContain( 'desktop-mode/site-views' );
	} );

	test( 'a template with no widget opinion leaves the column alone', () => {
		registerWorkspacePreset( {
			id: 'quiet',
			label: 'Quiet',
			description: '',
			icon: 'dashicons-desktop',
			color: '',
			apps: [ 'edit.php' ],
			windows: [],
			layout: 'free',
		} );
		const profile = workspaceProfileFromPreset(
			findWorkspacePreset( 'quiet' )!,
			fullSite(),
		);
		expect( profile.widgets?.mode ).toBe( 'all' );
		expect( workspaceWidgetIds( profile ) ).toBeNull();
		unregisterWorkspacePreset( 'quiet' );
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

	test( 'a look is filtered to the allowlist', () => {
		const profile: WorkspaceProfile = {
			...blankWorkspaceProfile(),
			appearance: {
				wallpaper: 'mono',
				accent: 'rose',
				// Not an appearance key. A profile is user meta round-
				// tripped through an untrusted client, so an unfiltered
				// patch would be a way to write any settings key from
				// anywhere.
				navPlacement: { 'edit-php': 'hidden' },
				heartbeatRate: 1,
			} as WorkspaceProfile[ 'appearance' ],
		};
		expect( workspaceAppearance( profile ) ).toEqual( {
			wallpaper: 'mono',
			accent: 'rose',
		} );
	} );

	test( 'capture takes the allowlisted keys off a snapshot', () => {
		const captured = captureWorkspaceAppearance( {
			wallpaper: 'aurora',
			accent: 'emerald',
			dockBehavior: 'dynamic',
			navOrder: [ 'a', 'b' ],
			developerModeEnabled: true,
		} );
		expect( captured ).toEqual( {
			wallpaper: 'aurora',
			accent: 'emerald',
			dockBehavior: 'dynamic',
		} );
	} );

	test( 'every shipped template dresses its desk', () => {
		for ( const preset of listWorkspacePresets() ) {
			const profile = workspaceProfileFromPreset( preset, fullSite() );
			const look = workspaceAppearance( profile );
			expect( look ).not.toBeNull();
			expect( look ).toHaveProperty( 'wallpaper' );
			expect( look ).toHaveProperty( 'accent' );
		}
	} );

	test( 'adding an app to a desk that shows everything is a no-op', () => {
		// There is nothing to add TO, and flipping the desk into
		// narrowed mode would hide every app the user was not looking
		// at at that moment.
		const profile = blankWorkspaceProfile();
		expect( withWorkspaceApp( profile, 'a', true ) ).toBe( profile );
	} );
} );
