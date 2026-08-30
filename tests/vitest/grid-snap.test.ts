/**
 * Grid snap — geometry as a table, then the session end to end.
 *
 * The rules worth holding:
 *
 * - a cell is a FRACTION of the work area, so the same six columns
 *   come out of a 5K display and a laptop, and boundaries are rounded
 *   per edge so adjacent cells share one and the last reaches the end;
 * - the span is a bounding box, so dragging backwards makes the same
 *   window as dragging forwards;
 * - a shake moves the anchor to where the hand is;
 * - while a grid snap is armed the edge zones stay quiet, and the
 *   release lands on the span and fires the generic move/resize hooks
 *   too, so a listener that knows nothing about grids still hears it.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import {
	beginGridSnap,
	cancelGridSnap,
	cellAt,
	cellRect,
	commitGridSnapIfActive,
	GRID_SNAP_COLUMNS,
	GRID_SNAP_ROWS,
	GridSnapAnchorReason,
	gridSnapDimensions,
	reflowGridSpans,
	resetGridSnapAnchor,
	spanRect,
	updateGridSnap,
} from '../../src/window-manager/grid-snap';
import { updateSnapZoneForDrag } from '../../src/window-manager/snap-zones';
import {
	clearHooksStub,
	installHooksStub,
	recordActions,
	type FakeWpHooks,
} from './helpers/hooks-stub';

const HOOKS_UNDER_TEST = [
	'os.grid-snap.armed',
	'os.grid-snap.changed',
	'os.grid-snap.anchor-reset',
	'os.grid-snap.canceled',
	'os.grid-snap.committed',
	'os.window.moved',
	'os.window.resized',
	'os.window.drag-end',
	'os.snap.zone-pending',
] as const;

const AREA = { x: 0, y: 0, width: 1600, height: 900 };
const SIX = { cols: 6, rows: 6 };

describe( 'grid snap — geometry', () => {
	test( 'cellAt is a fraction of the area, clamped at the edges', () => {
		expect( cellAt( 0, 0, AREA, SIX ) ).toEqual( { col: 0, row: 0 } );
		expect( cellAt( 1599, 899, AREA, SIX ) ).toEqual( { col: 5, row: 5 } );
		// Exactly one third across and one half down.
		expect( cellAt( 534, 450, AREA, SIX ) ).toEqual( { col: 2, row: 3 } );
		// Past the desk still means the nearest edge cell.
		expect( cellAt( -50, 5000, AREA, SIX ) ).toEqual( { col: 0, row: 5 } );
	} );

	test( 'the same proportions come out of any display', () => {
		const laptop = { x: 0, y: 0, width: 1280, height: 720 };
		const fiveK = { x: 0, y: 0, width: 5120, height: 2880 };
		// The point 40% across, 60% down is the same cell on both.
		expect( cellAt( 512, 432, laptop, SIX ) ).toEqual(
			cellAt( 2048, 1728, fiveK, SIX ),
		);
	} );

	test( 'cells tile the area exactly — shared edges, last one reaches the end', () => {
		// 1600 / 6 is not an integer; rounding each boundary is what
		// keeps the sixth column from stopping short.
		const area = { x: 10, y: 20, width: 1600, height: 900 };
		let right = area.x;
		for ( let c = 0; c < 6; c++ ) {
			const r = cellRect( { col: c, row: 0 }, area, SIX );
			expect( r.x ).toBe( right );
			right = r.x + r.width;
		}
		expect( right ).toBe( area.x + area.width );
		const last = cellRect( { col: 5, row: 5 }, area, SIX );
		expect( last.y + last.height ).toBe( area.y + area.height );
	} );

	test( 'the span is a bounding box, so backwards is the same as forwards', () => {
		const forward = spanRect( { col: 1, row: 1 }, { col: 2, row: 2 }, AREA, SIX );
		const backward = spanRect( { col: 2, row: 2 }, { col: 1, row: 1 }, AREA, SIX );
		expect( backward ).toEqual( forward );
		// A 2×2 at (1,1): starts one cell in, spans two.
		expect( forward ).toEqual( {
			x: Math.round( 1600 / 6 ),
			y: 150,
			width: Math.round( 1600 * 3 / 6 ) - Math.round( 1600 / 6 ),
			height: 300,
		} );
	} );
} );

describe( 'grid snap — session', () => {
	let hooks: FakeWpHooks;
	let desktop: HTMLElement;
	let manager: WindowManager;

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
		Object.defineProperty( desktop, 'clientWidth', { value: 1600, configurable: true } );
		Object.defineProperty( desktop, 'clientHeight', { value: 900, configurable: true } );
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
	} );

	afterEach( () => {
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktop.remove();
		clearHooksStub();
	} );

	const open = () =>
		manager.open( {
			id: 'a',
			url: 'http://example.test/wp-admin/a.php',
			title: 'a',
			icon: 'dashicons-admin-generic',
		} );

	test( 'the shipped grid is 6×6, and the filter can change it', () => {
		expect( gridSnapDimensions( AREA ) ).toEqual( {
			cols: GRID_SNAP_COLUMNS,
			rows: GRID_SNAP_ROWS,
		} );
		hooks.addFilter( 'os.grid-snap.dimensions', 'test/four', () => ( {
			cols: 4,
			rows: 3,
		} ) );
		expect( gridSnapDimensions( AREA ) ).toEqual( { cols: 4, rows: 3 } );
		// Nonsense falls back rather than being clamped.
		hooks.removeFilter( 'os.grid-snap.dimensions', 'test/four' );
		hooks.addFilter( 'os.grid-snap.dimensions', 'test/absurd', () => ( {
			cols: 0,
			rows: 999,
		} ) );
		expect( gridSnapDimensions( AREA ) ).toEqual( { cols: 6, rows: 6 } );
	} );

	test( 'arm, move, and the span follows the pointer from the anchor', async () => {
		const win = await open();
		const log = recordActions( hooks, HOOKS_UNDER_TEST );

		// Key goes down with the pointer in (1,1).
		beginGridSnap( manager, win, 400, 200 );
		expect( manager._gridSnap?.anchor ).toEqual( { col: 1, row: 1 } );
		expect( desktop.querySelector( '.os-grid-snap' ) ).not.toBeNull();
		expect( log.find( ( e ) => e.name === 'os.grid-snap.armed' )?.args[ 0 ] ).toMatchObject( {
			windowId: 'a',
			anchor: { col: 1, row: 1 },
			dims: { cols: 6, rows: 6 },
		} );

		// Pointer to (2,2): a 2×2 span.
		updateGridSnap( manager, 700, 400 );
		expect( manager._gridSnap?.cursor ).toEqual( { col: 2, row: 2 } );
		expect( manager._gridSnap?.rect ).toEqual(
			spanRect( { col: 1, row: 1 }, { col: 2, row: 2 }, AREA, SIX ),
		);
		const target = desktop.querySelector< HTMLElement >( '.os-grid-snap__target' )!;
		expect( target.dataset.cols ).toBe( '2' );
		expect( target.dataset.rows ).toBe( '2' );

		// Moving inside the same cell changes nothing and fires nothing.
		const before = log.filter( ( e ) => e.name === 'os.grid-snap.changed' ).length;
		updateGridSnap( manager, 720, 410 );
		expect( log.filter( ( e ) => e.name === 'os.grid-snap.changed' ) ).toHaveLength( before );
	} );

	test( 'the held window is translucent while the grid is up, and solid again after', async () => {
		const win = await open();
		beginGridSnap( manager, win, 400, 200 );
		expect( win.element.classList.contains( 'os-window--grid-snapping' ) ).toBe( true );
		cancelGridSnap( manager );
		expect( win.element.classList.contains( 'os-window--grid-snapping' ) ).toBe( false );

		beginGridSnap( manager, win, 400, 200 );
		win.onDragEnd?.( win );
		expect( win.element.classList.contains( 'os-window--grid-snapping' ) ).toBe( false );
	} );

	test( 'arming twice is one arm', async () => {
		const win = await open();
		beginGridSnap( manager, win, 400, 200 );
		const first = manager._gridSnap;
		beginGridSnap( manager, win, 1500, 800 );
		expect( manager._gridSnap ).toBe( first );
		expect( desktop.querySelectorAll( '.os-grid-snap' ) ).toHaveLength( 1 );
	} );

	test( 'a shake moves the anchor to where the hand is', async () => {
		const win = await open();
		beginGridSnap( manager, win, 400, 200 );
		updateGridSnap( manager, 1200, 700 );
		expect( manager._gridSnap?.cursor ).toEqual( { col: 4, row: 4 } );
		const log = recordActions( hooks, HOOKS_UNDER_TEST );

		resetGridSnapAnchor( manager, 1200, 700, GridSnapAnchorReason.Shake );

		expect( manager._gridSnap?.anchor ).toEqual( { col: 4, row: 4 } );
		expect( manager._gridSnap?.cursor ).toEqual( { col: 4, row: 4 } );
		expect( log.find( ( e ) => e.name === 'os.grid-snap.anchor-reset' )?.args[ 0 ] ).toMatchObject( {
			anchor: { col: 4, row: 4 },
			reason: 'shake',
		} );
		// Then dragging back to (2,2) is a 3×3 the other way.
		updateGridSnap( manager, 700, 400 );
		expect( manager._gridSnap?.rect ).toEqual(
			spanRect( { col: 2, row: 2 }, { col: 4, row: 4 }, AREA, SIX ),
		);
	} );

	test( 'the edge zones stay quiet while a grid snap is armed', async () => {
		const win = await open();
		const log = recordActions( hooks, HOOKS_UNDER_TEST );
		beginGridSnap( manager, win, 400, 200 );
		// The manager's onDragMove routes to the grid while armed; a
		// pointer at the far left edge must not arm an edge snap.
		win.onDragMove?.( win, 5, 300 );
		expect( log.some( ( e ) => e.name === 'os.snap.zone-pending' ) ).toBe( false );
		expect( manager._snapPendingZone ).toBeNull();
	} );

	test( 'arming clears a pending edge snap', async () => {
		const win = await open();
		updateSnapZoneForDrag( manager, win, 5 );
		expect( manager._snapPendingZone ).toBe( 'left' );
		beginGridSnap( manager, win, 400, 200 );
		expect( manager._snapPendingZone ).toBeNull();
	} );

	test( 'release lands the window on the span and fires the generic hooks too', async () => {
		const win = await open();
		beginGridSnap( manager, win, 400, 200 );
		updateGridSnap( manager, 700, 400 );
		const expected = manager._gridSnap!.rect;
		const log = recordActions( hooks, HOOKS_UNDER_TEST );

		// The manager's onDragEnd is what the pointer layer calls.
		expect( win.onDragEnd?.( win ) ).toBe( true );

		expect( manager._gridSnap ).toBeNull();
		expect( win.element.style.left ).toBe( `${ expected.x }px` );
		expect( win.element.style.top ).toBe( `${ expected.y }px` );
		expect( win.element.style.width ).toBe( `${ expected.width }px` );
		expect( win.element.style.height ).toBe( `${ expected.height }px` );

		const names = log.map( ( e ) => e.name );
		expect( names ).toContain( 'os.grid-snap.committed' );
		expect( names ).toContain( 'os.window.moved' );
		expect( names ).toContain( 'os.window.resized' );
		expect( names ).toContain( 'os.window.drag-end' );
		expect( log.find( ( e ) => e.name === 'os.grid-snap.committed' )?.args[ 0 ] ).toMatchObject( {
			windowId: 'a',
			anchor: { col: 1, row: 1 },
			cursor: { col: 2, row: 2 },
			...expected,
		} );
	} );

	test( 'releasing the key mid-drag cancels without landing', async () => {
		const win = await open();
		win.element.style.left = '33px';
		beginGridSnap( manager, win, 400, 200 );
		const log = recordActions( hooks, HOOKS_UNDER_TEST );

		cancelGridSnap( manager );

		expect( manager._gridSnap ).toBeNull();
		expect( win.element.style.left ).toBe( '33px' );
		expect( log.map( ( e ) => e.name ) ).toEqual( [ 'os.grid-snap.canceled' ] );
		// And a release now is an ordinary drop.
		expect( commitGridSnapIfActive( manager, win ) ).toBe( false );
	} );

	test( 'a landed window remembers its cells and follows the desk when it resizes', async () => {
		const win = await open();
		beginGridSnap( manager, win, 400, 200 );
		updateGridSnap( manager, 700, 400 );
		win.onDragEnd?.( win );
		expect( win._gridSpan ).toEqual( {
			anchor: { col: 1, row: 1 },
			cursor: { col: 2, row: 2 },
			cols: 6,
			rows: 6,
		} );
		const log = recordActions( hooks, [ 'os.grid-snap.reflowed' ] );

		// The browser shrinks: the desk is now 1200×600.
		Object.defineProperty( desktop, 'clientWidth', { value: 1200, configurable: true } );
		Object.defineProperty( desktop, 'clientHeight', { value: 600, configurable: true } );
		const moved = reflowGridSpans( manager );

		expect( moved ).toEqual( [ 'a' ] );
		// Still the 2×2 at (1,1) — of the NEW desk.
		const expected = spanRect(
			{ col: 1, row: 1 },
			{ col: 2, row: 2 },
			{ x: 0, y: 0, width: 1200, height: 600 },
			SIX,
		);
		expect( win.element.style.left ).toBe( `${ expected.x }px` );
		expect( win.element.style.width ).toBe( `${ expected.width }px` );
		expect( win.element.style.height ).toBe( `${ expected.height }px` );
		expect( log.find( ( e ) => e.name === 'os.grid-snap.reflowed' )?.args[ 0 ] ).toEqual( {
			windowIds: [ 'a' ],
		} );

		// Nothing changed: no second pass reports it.
		expect( reflowGridSpans( manager ) ).toEqual( [] );
	} );

	test( 'a free move, a resize, or a state change takes the window off the grid', async () => {
		const land = async () => {
			const win = await open();
			beginGridSnap( manager, win, 400, 200 );
			win.onDragEnd?.( win );
			expect( win._gridSpan ).not.toBeNull();
			return win;
		};
		// A free drop — what the pointer layer does on an unconsumed
		// drag end.
		let win = await land();
		win._gridSpan = null;
		win._emitChange( 'moved' );
		expect( reflowGridSpans( manager ) ).toEqual( [] );
		win.destroy();

		// A state change: maximize.
		win = await land();
		win.toggleMaximize();
		expect( win._gridSpan ).toBeNull();
		win.destroy();
	} );

	test( 'a restored window is born on its cells, not on its saved pixels', async () => {
		const win = await manager.open( {
			id: 'r',
			url: 'http://example.test/wp-admin/r.php',
			title: 'r',
			icon: 'dashicons-admin-generic',
			// Pixels from some other display…
			x: 5,
			y: 5,
			width: 50,
			height: 50,
			// …and the cells that outrank them.
			gridSpan: {
				anchor: { col: 3, row: 0 },
				cursor: { col: 5, row: 2 },
				cols: 6,
				rows: 6,
			},
		} );
		const expected = spanRect( { col: 3, row: 0 }, { col: 5, row: 2 }, AREA, SIX );
		expect( win.element.style.left ).toBe( `${ expected.x }px` );
		expect( win.element.style.width ).toBe( `${ expected.width }px` );
		expect( win._gridSpan ).toEqual( {
			anchor: { col: 3, row: 0 },
			cursor: { col: 5, row: 2 },
			cols: 6,
			rows: 6,
		} );
		// And the session carries it forward.
		const entry = manager.snapshot().windows.find( ( w ) => w.id === 'r' );
		expect( entry?.gridSpan ).toEqual( win._gridSpan );
	} );

	test( 'the gesture callback drives arm, shake and cancel', async () => {
		const win = await open();
		win.onDragGesture?.( win, { type: 'modifier', active: true, clientX: 400, clientY: 200 } );
		expect( manager._gridSnap?.anchor ).toEqual( { col: 1, row: 1 } );
		win.onDragGesture?.( win, { type: 'shake', clientX: 1200, clientY: 700 } );
		expect( manager._gridSnap?.anchor ).toEqual( { col: 4, row: 4 } );
		win.onDragGesture?.( win, { type: 'modifier', active: false, clientX: 1200, clientY: 700 } );
		expect( manager._gridSnap ).toBeNull();
	} );
} );
