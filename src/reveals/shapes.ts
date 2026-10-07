export type RevealPoint = readonly [ number, number ];

const OUTER: readonly RevealPoint[] = [
	[ 0, 0 ],
	[ 100, 0 ],
	[ 100, 100 ],
	[ 0, 100 ],
];

const IRIS_SEGMENTS = 48;

const IRIS_MAX_RADIUS = 80;

const BLIND_SLATS = 6;

const VERTICAL_SLATS = 8;

const MOSAIC_COLS = 4;
const MOSAIC_ROWS = 3;

const RADAR_SEGMENTS = 64;

const CORNER_REACH = 105;

const OVERSHOOT = 2;

function pct( n: number ): string {
	return `${ Math.round( n * 1000 ) / 1000 }%`;
}

function reverse( ring: readonly RevealPoint[] ): readonly RevealPoint[] {
	return ring.slice().reverse();
}

function rect( x0: number, y0: number, x1: number, y1: number ): readonly RevealPoint[] {
	return [
		[ x0, y0 ],
		[ x1, y0 ],
		[ x1, y1 ],
		[ x0, y1 ],
	];
}

function circle(
	cx: number,
	cy: number,
	r: number,
	segments: number,
): readonly RevealPoint[] {
	const out: RevealPoint[] = [];
	for ( let i = 0; i < segments; i++ ) {
		const angle = ( i / segments ) * Math.PI * 2;
		out.push( [ cx + Math.cos( angle ) * r, cy + Math.sin( angle ) * r ] );
	}
	return out;
}

export function polygonWithHoles(
	outer: readonly RevealPoint[],
	holes: readonly ( readonly RevealPoint[] )[] = [],
): string {
	const parts: string[] = [];
	const push = ( p: RevealPoint ): void => {
		parts.push( `${ pct( p[ 0 ] ) } ${ pct( p[ 1 ] ) }` );
	};

	for ( const p of outer ) {
		push( p );
	}
	if ( holes.length > 0 ) {
		push( outer[ 0 ] );
		for ( const hole of holes ) {
			for ( const p of hole ) {
				push( p );
			}
			push( hole[ 0 ] );
			push( outer[ 0 ] );
		}
	}

	return `polygon( ${ parts.join( ', ' ) } )`;
}

export function irisSurface( r: number ): string {
	return polygonWithHoles( OUTER, [
		reverse( circle( 50, 50, r, IRIS_SEGMENTS ) ),
	] );
}

export function curtainSurface( halfWidth: number ): string {
	return polygonWithHoles( OUTER, [
		reverse(
			rect( 50 - halfWidth, -OVERSHOOT, 50 + halfWidth, 100 + OVERSHOOT ),
		),
	] );
}

export function blindsSurface( height: number ): string {
	const band = 100 / BLIND_SLATS;
	const holes: ( readonly RevealPoint[] )[] = [];
	for ( let i = 0; i < BLIND_SLATS; i++ ) {
		const top = i * band;
		holes.push(
			reverse(
				rect( -OVERSHOOT, top, 100 + OVERSHOOT, top + height ),
			),
		);
	}
	return polygonWithHoles( OUTER, holes );
}

export function shutterSurface( halfHeight: number ): string {
	return polygonWithHoles( OUTER, [
		reverse(
			rect( -OVERSHOOT, 50 - halfHeight, 100 + OVERSHOOT, 50 + halfHeight ),
		),
	] );
}

export function slatsSurface( width: number ): string {
	const band = 100 / VERTICAL_SLATS;
	const holes: ( readonly RevealPoint[] )[] = [];
	for ( let i = 0; i < VERTICAL_SLATS; i++ ) {
		const left = i * band;
		holes.push(
			reverse( rect( left, -OVERSHOOT, left + width, 100 + OVERSHOOT ) ),
		);
	}
	return polygonWithHoles( OUTER, holes );
}

export function diamondSurface( r: number ): string {
	return polygonWithHoles( OUTER, [
		reverse( [
			[ 50, 50 - r ],
			[ 50 + r, 50 ],
			[ 50, 50 + r ],
			[ 50 - r, 50 ],
		] ),
	] );
}

export function mosaicSurface( scale: number ): string {
	const cellW = 100 / MOSAIC_COLS;
	const cellH = 100 / MOSAIC_ROWS;
	const holes: ( readonly RevealPoint[] )[] = [];
	for ( let row = 0; row < MOSAIC_ROWS; row++ ) {
		for ( let col = 0; col < MOSAIC_COLS; col++ ) {
			const cx = col * cellW + cellW / 2;
			const cy = row * cellH + cellH / 2;
			const halfW = ( cellW / 2 ) * scale;
			const halfH = ( cellH / 2 ) * scale;
			holes.push(
				reverse(
					rect( cx - halfW, cy - halfH, cx + halfW, cy + halfH ),
				),
			);
		}
	}
	return polygonWithHoles( OUTER, holes );
}

export function radarSurface( angleDeg: number ): string {
	const start = -Math.PI / 2;
	const sweep = ( angleDeg / 180 ) * Math.PI;
	const arc: RevealPoint[] = [ [ 50, 50 ] ];
	for ( let i = 0; i < RADAR_SEGMENTS; i++ ) {
		const angle = start + ( i / ( RADAR_SEGMENTS - 1 ) ) * sweep;
		arc.push( [
			50 + Math.cos( angle ) * CORNER_REACH,
			50 + Math.sin( angle ) * CORNER_REACH,
		] );
	}
	return polygonWithHoles( OUTER, [ reverse( arc ) ] );
}

export function irisPair(): { from: string; to: string } {
	return { from: irisSurface( 0 ), to: irisSurface( IRIS_MAX_RADIUS ) };
}

export function curtainPair(): { from: string; to: string } {
	return { from: curtainSurface( 0 ), to: curtainSurface( 52 ) };
}

export function blindsPair(): { from: string; to: string } {
	return {
		from: blindsSurface( 0 ),
		to: blindsSurface( 100 / BLIND_SLATS + 0.5 ),
	};
}

export function shutterPair(): { from: string; to: string } {
	return { from: shutterSurface( 0 ), to: shutterSurface( 52 ) };
}

export function slatsPair(): { from: string; to: string } {
	return {
		from: slatsSurface( 0 ),
		to: slatsSurface( 100 / VERTICAL_SLATS + 0.5 ),
	};
}

export function diamondPair(): { from: string; to: string } {
	return { from: diamondSurface( 0 ), to: diamondSurface( CORNER_REACH ) };
}

export function mosaicPair(): { from: string; to: string } {
	return { from: mosaicSurface( 0 ), to: mosaicSurface( 1.04 ) };
}

export function radarPair(): { from: string; to: string } {
	return { from: radarSurface( 0 ), to: radarSurface( 360 ) };
}

export function risePair(): { from: string; to: string } {
	return { from: 'inset( 0% 0% 0% 0% )', to: 'inset( 0% 0% 100% 0% )' };
}

export function sweepPair(): { from: string; to: string } {
	return { from: 'inset( 0% 0% 0% 0% )', to: 'inset( 0% 0% 0% 100% )' };
}

export function diagonalPair(): { from: string; to: string } {
	return {
		from: polygonWithHoles( [
			[ -60, 0 ],
			[ 100, 0 ],
			[ 100, 100 ],
			[ 0, 100 ],
		] ),
		to: polygonWithHoles( [
			[ 100, 0 ],
			[ 260, 0 ],
			[ 260, 100 ],
			[ 160, 100 ],
		] ),
	};
}
