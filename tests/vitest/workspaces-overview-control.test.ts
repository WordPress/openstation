import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import {
	createWorkspace,
	createWorkspaceFromOverview,
	editWorkspaceFromOverview,
	installWorkspaceOverviewControl,
	isWorkspaceOverviewInstalled,
	restoreWorkspace,
	workspaceCanRestore,
	type WorkspaceDeps,
} from '../../src/workspaces';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

describe( 'workspaces — overview top bar', () => {
	let desktop: HTMLElement;
	let manager: WindowManager;
	let deps: WorkspaceDeps;
	let openCreator: ReturnType< typeof vi.fn >;
	let openEditor: ReturnType< typeof vi.fn >;
	let setAppearance: ReturnType< typeof vi.fn >;
	let setVisibleWidgets: ReturnType< typeof vi.fn >;
	let teardown: ( () => void ) | null = null;

	const install = (): void => {
		teardown = installWorkspaceOverviewControl( {
			...deps,
			openCreator,
			openEditor,
		} );
	};

	beforeEach( () => {
		installHooksStub();
		desktop = document.createElement( 'div' );
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
		openCreator = vi.fn();
		openEditor = vi.fn();
		setAppearance = vi.fn();
		setVisibleWidgets = vi.fn();
		deps = {
			manager,

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
		clearHooksStub();
		vi.restoreAllMocks();
	} );

	test( 'without an installed shell, every door answers false', () => {
		expect( isWorkspaceOverviewInstalled() ).toBe( false );
		expect( createWorkspaceFromOverview( 'desktop-1' ) ).toBe( false );
		expect( editWorkspaceFromOverview( 'desktop-1' ) ).toBe( false );
		expect( restoreWorkspace( 'desktop-1' ) ).toBe( false );
	} );

	test( 'teardown puts the bar back the way it was', () => {
		install();
		expect( isWorkspaceOverviewInstalled() ).toBe( true );
		teardown?.();
		teardown = null;
		expect( isWorkspaceOverviewInstalled() ).toBe( false );
		expect( createWorkspaceFromOverview( 'desktop-1' ) ).toBe( false );
	} );

	test( 'the + opens the wizard over the desk the bar just made', () => {
		install();
		const before = manager.getDesktops().length;

		expect( createWorkspaceFromOverview( 'desktop-1' ) ).toBe( true );

		expect( openCreator ).toHaveBeenCalledWith( 'desktop-1' );

		expect( manager.getDesktops() ).toHaveLength( before );
	} );

	test( 'clicking the + lands on a new blank desk, then opens the wizard', () => {
		install();
		manager.enterOverview();
		manager._overviewTopBar!.querySelector< HTMLElement >(
			'.os-overview-top-bar__tile--add',
		)!.click();

		expect( manager.getDesktops() ).toHaveLength( 2 );
		const created = manager.getDesktops()[ 1 ]!;
		expect( manager.getActiveDesktopId() ).toBe( created.id );
		expect( manager._overviewActive ).toBe( false );
		expect( openCreator ).toHaveBeenCalledWith( created.id );
	} );

	test( 'Edit opens the wizard on that desk', () => {
		install();
		expect( editWorkspaceFromOverview( 'desktop-1' ) ).toBe( true );
		expect( openEditor ).toHaveBeenCalledWith( 'desktop-1' );
	} );

	test( "the tile's pencil opens the wizard instead of renaming inline", () => {
		install();
		manager.enterOverview();
		const bar = manager._overviewTopBar!;
		bar.querySelector< HTMLElement >( '.os-overview-top-bar__tile-edit' )!.click();

		expect( openEditor ).toHaveBeenCalledWith( 'desktop-1' );
		expect( bar.querySelector( '[contenteditable]' ) ).toBeNull();
	} );

	test( 'a plain Space has nothing to restore', () => {

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

	test( 'nothing is ever mounted on the desk', () => {
		install();
		createWorkspaceFromOverview( 'desktop-1' );
		editWorkspaceFromOverview( 'desktop-1' );

		expect( desktop.children ).toHaveLength( 0 );
		expect( document.querySelector( '.os-workspace-switcher' ) ).toBeNull();
		expect( document.querySelector( 'os-select' ) ).toBeNull();
	} );
} );
