/**
 * Desktop Mode — "Vanish" window effect: the Thanos dissolve.
 *
 * The window comes apart into a drift of particles that blow up and to
 * the right, charring as they go — each fleck tints from its natural
 * colour through scorched brown into smoky ash-grey while it fades, so
 * the dissolve reads as burning rather than evaporating. Close only —
 * it is a disintegration, and a window that disintegrates on minimise
 * then comes back is nonsense.
 *
 * **How it works.** The engine hands over a frozen texture of the
 * window (see `../types.ts` for why freezing rather than reparenting).
 * That texture is sliced into a grid of small square sub-textures, each
 * becoming one particle sprite with its own drift, spin and delay. The
 * delay is weighted by horizontal position, so the window dissolves from
 * one edge across rather than all at once — which is what makes it read
 * as disintegration instead of a puff.
 *
 * Particle count is `density²`, capped, because every particle is a quad
 * and the whole point is that this stays smooth on a desktop that is
 * already rendering itself through a shader chain.
 *
 * @since 0.9.8
 */

import { __ } from '../../../i18n';
import type { WindowEffectDef, WindowEffectRunContext } from '../types';

/** Hard ceiling on particles, whatever the density slider says. */
const MAX_PARTICLES = 1600;

/**
 * The burn ramp's two stops, as `[r, g, b]`.
 *
 * A particle chars from its natural colour through scorched brown into
 * smoky ash-grey. Tint in PixiJS is multiplicative, so these darken
 * whatever pixel they land on rather than painting over it — a white
 * window browns, a dark one just smoulders, which is exactly how
 * burning treats paper versus ink.
 */
const SCORCH: readonly [ number, number, number ] = [ 0x8a, 0x62, 0x40 ];
const ASH: readonly [ number, number, number ] = [ 0x70, 0x6b, 0x67 ];

/** Where along the burn the scorch gives way to ash, 0..1. */
const SCORCH_POINT = 0.4;

/**
 * The multiplicative tint for a particle at `progress` through its
 * burn, scaled by `strength` (0 = untinted, 1 = the full ramp).
 *
 * Piecewise linear: white → {@link SCORCH} over the first
 * {@link SCORCH_POINT} of the burn, then → {@link ASH} for the rest —
 * the browning happens while the particle is still solid, the greying
 * as it thins into smoke.
 *
 * @param progress How far through the burn, 0..1.
 * @param strength How hard to lean into the ramp, 0..1.
 * @return A 24-bit RGB tint.
 */
function burnTint( progress: number, strength: number ): number {
	let target: readonly [ number, number, number ];
	let k: number;
	if ( progress < SCORCH_POINT ) {
		target = SCORCH;
		k = progress / SCORCH_POINT;
		// White → scorch: interpolate from 255 toward the stop.
		return rgb(
			255 + ( target[ 0 ] - 255 ) * k * strength,
			255 + ( target[ 1 ] - 255 ) * k * strength,
			255 + ( target[ 2 ] - 255 ) * k * strength,
		);
	}
	k = ( progress - SCORCH_POINT ) / ( 1 - SCORCH_POINT );
	// Scorch → ash, each still eased back toward white by strength.
	return rgb(
		255 + ( SCORCH[ 0 ] + ( ASH[ 0 ] - SCORCH[ 0 ] ) * k - 255 ) * strength,
		255 + ( SCORCH[ 1 ] + ( ASH[ 1 ] - SCORCH[ 1 ] ) * k - 255 ) * strength,
		255 + ( SCORCH[ 2 ] + ( ASH[ 2 ] - SCORCH[ 2 ] ) * k - 255 ) * strength,
	);
}

function rgb( r: number, g: number, b: number ): number {
	// Arithmetic rather than shifts — the WP lint config bans bitwise
	// operators, and 0..255 channels cannot overflow either way.
	return Math.round( r ) * 0x10000 + Math.round( g ) * 0x100 + Math.round( b );
}

interface Particle {
	sprite: {
		x: number;
		y: number;
		alpha: number;
		rotation: number;
		tint: number;
		scale: { set( v: number ): void };
		destroy(): void;
	};
	/** Horizontal drift, px/s. */
	vx: number;
	/** Vertical drift, px/s — negative rises. */
	vy: number;
	spin: number;
	/** Seconds before this particle starts moving. */
	delay: number;
	startX: number;
	startY: number;
	/** This particle's burn strength, 0..1 — the slider, jittered. */
	burn: number;
}

export const thanosEffect: WindowEffectDef = {
	id: 'vanish',
	label: __( 'Vanish' ),
	description: __(
		'The window chars and disintegrates into drifting ash that blows away.',
	),
	transitions: [ 'close' ],
	params: [
		{
			key: 'duration',
			label: __( 'Duration' ),
			min: 300,
			max: 2000,
			step: 50,
			default: 900,
			suffix: 'ms',
		},
		{
			key: 'density',
			label: __( 'Particle density' ),
			min: 8,
			max: 40,
			step: 1,
			default: 24,
		},
		{
			key: 'drift',
			label: __( 'Drift' ),
			min: 20,
			max: 400,
			step: 10,
			default: 160,
			suffix: 'px/s',
		},
		{
			key: 'rise',
			label: __( 'Rise' ),
			min: 0,
			max: 300,
			step: 10,
			default: 90,
			suffix: 'px/s',
		},
		{
			key: 'burn',
			label: __( 'Burn' ),
			min: 0,
			max: 1,
			step: 0.05,
			// How hard the particles char as they go — 0 keeps the old
			// untinted dissolve, 1 is full scorched-brown-to-ash.
			default: 0.85,
		},
	],

	durationMs( params ) {
		return params.duration;
	},

	run( ctx: WindowEffectRunContext ) {
		const { pixi, sprite, texture, layer, from, ticker, params } = ctx;
		const { Rectangle, Sprite, Texture } = pixi;

		// The engine's sprite is the intact window; the particles replace
		// it, so hide it rather than leaving a solid copy underneath.
		sprite.alpha = 0;

		// Square cells, sized so the longer edge carries `density` of
		// them. Keeps particles square regardless of window aspect.
		const longest = Math.max( from.width, from.height );
		const cell = Math.max( 4, Math.round( longest / params.density ) );
		const cols = Math.max( 1, Math.ceil( from.width / cell ) );
		const rows = Math.max( 1, Math.ceil( from.height / cell ) );

		const particles: Particle[] = [];
		const budget = Math.min( MAX_PARTICLES, cols * rows );
		// Sample evenly when the grid exceeds the budget, so a huge
		// window thins out instead of dissolving only its top-left.
		const stride = Math.max( 1, Math.round( ( cols * rows ) / budget ) );

		for ( let index = 0; index < cols * rows; index += stride ) {
			const col = index % cols;
			const row = Math.floor( index / cols );
			const w = Math.min( cell, from.width - col * cell );
			const h = Math.min( cell, from.height - row * cell );
			if ( w <= 0 || h <= 0 ) {
				continue;
			}

			let piece;
			try {
				piece = new Sprite(
					new Texture( {
						source: texture.source,
						frame: new Rectangle( col * cell, row * cell, w, h ),
					} ),
				);
			} catch {
				// A frame outside the texture is not worth aborting the
				// whole dissolve for; skip the cell.
				continue;
			}

			piece.x = from.x + col * cell;
			piece.y = from.y + row * cell;
			layer.addChild( piece );

			// Deterministic pseudo-random spread. Math.random() would do,
			// but deriving from the cell index keeps a dissolve
			// reproducible frame to frame under a paused ticker.
			const jitter = ( ( col * 73 + row * 151 ) % 100 ) / 100;
			const across = col / Math.max( 1, cols - 1 );

			particles.push( {
				sprite: piece as unknown as Particle[ 'sprite' ],
				vx: params.drift * ( 0.55 + jitter * 0.9 ),
				vy: -params.rise * ( 0.4 + jitter ),
				spin: ( jitter - 0.5 ) * 4,
				// Sweep across the window: the far edge goes first.
				delay: across * 0.45 + jitter * 0.08,
				startX: piece.x,
				startY: piece.y,
				// A fire chars unevenly: some flecks blacken, others
				// escape half-singed. ±15% around the slider's value,
				// from the same deterministic jitter as the drift.
				burn:
					params.burn *
					Math.min( 1, 0.85 + jitter * 0.3 ),
			} );
		}

		const total = params.duration / 1000;

		return new Promise< void >( ( resolve ) => {
			let elapsed = 0;
			let finished = false;

			const finish = (): void => {
				if ( finished ) {
					return;
				}
				finished = true;
				ticker.remove( step );
				// The particles are children of this effect's own
				// container, which the engine destroys whole — freeing
				// them here would race that teardown.
				resolve();
			};

			const step = ( t: { deltaMS: number } ): void => {
				// See `basic.ts`: a destroyed sprite throws inside the
				// ticker and takes every other listener down with it.
				if (
					ctx.signal.aborted ||
					( sprite as { destroyed?: boolean } ).destroyed === true
				) {
					finish();
					return;
				}
				elapsed += t.deltaMS / 1000;

				for ( const p of particles ) {
					const local = elapsed - p.delay;
					if ( local <= 0 ) {
						continue;
					}
					// Ease out: fast off the mark, drifting to a stop.
					const eased = 1 - Math.pow( 1 - Math.min( 1, local / total ), 2 );
					p.sprite.x = p.startX + p.vx * eased * total;
					p.sprite.y = p.startY + p.vy * eased * total;
					p.sprite.rotation = p.spin * eased;
					p.sprite.alpha = Math.max( 0, 1 - local / total );
					p.sprite.scale.set( Math.max( 0.05, 1 - eased * 0.5 ) );
					// Char faster than the fade: fully burnt by 60% of
					// the particle's life, so the scorch is seen while
					// the fleck is still solid rather than arriving on
					// pixels that are already transparent.
					if ( p.burn > 0 ) {
						p.sprite.tint = burnTint(
							Math.min( 1, local / ( total * 0.6 ) ),
							p.burn,
						);
					}
				}

				// The sweep delay means the last particles start late, so
				// run past the nominal duration to let them finish.
				if ( elapsed >= total + 0.5 ) {
					finish();
				}
			};

			ticker.add( step );
		} );
	},
};
