/**
 * Alphabet Soup — daily seeds.
 *
 * The whole point of the soup: every player worldwide gets the SAME
 * puzzle on the same day. The seed is the current date formatted
 * `dd-mm-yyyy`; Time Attack plays a different (but equally shared)
 * pot by suffixing the mode, and every wave derives its own RNG
 * stream from the run seed so wave N is identical for everyone no
 * matter how many random draws earlier waves consumed.
 *
 * Pure — fully unit-tested. The deterministic PRNG primitives
 * (`hash32` FNV-1a + `mulberry32`) are the repo-standard pair from
 * the living-tree wallpaper.
 *
 * @since 0.9.8
 */

import {
	hash32,
	mulberry32,
} from '../../plugins/living-tree-wallpaper/rng';
import type { SoupMode, SoupSize } from './modes';

/**
 * Format a date as the worldwide seed string, `dd-mm-yyyy`.
 *
 * Uses the UTC calendar date, not the caller's local date — the
 * whole point is a single shared day boundary. Reading local getters
 * here would give players on either side of midnight UTC different
 * puzzles depending on their timezone.
 */
export function formatDailySeed( date: Date ): string {
	const day = String( date.getUTCDate() ).padStart( 2, '0' );
	const month = String( date.getUTCMonth() + 1 ).padStart( 2, '0' );
	const year = String( date.getUTCFullYear() );
	return `${ day }-${ month }-${ year }`;
}

/**
 * The seed string for a run. Every (mode, size) pair is its own
 * shared worldwide puzzle: Daily plays `<date>#<size>`, Time Attack
 * a different stream of the same date. The seed string doubles as
 * the played-today ledger key (one shareable run per puzzle).
 */
export function runSeedString(
	dateSeed: string,
	mode: SoupMode,
	size: SoupSize,
): string {
	return 'time-attack' === mode
		? `${ dateSeed }#time-attack#${ size }`
		: `${ dateSeed }#${ size }`;
}

/**
 * A deterministic `() => number` stream for one wave of a run.
 * Derived per wave (not continued across waves) so a given wave is
 * reproducible in isolation.
 */
export function waveRng( seedString: string, wave: number ): () => number {
	return mulberry32( hash32( `${ seedString }#wave-${ wave }` ) );
}
