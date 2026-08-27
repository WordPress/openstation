/**
 * OpenStation — where the revision window lands.
 *
 * Pure geometry, kept out of `index.ts` so the rule is readable and
 * unit-testable without a window manager.
 *
 * The rule exists because of what this window is *for*. The revision
 * browser opened from an editor is only useful next to the editor —
 * and the desktop draws a window link between the two, which a
 * companion dropped squarely on top of its editor would have nowhere
 * to attach to. So the placement's whole job is to leave the editor
 * visible: beside it when there is room, otherwise diagonally opposite,
 * which is the arrangement that exposes the most of both windows when
 * neither fits next to the other.
 *
 * Deliberately NOT a snap. Snapped windows report a `null` rect to the
 * window-link frame (a half-screen tile draws no ties — see
 * `WindowLinkFrame`), so the tidiest-looking arrangement is the one
 * arrangement that would cost the link.
 */

/** A rectangle in desktop-area coordinates. */
export interface PlacementRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Gap between the editor and the revision window, in pixels. */
const GAP = 16;

/** Minimum breathing room from the desktop's own edges, in pixels. */
const MARGIN = 16;

/**
 * Widest the revision window opens at. The browser is a side-by-side
 * diff with a slider above it — it wants width, but past this it is
 * just whitespace between two columns of text.
 */
const MAX_WIDTH = 1100;

/** Tallest the revision window opens at. */
const MAX_HEIGHT = 860;

/**
 * Compute the opening geometry for a revision window beside its
 * editor.
 *
 * Tries, in order: to the right of the editor, to the left of it, then
 * the corner diagonally opposite the editor's own. The first two keep
 * the two windows fully disjoint; the fallback overlaps but always
 * leaves the editor's outer corner exposed, which is enough for the
 * link renderer to anchor a spline on.
 *
 * @param editor         The editor window's rect, in desktop-area
 *                       coordinates.
 * @param desktop        The desktop area's size.
 * @param desktop.width  Desktop area width in pixels.
 * @param desktop.height Desktop area height in pixels.
 * @return Geometry for the revision window, in the same coordinates.
 */
export function revisionWindowPlacement(
	editor: PlacementRect,
	desktop: { width: number; height: number },
): PlacementRect {
	const available = Math.max( 0, desktop.width - MARGIN * 2 );
	const width = Math.max(
		320,
		Math.min( MAX_WIDTH, Math.round( available * 0.5 ) ),
	);
	const height = Math.max(
		200,
		Math.min( MAX_HEIGHT, Math.round( desktop.height * 0.8 ) ),
	);

	// Vertically, follow the editor rather than the desktop: the two
	// windows read as a pair when their top edges line up, and the
	// clamp keeps the whole window on screen when the editor sits low.
	const y = clamp( editor.y, MARGIN, Math.max( MARGIN, desktop.height - height - MARGIN ) );

	const rightOf = editor.x + editor.width + GAP;
	if ( rightOf + width + MARGIN <= desktop.width ) {
		return { x: rightOf, y, width, height };
	}

	const leftOf = editor.x - GAP - width;
	if ( leftOf >= MARGIN ) {
		return { x: leftOf, y, width, height };
	}

	// No room either side. Take the corner farthest from the editor's
	// own centre, so whichever way the editor is leaning, its opposite
	// corner stays uncovered. A dead-centre editor — the maximized
	// case, which is the common one here — breaks toward the bottom
	// right, leaving its title bar and left edge exposed.
	const editorCentreX = editor.x + editor.width / 2;
	const editorCentreY = editor.y + editor.height / 2;
	const right = editorCentreX <= desktop.width / 2;
	const bottom = editorCentreY <= desktop.height / 2;
	return {
		x: right
			? Math.max( MARGIN, desktop.width - width - MARGIN )
			: MARGIN,
		y: bottom
			? Math.max( MARGIN, desktop.height - height - MARGIN )
			: MARGIN,
		width,
		height,
	};
}

/** Clamp `value` into `[min, max]`. */
function clamp( value: number, min: number, max: number ): number {
	return Math.min( Math.max( value, min ), max );
}
