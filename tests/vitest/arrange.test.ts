/**
 * Behavioural + hook-firing tests for the Arrange features:
 *   - tile() lays out windows into a uniform grid
 *   - setSnapEnabled / isSnapEnabled / getSnapConfig
 *   - drag of a maximized window auto-unmaximizes
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import { Window } from '../../src/window';
import {
	clearHooksStub,
	installHooksStub,
	recordActions,
	type FakeWpHooks,
} from './helpers/hooks-stub';

const ARRANGE_HOOKS = [
	'desktop-mode.arrange.tile.starting',
	'desktop-mode.arrange.tile.applied',
	'desktop-mode.arrange.snap.changed',
	'desktop-mode.window.unmaximized',
] as const;

function openConfig( id: string ) {
	return {
		id,
		url: `http://example.test/wp-admin/${ id }.php`,
		title: id,
		icon: 'dashicons-admin-generic',
	};
}

describe( 'WindowManager — Arrange (tile + snap)', () => {
	let hooks: FakeWpHooks;
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( () => {
		hooks = installHooksStub();
		try {
			window.localStorage.removeItem( 'desktop-mode-snap-to-grid' );
		} catch {
			/* jsdom always supports localStorage; defensive */
		}
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

	test( 'tile() with no windows fires nothing', () => {
		const log = recordActions( hooks, ARRANGE_HOOKS );

		manager.tile();

		expect(
			log.some( ( e ) => e.name.startsWith( 'desktop-mode.arrange.tile.' ) ),
		).toBe( false );
	} );

	test( 'tile() with 4 windows on a landscape area picks 2x2', () => {
		manager.open( openConfig( 'a' ) );
		manager.open( openConfig( 'b' ) );
		manager.open( openConfig( 'c' ) );
		manager.open( openConfig( 'd' ) );
		const log = recordActions( hooks, ARRANGE_HOOKS );

		manager.tile();

		const applied = log.find(
			( e ) => e.name === 'desktop-mode.arrange.tile.applied',
		);
		expect( applied ).toBeDefined();
		const payload = applied!.args[ 0 ] as {
			windowCount: number;
			cols: number;
			rows: number;
		};
		expect( payload.windowCount ).toBe( 4 );
		// 1600x900 area — closest to areaAspect 1.78 is 2x2
		// (cellAspect 1.78), beating 4x1 (3.56) and 1x4 (0.44).
		expect( payload.cols ).toBe( 2 );
		expect( payload.rows ).toBe( 2 );
	} );

	test( 'tile() emits starting before applied', () => {
		manager.open( openConfig( 'a' ) );
		manager.open( openConfig( 'b' ) );
		const log = recordActions( hooks, ARRANGE_HOOKS );

		manager.tile();

		const tileEvents = log.filter( ( e ) =>
			e.name.startsWith( 'desktop-mode.arrange.tile.' ),
		);
		expect( tileEvents.map( ( e ) => e.name ) ).toEqual( [
			'desktop-mode.arrange.tile.starting',
			'desktop-mode.arrange.tile.applied',
		] );
	} );

	test( 'tile() un-maximizes any maximized windows before laying out', () => {
		const a = manager.open( openConfig( 'a' ) );
		manager.open( openConfig( 'b' ) );
		a.maximize();
		expect( a.state ).toBe( 'maximized' );

		manager.tile();

		expect( a.state ).toBe( 'normal' );
	} );

	test( 'tile() restores minimized windows so they participate in the grid', () => {
		const a = manager.open( openConfig( 'a' ) );
		manager.open( openConfig( 'b' ) );
		a.minimize();
		expect( a.state ).toBe( 'minimized' );

		manager.tile();

		expect( a.state ).toBe( 'normal' );
	} );

	test( 'isSnapEnabled defaults to false', () => {
		expect( manager.isSnapEnabled() ).toBe( false );
	} );

	test( 'setSnapEnabled(true) toggles on, fires snap.changed, persists', () => {
		const log = recordActions( hooks, ARRANGE_HOOKS );

		manager.setSnapEnabled( true );

		expect( manager.isSnapEnabled() ).toBe( true );
		const evt = log.find(
			( e ) => e.name === 'desktop-mode.arrange.snap.changed',
		);
		expect( evt ).toBeDefined();
		expect( ( evt!.args[ 0 ] as { enabled: boolean } ).enabled ).toBe( true );
		expect( window.localStorage.getItem( 'desktop-mode-snap-to-grid' ) ).toBe( '1' );
	} );

	test( 'setSnapEnabled(true) twice is idempotent — no duplicate hook firings', () => {
		manager.setSnapEnabled( true );
		const log = recordActions( hooks, ARRANGE_HOOKS );

		manager.setSnapEnabled( true );

		expect(
			log.some( ( e ) => e.name === 'desktop-mode.arrange.snap.changed' ),
		).toBe( false );
	} );

	test( 'getSnapConfig returns disabled when snap is off', () => {
		const cfg = manager.getSnapConfig();
		expect( cfg.enabled ).toBe( false );
	} );

	test( 'getSnapConfig returns sensible cell sizes when on', () => {
		manager.setSnapEnabled( true );

		const cfg = manager.getSnapConfig();

		expect( cfg.enabled ).toBe( true );
		// 1600 / 12 cols ≈ 133 px cells horizontally; clamped to ≥ 40.
		expect( cfg.cellWidth ).toBeGreaterThanOrEqual( 40 );
		expect( cfg.cellHeight ).toBeGreaterThanOrEqual( 40 );
		// And not absurd — should be on the order of "fraction of area".
		expect( cfg.cellWidth ).toBeLessThan( 400 );
		expect( cfg.cellHeight ).toBeLessThan( 400 );
	} );

	test( 'snap config provider is wired on each new window', () => {
		const win = manager.open( openConfig( 'a' ) );

		expect( typeof win.snapConfigProvider ).toBe( 'function' );
		const cfg = win.snapConfigProvider!();
		expect( cfg.enabled ).toBe( false );
	} );

	test( 'tile.dimensions filter overrides the algorithmic grid', () => {
		manager.open( openConfig( 'a' ) );
		manager.open( openConfig( 'b' ) );
		manager.open( openConfig( 'c' ) );
		manager.open( openConfig( 'd' ) );
		// Force a 1×4 layout instead of the default 2×2.
		hooks.addFilter(
			'desktop-mode.arrange.tile.dimensions',
			'test/force-1x4',
			() => ( { cols: 1, rows: 4 } ),
		);
		const log = recordActions( hooks, ARRANGE_HOOKS );

		manager.tile();

		const applied = log.find(
			( e ) => e.name === 'desktop-mode.arrange.tile.applied',
		);
		const payload = applied!.args[ 0 ] as { cols: number; rows: number };
		expect( payload.cols ).toBe( 1 );
		expect( payload.rows ).toBe( 4 );
	} );

	test( 'tile.dimensions filter context exposes window count + area size', () => {
		manager.open( openConfig( 'a' ) );
		manager.open( openConfig( 'b' ) );
		let receivedContext: unknown = null;
		hooks.addFilter(
			'desktop-mode.arrange.tile.dimensions',
			'test/inspect',
			( value, ctx ) => {
				receivedContext = ctx;
				return value;
			},
		);

		manager.tile();

		const ctx = receivedContext as {
			windowCount: number;
			areaWidth: number;
			areaHeight: number;
		};
		expect( ctx.windowCount ).toBe( 2 );
		expect( ctx.areaWidth ).toBe( 1600 );
		expect( ctx.areaHeight ).toBe( 900 );
	} );

	test( 'tile.dimensions filter rejects an under-sized grid', () => {
		manager.open( openConfig( 'a' ) );
		manager.open( openConfig( 'b' ) );
		manager.open( openConfig( 'c' ) );
		manager.open( openConfig( 'd' ) );
		// 1×2 only fits 2 windows; we have 4. Filter return must
		// be discarded, default 2×2 used.
		hooks.addFilter(
			'desktop-mode.arrange.tile.dimensions',
			'test/bad-grid',
			() => ( { cols: 1, rows: 2 } ),
		);
		const log = recordActions( hooks, ARRANGE_HOOKS );

		manager.tile();

		const applied = log.find(
			( e ) => e.name === 'desktop-mode.arrange.tile.applied',
		);
		const payload = applied!.args[ 0 ] as { cols: number; rows: number };
		expect( payload.cols ).toBe( 2 );
		expect( payload.rows ).toBe( 2 );
	} );

	test( 'tile.dimensions filter rejects malformed shapes', () => {
		manager.open( openConfig( 'a' ) );
		manager.open( openConfig( 'b' ) );
		hooks.addFilter(
			'desktop-mode.arrange.tile.dimensions',
			'test/garbage',
			() => 'not-a-grid',
		);
		const log = recordActions( hooks, ARRANGE_HOOKS );

		manager.tile();

		const applied = log.find(
			( e ) => e.name === 'desktop-mode.arrange.tile.applied',
		);
		const payload = applied!.args[ 0 ] as { cols: number; rows: number };
		// Default for 2 windows on landscape is 2×1 (cellAspect 800
		// vs area 1.78 — closer than 1×2's 0.89).
		expect( payload.cols * payload.rows ).toBeGreaterThanOrEqual( 2 );
	} );

	test( 'snap.cell-size filter overrides the auto-computed grid', () => {
		manager.setSnapEnabled( true );
		hooks.addFilter(
			'desktop-mode.arrange.snap.cell-size',
			'test/force-100',
			() => ( { cellWidth: 100, cellHeight: 100 } ),
		);

		const cfg = manager.getSnapConfig();

		expect( cfg.cellWidth ).toBe( 100 );
		expect( cfg.cellHeight ).toBe( 100 );
	} );

	test( 'snap.cell-size filter rejects non-positive values', () => {
		manager.setSnapEnabled( true );
		hooks.addFilter(
			'desktop-mode.arrange.snap.cell-size',
			'test/zero',
			() => ( { cellWidth: 0, cellHeight: -50 } ),
		);

		const cfg = manager.getSnapConfig();

		// Default for a 1600×900 area: ~133 px × ~112 px.
		expect( cfg.cellWidth ).toBeGreaterThan( 0 );
		expect( cfg.cellHeight ).toBeGreaterThan( 0 );
	} );

	test( 'snap.cell-size filter context exposes area dimensions', () => {
		manager.setSnapEnabled( true );
		let receivedContext: unknown = null;
		hooks.addFilter(
			'desktop-mode.arrange.snap.cell-size',
			'test/inspect',
			( value, ctx ) => {
				receivedContext = ctx;
				return value;
			},
		);

		manager.getSnapConfig();

		const ctx = receivedContext as {
			areaWidth: number;
			areaHeight: number;
		};
		expect( ctx.areaWidth ).toBe( 1600 );
		expect( ctx.areaHeight ).toBe( 900 );
	} );

	test( 'un-maximize with snap on rounds restored geometry to grid cells', () => {
		const win = manager.open( openConfig( 'a' ) );
		// Force an obviously non-grid saved geometry by maximizing
		// while snap was OFF. The pre-maximize position is the
		// constructor's default cascade slot (40, 40, ~1280×720),
		// which only happens to be grid-aligned by accident — set
		// concrete inline styles to make the assertion deterministic.
		win.element.style.left = '137px';
		win.element.style.top = '83px';
		win.element.style.width = '801px';
		win.element.style.height = '507px';
		Object.defineProperty( win.element, 'offsetLeft', { value: 137, configurable: true } );
		Object.defineProperty( win.element, 'offsetTop', { value: 83, configurable: true } );
		Object.defineProperty( win.element, 'offsetWidth', { value: 801, configurable: true } );
		Object.defineProperty( win.element, 'offsetHeight', { value: 507, configurable: true } );
		win.maximize();

		manager.setSnapEnabled( true );
		const cfg = manager.getSnapConfig();
		win.toggleMaximize(); // un-maximize

		// Restored x/y/width/height should each be a multiple of the
		// grid cell on its axis (or, for width/height, at least the
		// configured minimum if the round produced something smaller).
		const finalLeft = parseInt( win.element.style.left, 10 );
		const finalTop = parseInt( win.element.style.top, 10 );
		const finalW = parseInt( win.element.style.width, 10 );
		const finalH = parseInt( win.element.style.height, 10 );
		expect( finalLeft % cfg.cellWidth ).toBe( 0 );
		expect( finalTop % cfg.cellHeight ).toBe( 0 );
		// width/height clamped to >= minWidth/minHeight so they may
		// not be exact multiples — but they must be at least the
		// minimum and snap-aligned when above the floor.
		if ( finalW > 320 ) {
			expect( finalW % cfg.cellWidth ).toBe( 0 );
		}
		if ( finalH > 200 ) {
			expect( finalH % cfg.cellHeight ).toBe( 0 );
		}
	} );
} );

describe( 'Window — drag of a maximized window auto-unmaximizes', () => {
	let hooks: FakeWpHooks;
	let parent: HTMLElement;
	let win: Window;

	beforeEach( () => {
		hooks = installHooksStub();
		parent = document.createElement( 'div' );
		Object.defineProperty( parent, 'clientWidth', { value: 1600, configurable: true } );
		Object.defineProperty( parent, 'clientHeight', { value: 900, configurable: true } );
		document.body.appendChild( parent );
		win = new Window( {
			id: 'w',
			url: `${ window.location.origin }/wp-admin/edit.php`,
			title: 'Editor',
			icon: 'dashicons-admin-post',
			x: 100,
			y: 100,
			width: 800,
			height: 600,
			minWidth: 320,
			minHeight: 200,
		} );
		parent.appendChild( win.element );
	} );

	afterEach( () => {
		win.close();
		parent.remove();
		clearHooksStub();
	} );

	test( 'drag start on a maximized window restores normal state + fires unmaximized', () => {
		win.maximize();
		expect( win.state ).toBe( 'maximized' );
		const log = recordActions( hooks, [
			'desktop-mode.window.unmaximized',
		] );

		const titleBar = win.element.querySelector(
			'.desktop-mode-window__titlebar',
		) as HTMLElement;
		// jsdom doesn't implement setPointerCapture — stub.
		titleBar.setPointerCapture =
			titleBar.setPointerCapture ?? ( () => undefined );
		// jsdom 25 doesn't ship `PointerEvent` either — synthesize a
		// MouseEvent with the pointer fields the handler reads
		// (`pointerId` is the only PointerEvent-specific bit).
		const down = new MouseEvent( 'pointerdown', {
			bubbles: true,
			clientX: 400,
			clientY: 16,
			button: 0,
		} );
		Object.defineProperty( down, 'pointerId', { value: 1 } );
		titleBar.dispatchEvent( down );
		// Un-state is threshold-gated (DRAG_THRESHOLD_PX = 5) so a
		// stationary pointerdown doesn't un-max a window. Simulate a
		// 20 px right-move on the title bar so the deferred un-state
		// commits.
		const move = new MouseEvent( 'pointermove', {
			bubbles: true,
			clientX: 420,
			clientY: 16,
		} );
		Object.defineProperty( move, 'pointerId', { value: 1 } );
		titleBar.dispatchEvent( move );

		expect( win.state ).toBe( 'normal' );
		expect(
			log.some( ( e ) => e.name === 'desktop-mode.window.unmaximized' ),
		).toBe( true );
	} );
} );
