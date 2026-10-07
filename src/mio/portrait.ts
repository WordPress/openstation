import { chromaRing } from './chroma';
import { MIO_DEFAULTS } from './config';
import { TAU, shapeProfile } from './shape';
import type { MioConfig } from './types';

const RIM_SAMPLES = 72;

const RING_SAMPLES = 16;

const GLOW_SHELLS: readonly ( readonly [ number, number ] )[] = [
	[ 1, 0.1 ],
	[ 0.6, 0.14 ],
	[ 0.28, 0.2 ],
];

function fix( value: number ): string {
	const rounded = Number( value.toFixed( 2 ) );
	return ( Object.is( rounded, -0 ) ? 0 : rounded ).toFixed( 2 );
}

function hex( rgb: number ): string {
	const rgb24 = rgb & 0xffffff;
	return '#' + rgb24.toString( 16 ).padStart( 6, '0' );
}

export function portraitPath( config: MioConfig, radius: number ): string {
	const pts: [ number, number ][] = [];
	for ( let i = 0; i < RIM_SAMPLES; i++ ) {
		const angle = ( i / RIM_SAMPLES ) * TAU;
		const r = radius * shapeProfile( angle, config.physics );
		pts.push( [ r * Math.cos( angle ), r * Math.sin( angle ) ] );
	}
	const n = pts.length;
	const at = ( i: number ): [ number, number ] =>
		pts[ ( ( i % n ) + n ) % n ];
	let d = `M${ fix( pts[ 0 ][ 0 ] ) } ${ fix( pts[ 0 ][ 1 ] ) }`;
	for ( let i = 0; i < n; i++ ) {
		const p0 = at( i - 1 );
		const p1 = at( i );
		const p2 = at( i + 1 );
		const p3 = at( i + 2 );
		const c1x = p1[ 0 ] + ( p2[ 0 ] - p0[ 0 ] ) / 6;
		const c1y = p1[ 1 ] + ( p2[ 1 ] - p0[ 1 ] ) / 6;
		const c2x = p2[ 0 ] - ( p3[ 0 ] - p1[ 0 ] ) / 6;
		const c2y = p2[ 1 ] - ( p3[ 1 ] - p1[ 1 ] ) / 6;
		d +=
			`C${ fix( c1x ) } ${ fix( c1y ) },` +
			`${ fix( c2x ) } ${ fix( c2y ) },` +
			`${ fix( p2[ 0 ] ) } ${ fix( p2[ 1 ] ) }`;
	}
	return d + 'Z';
}

export function portraitExtent( config: MioConfig ): number {
	let max = 0;
	for ( let i = 0; i < RIM_SAMPLES; i++ ) {
		max = Math.max(
			max,
			shapeProfile( ( i / RIM_SAMPLES ) * TAU, config.physics ),
		);
	}
	return max;
}

export function mioPortraitSvg(
	config: Partial< MioConfig > = {},
	size: number = 96,
	idSuffix: string = '',
): string {
	const full: MioConfig = {
		appearance: { ...MIO_DEFAULTS.appearance, ...config.appearance },
		physics: { ...MIO_DEFAULTS.physics, ...config.physics },
	};
	const { appearance: a } = full;

	const radius = 100;
	const scale = radius / MIO_DEFAULTS.appearance.radius;
	const stroke = a.outlineWidth * scale;
	const liner = a.linerWidth * scale;

	const reach = ( a.glow / 10 ) * radius * 0.18;
	const half =
		radius * portraitExtent( full ) + stroke / 2 + reach * GLOW_SHELLS[ 0 ][ 0 ];
	const box = fix( half );
	const span = fix( half * 2 );

	const d = portraitPath( full, radius );
	const ring = chromaRing( RING_SAMPLES, 0, a );

	const uid = String( idSuffix ).replace( /[^A-Za-z0-9_-]/g, '' );
	const ringId = `r${ uid }`;
	const shapeId = `s${ uid }`;
	const clipId = `c${ uid }`;

	const stops = ring
		.map( ( rgb, i ) => {
			const offset = fix( ( i / ( ring.length - 1 ) ) * 100 );
			return `<stop offset="${ offset }%" stop-color="${ hex( rgb ) }"/>`;
		} )
		.join( '' );

	const glow = GLOW_SHELLS.map(
		( [ spread, alpha ] ) =>
			`<use href="#${ shapeId }" fill="none" stroke="url(#${ ringId })"` +
			` stroke-width="${ fix( stroke + reach * spread * 2 ) }"` +
			` stroke-opacity="${ fix( alpha ) }" stroke-linejoin="round"/>`,
	).join( '' );

	const eyeH = radius * a.eyeScale;
	const eyeW = eyeH * 0.46;
	const eyeGap = radius * 0.28;
	const eyeY = -radius * 0.02 - eyeH / 2;
	const eye = ( cx: number ): string =>
		`<rect x="${ fix( cx - eyeW / 2 ) }" y="${ fix( eyeY ) }"` +
		` width="${ fix( eyeW ) }" height="${ fix( eyeH ) }"` +
		` rx="${ fix( eyeW / 2 ) }" fill="${ hex( a.eyeColor ) }"/>`;

	const line =
		liner > 0
			? `<use href="#${ shapeId }" fill="none" stroke="${ hex( a.linerColor ) }"` +
				` stroke-width="${ fix( stroke + liner * 2 ) }"` +
				` stroke-linejoin="round" clip-path="url(#${ clipId })"/>`
			: '';

	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${ size }" height="${ size }"` +
		` viewBox="-${ box } -${ box } ${ span } ${ span }">` +
		`<defs><linearGradient id="${ ringId }" x1="0" y1="0" x2="0.85" y2="1">${ stops }</linearGradient>` +
		`<path id="${ shapeId }" d="${ d }"/>` +
		`<clipPath id="${ clipId }"><use href="#${ shapeId }"/></clipPath></defs>` +
		glow +
		`<use href="#${ shapeId }" fill="${ hex( a.bodyColor ) }"` +
		` fill-opacity="${ fix( a.bodyAlpha ) }"/>` +
		line +
		`<use href="#${ shapeId }" fill="none" stroke="url(#${ ringId })"` +
		` stroke-width="${ fix( stroke ) }" stroke-linejoin="round"/>` +
		eye( -eyeGap ) +
		eye( eyeGap ) +
		'</svg>'
	);
}

export function mioPortraitDataUri(
	config: Partial< MioConfig > = {},
	size: number = 96,
): string {
	const svg = mioPortraitSvg( config, size );

	const encoded =
		typeof btoa === 'function'
			? btoa( svg )
			: Buffer.from( svg, 'utf8' ).toString( 'base64' );
	return `data:image/svg+xml;base64,${ encoded }`;
}
