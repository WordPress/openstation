/**
 * The Living Tree — deterministic PRNG.
 *
 * The single randomness source the morphology layer is allowed to touch.
 * `seed = hash32( siteUrl + '|' + installEpoch )` then
 * `mulberry32( seed )` gives a reproducible stream so the same site draws
 * the same skeleton on every load, while different sites diverge. See
 * `docs/living-tree-algorithm.md` §A.2.
 *
 * These two functions are fully implemented (not stubs) — the
 * determinism they provide is load-bearing and directly unit-tested.
 */

/* eslint-disable no-bitwise -- FNV-1a and mulberry32 are defined in terms of
   32-bit XOR / shift / OR; bitwise operators are intrinsic to the algorithms,
   not a stylistic choice. The WP preset disallows them by default. */

/**
 * FNV-1a 32-bit hash of a string. Cheap, well-distributed, and stable
 * across environments — the same input always yields the same unsigned
 * 32-bit integer.
 *
 * @param input String to hash (e.g. `siteUrl + '|' + installEpoch`).
 * @return Unsigned 32-bit hash.
 */
export function hash32( input: string ): number {
	let h = 0x811c9dc5;
	for ( let i = 0; i < input.length; i++ ) {
		h ^= input.charCodeAt( i );
		// 32-bit FNV prime multiply via Math.imul to stay in int32.
		h = Math.imul( h, 0x01000193 );
	}
	return h >>> 0;
}

/**
 * Mulberry32 — a compact, fast, statistically-decent 32-bit PRNG. Given a
 * seed it returns a generator producing floats in `[0, 1)`. Deterministic:
 * the same seed always yields the same sequence.
 *
 * @param seed Unsigned 32-bit seed (typically from {@link hash32}).
 * @return A function returning the next float in `[0, 1)`.
 */
export function mulberry32( seed: number ): () => number {
	let a = seed >>> 0;
	return function next(): number {
		a = ( a + 0x6d2b79f5 ) | 0;
		let t = Math.imul( a ^ ( a >>> 15 ), 1 | a );
		t = ( t + Math.imul( t ^ ( t >>> 7 ), 61 | t ) ) ^ t;
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;
	};
}
