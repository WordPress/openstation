/**
 * OpenStation — Floating-widget reflow.
 *
 * A floating widget stores its position as a left/top offset, so on
 * its own a card knows nothing about the desktop changing size: widen
 * the window and the docked column slides right with the edge while
 * every card parked beside it stays put, opening a gap between things
 * the user arranged to sit together.
 *
 * The reflow reads the arrangement instead of each card. Cards that
 * touch (within {@link CLUSTER_GAP}) form one group, and each group
 * keeps its distance to the edge it sits nearest to, per axis: a
 * group hugging the right edge follows the right edge, one on the left
 * stays, one roughly centred stays centred. Cards inside a group never
 * move relative to each other, so a hand-built grid survives any
 * resize intact. Pure data in, pure data out; the layer applies it.
 */

import type { WidgetGeometry } from './types';

/** Gap (px) under which two cards count as one arrangement. */
export const CLUSTER_GAP = 32;

/**
 * How lopsided a group's two margins may be, as a share of the frame,
 * and still read as centred.
 */
const CENTRE_TOLERANCE = 0.08;

export interface FrameSize {
	width: number;
	height: number;
}

interface Box {
	x: number;
	y: number;
	right: number;
	bottom: number;
}

function near( a: WidgetGeometry, b: WidgetGeometry ): boolean {
	return (
		a.x <= b.x + b.width + CLUSTER_GAP &&
		b.x <= a.x + a.width + CLUSTER_GAP &&
		a.y <= b.y + b.height + CLUSTER_GAP &&
		b.y <= a.y + a.height + CLUSTER_GAP
	);
}

/** Group ids into clusters of cards that touch, transitively. */
export function clusterGeometry(
	geometry: Record< string, WidgetGeometry >,
): string[][] {
	const ids = Object.keys( geometry );
	const parent = new Map( ids.map( ( id ) => [ id, id ] ) );
	const find = ( id: string ): string => {
		let root = id;
		while ( parent.get( root ) !== root ) {
			root = parent.get( root ) as string;
		}
		parent.set( id, root );
		return root;
	};
	for ( let i = 0; i < ids.length; i++ ) {
		for ( let j = i + 1; j < ids.length; j++ ) {
			if ( near( geometry[ ids[ i ] ], geometry[ ids[ j ] ] ) ) {
				parent.set( find( ids[ i ] ), find( ids[ j ] ) );
			}
		}
	}
	const groups = new Map< string, string[] >();
	for ( const id of ids ) {
		const root = find( id );
		groups.set( root, [ ...( groups.get( root ) ?? [] ), id ] );
	}
	return Array.from( groups.values() );
}

/** How far a group moves on one axis when its frame grows by `delta`. */
function shiftFor(
	start: number,
	end: number,
	span: number,
	delta: number,
): number {
	const before = start;
	const after = span - end;
	if ( Math.abs( before - after ) <= span * CENTRE_TOLERANCE ) {
		return Math.round( delta / 2 );
	}
	return after < before ? delta : 0;
}

/**
 * Move every group of floating cards so it keeps its place relative
 * to the frame's nearest edges after the frame went from `from` to
 * `to`. Sizes are never touched; clamping into the work area is the
 * caller's job.
 */
export function reflowGeometry(
	geometry: Record< string, WidgetGeometry >,
	from: FrameSize,
	to: FrameSize,
): Record< string, WidgetGeometry > {
	const dw = to.width - from.width;
	const dh = to.height - from.height;
	if ( ( ! dw && ! dh ) || from.width <= 0 || from.height <= 0 ) {
		return { ...geometry };
	}
	const out: Record< string, WidgetGeometry > = {};
	for ( const group of clusterGeometry( geometry ) ) {
		const box = group.reduce< Box >(
			( acc, id ) => {
				const g = geometry[ id ];
				return {
					x: Math.min( acc.x, g.x ),
					y: Math.min( acc.y, g.y ),
					right: Math.max( acc.right, g.x + g.width ),
					bottom: Math.max( acc.bottom, g.y + g.height ),
				};
			},
			{ x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity },
		);
		const sx = dw ? shiftFor( box.x, box.right, from.width, dw ) : 0;
		const sy = dh ? shiftFor( box.y, box.bottom, from.height, dh ) : 0;
		for ( const id of group ) {
			const g = geometry[ id ];
			out[ id ] = { ...g, x: g.x + sx, y: g.y + sy };
		}
	}
	return out;
}
