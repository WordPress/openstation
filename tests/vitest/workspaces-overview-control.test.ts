/**
 * What the overview top bar can do with workspaces.
 *
 * Rules this file exists to hold:
 *
 * 1. **A workspace is saved from the main desk, never described.**
 *    The "Save as workspace" tile saves the main desk; the `+` makes a
 *    plain desk and nothing more.
 * 2. **Without an installed shell, the bar is exactly what it was.**
 *    Every export answers `false` before the install and after
 *    teardown.
 * 3. **A pinned user has one desk.** No second desk, no Overview.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import {
	cloneDeskAsWorkspace,
	createWorkspace,
	installWorkspaceOverviewControl,
	isWorkspaceOverviewInstalled,
	manageWorkspaceFromOverview,
	restoreWorkspace,
	saveWorkspaceFromOverview,
	workspaceCanRestore,
	type WorkspaceDeps,
} from '../../src/workspaces';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { isEditingWorkspace, showWorkspaceEditBar } from '../../src/workspaces/edit-bar';
import { WorkspaceNotesLayer } from '../../src/workspaces/notes';

describe( 'workspaces — overview top bar', () => {
	let desktop: HTMLElement;
	let manager: WindowManager;
	let deps: WorkspaceDeps;
	let saveAsWorkspace: ReturnType< typeof vi.fn >;
	let openManager: ReturnType< typeof vi.fn >;
	let restoreMain: ReturnType< typeof vi.fn >;
	let setAppearance: ReturnType< typeof vi.fn >;
	let setVisibleWidgets: ReturnType< typeof vi.fn >;
	let teardown: ( () => void ) | null = null;

	const install = (): void => {
		teardown = installWorkspaceOverviewControl( {
			...deps,
			saveAsWorkspace,
			openManager,
			restoreMain,
		} );
	};

	beforeEach( () => {
		installHooksStub();
		desktop = document.createElement( 'div' );
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
		saveAsWorkspace = vi.fn( () => ( { id: 'desktop-9', label: 'Workspace 9' } ) );
		openManager = vi.fn();
		restoreMain = vi.fn();
		setAppearance = vi.fn();
		setVisibleWidgets = vi.fn();
		deps = {
			manager,
			// One item, so a launch entry naming `edit.php` resolves.
			// An entry that matches nothing is skipped by design — see
			// `resolveLaunches` — and a stub returning `[]` would make
			// the restore test pass for the wrong reason.
			getNavItems: () => [
				{
					id: 'edit-php',
					kind: 'core' as const,
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
			],
			adminUrl: 'http://example.test/wp-admin/',
			deriveWindowId: ( url: string ) => url,
			openNative: vi.fn(),
			refreshLayout: vi.fn(),
			setAppearance,
			setVisibleWidgets,
		};
	} );

	afterEach( () => {
		teardown?.();
		teardown = null;
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktop.remove();
		delete ( window as unknown as { openStationConfig?: unknown } ).openStationConfig;
		clearHooksStub();
		vi.restoreAllMocks();
	} );

	test( 'without an installed shell, every door answers false', () => {
		expect( isWorkspaceOverviewInstalled() ).toBe( false );
		expect( saveWorkspaceFromOverview( 'desktop-1' ) ).toBe( false );
		expect( manageWorkspaceFromOverview( 'desktop-1' ) ).toBe( false );
		expect( restoreWorkspace( 'desktop-1' ) ).toBe( false );
	} );

	test( 'teardown puts the bar back the way it was', () => {
		install();
		expect( isWorkspaceOverviewInstalled() ).toBe( true );
		teardown?.();
		teardown = null;
		expect( isWorkspaceOverviewInstalled() ).toBe( false );
		expect( saveWorkspaceFromOverview( 'desktop-1' ) ).toBe( false );
	} );

	test( 'the + lands on a new plain desk and opens nothing', () => {
		install();
		manager.enterOverview();
		manager._overviewTopBar!.querySelector< HTMLElement >(
			'.os-overview-top-bar__tile--add',
		)!.click();

		expect( manager.getDesktops() ).toHaveLength( 2 );
		const created = manager.getDesktops()[ 1 ]!;
		expect( manager.getActiveDesktopId() ).toBe( created.id );
		expect( manager._overviewActive ).toBe( false );
		expect( created.profile ).toBeUndefined();
		expect( saveAsWorkspace ).not.toHaveBeenCalled();
	} );

	test( 'Create a workspace is a tile after the + that creates one and opens the app on it', () => {
		install();
		const shop = createWorkspace( deps, { label: 'Shop' } );
		manager.enterOverview();
		const bar = manager._overviewTopBar!;

		// One tile, last, right after the `+`.
		const create = bar.querySelector< HTMLElement >( '.os-overview-top-bar__tile--create' )!;
		expect( bar.querySelectorAll( '.os-overview-top-bar__tile--create' ) ).toHaveLength( 1 );
		expect( create.parentElement!.previousElementSibling!.classList.contains( 'os-overview-top-bar__tile-wrapper--add' ) ).toBe( true );
		expect( create.textContent ).toBe( 'Create a workspace' );
		expect( manager.getActiveDesktopId() ).toBe( shop.id );
		create.click();
		// It creates the workspace — from the main desk, quietly — and
		// opens the app on the new one.
		expect( manager._overviewActive ).toBe( false );
		expect( saveAsWorkspace ).toHaveBeenCalledWith( 'desktop-1', { announce: false } );
		expect( openManager ).toHaveBeenCalledWith( 'desktop-9' );
	} );

	test( 'Create a workspace falls back to the main desk card when nothing saves', () => {
		install();
		saveAsWorkspace.mockReturnValueOnce( null );
		manager.enterOverview();
		manager._overviewTopBar!.querySelector< HTMLElement >( '.os-overview-top-bar__tile--create' )!.click();
		expect( openManager ).toHaveBeenCalledWith( 'desktop-1' );
	} );

	test( 'Manage sits under each workspace and opens the app on it', () => {
		install();
		const shop = createWorkspace( deps, {
			activate: false,
			profile: {
				preset: '',
				icon: 'dashicons-cart',
				color: '',
				apps: { mode: 'all', ids: [] },
				windows: [],
				layout: 'free',
			},
		} );
		manager.enterOverview();
		const manage = manager._overviewTopBar!.querySelectorAll< HTMLElement >(
			'.os-overview-top-bar__tile-manage',
		);

		expect( manage ).toHaveLength( 1 );
		manage[ 0 ]!.click();
		expect( openManager ).toHaveBeenCalledWith( shop.id );
	} );

	test( 'Restore sits under the main desk only, and restores it', () => {
		install();
		createWorkspace( deps, { activate: false, label: 'Shop' } );
		manager.enterOverview();
		const resets = manager._overviewTopBar!.querySelectorAll< HTMLElement >(
			'.os-overview-top-bar__tile-reset',
		);

		expect( resets ).toHaveLength( 1 );
		resets[ 0 ]!.click();
		expect( restoreMain ).toHaveBeenCalledTimes( 1 );
	} );

	test( "the tile's pencil renames in place", () => {
		install();
		createWorkspace( deps, { label: 'Shop', activate: false } );
		manager.enterOverview();
		const bar = manager._overviewTopBar!;
		bar.querySelector< HTMLElement >( '.os-overview-top-bar__tile-edit' )!.click();

		expect( openManager ).not.toHaveBeenCalled();
		expect( bar.querySelector( '[contenteditable]' ) ).not.toBeNull();
	} );

	test( 'saving a desk makes a new, unprovisioned workspace and leaves the source alone', () => {
		const created = cloneDeskAsWorkspace( deps, 'desktop-1', {
			visibleAppIds: [ 'edit-php' ],
			mountedWidgetIds: [ 'clock' ],
			appearance: { wallpaper: 'mono' },
		} );

		expect( created ).not.toBeNull();
		expect( manager.getDesktops() ).toHaveLength( 2 );
		// Still on the main desk: the user is working there.
		expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
		expect( manager.getDesktops()[ 0 ]!.profile ).toBeUndefined();
		expect( created!.profile ).toMatchObject( {
			apps: { mode: 'only', ids: [ 'edit-php' ] },
			widgets: { mode: 'only', ids: [ 'clock' ] },
			appearance: { wallpaper: 'mono' },
			layout: 'free',
			provisioned: false,
		} );
		expect( cloneDeskAsWorkspace( deps, 'nope' ) ).toBeNull();
	} );

	test( 'saving never keeps the Workspaces app, even when it is open on the desk', async () => {
		await manager.open( { id: 'edit-php', url: 'http://example.test/wp-admin/edit.php', title: 'Posts', icon: 'x' } );
		await manager.open( { id: 'openstation-workspaces', url: '#openstation-workspaces', title: 'Workspaces', icon: 'x', native: true } );

		const created = cloneDeskAsWorkspace( deps, 'desktop-1' );

		expect( created!.profile!.windows.map( ( w ) => w.match ) ).toEqual( [ 'edit-php' ] );
	} );

	test( 'the edit bar sits across the top of the shell until Save succeeds or Cancel', () => {
		const shell = document.createElement( 'div' );
		shell.id = 'os-shell';
		shell.append( document.createElement( 'main' ) );
		document.body.append( shell );
		const onCancel = vi.fn();
		let saves = false;
		showWorkspaceEditBar( { label: 'Shop', onSave: () => saves, onCancel } );

		const bar = shell.firstElementChild as HTMLElement;
		expect( bar.className ).toBe( 'os-workspace-editbar' );
		expect( bar.textContent ).toContain( 'Shop' );
		expect( isEditingWorkspace() ).toBe( true );
		const [ cancel, save ] = bar.querySelectorAll< HTMLElement >( 'os-button' );

		// A save that did not happen keeps the bar up.
		save.click();
		expect( shell.querySelector( '.os-workspace-editbar' ) ).not.toBeNull();
		saves = true;
		save.click();
		expect( shell.querySelector( '.os-workspace-editbar' ) ).toBeNull();
		expect( isEditingWorkspace() ).toBe( false );

		showWorkspaceEditBar( { label: 'Shop', onSave: () => true, onCancel } );
		( shell.querySelector( '.os-workspace-editbar os-button' ) as HTMLElement ).click();
		expect( onCancel ).toHaveBeenCalledTimes( 1 );
		expect( shell.querySelector( '.os-workspace-editbar' ) ).toBeNull();
		shell.remove();
	} );

	test( 'workspace notes: read-only and dismissable, editable only while editing', () => {
		const host = document.createElement( 'div' );
		document.body.append( host );
		const dismiss = vi.fn();
		const layer = new WorkspaceNotesLayer( { host, pluginUrl: '/p', dismissed: [ 'gone' ], dismiss } );
		const notes = [
			{ id: 'hello', text: 'Welcome', size: 'xl' as const, color: 'sky', x: 0.1, y: 0.1 },
			{ id: 'gone', text: 'Old', size: 'normal' as const, color: 'butter', x: 0.5, y: 0.5 },
		];

		layer.show( notes );
		// The dismissed one is not shown; the other cannot be edited.
		expect( host.querySelectorAll( '.os-workspace-note' ) ).toHaveLength( 1 );
		const note = host.querySelector< HTMLElement >( '.os-workspace-note' )!;
		expect( note.dataset.size ).toBe( 'xl' );
		expect( note.querySelector( '[contenteditable]' ) ).toBeNull();
		note.querySelector< HTMLElement >( '.os-workspace-note__close' )!.click();
		expect( dismiss ).toHaveBeenCalledWith( 'hello' );

		// Editing shows every note, editable, and collects new ones.
		layer.show( notes, true );
		expect( host.querySelectorAll( '[contenteditable]' ) ).toHaveLength( 2 );
		layer.add( 'normal' );
		const fresh = host.querySelectorAll< HTMLElement >( '.os-pinned-note__body' )[ 2 ];
		fresh.textContent = 'Ask us before touching Plugins';
		fresh.dispatchEvent( new Event( 'input' ) );
		expect( layer.collect().map( ( n ) => n.text ) ).toEqual( [ 'Welcome', 'Old', 'Ask us before touching Plugins' ] );
		layer.destroy();
		host.remove();
	} );

	test( 'a pinned user gets no second desk and no Overview', () => {
		( window as unknown as { openStationConfig: unknown } ).openStationConfig = {
			workspacePin: { label: 'Store', author: 'Agency' },
		};
		const desk = manager.createDesktop();

		expect( desk.id ).toBe( 'desktop-1' );
		expect( manager.getDesktops() ).toHaveLength( 1 );
		manager.enterOverview();
		expect( manager._overviewActive ).toBe( false );
	} );

	test( 'a plain Space has nothing to restore', () => {
		// A button that visibly does nothing is worse than no button,
		// so its absence is information: this desk holds no workspace.
		expect(
			workspaceCanRestore( { id: 'desktop-1', label: 'Desktop 1' } ),
		).toBe( false );
	} );

	test( 'a workspace that only has a name and colour offers nothing either', () => {
		expect(
			workspaceCanRestore( {
				id: 'd',
				label: 'D',
				profile: {
					preset: '',
					icon: 'dashicons-desktop',
					color: '#ff0000',
					apps: { mode: 'only', ids: [ 'edit-php' ] },
					widgets: { mode: 'all', ids: [] },
					appearance: {},
					windows: [],
					layout: 'free',
					provisioned: true,
				},
			} ),
		).toBe( false );
	} );

	test( 'anything a restore would actually do makes it offered', () => {
		const base = {
			preset: '',
			icon: 'dashicons-desktop',
			color: '',
			apps: { mode: 'all' as const, ids: [] },
			widgets: { mode: 'all' as const, ids: [] },
			appearance: {},
			windows: [],
			layout: 'free' as const,
			provisioned: true,
		};
		const canRestoreWith = ( patch: Partial< typeof base > ): boolean =>
			workspaceCanRestore( {
				id: 'd',
				label: 'D',
				profile: { ...base, ...patch },
			} );

		expect( canRestoreWith( { windows: [ { match: 'edit.php' } ] } ) ).toBe(
			true,
		);
		expect( canRestoreWith( { layout: 'columns' } ) ).toBe( true );
		expect(
			canRestoreWith( { widgets: { mode: 'only', ids: [ 'clock' ] } } ),
		).toBe( true );
		expect( canRestoreWith( { appearance: { wallpaper: 'mono' } } ) ).toBe(
			true,
		);
	} );

	test( 'restore switches to the desk and rebuilds it', () => {
		install();
		// Restore is a forced provision, and provisioning opens one
		// window per declared entry — `openNew`, never a focus.
		const open = vi
			.spyOn( manager, 'openNew' )
			.mockResolvedValue( {} as never );
		const shop = createWorkspace( deps, {
			activate: false,
			profile: {
				preset: '',
				icon: 'dashicons-cart',
				color: '',
				apps: { mode: 'all', ids: [] },
				widgets: { mode: 'only', ids: [ 'clock' ] },
				appearance: { wallpaper: 'mono' },
				windows: [ { match: 'edit.php', url: 'edit.php' } ],
				layout: 'columns',
				// Already provisioned — the desk the user has since
				// tidied is exactly the case this button is for, and
				// the once-per-workspace guard must not refuse them.
				provisioned: true,
			},
		} );
		setAppearance.mockClear();
		setVisibleWidgets.mockClear();

		expect( restoreWorkspace( shop.id ) ).toBe( true );

		expect( manager.getActiveDesktopId() ).toBe( shop.id );
		expect( setAppearance ).toHaveBeenCalledWith( { wallpaper: 'mono' } );
		expect( setVisibleWidgets ).toHaveBeenCalledWith( [ 'clock' ] );
		expect( open ).toHaveBeenCalledTimes( 1 );
	} );
} );
