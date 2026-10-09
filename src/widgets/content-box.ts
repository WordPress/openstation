/**
 * Content-box measurement for the widget column.
 */

/** A viewport-space box, the subset of `DOMRect` the layer compares. */
export interface Box {
	top: number;
	right: number;
	bottom: number;
	left: number;
	width: number;
	height: number;
}

/**
 * The column's content box in viewport coordinates.
 *
 * The column pads out past its cards so their drop shadow has room
 * before the scroll container clips it (see `.os-widgets` in
 * desktop.css), which makes its border box bigger than the stack the
 * user sees. Anything asking "is the pointer near the column" or
 * "where does the column end" means this box, not that one.
 */
export function contentBox( el: HTMLElement ): Box {
	const rect = el.getBoundingClientRect();
	const style = getComputedStyle( el );
	const px = ( value: string ): number => parseFloat( value ) || 0;
	const top = rect.top + px( style.borderTopWidth ) + px( style.paddingTop );
	const left = rect.left + px( style.borderLeftWidth ) + px( style.paddingLeft );
	const bottom =
		rect.bottom - px( style.borderBottomWidth ) - px( style.paddingBottom );
	const right =
		rect.right - px( style.borderRightWidth ) - px( style.paddingRight );
	return {
		top,
		right,
		bottom,
		left,
		width: right - left,
		height: bottom - top,
	};
}
