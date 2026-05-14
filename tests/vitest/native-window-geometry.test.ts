/**
 * Tests for the per-baseId native-window geometry store.
 *
 * Native windows are excluded from the server-side session snapshot
 * because their `render` callback is a JS closure. This module keeps
 * "the size I picked last time" on the client in localStorage —
 * orthogonal from the session restore but reads in the same
 * `openFromEntry` path so a user's resize survives a reload.
 *
 * @see https://github.com/Automattic/wp-desktop-mode/issues/203
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
	__resetNativeWindowGeometryForTests,
	NATIVE_GEOMETRY_STORAGE_KEY,
	loadNativeWindowGeometry,
	saveNativeWindowGeometry,
	saveNativeWindowPosition,
	setNativeWindowSavedState,
} from '../../src/window-manager/native-window-geometry';

describe( 'native-window-geometry', () => {
	beforeEach( () => {
		__resetNativeWindowGeometryForTests();
	} );
	afterEach( () => {
		__resetNativeWindowGeometryForTests();
	} );

	test( 'load returns null when nothing is stored', () => {
		expect( loadNativeWindowGeometry( 'desktop-mode-plugins' ) ).toBeNull();
	} );

	test( 'save then load round-trips width and height', () => {
		saveNativeWindowGeometry( 'desktop-mode-plugins', {
			width: 1500,
			height: 900,
		} );

		expect( loadNativeWindowGeometry( 'desktop-mode-plugins' ) ).toEqual( {
			width: 1500,
			height: 900,
		} );
	} );

	test( 'save rounds non-integer dimensions to whole pixels', () => {
		saveNativeWindowGeometry( 'demo', { width: 1280.6, height: 720.4 } );

		expect( loadNativeWindowGeometry( 'demo' ) ).toEqual( {
			width: 1281,
			height: 720,
		} );
	} );

	test( 'save ignores non-positive or non-finite dimensions', () => {
		saveNativeWindowGeometry( 'a', { width: 0, height: 600 } );
		saveNativeWindowGeometry( 'b', { width: 800, height: -1 } );
		saveNativeWindowGeometry( 'c', { width: NaN, height: 600 } );
		saveNativeWindowGeometry( 'd', { width: Infinity, height: 600 } );

		expect( loadNativeWindowGeometry( 'a' ) ).toBeNull();
		expect( loadNativeWindowGeometry( 'b' ) ).toBeNull();
		expect( loadNativeWindowGeometry( 'c' ) ).toBeNull();
		expect( loadNativeWindowGeometry( 'd' ) ).toBeNull();
	} );

	test( 'save ignores entries past the sanity ceiling', () => {
		saveNativeWindowGeometry( 'huge', { width: 9000, height: 600 } );

		expect( loadNativeWindowGeometry( 'huge' ) ).toBeNull();
	} );

	test( 'save with empty baseId is a no-op', () => {
		saveNativeWindowGeometry( '', { width: 800, height: 600 } );

		// No key would be created — the next call returns the
		// default-empty store.
		expect(
			window.localStorage.getItem( NATIVE_GEOMETRY_STORAGE_KEY ),
		).toBeNull();
	} );

	test( 'load tolerates corrupt JSON', () => {
		window.localStorage.setItem(
			NATIVE_GEOMETRY_STORAGE_KEY,
			'{not-json',
		);

		expect( loadNativeWindowGeometry( 'anything' ) ).toBeNull();
	} );

	test( 'load tolerates a non-object payload', () => {
		window.localStorage.setItem( NATIVE_GEOMETRY_STORAGE_KEY, '"oops"' );

		expect( loadNativeWindowGeometry( 'anything' ) ).toBeNull();
	} );

	test( 'load returns null for entries with malformed dimensions', () => {
		window.localStorage.setItem(
			NATIVE_GEOMETRY_STORAGE_KEY,
			JSON.stringify( {
				bad: { width: 'wide', height: 600 },
			} ),
		);

		expect( loadNativeWindowGeometry( 'bad' ) ).toBeNull();
	} );

	test( 'save overwrites the previous size for the same baseId', () => {
		saveNativeWindowGeometry( 'demo', { width: 800, height: 600 } );
		saveNativeWindowGeometry( 'demo', { width: 1400, height: 900 } );

		expect( loadNativeWindowGeometry( 'demo' ) ).toEqual( {
			width: 1400,
			height: 900,
		} );
	} );

	test( 'trims the store to a bounded size, evicting the oldest', () => {
		// Save 70 distinct ids — exceeds the 64-entry cap. The first
		// few should be evicted to make room for the latest.
		for ( let i = 0; i < 70; i++ ) {
			saveNativeWindowGeometry( `app-${ i }`, {
				width: 800 + i,
				height: 600,
			} );
		}

		// The earliest entries are gone; recent ones survive.
		expect( loadNativeWindowGeometry( 'app-0' ) ).toBeNull();
		expect( loadNativeWindowGeometry( 'app-5' ) ).toBeNull();
		expect( loadNativeWindowGeometry( 'app-69' ) ).toEqual( {
			width: 869,
			height: 600,
		} );
	} );

	describe( 'saved window position', () => {
		test( 'save then load round-trips x and y alongside size', () => {
			saveNativeWindowGeometry( 'demo', { width: 800, height: 600 } );
			saveNativeWindowPosition( 'demo', { x: 240, y: 120 } );

			expect( loadNativeWindowGeometry( 'demo' ) ).toEqual( {
				width: 800,
				height: 600,
				x: 240,
				y: 120,
			} );
		} );

		test( 'saveNativeWindowPosition is a no-op when no prior entry exists', () => {
			saveNativeWindowPosition( 'demo', { x: 240, y: 120 } );

			expect( loadNativeWindowGeometry( 'demo' ) ).toBeNull();
		} );

		test( 'saveNativeWindowPosition rounds to whole pixels', () => {
			saveNativeWindowGeometry( 'demo', { width: 800, height: 600 } );
			saveNativeWindowPosition( 'demo', { x: 240.7, y: 120.2 } );

			expect( loadNativeWindowGeometry( 'demo' ) ).toEqual( {
				width: 800,
				height: 600,
				x: 241,
				y: 120,
			} );
		} );

		test( 'saveNativeWindowPosition rejects negative or non-finite values', () => {
			saveNativeWindowGeometry( 'demo', { width: 800, height: 600 } );

			saveNativeWindowPosition( 'demo', { x: -10, y: 120 } );
			expect( loadNativeWindowGeometry( 'demo' ) ).toEqual( {
				width: 800,
				height: 600,
			} );

			saveNativeWindowPosition( 'demo', { x: NaN, y: 0 } );
			expect( loadNativeWindowGeometry( 'demo' ) ).toEqual( {
				width: 800,
				height: 600,
			} );
		} );

		test( 'saveNativeWindowGeometry preserves a previously-saved position', () => {
			saveNativeWindowGeometry( 'demo', { width: 800, height: 600 } );
			saveNativeWindowPosition( 'demo', { x: 240, y: 120 } );

			saveNativeWindowGeometry( 'demo', { width: 1500, height: 900 } );

			expect( loadNativeWindowGeometry( 'demo' ) ).toEqual( {
				width: 1500,
				height: 900,
				x: 240,
				y: 120,
			} );
		} );

		test( 'setNativeWindowSavedState preserves a previously-saved position', () => {
			saveNativeWindowGeometry( 'demo', { width: 800, height: 600 } );
			saveNativeWindowPosition( 'demo', { x: 240, y: 120 } );

			setNativeWindowSavedState( 'demo', 'maximized' );

			expect( loadNativeWindowGeometry( 'demo' ) ).toEqual( {
				width: 800,
				height: 600,
				x: 240,
				y: 120,
				state: 'maximized',
			} );
		} );

		test( 'loadNativeWindowGeometry drops malformed position values', () => {
			window.localStorage.setItem(
				NATIVE_GEOMETRY_STORAGE_KEY,
				JSON.stringify( {
					demo: {
						width: 800,
						height: 600,
						x: 'left',
						y: 120,
					},
				} ),
			);

			expect( loadNativeWindowGeometry( 'demo' ) ).toEqual( {
				width: 800,
				height: 600,
			} );
		} );
	} );

	describe( 'saved window state', () => {
		test( 'setNativeWindowSavedState seeds a new entry from defaults', () => {
			setNativeWindowSavedState( 'demo', 'maximized', {
				width: 520,
				height: 400,
			} );

			expect( loadNativeWindowGeometry( 'demo' ) ).toEqual( {
				width: 520,
				height: 400,
				state: 'maximized',
			} );
		} );

		test( 'setNativeWindowSavedState without defaults is a no-op when nothing is stored yet', () => {
			setNativeWindowSavedState( 'demo', 'maximized' );

			expect( loadNativeWindowGeometry( 'demo' ) ).toBeNull();
		} );

		test( 'setNativeWindowSavedState layers state on an existing size without changing it', () => {
			saveNativeWindowGeometry( 'demo', { width: 1500, height: 900 } );

			setNativeWindowSavedState( 'demo', 'maximized' );

			expect( loadNativeWindowGeometry( 'demo' ) ).toEqual( {
				width: 1500,
				height: 900,
				state: 'maximized',
			} );
		} );

		test( 'setNativeWindowSavedState(null) clears the state but keeps the size', () => {
			saveNativeWindowGeometry( 'demo', { width: 1500, height: 900 } );
			setNativeWindowSavedState( 'demo', 'maximized' );

			setNativeWindowSavedState( 'demo', null );

			expect( loadNativeWindowGeometry( 'demo' ) ).toEqual( {
				width: 1500,
				height: 900,
			} );
		} );

		test( 'saveNativeWindowGeometry preserves the previously-saved state', () => {
			setNativeWindowSavedState( 'demo', 'maximized', {
				width: 520,
				height: 400,
			} );

			saveNativeWindowGeometry( 'demo', { width: 1500, height: 900 } );

			expect( loadNativeWindowGeometry( 'demo' ) ).toEqual( {
				width: 1500,
				height: 900,
				state: 'maximized',
			} );
		} );

		test( 'loadNativeWindowGeometry drops unknown state values', () => {
			window.localStorage.setItem(
				NATIVE_GEOMETRY_STORAGE_KEY,
				JSON.stringify( {
					demo: {
						width: 1500,
						height: 900,
						state: 'rotated-3d', // unsupported
					},
				} ),
			);

			expect( loadNativeWindowGeometry( 'demo' ) ).toEqual( {
				width: 1500,
				height: 900,
			} );
		} );
	} );

	test( 'a recently-touched id moves to the front of the eviction queue', () => {
		for ( let i = 0; i < 64; i++ ) {
			saveNativeWindowGeometry( `app-${ i }`, {
				width: 800,
				height: 600,
			} );
		}

		// Touch app-0 — should now be the youngest, not the oldest.
		saveNativeWindowGeometry( 'app-0', { width: 1500, height: 900 } );

		// One more save pushes the store back past the cap. With the
		// move-to-end behavior, app-1 (the next oldest) gets evicted,
		// not app-0.
		saveNativeWindowGeometry( 'app-99', { width: 800, height: 600 } );

		expect( loadNativeWindowGeometry( 'app-0' ) ).toEqual( {
			width: 1500,
			height: 900,
		} );
		expect( loadNativeWindowGeometry( 'app-1' ) ).toBeNull();
		expect( loadNativeWindowGeometry( 'app-99' ) ).toEqual( {
			width: 800,
			height: 600,
		} );
	} );
} );
