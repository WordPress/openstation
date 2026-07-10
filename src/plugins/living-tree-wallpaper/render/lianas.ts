/**
 * The Living Tree — lianas (tags).
 *
 * Tags do not create branches; they build connections. The tag
 * co-occurrence graph's top-K edges (`K = f( diversity01 )`, capped)
 * become luminous bezier filaments strung between crown regions. A
 * purely decorative overlay drawn *behind* the branches, redrawn per
 * frame with a slow luminous pulse. See `docs/living-tree-algorithm.md`
 * §A.8.
 *
 * @since 0.9.4
 */

import type { PixiContainer, PixiGraphics, PixiNamespace } from '../pixi-types';
import type { TagCooccurrence, Vec2 } from '../types';

/** Hard cap on filaments — decoration, not a hairball. */
const MAX_LIANAS = 16;

/** Filament glow colour — bioluminescent teal. */
const GLOW = 0x66e0c2;

interface Liana {
	a: Vec2;
	b: Vec2;
	/** Control-point sag below the chord midpoint. */
	sag: number;
	phase: number;
	weight01: number;
}

export class LianaSystem {
	private readonly graphics: PixiGraphics;
	private readonly lianas: Liana[] = [];

	/**
	 * @param layer The liana layer (back-most, behind branches).
	 * @param pixi  The vendor Pixi namespace.
	 */
	constructor(
		layer: PixiContainer,
		pixi: PixiNamespace,
	) {
		this.graphics = new pixi.Graphics();
		layer.addChild( this.graphics );
	}

	/**
	 * Build filaments from the co-occurrence graph. Vines hang between
	 * *neighbouring* crown regions — a distance window rejects both
	 * degenerate stubs and wires slicing across the whole canopy.
	 *
	 * @param cooc        Tag co-occurrence edges (server-sorted by weight).
	 * @param diversity01 Drives K (how many filaments), capped.
	 * @param anchors     Candidate crown anchor points (cluster centers).
	 * @param rng         Seeded PRNG — an edge maps to stable anchors.
	 */
	public build(
		cooc: TagCooccurrence[],
		diversity01: number,
		anchors: Vec2[],
		rng: () => number,
	): void {
		this.lianas.length = 0;
		if ( anchors.length < 2 || cooc.length === 0 ) {
			this.graphics.clear();
			return;
		}
		// Tags must READ: even modest diversity earns a few visible vines,
		// scaling up with taxonomy richness and available edges.
		const k = Math.min(
			MAX_LIANAS,
			cooc.length,
			Math.round( 3 + Math.min( 1, Math.max( 0, diversity01 ) ) * ( MAX_LIANAS - 3 ) ),
		);
		const maxWeight = Math.max( 1, cooc[ 0 ]?.weight ?? 1 );
		let attempts = 0;
		while ( this.lianas.length < k && attempts < k * 12 ) {
			attempts++;
			const a = anchors[ Math.floor( rng() * anchors.length ) ];
			const b = anchors[ Math.floor( rng() * anchors.length ) ];
			const span = Math.hypot( b.x - a.x, b.y - a.y );
			if ( span < 55 || span > 240 ) {
				continue; // Only vines between neighbouring regions.
			}
			this.lianas.push( {
				a: { x: a.x, y: a.y },
				b: { x: b.x, y: b.y },
				sag: 24 + rng() * 26 + span * 0.3,
				phase: rng() * Math.PI * 2,
				weight01: Math.min(
					1,
					( cooc[ this.lianas.length ]?.weight ?? 1 ) / maxWeight,
				),
			} );
		}
	}

	/**
	 * Redraw with the luminous pulse. Cheap: ≤ {@link MAX_LIANAS} beziers,
	 * two strokes each.
	 *
	 * @param dt Delta time (seconds).
	 * @param t  Elapsed scene time (seconds).
	 */
	public update( dt: number, t: number ): void {
		void dt;
		const g = this.graphics;
		g.clear();
		for ( const liana of this.lianas ) {
			const pulse = 0.55 + 0.45 * Math.sin( t * 0.8 + liana.phase );
			const midX = ( liana.a.x + liana.b.x ) / 2 + Math.sin( t * 0.5 + liana.phase ) * 5;
			const midY = ( liana.a.y + liana.b.y ) / 2 + liana.sag;
			// Wide soft halo + thin bright core = glow without filters.
			g.moveTo( liana.a.x, liana.a.y )
				.bezierCurveTo( midX, midY, midX, midY, liana.b.x, liana.b.y )
				.stroke( {
					color: GLOW,
					width: 5,
					alpha: 0.08 + 0.1 * pulse * liana.weight01,
					cap: 'round',
				} );
			g.moveTo( liana.a.x, liana.a.y )
				.bezierCurveTo( midX, midY, midX, midY, liana.b.x, liana.b.y )
				.stroke( {
					color: GLOW,
					width: 1.5,
					alpha: 0.2 + 0.3 * pulse * liana.weight01,
					cap: 'round',
				} );
			// Dew beads of light along the vine. With both cubic controls
			// coincident at C, the curve is it³·A + 3·it·t·C + t³·B — the
			// beads use exactly that so they sit ON the stroke.
			for ( const bt of [ 0.3, 0.55, 0.8 ] ) {
				const it = 1 - bt;
				const bx = it * it * it * liana.a.x + 3 * it * bt * midX + bt * bt * bt * liana.b.x;
				const by = it * it * it * liana.a.y + 3 * it * bt * midY + bt * bt * bt * liana.b.y;
				g.circle( bx, by, 1.5 ).fill( {
					color: GLOW,
					alpha: 0.25 * pulse * liana.weight01,
				} );
			}
		}
	}

	/** Release the graphics. */
	public destroy(): void {
		this.graphics.destroy();
	}
}
