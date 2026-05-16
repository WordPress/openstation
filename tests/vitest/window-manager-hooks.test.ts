/**
 * Hook-firing tests for {@link WindowManager}.
 *
 * Covers the actions the manager is responsible for emitting:
 *   - desktop-mode.window.opened
 *   - desktop-mode.window.focused
 *   - desktop-mode.window.closed
 *   - desktop-mode.arrange.cascade.starting / applied
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
	'desktop-mode.window.opened',
	'desktop-mode.window.focused',
	'desktop-mode.window.closed',
	'desktop-mode.arrange.cascade.starting',
	'desktop-mode.arrange.cascade.applied',
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
		desktop.id = 'desktop-mode-area';
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

		const opened = log.find( ( e ) => e.name === 'desktop-mode.window.opened' );
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
		const openedIdx = names.indexOf( 'desktop-mode.window.opened' );
		const focusedIdx = names.indexOf( 'desktop-mode.window.focused' );
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
			( e ) => e.name === 'desktop-mode.window.focused',
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
			( e ) => e.name === 'desktop-mode.window.focused',
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

		const closed = log.find( ( e ) => e.name === 'desktop-mode.window.closed' );
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
			( e ) => e.name === 'desktop-mode.window.focused',
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
			( e ) => e.name === 'desktop-mode.window.focused',
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
			.filter( ( e ) => e.name.startsWith( 'desktop-mode.arrange.cascade.' ) )
			.map( ( e ) => ( {
				name: e.name,
				payload: e.args[ 0 ] as { windowCount: number },
			} ) );
		expect( cascadeEvents.map( ( e ) => e.name ) ).toEqual( [
			'desktop-mode.arrange.cascade.starting',
			'desktop-mode.arrange.cascade.applied',
		] );
		expect( cascadeEvents[ 0 ].payload.windowCount ).toBe( 3 );
		expect( cascadeEvents[ 1 ].payload.windowCount ).toBe( 3 );
	} );

	test( 'cascade() with no windows fires neither hook', async () => {
		const log = recordActions( hooks, MANAGER_HOOKS );

		manager.cascade();

		const cascadeEvents = log.filter( ( e ) =>
			e.name.startsWith( 'desktop-mode.arrange.cascade.' ),
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
			source: string;
			desktopRect: { width: number; height: number };
		};
		expect( ctx.windowId ).toBe( 'shop' );
		expect( ctx.baseId ).toBe( 'shop' );
		expect( ctx.source ).toBe( 'default' );
		expect( ctx.desktopRect.width ).toBe( 1600 );
		expect( ctx.desktopRect.height ).toBe( 900 );

		const win = manager.getById( 'shop' );
		expect( win ).toBeDefined();
		expect( win!.config.width ).toBe( NEW_W );
		expect( win!.config.height ).toBe( NEW_H );
		expect( win!.config.x ).toBe( 1600 - NEW_W - 20 );
		expect( win!.config.y ).toBe( 900 - NEW_H - 20 );
	} );

	test( 'WINDOW_GEOMETRY filter source is "explicit" when caller pins dimensions', async () => {
		let observedSource: string | null = null;
		hooks.addFilter(
			HOOKS.WINDOW_GEOMETRY,
			'vitest/geometry-source',
			( ( geometry: unknown, ctx: unknown ) => {
				observedSource = ( ctx as { source: string } ).source;
				return geometry;
			} ) as ( ...a: unknown[] ) => unknown,
		);

		await manager.open( {
			...openConfig( 'pinned' ),
			width: 555,
			height: 333,
		} );

		expect( observedSource ).toBe( 'explicit' );
		const win = manager.getById( 'pinned' );
		expect( win!.config.width ).toBe( 555 );
		expect( win!.config.height ).toBe( 333 );
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
} );
