/**
 * OpenStation — Agents: faces in the browser.
 *
 * The shell's half of the face system. PHP writes each agent's portrait
 * to disk so `get_avatar()` has a URL; this draws one on the spot, for
 * the two places a URL is no use:
 *
 *   - the picker, where twelve candidates have to appear the instant
 *     someone presses shuffle, and a round trip per press would take
 *     the fun out of the one control in the flow that has any;
 *   - the backfill, because an agent that predates faces has a seed and
 *     no look, and rolling one is `randomMioLook()`'s job.
 *
 * Everything imported here is Pixi-free and DOM-free by design, which
 * is what lets the WP Explorer bundle draw Mio without the simulation:
 * `portrait` pulls in `shape`, `chroma` and `config`, and nothing in
 * that graph touches the renderer.
 */

import { mioPortraitDataUri } from '../mio/portrait';
import { mulberry32, randomMioLook } from '../mio/randomize';
import type { MioLook } from './agents-types';

/** How many candidates a shuffle puts in front of someone. */
export const FACE_CANDIDATES = 12;

/**
 * Roll the face a seed stands for.
 *
 * The same seed always gives the same face, which is the whole point:
 * an agent's portrait is derived, and one that changed on every paint
 * would not be a character.
 */
export function faceFromSeed( seed: number ): MioLook {
	const look = randomMioLook( mulberry32( seed ) );
	return {
		appearance: look.appearance as Record< string, unknown >,
		physics: look.physics as Record< string, unknown >,
	};
}

/**
 * A strip of candidate faces, starting at `seed`.
 *
 * Consecutive seeds rather than random ones, so "shuffle" is a
 * position rather than a throw: pressing it twice and going back is a
 * subtraction, and the strip someone liked can be returned to.
 */
export function faceCandidates(
	seed: number,
	count: number = FACE_CANDIDATES,
): { seed: number; look: MioLook }[] {
	return Array.from( { length: count }, ( _, i ) => ( {
		seed: seed + i,
		look: faceFromSeed( seed + i ),
	} ) );
}

/**
 * A face as an image source.
 *
 * A data URI rather than inline markup: each one is its own document,
 * so the ids inside cannot collide with a neighbour's. Inlining twelve
 * portraits that share an id renders twelve copies of the first, which
 * is a silent failure rather than a loud one.
 */
export function faceSrc( look: MioLook | null, size: number ): string {
	return mioPortraitDataUri( ( look ?? {} ) as never, size );
}

/**
 * Whether an agent has a face of its own yet.
 *
 * An empty look means "nobody chose one", and the avatar falls back to
 * the glyph every agent wore before faces existed.
 */
export function hasFace( look: MioLook | null | undefined ): boolean {
	if ( ! look ) {
		return false;
	}
	return (
		Object.keys( look.appearance ?? {} ).length > 0 ||
		Object.keys( look.physics ?? {} ).length > 0
	);
}
