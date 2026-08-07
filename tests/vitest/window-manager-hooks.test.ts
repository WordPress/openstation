/**
 * Hook-firing tests for {@link WindowManager}.
 *
 * Covers the actions the manager is responsible for emitting:
 *   - os.window.opened
 *   - os.window.focused
 *   - os.window.closed
 *   - os.arrange.cascade.starting / applied
 *
 * Window-owned hooks (minimized, maximized, fullscreen, title, …)
 * are covered in `window-lifecycle-hooks.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import { HOOKS } from '../../src/hooks';
import {
	clearHooksStub,
	installHooksStub,
	recordActions,
	type FakeWpHooks,
} from './helpers/hooks-stub';

const MANAGER_HOOKS = [
	'os.window.opened',
	'os.window.focused',
	'os.window.closed',
	'os.arrange.cascade.starting',
	'os.arrange.cascade.applied',
] as const;

function openConfig( id: string, overrides: Partial<{ url: string; title: string; icon: string; multi: boolean }> = {} ) {
	return {
		id,
		url: overrides.url ?? `http://example.test/wp-admin/${ id }.php`,
		title: overrides.title ?? id,
		icon: overrides.icon ?? 'dashicons-admin-generic',
		multi: overrides.multi,
	};
}

describe( 'WindowManager — hook firing', async () => {
	let hooks: FakeWpHooks;
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( async () => {
		hooks = installHooksStub();
		desktop = document.createElement( 'div' );
		desktop.id = 'os-area';
		// Give the desktop a non-zero bounding box so cascade math
		// doesn't divide-by-zero or cascade windows into nowhere.
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
		// jsdom doesn't compute layout — stub clientWidth/Height so
		// `maximize` / cascade still produce sensible numbers.
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

	test( 'open() fires window.opened with { windowId, page, title, url }', async () => {
		const log = recordActions( hooks, MANAGER_HOOKS );

		await manager.open( openConfig( 'posts', { url: 'http://example.test/edit.php', title: 'Posts' } ) );

		const opened = log.find( ( e ) => e.name === 'os.window.opened' );
		expect( opened ).toBeDefined();
		const payload = opened!.args[ 0 ] as {
			windowId: string;
			page: string;
			title: string;
			url: string;
		};
		expect( payload.windowId ).toBe( 'posts' );
		expect( payload.title ).toBe( 'Posts' );
		expect( payload.url ).toBe( 'http://example.test/edit.php' );
		expect( payload.page ).toBe( 'http://example.test/edit.php' );
	} );

	test( 'open() fires window.focused right after opened', async () => {
		const log = recordActions( hooks, MANAGER_HOOKS );

		await manager.open( openConfig( 'posts' ) );

		const names = log.map( ( e ) => e.name );
		const openedIdx = names.indexOf( 'os.window.opened' );
		const focusedIdx = names.indexOf( 'os.window.focused' );
		expect( openedIdx ).toBeGreaterThanOrEqual( 0 );
		expect( focusedIdx ).toBeGreaterThanOrEqual( 0 );
		// `createWindow` calls `focus()` before emitting `opened`, so
		// the focus action is logged first — either order is valid so
		// long as both fire.
		expect( focusedIdx ).not.toBe( -1 );
	} );

	test( 'opening a second window re-fires focused with the new id', async () => {
		await manager.open( openConfig( 'posts' ) );
		const log = recordActions( hooks, MANAGER_HOOKS );
		await manager.open( openConfig( 'pages' ) );

		const focuses = log.filter(
			( e ) => e.name === 'os.window.focused',
		);
		expect( focuses.length ).toBeGreaterThanOrEqual( 1 );
		const last = focuses[ focuses.length - 1 ].args[ 0 ] as {
			windowId: string;
		};
		expect( last.windowId ).toBe( 'pages' );
	} );

	test( 'focus() re-fires window.focused for an existing window', async () => {
		await manager.open( openConfig( 'a' ) );
		const b = await manager.open( openConfig( 'b' ) );
		const log = recordActions( hooks, MANAGER_HOOKS );

		manager.focus( b );

		const focuses = log.filter(
			( e ) => e.name === 'os.window.focused',
		);
		expect( focuses.length ).toBe( 1 );
		expect(
			( focuses[ 0 ].args[ 0 ] as { windowId: string } ).windowId,
		).toBe( 'b' );
	} );

	test( 'window.close() fires window.closed via the manager', async () => {
		const win = await manager.open( openConfig( 'tools' ) );
		const log = recordActions( hooks, MANAGER_HOOKS );

		win.close();

		const closed = log.find( ( e ) => e.name === 'os.window.closed' );
		expect( closed ).toBeDefined();
		expect(
			( closed!.args[ 0 ] as { windowId: string } ).windowId,
		).toBe( 'tools' );
	} );

	test( 'closing the last window does NOT fire a trailing focused', async () => {
		const win = await manager.open( openConfig( 'solo' ) );
		const log = recordActions( hooks, MANAGER_HOOKS );
		win.close();

		// Stack is empty, so there's no survivor to re-focus. The
		// manager must NOT synthesize a focused event for a
		// nonexistent window.
		const focuses = log.filter(
			( e ) => e.name === 'os.window.focused',
		);
		expect( focuses ).toHaveLength( 0 );
	} );

	test( 'closing a non-top window focuses the survivor', async () => {
		const a = await manager.open( openConfig( 'a' ) );
		await manager.open( openConfig( 'b' ) );
		const log = recordActions( hooks, MANAGER_HOOKS );

		a.close();

		// `a` wasn't on top; `b` keeps focus — one focused action fires.
		const focuses = log.filter(
			( e ) => e.name === 'os.window.focused',
		);
		expect( focuses ).toHaveLength( 1 );
		expect(
			( focuses[ 0 ].args[ 0 ] as { windowId: string } ).windowId,
		).toBe( 'b' );
	} );

	test( 'cascade() fires starting then applied with windowCount', async () => {
		await manager.open( openConfig( 'a' ) );
		await manager.open( openConfig( 'b' ) );
		await manager.open( openConfig( 'c' ) );
		const log = recordActions( hooks, MANAGER_HOOKS );

		manager.cascade();

		const cascadeEvents = log
			.filter( ( e ) => e.name.startsWith( 'os.arrange.cascade.' ) )
			.map( ( e ) => ( {
				name: e.name,
				payload: e.args[ 0 ] as { windowCount: number },
			} ) );
		expect( cascadeEvents.map( ( e ) => e.name ) ).toEqual( [
			'os.arrange.cascade.starting',
			'os.arrange.cascade.applied',
		] );
		expect( cascadeEvents[ 0 ].payload.windowCount ).toBe( 3 );
		expect( cascadeEvents[ 1 ].payload.windowCount ).toBe( 3 );
	} );

	test( 'cascade() with no windows fires neither hook', async () => {
		const log = recordActions( hooks, MANAGER_HOOKS );

		manager.cascade();

		const cascadeEvents = log.filter( ( e ) =>
			e.name.startsWith( 'os.arrange.cascade.' ),
		);
		expect( cascadeEvents ).toHaveLength( 0 );
	} );

	test( 'WINDOW_GEOMETRY filter sees default-resolved geometry and can override it', async () => {
		const seen: Array< { geometry: unknown; ctx: unknown } > = [];
		const NEW_W = 480;
		const NEW_H = 320;
		hooks.addFilter(
			HOOKS.WINDOW_GEOMETRY,
			'vitest/geometry',
			( ( geometry: unknown, ctx: unknown ) => {
				seen.push( { geometry, ctx } );
				const g = geometry as { x: number; y: number; width: number; height: number };
				// Force the bottom-right corner with a clearly-above-min frame.
				const desktop = ( ctx as { desktopRect: { width: number; height: number } } ).desktopRect;
				return {
					...g,
					width: NEW_W,
					height: NEW_H,
					x: desktop.width - NEW_W - 20,
					y: desktop.height - NEW_H - 20,
				};
			} ) as ( ...a: unknown[] ) => unknown,
		);

		await manager.open( openConfig( 'shop' ) );

		expect( seen ).toHaveLength( 1 );
		const ctx = seen[ 0 ].ctx as {
			windowId: string;
			baseId: string;
			hasSavedGeometry: boolean;
			callerPinned: boolean;
			desktopRect: { width: number; height: number };
		};
		expect( ctx.windowId ).toBe( 'shop' );
		expect( ctx.baseId ).toBe( 'shop' );
		expect( ctx.hasSavedGeometry ).toBe( false );
		expect( ctx.callerPinned ).toBe( false );
		expect( ctx.desktopRect.width ).toBe( 1600 );
		expect( ctx.desktopRect.height ).toBe( 900 );

		const win = manager.getById( 'shop' );
		expect( win ).toBeDefined();
		expect( win!.config.width ).toBe( NEW_W );
		expect( win!.config.height ).toBe( NEW_H );
		expect( win!.config.x ).toBe( 1600 - NEW_W - 20 );
		expect( win!.config.y ).toBe( 900 - NEW_H - 20 );
	} );

	test( 'WINDOW_GEOMETRY ctx.callerPinned is true when caller passes width/height', async () => {
		let observed: { callerPinned: boolean; hasSavedGeometry: boolean } | null = null;
		hooks.addFilter(
			HOOKS.WINDOW_GEOMETRY,
			'vitest/geometry-pinned',
			( ( geometry: unknown, ctx: unknown ) => {
				observed = ctx as { callerPinned: boolean; hasSavedGeometry: boolean };
				return geometry;
			} ) as ( ...a: unknown[] ) => unknown,
		);

		await manager.open( {
			...openConfig( 'pinned' ),
			width: 555,
			height: 333,
		} );

		expect( observed!.callerPinned ).toBe( true );
		expect( observed!.hasSavedGeometry ).toBe( false );
		const win = manager.getById( 'pinned' );
		expect( win!.config.width ).toBe( 555 );
		expect( win!.config.height ).toBe( 333 );
	} );

	test( 'WINDOW_GEOMETRY filter can override the registry-pinned dimensions of a native-style open', async () => {
		// Native windows open with explicit width/height from the
		// registry. The filter MUST still be able to override them —
		// `callerPinned: true` does not mean "leave it alone." This
		// pins the regression: the source enum used to bucket this as
		// `'explicit'` and the common "only on fresh opens" guard
		// skipped it.
		hooks.addFilter(
			HOOKS.WINDOW_GEOMETRY,
			'vitest/native-override',
			( ( geometry: unknown, ctx: unknown ) => {
				const g = geometry as { width: number; height: number; x: number; y: number };
				const c = ctx as { hasSavedGeometry: boolean; desktopRect: { width: number; height: number } };
				if ( c.hasSavedGeometry ) {
					return g;
				}
				return {
					...g,
					width: 600,
					height: 400,
					x: c.desktopRect.width - 600 - 20,
					y: c.desktopRect.height - 400 - 20,
				};
			} ) as ( ...a: unknown[] ) => unknown,
		);

		// Mimic the native-window opener: pass explicit width/height
		// from the "registry" defaults.
		await manager.open( {
			...openConfig( 'native-shop' ),
			width: 1000,    // registry default — filter should override
			height: 700,
			native: true,
		} );

		const win = manager.getById( 'native-shop' );
		expect( win!.config.width ).toBe( 600 );
		expect( win!.config.height ).toBe( 400 );
		expect( win!.config.x ).toBe( 1600 - 600 - 20 );
		expect( win!.config.y ).toBe( 900 - 400 - 20 );
	} );

	test( 'WINDOW_GEOMETRY filter return values are re-clamped to minWidth/minHeight', async () => {
		hooks.addFilter(
			HOOKS.WINDOW_GEOMETRY,
			'vitest/geometry-too-small',
			( ( geometry: unknown ) => ( {
				...( geometry as Record< string, unknown > ),
				width:  50,
				height: 50,
			} ) ) as ( ...a: unknown[] ) => unknown,
		);

		await manager.open( openConfig( 'tinybox' ) );

		const win = manager.getById( 'tinybox' );
		// Default minWidth/minHeight come from createWindow's `?? 320` /
		// `?? 200` fallbacks — a buggy filter cannot bypass them.
		expect( win!.config.width ).toBe( 320 );
		expect( win!.config.height ).toBe( 200 );
	} );

	test( 'WINDOW_GEOMETRY filter — partial return drops back to pre-filter values', async () => {
		// A careless filter returns only the dimensions it cared about
		// — the missing fields must NOT come through as NaN / undefined.
		hooks.addFilter(
			HOOKS.WINDOW_GEOMETRY,
			'vitest/geometry-partial',
			( ( () => ( { width: 800 } ) ) as ( ...a: unknown[] ) => unknown ),
		);

		await manager.open( openConfig( 'partial' ) );

		const win = manager.getById( 'partial' );
		expect( win!.config.width ).toBe( 800 ); // honored
		// Default fallthrough: cascade x/y + 80% desktopRect for h.
		expect( Number.isFinite( win!.config.x ) ).toBe( true );
		expect( Number.isFinite( win!.config.y ) ).toBe( true );
		expect( Number.isFinite( win!.config.height ) ).toBe( true );
		expect( win!.config.height ).toBeGreaterThan( 0 );
	} );

	test( 'WINDOW_GEOMETRY filter — NaN / Infinity values fall through to pre-filter values', async () => {
		hooks.addFilter(
			HOOKS.WINDOW_GEOMETRY,
			'vitest/geometry-garbage',
			( ( () => ( {
				x:      Number.NaN,
				y:      Number.POSITIVE_INFINITY,
				width:  Number.NEGATIVE_INFINITY,
				height: Number.NaN,
			} ) ) as ( ...a: unknown[] ) => unknown ),
		);

		await manager.open( openConfig( 'garbage' ) );

		const win = manager.getById( 'garbage' );
		expect( Number.isFinite( win!.config.x ) ).toBe( true );
		expect( Number.isFinite( win!.config.y ) ).toBe( true );
		expect( win!.config.width ).toBeGreaterThanOrEqual( 320 );
		expect( win!.config.height ).toBeGreaterThanOrEqual( 200 );
	} );

	test( 'WINDOW_GEOMETRY filter — throwing filter does not bring down open()', async () => {
		hooks.addFilter(
			HOOKS.WINDOW_GEOMETRY,
			'vitest/geometry-throw',
			( ( () => {
				throw new Error( 'plugin author bug' );
			} ) ) as ( ...a: unknown[] ) => unknown,
		);
		const errors: unknown[] = [];
		hooks.addAction(
			'os.shell.error',
			'vitest/shell-error',
			( ...args: unknown[] ) => {
				errors.push( args[ 0 ] );
			},
		);
		// Silence the console.error our handler emits.
		const origErr = console.error;
		console.error = () => undefined;

		try {
			await manager.open( openConfig( 'crasher' ) );
		} finally {
			console.error = origErr;
		}

		const win = manager.getById( 'crasher' );
		expect( win ).toBeDefined();
		// Pre-filter resolved geometry survives unscathed.
		expect( Number.isFinite( win!.config.x ) ).toBe( true );
		expect( win!.config.width ).toBeGreaterThanOrEqual( 320 );
		const reported = errors.find(
			( e ): e is { scope: string } =>
				typeof e === 'object' && e !== null &&
				( e as { scope?: string } ).scope === 'window-geometry-filter',
		);
		expect( reported ).toBeDefined();
	} );

	test( 'WINDOW_GEOMETRY filter — non-object return falls through to pre-filter geometry', async () => {
		hooks.addFilter(
			HOOKS.WINDOW_GEOMETRY,
			'vitest/geometry-nonsense',
			// Plugin author returns garbage (e.g. forgot `return` and got
			// undefined back).
			( ( () => undefined ) as ( ...a: unknown[] ) => unknown ),
		);

		await manager.open( openConfig( 'nonsense' ) );

		const win = manager.getById( 'nonsense' );
		expect( win ).toBeDefined();
		expect( win!.config.width ).toBeGreaterThanOrEqual( 320 );
		expect( win!.config.height ).toBeGreaterThanOrEqual( 200 );
	} );

	test( 'WINDOW_GEOMETRY filter fires for native windows too', async () => {
		let observedWindowId: string | null = null;
		hooks.addFilter(
			HOOKS.WINDOW_GEOMETRY,
			'vitest/geometry-native',
			( ( geometry: unknown, ctx: unknown ) => {
				observedWindowId = ( ctx as { windowId: string } ).windowId;
				return geometry;
			} ) as ( ...a: unknown[] ) => unknown,
		);

		// Native windows ride the same `manager.open()` path with
		// `native: true` set on the config.
		await manager.open( {
			...openConfig( 'jorvy' ),
			native: true,
		} );

		expect( observedWindowId ).toBe( 'jorvy' );
	} );

	test( 'WINDOW_GEOMETRY ctx.hasSavedGeometry is true when localStorage has saved geometry', async () => {
		// Pre-seed the per-baseId geometry store the same way the
		// native-window persistence listener does — see
		// `src/window-manager/native-window-geometry.ts`.
		const STORAGE_KEY = 'desktop-mode-native-window-geometry';
		const saved = JSON.stringify( {
			'restoreme': { x: 100, y: 100, width: 700, height: 500, state: 'normal' },
		} );
		try {
			window.localStorage.setItem( STORAGE_KEY, saved );
		} catch {
			/* jsdom */
		}

		const seen: Array< { hasSavedGeometry: boolean; callerPinned: boolean } > = [];
		hooks.addFilter(
			HOOKS.WINDOW_GEOMETRY,
			'vitest/geometry-saved',
			( ( geometry: unknown, ctx: unknown ) => {
				seen.push( ctx as { hasSavedGeometry: boolean; callerPinned: boolean } );
				return geometry;
			} ) as ( ...a: unknown[] ) => unknown,
		);

		await manager.open( openConfig( 'restoreme' ) );

		try {
			window.localStorage.removeItem( STORAGE_KEY );
		} catch {
			/* jsdom */
		}

		expect( seen ).toHaveLength( 1 );
		expect( seen[ 0 ].hasSavedGeometry ).toBe( true );
		expect( seen[ 0 ].callerPinned ).toBe( false );
		const win = manager.getById( 'restoreme' );
		expect( win!.config.width ).toBe( 700 );
		expect( win!.config.height ).toBe( 500 );
	} );

	test( 'WINDOW_GEOMETRY filter — multiple subscribers chain in priority order', async () => {
		hooks.addFilter(
			HOOKS.WINDOW_GEOMETRY,
			'vitest/geometry-first',
			( ( geometry: unknown ) => ( {
				...( geometry as Record< string, unknown > ),
				width: 500,
			} ) ) as ( ...a: unknown[] ) => unknown,
			5, // earlier priority
		);
		hooks.addFilter(
			HOOKS.WINDOW_GEOMETRY,
			'vitest/geometry-second',
			( ( geometry: unknown ) => {
				const g = geometry as { width: number };
				// Sees the upstream filter's value, doubles it.
				return { ...g, width: g.width * 2 };
			} ) as ( ...a: unknown[] ) => unknown,
			10,
		);

		await manager.open( openConfig( 'chain' ) );

		const win = manager.getById( 'chain' );
		expect( win!.config.width ).toBe( 1000 );
	} );

	test( 'focusing a different window auto-exits the prior window from fullscreen', async () => {
		const a = await manager.open( openConfig( 'a' ) );
		const b = await manager.open( openConfig( 'b' ) );
		manager.focus( a );
		a.toggleFullscreen();
		expect( a.isFullscreen() ).toBe( true );

		manager.focus( b );

		expect( a.isFullscreen() ).toBe( false );
	} );

	test( 'opening a new window auto-exits a fullscreen prior window', async () => {
		const a = await manager.open( openConfig( 'a' ) );
		a.toggleFullscreen();
		expect( a.isFullscreen() ).toBe( true );

		await manager.open( openConfig( 'b' ) );

		expect( a.isFullscreen() ).toBe( false );
	} );

	test( 'restoring a minimized window auto-exits a fullscreen prior window', async () => {
		const a = await manager.open( openConfig( 'a' ) );
		const b = await manager.open( openConfig( 'b' ) );
		b.minimize();
		manager.focus( a );
		a.toggleFullscreen();
		expect( a.isFullscreen() ).toBe( true );

		b.restore();

		expect( a.isFullscreen() ).toBe( false );
	} );

	test( 'WINDOW_AUTO_EXIT_FULLSCREEN filter can veto the auto-exit', async () => {
		hooks.addFilter(
			HOOKS.WINDOW_AUTO_EXIT_FULLSCREEN,
			'vitest/keep-fullscreen',
			( () => false ) as ( ...a: unknown[] ) => unknown,
		);

		const a = await manager.open( openConfig( 'a' ) );
		const b = await manager.open( openConfig( 'b' ) );
		manager.focus( a );
		a.toggleFullscreen();
		expect( a.isFullscreen() ).toBe( true );

		manager.focus( b );

		expect( a.isFullscreen() ).toBe( true );
	} );

	test( 'WINDOW_AUTO_EXIT_FULLSCREEN filter receives { windowId, focusedTo }', async () => {
		const seen: Array< { windowId: string; focusedTo: string } > = [];
		hooks.addFilter(
			HOOKS.WINDOW_AUTO_EXIT_FULLSCREEN,
			'vitest/inspect-ctx',
			( ( shouldExit: unknown, ctx: unknown ) => {
				seen.push( ctx as { windowId: string; focusedTo: string } );
				return shouldExit;
			} ) as ( ...a: unknown[] ) => unknown,
		);

		const a = await manager.open( openConfig( 'a' ) );
		const b = await manager.open( openConfig( 'b' ) );
		manager.focus( a );
		a.toggleFullscreen();
		seen.length = 0;

		manager.focus( b );

		expect( seen ).toHaveLength( 1 );
		expect( seen[ 0 ] ).toEqual( { windowId: 'a', focusedTo: 'b' } );
	} );
} );
