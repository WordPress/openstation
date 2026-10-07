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
	_resetNativeUrlRemap,
	bindNativeUrlRemap,
	registerNativeUrlRemap,
} from '../../src/native-url-remap';
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
				submenu: [ { title: 'Add Post', url: 'post-new.php' } ],
				selfLabel: 'All Posts',
				multi: true,
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

		await new Promise< void >( ( resolve ) =>
			requestAnimationFrame( () => requestAnimationFrame( resolve ) ),
		);
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktop.remove();
		_resetNativeUrlRemap();
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

		expect( refreshLayout ).toHaveBeenCalled();
	} );

	test( 'create() without a template leaves a plain Space', () => {
		const created = createWorkspace( deps, { activate: false } );
		expect( getWorkspaceProfile( manager, created.id ) ).toBeNull();

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
			.spyOn( manager, 'openNew' )
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

		expect( openNative ).toHaveBeenCalledWith( 'my-panel' );
		expect(
			getWorkspaceProfile( manager, created.id )?.provisioned,
		).toBe( true );

		open.mockClear();
		openNative.mockClear();
		provisionWorkspace( deps, created.id );
		expect( open ).not.toHaveBeenCalled();
		expect( openNative ).not.toHaveBeenCalled();
	} );

	test( 'a focus desk leads with its first entry, not the window that opened last', async () => {

		const created = createWorkspace( deps, { preset: 'publishing' } );

		provisionWorkspace( deps, created.id );
		await new Promise< void >( ( resolve ) =>
			requestAnimationFrame( () => requestAnimationFrame( resolve ) ),
		);

		const pageOf = ( page: string ) =>
			manager
				.getAll()
				.find( ( w ) => w.config.url === `${ ADMIN_URL }${ page }` )!;

		expect( pageOf( 'post-new.php' ).element.style.left ).toBe( '16px' );
		expect( pageOf( 'post-new.php' ).element.style.width ).toBe(
			`${ Math.floor( 1568 * 0.64 ) }px`,
		);
		expect( pageOf( 'edit.php' ).element.style.left ).not.toBe( '16px' );

		manager.focus( pageOf( 'edit.php' ) );
		provisionWorkspace( deps, created.id, { force: true } );
		await new Promise< void >( ( resolve ) =>
			requestAnimationFrame( () => requestAnimationFrame( resolve ) ),
		);
		expect( manager.getAll() ).toHaveLength( 2 );
		expect( pageOf( 'post-new.php' ).element.style.left ).toBe( '16px' );
		expect( pageOf( 'edit.php' ).element.style.left ).not.toBe( '16px' );

		pageOf( 'edit.php' ).close();
		reopenWorkspaceWindows( deps, created.id );
		for ( let i = 0; i < 2; i++ ) {
			await new Promise< void >( ( resolve ) =>
				requestAnimationFrame( () => requestAnimationFrame( resolve ) ),
			);
		}
		expect( manager.getAll() ).toHaveLength( 2 );
		expect( pageOf( 'post-new.php' ).element.style.left ).toBe( '16px' );
		expect( pageOf( 'edit.php' ).element.style.left ).not.toBe( '16px' );
	} );

	test( 'a launch opens the way a menu pick does, one window per entry', async () => {
		const openNew = vi
			.spyOn( manager, 'openNew' )
			.mockResolvedValue( {} as never );
		const native: string[] = [];
		const claim = ( id: string ) => {
			native.push( id );
			return true;
		};
		bindNativeUrlRemap( {
			getSnapshot: () => ( {} ) as never,
			openById: claim,
			openNewById: claim,
			adminUrl: ADMIN_URL,
		} );
		registerNativeUrlRemap( {
			id: 'desktop-mode-posts',
			nativeWindowId: 'desktop-mode-posts',
			matches: ( _url, parsed ) => parsed.pathname.endsWith( '/post-new.php' ),
		} );
		const created = createWorkspace( deps, {
			profile: {
				preset: '',
				icon: 'dashicons-desktop',
				color: '',
				apps: { mode: 'all', ids: [] },
				windows: [

					{ match: 'edit.php', url: 'post-new.php' },

					{ match: 'edit.php', url: 'edit.php' },
				],
				layout: 'free',
				provisioned: false,
			},
		} );

		provisionWorkspace( deps, created.id );

		expect( native ).toEqual( [ 'desktop-mode-posts' ] );
		expect( openNew ).toHaveBeenCalledTimes( 1 );
		expect( openNew.mock.calls[ 0 ][ 0 ] ).toMatchObject( {
			url: `${ ADMIN_URL }edit.php`,
			parentUrl: 'edit.php',
			submenu: [ { title: 'Add Post', url: 'post-new.php' } ],
			selfLabel: 'All Posts',
		} );

		openNew.mockRestore();
		const baseId = deps.deriveWindowId(
			absoluteAdminUrl( 'edit.php', ADMIN_URL ),
		);
		await manager.openNew( {
			id: baseId,
			baseId,
			url: `${ ADMIN_URL }edit.php`,
			title: 'Posts',
			desktopId: created.id,
		} );
		const again = vi
			.spyOn( manager, 'openNew' )
			.mockResolvedValue( {} as never );
		provisionWorkspace( deps, created.id, { force: true } );
		expect( again ).not.toHaveBeenCalled();
	} );

	test( 'reopen brings back a closed launch window and leaves the open ones alone', async () => {
		const created = createWorkspace( deps, {
			profile: {
				preset: '',
				icon: 'dashicons-desktop',
				color: '',
				apps: { mode: 'all', ids: [] },

				windows: [
					{ match: 'edit.php', url: 'post-new.php' },
					{ match: 'edit.php', url: 'edit.php' },
					{ match: 'my-panel' },
				],
				layout: 'free',

				provisioned: true,
			},
		} );

		const baseId = deps.deriveWindowId(
			absoluteAdminUrl( 'edit.php', ADMIN_URL ),
		);
		await manager.openNew( {
			id: baseId,
			baseId,
			url: `${ ADMIN_URL }edit-tags.php?taxonomy=category`,
			title: 'Posts',
			desktopId: created.id,
		} );
		const open = vi
			.spyOn( manager, 'openNew' )
			.mockResolvedValue( {} as never );

		reopenWorkspaceWindows( deps, created.id );

		expect( open ).toHaveBeenCalledTimes( 1 );
		expect( open.mock.calls[ 0 ][ 0 ] ).toMatchObject( {
			url: `${ ADMIN_URL }post-new.php`,
		} );

		expect( openNative ).toHaveBeenCalledWith( 'my-panel' );
	} );

	test( 'on a desk with suffixed ids, an entry takes the window on its page first', async () => {
		const created = createWorkspace( deps, {
			profile: {
				preset: '',
				icon: 'dashicons-desktop',
				color: '',
				apps: { mode: 'all', ids: [] },
				windows: [
					{ match: 'edit.php', url: 'post-new.php' },
					{ match: 'edit.php', url: 'edit.php' },
				],
				layout: 'free',
				provisioned: true,
			},
		} );

		const baseId = deps.deriveWindowId(
			absoluteAdminUrl( 'edit.php', ADMIN_URL ),
		);
		const openOnDesk = ( id: string, page: string ) =>
			manager.openNew( {
				id,
				baseId,
				url: `${ ADMIN_URL }${ page }`,
				title: 'Posts',
				desktopId: created.id,
			} );
		await openOnDesk( `${ baseId }-3`, 'edit.php' );
		const open = vi
			.spyOn( manager, 'openNew' )
			.mockResolvedValue( {} as never );

		provisionWorkspace( deps, created.id, { force: true } );

		expect( open ).toHaveBeenCalledTimes( 1 );
		expect( open.mock.calls[ 0 ][ 0 ] ).toMatchObject( {
			url: `${ ADMIN_URL }post-new.php`,
		} );

		open.mockRestore();
		await openOnDesk( `${ baseId }-2`, 'post.php?post=5&action=edit' );
		const again = vi
			.spyOn( manager, 'openNew' )
			.mockResolvedValue( {} as never );
		provisionWorkspace( deps, created.id, { force: true } );
		expect( again ).not.toHaveBeenCalled();
	} );

	test( 'reopen re-runs the layout only when it brought a window back', async () => {
		const tile = vi.spyOn( manager, 'tile' );
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
		const baseId = deps.deriveWindowId(
			absoluteAdminUrl( 'edit.php', ADMIN_URL ),
		);
		const list = await manager.openNew( {
			id: baseId,
			baseId,
			url: `${ ADMIN_URL }edit.php`,
			title: 'Posts',
			desktopId: created.id,
		} );
		refreshLayout.mockClear();

		reopenWorkspaceWindows( deps, created.id );
		await new Promise< void >( ( resolve ) =>
			requestAnimationFrame( () => requestAnimationFrame( () => resolve() ) ),
		);
		expect( tile ).not.toHaveBeenCalled();

		list.destroy();
		await vi.waitFor( () => expect( manager.getById( baseId ) ).toBeUndefined() );
		reopenWorkspaceWindows( deps, created.id );
		await vi.waitFor( () => expect( tile ).toHaveBeenCalledTimes( 1 ) );

		expect( refreshLayout ).not.toHaveBeenCalled();
	} );

	test( 'reopen is a no-op on a never-provisioned desk and a plain Space', () => {
		const open = vi
			.spyOn( manager, 'open' )
			.mockResolvedValue( {} as never );
		vi.spyOn( manager, 'getById' ).mockReturnValue( undefined );

		const plain = createWorkspace( deps, {} );
		reopenWorkspaceWindows( deps, plain.id );

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
			.spyOn( manager, 'openNew' )
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
			.spyOn( manager, 'openNew' )
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

		provisionWorkspace( deps, created.id );
		expect( open ).not.toHaveBeenCalled();

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

		expect( captured ).toMatchObject( [
			{
				match: 'edit-php',
				title: 'Posts',
				url: `${ ADMIN_URL }edit.php`,
			},

			{ match: 'my-panel', title: 'My panel' },
		] );
		expect( captured[ 1 ] ).not.toHaveProperty( 'url' );
	} );

	test( 'capture records where each window is, in a form that survives a resize', async () => {
		const created = createWorkspace( deps, { preset: 'publishing' } );

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

		expect( saved?.layout ).toBe( 'free' );

		expect( saved?.provisioned ).toBe( true );
		expect( saved?.widgets ).toEqual( { mode: 'only', ids: [ 'clock', 'desktop-mode/notes' ] } );

		expect( saved?.apps ).toEqual( { mode: 'only', ids: [ 'edit-php', 'my-panel' ] } );

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

		expect( saved?.apps.mode ).toBe( 'all' );
		expect( saved?.widgets?.mode ).toBe( 'all' );
		expect( saveDeskToWorkspace( deps, 'desktop-nope' ) ).toBeNull();
	} );

	test( 'provision puts a window where its entry says', async () => {
		const open = vi.spyOn( manager, 'openNew' );
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

		setVisibleWidgets.mockClear();
		applyWorkspaceWidgets( deps, manager.getDesktops()[ 0 ].id );
		expect( setVisibleWidgets ).toHaveBeenCalledWith( null );
	} );

	test( 'a profile with no widgets field hands the column back', () => {

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

		expect( setVisibleWidgets ).not.toHaveBeenCalled();
	} );

	test( 'a profile write that keeps the look repaints the widgets, not the look', () => {
		const woo = createWorkspace( deps, {
			profile: {
				preset: '',
				icon: 'dashicons-desktop',
				color: '',
				apps: { mode: 'all', ids: [] },
				widgets: { mode: 'only', ids: [ 'clock' ] },
				appearance: { wallpaper: 'mono' },
				windows: [],
				layout: 'free',
				provisioned: true,
			},
		} );
		const profile = getWorkspaceProfile( manager, woo.id )!;
		setAppearance.mockClear();
		setVisibleWidgets.mockClear();

		setWorkspaceProfile( deps, woo.id, {
			...profile,
			widgets: { mode: 'only', ids: [ 'clock', 'notes' ] },
		} );
		expect( setAppearance ).not.toHaveBeenCalled();
		expect( setVisibleWidgets ).toHaveBeenCalledWith( [ 'clock', 'notes' ] );

		setWorkspaceProfile( deps, woo.id, {
			...profile,
			appearance: { wallpaper: 'aurora' },
		} );
		expect( setAppearance ).toHaveBeenCalledWith( { wallpaper: 'aurora' } );
	} );

	test( 'a relative launch url resolves against wp-admin', () => {
		expect( absoluteAdminUrl( 'edit.php?post_type=product', ADMIN_URL ) ).toBe(
			`${ ADMIN_URL }edit.php?post_type=product`,
		);

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
		_resetNativeUrlRemap();
		teardown?.();
		teardown = null;
		clearHooksStub();
	} );

	test( 'before the server has spoken, every built-in stands', () => {

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
