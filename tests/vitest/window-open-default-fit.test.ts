/**
 * Default placement never opens a window under the dock.
 *
 * `WindowManager.open()` fits a window nobody positioned into the
 * WORK area: a registered size taller than the reachable height is
 * shrunk (down to the window's minimum), and the cascade origin is
 * pulled up so the bottom edge lands inside. Caller-pinned x / y and
 * a size the user saved by resizing are left alone — those are
 * deliberate placement, not a default. Maximize and snap stay on
 * the whole area by design (see `src/window/index.ts`).
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import { __resetNativeWindowGeometryForTests } from '../../src/window-manager/native-window-geometry';
import {
	_resetWorkAreaForTests,
	installWorkArea,
	type WorkAreaController,
} from '../../src/work-area';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

const AREA_W = 1600;
const AREA_H = 700;
/** The bottom pill: 64px tall, 12px above the floor → 84px inset. */
const INSET = 12 + 64 + 8;

function fakeRect( left: number, top: number, width: number, height: number ): DOMRect {
	return {
		left,
		top,
		width,
		height,
		right: left + width,
		bottom: top + height,
		x: left,
		y: top,
		toJSON: () => ( {} ),
	} as DOMRect;
}

function openConfig( id: string, extras: Record< string, unknown > = {} ) {
	return {
		id,
		baseId: id,
		url: `http://example.test/wp-admin/${ id }.php`,
		title: id,
		icon: 'dashicons-admin-generic',
		...extras,
	};
}

describe( 'WindowManager.open() — default placement fits the work area', () => {
	let shell: HTMLElement;
	let area: HTMLElement;
	let manager: WindowManager;
	let workArea: WorkAreaController;

	beforeEach( () => {
		installHooksStub();
		__resetNativeWindowGeometryForTests();
		_resetWorkAreaForTests();

		shell = document.createElement( 'div' );
		const body = document.createElement( 'div' );
		area = document.createElement( 'div' );
		const dock = document.createElement( 'nav' );
		dock.className = 'os-dock';
		body.append( area, dock );
		shell.append( body );
		document.body.append( shell );

		area.getBoundingClientRect = () => fakeRect( 0, 0, AREA_W, AREA_H );
		Object.defineProperty( area, 'clientWidth', { value: AREA_W, configurable: true } );
		Object.defineProperty( area, 'clientHeight', { value: AREA_H, configurable: true } );
		dock.getBoundingClientRect = () => fakeRect( 500, AREA_H - 12 - 64, 600, 64 );

		workArea = installWorkArea( { shell, shellBody: body, area } );
		manager = new WindowManager( area );
	} );

	afterEach( () => {
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		workArea.destroy();
		document.body.innerHTML = '';
		clearHooksStub();
		__resetNativeWindowGeometryForTests();
		_resetWorkAreaForTests();
	} );

	test( 'a registered size taller than the reachable height is fitted, and lands above the dock', async () => {
		// The Corkboard's registered 1080×720 on a 700px-tall desktop.
		const win = await manager.open( openConfig( 'corkboard', { width: 1080, height: 720, minHeight: 480 } ) );
		const reachable = AREA_H - INSET; // 616
		expect( win.config.width ).toBe( 1080 );
		expect( win.config.height ).toBe( reachable - 24 ); // 592
		expect( win.config.y ).toBe( 12 );
		expect( win.config.y! + win.config.height! ).toBeLessThanOrEqual( reachable - 12 );
	} );

	test( 'the fit never goes below the window minimum', async () => {
		const win = await manager.open( openConfig( 'tall', { width: 800, height: 720, minHeight: 650 } ) );
		expect( win.config.height ).toBe( 650 );
	} );

	test( 'the default size is derived from the work area, not the whole desktop', async () => {
		const win = await manager.open( openConfig( 'edit-php' ) );
		// min( round( 616 * 0.8 ), 800 ) = 493
		expect( win.config.height ).toBe( Math.round( ( AREA_H - INSET ) * 0.8 ) );
		expect( win.config.y ).toBe( 40 );
	} );

	test( 'caller-pinned geometry is trusted as-is', async () => {
		const win = await manager.open( openConfig( 'pinned', { x: 100, y: 300, width: 1080, height: 720 } ) );
		expect( win.config.y ).toBe( 300 );
		expect( win.config.height ).toBe( 720 );
	} );
} );
