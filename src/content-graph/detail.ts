/**
 * Content Graph — level of detail by zoom.
 *
 * Pure numbers and decisions (no Pixi, no DOM) for how far the camera
 * may zoom out and how much of the board `draw()` paints at a given
 * zoom, kept out of `scene.ts` so they can be pinned without a
 * renderer.
 *
 * A board of a few thousand posts settles several thousand world units
 * across and only fits on screen near zoom 0.1. There a node is under
 * a pixel and a link a tenth of one, so far out the board is drawn as
 * dots that keep a minimum size on screen, links are drawn only for
 * the node being pointed at or focused, and every node stays a target
 * the pointer can find. From {@link DETAIL_SCALE} in, every decision
 * here answers what the scene always painted.
 *
 * @public
 */

import type { FrameOptions } from './layout';

/** Wheel and pinch floor for a board that fits at this zoom or closer. */
export const ZOOM_MIN = 0.15;

/**
 * Lowest zoom a fit may choose. Far below {@link ZOOM_MIN} so a board
 * of thousands of posts fits on screen.
 */
export const FIT_ZOOM_MIN = 0.02;

/**
 * Fit never zooms past this, however small the board: a lone node at
 * 4× is a poster, not a board. Wheel zoom still reaches the scene's
 * own maximum.
 */
export const FIT_ZOOM_MAX = 1.5;

/** What the scene hands `frameBounds()` for every fit. */
export const FIT_OPTIONS: FrameOptions = {
	padding: 100,
	minScale: FIT_ZOOM_MIN,
	maxScale: FIT_ZOOM_MAX,
};

/**
 * Below this zoom nodes are dots and links off the hovered or focused
 * node are not painted. A link is 0.7 world units wide, about a fifth
 * of a pixel here.
 */
export const DETAIL_SCALE = 0.3;

/** Radius of the least-linked node, in world units. */
export const NODE_RADIUS_MIN = 8;

/** Smallest node's dot radius on screen, in px. */
const DOT_MIN_PX = 2.5;

/** Smallest hit radius on screen, in px. */
const HIT_MIN_PX = 6;

/** Thinnest hovered or focused link on screen, in px, once zoomed out. */
const HOT_EDGE_MIN_PX = 1;

/** Link widths in world units, as the scene always drew them. */
const EDGE_WIDTH = 0.7;
const HOT_EDGE_WIDTH = 1.2;

export interface Detail {
	/** Nodes draw as plain dots: no keyline, no glyph. */
	dots: boolean;
	/**
	 * Factor on every node's body, so the smallest one stays
	 * {@link DOT_MIN_PX} on screen and hubs stay proportionally larger.
	 * 1 until the smallest disc would fall below that.
	 */
	dotScale: number;
	/** Hit radius floor in world units, {@link HIT_MIN_PX} on screen. */
	minHitRadius: number;
	/** Links off the hovered and focused node are painted. */
	edges: boolean;
	/** Ordinary link width, in world units. */
	edgeWidth: number;
	/** Width of a link on the hovered or focused node, in world units. */
	hotEdgeWidth: number;
}

/**
 * Wheel and pinch floor for the current board: the zoom that fits it,
 * when that is further out than {@link ZOOM_MIN}, so zooming out by
 * hand reaches the same place a fit does.
 *
 * @param fitScale The scale `frameBounds()` gives the board, or `null`
 *                 when there is nothing to frame.
 */
export function manualZoomFloor( fitScale: number | null ): number {
	return fitScale === null ? ZOOM_MIN : Math.min( ZOOM_MIN, fitScale );
}

/**
 * What `draw()` paints at camera scale `scale`. Depends on the zoom
 * alone, never on how many nodes are on the board.
 */
export function detailAt( scale: number ): Detail {
	const far = scale < DETAIL_SCALE;
	return {
		dots: far,
		dotScale: Math.max( 1, DOT_MIN_PX / ( NODE_RADIUS_MIN * scale ) ),
		minHitRadius: HIT_MIN_PX / scale,
		edges: ! far,
		edgeWidth: EDGE_WIDTH,
		hotEdgeWidth: far
			? Math.max( HOT_EDGE_WIDTH, HOT_EDGE_MIN_PX / scale )
			: HOT_EDGE_WIDTH,
	};
}

/**
 * A node's hit radius in world units: the scene's own target around
 * the body, grown as the zoom goes down so it never falls under
 * {@link HIT_MIN_PX} on screen.
 */
export function hitRadius( nodeRadius: number, detail: Detail ): number {
	return Math.max( 18, nodeRadius + 8, detail.minHitRadius );
}
