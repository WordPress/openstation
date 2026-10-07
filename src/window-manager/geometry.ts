import type { Window } from '../window';

export function isValidGrid(
	candidate: unknown,
	windowCount: number,
): candidate is { cols: number; rows: number } {
	if ( ! candidate || typeof candidate !== 'object' ) {
		return false;
	}
	const c = ( candidate as { cols?: unknown } ).cols;
	const r = ( candidate as { rows?: unknown } ).rows;
	if ( typeof c !== 'number' || typeof r !== 'number' ) {
		return false;
	}
	if ( ! Number.isFinite( c ) || ! Number.isFinite( r ) ) {
		return false;
	}
	if ( c < 1 || r < 1 ) {
		return false;
	}
	return Math.floor( c ) * Math.floor( r ) >= windowCount;
}

export function isValidCellSize(
	candidate: unknown,
): candidate is { cellWidth: number; cellHeight: number } {
	if ( ! candidate || typeof candidate !== 'object' ) {
		return false;
	}
	const w = ( candidate as { cellWidth?: unknown } ).cellWidth;
	const h = ( candidate as { cellHeight?: unknown } ).cellHeight;
	if ( typeof w !== 'number' || typeof h !== 'number' ) {
		return false;
	}
	if ( ! Number.isFinite( w ) || ! Number.isFinite( h ) ) {
		return false;
	}
	return w > 0 && h > 0;
}

export function pickGridDimensions(
	n: number,
	width: number,
	height: number,
): { cols: number; rows: number } {
	if ( n <= 1 ) {
		return { cols: 1, rows: 1 };
	}
	const areaAspect = width / Math.max( 1, height );
	const max = 6;
	let best = { cols: n, rows: 1, score: Infinity };
	for ( let cols = 1; cols <= Math.min( max, n ); cols++ ) {
		const rows = Math.min( max, Math.ceil( n / cols ) );
		if ( cols * rows < n ) {
			continue;
		}
		const cellAspect = ( width / cols ) / Math.max( 1, height / rows );
		const aspectDelta = Math.abs( cellAspect - areaAspect );
		const emptyCells = cols * rows - n;
		const score = aspectDelta + emptyCells * 0.05;
		if ( score < best.score ) {
			best = { cols, rows, score };
		}
	}
	return { cols: best.cols, rows: best.rows };
}

export interface RowSpan {
	x: number;
	width: number;
}

export function splitRowByMinWidth(
	total: number,
	gap: number,
	preferredFirst: number,
	minFirst: number,
	minSecond: number,
): { first: RowSpan; second: RowSpan } {
	let first = preferredFirst;
	let second = total - gap - first;
	if ( second < minSecond ) {
		second = minSecond;
		first = total - gap - second;
	}
	if ( first < minFirst ) {
		first = minFirst;
		second = Math.max( minSecond, total - gap - first );
	}
	first = Math.max( 0, Math.min( first, total ) );
	second = Math.max( 0, Math.min( second, total ) );
	return {
		first: { x: 0, width: first },
		second: { x: total - second, width: second },
	};
}

export function snapHalfRect(
	area: { x: number; y: number; width: number; height: number },
	zone: 'left' | 'right',
	minWidth: number,
	partnerMinWidth: number,
): { x: number; y: number; width: number; height: number } {
	const half = Math.floor( area.width / 2 );
	const split =
		zone === 'left'
			? splitRowByMinWidth( area.width, 0, half, minWidth, partnerMinWidth )
			: splitRowByMinWidth( area.width, 0, half, partnerMinWidth, minWidth );
	const span = zone === 'left' ? split.first : split.second;
	return {
		x: area.x + span.x,
		y: area.y,
		width: span.width,
		height: area.height,
	};
}

export function shareRowByMinWidth(
	total: number,
	gap: number,
	mins: number[],
): RowSpan[] {
	const n = mins.length;
	if ( n === 0 ) {
		return [];
	}
	const widths = new Array< number >( n ).fill( 0 );
	const fixed = new Array< boolean >( n ).fill( false );
	let budget = total - gap * ( n - 1 );
	let free = n;
	let changed = true;
	while ( changed && free > 0 ) {
		changed = false;
		const share = Math.floor( budget / free );
		for ( let i = 0; i < n; i++ ) {
			if ( ! fixed[ i ] && mins[ i ] > share ) {
				fixed[ i ] = true;
				widths[ i ] = Math.min( mins[ i ], total );
				budget -= widths[ i ];
				free--;
				changed = true;
			}
		}
	}
	const share = free > 0 ? Math.floor( budget / free ) : 0;
	for ( let i = 0; i < n; i++ ) {
		if ( ! fixed[ i ] ) {
			widths[ i ] = share;
		}
	}

	if ( budget >= 0 ) {
		let x = 0;
		return widths.map( ( width ) => {
			const span = { x, width };
			x += width + gap;
			return span;
		} );
	}

	const lastX = total - widths[ n - 1 ];
	return widths.map( ( width, i ) => {
		const step = n > 1 ? Math.round( ( lastX * i ) / ( n - 1 ) ) : 0;
		return { x: Math.max( 0, Math.min( step, total - width ) ), width };
	} );
}

export interface OverviewLayoutItem {
	win: Window;
	x: number;
	y: number;
	scale: number;
}

export function computeOverviewLayout(
	windows: Window[],
	rect: DOMRect,
	topInset = 0,
): OverviewLayoutItem[] {
	const n = windows.length;
	if ( n === 0 ) {
		return [];
	}

	const cols = Math.ceil( Math.sqrt( n ) );
	const rows = Math.ceil( n / cols );

	const padding = 40;
	const gap = 24;

	const labelReserve = 34;

	const cellWidth =
		( rect.width - padding * 2 - gap * ( cols - 1 ) ) / cols;

	const cellHeight =
		( rect.height - padding * 2 - topInset - gap * ( rows - 1 ) ) / rows;

	const thumbCellHeight = Math.max( 40, cellHeight - labelReserve );

	return windows.map( ( win, i ) => {
		const col = i % cols;
		const row = Math.floor( i / cols );

		const cellX = rect.left + padding + col * ( cellWidth + gap );

		const cellY =
			rect.top + topInset + padding + row * ( cellHeight + gap ) + labelReserve;

		const sourceW = win.element.offsetWidth;
		const sourceH = win.element.offsetHeight;
		const scale = Math.min(
			cellWidth / sourceW,
			thumbCellHeight / sourceH,
		);
		const scaledW = sourceW * scale;
		const scaledH = sourceH * scale;

		return {
			win,
			x: cellX + ( cellWidth - scaledW ) / 2,
			y: cellY + ( thumbCellHeight - scaledH ) / 2,
			scale,
		};
	} );
}
