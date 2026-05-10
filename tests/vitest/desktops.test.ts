/**
 * Behavioural + hook-firing tests for the multi-desktop ("Spaces")
 * support in {@link WindowManager}. Covers:
 *
 *   - default desktop registry shape
 *   - createDesktop / switchDesktop / closeDesktop semantics
 *   - window visibility tracks the active desktop
 *   - last-desktop-cannot-be-closed invariant
 *   - migration target picks the left neighbour by default
 *   - the desktop-mode.desktop.* action firings
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import {
	clearHooksStub,
	installHooksStub,
	recordActions,
	type FakeWpHooks,
} from './helpers/hooks-stub';

const DESKTOP_HOOKS = [
	'desktop-mode.desktop.created',
	'desktop-mode.desktop.closed',
	'desktop-mode.desktop.switched',
] as const;

function openConfig( id: string ) {
	return {
		id,
		url: `http://example.test/wp-admin/${ id }.php`,
		title: id,
		icon: 'dashicons-admin-generic',
	};
}

describe( 'WindowManager — virtual desktops', () => {
	let hooks: FakeWpHooks;
	let desktopArea: HTMLElement;
	let manager: WindowManager;

	beforeEach( () => {
		hooks = installHooksStub();
		desktopArea = document.createElement( 'div' );
		Object.defineProperty( desktopArea, 'getBoundingClientRect', {
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
		Object.defineProperty( desktopArea, 'clientWidth', { value: 1600, configurable: true } );
		Object.defineProperty( desktopArea, 'clientHeight', { value: 900, configurable: true } );
		document.body.appendChild( desktopArea );
		manager = new WindowManager( desktopArea );
	} );

	afterEach( () => {
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktopArea.remove();
		clearHooksStub();
	} );

	test( 'starts with a single default desktop named "Desktop 1"', () => {
		const list = manager.getDesktops();
		expect( list ).toHaveLength( 1 );
		expect( list[ 0 ].id ).toBe( 'desktop-1' );
		expect( list[ 0 ].label ).toBe( 'Desktop 1' );
		expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
	} );

	test( 'createDesktop appends + fires desktop.created with the new id', () => {
		const log = recordActions( hooks, DESKTOP_HOOKS );

		const created = manager.createDesktop();

		expect( manager.getDesktops().map( ( d ) => d.id ) ).toEqual( [
			'desktop-1',
			created.id,
		] );
		expect( created.id ).toBe( 'desktop-2' );
		expect( created.label ).toBe( 'Desktop 2' );

		const evt = log.find( ( e ) => e.name === 'desktop-mode.desktop.created' );
		expect( evt ).toBeDefined();
		expect(
			( evt!.args[ 0 ] as { desktopId: string } ).desktopId,
		).toBe( created.id );
	} );

	test( 'newly opened windows join the currently active desktop', () => {
		const a = manager.open( openConfig( 'a' ) );
		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		const b = manager.open( openConfig( 'b' ) );

		expect( a.config.desktopId ).toBe( 'desktop-1' );
		expect( b.config.desktopId ).toBe( second.id );
	} );

	test( 'switchDesktop hides previous desktop windows + shows new ones', () => {
		const a = manager.open( openConfig( 'a' ) );
		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		const b = manager.open( openConfig( 'b' ) );

		// On desktop-2 now: a hidden, b shown.
		expect( a.element.style.display ).toBe( 'none' );
		expect( b.element.style.display ).toBe( '' );

		manager.switchDesktop( 'desktop-1' );

		// Back on desktop-1: a shown, b hidden.
		expect( a.element.style.display ).toBe( '' );
		expect( b.element.style.display ).toBe( 'none' );
	} );

	test( 'switchDesktop fires desktop.switched with from + to ids', () => {
		const second = manager.createDesktop();
		const log = recordActions( hooks, DESKTOP_HOOKS );

		manager.switchDesktop( second.id );

		const evt = log.find( ( e ) => e.name === 'desktop-mode.desktop.switched' );
		expect( evt ).toBeDefined();
		const payload = evt!.args[ 0 ] as { from: string; to: string };
		expect( payload.from ).toBe( 'desktop-1' );
		expect( payload.to ).toBe( second.id );
	} );

	test( 'switchDesktop is a no-op when target is already active', () => {
		const log = recordActions( hooks, DESKTOP_HOOKS );

		manager.switchDesktop( 'desktop-1' );

		expect(
			log.some( ( e ) => e.name === 'desktop-mode.desktop.switched' ),
		).toBe( false );
	} );

	test( 'switchDesktop ignores unknown ids', () => {
		const log = recordActions( hooks, DESKTOP_HOOKS );

		manager.switchDesktop( 'nope' );

		expect(
			log.some( ( e ) => e.name === 'desktop-mode.desktop.switched' ),
		).toBe( false );
		expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
	} );

	test( 'closeDesktop migrates windows to the left-neighbour and fires .closed', () => {
		const a = manager.open( openConfig( 'a' ) );
		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		const b = manager.open( openConfig( 'b' ) );
		const log = recordActions( hooks, DESKTOP_HOOKS );

		manager.closeDesktop( second.id );

		// b migrated to desktop-1 (the left neighbour) and is now visible
		// because we also auto-switched to that survivor.
		expect( b.config.desktopId ).toBe( 'desktop-1' );
		expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
		expect( a.element.style.display ).toBe( '' );
		expect( b.element.style.display ).toBe( '' );

		const evt = log.find( ( e ) => e.name === 'desktop-mode.desktop.closed' );
		expect( evt ).toBeDefined();
		const payload = evt!.args[ 0 ] as { desktopId: string; migratedTo: string };
		expect( payload.desktopId ).toBe( second.id );
		expect( payload.migratedTo ).toBe( 'desktop-1' );
	} );

	test( 'closing the leftmost desktop migrates to the right-neighbour', () => {
		const second = manager.createDesktop();
		const a = manager.open( openConfig( 'a' ) );
		manager.switchDesktop( second.id );

		manager.closeDesktop( 'desktop-1' );

		expect( a.config.desktopId ).toBe( second.id );
		expect( manager.getActiveDesktopId() ).toBe( second.id );
	} );

	test( 'cannot close the last remaining desktop', () => {
		const log = recordActions( hooks, DESKTOP_HOOKS );

		manager.closeDesktop( 'desktop-1' );

		expect( manager.getDesktops() ).toHaveLength( 1 );
		expect(
			log.some( ( e ) => e.name === 'desktop-mode.desktop.closed' ),
		).toBe( false );
	} );

	test( 'closing a non-active desktop does not change the active id', () => {
		manager.createDesktop(); // desktop-2
		const third = manager.createDesktop(); // desktop-3
		// Active is still desktop-1.

		manager.closeDesktop( third.id );

		expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
		expect( manager.getDesktops().map( ( d ) => d.id ) ).toEqual( [
			'desktop-1',
			'desktop-2',
		] );
	} );

	test( 'closing the active desktop while in overview re-lays out the survivor', () => {
		// Set up: two windows on D1 (active), one on D2.
		manager.open( openConfig( 'a' ) );
		manager.open( openConfig( 'b' ) );
		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		const c = manager.open( openConfig( 'c' ) );
		manager.switchDesktop( 'desktop-1' );

		// Enter overview — D1 windows pick up the --overview class.
		manager.enterOverview();
		const a = manager.getById( 'a' )!;
		const b = manager.getById( 'b' )!;
		expect( a.element.classList.contains( 'desktop-mode-window--overview' ) ).toBe( true );
		expect( b.element.classList.contains( 'desktop-mode-window--overview' ) ).toBe( true );
		// `c` is on the inactive desktop — hidden, no overview class.
		expect( c.element.style.display ).toBe( 'none' );
		expect( c.element.classList.contains( 'desktop-mode-window--overview' ) ).toBe( false );

		// Close the active desktop. Survivor (desktop-2) absorbs a + b
		// AND becomes active. Since we're in overview, the grid must
		// re-lay out for the new active set: a, b, c all on desktop-2,
		// all visible, all carrying the overview class.
		manager.closeDesktop( 'desktop-1' );

		expect( manager.getActiveDesktopId() ).toBe( second.id );
		expect( a.config.desktopId ).toBe( second.id );
		expect( b.config.desktopId ).toBe( second.id );
		// All three windows are now on the active desktop and back in
		// the grid — none hidden, none missing the overview class.
		expect( a.element.style.display ).toBe( '' );
		expect( b.element.style.display ).toBe( '' );
		expect( c.element.style.display ).toBe( '' );
		expect( a.element.classList.contains( 'desktop-mode-window--overview' ) ).toBe( true );
		expect( b.element.classList.contains( 'desktop-mode-window--overview' ) ).toBe( true );
		expect( c.element.classList.contains( 'desktop-mode-window--overview' ) ).toBe( true );
	} );

	test( 'snapshot preserves geometry for windows on non-active desktops', () => {
		// Regression: when a window sits on a hidden (display: none)
		// desktop, `offsetLeft/Top/Width/Height` all return 0 because
		// the element isn't laid out. Snapshot must fall back to the
		// inline style strings so a hard reload restores the user's
		// saved position instead of "defaults at 0,0".
		const a = manager.open( openConfig( 'a' ) );
		// Stamp known geometry on the active desktop's window.
		a.element.style.left = '180px';
		a.element.style.top = '120px';
		a.element.style.width = '640px';
		a.element.style.height = '480px';

		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		// `a` is now on an inactive desktop → display: none.
		expect( a.element.style.display ).toBe( 'none' );

		const snap = manager.snapshot();
		const aEntry = snap.windows.find( ( w ) => w.id === 'a' )!;
		expect( aEntry.x ).toBe( 180 );
		expect( aEntry.y ).toBe( 120 );
		expect( aEntry.width ).toBe( 640 );
		expect( aEntry.height ).toBe( 480 );
	} );
} );
