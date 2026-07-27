/**
 * Desktop Mode — "Vanish" window effect: the Thanos dissolve.
 *
 * The window comes apart into a drift of particles that blow up and to
 * the right, fading as they go. Close only — it is a disintegration, and
 * a window that disintegrates on minimise then comes back is nonsense.
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

interface Particle {
	sprite: {
		x: number;
		y: number;
		alpha: number;
		rotation: number;
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
}

export const thanosEffect: WindowEffectDef = {
	id: 'vanish',
	label: __( 'Vanish' ),
	description: __(
		'The window disintegrates into drifting dust and blows away.',
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
				for ( const p of particles ) {
					try {
						p.sprite.destroy();
					} catch {
						// The layer teardown will collect it regardless.
					}
				}
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
