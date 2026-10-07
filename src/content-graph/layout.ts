export interface Point {
	x: number;
	y: number;
}

export const SMALL_BOARD_MAX_NODES = 12;

export const SETTLE_ON_LOAD_MAX_NODES = 80;

export const SETTLE_ON_LOAD_MAX_STEPS = 700;

function ringRadius( count: number ): number {
	return 120 + 18 * count;
}

export function randomSeed( random: () => number = Math.random ): Point {
	const angle = random() * Math.PI * 2;
	const r = 150 + random() * 250;
	return { x: Math.cos( angle ) * r, y: Math.sin( angle ) * r };
}

export function seedPositions(
	count: number,
	random: () => number = Math.random,
): Point[] {
	if ( count <= 0 ) {
		return [];
	}
	if ( count === 1 ) {
		return [ { x: 0, y: 0 } ];
	}
	if ( count <= SMALL_BOARD_MAX_NODES ) {
		const r = ringRadius( count );
		const out: Point[] = [];
		for ( let i = 0; i < count; i++ ) {
			const angle = Math.PI + ( i * Math.PI * 2 ) / count;
			out.push( {
				x: Math.cos( angle ) * r,
				y: Math.sin( angle ) * r,
			} );
		}
		return out;
	}
	const out: Point[] = [];
	let sx = 0;
	let sy = 0;
	for ( let i = 0; i < count; i++ ) {
		const p = randomSeed( random );
		out.push( p );
		sx += p.x;
		sy += p.y;
	}
	const cx = sx / count;
	const cy = sy / count;
	for ( const p of out ) {
		p.x -= cx;
		p.y -= cy;
	}
	return out;
}

export const JOIN_WARMUP_STEPS = 90;

export function warmupStepLimit( count: number ): number {
	if ( count <= SETTLE_ON_LOAD_MAX_NODES ) {
		return SETTLE_ON_LOAD_MAX_STEPS;
	}
	return JOIN_WARMUP_STEPS;
}

export interface Viewport {
	width: number;
	height: number;
}

export interface FrameOptions {

	padding: number;
	minScale: number;
	maxScale: number;
}

export interface CameraTarget {
	scale: number;
	x: number;
	y: number;
}

export function frameBounds(
	points: Iterable< Point >,
	viewport: Viewport,
	opts: FrameOptions,
): CameraTarget | null {
	if ( viewport.width <= 0 || viewport.height <= 0 ) {
		return null;
	}
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for ( const p of points ) {
		if ( p.x < minX ) {
			minX = p.x;
		}
		if ( p.y < minY ) {
			minY = p.y;
		}
		if ( p.x > maxX ) {
			maxX = p.x;
		}
		if ( p.y > maxY ) {
			maxY = p.y;
		}
	}
	if ( minX === Infinity ) {
		return null;
	}
	const w = maxX - minX + opts.padding * 2;
	const h = maxY - minY + opts.padding * 2;
	const sx = viewport.width / w;
	const sy = viewport.height / h;
	const scale = Math.max(
		opts.minScale,
		Math.min( opts.maxScale, Math.min( sx, sy ) ),
	);
	const cx = ( minX + maxX ) / 2;
	const cy = ( minY + maxY ) / 2;
	return {
		scale,
		x: viewport.width / 2 - cx * scale,
		y: viewport.height / 2 - cy * scale,
	};
}
