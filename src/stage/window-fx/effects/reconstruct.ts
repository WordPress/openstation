/**
 * Desktop Mode — "Reconstruct" window effect.
 *
 * The window assembles itself. Its pixels arrive as a scatter of tiles
 * flung in from all over the desktop, spinning and half-transparent,
 * each settling onto the square it belongs in until the window is whole.
 *
 * The mirror image of the Vanish dissolve, and built the same way: the
 * frozen capture is sliced into a grid of sub-textures sharing one
 * source, and each becomes a sprite with its own start point, spin and
 * delay. What differs is the direction of time — every tile eases from
 * its scattered start to its true position rather than away from it, and
 * the per-tile delay sweeps across the window so it knits together from
 * one edge instead of snapping into place all at once.
 *
 * Open only. Reconstruction is an arrival; a window that assembles
 * itself on minimise and then flies to the dock is two ideas fighting.
 *
 * **Depends on the capture correction.** A window is announced in the
 * same synchronous block that created it, so at that instant it has
 * never been painted and the stage's snapshot holds the wallpaper that
 * was behind it. The engine repaints the texture a frame later
 * (`NEEDS_FRESH_SNAPSHOT` in `../engine.ts`) and keeps the stand-in
 * hidden until it has; without that, this effect would faithfully
 * assemble a rectangle of wallpaper.
 *
 * @since 0.9.8
 */

import { __ } from '../../../i18n';
import type { WindowEffectDef, WindowEffectRunContext } from '../types';

/** Hard ceiling on tiles, whatever the density slider says. */
const MAX_TILES = 1600;

interface Tile {
	sprite: {
		x: number;
		y: number;
		alpha: number;
		rotation: number;
		scale: { set( v: number ): void };
	};
	/** Where it comes from. */
	startX: number;
	startY: number;
	/** Where it belongs. */
	endX: number;
	endY: number;
	spin: number;
	/** Seconds before this tile starts moving. */
	delay: number;
}

export const reconstructEffect: WindowEffectDef = {
	id: 'reconstruct',
	label: __( 'Reconstruct' ),
	description: __(
		'The window assembles itself from tiles flying in from across the desktop.',
	),
	transitions: [ 'open' ],
	params: [
		{
			key: 'duration',
			label: __( 'Duration' ),
			min: 300,
			max: 2000,
			step: 50,
			default: 750,
			suffix: 'ms',
		},
		{
			key: 'density',
			label: __( 'Tile density' ),
			min: 6,
			max: 40,
			step: 1,
			// Lower than the dissolve's: a tile has to be big enough to
			// read as a piece of the window while it flies, or the whole
			// thing looks like static rather than reassembly.
			default: 18,
		},
		{
			key: 'spread',
			label: __( 'Spread' ),
			min: 50,
			max: 1200,
			step: 25,
			// How far out the tiles start. Generous by default — pieces
			// drifting in from just outside the frame reads as a wobble,
			// not as reconstruction.
			default: 420,
			suffix: 'px',
		},
		{
			key: 'spin',
			label: __( 'Spin' ),
			min: 0,
			max: 6,
			step: 0.25,
			default: 2.5,
		},
	],

	durationMs( params ) {
		return params.duration;
	},

	run( ctx: WindowEffectRunContext ) {
		const { pixi, sprite, texture, layer, shadow, from, ticker, params } =
			ctx;
		const { Rectangle, Sprite, Texture } = pixi;

		// The engine's sprite is the intact window; the tiles ARE the
		// window here, so it must not sit underneath them fully formed.
		sprite.alpha = 0;

		// Which also means the engine has let go of the shadow. A window
		// that is not there yet casts no shadow, so it starts at nothing
		// and comes up with the assembly.
		if ( shadow ) {
			shadow.alpha = 0;
		}

		// Square cells, sized so the longer edge carries `density` of
		// them. Keeps tiles square regardless of window aspect.
		const longest = Math.max( from.width, from.height );
		const cell = Math.max( 4, Math.round( longest / params.density ) );
		const cols = Math.max( 1, Math.ceil( from.width / cell ) );
		const rows = Math.max( 1, Math.ceil( from.height / cell ) );

		const tiles: Tile[] = [];
		const budget = Math.min( MAX_TILES, cols * rows );
		// Sample evenly when the grid exceeds the budget, so a huge
		// window thins out instead of only assembling its top-left.
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
				// A frame outside the texture is not worth abandoning the
				// whole assembly for; skip the cell.
				continue;
			}

			const endX = from.x + col * cell;
			const endY = from.y + row * cell;

			/*
			 * Deterministic pseudo-random scatter.
			 *
			 * `Math.random()` would do, but deriving from the cell index
			 * keeps a reconstruction reproducible frame to frame under a
			 * paused ticker — and, more usefully, makes a bug reportable:
			 * the same window always assembles the same way.
			 *
			 * Two independent hashes so the horizontal and vertical
			 * offsets do not correlate; sharing one produced tiles strung
			 * out along a diagonal.
			 */
			const hashA = ( ( col * 73 + row * 151 ) % 101 ) / 101;
			const hashB = ( ( col * 197 + row * 31 ) % 103 ) / 103;
			const angle = hashA * Math.PI * 2;
			// Square-rooted so tiles spread evenly over the area rather
			// than bunching near the centre.
			const distance = params.spread * Math.sqrt( hashB );

			piece.x = endX + Math.cos( angle ) * distance;
			piece.y = endY + Math.sin( angle ) * distance;
			piece.alpha = 0;
			layer.addChild( piece );

			tiles.push( {
				sprite: piece as unknown as Tile[ 'sprite' ],
				startX: piece.x,
				startY: piece.y,
				endX,
				endY,
				spin: ( hashA - 0.5 ) * 2 * params.spin,
				// Sweep across the window so it knits together from one
				// edge rather than snapping into place at once.
				delay: ( col / Math.max( 1, cols - 1 ) ) * 0.3 + hashB * 0.12,
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
				// The tiles are children of this effect's own container,
				// which the engine destroys whole — freeing them here
				// would race that teardown.
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

				// Bring the shadow up with the assembly rather than at the
				// end: arriving all at once on the last frame would be the
				// very pop this shadow exists to prevent.
				if ( shadow ) {
					shadow.alpha = Math.min( 1, elapsed / total );
				}

				let settled = true;
				for ( const tile of tiles ) {
					const local = elapsed - tile.delay;
					if ( local <= 0 ) {
						settled = false;
						continue;
					}
					const p = Math.min( 1, local / total );
					if ( p < 1 ) {
						settled = false;
					}
					// Ease out cubic: pieces come in fast and decelerate
					// onto their square, which is what makes them look
					// placed rather than dropped.
					const eased = 1 - Math.pow( 1 - p, 3 );

					tile.sprite.x = tile.startX + ( tile.endX - tile.startX ) * eased;
					tile.sprite.y = tile.startY + ( tile.endY - tile.startY ) * eased;
					tile.sprite.rotation = tile.spin * ( 1 - eased );
					// Fade in faster than they travel, so the window reads
					// as solid slightly before the last pieces land.
					tile.sprite.alpha = Math.min( 1, eased * 1.6 );
					tile.sprite.scale.set( 1 + ( 1 - eased ) * 0.35 );
				}

				if ( settled ) {
					finish();
				}
			};

			ticker.add( step );
		} );
	},
};
