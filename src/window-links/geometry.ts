export interface LinkRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface LinkObstacle {
	windowId: string;
	rect: LinkRect;
	zIndex: number;
}

export type LinkSide = 'left' | 'right' | 'top' | 'bottom';

export interface LinkAnchor {
	x: number;
	y: number;
	side: LinkSide;
}

export const MIN_VISIBLE_SEGMENT = 16;

interface Interval {
	start: number;
	end: number;
}

export function subtractIntervals(
	base: Interval,
	holes: Interval[],
): Interval[] {
	const sorted = holes
		.map( ( h ) => ( {
			start: Math.max( base.start, h.start ),
			end: Math.min( base.end, h.end ),
		} ) )
		.filter( ( h ) => h.end > h.start )
		.sort( ( a, b ) => a.start - b.start );

	const out: Interval[] = [];
	let cursor = base.start;
	for ( const hole of sorted ) {
		if ( hole.start > cursor ) {
			out.push( { start: cursor, end: hole.start } );
		}
		cursor = Math.max( cursor, hole.end );
	}
	if ( cursor < base.end ) {
		out.push( { start: cursor, end: base.end } );
	}
	return out;
}

export function anchorOnBorder(
	rect: LinkRect,
	toward: { x: number; y: number },
): LinkAnchor {
	const cx = rect.x + rect.width / 2;
	const cy = rect.y + rect.height / 2;
	const dx = toward.x - cx;
	const dy = toward.y - cy;
	if ( dx === 0 && dy === 0 ) {
		return { x: cx, y: cy, side: 'right' };
	}
	const sx = dx !== 0 ? rect.width / 2 / Math.abs( dx ) : Infinity;
	const sy = dy !== 0 ? rect.height / 2 / Math.abs( dy ) : Infinity;
	const s = Math.min( sx, sy );
	const x = cx + dx * s;
	const y = cy + dy * s;
	let side: LinkSide;
	if ( sx <= sy ) {
		side = dx > 0 ? 'right' : 'left';
	} else {
		side = dy > 0 ? 'bottom' : 'top';
	}
	return { x, y, side };
}

export function isPointVisible(
	point: { x: number; y: number },
	zIndex: number,
	obstacles: LinkObstacle[],
	selfId: string,
): boolean {
	for ( const o of obstacles ) {
		if ( o.windowId === selfId || o.zIndex <= zIndex ) {
			continue;
		}
		if (
			point.x >= o.rect.x &&
			point.x <= o.rect.x + o.rect.width &&
			point.y >= o.rect.y &&
			point.y <= o.rect.y + o.rect.height
		) {
			return false;
		}
	}
	return true;
}

export function visibleBorderAnchor(
	rect: LinkRect,
	zIndex: number,
	obstacles: LinkObstacle[],
	selfId: string,
	toward: { x: number; y: number },
): LinkAnchor | null {
	const occluders = obstacles.filter(
		( o ) => o.windowId !== selfId && o.zIndex > zIndex,
	);

	const sides: Array< {
		side: LinkSide;
		base: Interval;

		at: number;

		horizontal: boolean;
	} > = [
		{
			side: 'top',
			base: { start: rect.x, end: rect.x + rect.width },
			at: rect.y,
			horizontal: true,
		},
		{
			side: 'bottom',
			base: { start: rect.x, end: rect.x + rect.width },
			at: rect.y + rect.height,
			horizontal: true,
		},
		{
			side: 'left',
			base: { start: rect.y, end: rect.y + rect.height },
			at: rect.x,
			horizontal: false,
		},
		{
			side: 'right',
			base: { start: rect.y, end: rect.y + rect.height },
			at: rect.x + rect.width,
			horizontal: false,
		},
	];

	let best: LinkAnchor | null = null;
	let bestDistance = Infinity;

	for ( const { side, base, at, horizontal } of sides ) {
		const holes: Interval[] = [];
		for ( const { rect: o } of occluders ) {
			const coversLine = horizontal
				? o.y <= at && at <= o.y + o.height
				: o.x <= at && at <= o.x + o.width;
			if ( ! coversLine ) {
				continue;
			}

			holes.push(
				horizontal
					? { start: o.x, end: o.x + o.width }
					: { start: o.y, end: o.y + o.height },
			);
		}

		for ( const segment of subtractIntervals( base, holes ) ) {
			if ( segment.end - segment.start < MIN_VISIBLE_SEGMENT ) {
				continue;
			}
			const mid = ( segment.start + segment.end ) / 2;
			const x = horizontal ? mid : at;
			const y = horizontal ? at : mid;
			const distance = Math.hypot( toward.x - x, toward.y - y );
			if ( distance < bestDistance ) {
				bestDistance = distance;
				best = { x, y, side };
			}
		}
	}

	return best;
}

export function closestBorderAnchors(
	a: LinkRect,
	b: LinkRect,
): { from: LinkAnchor; to: LinkAnchor } | null {
	const gapX = Math.max( b.x - ( a.x + a.width ), a.x - ( b.x + b.width ) );
	const gapY = Math.max(
		b.y - ( a.y + a.height ),
		a.y - ( b.y + b.height ),
	);
	if ( gapX < 0 && gapY < 0 ) {
		return null;
	}

	const overlapX1 = Math.max( a.x, b.x );
	const overlapX2 = Math.min( a.x + a.width, b.x + b.width );
	const overlapY1 = Math.max( a.y, b.y );
	const overlapY2 = Math.min( a.y + a.height, b.y + b.height );

	let ax: number;
	let bx: number;
	if ( overlapX2 >= overlapX1 ) {
		ax = bx = ( overlapX1 + overlapX2 ) / 2;
	} else if ( b.x > a.x ) {
		ax = a.x + a.width;
		bx = b.x;
	} else {
		ax = a.x;
		bx = b.x + b.width;
	}

	let ay: number;
	let by: number;
	if ( overlapY2 >= overlapY1 ) {
		ay = by = ( overlapY1 + overlapY2 ) / 2;
	} else if ( b.y > a.y ) {
		ay = a.y + a.height;
		by = b.y;
	} else {
		ay = a.y;
		by = b.y + b.height;
	}

	const horizontal = gapX >= gapY;
	const sideOf = (
		rect: LinkRect,
		x: number,
		y: number,
	): LinkSide => {
		if ( horizontal ) {
			return x <= rect.x ? 'left' : 'right';
		}
		return y <= rect.y ? 'top' : 'bottom';
	};

	return {
		from: { x: ax, y: ay, side: sideOf( a, ax, ay ) },
		to: { x: bx, y: by, side: sideOf( b, bx, by ) },
	};
}

export function controlPoint(
	anchor: LinkAnchor,
	distance: number,
): { x: number; y: number } {
	const k = Math.min( 160, Math.max( 24, 0.4 * distance ) );
	switch ( anchor.side ) {
		case 'left':
			return { x: anchor.x - k, y: anchor.y };
		case 'right':
			return { x: anchor.x + k, y: anchor.y };
		case 'top':
			return { x: anchor.x, y: anchor.y - k };
		default:
			return { x: anchor.x, y: anchor.y + k };
	}
}

export function centerOf( rect: LinkRect ): { x: number; y: number } {
	return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}
