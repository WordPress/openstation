/**
 * Tests that `WindowManager.createWindow` consults the per-baseId
 * geometry store as a fallback when the caller doesn't pin
 * dimensions or state.
 *
 * This covers the path used by classic (iframe-backed) windows
 * opened from a dock-icon click or a desktop icon, where no
 * width / height is provided and the default cascade-from-rect math
 * would otherwise win.
 *
 * @see https://github.com/Automattic/wp-desktop-mode/issues/203
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import {
	__resetNativeWindowGeometryForTests,
	saveNativeWindowGeometry,
	saveNativeWindowPosition,
	setNativeWindowSavedState,
} from '../../src/window-manager/native-window-geometry';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

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

describe( 'WindowManager geometry replay (issue #203)', () => {
	let desktopArea: HTMLElement;
	let manager: WindowManager;

	beforeEach( () => {
		installHooksStub();
		__resetNativeWindowGeometryForTests();
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
		Object.defineProperty( desktopArea, 'clientWidth', {
			value: 1600,
			configurable: true,
		} );
		Object.defineProperty( desktopArea, 'clientHeight', {
			value: 900,
			configurable: true,
		} );
		document.body.appendChild( desktopArea );
		manager = new WindowManager( desktopArea );
	} );

	afterEach( () => {
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktopArea.remove();
		clearHooksStub();
		__resetNativeWindowGeometryForTests();
	} );

	test( 'no saved entry: falls back to the desktopRect-based default size', async () => {
		const win = await manager.open( openConfig( 'edit-php' ) );

		// Default is min(rect.width * 0.8, 1200) = min(1280, 1200) = 1200.
		expect( win.config.width ).toBe( 1200 );
		// Default is min(rect.height * 0.8, 800) = min(720, 800) = 720.
		expect( win.config.height ).toBe( 720 );
	} );

	test( 'saved size: a fresh open lands at the persisted dimensions', async () => {
		saveNativeWindowGeometry( 'edit-php', {
			width: 1400,
			height: 880,
		} );

		const win = await manager.open( openConfig( 'edit-php' ) );

		expect( win.config.width ).toBe( 1400 );
		expect( win.config.height ).toBe( 880 );
	} );

	test( 'explicit width / height from the caller wins over the saved entry', async () => {
		// Session restore passes explicit dimensions. The saved
		// localStorage value must not override.
		saveNativeWindowGeometry( 'edit-php', {
			width: 1400,
			height: 880,
		} );

		const win = await manager.open(
			openConfig( 'edit-php', { width: 700, height: 500 } ),
		);

		expect( win.config.width ).toBe( 700 );
		expect( win.config.height ).toBe( 500 );
	} );

	test( 'saved size is clamped up to the registered minimum', async () => {
		saveNativeWindowGeometry( 'desktop-mode-plugins', {
			width: 320,
			height: 240,
		} );

		const win = await manager.open(
			openConfig( 'desktop-mode-plugins', {
				minWidth: 760,
				minHeight: 480,
			} ),
		);

		expect( win.config.width ).toBe( 760 );
		expect( win.config.height ).toBe( 480 );
	} );

	test( 'saved state="maximized" replays as initialState on a fresh open', async () => {
		setNativeWindowSavedState( 'edit-php', 'maximized', {
			width: 1400,
			height: 880,
		} );

		const win = await manager.open( openConfig( 'edit-php' ) );

		expect( win.config.initialState ).toBe( 'maximized' );
	} );

	test( 'openNew always opens floating regardless of the saved state', async () => {
		setNativeWindowSavedState( 'edit-php', 'maximized', {
			width: 1400,
			height: 880,
		} );

		const win = await manager.openNew(
			openConfig( 'edit-php', { multi: true } ),
		);

		expect( win.config.initialState ).toBe( 'normal' );
	} );

	test( 'session-restore initialState wins over the saved state', async () => {
		setNativeWindowSavedState( 'edit-php', 'maximized', {
			width: 1400,
			height: 880,
		} );

		const win = await manager.open(
			openConfig( 'edit-php', { initialState: 'minimized' } ),
		);

		expect( win.config.initialState ).toBe( 'minimized' );
	} );

	describe( 'position replay', () => {
		test( 'saved x / y are applied on a fresh primary open', async () => {
			saveNativeWindowGeometry( 'edit-php', {
				width: 800,
				height: 600,
			} );
			saveNativeWindowPosition( 'edit-php', { x: 240, y: 160 } );

			const win = await manager.open( openConfig( 'edit-php' ) );

			expect( win.config.x ).toBe( 240 );
			expect( win.config.y ).toBe( 160 );
		} );

		test( 'no saved position falls back to the cascade-from-rect default', async () => {
			saveNativeWindowGeometry( 'edit-php', {
				width: 800,
				height: 600,
			} );

			const win = await manager.open( openConfig( 'edit-php' ) );

			// Default cascade is `40 + (0 % 8) * CASCADE_OFFSET = 40`.
			expect( win.config.x ).toBe( 40 );
			expect( win.config.y ).toBe( 40 );
		} );

		test( 'a saved position outside the current viewport is clamped back inside', async () => {
			// Simulates an ultrawide-to-laptop transition. The
			// 1600x900 desktop in this harness can't honour a saved
			// x=2800.
			saveNativeWindowGeometry( 'edit-php', {
				width: 800,
				height: 600,
			} );
			saveNativeWindowPosition( 'edit-php', { x: 2800, y: 2000 } );

			const win = await manager.open( openConfig( 'edit-php' ) );

			// max-x = desktopWidth - winWidth - margin = 1600 - 800 - 12 = 788.
			expect( win.config.x ).toBe( 788 );
			// max-y = 900 - 600 - 12 = 288.
			expect( win.config.y ).toBe( 288 );
		} );

		test( 'explicit caller x / y wins over a saved position', async () => {
			saveNativeWindowGeometry( 'edit-php', {
				width: 800,
				height: 600,
			} );
			saveNativeWindowPosition( 'edit-php', { x: 240, y: 160 } );

			const win = await manager.open(
				openConfig( 'edit-php', { x: 600, y: 400 } ),
			);

			expect( win.config.x ).toBe( 600 );
			expect( win.config.y ).toBe( 400 );
		} );

		test( 'openNew (duplicate) cascades, not replays the primary position', async () => {
			saveNativeWindowGeometry( 'edit-php', {
				width: 800,
				height: 600,
			} );
			saveNativeWindowPosition( 'edit-php', { x: 240, y: 160 } );

			const win = await manager.openNew(
				openConfig( 'edit-php', { multi: true } ),
			);

			// Duplicate gets a cascade slot, not the saved primary
			// position. The cascade index for the first window is 0,
			// so cascade x = 40.
			expect( win.config.x ).toBe( 40 );
			expect( win.config.y ).toBe( 40 );
		} );
	} );
} );
