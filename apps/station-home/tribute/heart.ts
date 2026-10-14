/**
 * Station Home tribute — heart geometry.
 *
 * Pure maths for `<os-tribute-heart>`: the classic parametric heart
 * resampled by arc length, a fit that sizes it around a box of text,
 * and the mapping that sends every pixel of the small filled glyph to
 * a place on the large outline. Kept DOM-free so it can be tested on
 * its own.
 *
 * Coordinates are screen-oriented (y grows downwards). The unit heart
 * is one unit wide and centred on its bounding box.
 */

export interface Vec {
	x: number;
	y: number;
}

export interface HeartOutline {
	/** The point at arc-length fraction `u` (wraps). */
	at( u: number ): Vec;
	/** The outward unit normal at arc-length fraction `u` (wraps). */
	normal( u: number ): Vec;
	/** The arc-length fraction whose point lies closest to polar angle `angle`. */
	uAtAngle( angle: number ): number;
	/** The resampled outline, for hit tests. */
	polygon: Vec[];
	/** Height over width. */
	aspect: number;
}

export interface HeartFit {
	/** Heart width, in the units of the box. */
	width: number;
	/** Box centre minus heart centre, along y. */
	offsetY: number;
}

export interface OutlineSlot {
	/** Arc-length fraction on the outline. */
	u: number;
	/** Across the stroke: -1 inner edge, 1 outer edge. */
	band: number;
}

const SAMPLES = 720;

/**
 * The heart curve x = 16 sin³t, y = 13 cos t − 3.5 cos 2t − 1.5 cos 3t − 0.6 cos 4t,
 * flipped for screen space. t = 0 is the dip between the lobes and the
 * curve runs clockwise on screen.
 *
 * The classic curve's harmonics are 5, 2 and 1; softened here so the
 * dip between the lobes is shallow. A deep dip pushes down into the
 * text the heart holds, which forces the whole heart larger.
 *
 * @param t Curve parameter.
 */
function rawHeart( t: number ): Vec {
	const s = Math.sin( t );
	return {
		x: 16 * s * s * s,
		y: -( 13 * Math.cos( t ) - 3.5 * Math.cos( 2 * t ) - 1.5 * Math.cos( 3 * t ) - 0.6 * Math.cos( 4 * t ) ),
	};
}

function wrap( u: number ): number {
	return u - Math.floor( u );
}

/**
 * Build the unit heart outline, resampled so equal steps of `u` are
 * equal steps along the curve.
 */
export function createHeartOutline(): HeartOutline {
	const dense = 4096;
	const raw: Vec[] = [];
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for ( let i = 0; i < dense; i++ ) {
		const p = rawHeart( ( i / dense ) * Math.PI * 2 );
		raw.push( p );
		minX = Math.min( minX, p.x );
		maxX = Math.max( maxX, p.x );
		minY = Math.min( minY, p.y );
		maxY = Math.max( maxY, p.y );
	}
	const width = maxX - minX;
	const cx = ( minX + maxX ) / 2;
	const cy = ( minY + maxY ) / 2;
	const unit = raw.map( ( p ) => ( { x: ( p.x - cx ) / width, y: ( p.y - cy ) / width } ) );

	const lengths = [ 0 ];
	for ( let i = 1; i <= dense; i++ ) {
		const a = unit[ i - 1 ];
		const b = unit[ i % dense ];
		lengths.push( lengths[ i - 1 ] + Math.hypot( b.x - a.x, b.y - a.y ) );
	}
	const total = lengths[ dense ];

	const polygon: Vec[] = [];
	let j = 0;
	for ( let k = 0; k < SAMPLES; k++ ) {
		const target = ( k / SAMPLES ) * total;
		while ( lengths[ j + 1 ] < target ) {
			j++;
		}
		const span = lengths[ j + 1 ] - lengths[ j ] || 1;
		const f = ( target - lengths[ j ] ) / span;
		const a = unit[ j ];
		const b = unit[ ( j + 1 ) % dense ];
		polygon.push( { x: a.x + ( b.x - a.x ) * f, y: a.y + ( b.y - a.y ) * f } );
	}

	const angles = polygon.map( ( p ) => Math.atan2( p.y, p.x ) );

	const at = ( u: number ): Vec => {
		const pos = wrap( u ) * SAMPLES;
		const i = Math.floor( pos ) % SAMPLES;
		const f = pos - Math.floor( pos );
		const a = polygon[ i ];
		const b = polygon[ ( i + 1 ) % SAMPLES ];
		return { x: a.x + ( b.x - a.x ) * f, y: a.y + ( b.y - a.y ) * f };
	};

	return {
		at,
		normal( u: number ): Vec {
			const e = 1 / SAMPLES;
			const a = at( u - e );
			const b = at( u + e );
			const tx = b.x - a.x;
			const ty = b.y - a.y;
			const len = Math.hypot( tx, ty ) || 1;
			// Clockwise on screen, so the outward side is the tangent turned left.
			return { x: ty / len, y: -tx / len };
		},
		uAtAngle( angle: number ): number {
			let best = 0;
			let bestDiff = Infinity;
			for ( let k = 0; k < SAMPLES; k++ ) {
				const d = Math.abs( Math.atan2( Math.sin( angles[ k ] - angle ), Math.cos( angles[ k ] - angle ) ) );
				if ( d < bestDiff ) {
					bestDiff = d;
					best = k;
				}
			}
			return best / SAMPLES;
		},
		polygon,
		aspect: ( maxY - minY ) / width,
	};
}

/**
 * Whether a point lies inside a polygon (even-odd rule).
 *
 * @param p       The point.
 * @param polygon The polygon.
 */
export function insidePolygon( p: Vec, polygon: Vec[] ): boolean {
	let inside = false;
	for ( let i = 0, j = polygon.length - 1; i < polygon.length; j = i++ ) {
		const a = polygon[ i ];
		const b = polygon[ j ];
		if ( ( a.y > p.y ) !== ( b.y > p.y ) && p.x < ( ( b.x - a.x ) * ( p.y - a.y ) ) / ( b.y - a.y ) + a.x ) {
			inside = ! inside;
		}
	}
	return inside;
}

function boxFits( outline: HeartOutline, w: number, h: number, width: number, offsetY: number ): boolean {
	const steps = 8;
	for ( let i = 0; i <= steps; i++ ) {
		const f = i / steps - 0.5;
		const edges: Vec[] = [
			{ x: f * w, y: offsetY - h / 2 },
			{ x: f * w, y: offsetY + h / 2 },
			{ x: -w / 2, y: offsetY + f * h },
			{ x: w / 2, y: offsetY + f * h },
		];
		for ( const e of edges ) {
			if ( ! insidePolygon( { x: e.x / width, y: e.y / width }, outline.polygon ) ) {
				return false;
			}
		}
	}
	return true;
}

/**
 * The smallest heart that holds a `w` × `h` box, and where the box
 * sits inside it.
 *
 * @param outline The unit outline.
 * @param w       Box width.
 * @param h       Box height.
 */
export function fitHeartAround( outline: HeartOutline, w: number, h: number ): HeartFit {
	let best: HeartFit = { width: Infinity, offsetY: 0 };
	const size = Math.max( w, h, 1 );
	for ( let s = -12; s <= 12; s++ ) {
		// Offsets as a fraction of the heart width, so they scale with it.
		const rel = ( s / 12 ) * 0.2;
		let lo = size;
		let hi = size * 8;
		if ( ! boxFits( outline, w, h, hi, rel * hi ) ) {
			continue;
		}
		for ( let k = 0; k < 28; k++ ) {
			const mid = ( lo + hi ) / 2;
			if ( boxFits( outline, w, h, mid, rel * mid ) ) {
				hi = mid;
			} else {
				lo = mid;
			}
		}
		if ( hi < best.width ) {
			best = { width: hi, offsetY: rel * hi };
		}
	}
	return best;
}

/**
 * Give every pixel of a filled shape a place on the outline.
 *
 * Pixels are walked clockwise by polar angle and spread evenly along
 * the outline, starting where the first one points, so the left lobe
 * lands on the left lobe and the tip on the tip. Across the stroke,
 * the pixels farthest from the centre in their direction take the
 * outer edge.
 *
 * @param outline The unit outline.
 * @param points  Pixel offsets from the shape's centre, any scale.
 */
export function mapToOutline( outline: HeartOutline, points: Vec[] ): OutlineSlot[] {
	const n = points.length;
	if ( 0 === n ) {
		return [];
	}
	const angles = points.map( ( p ) => Math.atan2( p.y, p.x ) );
	const order = points.map( ( _, i ) => i ).sort( ( a, b ) => angles[ a ] - angles[ b ] );
	const start = outline.uAtAngle( angles[ order[ 0 ] ] );

	const slots: OutlineSlot[] = new Array( n );
	order.forEach( ( index, rank ) => {
		slots[ index ] = { u: wrap( start + rank / n ), band: 0 };
	} );

	const buckets = 48;
	const groups: number[][] = Array.from( { length: buckets }, () => [] );
	points.forEach( ( _, i ) => {
		const b = Math.floor( ( ( angles[ i ] + Math.PI ) / ( Math.PI * 2 ) ) * buckets ) % buckets;
		groups[ b ].push( i );
	} );
	for ( const group of groups ) {
		group.sort( ( a, b ) => Math.hypot( points[ a ].x, points[ a ].y ) - Math.hypot( points[ b ].x, points[ b ].y ) );
		group.forEach( ( index, rank ) => {
			slots[ index ].band = group.length > 1 ? ( 2 * rank ) / ( group.length - 1 ) - 1 : 0;
		} );
	}
	return slots;
}
