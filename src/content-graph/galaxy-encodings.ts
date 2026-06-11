/**
 * Content Graph — Galaxy view pure encodings.
 *
 * Separated from `galaxy-scene.ts` so the brightness curve and the
 * tab/min-volume filter predicate can be unit-tested without any
 * Pixi dependency.
 *
 * @public
 * @since 0.9.2
 */

import type { GalaxyTab, GraphNodePayload } from './types';

/**
 * Normalise `(comment_count, word_count)` to a `[0, 1]` brightness
 * scalar. Log-scaled so a 50k-word post doesn't drown out a 200-word
 * post; weighted 50/50 between the two signals so a single dominant
 * input can't pin a dot at full brightness on its own.
 *
 * The output is consumed twice in the scene: as the dot's alpha
 * multiplier (so brighter posts read as more "active"), and as a
 * small scale nudge (so brighter posts feel meatier in the field).
 */
export function dotBrightness(
	commentCount: number,
	wordCount: number,
): number {
	const c = clamp01( log01( commentCount, 100 ) );
	const w = clamp01( log01( wordCount, 5000 ) );
	return clamp01( c * 0.5 + w * 0.5 );
}

function log01( value: number, ceiling: number ): number {
	if ( value <= 0 || ceiling <= 0 ) {
		return 0;
	}
	return Math.log( 1 + value ) / Math.log( 1 + ceiling );
}

function clamp01( v: number ): number {
	if ( v < 0 ) {
		return 0;
	}
	if ( v > 1 ) {
		return 1;
	}
	return v;
}

/**
 * Should this node be visible under the active Galaxy filters?
 * `all` → only the MIN VOLUME (min comments) gate applies.
 * `drafts` → status must be `'draft'`.
 * `recent` → modified within the last `recentWindowSeconds`.
 *
 * `nowSeconds` is passed in so the function stays deterministic —
 * tests can hand it a fixed clock instead of stubbing `Date.now`.
 */
export function galaxyTabFilter(
	node: Pick<
		GraphNodePayload,
		'status' | 'modified_ts' | 'comment_count'
	>,
	tab: GalaxyTab,
	minComments: number,
	nowSeconds: number,
	recentWindowSeconds: number,
): boolean {
	if ( node.comment_count < minComments ) {
		return false;
	}
	switch ( tab ) {
		case 'all':
			return true;
		case 'drafts':
			return node.status === 'draft';
		case 'recent':
			return node.modified_ts >= nowSeconds - recentWindowSeconds;
	}
}
