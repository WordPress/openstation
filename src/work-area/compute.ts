/**
 * Work-area geometry — the pure half.
 *
 * The desktop area (`#os-area`) is where windows, widgets, icons and
 * the Corkboard host live, and some of the shell's chrome floats over
 * it: the bottom dock pill is absolutely positioned inside the shell
 * body and covers the area's bottom band. The **work area** is the
 * area minus every such band — the rectangle content may occupy and
 * the user can actually reach.
 *
 * This module has no DOM access: every function takes rectangles and
 * returns rectangles, so the rules can be pinned by tests without
 * layout. `src/work-area/index.ts` measures the live elements and
 * feeds them through here.
 *
 * Two rules decide what a piece of chrome claims:
 *
 * 1. **Only overlap counts.** A rail that sits BESIDE the area (the
 *    left / right dock, which is a flex sibling of the area) claims
 *    nothing — the area is already narrower for it. A rail that
 *    OVERLAPS the area (the floating bottom pill) claims the band it
 *    covers, measured from the area's edge to the rail's far side.
 * 2. **A rail claims the edge it is nearest to.** Not the edge its
 *    orientation suggests: a one-tile bottom pill is taller than it
 *    is wide, and reading it as a vertical rail would hand half the
 *    desktop to the right inset. Orientation only breaks ties.
 */

/** Reserved depth on each edge of the desktop area, in CSS px. */
export interface WorkAreaInsets {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

/** A rectangle in whichever coordinate space the caller says. */
export interface WorkAreaRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * The subset of `DOMRect` the math reads. Declared structurally so
 * tests can pass plain objects and callers can pass a real DOMRect.
 */
export interface RectLike {
	top: number;
	right: number;
	bottom: number;
	left: number;
	width: number;
	height: number;
}

export type WorkAreaEdge = 'top' | 'right' | 'bottom' | 'left';

/**
 * Breathing room between chrome and the content that stops short of
 * it, in px. The old hardcoded `padding-bottom: 80px` on `.os-area`
 * was "the pill, plus 8px of air"; this is the 8px.
 */
export const WORK_AREA_GAP = 8;

export const ZERO_INSETS: Readonly< WorkAreaInsets > = Object.freeze( {
	top: 0,
	right: 0,
	bottom: 0,
	left: 0,
} );

/** Build a `RectLike` from an origin + size. */
export function rectLike(
	left: number,
	top: number,
	width: number,
	height: number,
): RectLike {
	return {
		left,
		top,
		width,
		height,
		right: left + width,
		bottom: top + height,
	};
}

/**
 * Which edge of `area` a piece of overlapping chrome is anchored to.
 *
 * The nearest edge wins — measured from the chrome's own outer side
 * to the matching side of the area, so a pill floating 12px above the
 * bottom edge is "bottom" however wide or narrow it is. Ties (a rail
 * that runs the full height of the area is 0px from top, bottom AND
 * one side) go to the pair the rail's orientation suggests: taller
 * than wide → left / right, otherwise top / bottom.
 */
export function edgeFor( area: RectLike, chrome: RectLike ): WorkAreaEdge {
	const distances: Record< WorkAreaEdge, number > = {
		top: Math.abs( chrome.top - area.top ),
		bottom: Math.abs( area.bottom - chrome.bottom ),
		left: Math.abs( chrome.left - area.left ),
		right: Math.abs( area.right - chrome.right ),
	};
	const vertical = chrome.height > chrome.width;
	const preferred: WorkAreaEdge[] = vertical
		? [ 'left', 'right', 'top', 'bottom' ]
		: [ 'top', 'bottom', 'left', 'right' ];
	let best: WorkAreaEdge = preferred[ 0 ];
	for ( const edge of preferred ) {
		if ( distances[ edge ] < distances[ best ] ) {
			best = edge;
		}
	}
	return best;
}

/**
 * Reserved insets of `area` given the chrome rectangles that may
 * overlap it. Chrome that does not intersect the area, or has no
 * size (hidden, collapsed by the overview animation), claims nothing.
 *
 * Each inset is the depth from the area's edge to the chrome's far
 * side plus {@link WORK_AREA_GAP}, rounded UP so a fractional pill
 * never leaves a sub-pixel of content underneath it, and capped at
 * half the area's extent on that axis so a pathological layout (a
 * rail taller than the viewport) still leaves a work area.
 */
export function computeInsets(
	area: RectLike,
	chrome: readonly RectLike[],
	gap: number = WORK_AREA_GAP,
): WorkAreaInsets {
	const insets: WorkAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };
	if ( area.width <= 0 || area.height <= 0 ) {
		return insets;
	}
	for ( const c of chrome ) {
		if ( c.width <= 0 || c.height <= 0 ) {
			continue;
		}
		const overlapW =
			Math.min( area.right, c.right ) - Math.max( area.left, c.left );
		const overlapH =
			Math.min( area.bottom, c.bottom ) - Math.max( area.top, c.top );
		if ( overlapW <= 0 || overlapH <= 0 ) {
			continue;
		}
		switch ( edgeFor( area, c ) ) {
			case 'bottom':
				insets.bottom = Math.max( insets.bottom, area.bottom - c.top + gap );
				break;
			case 'top':
				insets.top = Math.max( insets.top, c.bottom - area.top + gap );
				break;
			case 'left':
				insets.left = Math.max( insets.left, c.right - area.left + gap );
				break;
			case 'right':
				insets.right = Math.max( insets.right, area.right - c.left + gap );
				break;
		}
	}
	const maxY = Math.floor( area.height / 2 );
	const maxX = Math.floor( area.width / 2 );
	return {
		top: Math.min( maxY, Math.ceil( insets.top ) ),
		bottom: Math.min( maxY, Math.ceil( insets.bottom ) ),
		left: Math.min( maxX, Math.ceil( insets.left ) ),
		right: Math.min( maxX, Math.ceil( insets.right ) ),
	};
}

/**
 * The work-area rectangle for an area of `width` × `height` wearing
 * `insets`, in the area's own coordinate space (origin at its
 * top-left — the space `style.left` / `style.top` resolve in for
 * anything absolutely positioned inside it).
 */
export function rectFromInsets(
	width: number,
	height: number,
	insets: Readonly< WorkAreaInsets >,
): WorkAreaRect {
	return {
		x: insets.left,
		y: insets.top,
		width: Math.max( 0, width - insets.left - insets.right ),
		height: Math.max( 0, height - insets.top - insets.bottom ),
	};
}

/**
 * How much of `element` lies outside `workArea`, per edge, in px of
 * the element's own box. Both rectangles are in the same (viewport)
 * space. This is what a surface that frames content inside its OWN
 * box needs — the Corkboard fits a graph into its host, and the part
 * of the host under the dock is not somewhere a node can be reached.
 *
 * Each inset is clamped to the element's extent on that axis, so an
 * element entirely under the dock reports its full height as
 * `bottom` rather than something larger.
 */
export function elementInsets(
	workArea: RectLike,
	element: RectLike,
): WorkAreaInsets {
	const clampX = ( v: number ): number =>
		Math.min( Math.max( 0, element.width ), Math.max( 0, v ) );
	const clampY = ( v: number ): number =>
		Math.min( Math.max( 0, element.height ), Math.max( 0, v ) );
	return {
		top: clampY( workArea.top - element.top ),
		bottom: clampY( element.bottom - workArea.bottom ),
		left: clampX( workArea.left - element.left ),
		right: clampX( element.right - workArea.right ),
	};
}

/** Structural equality on insets — the change detector. */
export function insetsEqual(
	a: Readonly< WorkAreaInsets >,
	b: Readonly< WorkAreaInsets >,
): boolean {
	return (
		a.top === b.top &&
		a.right === b.right &&
		a.bottom === b.bottom &&
		a.left === b.left
	);
}

/** Structural equality on rects — the change detector. */
export function rectsEqual(
	a: Readonly< WorkAreaRect >,
	b: Readonly< WorkAreaRect >,
): boolean {
	return (
		a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
	);
}
