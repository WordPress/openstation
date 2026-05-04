/**
 * Hook-firing tests for WallpaperLayer.
 *
 * Asserts that the wallpaper lifecycle actions fire at the correct
 * moments AND with the expected payload shape. Covers:
 *   - desktop-mode.wallpaper.mounting (pre-mount)
 *   - desktop-mode.wallpaper.mounted (post-successful-mount)
 *   - desktop-mode.wallpaper.unmounting (teardown of the active canvas)
 *   - desktop-mode.wallpaper.mount-failed (sync / async mount errors)
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { WallpaperLayer } from '../../src/wallpapers/layer';
import type {
	CanvasWallpaperDef,
	CssWallpaperDef,
} from '../../src/wallpapers/types';
import {
	clearHooksStub,
	installHooksStub,
	recordActions,
	type FakeWpHooks,
} from './helpers/hooks-stub';

const WALLPAPER_HOOKS = [
	'desktop-mode.wallpaper.mounting',
	'desktop-mode.wallpaper.mounted',
	'desktop-mode.wallpaper.unmounting',
	'desktop-mode.wallpaper.mount-failed',
] as const;

describe( 'WallpaperLayer — hook firing', () => {
	let hooks: FakeWpHooks;
	let element: HTMLElement;
	let layer: WallpaperLayer;

	beforeEach( () => {
		hooks = installHooksStub();
		// A detached element is fine — `WallpaperLayer` only manipulates
		// its own DOM + the shell's `#desktop-mode-shell` CSS var. We
		// don't need the full shell markup for lifecycle tests.
		element = document.createElement( 'div' );
		document.body.appendChild( element );
		layer = new WallpaperLayer( element, 'http://example.test/plugin' );
	} );

	afterEach( () => {
		layer.dispose();
		element.remove();
		clearHooksStub();
	} );

	const cssDef = (): CssWallpaperDef => ( {
		id: 'plain',
		label: 'Plain',
		type: 'css',
		value: '#123',
		preview: '#123',
	} );

	const canvasDef = (
		mount: CanvasWallpaperDef[ 'mount' ],
	): CanvasWallpaperDef => ( {
		id: 'cnv',
		label: 'Canvas',
		type: 'canvas',
		preview: '#000',
		mount,
	} );

	test( 'CSS wallpapers fire no lifecycle hooks', () => {
		const log = recordActions( hooks, WALLPAPER_HOOKS );

		layer.apply( cssDef() );

		expect( log ).toEqual( [] );
	} );

	test( 'canvas apply fires mounting then mounted in order', async () => {
		const log = recordActions( hooks, WALLPAPER_HOOKS );

		layer.apply(
			canvasDef( ( container ) => {
				container.appendChild( document.createElement( 'canvas' ) );
				return () => undefined;
			} ),
		);
		// Mount resolves on the microtask queue (Promise.resolve path).
		await Promise.resolve();

		const names = log.map( ( entry ) => entry.name );
		expect( names ).toEqual( [
			'desktop-mode.wallpaper.mounting',
			'desktop-mode.wallpaper.mounted',
		] );
	} );

	test( 'mounting payload carries id + container + ctx', () => {
		const log = recordActions( hooks, WALLPAPER_HOOKS );

		layer.apply(
			canvasDef( () => () => undefined ),
		);

		const mounting = log.find(
			( e ) => e.name === 'desktop-mode.wallpaper.mounting',
		);
		expect( mounting ).toBeDefined();
		const payload = mounting!.args[ 0 ] as {
			id: string;
			container: HTMLElement;
			ctx: { id: string; pluginUrl: string };
		};
		expect( payload.id ).toBe( 'cnv' );
		expect( payload.container ).toBe( element );
		expect( payload.ctx.id ).toBe( 'cnv' );
		expect( payload.ctx.pluginUrl ).toBe( 'http://example.test/plugin' );
	} );

	test( 'swapping canvas → css fires unmounting for the old canvas', async () => {
		let teardownCalled = false;
		layer.apply(
			canvasDef( () => {
				return () => {
					teardownCalled = true;
				};
			} ),
		);
		await Promise.resolve();

		const log = recordActions( hooks, WALLPAPER_HOOKS );

		layer.apply( cssDef() );

		expect(
			log.some( ( e ) => e.name === 'desktop-mode.wallpaper.unmounting' ),
		).toBe( true );
		expect( teardownCalled ).toBe( true );
	} );

	test( 'mount throwing synchronously fires mount-failed, not mounted', async () => {
		const log = recordActions( hooks, WALLPAPER_HOOKS );

		layer.apply(
			canvasDef( () => {
				throw new Error( 'boom' );
			} ),
		);
		// `apply()` kicks mount via `depsReady.then(...)`, so even a
		// synchronous throw inside `mount` is observed one microtask
		// later. Drain the queue before asserting.
		await Promise.resolve();

		const names = log.map( ( e ) => e.name );
		expect( names ).toContain( 'desktop-mode.wallpaper.mount-failed' );
		expect( names ).not.toContain( 'desktop-mode.wallpaper.mounted' );
	} );

	test( 'async mount rejection fires mount-failed with the error payload', async () => {
		const log = recordActions( hooks, WALLPAPER_HOOKS );
		const err = new Error( 'network down' );

		layer.apply(
			canvasDef( () => Promise.reject( err ) ),
		);
		// Microtask queue drain.
		await Promise.resolve();
		await Promise.resolve();

		const failed = log.find(
			( e ) => e.name === 'desktop-mode.wallpaper.mount-failed',
		);
		expect( failed ).toBeDefined();
		const payload = failed!.args[ 0 ] as { id: string; error: unknown };
		expect( payload.id ).toBe( 'cnv' );
		expect( payload.error ).toBe( err );
	} );

	test( 'rapid switch discards the stale mount (no mounted hook for it)', async () => {
		// Slow mount — resolves after we've already kicked off a
		// second apply. The shell's generation counter should make
		// the slow one clean up silently without ever emitting
		// `mounted`.
		let slowResolve: ( () => void ) | null = null;
		const slowPromise = new Promise<void>( ( res ) => {
			slowResolve = res;
		} );

		layer.apply(
			canvasDef( async () => {
				await slowPromise;
				return () => undefined;
			} ),
		);
		// Switch to CSS before the slow mount resolves.
		layer.apply( cssDef() );

		const log = recordActions( hooks, WALLPAPER_HOOKS );
		slowResolve!();
		await Promise.resolve();
		await Promise.resolve();

		// Recording starts AFTER the switch-away — if the stale mount
		// did leak a `mounted`, it would show up here. It shouldn't.
		expect(
			log.some( ( e ) => e.name === 'desktop-mode.wallpaper.mounted' ),
		).toBe( false );
	} );
} );
