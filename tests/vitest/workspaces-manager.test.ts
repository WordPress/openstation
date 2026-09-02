/**
 * Workspace operations: create, edit, provision, and the server sync.
 *
 * The one with real ordering in it is provisioning, and the rule it
 * exists to pin is that the launch list runs **once per workspace, not
 * once per visit**. Close a window the workspace opened, switch away,
 * come back — the desk stays as the user left it. Get that wrong and
 * the workspace refuses to be tidied.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import type { NavItem } from '../../src/nav';
import {
	applyServerWorkspacePresets,
	applyWorkspaceView,
	applyWorkspaceWidgets,
	captureWorkspaceWindows,
	createWorkspace,
	findWorkspacePreset,
	getWorkspaceProfile,
	installWorkspacePresetSync,
	listWorkspacePresets,
	provisionWorkspace,
	reopenWorkspaceWindows,
	saveDeskToWorkspace,
	setWorkspaceProfile,
	absoluteAdminUrl,
	WORKSPACE_MAX_WINDOWS,
	type WorkspaceDeps,
} from '../../src/workspaces';
import {
	clearHooksStub,
	installHooksStub,
	recordActions,
	type FakeWpHooks,
} from './helpers/hooks-stub';

const ADMIN_URL = 'http://example.test/wp-admin/';

const WORKSPACE_HOOKS = [
	'os.workspaces.updated',
	'os.workspaces.provisioned',
] as const;

function navItems(): NavItem[] {
	return [
		{
			id: 'edit-php',
			kind: 'core',
			title: 'Posts',
			icon: 'dashicons-admin-post',
			menu: {
				id: 'edit.php',
				title: 'Posts',
				icon: 'dashicons-admin-post',
				url: 'edit.php',
				badge: 0,
				submenu: [],
				isCore: true,
			},
		},
		{
			id: 'my-panel',
			kind: 'app',
			title: 'My panel',
			icon: 'dashicons-admin-generic',
			windowId: 'my-panel',
		},
		// A control, so the tests that must never name one have one
		// to not name.
		{
			id: 'os-exit',
			kind: 'control',
			title: 'Exit',
			icon: 'dashicons-exit',
			locked: true,
		},
	];
}

describe( 'workspace operations', () => {
	let hooks: FakeWpHooks;
	let desktop: HTMLElement;
	let manager: WindowManager;
	let deps: WorkspaceDeps;
	let openNative: ReturnType< typeof vi.fn >;
	let refreshLayout: ReturnType< typeof vi.fn >;
	let setVisibleWidgets: ReturnType< typeof vi.fn >;
	let setAppearance: ReturnType< typeof vi.fn >;

	beforeEach( () => {
		hooks = installHooksStub();
		desktop = document.createElement( 'div' );
		Object.defineProperty( desktop, 'getBoundingClientRect', {
			value: () =>
				( {
					left: 0,
					top: 0,
					right: 1600,
					bottom: 900,
					width: 1600,
					height: 900,
					x: 0,
					y: 0,
					toJSON: () => ( {} ),
				} ) as DOMRect,
		} );
		Object.defineProperty( desktop, 'clientWidth', {
			value: 1600,
			configurable: true,
		} );
		Object.defineProperty( desktop, 'clientHeight', {
			value: 900,
			configurable: true,
		} );
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
		openNative = vi.fn();
		refreshLayout = vi.fn();
		setVisibleWidgets = vi.fn();
		setAppearance = vi.fn();
		deps = {
			manager,
			getNavItems: navItems,
			adminUrl: ADMIN_URL,
			deriveWindowId: ( url: string ) =>
				url.replace( /[^a-z0-9]+/gi, '-' ).toLowerCase(),
			openNative,
			refreshLayout,
			setVisibleWidgets,
			setAppearance,
		};
	} );

	afterEach( async () => {
		// `provisionWorkspace` settles two animation frames later — the
		// layout pass and the `os.workspaces.provisioned` action. A test
		// that returns before those frames land would leave the action to
		// fire against a torn-down hooks stub, an unhandled error that
		// only shows on a slow runner. Let the frames drain first.
		await new Promise< void >( ( resolve ) =>
			requestAnimationFrame( () => requestAnimationFrame( resolve ) ),
		);
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktop.remove();
		clearHooksStub();
		vi.restoreAllMocks();
	} );

	test( 'create() from a template names, profiles and activates the desk', () => {
		const before = manager.getDesktops().length;
		const created = createWorkspace( deps, { preset: 'publishing' } );

		expect( manager.getDesktops() ).toHaveLength( before + 1 );
		expect( created.label ).toBe( 'Publishing' );
		expect( manager.getActiveDesktopId() ).toBe( created.id );

		const profile = getWorkspaceProfile( manager, created.id );
		expect( profile?.preset ).toBe( 'publishing' );
		expect( profile?.layout ).toBe( 'focus' );
		// The rails answer to the profile, so a write has to repaint.
		expect( refreshLayout ).toHaveBeenCalled();
	} );

	test( 'create() without a template leaves a plain Space', () => {
		const created = createWorkspace( deps, { activate: false } );
		expect( getWorkspaceProfile( manager, created.id ) ).toBeNull();
		// Not activated: the caller said so.
		expect( manager.getActiveDesktopId() ).not.toBe( created.id );
	} );

	test( 'the profile filter can extend a template before it lands', () => {
		hooks.addFilter(
			'os.workspaces.profile',
			'test/extend',
			( profile: unknown ) => ( {
				...( profile as Record< string, unknown > ),
				icon: 'dashicons-star-filled',
			} ),
		);
		const created = createWorkspace( deps, { preset: 'commerce' } );
		expect( getWorkspaceProfile( manager, created.id )?.icon ).toBe(
			'dashicons-star-filled',
		);
	} );

	test( 'setProfile( null ) turns a workspace back into a plain Space', () => {
		const created = createWorkspace( deps, { preset: 'commerce' } );
		const log = recordActions( hooks, WORKSPACE_HOOKS );

		expect( setWorkspaceProfile( deps, created.id, null ) ).toBe( true );
		expect( getWorkspaceProfile( manager, created.id ) ).toBeNull();
		expect(
			log.some( ( e ) => e.name === 'os.workspaces.updated' ),
		).toBe( true );
	} );

	test( 'setProfile on an unknown desktop reports failure', () => {
		expect( setWorkspaceProfile( deps, 'desktop-nope', null ) ).toBe(
			false,
		);
	} );

	test( 'provision opens the launch list once and never again', async () => {
		const open = vi
			.spyOn( manager, 'open' )
			.mockResolvedValue( {} as never );
		const created = createWorkspace( deps, {
			profile: {
				preset: '',
				icon: 'dashicons-desktop',
				color: '',
				apps: { mode: 'all', ids: [] },
				windows: [
					{ match: 'edit.php', url: 'post-new.php' },
					{ match: 'my-panel' },
				],
				layout: 'free',
				provisioned: false,
			},
		} );

		provisionWorkspace( deps, created.id );

		expect( open ).toHaveBeenCalledTimes( 1 );
		expect( open.mock.calls[ 0 ][ 0 ] ).toMatchObject( {
			url: `${ ADMIN_URL }post-new.php`,
			desktopId: created.id,
		} );
		// An entry with no url opens the matched item's native window.
		expect( openNative ).toHaveBeenCalledWith( 'my-panel' );
		expect(
			getWorkspaceProfile( manager, created.id )?.provisioned,
		).toBe( true );

		// Second pass: the user has since closed one of these, and the
		// desk must stay as they left it.
		open.mockClear();
		openNative.mockClear();
		provisionWorkspace( deps, created.id );
		expect( open ).not.toHaveBeenCalled();
		expect( openNative ).not.toHaveBeenCalled();
	} );

	test( 'reopen brings back a closed launch window and leaves the open ones alone', async () => {
		const open = vi
			.spyOn( manager, 'open' )
			.mockResolvedValue( {} as never );
		const created = createWorkspace( deps, {
			profile: {
				preset: '',
				icon: 'dashicons-desktop',
				color: '',
				apps: { mode: 'all', ids: [] },
				windows: [
					{ match: 'edit.php', url: 'post-new.php' },
					{ match: 'my-panel' },
				],
				layout: 'free',
				// Already provisioned once — this is the F5 case.
				provisioned: true,
			},
		} );

		// The url window is still open (session restore brought it
		// back); the native one the user closed.
		const openUrlId = deps.deriveWindowId(
			absoluteAdminUrl( 'post-new.php', ADMIN_URL ),
		);
		vi.spyOn( manager, 'getById' ).mockImplementation( ( id: string ) =>
			id === openUrlId ? ( {} as never ) : undefined,
		);

		reopenWorkspaceWindows( deps, created.id );

		// The still-open window is not reopened…
		expect( open ).not.toHaveBeenCalled();
		// …and the closed native one is.
		expect( openNative ).toHaveBeenCalledWith( 'my-panel' );
	} );

	test( 'reopen does not re-stamp provisioned or re-run the layout', () => {
		vi.spyOn( manager, 'open' ).mockResolvedValue( {} as never );
		vi.spyOn( manager, 'getById' ).mockReturnValue( undefined );
		const created = createWorkspace( deps, {
			profile: {
				preset: '',
				icon: 'dashicons-desktop',
				color: '',
				apps: { mode: 'all', ids: [] },
				windows: [ { match: 'edit.php', url: 'edit.php' } ],
				layout: 'tile',
				provisioned: true,
			},
		} );
		refreshLayout.mockClear();

		reopenWorkspaceWindows( deps, created.id );

		// The arrangement is applied once, at first provision — never
		// on a reload, or a hand-moved window would jump back.
		expect( refreshLayout ).not.toHaveBeenCalled();
		expect( getWorkspaceProfile( manager, created.id )?.provisioned ).toBe(
			true,
		);
	} );

	test( 'reopen is a no-op on a never-provisioned desk and a plain Space', () => {
		const open = vi
			.spyOn( manager, 'open' )
			.mockResolvedValue( {} as never );
		vi.spyOn( manager, 'getById' ).mockReturnValue( undefined );

		// A plain Space — no profile at all.
		const plain = createWorkspace( deps, {} );
		reopenWorkspaceWindows( deps, plain.id );

		// A workspace whose launch list has never run: that is
		// `provisionWorkspace`'s job, not this one's.
		const fresh = createWorkspace( deps, {
			profile: {
				preset: '',
				icon: 'dashicons-desktop',
				color: '',
				apps: { mode: 'all', ids: [] },
				windows: [ { match: 'edit.php', url: 'edit.php' } ],
				layout: 'free',
				provisioned: false,
			},
		} );
		reopenWorkspaceWindows( deps, fresh.id );

		expect( open ).not.toHaveBeenCalled();
		expect( openNative ).not.toHaveBeenCalled();
	} );

	test( 'provision skips a launch whose app is not installed', () => {
		const open = vi
			.spyOn( manager, 'open' )
			.mockResolvedValue( {} as never );
		const created = createWorkspace( deps, {
			profile: {
				preset: '',
				icon: 'dashicons-desktop',
				color: '',
				apps: { mode: 'all', ids: [] },
				windows: [ { match: 'woocommerce', url: 'admin.php?page=wc' } ],
				layout: 'free',
				provisioned: false,
			},
		} );

		provisionWorkspace( deps, created.id );

		expect( open ).not.toHaveBeenCalled();
	} );

	test( 'a forced provision runs the list again', async () => {
		const open = vi
			.spyOn( manager, 'open' )
			.mockResolvedValue( {} as never );
		const created = createWorkspace( deps, {
			profile: {
				preset: '',
				icon: 'dashicons-desktop',
				color: '',
				apps: { mode: 'all', ids: [] },
				windows: [ { match: 'edit.php', url: 'edit.php' } ],
				layout: 'free',
				provisioned: true,
			},
		} );

		// Not forced: already provisioned, so nothing happens.
		provisionWorkspace( deps, created.id );
		expect( open ).not.toHaveBeenCalled();

		// Forced — the user pressed "Open them now".
		provisionWorkspace( deps, created.id, { force: true } );
		expect( open ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'capture shapes the open windows into a launch list', async () => {
		const created = createWorkspace( deps, { preset: 'publishing' } );
		await manager.open( {
			id: 'edit-php',
			url: `${ ADMIN_URL }edit.php`,
			title: 'Posts',
			icon: 'dashicons-admin-post',
		} );
		await manager.open( {
			id: 'my-panel',
			url: '#my-panel',
			title: 'My panel',
			icon: 'dashicons-admin-generic',
			native: true,
		} );

		const captured = captureWorkspaceWindows( manager, created.id );

		// `toMatchObject`: each entry also carries a `place` (where the
		// window is, as fractions of the work area), which the
		// positioning test below pins on its own.
		expect( captured ).toMatchObject( [
			{
				match: 'edit-php',
				title: 'Posts',
				url: `${ ADMIN_URL }edit.php`,
			},
			// A native window carries no url — its `#slug` is a marker,
			// never somewhere to navigate — so it reopens through the
			// registry instead.
			{ match: 'my-panel', title: 'My panel' },
		] );
		expect( captured[ 1 ] ).not.toHaveProperty( 'url' );
	} );

	test( 'capture records where each window is, in a form that survives a resize', async () => {
		const created = createWorkspace( deps, { preset: 'publishing' } );
		// A free window: its box becomes fractions of the work area.
		const free = await manager.open( {
			id: 'edit-php',
			url: `${ ADMIN_URL }edit.php`,
			title: 'Posts',
			icon: 'dashicons-admin-post',
		} );
		free.element.style.left = '160px';
		free.element.style.top = '90px';
		Object.defineProperty( free.element, 'offsetLeft', { value: 160, configurable: true } );
		Object.defineProperty( free.element, 'offsetTop', { value: 90, configurable: true } );
		Object.defineProperty( free.element, 'offsetWidth', { value: 800, configurable: true } );
		Object.defineProperty( free.element, 'offsetHeight', { value: 450, configurable: true } );
		// A grid-snapped window: its cells come along as they are.
		const snapped = await manager.open( {
			id: 'upload-php',
			url: `${ ADMIN_URL }upload.php`,
			title: 'Media',
			icon: 'dashicons-admin-media',
		} );
		snapped._gridSpan = {
			anchor: { col: 3, row: 0 },
			cursor: { col: 5, row: 2 },
			cols: 6,
			rows: 6,
		};

		const captured = captureWorkspaceWindows( manager, created.id );

		expect( captured.find( ( w ) => w.match === 'edit-php' )?.place ).toEqual( {
			x: 0.1,
			y: 0.1,
			width: 0.5,
			height: 0.5,
		} );
		expect( captured.find( ( w ) => w.match === 'upload-php' )?.gridSpan ).toEqual(
			snapped._gridSpan,
		);
	} );

	test( 'saveDesk makes the workspace open the way the desk is', async () => {
		const created = createWorkspace( deps, { preset: 'commerce' } );
		await manager.open( {
			id: 'edit-php',
			url: `${ ADMIN_URL }edit.php`,
			title: 'Posts',
			icon: 'dashicons-admin-post',
		} );
		const log = recordActions( hooks, WORKSPACE_HOOKS );

		const saved = saveDeskToWorkspace( deps, created.id, {
			visibleAppIds: [ 'edit-php', 'my-panel', 'os-exit' ],
			mountedWidgetIds: [ 'clock', 'desktop-mode/notes' ],
		} );

		expect( saved?.windows.map( ( w ) => w.match ) ).toEqual( [ 'edit-php' ] );
		// The positions ARE the arrangement now; an algorithm re-laying
		// them out would undo the thing just saved.
		expect( saved?.layout ).toBe( 'free' );
		// What it would open is already open.
		expect( saved?.provisioned ).toBe( true );
		expect( saved?.widgets ).toEqual( { mode: 'only', ids: [ 'clock', 'desktop-mode/notes' ] } );
		// Controls are never named: the narrowing cannot hide them
		// and a checklist should not offer "Exit" as a choice.
		expect( saved?.apps ).toEqual( { mode: 'only', ids: [ 'edit-php', 'my-panel' ] } );
		// The template's own identity is kept — this is the same desk,
		// opening differently.
		expect( saved?.preset ).toBe( 'commerce' );
		expect( getWorkspaceProfile( manager, created.id ) ).toEqual( saved );
		expect( log.some( ( e ) => e.name === 'os.workspaces.updated' ) ).toBe( true );
	} );

	test( 'saveDesk turns a plain Space into a workspace', () => {
		const plain = manager.getDesktops()[ 0 ].id;
		expect( getWorkspaceProfile( manager, plain ) ).toBeNull();
		const saved = saveDeskToWorkspace( deps, plain );
		expect( saved ).not.toBeNull();
		expect( getWorkspaceProfile( manager, plain )?.provisioned ).toBe( true );
		// Nothing was said about apps or widgets, so nothing narrows.
		expect( saved?.apps.mode ).toBe( 'all' );
		expect( saved?.widgets?.mode ).toBe( 'all' );
		expect( saveDeskToWorkspace( deps, 'desktop-nope' ) ).toBeNull();
	} );

	test( 'provision puts a window where its entry says', async () => {
		const open = vi.spyOn( manager, 'open' );
		const created = createWorkspace( deps, {
			profile: {
				preset: '',
				icon: 'dashicons-desktop',
				color: '',
				apps: { mode: 'all', ids: [] },
				windows: [
					{
						match: 'edit.php',
						url: 'edit.php',
						place: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
					},
				],
				layout: 'free',
				provisioned: false,
			},
		} );

		provisionWorkspace( deps, created.id );
		const win = await open.mock.results[ 0 ].value;

		// 1600×900 desk: a quarter in, half wide.
		expect( win.element.style.left ).toBe( '400px' );
		expect( win.element.style.top ).toBe( '225px' );
		expect( win.element.style.width ).toBe( '800px' );
		expect( win.element.style.height ).toBe( '450px' );
	} );

	test( 'capture stops at the number the server will keep', async () => {
		const created = createWorkspace( deps, {} );
		for ( let i = 0; i < WORKSPACE_MAX_WINDOWS + 3; i++ ) {
			await manager.open( {
				id: `w-${ i }`,
				url: `${ ADMIN_URL }w-${ i }.php`,
				title: `w-${ i }`,
				icon: 'dashicons-admin-generic',
			} );
		}
		// The desk would otherwise be told it kept fifteen and get back
		// twelve on the next reload.
		expect( captureWorkspaceWindows( manager, created.id ) ).toHaveLength(
			WORKSPACE_MAX_WINDOWS,
		);
	} );

	test( 'capture ignores windows on other desks', async () => {
		const first = manager.getActiveDesktopId();
		await manager.open( {
			id: 'edit-php',
			url: `${ ADMIN_URL }edit.php`,
			title: 'Posts',
			icon: 'dashicons-admin-post',
		} );
		const other = createWorkspace( deps, {} );

		expect( captureWorkspaceWindows( manager, other.id ) ).toEqual( [] );
		expect( captureWorkspaceWindows( manager, first ) ).toHaveLength( 1 );
	} );

	test( 'provision is a no-op on a plain Space', () => {
		const open = vi
			.spyOn( manager, 'open' )
			.mockResolvedValue( {} as never );
		provisionWorkspace( deps, manager.getActiveDesktopId() );
		expect( open ).not.toHaveBeenCalled();
	} );

	test( 'the desk’s look follows it, and hands back on a plain Space', () => {
		const woo = createWorkspace( deps, {
			profile: {
				preset: '',
				icon: 'dashicons-desktop',
				color: '',
				apps: { mode: 'all', ids: [] },
				appearance: { wallpaper: 'mono', accent: 'rose' },
				windows: [],
				layout: 'free',
				provisioned: true,
			},
		} );

		applyWorkspaceView( deps, woo.id );
		expect( setAppearance ).toHaveBeenCalledWith( {
			wallpaper: 'mono',
			accent: 'rose',
		} );

		setAppearance.mockClear();
		applyWorkspaceView( deps, manager.getDesktops()[ 0 ].id );
		expect( setAppearance ).toHaveBeenCalledWith( null );
	} );

	test( 'the look is applied before the widgets', () => {
		// The column reads the accent and the dock placement the
		// appearance just set; the other order paints it twice.
		const order: string[] = [];
		setAppearance.mockImplementation( () => order.push( 'appearance' ) );
		setVisibleWidgets.mockImplementation( () => order.push( 'widgets' ) );

		applyWorkspaceView( deps, manager.getActiveDesktopId() );

		expect( order ).toEqual( [ 'appearance', 'widgets' ] );
	} );

	test( 'the widget column follows the desk, and only mounts', () => {
		const woo = createWorkspace( deps, {
			profile: {
				preset: '',
				icon: 'dashicons-desktop',
				color: '',
				apps: { mode: 'all', ids: [] },
				widgets: { mode: 'only', ids: [ 'desktop-mode/site-views' ] },
				windows: [],
				layout: 'free',
				provisioned: true,
			},
		} );

		applyWorkspaceWidgets( deps, woo.id );
		expect( setVisibleWidgets ).toHaveBeenCalledWith( [
			'desktop-mode/site-views',
		] );

		// A plain Space hands the column back to the user — `null`,
		// never an empty list, which would blank what they built.
		setVisibleWidgets.mockClear();
		applyWorkspaceWidgets( deps, manager.getDesktops()[ 0 ].id );
		expect( setVisibleWidgets ).toHaveBeenCalledWith( null );
	} );

	test( 'a profile with no widgets field hands the column back', () => {
		// Every profile written before workspaces had widgets is in
		// this shape. It must mean "the user's own column", not "an
		// empty one".
		const desk = createWorkspace( deps, {
			profile: {
				preset: '',
				icon: 'dashicons-desktop',
				color: '',
				apps: { mode: 'all', ids: [] },
				windows: [],
				layout: 'free',
				provisioned: true,
			},
		} );
		setVisibleWidgets.mockClear();
		applyWorkspaceWidgets( deps, desk.id );
		expect( setVisibleWidgets ).toHaveBeenCalledWith( null );
	} );

	test( 'editing a desk you are not on leaves the visible column alone', () => {
		const other = createWorkspace( deps, { activate: false } );
		manager.switchDesktop( manager.getDesktops()[ 0 ].id );
		setVisibleWidgets.mockClear();

		setWorkspaceProfile( deps, other.id, {
			preset: '',
			icon: 'dashicons-desktop',
			color: '',
			apps: { mode: 'all', ids: [] },
			widgets: { mode: 'only', ids: [ 'clock' ] },
			windows: [],
			layout: 'free',
			provisioned: true,
		} );

		// The editor can be opened on any desk; repainting the column
		// in front of the user with another desk's widgets would be a
		// write they did not ask for.
		expect( setVisibleWidgets ).not.toHaveBeenCalled();
	} );

	test( 'a relative launch url resolves against wp-admin', () => {
		expect( absoluteAdminUrl( 'edit.php?post_type=product', ADMIN_URL ) ).toBe(
			`${ ADMIN_URL }edit.php?post_type=product`,
		);
		// An absolute one is a plugin's deliberate choice.
		expect(
			absoluteAdminUrl( 'https://other.test/x', ADMIN_URL ),
		).toBe( 'https://other.test/x' );
	} );
} );

describe( 'template server sync', () => {
	let teardown: ( () => void ) | null = null;

	beforeEach( () => {
		installHooksStub();
		teardown = installWorkspacePresetSync();
	} );

	afterEach( () => {
		teardown?.();
		teardown = null;
		clearHooksStub();
	} );

	test( 'before the server has spoken, every built-in stands', () => {
		// A shell booting without the config key must not show an
		// empty switcher.
		expect( listWorkspacePresets().map( ( p ) => p.id ) ).toEqual( [
			'commerce',
			'learning',
			'publishing',
		] );
	} );

	test( 'a template the server no longer names is dropped', () => {
		applyServerWorkspacePresets( [
			{ id: 'learning' },
			{ id: 'publishing' },
		] );
		// The PHP filter removed Commerce — a blog with no store.
		expect( listWorkspacePresets().map( ( p ) => p.id ) ).toEqual( [
			'learning',
			'publishing',
		] );
		expect( findWorkspacePreset( 'commerce' ) ).toBeNull();
	} );

	test( 'a server template with an id of its own is registered whole', () => {
		applyServerWorkspacePresets( [
			{ id: 'commerce' },
			{ id: 'learning' },
			{ id: 'publishing' },
			{
				id: 'support',
				label: 'Support',
				icon: 'dashicons-sos',
				layout: 'columns',
				apps: [ 'edit-comments.php' ],
				windows: [ { match: 'edit-comments.php' } ],
				order: 40,
			},
		] );
		const support = findWorkspacePreset( 'support' );
		expect( support ).toMatchObject( {
			label: 'Support',
			layout: 'columns',
			apps: [ 'edit-comments.php' ],
		} );
		// Order 40 puts it after the three shipped desks.
		expect( listWorkspacePresets().at( -1 )?.id ).toBe( 'support' );
	} );

	test( 'a server template survives a payload that still names it', () => {
		applyServerWorkspacePresets( [ { id: 'commerce' }, { id: 'support' } ] );
		applyServerWorkspacePresets( [ { id: 'commerce' }, { id: 'support' } ] );
		expect( findWorkspacePreset( 'support' ) ).not.toBeNull();
	} );

	test( 'a server template retires when its plugin is deactivated', () => {
		applyServerWorkspacePresets( [ { id: 'commerce' }, { id: 'support' } ] );
		expect( findWorkspacePreset( 'support' ) ).not.toBeNull();
		applyServerWorkspacePresets( [ { id: 'commerce' } ] );
		expect( findWorkspacePreset( 'support' ) ).toBeNull();
	} );

	test( 'a malformed layout on a server template falls back', () => {
		applyServerWorkspacePresets( [
			{ id: 'commerce' },
			{ id: 'weird', layout: 'diagonal' },
		] );
		expect( findWorkspacePreset( 'weird' )?.layout ).toBe( 'free' );
	} );
} );
