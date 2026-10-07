import type { BranchNode } from '../types';

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
			continue;
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

export function countWithinDepth( full: BranchNode[], depthCap: number ): number {
	return revealSkeleton( full, Infinity, depthCap ).length;
}
