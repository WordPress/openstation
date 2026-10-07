import type { WallpaperSurface } from '../wallpapers/surfaces';

export interface Obstacle {
	id: string;
	kind: WallpaperSurface[ 'kind' ];

	face: WallpaperSurface[ 'face' ];
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
}

export interface LayerOrigin {
	left: number;
	top: number;
}

const MAGNET_KINDS: ReadonlySet< WallpaperSurface[ 'kind' ] > = new Set( [
	'window',
	'widget',
] );

const CHROME_KINDS: ReadonlySet< WallpaperSurface[ 'kind' ] > = new Set( [
	'dock',
	'shell',
] );

const FORBIDDEN_KINDS: ReadonlySet< WallpaperSurface[ 'kind' ] > = new Set( [
	'dock',
] );

export function chromeOnly( obstacles: readonly Obstacle[] ): Obstacle[] {
	return obstacles.filter( ( o ) => CHROME_KINDS.has( o.kind ) );
}

export function collectObstacles(
	surfaces: readonly WallpaperSurface[],
	origin: LayerOrigin,
	bounds?: { width: number; height: number },
): Obstacle[] {
	const out: Obstacle[] = [];
	for ( const surface of surfaces ) {
		const r = surface.rect;
		if ( ! r || r.width <= 0 || r.height <= 0 ) {
			continue;
		}
		let x = r.x - origin.left;
		let y = r.y - origin.top;
		let width = r.width;
		let height = r.height;

		if ( bounds && CHROME_KINDS.has( surface.kind ) ) {
			if ( 'right' === surface.face ) {
				width = x + width;
				x = 0;
			} else if ( 'left' === surface.face ) {
				width = Math.max( width, bounds.width - x );
			} else if ( 'top' === surface.face ) {
				height = Math.max( height, bounds.height - y );
			} else {
				height = y + height;
				y = 0;
			}
		}

		out.push( {
			id: surface.id,
			kind: surface.kind,
			face: surface.face,
			x,
			y,
			width,
			height,
		} );
	}
	return out;
}

export function clampOutsideChrome(
	point: { x: number; y: number },
	radius: number,
	obstacles: readonly Obstacle[],
): { x: number; y: number } {
	let { x, y } = point;
	for ( const o of obstacles ) {
		if ( ! FORBIDDEN_KINDS.has( o.kind ) ) {
			continue;
		}
		if (
			x <= o.x - radius ||
			x >= o.x + o.width + radius ||
			y <= o.y - radius ||
			y >= o.y + o.height + radius
		) {
			continue;
		}
		( { x, y } = outsideFace( o, x, y, radius ) );
	}
	return { x, y };
}

function outsideFace(
	o: Obstacle,
	px: number,
	py: number,
	clear: number,
): { x: number; y: number } {
	if ( 'right' === o.face ) {
		return { x: o.x + o.width + clear, y: py };
	}
	if ( 'left' === o.face ) {
		return { x: o.x - clear, y: py };
	}
	if ( 'top' === o.face ) {
		return { x: px, y: o.y - clear };
	}
	return { x: px, y: o.y + o.height + clear };
}

export function distanceToObstacle(
	px: number,
	py: number,
	o: Obstacle,
): number {
	const dx = Math.max( o.x - px, 0, px - ( o.x + o.width ) );
	const dy = Math.max( o.y - py, 0, py - ( o.y + o.height ) );
	return Math.hypot( dx, dy );
}

export function closestPointOn(
	px: number,
	py: number,
	o: Obstacle,
): { x: number; y: number } {
	return {
		x: Math.min( Math.max( px, o.x ), o.x + o.width ),
		y: Math.min( Math.max( py, o.y ), o.y + o.height ),
	};
}

export interface MagnetPull {

	dx: number;
	dy: number;

	strength: number;

	gap: number;
}

export function magnetPull(
	px: number,
	py: number,
	radius: number,
	obstacles: readonly Obstacle[],
	range: number,
): MagnetPull | null {
	if ( range <= 0 ) {
		return null;
	}
	let nearest: Obstacle | null = null;
	let nearestDistance = Infinity;
	for ( const o of obstacles ) {
		if ( ! MAGNET_KINDS.has( o.kind ) ) {
			continue;
		}
		const d = distanceToObstacle( px, py, o );
		if ( d < nearestDistance ) {
			nearestDistance = d;
			nearest = o;
		}
	}
	if ( ! nearest ) {
		return null;
	}

	const gap = nearestDistance - radius;
	if ( gap >= range ) {
		return null;
	}

	const t = 1 - Math.max( gap, 0 ) / range;
	const strength = t * t * ( 3 - 2 * t );

	const target = closestPointOn( px, py, nearest );
	const dx = target.x - px;
	const dy = target.y - py;
	const len = Math.hypot( dx, dy );
	if ( len < 1e-3 ) {
		return { dx: 0, dy: 0, strength, gap };
	}
	return { dx: dx / len, dy: dy / len, strength, gap };
}

export function clusterBounds(
	seed: Obstacle,
	obstacles: readonly Obstacle[],
	pad = 8,
): { x: number; y: number; width: number; height: number } {
	let minX = seed.x;
	let minY = seed.y;
	let maxX = seed.x + seed.width;
	let maxY = seed.y + seed.height;

	const remaining = obstacles.filter(
		( o ) => MAGNET_KINDS.has( o.kind ) && o !== seed,
	);
	let grew = true;
	while ( grew ) {
		grew = false;
		for ( let i = remaining.length - 1; i >= 0; i-- ) {
			const o = remaining[ i ];
			const overlaps =
				o.x < maxX + pad &&
				o.x + o.width > minX - pad &&
				o.y < maxY + pad &&
				o.y + o.height > minY - pad;
			if ( ! overlaps ) {
				continue;
			}
			minX = Math.min( minX, o.x );
			minY = Math.min( minY, o.y );
			maxX = Math.max( maxX, o.x + o.width );
			maxY = Math.max( maxY, o.y + o.height );
			remaining.splice( i, 1 );
			grew = true;
		}
	}

	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

const TRAPPED_DEPTH_FACTOR = 0.75;

export function findEscape(
	px: number,
	py: number,
	radius: number,
	obstacles: readonly Obstacle[],
	bounds: { width: number; height: number },
): { x: number; y: number } | null {
	for ( const o of obstacles ) {
		if ( ! FORBIDDEN_KINDS.has( o.kind ) ) {
			continue;
		}
		if (
			px <= o.x ||
			px >= o.x + o.width ||
			py <= o.y ||
			py >= o.y + o.height
		) {
			continue;
		}
		const out = outsideFace( o, px, py, radius + 8 );
		return {
			x: Math.min( Math.max( out.x, radius ), Math.max( radius, bounds.width - radius ) ),
			y: Math.min( Math.max( out.y, radius ), Math.max( radius, bounds.height - radius ) ),
		};
	}

	const minDepth = radius * TRAPPED_DEPTH_FACTOR;
	let trappedIn: Obstacle | null = null;
	let deepest = minDepth;
	for ( const o of obstacles ) {
		if ( ! MAGNET_KINDS.has( o.kind ) ) {
			continue;
		}

		const depth = Math.min(
			px - o.x,
			o.x + o.width - px,
			py - o.y,
			o.y + o.height - py,
		);
		if ( depth > deepest ) {
			deepest = depth;
			trappedIn = o;
		}
	}
	if ( ! trappedIn ) {
		return null;
	}

	const cluster = clusterBounds( trappedIn, obstacles );
	const margin = radius + 8;
	const midX = cluster.x + cluster.width / 2;
	const midY = cluster.y + cluster.height / 2;

	const candidates = [
		{ x: midX, y: cluster.y - margin },
		{ x: midX, y: cluster.y + cluster.height + margin },
		{ x: cluster.x - margin, y: midY },
		{ x: cluster.x + cluster.width + margin, y: midY },
	].filter(
		( c ) =>
			c.x >= radius &&
			c.y >= radius &&
			c.x <= bounds.width - radius &&
			c.y <= bounds.height - radius,
	);

	if ( candidates.length > 0 ) {
		let best = candidates[ 0 ];
		let bestDistance = Infinity;
		for ( const c of candidates ) {
			const d = Math.hypot( c.x - px, c.y - py );
			if ( d < bestDistance ) {
				bestDistance = d;
				best = c;
			}
		}
		return best;
	}

	const gaps = [
		{ size: cluster.y, x: midX, y: cluster.y / 2 },
		{
			size: bounds.height - ( cluster.y + cluster.height ),
			x: midX,
			y: ( cluster.y + cluster.height + bounds.height ) / 2,
		},
		{ size: cluster.x, x: cluster.x / 2, y: midY },
		{
			size: bounds.width - ( cluster.x + cluster.width ),
			x: ( cluster.x + cluster.width + bounds.width ) / 2,
			y: midY,
		},
	].sort( ( a, b ) => b.size - a.size );

	const widest = gaps[ 0 ];
	if ( widest && widest.size >= radius ) {
		return { x: widest.x, y: widest.y };
	}
	return { x: bounds.width / 2, y: bounds.height / 2 };
}

export function resolveObstacleCollisions(
	p: Particle,
	obstacles: readonly Obstacle[],
	restitution: number,
	friction: number,
): boolean {
	let touched = false;
	for ( const o of obstacles ) {
		const right = o.x + o.width;
		const bottom = o.y + o.height;
		if ( p.x <= o.x || p.x >= right || p.y <= o.y || p.y >= bottom ) {
			continue;
		}
		const fromLeft = p.x - o.x;
		const fromRight = right - p.x;
		const fromTop = p.y - o.y;
		const fromBottom = bottom - p.y;
		const min = Math.min( fromLeft, fromRight, fromTop, fromBottom );
		touched = true;

		if ( min === fromTop ) {
			p.y = o.y;
			if ( p.vy > 0 ) {
				p.vy = -p.vy * restitution;
			}
			p.vx *= friction;
		} else if ( min === fromBottom ) {
			p.y = bottom;
			if ( p.vy < 0 ) {
				p.vy = -p.vy * restitution;
			}
			p.vx *= friction;
		} else if ( min === fromLeft ) {
			p.x = o.x;
			if ( p.vx > 0 ) {
				p.vx = -p.vx * restitution;
			}
			p.vy *= friction;
		} else {
			p.x = right;
			if ( p.vx < 0 ) {
				p.vx = -p.vx * restitution;
			}
			p.vy *= friction;
		}
	}
	return touched;
}

export function clampToBounds(
	p: Particle,
	width: number,
	height: number,
	restitution: number,
	friction: number,
): boolean {
	let touched = false;
	if ( p.x < 0 ) {
		p.x = 0;
		if ( p.vx < 0 ) {
			p.vx = -p.vx * restitution;
		}
		p.vy *= friction;
		touched = true;
	} else if ( p.x > width ) {
		p.x = width;
		if ( p.vx > 0 ) {
			p.vx = -p.vx * restitution;
		}
		p.vy *= friction;
		touched = true;
	}
	if ( p.y < 0 ) {
		p.y = 0;
		if ( p.vy < 0 ) {
			p.vy = -p.vy * restitution;
		}
		p.vx *= friction;
		touched = true;
	} else if ( p.y > height ) {
		p.y = height;
		if ( p.vy > 0 ) {
			p.vy = -p.vy * restitution;
		}
		p.vx *= friction;
		touched = true;
	}
	return touched;
}
