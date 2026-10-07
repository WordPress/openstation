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
	'os.wallpaper.mounting',
	'os.wallpaper.mounted',
	'os.wallpaper.unmounting',
	'os.wallpaper.mount-failed',
] as const;

describe( 'WallpaperLayer — hook firing', () => {
	let hooks: FakeWpHooks;
	let element: HTMLElement;
	let layer: WallpaperLayer;

	beforeEach( () => {
		hooks = installHooksStub();

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

		await Promise.resolve();

		const names = log.map( ( entry ) => entry.name );
		expect( names ).toEqual( [
			'os.wallpaper.mounting',
			'os.wallpaper.mounted',
		] );
	} );

	test( 'mounting payload carries id + container + ctx', () => {
		const log = recordActions( hooks, WALLPAPER_HOOKS );

		layer.apply(
			canvasDef( () => () => undefined ),
		);

		const mounting = log.find(
			( e ) => e.name === 'os.wallpaper.mounting',
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
			log.some( ( e ) => e.name === 'os.wallpaper.unmounting' ),
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

		await Promise.resolve();

		const names = log.map( ( e ) => e.name );
		expect( names ).toContain( 'os.wallpaper.mount-failed' );
		expect( names ).not.toContain( 'os.wallpaper.mounted' );
	} );

	test( 'async mount rejection fires mount-failed with the error payload', async () => {
		const log = recordActions( hooks, WALLPAPER_HOOKS );
		const err = new Error( 'network down' );

		layer.apply(
			canvasDef( () => Promise.reject( err ) ),
		);

		await Promise.resolve();
		await Promise.resolve();

		const failed = log.find(
			( e ) => e.name === 'os.wallpaper.mount-failed',
		);
		expect( failed ).toBeDefined();
		const payload = failed!.args[ 0 ] as { id: string; error: unknown };
		expect( payload.id ).toBe( 'cnv' );
		expect( payload.error ).toBe( err );
	} );

	test( 'rapid switch discards the stale mount (no mounted hook for it)', async () => {

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

		layer.apply( cssDef() );

		const log = recordActions( hooks, WALLPAPER_HOOKS );
		slowResolve!();
		await Promise.resolve();
		await Promise.resolve();

		expect(
			log.some( ( e ) => e.name === 'os.wallpaper.mounted' ),
		).toBe( false );
	} );
} );
