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

import { MIO_DEFAULTS } from './config';
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
	const outlineWidth = round( between( 2, 7 ), 0.5 );

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
			outlineWidth,
			// Derived from the ring rather than rolled, for two
			// reasons. The line only looks right in proportion to the
			// chroma beside it — a hairline inside a 7px ring reads as
			// a mistake — and a draw taken here would shift every
			// number after it, which would re-roll the face of every
			// agent that has a seed and no portrait yet. The shipped
			// Mio splits its ring two to one, so a random one does
			// too; and it is never `0`, because a Mio without the line
			// is a coloured edge rather than a lit tube.
			linerWidth: Math.max( 1, round( outlineWidth / 2, 0.5 ) ),
			// Starlight, for the reason the eyes are: the brand has one
			// white and a randomizer with a second opinion about it is
			// just a way to ship an off-white line.
			linerColor: MIO_DEFAULTS.appearance.linerColor,
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
			// The body stays Void far more often than not — it is what
			// the ring is legible against.
			bodyColor: chance( 0.25 )
				? randomInk( random )
				: MIO_DEFAULTS.appearance.bodyColor,
			bodyAlpha: chance( 0.2 ) ? round( between( 0.78, 1 ), 0.01 ) : 1,
			// Starlight. The eyes are the one thing the randomizer
			// never touches, so they may as well be the brand's white
			// rather than a second opinion about it.
			eyeColor: MIO_DEFAULTS.appearance.eyeColor,
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

/**
 * A seeded random source, for looks that have to come back the same.
 *
 * {@link randomMioLook} takes its randomness as a parameter precisely
 * so it can be driven by something other than `Math.random`. Agents
 * need that: a face is stored, but it is also derived, and an agent
 * whose portrait changed every time the page painted would not be a
 * character.
 *
 * Mulberry32, chosen because it is four lines and its whole state is
 * one 32-bit integer, so a seed can live in an integer meta row and
 * PHP can hold the same value without either side agreeing on a
 * float format.
 *
 * @param seed Any integer. `0` is a legitimate seed.
 */
export function mulberry32( seed: number ): () => number {
	/* eslint-disable no-bitwise -- A PRNG is bit arithmetic; written
	 * any other way this is neither this algorithm nor fast. */
	let a = seed >>> 0;
	return (): number => {
		a = ( a + 0x6d2b79f5 ) >>> 0;
		let t = a;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;
	};
	/* eslint-enable no-bitwise */
}
