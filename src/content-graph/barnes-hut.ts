/**
 * Content Graph — Barnes-Hut repulsion for large boards.
 *
 * `ForceSim.step()` compares every pair of nodes, which is ~39.5
 * million pairs per step on a site of 8,890 posts. Above
 * `EXACT_REPULSION_MAX_NODES` the sim calls {@link applyBarnesHutRepulsion}
 * instead: the nodes go into a quadtree whose cells carry their body
 * count and centre of mass, and a cell far enough away (its size over
 * its distance under {@link THETA}) pushes as one body of that mass.
 * O(n log n) per step instead of O(n²).
 *
 * The law is the exact loop's: `repulsion / d²` along the line
 * between the two, added straight to the velocity. Bodies that share
 * a leaf are compared one to one, with the exact loop's deterministic
 * kick for co-located pairs, so nothing divides by zero. Pinned nodes
 * are in the tree, so they still push, and receive nothing.
 *
 * The tree lives in typed arrays reused across steps: a board settles
 * over hundreds of steps and allocating a cell object per node per
 * step would hand the garbage collector the freeze this replaces.
 *
 * @public
 */

import type { GraphNode } from './types';

/**
 * Opening angle. A cell whose size is under `THETA` times its distance
 * from the body is treated as a single body. 0.9 is the usual
 * trade-off for a layout (d3-force ships it): the error is a few
 * percent of the force, well inside what the damping smooths out.
 */
const THETA = 0.9;
const THETA2 = THETA * THETA;

/**
 * Bodies closer than this (squared) get the deterministic kick instead
 * of `repulsion / d²`, matching the exact loop. A cell whose centre of
 * mass sits this close is opened rather than approximated.
 */
const MIN_D2 = 0.01;

/**
 * Subdivision stops here. Bodies on the exact same point would
 * otherwise split forever; at this depth they share a leaf and are
 * compared one to one.
 */
const MAX_DEPTH = 32;

const EMPTY = -1;
const INTERNAL = -2;

let capacity = 0;
let cellX0 = new Float64Array( 0 );
let cellY0 = new Float64Array( 0 );
let cellSize = new Float64Array( 0 );
let cellMass = new Float64Array( 0 );
let cellSumX = new Float64Array( 0 );
let cellSumY = new Float64Array( 0 );
/** Head of the leaf's body list, {@link EMPTY} or {@link INTERNAL}. */
let cellBody = new Int32Array( 0 );
/** Four child slots per cell, `-1` when absent. */
let cellChild = new Int32Array( 0 );
let cellCount = 0;

let bodyCapacity = 0;
let bodyX = new Float64Array( 0 );
let bodyY = new Float64Array( 0 );
/** Next body in the same leaf, `-1` at the end of the list. */
let bodyNext = new Int32Array( 0 );

const stack = new Int32Array( 4 * ( MAX_DEPTH + 2 ) );

function ensureCells( n: number ): void {
	if ( n <= capacity ) {
		return;
	}
	const next = Math.max( n, capacity * 2, 64 );
	const grow = < T extends Float64Array | Int32Array >( a: T, size: number ): T => {
		const b = new ( a.constructor as new ( l: number ) => T )( size );
		b.set( a );
		return b;
	};
	cellX0 = grow( cellX0, next );
	cellY0 = grow( cellY0, next );
	cellSize = grow( cellSize, next );
	cellMass = grow( cellMass, next );
	cellSumX = grow( cellSumX, next );
	cellSumY = grow( cellSumY, next );
	cellBody = grow( cellBody, next );
	cellChild = grow( cellChild, next * 4 );
	capacity = next;
}

function ensureBodies( n: number ): void {
	if ( n <= bodyCapacity ) {
		return;
	}
	bodyX = new Float64Array( n );
	bodyY = new Float64Array( n );
	bodyNext = new Int32Array( n );
	bodyCapacity = n;
}

function newCell( x0: number, y0: number, size: number ): number {
	ensureCells( cellCount + 1 );
	const c = cellCount++;
	cellX0[ c ] = x0;
	cellY0[ c ] = y0;
	cellSize[ c ] = size;
	cellMass[ c ] = 0;
	cellSumX[ c ] = 0;
	cellSumY[ c ] = 0;
	cellBody[ c ] = EMPTY;
	const k = c * 4;
	cellChild[ k ] = -1;
	cellChild[ k + 1 ] = -1;
	cellChild[ k + 2 ] = -1;
	cellChild[ k + 3 ] = -1;
	return c;
}

/** Child slot for `( x, y )` in cell `c`, creating the child if needed. */
function childFor( c: number, x: number, y: number ): number {
	const half = cellSize[ c ] / 2;
	const right = x >= cellX0[ c ] + half ? 1 : 0;
	const down = y >= cellY0[ c ] + half ? 1 : 0;
	const slot = c * 4 + right + down * 2;
	let child = cellChild[ slot ];
	if ( child === -1 ) {
		child = newCell(
			cellX0[ c ] + right * half,
			cellY0[ c ] + down * half,
			half,
		);
		cellChild[ slot ] = child;
	}
	return child;
}

function insert( i: number ): void {
	const x = bodyX[ i ];
	const y = bodyY[ i ];
	let c = 0;
	let depth = 0;
	for ( ;; ) {
		const head = cellBody[ c ];
		if ( head === INTERNAL ) {
			cellMass[ c ] += 1;
			cellSumX[ c ] += x;
			cellSumY[ c ] += y;
			c = childFor( c, x, y );
			depth++;
			continue;
		}
		if ( head === EMPTY ) {
			cellBody[ c ] = i;
			bodyNext[ i ] = -1;
			cellMass[ c ] = 1;
			cellSumX[ c ] = x;
			cellSumY[ c ] = y;
			return;
		}
		if ( depth >= MAX_DEPTH || ( bodyX[ head ] === x && bodyY[ head ] === y ) ) {
			// Same point (or as deep as we go): share the leaf.
			bodyNext[ i ] = head;
			cellBody[ c ] = i;
			cellMass[ c ] += 1;
			cellSumX[ c ] += x;
			cellSumY[ c ] += y;
			return;
		}
		// Split: the leaf's bodies all sit on one point, so they move
		// down together, and the loop goes round again with `c` as an
		// internal cell.
		const child = childFor( c, bodyX[ head ], bodyY[ head ] );
		cellBody[ child ] = head;
		cellMass[ child ] = cellMass[ c ];
		cellSumX[ child ] = cellSumX[ c ];
		cellSumY[ child ] = cellSumY[ c ];
		cellBody[ c ] = INTERNAL;
	}
}

/**
 * Add every node's repulsion from every other node to its velocity,
 * approximated with a Barnes-Hut quadtree. Same contract as the exact
 * loop in `ForceSim.step()`: pinned nodes push and are not pushed.
 *
 * @param nodes     The sim's nodes, in the sim's order (the index is
 *                  what the co-located kick is derived from).
 * @param repulsion `SimOptions.repulsion`.
 */
export function applyBarnesHutRepulsion(
	nodes: GraphNode[],
	repulsion: number,
): void {
	const len = nodes.length;
	if ( len < 2 ) {
		return;
	}
	ensureBodies( len );
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for ( let i = 0; i < len; i++ ) {
		const x = nodes[ i ].x;
		const y = nodes[ i ].y;
		bodyX[ i ] = x;
		bodyY[ i ] = y;
		if ( x < minX ) {
			minX = x;
		}
		if ( x > maxX ) {
			maxX = x;
		}
		if ( y < minY ) {
			minY = y;
		}
		if ( y > maxY ) {
			maxY = y;
		}
	}
	// Square root cell, padded so the max edge falls inside it.
	const size = Math.max( maxX - minX, maxY - minY ) + 1;
	cellCount = 0;
	newCell( minX, minY, size );
	for ( let i = 0; i < len; i++ ) {
		insert( i );
	}

	for ( let i = 0; i < len; i++ ) {
		const node = nodes[ i ];
		if ( node.pinned ) {
			continue;
		}
		const x = bodyX[ i ];
		const y = bodyY[ i ];
		let fx = 0;
		let fy = 0;
		let sp = 0;
		stack[ sp++ ] = 0;
		while ( sp > 0 ) {
			const c = stack[ --sp ];
			const head = cellBody[ c ];
			if ( head === EMPTY ) {
				continue;
			}
			if ( head >= 0 ) {
				for ( let j = head; j !== -1; j = bodyNext[ j ] ) {
					if ( j === i ) {
						continue;
					}
					let dx = x - bodyX[ j ];
					let dy = y - bodyY[ j ];
					let d2 = dx * dx + dy * dy;
					if ( d2 < MIN_D2 ) {
						// The exact loop's kick for the pair, as seen
						// from this side of it.
						dx = ( i - j ) * 0.5;
						dy = ( i < j ? 1 : -1 ) * ( i + j ) * 0.5;
						d2 = dx * dx + dy * dy;
					}
					const d = Math.sqrt( d2 );
					const f = repulsion / d2;
					fx += ( dx / d ) * f;
					fy += ( dy / d ) * f;
				}
				continue;
			}
			const s = cellSize[ c ];
			const x0 = cellX0[ c ];
			const y0 = cellY0[ c ];
			const inside = x >= x0 && x < x0 + s && y >= y0 && y < y0 + s;
			if ( ! inside ) {
				const m = cellMass[ c ];
				const dx = x - cellSumX[ c ] / m;
				const dy = y - cellSumY[ c ] / m;
				const d2 = dx * dx + dy * dy;
				if ( d2 >= MIN_D2 && s * s < THETA2 * d2 ) {
					const d = Math.sqrt( d2 );
					const f = ( repulsion * m ) / d2;
					fx += ( dx / d ) * f;
					fy += ( dy / d ) * f;
					continue;
				}
			}
			const k = c * 4;
			for ( let q = 0; q < 4; q++ ) {
				const child = cellChild[ k + q ];
				if ( child !== -1 ) {
					stack[ sp++ ] = child;
				}
			}
		}
		node.vx += fx;
		node.vy += fy;
	}
}
