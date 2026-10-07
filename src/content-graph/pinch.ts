export interface Camera {

	scale: number;

	x: number;

	y: number;
}

export interface Point {
	x: number;
	y: number;
}

export interface PointerPair {
	a: Point;
	b: Point;
}

export interface ZoomBounds {
	min: number;
	max: number;
}

function distance( pair: PointerPair ): number {
	return Math.hypot( pair.b.x - pair.a.x, pair.b.y - pair.a.y );
}

function midpoint( pair: PointerPair ): Point {
	return { x: ( pair.a.x + pair.b.x ) / 2, y: ( pair.a.y + pair.b.y ) / 2 };
}

export function pinchCamera(
	camera: Camera,
	prev: PointerPair,
	next: PointerPair,
	bounds: ZoomBounds,
): Camera {
	const prevDistance = distance( prev );
	const nextDistance = distance( next );
	const factor = prevDistance > 0 && nextDistance > 0 ? nextDistance / prevDistance : 1;
	const scale = Math.max( bounds.min, Math.min( bounds.max, camera.scale * factor ) );

	const from = midpoint( prev );
	const to = midpoint( next );

	const worldX = ( from.x - camera.x ) / camera.scale;
	const worldY = ( from.y - camera.y ) / camera.scale;

	return {
		scale,
		x: to.x - worldX * scale,
		y: to.y - worldY * scale,
	};
}
