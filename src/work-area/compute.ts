export interface WorkAreaInsets {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export interface WorkAreaRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface RectLike {
	top: number;
	right: number;
	bottom: number;
	left: number;
	width: number;
	height: number;
}

export type WorkAreaEdge = 'top' | 'right' | 'bottom' | 'left';

export const WORK_AREA_GAP = 8;

export const ZERO_INSETS: Readonly< WorkAreaInsets > = Object.freeze( {
	top: 0,
	right: 0,
	bottom: 0,
	left: 0,
} );

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

export function edgeFor( area: RectLike, chrome: RectLike ): WorkAreaEdge {
	const centerX = chrome.left + chrome.width / 2;
	const centerY = chrome.top + chrome.height / 2;
	const distances: Record< WorkAreaEdge, number > = {
		top: Math.abs( centerY - area.top ),
		bottom: Math.abs( area.bottom - centerY ),
		left: Math.abs( centerX - area.left ),
		right: Math.abs( area.right - centerX ),
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

export function rectsEqual(
	a: Readonly< WorkAreaRect >,
	b: Readonly< WorkAreaRect >,
): boolean {
	return (
		a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
	);
}
