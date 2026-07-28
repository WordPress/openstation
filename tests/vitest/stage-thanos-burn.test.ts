/**
 * Tests for the "Vanish" dissolve's burn tint.
 *
 * The exact colours are taste; what is contract is the SHAPE of the
 * burn: flecks start untinted, brown before they grey (scorch while
 * still solid, ash as they thin), land on a smoky grey, and a burn
 * strength of zero leaves the dissolve exactly as it was before the
 * feature existed.
 */
import { describe, expect, test } from 'vitest';
import { thanosEffect } from '../../src/stage/window-fx/effects/thanos';
import type { WindowEffectRunContext } from '../../src/stage/window-fx/types';

interface FakeParticle {
	x: number;
	y: number;
	alpha: number;
	rotation: number;
	tint: number;
	scale: { set( v: number ): void };
}

function channels( tint: number ): [ number, number, number ] {
	return [ ( tint >> 16 ) & 0xff, ( tint >> 8 ) & 0xff, tint & 0xff ];
}

/**
 * Minimal PixiJS stand-ins plus a manually driven ticker.
 *
 * @param burn The burn slider value for the run.
 */
function scene( burn: number ) {
	const particles: FakeParticle[] = [];
	const steps: Array< ( t: { deltaMS: number } ) => void > = [];

	class FakeSprite {
		public x = 0;
		public y = 0;
		public alpha = 1;
		public rotation = 0;
		public tint = 0xffffff;
		public scale = {
			set: () => undefined,
		};
		public constructor( public texture: unknown ) {}
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
			public constructor( public opts: unknown ) {}
		},
		Sprite: FakeSprite,
	};

	const controller = new AbortController();
	const ctx = {
		pixi,
		transition: 'close',
		params: { duration: 600, density: 8, drift: 160, rise: 90, burn },
		sprite: { alpha: 1, destroyed: false },
		texture: { source: {} },
		layer: {
			addChild: ( child: unknown ) => {
				particles.push( child as FakeParticle );
				return child;
			},
		},
		from: { x: 100, y: 50, width: 320, height: 240 },
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
		particles,
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
	};
}

/** The first particle has zero jitter and zero delay — it burns first. */
function firstFleck( s: ReturnType< typeof scene > ): FakeParticle {
	return s.particles[ 0 ];
}

describe( 'vanish burn tint', () => {
	test( 'flecks brown before they grey', () => {
		const s = scene( 1 );
		void thanosEffect.run( s.ctx );

		// Early: scorching. Warm bias — red above green above blue —
		// and already off white.
		s.advance( 96 );
		const early = channels( firstFleck( s ).tint );
		expect( early[ 0 ] ).toBeLessThan( 255 );
		expect( early[ 0 ] ).toBeGreaterThan( early[ 1 ] );
		expect( early[ 1 ] ).toBeGreaterThan( early[ 2 ] );
		const earlySpread = early[ 0 ] - early[ 2 ];

		// Late: ash. Much darker, and the channels pull together —
		// grey is the absence of the scorch's warmth.
		s.advance( 400 );
		const late = channels( firstFleck( s ).tint );
		expect( late[ 0 ] ).toBeLessThan( early[ 0 ] );
		expect( late[ 0 ] - late[ 2 ] ).toBeLessThan( earlySpread );
		expect( late[ 0 ] - late[ 2 ] ).toBeLessThanOrEqual( 12 );
	} );

	test( 'the char completes while the fleck is still visible', () => {
		// The ramp finishes at 60% of the particle's life so the ash
		// colour is seen on solid pixels, not spent on transparent ones.
		const s = scene( 1 );
		void thanosEffect.run( s.ctx );

		s.advance( 400 );
		const fleck = firstFleck( s );
		const atSixty = fleck.tint;
		expect( fleck.alpha ).toBeGreaterThan( 0 );

		s.advance( 100 );
		expect( fleck.tint ).toBe( atSixty );
	} );

	test( 'burn strength zero leaves the dissolve untinted', () => {
		const s = scene( 0 );
		void thanosEffect.run( s.ctx );

		s.advance( 500 );
		for ( const p of s.particles ) {
			expect( p.tint ).toBe( 0xffffff );
		}
	} );

	test( 'ships a burn slider so users can turn it off', () => {
		const burn = thanosEffect.params?.find( ( p ) => p.key === 'burn' );
		expect( burn ).toBeDefined();
		expect( burn?.min ).toBe( 0 );
		expect( burn?.max ).toBe( 1 );
	} );
} );
