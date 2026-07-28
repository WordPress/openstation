/**
 * Tests for the stage texture source's idle-paint skipping.
 *
 * The stage asks the browser to re-record the shell every frame, which
 * is not negotiable — an iframe scrolling off the main thread would
 * otherwise let the desktop silently stop updating. Uploading the result
 * every frame IS negotiable, and at a 2× device pixel ratio on a 1440p
 * display it is roughly 850 MB/s of identical pixels.
 */
import { beforeEach, describe, expect, test } from 'vitest';
import { createStageSource } from '../../src/stage/element-source';

/** Records every paint the real `HTMLSource` would have acted on. */
let accepted: unknown[] = [];

class FakeHTMLSource {
	public constructor( public options: Record< string, unknown > ) {}
	public _onPaint( event: unknown ): void {
		accepted.push( event );
	}
}

const pixi = { HTMLSource: FakeHTMLSource };

/**
 * A `paint` event naming the elements that changed.
 *
 * @param changed The changed-children list, or nothing at all.
 */
function paint( changed?: unknown[] ) {
	return undefined === changed ? {} : { changedElements: changed };
}

describe( 'createStageSource', () => {
	beforeEach( () => {
		accepted = [];
	} );

	test( 'passes its options straight through to HTMLSource', () => {
		const source = createStageSource( pixi, { autoUpdate: true } );
		expect( ( source as unknown as FakeHTMLSource ).options ).toEqual( {
			autoUpdate: true,
		} );
	} );

	test( 'never skips the first paint, whatever it reports', () => {
		// The base class flips its own ready flag in `_onPaint`, and a
		// source that is never ready is never uploaded at all — a black
		// desktop rather than a stale one.
		const source = createStageSource( pixi, {} );
		( source as { _onPaint( e: unknown ): void } )._onPaint( paint( [] ) );

		expect( accepted ).toHaveLength( 1 );
		expect( source.stats ).toEqual( { paints: 1, uploads: 1, skipped: 0 } );
	} );

	test( 'skips uploads for paints where nothing changed', () => {
		const source = createStageSource( pixi, {} ) as unknown as {
			_onPaint( e: unknown ): void;
			stats: { paints: number; uploads: number; skipped: number };
		};
		source._onPaint( paint( [ 'shell' ] ) );
		source._onPaint( paint( [] ) );
		source._onPaint( paint( [] ) );

		// The recorded pixels are identical to the ones already on the
		// GPU; re-sending a full-screen texture buys nothing.
		expect( accepted ).toHaveLength( 1 );
		expect( source.stats ).toEqual( { paints: 3, uploads: 1, skipped: 2 } );
	} );

	test( 'uploads again as soon as something changes', () => {
		const source = createStageSource( pixi, {} ) as unknown as {
			_onPaint( e: unknown ): void;
			stats: { uploads: number };
		};
		source._onPaint( paint( [ 'shell' ] ) );
		source._onPaint( paint( [] ) );
		source._onPaint( paint( [ 'shell' ] ) );

		expect( source.stats.uploads ).toBe( 2 );
	} );

	test( 'uploads when the browser reports no list at all', () => {
		// Absent is not the same as empty: it means the browser did not
		// say, and guessing "nothing changed" from silence is how a
		// desktop freezes.
		const source = createStageSource( pixi, {} ) as unknown as {
			_onPaint( e: unknown ): void;
			stats: { uploads: number };
		};
		source._onPaint( paint( [ 'shell' ] ) );
		source._onPaint( paint() );
		source._onPaint( paint() );

		expect( source.stats.uploads ).toBe( 3 );
	} );

	test( 'never skips more than a bounded run in a row', () => {
		const source = createStageSource( pixi, {} ) as unknown as {
			_onPaint( e: unknown ): void;
			stats: { paints: number; uploads: number; skipped: number };
		};
		source._onPaint( paint( [ 'shell' ] ) );

		let longestRun = 0;
		let run = 0;
		for ( let i = 0; i < 200; i++ ) {
			const before = source.stats.uploads;
			source._onPaint( paint( [] ) );
			if ( source.stats.uploads === before ) {
				run++;
				longestRun = Math.max( longestRun, run );
			} else {
				run = 0;
			}
		}

		/*
		 * The skip is a bet that an empty list really means identical
		 * pixels. If that bet is ever wrong the desktop freezes — the
		 * very failure the per-frame repaint exists to prevent — so a
		 * wrong bet has to cost staleness measured in frames rather than
		 * forever.
		 */
		expect( longestRun ).toBeLessThanOrEqual( 30 );
		expect( source.stats.uploads ).toBeGreaterThan( 1 );
		// And the books balance.
		expect( source.stats.paints ).toBe(
			source.stats.uploads + source.stats.skipped,
		);
	} );

	test( 'the heartbeat resets after real activity', () => {
		const source = createStageSource( pixi, {} ) as unknown as {
			_onPaint( e: unknown ): void;
			stats: { uploads: number };
		};
		source._onPaint( paint( [ 'shell' ] ) );
		for ( let i = 0; i < 20; i++ ) {
			source._onPaint( paint( [] ) );
		}
		source._onPaint( paint( [ 'shell' ] ) );
		for ( let i = 0; i < 20; i++ ) {
			source._onPaint( paint( [] ) );
		}

		// Neither run of 20 reaches the heartbeat, so only the two real
		// changes uploaded.
		expect( source.stats.uploads ).toBe( 2 );
	} );

	test( '`skipIdlePaints: false` uploads on every paint', () => {
		// The live window sources opt out of the skip entirely: content
		// inside a window's iframe (a playing video) can change without
		// the canvas's changedElements ever saying so, and a "live"
		// texture that freezes between heartbeats defeats its purpose.
		const source = createStageSource( pixi, {
			skipIdlePaints: false,
		} ) as unknown as {
			_onPaint( e: unknown ): void;
			stats: { paints: number; uploads: number; skipped: number };
		};
		source._onPaint( paint( [ 'window' ] ) );
		for ( let i = 0; i < 10; i++ ) {
			source._onPaint( paint( [] ) );
		}

		expect( source.stats ).toEqual( {
			paints: 11,
			uploads: 11,
			skipped: 0,
		} );
	} );

	test( 'detachPaintListener unhooks the canvas paint event', () => {
		// A demoted window's element is no longer a direct child of the
		// canvas, so one more upload would throw inside the browser's
		// paint event — where the stage counts errors toward shutting
		// the whole canvas down. Detaching must use the exact bound
		// listener the vendored HTMLSource registered.
		const removed: unknown[] = [];
		const canvas = {
			removeEventListener: ( type: string, listener: unknown ) => {
				removed.push( [ type, listener ] );
			},
		};
		const bound = () => undefined;
		const source = createStageSource( pixi, {} ) as unknown as {
			canvas?: unknown;
			_onPaintBound?: unknown;
			detachPaintListener(): void;
		};
		source.canvas = canvas;
		source._onPaintBound = bound;

		source.detachPaintListener();

		expect( removed ).toEqual( [ [ 'paint', bound ] ] );

		// And it is safe to call with no canvas at all.
		source.canvas = null;
		expect( () => source.detachPaintListener() ).not.toThrow();
	} );
} );
