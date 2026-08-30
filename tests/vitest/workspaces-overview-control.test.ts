/**
 * The workspace picker in the overview top bar.
 *
 * Two rules this file exists to hold:
 *
 * 1. **Nothing appears on the desk.** The picker is a control in the
 *    overview bar; overview is already the Spaces surface, and shell
 *    chrome floating over the user's windows is not the shape this
 *    feature takes. A grep for the old pill's class is part of the
 *    test on purpose.
 * 2. **Without an installed shell, the bar is exactly what it was.**
 *    `buildWorkspaceOverviewControl` returns `null` before the install
 *    and after teardown, so every existing overview test still builds
 *    the bar it always did.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import {
	buildWorkspaceOverviewControl,
	createWorkspace,
	installWorkspaceOverviewControl,
	restoreWorkspace,
	workspaceCanRestore,
	type WorkspaceDeps,
} from '../../src/workspaces';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

/** Option values in the built control, headings included. */
function optionValues( el: HTMLElement ): string[] {
	return Array.from( el.querySelectorAll( 'os-option' ) ).map(
		( o ) => o.getAttribute( 'value' ) ?? '',
	);
}

/** Pick an option the way `<os-select>` reports a user choice. */
function pick( el: HTMLElement, value: string ): void {
	el.querySelector( 'os-select' )?.dispatchEvent(
		new CustomEvent( 'os-pick', { detail: { value } } ),
	);
}

describe( 'workspace picker — overview top bar', () => {
	let desktop: HTMLElement;
	let manager: WindowManager;
	let deps: WorkspaceDeps;
	let openEditor: ReturnType< typeof vi.fn >;
	let setAppearance: ReturnType< typeof vi.fn >;
	let setVisibleWidgets: ReturnType< typeof vi.fn >;
	let teardown: ( () => void ) | null = null;

	beforeEach( () => {
		installHooksStub();
		desktop = document.createElement( 'div' );
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
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

	const handlers = () => ( {
		onSwitch: vi.fn(),
		onCreated: vi.fn(),
	} );

	test( 'without an installed shell there is no control at all', () => {
		expect(
			buildWorkspaceOverviewControl( manager.getDesktops(), 'desktop-1', handlers() ),
		).toBeNull();
	} );

	test( 'teardown puts the bar back the way it was', () => {
		const off = installWorkspaceOverviewControl( { ...deps, openEditor } );
		expect(
			buildWorkspaceOverviewControl( manager.getDesktops(), 'desktop-1', handlers() ),
		).not.toBeNull();
		off();
		expect(
			buildWorkspaceOverviewControl( manager.getDesktops(), 'desktop-1', handlers() ),
		).toBeNull();
	} );

	test( 'it lists desks, then templates, then the manage rows', () => {
		teardown = installWorkspaceOverviewControl( { ...deps, openEditor } );
		const control = buildWorkspaceOverviewControl(
			manager.getDesktops(),
			manager.getActiveDesktopId(),
			handlers(),
		)!;

		expect( optionValues( control ) ).toEqual( [
			'heading:Workspaces',
			'desktop-1',
			'heading:New from template',
			'os-new-preset:woo',
			'os-new-preset:sensei',
			'os-new-preset:longreads',
			'heading:Manage',
			'os-new-blank',
			'os-edit-current',
		] );

		// The value is the active desk, so the trigger reads as where
		// the user is rather than as an empty field.
		expect(
			control.querySelector( 'os-select' )?.getAttribute( 'value' ),
		).toBe( 'desktop-1' );
	} );

	test( 'headings are disabled, so a user cannot land on one', () => {
		teardown = installWorkspaceOverviewControl( { ...deps, openEditor } );
		const control = buildWorkspaceOverviewControl(
			manager.getDesktops(),
			'desktop-1',
			handlers(),
		)!;
		for ( const opt of Array.from(
			control.querySelectorAll( 'os-option' ),
		) ) {
			const isHeading = (
				opt.getAttribute( 'value' ) ?? ''
			).startsWith( 'heading:' );
			expect( opt.hasAttribute( 'disabled' ) ).toBe( isHeading );
		}
	} );

	test( 'picking a desk asks the bar to go there', () => {
		teardown = installWorkspaceOverviewControl( { ...deps, openEditor } );
		const h = handlers();
		const control = buildWorkspaceOverviewControl(
			manager.getDesktops(),
			'desktop-1',
			h,
		)!;

		pick( control, 'desktop-1' );

		// Navigation is the bar's call, not the control's — leaving
		// overview is what a tile click means too.
		expect( h.onSwitch ).toHaveBeenCalledWith( 'desktop-1' );
		expect( h.onCreated ).not.toHaveBeenCalled();
	} );

	test( 'picking a template creates the desk and hands it back', () => {
		teardown = installWorkspaceOverviewControl( { ...deps, openEditor } );
		const h = handlers();
		const control = buildWorkspaceOverviewControl(
			manager.getDesktops(),
			'desktop-1',
			h,
		)!;

		pick( control, 'os-new-preset:woo' );

		const created = manager.getDesktops().at( -1 )!;
		expect( created.label ).toBe( 'Woo' );
		expect( created.profile?.preset ).toBe( 'woo' );
		expect( created.profile?.layout ).toBe( 'columns' );
		expect( h.onCreated ).toHaveBeenCalledWith( created.id );
		// Created without activating: the bar decides when to land on
		// it, because landing means leaving overview.
		expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
	} );

	test( '"New workspace…" makes a blank desk and opens the editor on it', () => {
		teardown = installWorkspaceOverviewControl( { ...deps, openEditor } );
		const h = handlers();
		const control = buildWorkspaceOverviewControl(
			manager.getDesktops(),
			'desktop-1',
			h,
		)!;

		pick( control, 'os-new-blank' );

		const created = manager.getDesktops().at( -1 )!;
		expect( created.profile ).toBeUndefined();
		expect( openEditor ).toHaveBeenCalledWith( created.id );
		expect( h.onCreated ).toHaveBeenCalledWith( created.id );
	} );

	test( '"Edit this workspace…" edits the desk the bar named', () => {
		teardown = installWorkspaceOverviewControl( { ...deps, openEditor } );
		const control = buildWorkspaceOverviewControl(
			manager.getDesktops(),
			'desktop-1',
			handlers(),
		)!;

		pick( control, 'os-edit-current' );

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
		teardown = installWorkspaceOverviewControl( { ...deps, openEditor } );
		const open = vi.spyOn( manager, 'open' ).mockResolvedValue( {} as never );
		const woo = createWorkspace( deps, {
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

		expect( restoreWorkspace( woo.id ) ).toBe( true );

		expect( manager.getActiveDesktopId() ).toBe( woo.id );
		expect( setAppearance ).toHaveBeenCalledWith( { wallpaper: 'mono' } );
		expect( setVisibleWidgets ).toHaveBeenCalledWith( [ 'clock' ] );
		expect( open ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'restore without an installed shell does nothing', () => {
		expect( restoreWorkspace( 'desktop-1' ) ).toBe( false );
	} );

	test( 'nothing is ever mounted on the desk', () => {
		teardown = installWorkspaceOverviewControl( { ...deps, openEditor } );
		buildWorkspaceOverviewControl(
			manager.getDesktops(),
			'desktop-1',
			handlers(),
		);
		// The picker is a control the overview bar appends. Building
		// one must not put anything on the desk or in the document —
		// shell chrome floating over the user's windows is exactly the
		// shape this feature does not take.
		expect( desktop.children ).toHaveLength( 0 );
		expect(
			document.querySelector( '.os-workspace-switcher' ),
		).toBeNull();
	} );
} );
