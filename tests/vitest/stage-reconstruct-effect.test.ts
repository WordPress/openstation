/**
 * Tests for the "Reconstruct" open effect — the window assembling
 * itself out of scattered tiles.
 *
 * The animation itself is a matter of taste, but three things about it
 * are contracts: every tile ends on the square it belongs in, the effect
 * resolves rather than running forever, and the tile count stays bounded
 * however the density slider is set.
 */
import { describe, expect, test } from 'vitest';
import { reconstructEffect } from '../../src/stage/window-fx/effects/reconstruct';
import type { WindowEffectRunContext } from '../../src/stage/window-fx/types';

interface FakeTile {
	x: number;
	y: number;
	alpha: number;
	rotation: number;
	scale: { set( v: number ): void; value: number };
}

/**
 * Minimal PixiJS stand-ins plus a manually driven ticker.
 *
 * @param rect The window rectangle the effect is handed.
 */
function scene( rect = { x: 100, y: 50, width: 320, height: 240 } ) {
	const tiles: Array< FakeTile & { frame: unknown } > = [];
	const steps: Array< ( t: { deltaMS: number } ) => void > = [];

	class FakeSprite {
		public x = 0;
		public y = 0;
		public alpha = 1;
		public rotation = 0;
		public scale = {
			value: 1,
			set: ( v: number ) => {
				this.scale.value = v;
			},
		};
		public constructor( public texture: { frame?: unknown } ) {}
	}

	const pixi = {
		Rectangle: class {
			public constructor(
				public x: number,
				public y: number,
				public width: number,
				public height: number,
			) {}
		},
		Texture: class {
			public frame: unknown;
			public constructor( opts: { source: unknown; frame: unknown } ) {
				this.frame = opts.frame;
			}
		},
		Sprite: FakeSprite,
	};

	const layer = {
		addChild: ( child: unknown ) => {
			tiles.push( child as FakeTile & { frame: unknown } );
			return child;
		},
	};

	const controller = new AbortController();
	const ctx = {
		pixi,
		transition: 'open',
		params: { duration: 600, density: 8, spread: 300, spin: 2 },
		sprite: { alpha: 1, destroyed: false },
		texture: { source: {} },
		layer,
		from: rect,
		element: document.createElement( 'div' ),
		ticker: {
			add: ( fn: ( t: { deltaMS: number } ) => void ) => steps.push( fn ),
			remove: ( fn: ( t: { deltaMS: number } ) => void ) => {
				const i = steps.indexOf( fn );
				if ( i !== -1 ) {
					steps.splice( i, 1 );
				}
			},
		},
		signal: controller.signal,
	} as unknown as WindowEffectRunContext;

	return {
		ctx,
		controller,
		tiles,
		/**
		 * Advance the animation.
		 *
		 * @param ms Milliseconds, delivered in 16 ms frames.
		 */
		advance( ms: number ): void {
			for ( let t = 0; t < ms; t += 16 ) {
				for ( const step of [ ...steps ] ) {
					step( { deltaMS: 16 } );
				}
			}
		},
		running: () => steps.length > 0,
	};
}

describe( 'reconstruct effect', () => {
	test( 'is offered for open only', () => {
		// Reconstruction is an arrival. A window that assembles itself on
		// minimise and then flies to the dock is two ideas fighting.
		expect( reconstructEffect.transitions ).toEqual( [ 'open' ] );
	} );

	test( 'reports its own duration so the engine can size the transition', () => {
		expect( reconstructEffect.durationMs?.( { duration: 750 } ) ).toBe( 750 );
	} );

	test( 'hides the intact copy — the tiles ARE the window', async () => {
		const s = scene();
		reconstructEffect.run( s.ctx );
		expect( s.ctx.sprite.alpha ).toBe( 0 );
		s.controller.abort();
		s.advance( 16 );
	} );

	test( 'starts every tile scattered and transparent', () => {
		const s = scene();
		reconstructEffect.run( s.ctx );

		expect( s.tiles.length ).toBeGreaterThan( 1 );
		expect( s.tiles.every( ( t ) => t.alpha === 0 ) ).toBe( true );

		// Somewhere other than where they belong — otherwise there is
		// nothing to reconstruct.
		const inPlace = s.tiles.filter(
			( t ) => t.x >= 100 && t.x <= 420 && t.y >= 50 && t.y <= 290,
		);
		expect( inPlace.length ).toBeLessThan( s.tiles.length );

		s.controller.abort();
		s.advance( 16 );
	} );

	test( 'every tile lands on its own square, and the effect resolves', async () => {
		const s = scene();
		const done = reconstructEffect.run( s.ctx );

		// Past the duration plus the sweep delay.
		s.advance( 1400 );
		await done;

		expect( s.running() ).toBe( false );

		// The grid: 8 tiles across the longer edge of a 320×240 window,
		// so 40 px cells laid out from the window's origin.
		for ( const tile of s.tiles ) {
			expect( ( tile.x - 100 ) % 40 ).toBeCloseTo( 0, 4 );
			expect( ( tile.y - 50 ) % 40 ).toBeCloseTo( 0, 4 );
			expect( tile.alpha ).toBe( 1 );
			expect( tile.rotation ).toBeCloseTo( 0, 6 );
			expect( tile.scale.value ).toBeCloseTo( 1, 6 );
		}
	} );

	test( 'caps the tile count however high the density goes', () => {
		const s = scene( { x: 0, y: 0, width: 3000, height: 2000 } );
		( s.ctx.params as Record< string, number > ).density = 40;
		reconstructEffect.run( s.ctx );

		// Every tile is a quad on a desktop already compositing itself
		// through a shader chain.
		expect( s.tiles.length ).toBeLessThanOrEqual( 1600 );

		s.controller.abort();
		s.advance( 16 );
	} );

	test( 'stops when the engine aborts it', async () => {
		const s = scene();
		const done = reconstructEffect.run( s.ctx );
		s.advance( 100 );
		s.controller.abort();
		s.advance( 16 );
		await done;
		expect( s.running() ).toBe( false );
	} );
} );
