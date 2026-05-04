/**
 * Edge-snap + split-overview behavioral tests.
 *
 * Covers:
 *   - detectSnapZone: left/right threshold + null zone
 *   - snapZoneBounds: exactly half-area, rounded to ints
 *   - updateSnapZoneForDrag: fires zone-pending + zone-canceled
 *     transitions at the right edges
 *   - commitSnapIfPending: writes target geometry, flips state, fires
 *     zone-committed
 *   - enterSplitOverview: thumbnails + click backdrop → exit,
 *     click window → fill + exit
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import {
	detectSnapZone,
	oppositeHalfRect,
	snapZoneBounds,
	SNAP_EDGE_THRESHOLD,
	updateSnapZoneForDrag,
	commitSnapIfPending,
} from '../../src/window-manager/snap-zones';
import {
	enterSplitOverview,
	exitSplitOverview,
	fillOppositeHalfAndExit,
} from '../../src/window-manager/split-overview';
import { computeOverviewLayout } from '../../src/window-manager/geometry';
import {
	clearHooksStub,
	installHooksStub,
	recordActions,
	type FakeWpHooks,
} from './helpers/hooks-stub';

const SNAP_HOOKS = [
	'desktop-mode.snap.zone-pending',
	'desktop-mode.snap.zone-canceled',
	'desktop-mode.snap.zone-committed',
	'desktop-mode.snap.split-filled',
] as const;

function openConfig( id: string ) {
	return {
		id,
		url: `http://example.test/wp-admin/${ id }.php`,
		title: id,
		icon: 'dashicons-admin-generic',
	};
}

function mockDesktopRect(): DOMRect {
	return {
		left: 0,
		top: 0,
		right: 1600,
		bottom: 900,
		width: 1600,
		height: 900,
		x: 0,
		y: 0,
		toJSON: () => ( {} ),
	} as DOMRect;
}

describe( 'snap-zones — pure math', () => {
	test( 'detectSnapZone returns left near the left edge', () => {
		expect( detectSnapZone( 0, mockDesktopRect() ) ).toBe( 'left' );
		expect( detectSnapZone( SNAP_EDGE_THRESHOLD, mockDesktopRect() ) ).toBe( 'left' );
		expect( detectSnapZone( SNAP_EDGE_THRESHOLD + 1, mockDesktopRect() ) ).toBeNull();
	} );

	test( 'detectSnapZone returns right near the right edge', () => {
		expect( detectSnapZone( 1600, mockDesktopRect() ) ).toBe( 'right' );
		expect( detectSnapZone( 1600 - SNAP_EDGE_THRESHOLD, mockDesktopRect() ) ).toBe( 'right' );
		expect( detectSnapZone( 1600 - SNAP_EDGE_THRESHOLD - 1, mockDesktopRect() ) ).toBeNull();
	} );

	test( 'detectSnapZone returns null in the middle', () => {
		expect( detectSnapZone( 800, mockDesktopRect() ) ).toBeNull();
		expect( detectSnapZone( 500, mockDesktopRect() ) ).toBeNull();
	} );
} );

describe( 'snap-zones — manager lifecycle', () => {
	let hooks: FakeWpHooks;
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( () => {
		hooks = installHooksStub();
		desktop = document.createElement( 'div' );
		Object.defineProperty( desktop, 'getBoundingClientRect', {
			value: () => mockDesktopRect(),
		} );
		Object.defineProperty( desktop, 'clientWidth', { value: 1600, configurable: true } );
		Object.defineProperty( desktop, 'clientHeight', { value: 900, configurable: true } );
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
	} );

	afterEach( () => {
		for ( const win of manager.getAll() ) {
			win.close();
		}
		desktop.remove();
		clearHooksStub();
	} );

	test( 'snapZoneBounds gives exactly half the desktop area per zone', () => {
		const left = snapZoneBounds( manager, 'left' );
		const right = snapZoneBounds( manager, 'right' );
		expect( left ).toEqual( { x: 0, y: 0, width: 800, height: 900 } );
		expect( right ).toEqual( { x: 800, y: 0, width: 800, height: 900 } );
	} );

	test( 'updateSnapZoneForDrag fires pending when entering and canceled when leaving', () => {
		const win = manager.open( openConfig( 'a' ) );
		const log = recordActions( hooks, SNAP_HOOKS );

		// Enter the left zone.
		updateSnapZoneForDrag( manager, win, 10 );
		expect( log.some( ( e ) => e.name === 'desktop-mode.snap.zone-pending' ) ).toBe( true );

		// Move to the middle — cancels.
		updateSnapZoneForDrag( manager, win, 800 );
		expect( log.some( ( e ) => e.name === 'desktop-mode.snap.zone-canceled' ) ).toBe( true );

		// Re-enter — pending fires again. Count rather than truthy so
		// the hysteresis is obvious if we ever add it.
		const pendingBefore = log.filter( ( e ) => e.name === 'desktop-mode.snap.zone-pending' ).length;
		updateSnapZoneForDrag( manager, win, 10 );
		const pendingAfter = log.filter( ( e ) => e.name === 'desktop-mode.snap.zone-pending' ).length;
		expect( pendingAfter ).toBe( pendingBefore + 1 );
	} );

	test( 'updateSnapZoneForDrag is idempotent within the same zone', () => {
		const win = manager.open( openConfig( 'a' ) );
		const log = recordActions( hooks, SNAP_HOOKS );
		updateSnapZoneForDrag( manager, win, 5 );
		updateSnapZoneForDrag( manager, win, 10 );
		updateSnapZoneForDrag( manager, win, 15 );
		const pending = log.filter( ( e ) => e.name === 'desktop-mode.snap.zone-pending' );
		expect( pending.length ).toBe( 1 );
	} );

	test( 'commitSnapIfPending writes target bounds + flips state + fires committed', () => {
		const win = manager.open( openConfig( 'a' ) );
		// Arm the left zone.
		updateSnapZoneForDrag( manager, win, 5 );
		const log = recordActions( hooks, SNAP_HOOKS );

		const consumed = commitSnapIfPending( manager, win );
		expect( consumed ).toBe( true );

		expect( win.state ).toBe( 'snapped-left' );
		expect( win.element.style.left ).toBe( '0px' );
		expect( win.element.style.width ).toBe( '800px' );
		expect( win.element.classList.contains( 'desktop-mode-window--snapped-left' ) ).toBe( true );

		const committed = log.find( ( e ) => e.name === 'desktop-mode.snap.zone-committed' );
		expect( committed ).toBeDefined();
		expect(
			( committed!.args[ 0 ] as { zone: string } ).zone,
		).toBe( 'left' );
	} );

	test( 'commitSnapIfPending returns false when no zone is armed', () => {
		const win = manager.open( openConfig( 'a' ) );
		expect( commitSnapIfPending( manager, win ) ).toBe( false );
	} );

	test( 'second drag while split-overview is active does NOT re-arm snap', () => {
		// Simulate the picker being up.
		const win = manager.open( openConfig( 'a' ) );
		manager._splitOverviewActive = true;
		const log = recordActions( hooks, SNAP_HOOKS );

		updateSnapZoneForDrag( manager, win, 5 );
		expect(
			log.some( ( e ) => e.name === 'desktop-mode.snap.zone-pending' ),
		).toBe( false );
	} );

	test( 'commit picks up zone from the most-recent updateSnapZoneForDrag', () => {
		const win = manager.open( openConfig( 'a' ) );
		updateSnapZoneForDrag( manager, win, 5 ); // left
		updateSnapZoneForDrag( manager, win, 1595 ); // right
		commitSnapIfPending( manager, win );
		expect( win.state ).toBe( 'snapped-right' );
		expect( win.element.style.left ).toBe( '800px' );
	} );

	test( 'picked partner is re-clickable after the fill (no lingering --overview class)', () => {
		// Regression: after picking a thumbnail in the split
		// overview, the fill path left the `--overview` CSS class on
		// the picked window. That class pointer-events:none-s all
		// children AND makes the window's own pointerdown handler
		// early-return before firing onFocusRequest — so subsequent
		// clicks silently failed.
		const anchor = manager.open( openConfig( 'anchor' ) );
		const partner = manager.open( openConfig( 'partner' ) );
		// Stub offsetWidth/Height so computeOverviewLayout produces
		// finite numbers (jsdom has no layout engine).
		for ( const w of [ anchor, partner ] ) {
			Object.defineProperty( w.element, 'offsetWidth', { value: 800, configurable: true } );
			Object.defineProperty( w.element, 'offsetHeight', { value: 600, configurable: true } );
		}

		// Mark the anchor as snapped-left (mirroring the real flow
		// where `commitSnapIfPending` fires first).
		anchor.state = 'snapped-left';

		enterSplitOverview( manager, anchor, 'left' );
		// Overview class is on the partner (the eligible thumbnail).
		expect( partner.element.classList.contains( 'desktop-mode-window--overview' ) ).toBe( true );

		// Drive the commit path directly — jsdom can't dispatch
		// `PointerEvent`s so the integration test goes through the
		// internal function rather than synthesizing events.
		fillOppositeHalfAndExit( manager, partner );

		// Partner is now snapped right + has shed the overview
		// class. That's the bug-regression assertion.
		expect( partner.state ).toBe( 'snapped-right' );
		expect( partner.element.classList.contains( 'desktop-mode-window--overview' ) ).toBe( false );
		expect( partner.element.classList.contains( 'desktop-mode-window--snapped-right' ) ).toBe( true );

		// A subsequent focus click on the partner must reach the
		// focus handler — i.e. the pointerdown listener inside
		// `Window.bindEvents` must NOT early-return because the
		// overview class is gone. Dispatch a plain Event (jsdom-
		// safe) at the window element; the focus-request branch
		// fires for every non-overview pointerdown regardless of
		// event subtype.
		let focusFired = 0;
		partner.onFocusRequest = () => {
			focusFired++;
		};
		partner.element.dispatchEvent(
			new Event( 'pointerdown', { bubbles: true } ),
		);
		expect( focusFired ).toBeGreaterThan( 0 );
	} );

	test( 'session-restored snapped window gets the snap class from frame 1', async () => {
		// Regression: reloading the page with two partner-snapped
		// windows showed a visible gap at the inner join because
		// `--snapped-*` was never re-applied on restore. Border
		// radius stayed rounded on all 4 corners and the inner edge
		// read as a seam.
		const win = manager.open( {
			id: 'a',
			url: 'http://example.test/wp-admin/edit.php',
			title: 'Editor',
			icon: 'dashicons-admin-post',
			// Session fields — simulates what desktop.ts passes when
			// rehydrating a saved snapshot with state='snapped-left'.
			initialState: 'snapped-left',
		} );

		// Class applied synchronously before the first paint — no
		// wait for the rAF to tick.
		expect(
			win.element.classList.contains( 'desktop-mode-window--snapped-left' ),
		).toBe( true );

		// applyInitialState runs in the next rAF; wait for it.
		await new Promise( ( r ) => requestAnimationFrame( () => r( undefined ) ) );

		// Geometry re-snapped to the current viewport's halfW — the
		// window fills exactly the left half, flush with the area.
		expect( win.state ).toBe( 'snapped-left' );
		expect( win.element.style.left ).toBe( '0px' );
		expect( win.element.style.top ).toBe( '0px' );
		expect( win.element.style.width ).toBe( '800px' );
		expect( win.element.style.height ).toBe( '900px' );
	} );

	test( 'snapped-right restore lands on the right half with the right class', async () => {
		const win = manager.open( {
			id: 'b',
			url: 'http://example.test/wp-admin/upload.php',
			title: 'Media',
			icon: 'dashicons-admin-media',
			initialState: 'snapped-right',
		} );
		expect(
			win.element.classList.contains( 'desktop-mode-window--snapped-right' ),
		).toBe( true );
		await new Promise( ( r ) => requestAnimationFrame( () => r( undefined ) ) );
		expect( win.state ).toBe( 'snapped-right' );
		expect( win.element.style.left ).toBe( '800px' );
		expect( win.element.style.width ).toBe( '800px' );
	} );

	test( 'oppositeHalfRect returns area-relative coords so thumbnails land in the right half', () => {
		// Regression: before, oppositeHalfRect returned viewport-relative
		// coords. computeOverviewLayout ignored rect.left, so thumbnails
		// landed at x≈40 (left half) no matter what zone was requested.
		// The rect and the layout now agree on area-relative space.
		const rightHalf = oppositeHalfRect( manager, 'left' );
		expect( rightHalf.left ).toBe( 800 );
		expect( rightHalf.width ).toBe( 800 );

		const leftHalf = oppositeHalfRect( manager, 'right' );
		expect( leftHalf.left ).toBe( 0 );
		expect( leftHalf.width ).toBe( 800 );

		// Feed the right-half rect through the layout — every
		// thumbnail's x must fall in [halfW, width]. jsdom doesn't
		// compute layout, so seed the windows with non-zero offsets
		// first (otherwise the scale divisions would yield NaN).
		const w1 = manager.open( openConfig( 'a' ) );
		const w2 = manager.open( openConfig( 'b' ) );
		for ( const w of [ w1, w2 ] ) {
			Object.defineProperty( w.element, 'offsetWidth', { value: 800, configurable: true } );
			Object.defineProperty( w.element, 'offsetHeight', { value: 600, configurable: true } );
		}
		const layout = computeOverviewLayout( [ w1, w2 ], rightHalf, 0 );
		for ( const item of layout ) {
			expect( item.x ).toBeGreaterThanOrEqual( 800 );
			expect( item.x ).toBeLessThanOrEqual( 1600 );
		}
	} );
} );
