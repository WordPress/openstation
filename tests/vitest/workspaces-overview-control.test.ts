/**
 * What the overview top bar can do with workspaces.
 *
 * Three rules this file exists to hold:
 *
 * 1. **Nothing appears on the desk.** Creating, editing and restoring
 *    are controls in the overview bar; shell chrome floating over the
 *    user's windows is not the shape this feature takes.
 * 2. **Without an installed shell, the bar is exactly what it was.**
 *    Every export answers `false` before the install and after
 *    teardown, so the `+` falls back to a plain new desk and every
 *    existing overview test still builds the bar it always did.
 * 3. **One door.** The `+` opens the wizard; there is no second
 *    control that creates desks. The wizard's own escape hatch — a
 *    blank desk one Enter away — is tested in `workspaces-wizard`.
 */

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
		clearHooksStub();
		vi.restoreAllMocks();
	} );

	test( 'without an installed shell, every door answers false', () => {
		expect( isWorkspaceOverviewInstalled() ).toBe( false );
		expect( createWorkspaceFromOverview() ).toBe( false );
		expect( editWorkspaceFromOverview( 'desktop-1' ) ).toBe( false );
		expect( restoreWorkspace( 'desktop-1' ) ).toBe( false );
	} );

	test( 'teardown puts the bar back the way it was', () => {
		install();
		expect( isWorkspaceOverviewInstalled() ).toBe( true );
		teardown?.();
		teardown = null;
		expect( isWorkspaceOverviewInstalled() ).toBe( false );
		expect( createWorkspaceFromOverview() ).toBe( false );
	} );

	test( 'the + opens the wizard, and creates nothing itself', () => {
		install();
		const before = manager.getDesktops().length;

		expect( createWorkspaceFromOverview() ).toBe( true );

		expect( openCreator ).toHaveBeenCalledTimes( 1 );
		// The wizard decides what gets made — a blank desk, a template,
		// a customized one. The bar only opens the door.
		expect( manager.getDesktops() ).toHaveLength( before );
	} );

	test( 'Edit opens the wizard on that desk', () => {
		install();
		expect( editWorkspaceFromOverview( 'desktop-1' ) ).toBe( true );
		expect( openEditor ).toHaveBeenCalledWith( 'desktop-1' );
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
		const open = vi.spyOn( manager, 'open' ).mockResolvedValue( {} as never );
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

	test( 'nothing is ever mounted on the desk', () => {
		install();
		createWorkspaceFromOverview();
		editWorkspaceFromOverview( 'desktop-1' );
		// Every door hands off to the shell's wizard. Opening one must
		// not put anything on the desk or in the document — shell
		// chrome floating over the user's windows is exactly the shape
		// this feature does not take.
		expect( desktop.children ).toHaveLength( 0 );
		expect( document.querySelector( '.os-workspace-switcher' ) ).toBeNull();
		expect( document.querySelector( 'os-select' ) ).toBeNull();
	} );
} );
