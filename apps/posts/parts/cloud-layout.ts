import type { TermNeighbor } from './types';

const MIN_FONT_SIZE = 11;
const MAX_FONT_SIZE = 28;

const SPIRAL_PADDING = 14;

export interface Aabb {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface PackBox {
	id: number;
	count: number;
	width: number;
	height: number;
	tx: number;
	ty: number;
}

export function fontSizeFor( count: number, max: number ): number {
	const ratio = Math.sqrt( count / Math.max( 1, max ) );
	return Math.round( MIN_FONT_SIZE + ( MAX_FONT_SIZE - MIN_FONT_SIZE ) * ratio );
}

function aabbIntersect( a: Aabb, b: Aabb ): boolean {
	return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function slugHash( slug: string ): number {
	let h = 0;
	for ( let i = 0; i < slug.length; i++ ) {
		h = ( h * 31 + slug.charCodeAt( i ) ) % 2147483647;
	}
	return h;
}

export function tagHue( slug: string, baseHue: number ): number {
	return ( ( ( baseHue + ( slugHash( slug ) % 256 ) * 1.4 ) % 360 ) + 360 ) % 360;
}

export function tagRotation( slug: string ): number {
	const h = slugHash( slug );
	const sign = h % 2 === 0 ? -1 : 1;
	return sign * ( Math.floor( h / 2 ) % 4 ) * 0.011;
}

export function findSpiralSlot( w: number, h: number, placed: Aabb[], anchorX = 0, anchorY = 0 ): { x: number; y: number } {
	if ( placed.length === 0 ) {
		return { x: anchorX, y: anchorY };
	}
	const padding = SPIRAL_PADDING;
	const free = ( cx: number, cy: number ): boolean => {
		const aabb = { x: cx - w / 2 - padding, y: cy - h / 2 - padding, w: w + padding * 2, h: h + padding * 2 };
		return ! placed.some( ( p ) => aabbIntersect( aabb, p ) );
	};

	if ( free( anchorX, anchorY ) ) {
		return { x: anchorX, y: anchorY };
	}
	let theta = 0;
	for ( let i = 0; i < 10000; i++ ) {
		theta += 0.18;
		const r = theta * 5;
		const cx = anchorX + r * Math.cos( theta );
		const cy = anchorY + r * Math.sin( theta ) * 0.7;
		if ( free( cx, cy ) ) {
			return { x: cx, y: cy };
		}
	}

	return { x: anchorX, y: anchorY + ( placed.length + 1 ) * ( h + padding ) };
}

export function packBoxesWithClusters(
	boxesInOrder: PackBox[],
	placed: Aabb[],
	placedById: Map< number, { x: number; y: number } >,
	cooccurrence: Map< number, TermNeighbor[] >,
): void {
	let clusterCounter = 0;
	const allocateClusterAnchor = (): { x: number; y: number } => {
		const idx = clusterCounter++;
		if ( idx === 0 ) {
			return { x: 0, y: 0 };
		}
		const theta = idx * 2.4;
		const radius = 120 + idx * 70;
		return { x: radius * Math.cos( theta ), y: radius * Math.sin( theta ) * 0.8 };
	};
	for ( const box of boxesInOrder ) {
		let anchorX = 0;
		let anchorY = 0;
		let usedCentroid = false;
		const neighbors = cooccurrence.get( box.id );
		if ( neighbors && neighbors.length > 0 ) {
			let sumX = 0;
			let sumY = 0;
			let sumW = 0;
			for ( const n of neighbors ) {
				const pos = placedById.get( n.id );
				if ( pos ) {
					sumX += pos.x * n.shared;
					sumY += pos.y * n.shared;
					sumW += n.shared;
				}
			}
			if ( sumW > 0 ) {
				anchorX = sumX / sumW;
				anchorY = sumY / sumW;
				usedCentroid = true;
			}
		}
		if ( ! usedCentroid ) {
			const anchor = allocateClusterAnchor();
			anchorX = anchor.x;
			anchorY = anchor.y;
		}
		const slot = findSpiralSlot( box.width, box.height, placed, anchorX, anchorY );
		box.tx = slot.x;
		box.ty = slot.y;
		placedById.set( box.id, { x: slot.x, y: slot.y } );
		placed.push( { x: slot.x - box.width / 2, y: slot.y - box.height / 2, w: box.width, h: box.height } );
	}
}

export interface PersistedPosition {
	x: number;
	y: number;
}

export function computePositionsKey(): string {
	try {
		const host = window.location.host || 'unknown';
		const path = window.location.pathname.replace( /\/?wp-admin\/?.*$/, '' );
		return `os-tagcloud-positions:${ host }${ path }`;
	} catch {
		return 'os-tagcloud-positions:fallback';
	}
}

export function readPersistedPositions( key: string ): Map< number, PersistedPosition > {
	const out = new Map< number, PersistedPosition >();
	try {
		const raw = window.localStorage.getItem( key );
		const parsed: unknown = raw ? JSON.parse( raw ) : null;
		if ( ! parsed || typeof parsed !== 'object' ) {
			return out;
		}
		for ( const [ k, v ] of Object.entries( parsed as Record< string, unknown > ) ) {
			const id = parseInt( k, 10 );
			const pos = v as { x?: unknown; y?: unknown };
			if ( Number.isFinite( id ) && typeof pos?.x === 'number' && typeof pos?.y === 'number' ) {
				out.set( id, { x: pos.x, y: pos.y } );
			}
		}
	} catch {

	}
	return out;
}

export function writePersistedPositions( key: string, positions: Map< number, PersistedPosition > ): void {
	try {
		const obj: Record< string, PersistedPosition > = {};
		for ( const [ id, pos ] of positions ) {
			obj[ String( id ) ] = pos;
		}
		window.localStorage.setItem( key, JSON.stringify( obj ) );
	} catch {

	}
}
