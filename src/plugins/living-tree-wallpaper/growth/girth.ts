import type { BranchNode } from '../types';

const TIP_RADIUS = 1.1;

export function computeGirth(
	nodes: BranchNode[],
	trunkBase: number,
	exponent = 2.2,
): void {
	if ( nodes.length === 0 ) {
		return;
	}

	const acc = new Float64Array( nodes.length );
	for ( let i = nodes.length - 1; i >= 0; i-- ) {
		const r = acc[ i ] > 0 ? Math.pow( acc[ i ], 1 / exponent ) : TIP_RADIUS;
		nodes[ i ].radius = r;
		const parent = nodes[ i ].parent;
		if ( parent !== null ) {
			acc[ parent ] += Math.pow( r, exponent );
		}
	}

	const scale = trunkBase / Math.max( TIP_RADIUS, nodes[ 0 ].radius );
	for ( const node of nodes ) {
		node.radius = Math.max( 0.7, node.radius * scale );

		const rel = Math.min( 1, node.radius / Math.max( 0.7, trunkBase ) );
		node.compliance = Math.pow( 1 - rel, 1.6 );
	}
}
