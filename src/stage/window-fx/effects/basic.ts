/**
 * Desktop Mode — the everyday window transition effects.
 *
 * Three small ones that between them cover every transition:
 *
 * - **Scale & fade** — grows in, shrinks out. The safe default, and the
 *   only one offered for focus/blur, where anything showier becomes
 *   tiresome within a minute of normal clicking.
 * - **Genie** — squeezes toward the dock on minimise and back out on
 *   restore, using the destination rect the engine supplies.
 * - **Morph** — slides and stretches between the old and new geometry
 *   on maximise/unmaximise.
 *
 * Each one animates the frozen sprite the engine hands over; none of
 * them touches the DOM. See `../types.ts` for why that is.
 *
 * @since 0.9.8
 */

import { __ } from '../../../i18n';
import type { WindowEffectDef, WindowEffectRunContext } from '../types';

/**
 * Drive a normalised 0→1 progress value over `durationMs`, resolving at
 * the end. Every effect here is a different `onFrame`, so the ticker
 * bookkeeping lives once.
 *
 * @param ctx        Run context, for the ticker and abort signal.
 * @param durationMs How long to run.
 * @param onFrame    Called each frame with eased progress in 0..1.
 */
function animate(
	ctx: WindowEffectRunContext,
	durationMs: number,
	onFrame: ( progress: number ) => void,
): Promise< void > {
	return new Promise< void >( ( resolve ) => {
		let elapsed = 0;
		let finished = false;

		const finish = (): void => {
			if ( finished ) {
				return;
			}
			finished = true;
			ctx.ticker.remove( step );
			resolve();
		};

		const step = ( t: { deltaMS: number } ): void => {
			if ( ctx.signal.aborted ) {
				finish();
				return;
			}
			elapsed += t.deltaMS;
			const linear = Math.min( 1, elapsed / Math.max( 1, durationMs ) );
			// easeOutCubic — quick to start, settles gently.
			onFrame( 1 - Math.pow( 1 - linear, 3 ) );
			if ( linear >= 1 ) {
				finish();
			}
		};

		ctx.ticker.add( step );
	} );
}

/** `true` for transitions where the window is arriving rather than leaving. */
function isIncoming( transition: string ): boolean {
	return (
		transition === 'open' ||
		transition === 'restore' ||
		transition === 'focus' ||
		transition === 'unmaximize'
	);
}

export const scaleFadeEffect: WindowEffectDef = {
	id: 'scale-fade',
	label: __( 'Scale & fade' ),
	description: __( 'Grow in and shrink out from the window’s centre.' ),
	transitions: [
		'open',
		'close',
		'minimize',
		'restore',
		'maximize',
		'unmaximize',
		'focus',
		'blur',
	],
	params: [
		{
			key: 'duration',
			label: __( 'Duration' ),
			min: 80,
			max: 900,
			step: 10,
			default: 220,
			suffix: 'ms',
		},
		{
			key: 'scale',
			label: __( 'Scale' ),
			min: 0,
			max: 1,
			step: 0.01,
			// How far from full size the animation starts or ends. 0.9
			// is a nudge; 0 collapses to nothing.
			default: 0.88,
		},
	],

	durationMs( params ) {
		return params.duration;
	},

	run( ctx ) {
		const { sprite, from, params } = ctx;
		const incoming = isIncoming( ctx.transition );

		// Scale about the centre without disturbing layout: Pixi scales
		// from the origin, so the position is corrected each frame.
		return animate( ctx, params.duration, ( p ) => {
			const t = incoming ? p : 1 - p;
			const scale = params.scale + ( 1 - params.scale ) * t;
			sprite.scale.set( scale );
			sprite.alpha = t;
			sprite.x = from.x + ( from.width * ( 1 - scale ) ) / 2;
			sprite.y = from.y + ( from.height * ( 1 - scale ) ) / 2;
		} );
	},
};

export const genieEffect: WindowEffectDef = {
	id: 'genie',
	label: __( 'Genie' ),
	description: __( 'Squeeze down to the dock and back out again.' ),
	transitions: [ 'minimize', 'restore' ],
	params: [
		{
			key: 'duration',
			label: __( 'Duration' ),
			min: 120,
			max: 1200,
			step: 20,
			default: 380,
			suffix: 'ms',
		},
	],

	durationMs( params ) {
		return params.duration;
	},

	run( ctx ) {
		const { sprite, from, to, params } = ctx;
		// Without a destination the engine could not tell us where the
		// dock tile is; fall back to collapsing in place rather than
		// flying to an arbitrary corner.
		const target = to ?? {
			x: from.x + from.width / 2,
			y: from.y + from.height,
			width: 0,
			height: 0,
		};
		const incoming = ctx.transition === 'restore';

		return animate( ctx, params.duration, ( p ) => {
			const t = incoming ? 1 - p : p;
			sprite.x = from.x + ( target.x - from.x ) * t;
			sprite.y = from.y + ( target.y - from.y ) * t;
			sprite.scale.set(
				from.width > 0
					? 1 - t * ( 1 - Math.max( 0.02, target.width / from.width ) )
					: 1 - t,
				from.height > 0
					? 1 - t * ( 1 - Math.max( 0.02, target.height / from.height ) )
					: 1 - t,
			);
			sprite.alpha = 1 - t * 0.85;
		} );
	},
};

export const morphEffect: WindowEffectDef = {
	id: 'morph',
	label: __( 'Morph' ),
	description: __( 'Stretch between the old and new window size.' ),
	transitions: [ 'maximize', 'unmaximize' ],
	params: [
		{
			key: 'duration',
			label: __( 'Duration' ),
			min: 80,
			max: 800,
			step: 10,
			default: 240,
			suffix: 'ms',
		},
	],

	durationMs( params ) {
		return params.duration;
	},

	run( ctx ) {
		const { sprite, from, to, params } = ctx;
		if ( ! to ) {
			// Nothing to morph towards — a plain fade beats a jump.
			return animate( ctx, params.duration, ( p ) => {
				sprite.alpha = 1 - p;
			} );
		}

		return animate( ctx, params.duration, ( p ) => {
			sprite.x = from.x + ( to.x - from.x ) * p;
			sprite.y = from.y + ( to.y - from.y ) * p;
			sprite.scale.set(
				from.width > 0
					? 1 + ( to.width / from.width - 1 ) * p
					: 1,
				from.height > 0
					? 1 + ( to.height / from.height - 1 ) * p
					: 1,
			);
			// Fade out at the end — the real window reappears underneath
			// at its new geometry, so a hard cut would flash.
			sprite.alpha = 1 - Math.pow( p, 3 );
		} );
	},
};
