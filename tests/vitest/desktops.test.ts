/**
 * Behavioural + hook-firing tests for the multi-desktop ("Spaces")
 * support in {@link WindowManager}. Covers:
 *
 *   - default desktop registry shape
 *   - createDesktop / switchDesktop / closeDesktop semantics
 *   - window visibility tracks the active desktop
 *   - last-desktop-cannot-be-closed invariant
 *   - migration target picks the left neighbour by default
 *   - the os.os.* action firings
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import { closeDesktop } from '../../src/window-manager/desktops';
import {
	clearHooksStub,
	installHooksStub,
	recordActions,
	type FakeWpHooks,
} from './helpers/hooks-stub';

const DESKTOP_HOOKS = [
	'os.os.created',
	'os.os.closed',
	'os.os.switched',
] as const;

function openConfig( id: string ) {
	return {
		id,
		url: `http://example.test/wp-admin/${ id }.php`,
		title: id,
		icon: 'dashicons-admin-generic',
	};
}

/**
 * Fire a synthetic `transitionend` for the `opacity` property on `el`.
 *
 * `Window.minimize()` registers a one-shot `transitionend` listener that
 * hides `content-visibility` and iframe visibility once the opacity
 * transition settles. This helper lets tests advance past that listener
 * without waiting on real animation frames.
 */
function dispatchOpacityTransitionEnd( el: HTMLElement ): void {
	const event = new Event( 'transitionend' ) as TransitionEvent;
	Object.defineProperty( event, 'propertyName', { value: 'opacity' } );
	el.dispatchEvent( event );
}

describe( 'WindowManager — virtual desktops', async () => {
	let hooks: FakeWpHooks;
	let desktopArea: HTMLElement;
	let manager: WindowManager;

	beforeEach( async () => {
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

	afterEach( async () => {
		// Several tests enter overview without explicitly exiting it.
		// `manager.destroy()` cancels the pending overview transition
		// timers (and, if still active, runs a synchronous exit) so
		// none of them fire later and reach for `window.wp.hooks`
		// after `clearHooksStub()` below has removed it.
		manager.destroy();
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktopArea.remove();
		clearHooksStub();
	} );

	test( 'starts with a single default desktop named "Desktop 1"', async () => {
		const list = manager.getDesktops();
		expect( list ).toHaveLength( 1 );
		expect( list[ 0 ].id ).toBe( 'desktop-1' );
		expect( list[ 0 ].label ).toBe( 'Desktop 1' );
		expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
	} );

	test( 'createDesktop appends + fires desktop.created with the new id', async () => {
		const log = recordActions( hooks, DESKTOP_HOOKS );

		const created = manager.createDesktop();

		expect( manager.getDesktops().map( ( d ) => d.id ) ).toEqual( [
			'desktop-1',
			created.id,
		] );
		expect( created.id ).toBe( 'desktop-2' );
		expect( created.label ).toBe( 'Desktop 2' );

		const evt = log.find( ( e ) => e.name === 'os.os.created' );
		expect( evt ).toBeDefined();
		expect(
			( evt!.args[ 0 ] as { desktopId: string } ).desktopId,
		).toBe( created.id );
	} );

	test( 'newly opened windows join the currently active desktop', async () => {
		const a = await manager.open( openConfig( 'a' ) );
		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		const b = await manager.open( openConfig( 'b' ) );

		expect( a.config.desktopId ).toBe( 'desktop-1' );
		expect( b.config.desktopId ).toBe( second.id );
	} );

	test( 'switchDesktop hides previous desktop windows + shows new ones', async () => {
		const a = await manager.open( openConfig( 'a' ) );
		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		const b = await manager.open( openConfig( 'b' ) );

		// On desktop-2 now: a hidden, b shown.
		expect( a.element.style.display ).toBe( 'none' );
		expect( b.element.style.display ).toBe( '' );

		manager.switchDesktop( 'desktop-1' );

		// Back on desktop-1: a shown, b hidden.
		expect( a.element.style.display ).toBe( '' );
		expect( b.element.style.display ).toBe( 'none' );
	} );

	test( 'switchDesktop fires desktop.switched with from + to ids', async () => {
		const second = manager.createDesktop();
		const log = recordActions( hooks, DESKTOP_HOOKS );

		manager.switchDesktop( second.id );

		const evt = log.find( ( e ) => e.name === 'os.os.switched' );
		expect( evt ).toBeDefined();
		const payload = evt!.args[ 0 ] as { from: string; to: string };
		expect( payload.from ).toBe( 'desktop-1' );
		expect( payload.to ).toBe( second.id );
	} );

	test( 'switchDesktop is a no-op when target is already active', async () => {
		const log = recordActions( hooks, DESKTOP_HOOKS );

		manager.switchDesktop( 'desktop-1' );

		expect(
			log.some( ( e ) => e.name === 'os.os.switched' ),
		).toBe( false );
	} );

	test( 'switchDesktop ignores unknown ids', async () => {
		const log = recordActions( hooks, DESKTOP_HOOKS );

		manager.switchDesktop( 'nope' );

		expect(
			log.some( ( e ) => e.name === 'os.os.switched' ),
		).toBe( false );
		expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
	} );

	test( 'closeDesktop migrates windows to the left-neighbour and fires .closed', async () => {
		const a = await manager.open( openConfig( 'a' ) );
		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		const b = await manager.open( openConfig( 'b' ) );
		const log = recordActions( hooks, DESKTOP_HOOKS );

		manager.closeDesktop( second.id );

		// b migrated to desktop-1 (the left neighbour) and is now visible
		// because we also auto-switched to that survivor.
		expect( b.config.desktopId ).toBe( 'desktop-1' );
		expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
		expect( a.element.style.display ).toBe( '' );
		expect( b.element.style.display ).toBe( '' );

		const evt = log.find( ( e ) => e.name === 'os.os.closed' );
		expect( evt ).toBeDefined();
		const payload = evt!.args[ 0 ] as { desktopId: string; migratedTo: string };
		expect( payload.desktopId ).toBe( second.id );
		expect( payload.migratedTo ).toBe( 'desktop-1' );
	} );

	test( 'closing the leftmost desktop migrates to the right-neighbour', async () => {
		const second = manager.createDesktop();
		const a = await manager.open( openConfig( 'a' ) );
		manager.switchDesktop( second.id );

		manager.closeDesktop( 'desktop-1' );

		expect( a.config.desktopId ).toBe( second.id );
		expect( manager.getActiveDesktopId() ).toBe( second.id );
	} );

	test( 'cannot close the last remaining desktop', async () => {
		const log = recordActions( hooks, DESKTOP_HOOKS );

		manager.closeDesktop( 'desktop-1' );

		expect( manager.getDesktops() ).toHaveLength( 1 );
		expect(
			log.some( ( e ) => e.name === 'os.os.closed' ),
		).toBe( false );
	} );

	test( 'closing a non-active desktop does not change the active id', async () => {
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

	test( 'closing the active desktop while in overview re-lays out the survivor', async () => {
		// Set up: two windows on D1 (active), one on D2.
		await manager.open( openConfig( 'a' ) );
		await manager.open( openConfig( 'b' ) );
		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		const c = await manager.open( openConfig( 'c' ) );
		manager.switchDesktop( 'desktop-1' );

		// Enter overview — D1 windows pick up the --overview class.
		manager.enterOverview();
		const a = manager.getById( 'a' )!;
		const b = manager.getById( 'b' )!;
		expect( a.element.classList.contains( 'os-window--overview' ) ).toBe( true );
		expect( b.element.classList.contains( 'os-window--overview' ) ).toBe( true );
		// `c` is on the inactive desktop — hidden, no overview class.
		expect( c.element.style.display ).toBe( 'none' );
		expect( c.element.classList.contains( 'os-window--overview' ) ).toBe( false );

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
		expect( a.element.classList.contains( 'os-window--overview' ) ).toBe( true );
		expect( b.element.classList.contains( 'os-window--overview' ) ).toBe( true );
		expect( c.element.classList.contains( 'os-window--overview' ) ).toBe( true );
	} );

	test( 'enterOverview shows minimized windows in grid without restoring them', async () => {
		// Previously the "Show Desktop → Overview" path auto-restored
		// all minimized windows to avoid an empty grid. Now minimized
		// windows participate in the grid directly, preserving the
		// user's minimization choice but rendering them as visible
		// thumbnails (dimmed via CSS).
		const a = await manager.open( openConfig( 'a' ) );
		const b = await manager.open( openConfig( 'b' ) );
		a.minimize();
		b.minimize();
		expect( a.state ).toBe( 'minimized' );
		expect( b.state ).toBe( 'minimized' );

		manager.enterOverview();

		// Windows stay minimized — overview does not auto-restore.
		expect( a.state ).toBe( 'minimized' );
		expect( b.state ).toBe( 'minimized' );
		// But they now participate in the grid thumbnails.
		expect(
			a.element.classList.contains( 'os-window--overview' ),
		).toBe( true );
		expect(
			b.element.classList.contains( 'os-window--overview' ),
		).toBe( true );
	} );

	test( 'enterOverview makes completed-minimize windows renderable for thumbnails', async () => {
		// Regression guard for the "minimized thumbnail renders blank" bug.
		// After the minimize transition fires, `content-visibility: hidden`
		// and `iframe.style.visibility = 'hidden'` are set on the window.
		// enterOverview must reverse these so the overview thumbnail shows
		// actual content instead of a blank slot.
		const a = await manager.open( openConfig( 'a' ) );
		a.minimize();
		dispatchOpacityTransitionEnd( a.element );
		expect( a.element.style.getPropertyValue( 'content-visibility' ) ).toBe(
			'hidden',
		);
		if ( a.iframe ) {
			expect( a.iframe.style.visibility ).toBe( 'hidden' );
		}

		manager.enterOverview();

		expect( a.element.style.getPropertyValue( 'content-visibility' ) ).toBe(
			'',
		);
		if ( a.iframe ) {
			expect( a.iframe.style.visibility ).toBe( '' );
		}
		expect(
			a.element.classList.contains( 'os-window--overview' ),
		).toBe( true );
	} );

	test( 'pending minimize transition does not re-hide an overview thumbnail', async () => {
		// The minimize() transitionend listener must NOT re-apply
		// content-visibility/iframe visibility when the window is in overview
		// mode. If it did, the thumbnail would go blank again after the
		// transition fires, undoing enterOverview's render-suppression fix.
		const a = await manager.open( openConfig( 'a' ) );
		a.minimize();

		manager.enterOverview();
		dispatchOpacityTransitionEnd( a.element );

		expect( a.element.style.getPropertyValue( 'content-visibility' ) ).toBe(
			'',
		);
		if ( a.iframe ) {
			expect( a.iframe.style.visibility ).toBe( '' );
		}
		expect(
			a.element.classList.contains( 'os-window--overview' ),
		).toBe( true );
	} );

	test( 'selecting a minimized fullscreen thumbnail restores fullscreen class before restore', async () => {
		// When a minimized fullscreen window is selected in overview, the
		// `--fullscreen` class must be reapplied on the DOM element *before*
		// the win.restore() call. If the class is not present when the state
		// flips to 'fullscreen', the exit-overview layout logic will treat it
		// as a regular window and skip the fullscreen resize path, leaving the
		// thumbnail-sized layout after selection.
		const a = await manager.open( openConfig( 'a' ) );
		a.toggleFullscreen();
		a.minimize();

		manager.enterOverview();
		expect( a.state ).toBe( 'minimized' );
		expect(
			a.element.classList.contains( 'os-window--fullscreen' ),
		).toBe( false );

		manager.exitOverview( a );

		expect( a.state ).toBe( 'fullscreen' );
		expect(
			a.element.classList.contains( 'os-window--fullscreen' ),
		).toBe( true );
		expect(
			document.body.classList.contains( 'os-has-fullscreen-window' ),
		).toBe( true );
		expect( a.element.dataset.osHadFullscreenBeforeOverview ).toBeUndefined();
	} );

	test( 'Enter key in overview exits without selecting a window', async () => {
		await manager.open( openConfig( 'a' ) );
		manager.enterOverview();
		expect( manager._overviewActive ).toBe( true );

		document.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Enter' } ),
		);

		expect( manager._overviewActive ).toBe( false );
	} );

	test( 'enterOverview includes minimized windows in the grid thumbnails', async () => {
		// When only some windows are minimized, the Overview grid now
		// includes all windows (minimized and visible alike) so the
		// tile count badge and the grid are consistent. Minimized
		// windows appear dimmed via CSS.
		const a = await manager.open( openConfig( 'a' ) );
		const b = await manager.open( openConfig( 'b' ) );
		const c = await manager.open( openConfig( 'c' ) );
		a.minimize();
		expect( a.state ).toBe( 'minimized' );

		manager.enterOverview();

		expect( a.state ).toBe( 'minimized' );
		expect( b.state ).toBe( 'normal' );
		expect( c.state ).toBe( 'normal' );

		// All three windows — minimized and visible — participate in
		// the grid.
		const gridTiles = manager._desktop.querySelectorAll< HTMLElement >(
			'.os-window--overview',
		);
		expect( gridTiles ).toHaveLength( 3 );

		// The count badge in the active desktop's tile matches the
		// number of grid tiles — the original badge/grid mismatch
		// regression is fixed.
		const badge = manager._overviewTopBar!.querySelector(
			'.os-overview-top-bar__tile-count',
		);
		expect( badge ).not.toBeNull();
		expect( Number( badge!.textContent ) ).toBe( gridTiles.length );
	} );

	test( 'snapshot preserves geometry for windows on non-active desktops', async () => {
		// Regression: when a window sits on a hidden (display: none)
		// desktop, `offsetLeft/Top/Width/Height` all return 0 because
		// the element isn't laid out. Snapshot must fall back to the
		// inline style strings so a hard reload restores the user's
		// saved position instead of "defaults at 0,0".
		const a = await manager.open( openConfig( 'a' ) );
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

	test( 'snapshot skips ephemeral windows — even when focused', async () => {
		await manager.open( openConfig( 'a' ) );
		const preview = await manager.open( {
			...openConfig( 'editor-preview-post-1' ),
			ephemeral: true,
		} );
		manager.focus( preview );

		const snap = manager.snapshot();

		expect(
			snap.windows.some( ( w ) => w.id === 'editor-preview-post-1' ),
		).toBe( false );
		expect( snap.windows.some( ( w ) => w.id === 'a' ) ).toBe( true );
		expect( snap.focused ).toBe( '' );
	} );

	// -----------------------------------------------------------------
	// Active-desktop scoping for isActive / isActiveByBaseId /
	// getAllByBaseIdOnActiveDesktop / minimizeAll / restoreFrom /
	// toggleShowDesktop.
	// -----------------------------------------------------------------

	test( 'getAllByBaseIdOnActiveDesktop filters getAllByBaseId to the active desktop', async () => {
		const a = await manager.open( {
			id: 'multi-app',
			baseId: 'multi-app',
			url: 'http://example.test/wp-admin/multi-app.php',
			title: 'multi-app',
			icon: 'dashicons-admin-generic',
		} );
		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		const b = await manager.open( {
			id: 'multi-app',
			baseId: 'multi-app',
			url: 'http://example.test/wp-admin/multi-app.php',
			title: 'multi-app',
			icon: 'dashicons-admin-generic',
		} );

		// Sanity: the unfiltered lookup spans every desktop.
		expect( manager.getAllByBaseId( 'multi-app' ) ).toHaveLength( 2 );

		// On desktop-2 (active): only `b` qualifies.
		expect( manager.getAllByBaseIdOnActiveDesktop( 'multi-app' ) ).toEqual( [ b ] );

		manager.switchDesktop( 'desktop-1' );

		// Back on desktop-1: only `a` qualifies.
		expect( manager.getAllByBaseIdOnActiveDesktop( 'multi-app' ) ).toEqual( [ a ] );
	} );

	test( 'isActive stops reporting true once its desktop is no longer active', async () => {
		// Regression: switching to a desktop with no windows leaves
		// `getFocused()` (last entry in the global z-order stack)
		// still pointing at whatever was focused on the desktop the
		// user just left — `switchDesktop` only re-focuses when the
		// new desktop has a window to focus. Without the desktop
		// check, `isActive('a')` would stay true even though `a` is
		// no longer visible.
		const a = await manager.open( openConfig( 'a' ) );
		expect( manager.isActive( 'a' ) ).toBe( true );

		const second = manager.createDesktop();
		manager.switchDesktop( second.id );

		expect( manager.isActive( 'a' ) ).toBe( false );

		manager.switchDesktop( 'desktop-1' );

		expect( manager.isActive( 'a' ) ).toBe( true );
	} );

	test( 'isActiveByBaseId matches any instance of baseId, scoped to the active desktop', async () => {
		const multiConfig = () => ( {
			id: 'multi-app',
			baseId: 'multi-app',
			url: 'http://example.test/wp-admin/multi-app.php',
			title: 'multi-app',
			icon: 'dashicons-admin-generic',
		} );
		const a = await manager.open( multiConfig() );
		expect( manager.isActiveByBaseId( 'multi-app' ) ).toBe( true );

		// Empty second desktop — `a` is still the last-focused window
		// globally, but it lives on desktop-1, not the new active one.
		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		expect( manager.isActiveByBaseId( 'multi-app' ) ).toBe( false );

		// A second instance opened here becomes focused on the active
		// desktop — baseId now reads active again, via a different id.
		const b = await manager.open( multiConfig() );
		expect( b.id ).not.toBe( a.id );
		expect( manager.isActiveByBaseId( 'multi-app' ) ).toBe( true );
	} );

	test( 'minimizeAll only minimizes windows on the active desktop', async () => {
		const a = await manager.open( openConfig( 'a' ) );
		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		const b = await manager.open( openConfig( 'b' ) );

		const minimized = manager.minimizeAll();

		expect( minimized ).toEqual( [ b ] );
		expect( b.state ).toBe( 'minimized' );
		expect( a.state ).toBe( 'normal' );
	} );

	test( 'restoreFrom skips windows whose desktop is no longer active', async () => {
		const a = await manager.open( openConfig( 'a' ) );
		a.minimize();
		expect( a.state ).toBe( 'minimized' );

		const second = manager.createDesktop();
		manager.switchDesktop( second.id );

		// `a` lives on desktop-1, which isn't active — restoreFrom
		// must leave it minimized even though it's in the list.
		manager.restoreFrom( [ a ] );
		expect( a.state ).toBe( 'minimized' );

		manager.switchDesktop( 'desktop-1' );
		manager.restoreFrom( [ a ] );
		expect( a.state ).toBe( 'normal' );
	} );

	test( 'toggleShowDesktop only affects windows on the active desktop', async () => {
		const a = await manager.open( openConfig( 'a' ) );
		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		const b = await manager.open( openConfig( 'b' ) );

		expect( manager.toggleShowDesktop() ).toBe( true );
		expect( b.state ).toBe( 'minimized' );
		expect( a.state ).toBe( 'normal' );

		expect( manager.toggleShowDesktop() ).toBe( false );
		expect( b.state ).toBe( 'normal' );
	} );

	describe( 'Overview inert + tile structure', () => {
		// Background chrome (admin sidebar, dock, widgets) and all windows
		// are made inert on overview enter so Tab focus doesn't waste
		// keystrokes navigating hidden UI behind the overview layer.
		// The top admin bar (wpadminbar) is deliberately left active.
		// Siblings inside wpbody-content (screen options, help, notices)
		// are also inerted via inertWpBodyContentChildren.
		test( 'enterOverview inerts background chrome, exitOverview restores it', async () => {
			const toRemove: HTMLElement[] = [];

			try {
				const adminMenu = document.createElement( 'div' );
				adminMenu.id = 'adminmenumain';
				document.body.appendChild( adminMenu );
				toRemove.push( adminMenu );
				const adminBack = document.createElement( 'div' );
				adminBack.id = 'adminmenuback';
				document.body.appendChild( adminBack );
				toRemove.push( adminBack );
				const dock = document.createElement( 'div' );
				dock.id = 'os-dock';
				document.body.appendChild( dock );
				toRemove.push( dock );
				const sideDock = document.createElement( 'div' );
				sideDock.id = 'os-side-dock';
				document.body.appendChild( sideDock );
				toRemove.push( sideDock );
				const widgets = document.createElement( 'div' );
				widgets.id = 'desktop-mode-widgets';
				document.body.appendChild( widgets );
				toRemove.push( widgets );

				const wpbody = document.createElement( 'div' );
				wpbody.id = 'wpbody-content';
				document.body.appendChild( wpbody );
				toRemove.push( wpbody );
				const notice = document.createElement( 'div' );
				notice.className = 'notice';
				wpbody.appendChild( notice );

				const a = await manager.open( openConfig( 'a' ) );
				const b = await manager.open( openConfig( 'b' ) );

				expect( a.element.inert ).toBeFalsy();

				manager.enterOverview();

				expect( adminMenu.inert ).toBe( true );
				expect( adminBack.inert ).toBe( true );
				expect( dock.inert ).toBe( true );
				expect( sideDock.inert ).toBe( true );
				expect( widgets.inert ).toBe( true );
				expect( notice.inert ).toBe( true );
				// Window root elements remain non-inert for thumbnail pointer clicks,
				// while inner window child elements are inerted to trap keyboard focus.
				expect( a.element.inert ).toBeFalsy();
				expect( b.element.inert ).toBeFalsy();
				expect( ( a.element.children[ 0 ] as HTMLElement ).inert ).toBe( true );
				expect( ( b.element.children[ 0 ] as HTMLElement ).inert ).toBe( true );

				manager.exitOverview();

				expect( adminMenu.inert ).toBe( false );
				expect( adminBack.inert ).toBe( false );
				expect( dock.inert ).toBe( false );
				expect( sideDock.inert ).toBe( false );
				expect( widgets.inert ).toBe( false );
				expect( notice.inert ).toBe( false );
				expect( a.element.inert ).toBeFalsy();
				expect( b.element.inert ).toBeFalsy();
				expect( ( a.element.children[ 0 ] as HTMLElement ).inert ).toBe( false );
				expect( ( b.element.children[ 0 ] as HTMLElement ).inert ).toBe( false );
			} finally {
				for ( const el of toRemove ) {
					el.remove();
				}
			}
		} );

		test( 'clicking a window thumbnail in overview selects and focuses it without forcing maximize', async () => {
			const a = await manager.open( openConfig( 'a' ) );
			const b = await manager.open( openConfig( 'b' ) );
			expect( manager.getFocused() ).toBe( b );
			expect( a.state ).toBe( 'normal' );
			expect( b.state ).toBe( 'normal' );

			manager.enterOverview();
			expect( manager._overviewActive ).toBe( true );

			vi.spyOn( a.element, 'getBoundingClientRect' ).mockReturnValue(
				new DOMRect( 100, 100, 200, 150 ),
			);

			a.element.dispatchEvent(
				new MouseEvent( 'pointerdown', {
					bubbles: true,
					cancelable: true,
					button: 0,
					clientX: 150,
					clientY: 150,
				} ),
			);
			a.element.dispatchEvent(
				new MouseEvent( 'pointerup', {
					bubbles: true,
					cancelable: true,
					button: 0,
					clientX: 150,
					clientY: 150,
				} ),
			);

			expect( manager._overviewActive ).toBe( false );
			expect( manager.getFocused() ).toBe( a );
			expect( a.state ).toBe( 'normal' );
		} );

		// Each desktop tile was a single <button>; the close X was a child
		// inside it, making it unreachable by Tab. Fix: wrap the tile <button>
		// and a sibling close <button> in a <div> wrapper so both are independently
		// focusable. The "+" create-tile stays as a direct child (no close X).
		test( 'each desktop tile has a wrapper with two sibling buttons', async () => {
			const extraDesktops = [ manager.createDesktop(), manager.createDesktop() ];
			try {
				await manager.open( openConfig( 'a' ) );
				manager.enterOverview();

				const wrappers = manager._overviewTopBar!.querySelectorAll(
					'.os-overview-top-bar__tile-wrapper',
				);

				// 3 desktops = 3 wrappers (the "+" tile is a direct child, not wrapped)
				expect( wrappers ).toHaveLength( 3 );

				for ( const wrapper of wrappers ) {
					const buttons = wrapper.querySelectorAll( 'button' );
					expect( buttons ).toHaveLength( 2 );

					const tile = buttons[ 0 ];
					expect(
						tile.classList.contains( 'os-overview-top-bar__tile' ),
					).toBe( true );

					const close = buttons[ 1 ];
					expect(
						close.classList.contains(
							'os-overview-top-bar__tile-close',
						),
					).toBe( true );
					expect( close.tagName ).toBe( 'BUTTON' );
				}
			} finally {
				for ( const d of extraDesktops ) {
					closeDesktop( manager, d.id );
				}
			}
		} );

		// The global Enter handler must not exit overview when the user
		// is focused on an explicit <button> (close X, desktop tile).
		// Regression guard for BUG-4: prior behaviour intercepted every
		// Enter as "commit", making the close X inaccessible by keyboard.
		test( 'Enter on a focused button does not exit overview', async () => {
			await manager.open( openConfig( 'a' ) );
			manager.enterOverview();

			const closeBtn = manager._overviewTopBar!.querySelector< HTMLElement >(
				'.os-overview-top-bar__tile-close',
			)!;
			closeBtn.focus();
			expect( document.activeElement ).toBe( closeBtn );

			document.dispatchEvent(
				new KeyboardEvent( 'keydown', { key: 'Enter' } ),
			);

			expect( manager._overviewActive ).toBe( true );
			manager.exitOverview();
		} );

		// inertWpBodyContentChildren returns early when #wpbody-content
		// is absent from the DOM. Verify enterOverview still completes
		// without throwing.
		test( 'enterOverview tolerates missing wpbody-content', async () => {
			await manager.open( openConfig( 'a' ) );
			expect( () => manager.enterOverview() ).not.toThrow();
			manager.exitOverview();
		} );
	} );
} );

describe( 'WindowManager — destroy()', async () => {
	let hooks: FakeWpHooks;
	let desktopArea: HTMLElement;
	let manager: WindowManager;

	beforeEach( async () => {
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

	afterEach( async () => {
		vi.useRealTimers();
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktopArea.remove();
		clearHooksStub();
	} );

	test( 'cancels the pending "entered" timer left by an un-exited enterOverview()', async () => {
		vi.useFakeTimers();
		manager.enterOverview();
		expect( manager._overviewEnterTimeoutId ).not.toBeNull();

		manager.destroy();
		expect( manager._overviewEnterTimeoutId ).toBeNull();

		// Removing `window.wp.hooks` proves the cancelled timer never
		// fires — a leaked one would throw reaching for it here, which
		// is exactly the flake this regression test guards against.
		clearHooksStub();
		vi.advanceTimersByTime( 1000 );
	} );

	test( 'cancels the pending "exited" timer left by an un-awaited exitOverview()', async () => {
		vi.useFakeTimers();
		manager.enterOverview();
		vi.advanceTimersByTime( 1000 );
		manager.exitOverview();
		expect( manager._overviewExitTimeoutId ).not.toBeNull();

		manager.destroy();
		expect( manager._overviewExitTimeoutId ).toBeNull();

		clearHooksStub();
		vi.advanceTimersByTime( 1000 );
	} );

	test( 'synchronously exits overview when destroyed mid-session', async () => {
		manager.enterOverview();
		expect( manager._overviewActive ).toBe( true );

		manager.destroy();

		expect( manager._overviewActive ).toBe( false );
		expect( hooks.didAction( 'os.overview.exiting' ) ).toBe( 1 );
	} );

	test( 'is a no-op when overview was never entered', async () => {
		expect( () => manager.destroy() ).not.toThrow();
		expect( manager._overviewActive ).toBe( false );
	} );
} );
