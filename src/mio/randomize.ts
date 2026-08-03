/**
 * OpenStation — "Surprise me": a random Mio that is still a Mio.
 *
 * The button next to "Restore Mio" in the style panel. Pure, seeded by
 * an injectable `random()`, and deliberately kept out of the panel
 * module so the interesting half — *which* randomness is allowed — can
 * be asserted in a test rather than eyeballed.
 *
 * **A randomizer is a taste filter, not a dice roll.** Uniform noise
 * across every slider produces a grey, dim, seam-ridden thing roughly
 * nine times in ten, and a user who presses the button twice and gets
 * two of those concludes the feature is broken rather than that they
 * were unlucky. So every range here is narrowed to the part of the
 * space that still reads as the companion:
 *
 *   - **The hue is free, the rest is not.** Any hue on the wheel is a
 *     legitimate Mio; a desaturated, half-lit one is not.
 *   - **The gradient always loops.** `hueLoop` is what keeps the sweep
 *     meeting itself around the ring, and a random look with a colour
 *     seam in it is just a bug the user asked for.
 *   - **Upright, always.** `shapeAngle` stays at `0`. A random rotation
 *     is the fastest way to make a carefully authored silhouette read
 *     as broken — an upside-down heart is not a variation, it is a
 *     mistake.
 *   - **The shuffle is not touched.** Whether Mio changes shape on its
 *     own is a decision the user made in the panel; a randomizer that
 *     silently switched it back on would be overriding them.
 */

import type { MioLook, MioShapePreset } from './types';

/**
 * Silhouettes "Surprise me" draws from.
 *
 * `custom` is absent for the same reason the shuffle leaves it out: it
 * is a shape someone configured on purpose. `circle` is absent for a
 * different one — it is the *only* preset with nothing to look at, and
 * a randomizer that lands on "no shape" has wasted the press.
 */
const RANDOM_SHAPES: readonly MioShapePreset[] = [
	'blob',
	'ghost',
	'potato',
	'star',
	'flower',
	'heart',
	'diamond',
	'drop',
	'cloud',
];

/**
 * Build a random look.
 *
 * @param random Source of randomness, `[0, 1)`. Injectable so tests
 *               can pin the extremes instead of sampling and hoping.
 */
export function randomMioLook( random: () => number = Math.random ): MioLook {
	const between = ( lo: number, hi: number ): number => lo + random() * ( hi - lo );
	const chance = ( p: number ): boolean => random() < p;
	const pick = < T >( list: readonly T[] ): T =>
		list[ Math.floor( random() * list.length ) % list.length ];
	const round = ( value: number, step: number ): number =>
		Math.round( value / step ) * step;

	// A span under about 50° is two shades of one colour rather than a
	// gradient; over about 220° the sweep wraps far enough round the
	// wheel to come back to where it started.
	const span = round( between( 55, 215 ), 1 ) * ( chance( 0.5 ) ? 1 : -1 );

	return {
		appearance: {
			hueStart: round( between( 0, 360 ), 1 ),
			hueSpan: span,
			hueAngle: round( between( 0, 360 ), 1 ),
			// Never off: see the module header.
			hueLoop: true,
			// Mostly still, like the official Mio. When it does move it
			// moves slowly — a ring visibly chasing itself is a novelty
			// that wears off in about a minute.
			hueSpin: chance( 0.25 ) ? round( between( -14, 14 ), 1 ) : 0,
			hueDrift: chance( 0.15 ) ? round( between( -8, 8 ), 1 ) : 0,
			saturation: round( between( 0.68, 1 ), 0.01 ),
			lightness: round( between( 0.52, 0.78 ), 0.01 ),
			outlineWidth: round( between( 2, 7 ), 0.5 ),
			// Bracketing the shipped `10`, roughly two thirds of a
			// radius to two and a half. Below that the ring reads as
			// drawn rather than lit; above it the wash starts competing
			// with the wallpaper, and a randomizer that can hand you
			// one of those is a randomizer people stop pressing.
			glow: round( between( 4, 16 ), 0.1 ),
			// Two thirds of the time this is the flat artwork ring; the
			// rest of the time it is the hologram, at a strength that
			// still leaves the hues recognisable.
			iridescence: chance( 0.34 ) ? round( between( 0.45, 1.25 ), 0.05 ) : 0,
			// The body stays black far more often than not — it is what
			// the ring is legible against.
			bodyColor: chance( 0.25 ) ? randomInk( random ) : 0x000000,
			bodyAlpha: chance( 0.2 ) ? round( between( 0.78, 1 ), 0.01 ) : 1,
			eyeColor: 0xffffff,
			eyeScale: round( between( 0.2, 0.42 ), 0.01 ),
		},
		physics: {
			shapePreset: pick( RANDOM_SHAPES ),
			shapeAmount: round( between( 0.7, 1.15 ), 0.05 ),
			// Upright, always: see the module header.
			shapeAngle: 0,
			// Alive, but never twitchy: the top of the range is a
			// companion that looks like it is shivering.
			idleWobble: round( between( 0.03, 0.16 ), 0.005 ),
			idleWobbleSpeed: round( between( 0.35, 1.1 ), 0.05 ),
		},
	};
}

/**
 * A very dark, slightly coloured body — ink rather than paint.
 *
 * Kept to a sixth of full brightness per channel, so whatever it lands
 * on still reads as "black with a cast" and the ring still has
 * something to be bright against.
 */
function randomInk( random: () => number ): number {
	const channel = (): number => Math.floor( random() * 42 );
	/* eslint-disable-next-line no-bitwise -- Pixi takes colours as
	 * packed 24-bit ints; this is the native representation. */
	return ( channel() << 16 ) | ( channel() << 8 ) | channel();
}
