/**
 * Posts app — the Categories mind map's drawing routines: the node
 * shape, the lit-from-above disc, the breathing drop target, and the
 * parent→child bezier (solid, or dashed by walking the curve, since
 * Pixi 8's stroke has no dash option).
 *
 * @public
 */

import { shadeColor, type PixiGraphics, type PixiNamespace, type PixiPoint } from './canvas/pixi';

export interface MindNode {
	id: number;
	parent: number;
	name: string;
	description: string;
	count: number;
	x: number;
	y: number;
	tx: number;
	ty: number;
	radius: number;
	depth: number;
	color: number;
	gfx: PixiGraphics;
	pinned: boolean;
}

export function bezierAt(
	t: number,
	x1: number,
	y1: number,
	cp1x: number,
	cp1y: number,
	cp2x: number,
	cp2y: number,
	x2: number,
	y2: number,
): PixiPoint {
	const omt = 1 - t;
	return {
		x: omt * omt * omt * x1 + 3 * omt * omt * t * cp1x + 3 * omt * t * t * cp2x + t * t * t * x2,
		y: omt * omt * omt * y1 + 3 * omt * omt * t * cp1y + 3 * omt * t * t * cp2y + t * t * t * y2,
	};
}

/**
 * A parent→child bezier. `dashed` walks the curve in 32 samples and
 * strokes every other group; `dashPhase` marches the pattern along
 * the curve, `dashStride` groups samples per dash (2 = chunky
 * marching ants).
 */
export function drawCurvedEdge(
	g: PixiGraphics,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	color: number,
	opts: { dashed?: boolean; alpha?: number; width?: number; dashPhase?: number; dashStride?: number } = {},
): void {
	const dx = x2 - x1;
	const cp1x = x1 + dx * 0.5;
	const cp2x = x2 - dx * 0.5;
	const alpha = opts.alpha ?? 0.5;
	const width = opts.width ?? 1.5;
	if ( ! opts.dashed ) {
		g.moveTo( x1, y1 );
		g.bezierCurveTo( cp1x, y1, cp2x, y2, x2, y2 );
		g.stroke( { color, width, alpha } );
		return;
	}
	const STEPS = 32;
	const phase = opts.dashPhase ?? 0;
	const stride = Math.max( 1, opts.dashStride ?? 1 );
	let lastX = x1;
	let lastY = y1;
	for ( let i = 1; i <= STEPS; i++ ) {
		const p = bezierAt( i / STEPS, x1, y1, cp1x, y1, cp2x, y2, x2, y2 );
		if ( Math.floor( ( i - 1 + phase ) / stride ) % 2 === 0 ) {
			g.moveTo( lastX, lastY );
			g.lineTo( p.x, p.y );
			g.stroke( { color, width, alpha } );
		}
		lastX = p.x;
		lastY = p.y;
	}
}

/** A lit-from-above sphere: shadow, halo (focused), rim, cap, gloss, stroke. */
export function drawNodeDisc( pixi: PixiNamespace, node: MindNode, highlighted: boolean ): void {
	const g = node.gfx;
	g.clear();
	const r = node.radius;
	if ( ! highlighted ) {
		g.circle( 0, 5, r );
		g.fill( { color: 0x000000, alpha: 0.18 } );
	}
	if ( highlighted ) {
		g.circle( 0, 0, r + 10 );
		g.fill( { color: node.color, alpha: 0.22 } );
	}
	g.circle( 0, 0, r );
	g.fill( shadeColor( node.color, -0.18 ) );
	g.circle( 0, -r * 0.06, r * 0.94 );
	g.fill( node.color );
	g.circle( -r * 0.32, -r * 0.42, r * 0.3 );
	g.fill( { color: 0xffffff, alpha: 0.32 } );
	g.circle( 0, 0, r );
	g.stroke( { color: 0xffffff, width: highlighted ? 3 : 2, alignment: 0 } );
	g.x = node.x;
	g.y = node.y;
	g.zIndex = 10;
	// An exact circular hit area — the drawn primitives' bounding box
	// is bigger than the disc and not circular.
	g.hitArea = new pixi.Circle( 0, 0, r + 4 );
}

/** The drop target while reparenting: a breathing ring + accent dot in the dragged node's colour. */
export function drawDropTarget( pixi: PixiNamespace, hover: MindNode, sourceColor: number ): void {
	drawNodeDisc( pixi, hover, false );
	const g = hover.gfx;
	const pulse = Math.sin( performance.now() / 280 ) * 0.5 + 0.5;
	g.circle( 0, 0, hover.radius + 6 + pulse * 5 );
	g.stroke( { color: sourceColor, width: 3, alpha: 0.6 + pulse * 0.35 } );
	g.circle( 0, 0, hover.radius * 0.42 );
	g.fill( { color: sourceColor, alpha: 0.85 } );
	g.hitArea = new pixi.Circle( 0, 0, hover.radius + 12 );
}
