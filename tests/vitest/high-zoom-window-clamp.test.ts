/**
 * Tests for Issue #556: At high zoom / constrained viewports, active and restored
 * windows remain visible and fitted inside the work area.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { clampGeometryToViewport } from '../../src/boot/geometry';
import { clampWindowPosition } from '../../src/window/pointer';
import { WindowManager } from '../../src/window-manager';
import { __resetNativeWindowGeometryForTests } from '../../src/window-manager/native-window-geometry';
import {
	_resetWorkAreaForTests,
	installWorkArea,
	type WorkAreaController,
} from '../../src/work-area';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

describe( 'clampGeometryToViewport at high zoom / compact viewports (#556)', () => {
	test( 'clamps large saved window to fit inside a 97x211 work area at 400% zoom', () => {
		const win = {
			id: 'test-win',
			x: 100,
			y: 100,
			width: 600,
			height: 450,
		};
		const rect = {
			x: 0,
			y: 0,
			width: 97,
			height: 211,
		};

		const clamped = clampGeometryToViewport( win, rect );
		expect( clamped.width ).toBeLessThanOrEqual( rect.width );
		expect( clamped.height ).toBeLessThanOrEqual( rect.height );
		expect( clamped.x ).toBeGreaterThanOrEqual( 0 );
		expect( clamped.y ).toBeGreaterThanOrEqual( 0 );
		expect( clamped.x + clamped.width ).toBeLessThanOrEqual( rect.width );
		expect( clamped.y + clamped.height ).toBeLessThanOrEqual( rect.height );
	} );

	test( 'clamps position and size when rect has non-zero origin and small dimensions', () => {
		const win = {
			id: 'test-win',
			x: 500,
			y: 500,
			width: 800,
			height: 600,
		};
		const rect = {
			x: 10,
			y: 20,
			width: 150,
			height: 180,
		};

		const clamped = clampGeometryToViewport( win, rect );
		expect( clamped.width ).toBeLessThanOrEqual( rect.width );
		expect( clamped.height ).toBeLessThanOrEqual( rect.height );
		expect( clamped.x ).toBeGreaterThanOrEqual( rect.x );
		expect( clamped.y ).toBeGreaterThanOrEqual( rect.y );
		expect( clamped.x + clamped.width ).toBeLessThanOrEqual( rect.x + rect.width );
		expect( clamped.y + clamped.height ).toBeLessThanOrEqual( rect.y + rect.height );
	} );
} );

describe( 'clampWindowPosition on constrained work areas (#556)', () => {
	test( 'does not push window offscreen when bounds.width is smaller than default grab margin', () => {
		const bounds = {
			x: 0,
			y: 0,
			width: 100,
			height: 150,
		};
		const clamped = clampWindowPosition( 10, 10, 80, bounds );
		expect( clamped.x ).toBeGreaterThanOrEqual( 0 );
		expect( clamped.x ).toBeLessThanOrEqual( bounds.width );
		expect( clamped.y ).toBeGreaterThanOrEqual( 0 );
		expect( clamped.y ).toBeLessThanOrEqual( bounds.height );
	} );
} );

describe( 'WindowManager high-zoom reflow (#556)', () => {
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

		area.getBoundingClientRect = () => ( {
			left: 0,
			top: 0,
			width: 100,
			height: 200,
			right: 100,
			bottom: 200,
			x: 0,
			y: 0,
			toJSON: () => ( {} ),
		} as DOMRect );
		Object.defineProperty( area, 'clientWidth', { value: 100, configurable: true } );
		Object.defineProperty( area, 'clientHeight', { value: 200, configurable: true } );
		dock.getBoundingClientRect = () => ( {
			left: 0,
			top: 170,
			width: 100,
			height: 30,
			right: 100,
			bottom: 200,
			x: 0,
			y: 170,
			toJSON: () => ( {} ),
		} as DOMRect );

		workArea = installWorkArea( { shell, shellBody: body, area } );
		manager = new WindowManager( area );
	} );

	afterEach( () => {
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		workArea.destroy();
		manager.destroy();
		document.body.innerHTML = '';
		clearHooksStub();
		__resetNativeWindowGeometryForTests();
		_resetWorkAreaForTests();
	} );

	test( 'opening a window in a 100x200 viewport clamps dimensions within desktop bounds', async () => {
		const win = await manager.open( {
			id: 'test-high-zoom',
			baseId: 'test-high-zoom',
			url: 'http://example.test/wp-admin/test.php',
			title: 'Test',
			minWidth: 400,
			minHeight: 300,
		} );

		expect( win.config.width ).toBeLessThanOrEqual( 100 );
		expect( win.config.height ).toBeLessThanOrEqual( 200 );
		expect( win.config.x ).toBeGreaterThanOrEqual( 0 );
		expect( win.config.y ).toBeGreaterThanOrEqual( 0 );
	} );

	test( 'shrinking work area reflows open normal windows to fit within new boundaries', async () => {
		const win = await manager.open( {
			id: 'test-reflow-win',
			baseId: 'test-reflow-win',
			url: 'http://example.test/wp-admin/test2.php',
			title: 'Test 2',
			width: 60,
			height: 60,
		} );

		// Simulate screen shrinking further (e.g. zooming in to 400%)
		Object.defineProperty( area, 'clientWidth', { value: 60, configurable: true } );
		Object.defineProperty( area, 'clientHeight', { value: 80, configurable: true } );
		area.getBoundingClientRect = () => ( {
			left: 0,
			top: 0,
			width: 60,
			height: 80,
			right: 60,
			bottom: 80,
			x: 0,
			y: 0,
			toJSON: () => ( {} ),
		} as DOMRect );

		// Trigger reflow
		( manager as unknown as { reflowStatefulWindows: () => void } ).reflowStatefulWindows();

		const left = parseInt( win.element.style.left, 10 ) || 0;
		const top = parseInt( win.element.style.top, 10 ) || 0;
		const width = win.element.offsetWidth || 0;
		const height = win.element.offsetHeight || 0;

		expect( left + width ).toBeLessThanOrEqual( 60 );
		expect( top + height ).toBeLessThanOrEqual( 80 );
	} );
} );
