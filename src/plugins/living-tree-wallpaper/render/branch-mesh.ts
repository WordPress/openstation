/**
 * The Living Tree — skeleton → branch geometry.
 *
 * The skeleton renders as **continuous tapered ribbons**, not per-segment
 * strokes: parent→child runs between forks become one filled polygon
 * whose half-width follows the interpolated girth. That kills the
 * "sausage joint" artifact entirely — width changes glide along the
 * ribbon instead of stacking discs. On top of the base fill each ribbon
 * gets cheap procedural bark: a dark shade stroke along its left edge, a
 * warm dusk highlight along its right, and striation grooves on trunk-
 * grade wood. The root run gets a flare so the tree grips the ground.
 * See `docs/living-tree-algorithm.md` §A.6.
 *
 * Per-vertex wind displacement (already compliance-scaled by the caller)
 * bends the ribbons; the whole pass is redrawn only while the skeleton
 * changes or wind is non-zero.
 *
 * @since 0.9.4
 */

import type { PixiGraphics, PixiNamespace } from '../pixi-types';
import type { BranchNode, Vec2 } from '../types';

/** Bark palette: heartwood dark → extremity light, plus accents. */
const BARK_DARK = 0x33241a;
const BARK_LIGHT = 0x8a6a48;
const BARK_SHADE = 0x1f130b;
const BARK_HIGHLIGHT = 0xd9b083;
const BARK_GROOVE = 0x241609;

/**
 * A maximal fork-free run of nodes. Chains are rebuilt only when the
 * skeleton changes; per-frame work is displacement + drawing.
 */
export interface BranchChain {
	/** Node indices along the run, starting at the run's anchor parent. */
	nodeIdx: number[];
	/** Mean compliance — colours the run. */
	meanCompliance: number;
	/** Mean radius — gates the shading/striation detail tiers. */
	meanRadius: number;
	/** True when the run starts at the root (gets the ground flare). */
	fromRoot: boolean;
}

/** Lerp between two packed RGB colours without bitwise ops. */
function lerpColor( a: number, b: number, t: number ): number {
	const ar = Math.floor( a / 65536 ) % 256;
	const ag = Math.floor( a / 256 ) % 256;
	const ab = a % 256;
	const br = Math.floor( b / 65536 ) % 256;
	const bg = Math.floor( b / 256 ) % 256;
	const bb = b % 256;
	const r = Math.round( ar + ( br - ar ) * t );
	const g = Math.round( ag + ( bg - ag ) * t );
	const bl = Math.round( ab + ( bb - ab ) * t );
	return r * 65536 + g * 256 + bl;
}

/**
 * Split the skeleton into maximal fork-free chains. Each chain starts at
 * its parent run's fork node (or the root) so consecutive ribbons overlap
 * by one vertex and joints stay watertight.
 *
 * @param nodes The skeleton.
 * @return Chains sorted trunk-first (thick wood draws under fine twigs).
 */
export function buildChains( nodes: BranchNode[] ): BranchChain[] {
	if ( nodes.length < 2 ) {
		return [];
	}
	const children: number[][] = nodes.map( () => [] );
	for ( let i = 0; i < nodes.length; i++ ) {
		const p = nodes[ i ].parent;
		if ( p !== null ) {
			children[ p ].push( i );
		}
	}

	const chains: BranchChain[] = [];
	// A chain begins at the root and at every fork child.
	const starts: Array< { from: number; head: number } > = [];
	for ( let i = 0; i < nodes.length; i++ ) {
		if ( nodes[ i ].parent === null || children[ nodes[ i ].parent as number ].length > 1 ) {
			if ( nodes[ i ].parent !== null ) {
				starts.push( { from: nodes[ i ].parent as number, head: i } );
			} else if ( children[ i ].length > 0 ) {
				starts.push( { from: i, head: children[ i ][ 0 ] } );
			}
		}
	}

	for ( const start of starts ) {
		const run = [ start.from, start.head ];
		let cursor = start.head;
		while ( children[ cursor ].length === 1 ) {
			cursor = children[ cursor ][ 0 ];
			run.push( cursor );
		}
		let compliance = 0;
		let radius = 0;
		for ( const idx of run ) {
			compliance += nodes[ idx ].compliance;
			radius += nodes[ idx ].radius;
		}
		chains.push( {
			nodeIdx: run,
			meanCompliance: compliance / run.length,
			meanRadius: radius / run.length,
			fromRoot: start.from === 0 && nodes[ 0 ].parent === null,
		} );
	}

	// Thick wood first so twigs layer on top of the trunk, not under it.
	chains.sort( ( a, b ) => b.meanRadius - a.meanRadius );
	return chains;
}

/**
 * Create the (initially empty) Graphics the skeleton draws into. Add the
 * result to the branch layer, then call {@link drawBranches} whenever the
 * skeleton or the wind changes.
 *
 * @param nodes The skeleton (kept for signature symmetry; drawing reads
 *              it via {@link drawBranches}).
 * @param pixi  The vendor Pixi namespace.
 * @return The Graphics to mount.
 */
export function buildBranchMesh(
	nodes: BranchNode[],
	pixi: PixiNamespace,
): PixiGraphics {
	void nodes;
	return new pixi.Graphics();
}

/** Per-chain displaced geometry, shared by the fill + stroke passes. */
interface ChainGeometry {
	chain: BranchChain;
	px: Float64Array;
	py: Float64Array;
	leftX: Float64Array;
	leftY: Float64Array;
	rightX: Float64Array;
	rightY: Float64Array;
	compliance: Float64Array;
}

function computeChainGeometry(
	chain: BranchChain,
	nodes: BranchNode[],
	displace: ( ( node: BranchNode ) => Vec2 ) | null,
): ChainGeometry | null {
	const count = chain.nodeIdx.length;
	if ( count < 2 ) {
		return null;
	}

	// Displaced centerline + per-point radii (root flare on the ground
	// run so the trunk visibly grips the soil).
	const px = new Float64Array( count );
	const py = new Float64Array( count );
	const pr = new Float64Array( count );
	const compliance = new Float64Array( count );
	for ( let i = 0; i < count; i++ ) {
		const node = nodes[ chain.nodeIdx[ i ] ];
		const d = displace ? displace( node ) : null;
		px[ i ] = node.pos.x + ( d ? d.x : 0 );
		py[ i ] = node.pos.y + ( d ? d.y : 0 );
		pr[ i ] = Math.max( 0.6, node.radius );
		compliance[ i ] = node.compliance;
	}
	if ( chain.fromRoot ) {
		pr[ 0 ] *= 1.75;
		if ( count > 2 ) {
			pr[ 1 ] *= 1.3;
		}
	} else {
		// The run's first vertex sits ON the parent's centerline. Start it
		// just a touch wider than the child's own body — enough to bury
		// the joint inside the parent's silhouette — but NEVER at the
		// parent's girth: that webs every fork into a melted wedge.
		pr[ 0 ] = Math.min( pr[ 0 ], pr[ 1 ] * 1.35 + 0.6 );
	}

	// Edge offsets from per-point normals → watertight tapered rims.
	const leftX = new Float64Array( count );
	const leftY = new Float64Array( count );
	const rightX = new Float64Array( count );
	const rightY = new Float64Array( count );
	for ( let i = 0; i < count; i++ ) {
		const i0 = Math.max( 0, i - 1 );
		const i1 = Math.min( count - 1, i + 1 );
		let tx = px[ i1 ] - px[ i0 ];
		let ty = py[ i1 ] - py[ i0 ];
		const len = Math.max( 1e-6, Math.hypot( tx, ty ) );
		tx /= len;
		ty /= len;
		const nx = -ty;
		const ny = tx;
		leftX[ i ] = px[ i ] + nx * pr[ i ];
		leftY[ i ] = py[ i ] + ny * pr[ i ];
		rightX[ i ] = px[ i ] - nx * pr[ i ];
		rightY[ i ] = py[ i ] - ny * pr[ i ];
	}
	return { chain, px, py, leftX, leftY, rightX, rightY, compliance };
}

/**
 * Redraw the full skeleton as shaded tapered ribbons.
 *
 * Draw order sells the joints:
 *
 * 1. **Fillet discs** at every fork, under everything — each disc has the
 *    fork node's full girth and its local colour, so the V-notch between
 *    diverging children (and the parent run's flat end cap) rounds off
 *    into a natural crotch.
 * 2. **Per chain, thick-first: wood fill, then its detail strokes.** A
 *    child's wood always paints over its parent's rim strokes, so no
 *    shade line ever slices across the base of a branch. Fills are
 *    overlapping two-segment slabs coloured by local compliance — tone
 *    glides continuously through forks with no antialiasing seams.
 *
 * @param g        The Graphics from {@link buildBranchMesh}.
 * @param chains   Chains from {@link buildChains} (rebuild on growth).
 * @param nodes    The skeleton.
 * @param displace Per-node displacement (already compliance-scaled), or
 *                 `null` for a still tree.
 */
export function drawBranches(
	g: PixiGraphics,
	chains: BranchChain[],
	nodes: BranchNode[],
	displace: ( ( node: BranchNode ) => Vec2 ) | null,
): void {
	g.clear();

	const geometries: ChainGeometry[] = [];
	for ( const chain of chains ) {
		const geometry = computeChainGeometry( chain, nodes, displace );
		if ( geometry ) {
			geometries.push( geometry );
		}
	}

	// Fillet discs — one per distinct fork node, under all wood.
	const filleted = new Set< number >();
	for ( const geo of geometries ) {
		const forkIdx = geo.chain.nodeIdx[ 0 ];
		if ( geo.chain.fromRoot || filleted.has( forkIdx ) ) {
			continue;
		}
		filleted.add( forkIdx );
		const fork = nodes[ forkIdx ];
		const d = displace ? displace( fork ) : null;
		g.circle(
			fork.pos.x + ( d ? d.x : 0 ),
			fork.pos.y + ( d ? d.y : 0 ),
			Math.max( 0.6, fork.radius ),
		).fill( {
			color: lerpColor( BARK_DARK, BARK_LIGHT, fork.compliance ),
		} );
	}

	for ( const geo of geometries ) {
		const chain = geo.chain;
		const count = geo.px.length;
		const { px, py, leftX, leftY, rightX, rightY } = geo;

		// Rounded end cap so a run never ends in a squared-off stub.
		const last = count - 1;
		const lastNode = nodes[ chain.nodeIdx[ last ] ];
		g.circle(
			px[ last ],
			py[ last ],
			Math.max( 0.6, lastNode.radius ),
		).fill( {
			color: lerpColor( BARK_DARK, BARK_LIGHT, geo.compliance[ last ] ),
		} );

		// Wood: overlapping two-segment slabs along the run — every
		// slab spans [i, i+2] following both rims, so the previous
		// slab's far edge always lies INSIDE the next one.
		for ( let i = 0; i < count - 1; i++ ) {
			const j = Math.min( count - 1, i + 2 );
			const mid = Math.min( count - 1, i + 1 );
			g.poly(
				[
					leftX[ i ], leftY[ i ],
					leftX[ mid ], leftY[ mid ],
					leftX[ j ], leftY[ j ],
					rightX[ j ], rightY[ j ],
					rightX[ mid ], rightY[ mid ],
					rightX[ i ], rightY[ i ],
				],
				true,
			).fill( {
				color: lerpColor( BARK_DARK, BARK_LIGHT, geo.compliance[ mid ] ),
			} );
		}
		if ( chain.meanRadius > 1.8 ) {
			// Cylindrical form: shade the left rim, kiss the right rim
			// with the warm dusk key light.
			g.moveTo( leftX[ 0 ], leftY[ 0 ] );
			for ( let i = 1; i < count; i++ ) {
				g.lineTo( leftX[ i ], leftY[ i ] );
			}
			g.stroke( {
				color: BARK_SHADE,
				width: Math.max( 0.8, chain.meanRadius * 0.5 ),
				alpha: 0.28,
				cap: 'round',
				join: 'round',
			} );
			g.moveTo(
				rightX[ 0 ] * 0.35 + px[ 0 ] * 0.65,
				rightY[ 0 ] * 0.35 + py[ 0 ] * 0.65,
			);
			for ( let i = 1; i < count; i++ ) {
				g.lineTo(
					rightX[ i ] * 0.35 + px[ i ] * 0.65,
					rightY[ i ] * 0.35 + py[ i ] * 0.65,
				);
			}
			g.stroke( {
				color: BARK_HIGHLIGHT,
				width: Math.max( 0.7, chain.meanRadius * 0.3 ),
				alpha: 0.14,
				cap: 'round',
				join: 'round',
			} );
		}
		if ( chain.meanRadius > 4.5 ) {
			// Bark grain: two grooves running with the wood, offset to
			// either side of the centerline.
			for ( const side of [ -0.38, 0.31 ] ) {
				g.moveTo(
					px[ 0 ] + ( leftX[ 0 ] - px[ 0 ] ) * side,
					py[ 0 ] + ( leftY[ 0 ] - py[ 0 ] ) * side,
				);
				for ( let i = 1; i < count; i++ ) {
					g.lineTo(
						px[ i ] + ( leftX[ i ] - px[ i ] ) * side,
						py[ i ] + ( leftY[ i ] - py[ i ] ) * side,
					);
				}
				g.stroke( {
					color: BARK_GROOVE,
					width: 1.1,
					alpha: 0.16,
					cap: 'round',
					join: 'round',
				} );
			}
		}
	}
}
