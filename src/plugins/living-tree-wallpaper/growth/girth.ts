/**
 * The Living Tree — girth (branch thickness) + wind compliance.
 *
 * A post-pass over the grown skeleton that accumulates thickness from
 * child → parent by Murray's / da Vinci's law: `parentR^n = Σ childR^n`
 * with `n ≈ 2.2`, then normalises so the root hits the age-scaled trunk
 * base. Compliance falls out of the same pass — thin extremities are the
 * compliant ones that sway in the wind, the thick trunk barely moves.
 * See `docs/living-tree-algorithm.md` §A.5.
 *
 * @since 0.9.4
 */

import type { BranchNode } from '../types';

/** Radius assigned to childless tips before accumulation. */
const TIP_RADIUS = 1.1;

/**
 * Fill `radius` + `compliance` for every node by propagating thickness
 * from the tips down to the root under Murray's law.
 *
 * @param nodes     The skeleton (mutated in place).
 * @param trunkBase Target trunk-base radius (already scaled by `age01`).
 * @param exponent  Murray's-law exponent `n` (default 2.2).
 */
export function computeGirth(
	nodes: BranchNode[],
	trunkBase: number,
	exponent = 2.2,
): void {
	if ( nodes.length === 0 ) {
		return;
	}

	// Accumulate child radius^n into parents. Children always have larger
	// indices than their parent (append-only growth), so one reverse walk
	// visits every child before its parent.
	const acc = new Float64Array( nodes.length );
	for ( let i = nodes.length - 1; i >= 0; i-- ) {
		const r = acc[ i ] > 0 ? Math.pow( acc[ i ], 1 / exponent ) : TIP_RADIUS;
		nodes[ i ].radius = r;
		const parent = nodes[ i ].parent;
		if ( parent !== null ) {
			acc[ parent ] += Math.pow( r, exponent );
		}
	}

	// Normalise so the root matches the age-scaled trunk base, flooring
	// tips at a visible minimum.
	const scale = trunkBase / Math.max( TIP_RADIUS, nodes[ 0 ].radius );
	for ( const node of nodes ) {
		node.radius = Math.max( 0.7, node.radius * scale );
		// Thin = compliant: tips approach 1, the trunk approaches 0. The
		// exponent softens the falloff so mid-branches still sway a bit.
		const rel = Math.min( 1, node.radius / Math.max( 0.7, trunkBase ) );
		node.compliance = Math.pow( 1 - rel, 1.6 );
	}
}
