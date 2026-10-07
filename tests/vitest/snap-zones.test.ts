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
	'os.snap.zone-pending',
	'os.snap.zone-canceled',
	'os.snap.zone-committed',
	'os.snap.split-filled',
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

describe( 'snap-zones — pure math', async () => {
	test( 'detectSnapZone returns left near the left edge', async () => {
		expect( detectSnapZone( 0, mockDesktopRect() ) ).toBe( 'left' );
		expect( detectSnapZone( SNAP_EDGE_THRESHOLD, mockDesktopRect() ) ).toBe( 'left' );
		expect( detectSnapZone( SNAP_EDGE_THRESHOLD + 1, mockDesktopRect() ) ).toBeNull();
	} );

	test( 'detectSnapZone returns right near the right edge', async () => {
		expect( detectSnapZone( 1600, mockDesktopRect() ) ).toBe( 'right' );
		expect( detectSnapZone( 1600 - SNAP_EDGE_THRESHOLD, mockDesktopRect() ) ).toBe( 'right' );
		expect( detectSnapZone( 1600 - SNAP_EDGE_THRESHOLD - 1, mockDesktopRect() ) ).toBeNull();
	} );

	test( 'detectSnapZone returns null in the middle', async () => {
		expect( detectSnapZone( 800, mockDesktopRect() ) ).toBeNull();
		expect( detectSnapZone( 500, mockDesktopRect() ) ).toBeNull();
	} );
} );

describe( 'snap-zones — manager lifecycle', async () => {
	let hooks: FakeWpHooks;
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( async () => {
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

	afterEach( async () => {
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktop.remove();
		clearHooksStub();
	} );

	test( 'snapZoneBounds gives exactly half the desktop area per zone', async () => {
		const left = snapZoneBounds( manager, 'left' );
		const right = snapZoneBounds( manager, 'right' );
		expect( left ).toEqual( { x: 0, y: 0, width: 800, height: 900 } );
		expect( right ).toEqual( { x: 800, y: 0, width: 800, height: 900 } );
	} );

	test( 'updateSnapZoneForDrag fires pending when entering and canceled when leaving', async () => {
		const win = await manager.open( openConfig( 'a' ) );
		const log = recordActions( hooks, SNAP_HOOKS );

		updateSnapZoneForDrag( manager, win, 10 );
		expect( log.some( ( e ) => e.name === 'os.snap.zone-pending' ) ).toBe( true );

		updateSnapZoneForDrag( manager, win, 800 );
		expect( log.some( ( e ) => e.name === 'os.snap.zone-canceled' ) ).toBe( true );

		const pendingBefore = log.filter( ( e ) => e.name === 'os.snap.zone-pending' ).length;
		updateSnapZoneForDrag( manager, win, 10 );
		const pendingAfter = log.filter( ( e ) => e.name === 'os.snap.zone-pending' ).length;
		expect( pendingAfter ).toBe( pendingBefore + 1 );
	} );

	test( 'updateSnapZoneForDrag is idempotent within the same zone', async () => {
		const win = await manager.open( openConfig( 'a' ) );
		const log = recordActions( hooks, SNAP_HOOKS );
		updateSnapZoneForDrag( manager, win, 5 );
		updateSnapZoneForDrag( manager, win, 10 );
		updateSnapZoneForDrag( manager, win, 15 );
		const pending = log.filter( ( e ) => e.name === 'os.snap.zone-pending' );
		expect( pending.length ).toBe( 1 );
	} );

	test( 'commitSnapIfPending writes target bounds + flips state + fires committed', async () => {
		const win = await manager.open( openConfig( 'a' ) );

		updateSnapZoneForDrag( manager, win, 5 );
		const log = recordActions( hooks, SNAP_HOOKS );

		const consumed = commitSnapIfPending( manager, win );
		expect( consumed ).toBe( true );

		expect( win.state ).toBe( 'snapped-left' );
		expect( win.element.style.left ).toBe( '0px' );
		expect( win.element.style.width ).toBe( '800px' );
		expect( win.element.classList.contains( 'os-window--snapped-left' ) ).toBe( true );

		const committed = log.find( ( e ) => e.name === 'os.snap.zone-committed' );
		expect( committed ).toBeDefined();
		expect(
			( committed!.args[ 0 ] as { zone: string } ).zone,
		).toBe( 'left' );
	} );

	test( 'snapTo remembers the floating rect, and a snap from a snapped state does not overwrite it', async () => {

		const win = await manager.open( openConfig( 'a' ) );
		const floating = { offsetLeft: 300, offsetTop: 200, offsetWidth: 700, offsetHeight: 500 };
		for ( const [ prop, value ] of Object.entries( floating ) ) {
			Object.defineProperty( win.element, prop, { value, configurable: true } );
		}
		win._savedGeometry = null;

		win.snapTo( 'left' );
		expect( win.state ).toBe( 'snapped-left' );
		expect( win._savedGeometry ).toEqual( { x: 300, y: 200, width: 700, height: 500 } );

		Object.defineProperty( win.element, 'offsetWidth', { value: 800, configurable: true } );
		win.snapTo( 'right' );
		expect( win.state ).toBe( 'snapped-right' );
		expect( win._savedGeometry ).toEqual( { x: 300, y: 200, width: 700, height: 500 } );
	} );

	test( 'a half widens to a minimum width, and the other side takes the remainder', async () => {

		const wide = await manager.open( { ...openConfig( 'wide' ), minWidth: 1000 } );
		const narrow = await manager.open( openConfig( 'narrow' ) );
		const geometry = ( w: typeof wide ) => [ w.element.style.left, w.element.style.width ];

		narrow.snapTo( 'right' );
		expect( geometry( narrow ) ).toEqual( [ '800px', '800px' ] );

		expect( snapZoneBounds( manager, 'left', wide ) ).toEqual( { x: 0, y: 0, width: 1000, height: 900 } );
		wide.snapTo( 'left' );
		expect( geometry( wide ) ).toEqual( [ '0px', '1000px' ] );

		expect( geometry( narrow ) ).toEqual( [ '1000px', '600px' ] );

		wide.unsnap();
		expect( geometry( narrow ) ).toEqual( [ '800px', '800px' ] );
	} );

	test( 'two halves whose minimums cannot both fit each keep theirs and overlap', async () => {
		const a = await manager.open( { ...openConfig( 'a' ), minWidth: 1000 } );
		const b = await manager.open( { ...openConfig( 'b' ), minWidth: 1000 } );
		a.snapTo( 'left' );
		b.snapTo( 'right' );

		expect( [ a.element.style.left, a.element.style.width ] ).toEqual( [ '0px', '1000px' ] );
		expect( [ b.element.style.left, b.element.style.width ] ).toEqual( [ '600px', '1000px' ] );
	} );

	test( 'commitSnapIfPending returns false when no zone is armed', async () => {
		const win = await manager.open( openConfig( 'a' ) );
		expect( commitSnapIfPending( manager, win ) ).toBe( false );
	} );

	test( 'second drag while split-overview is active does NOT re-arm snap', async () => {

		const win = await manager.open( openConfig( 'a' ) );
		manager._splitOverviewActive = true;
		const log = recordActions( hooks, SNAP_HOOKS );

		updateSnapZoneForDrag( manager, win, 5 );
		expect(
			log.some( ( e ) => e.name === 'os.snap.zone-pending' ),
		).toBe( false );
	} );

	test( 'commit picks up zone from the most-recent updateSnapZoneForDrag', async () => {
		const win = await manager.open( openConfig( 'a' ) );
		updateSnapZoneForDrag( manager, win, 5 );
		updateSnapZoneForDrag( manager, win, 1595 );
		commitSnapIfPending( manager, win );
		expect( win.state ).toBe( 'snapped-right' );
		expect( win.element.style.left ).toBe( '800px' );
	} );

	test( 'picked partner is re-clickable after the fill (no lingering --overview class)', async () => {

		const anchor = await manager.open( openConfig( 'anchor' ) );
		const partner = await manager.open( openConfig( 'partner' ) );

		for ( const w of [ anchor, partner ] ) {
			Object.defineProperty( w.element, 'offsetWidth', { value: 800, configurable: true } );
			Object.defineProperty( w.element, 'offsetHeight', { value: 600, configurable: true } );
		}

		anchor.state = 'snapped-left';

		enterSplitOverview( manager, anchor, 'left' );

		expect( partner.element.classList.contains( 'os-window--overview' ) ).toBe( true );

		fillOppositeHalfAndExit( manager, partner );

		expect( partner.state ).toBe( 'snapped-right' );
		expect( partner.element.classList.contains( 'os-window--overview' ) ).toBe( false );
		expect( partner.element.classList.contains( 'os-window--snapped-right' ) ).toBe( true );

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

		const win = await manager.open( {
			id: 'a',
			url: 'http://example.test/wp-admin/edit.php',
			title: 'Editor',
			icon: 'dashicons-admin-post',

			initialState: 'snapped-left',
		} );

		expect(
			win.element.classList.contains( 'os-window--snapped-left' ),
		).toBe( true );

		await new Promise( ( r ) => requestAnimationFrame( () => r( undefined ) ) );

		expect( win.state ).toBe( 'snapped-left' );
		expect( win.element.style.left ).toBe( '0px' );
		expect( win.element.style.top ).toBe( '0px' );
		expect( win.element.style.width ).toBe( '800px' );
		expect( win.element.style.height ).toBe( '900px' );
	} );

	test( 'snapped-right restore lands on the right half with the right class', async () => {
		const win = await manager.open( {
			id: 'b',
			url: 'http://example.test/wp-admin/upload.php',
			title: 'Media',
			icon: 'dashicons-admin-media',
			initialState: 'snapped-right',
		} );
		expect(
			win.element.classList.contains( 'os-window--snapped-right' ),
		).toBe( true );
		await new Promise( ( r ) => requestAnimationFrame( () => r( undefined ) ) );
		expect( win.state ).toBe( 'snapped-right' );
		expect( win.element.style.left ).toBe( '800px' );
		expect( win.element.style.width ).toBe( '800px' );
	} );

	test( 'oppositeHalfRect returns area-relative coords so thumbnails land in the right half', async () => {

		const rightHalf = oppositeHalfRect( manager, 'left' );
		expect( rightHalf.left ).toBe( 800 );
		expect( rightHalf.width ).toBe( 800 );

		const leftHalf = oppositeHalfRect( manager, 'right' );
		expect( leftHalf.left ).toBe( 0 );
		expect( leftHalf.width ).toBe( 800 );

		const w1 = await manager.open( openConfig( 'a' ) );
		const w2 = await manager.open( openConfig( 'b' ) );
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
