/**
 * The Living Tree — canonical-skeleton reveal.
 *
 * The full mature skeleton is grown once (a pure function of the seed);
 * age then reveals a *prefix* of it in growth order, filtered by the
 * age-unlocked depth cap. Because nodes are append-only (a parent always
 * precedes its children) a prefix is automatically connected, and because
 * the same skeleton underlies every age, growth is **monotone**: the tree
 * at age N+1 day contains the tree at age N, plus a few more nodes. No
 * daily reshuffle, ever — there's a regression test pinning exactly that.
 */

import type { BranchNode } from '../types';

/**
 * Extract the revealed, re-indexed skeleton: the first `count` nodes (in
 * growth order) whose depth is within `depthCap` and whose parent
 * survived the filter. Returned nodes are shallow copies with `id` /
 * `parent` remapped to the new array — safe to hand to girth, chains,
 * and the leaf placer, which mutate `radius` / `compliance` only.
 *
 * @param full     The canonical fully-grown skeleton.
 * @param count    Max nodes to reveal (≥2 for anything visible).
 * @param depthCap Age-unlocked branching depth (see maxDepthForAge).
 * @return The revealed subtree, re-indexed from 0.
 */
export function revealSkeleton(
	full: BranchNode[],
	count: number,
	depthCap: number,
): BranchNode[] {
	const out: BranchNode[] = [];
	const map = new Int32Array( full.length ).fill( -1 );
	for ( let i = 0; i < full.length && out.length < count; i++ ) {
		const node = full[ i ];
		if ( node.depth > depthCap ) {
			continue;
		}
		if ( node.parent !== null && map[ node.parent ] === -1 ) {
			continue; // Parent was pruned — the whole limb stays hidden.
		}
		map[ i ] = out.length;
		out.push( {
			...node,
			id: out.length,
			parent: node.parent === null ? null : map[ node.parent ],
		} );
	}
	return out;
}

/**
 * How many canonical nodes survive a depth cap — the "total" that
 * `revealCountForAge` scales against.
 *
 * @param full     The canonical fully-grown skeleton.
 * @param depthCap Age-unlocked branching depth.
 * @return Count of depth-eligible, connected nodes.
 */
export function countWithinDepth( full: BranchNode[], depthCap: number ): number {
	return revealSkeleton( full, Infinity, depthCap ).length;
}
