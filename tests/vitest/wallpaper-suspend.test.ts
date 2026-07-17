/**
 * Suspend/resume tests for WallpaperLayer.
 *
 * Covers the `wp.desktop.wallpaper` surface added for games:
 *   - refcounted reasons (same reason held twice, distinct reasons)
 *   - effective-visibility re-emission (suspend wins over a visible tab)
 *   - the frozen-frame overlay lifecycle (insert, hide live canvas,
 *     remove on resume, clear on wallpaper switch)
 *   - wallpapers applied while suspended mount paused
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { WallpaperLayer } from '../../src/wallpapers/layer';
import type { CanvasWallpaperDef, CssWallpaperDef } from '../../src/wallpapers/types';
import {
	clearHooksStub,
	installHooksStub,
	recordActions,
	type FakeWpHooks,
} from './helpers/hooks-stub';

const SUSPEND = 'desktop-mode.wallpaper.suspend';
const VISIBILITY = 'desktop-mode.wallpaper.visibility';

describe( 'WallpaperLayer — suspend/resume', () => {
	let hooks: FakeWpHooks;
	let element: HTMLElement;
	let layer: WallpaperLayer;

	beforeEach( () => {
		hooks = installHooksStub();
		element = document.createElement( 'div' );
		document.body.appendChild( element );
		layer = new WallpaperLayer( element, 'http://example.test/plugin' );
		// jsdom has no 2D context; give the overlay capture a stub so
		// the happy-path tests exercise the full insert/remove flow.
		vi.spyOn( HTMLCanvasElement.prototype, 'getContext' ).mockReturnValue( {
			drawImage: () => undefined,
		} as unknown as CanvasRenderingContext2D );
	} );

	afterEach( () => {
		layer.dispose();
		element.remove();
		clearHooksStub();
		vi.restoreAllMocks();
	} );

	const canvasDef = (): CanvasWallpaperDef => ( {
		id: 'cnv',
		label: 'Canvas',
		type: 'canvas',
		preview: '#000',
		mount: ( container ) => {
			const canvas = document.createElement( 'canvas' );
			canvas.width = 320;
			canvas.height = 200;
			container.appendChild( canvas );
			return () => undefined;
		},
	} );

	const cssDef = (): CssWallpaperDef => ( {
		id: 'plain',
		label: 'Plain',
		type: 'css',
		value: '#123',
		preview: '#123',
	} );

	const mountCanvas = async (): Promise< void > => {
		layer.apply( canvasDef() );
		await Promise.resolve();
	};

	test( 'suspend fires the suspend action and hidden visibility', async () => {
		await mountCanvas();
		const log = recordActions( hooks, [ SUSPEND, VISIBILITY ] );

		layer.suspend( 'game:a' );

		expect( layer.isSuspended() ).toBe( true );
		const names = log.map( ( e ) => e.name );
		expect( names ).toEqual( [ SUSPEND, VISIBILITY ] );
		expect( log[ 0 ].args[ 0 ] ).toEqual( {
			id: 'cnv',
			suspended: true,
			reasons: [ 'game:a' ],
		} );
		expect( log[ 1 ].args[ 0 ] ).toEqual( { id: 'cnv', state: 'hidden' } );
	} );

	test( 'resume of the last reason restores visible', async () => {
		await mountCanvas();
		layer.suspend( 'game:a' );
		const log = recordActions( hooks, [ SUSPEND, VISIBILITY ] );

		layer.resume( 'game:a' );

		expect( layer.isSuspended() ).toBe( false );
		expect( log.map( ( e ) => e.name ) ).toEqual( [ SUSPEND, VISIBILITY ] );
		expect( log[ 0 ].args[ 0 ] ).toEqual( {
			id: 'cnv',
			suspended: false,
			reasons: [],
		} );
		expect( log[ 1 ].args[ 0 ] ).toEqual( { id: 'cnv', state: 'visible' } );
	} );

	test( 'two distinct reasons — resuming one keeps the layer suspended', async () => {
		await mountCanvas();
		layer.suspend( 'game:a' );
		layer.suspend( 'game:b' );
		const log = recordActions( hooks, [ SUSPEND, VISIBILITY ] );

		layer.resume( 'game:a' );

		expect( layer.isSuspended() ).toBe( true );
		// No transition — nothing re-fires until the last reason drops.
		expect( log ).toEqual( [] );

		layer.resume( 'game:b' );
		expect( layer.isSuspended() ).toBe( false );
	} );

	test( 'same reason held twice needs two resumes', async () => {
		await mountCanvas();
		layer.suspend( 'game:a' );
		layer.suspend( 'game:a' );

		layer.resume( 'game:a' );
		expect( layer.isSuspended() ).toBe( true );

		layer.resume( 'game:a' );
		expect( layer.isSuspended() ).toBe( false );
	} );

	test( 'resume of an unknown reason is a no-op', async () => {
		await mountCanvas();
		const log = recordActions( hooks, [ SUSPEND, VISIBILITY ] );

		layer.resume( 'never-held' );

		expect( log ).toEqual( [] );
		expect( layer.isSuspended() ).toBe( false );
	} );

	test( 'visibilitychange while suspended keeps reporting hidden', async () => {
		await mountCanvas();
		layer.suspend( 'game:a' );
		const log = recordActions( hooks, [ VISIBILITY ] );

		// Tab is visible (jsdom default: document.hidden === false), but
		// the held reason must win.
		document.dispatchEvent( new Event( 'visibilitychange' ) );

		expect( log ).toHaveLength( 1 );
		expect( log[ 0 ].args[ 0 ] ).toEqual( { id: 'cnv', state: 'hidden' } );
	} );

	test( 'suspend inserts the freeze overlay and hides the live canvas', async () => {
		await mountCanvas();
		const live = element.querySelector( 'canvas' ) as HTMLCanvasElement;

		layer.suspend( 'game:a' );

		const overlay = element.querySelector( '.desktop-mode-wallpaper-freeze' );
		expect( overlay ).not.toBeNull();
		expect( live.style.visibility ).toBe( 'hidden' );

		layer.resume( 'game:a' );

		expect( element.querySelector( '.desktop-mode-wallpaper-freeze' ) ).toBeNull();
		expect( live.style.visibility ).toBe( '' );
	} );

	test( 'capture failure skips the overlay but still suspends', async () => {
		await mountCanvas();
		( HTMLCanvasElement.prototype.getContext as unknown as {
			mockReturnValue: ( v: unknown ) => void;
		} ).mockReturnValue( null );

		layer.suspend( 'game:a' );

		expect( element.querySelector( '.desktop-mode-wallpaper-freeze' ) ).toBeNull();
		expect( layer.isSuspended() ).toBe( true );
	} );

	test( 'switching wallpaper while suspended clears the stale overlay', async () => {
		await mountCanvas();
		layer.suspend( 'game:a' );
		expect( element.querySelector( '.desktop-mode-wallpaper-freeze' ) ).not.toBeNull();

		layer.apply( cssDef() );

		expect( element.querySelector( '.desktop-mode-wallpaper-freeze' ) ).toBeNull();
		// The reason is still held; a later canvas mount stays paused.
		expect( layer.isSuspended() ).toBe( true );
	} );

	test( 'a canvas applied while suspended mounts paused', async () => {
		layer.suspend( 'game:a' );
		const log = recordActions( hooks, [ VISIBILITY ] );

		await mountCanvas();

		expect( log ).toHaveLength( 1 );
		expect( log[ 0 ].args[ 0 ] ).toEqual( { id: 'cnv', state: 'hidden' } );
	} );
} );
