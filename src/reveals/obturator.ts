import type { WindowRevealRenderContext, WindowRevealRendered } from './types';

const WEDGES = 6;

const VIEW = 100;
const CENTRE = VIEW / 2;

const WEDGE_RADIUS = 200;

const WEDGE_SLIDE = 90;

const WEDGE_SHADES = [
	'#5c5c6d',
	'#525261',
	'#484855',
	'#3e3e49',
	'#34343d',
	'#2a2a31',
];

const SEAM_COLOR = '#101014';

const SEAM_WIDTH = 1.25;

const SVG_NS = 'http://www.w3.org/2000/svg';

let uid = 0;

function round( n: number ): number {
	return Math.round( n * 1000 ) / 1000;
}

function wedgeBearing( index: number ): number {
	return ( index / WEDGES ) * Math.PI * 2 - Math.PI / 2;
}

function slideVector( index: number ): { x: number; y: number } {
	const bisector = wedgeBearing( index ) + Math.PI / WEDGES;
	const tangent = bisector + Math.PI / 2;
	return { x: Math.cos( tangent ), y: Math.sin( tangent ) };
}

function wedgeCorners( index: number ): [ number, number ][] {
	const a = wedgeBearing( index );
	const b = wedgeBearing( index + 1 );
	return [
		[ CENTRE, CENTRE ],
		[
			CENTRE + Math.cos( a ) * WEDGE_RADIUS,
			CENTRE + Math.sin( a ) * WEDGE_RADIUS,
		],
		[
			CENTRE + Math.cos( b ) * WEDGE_RADIUS,
			CENTRE + Math.sin( b ) * WEDGE_RADIUS,
		],
	];
}

export function _obturatorCoversForTests(
	index: number,
	t: number,
	x: number,
	y: number,
): boolean {
	const slide = slideVector( index );
	const dx = slide.x * WEDGE_SLIDE * t;
	const dy = slide.y * WEDGE_SLIDE * t;
	const [ p0, p1, p2 ] = wedgeCorners( index ).map(
		( [ cx, cy ] ) => [ cx + dx, cy + dy ] as [ number, number ],
	);

	const EPSILON = 1e-6;
	const side = (
		a: [ number, number ],
		b: [ number, number ],
	): number =>
		( b[ 0 ] - a[ 0 ] ) * ( y - a[ 1 ] ) - ( b[ 1 ] - a[ 1 ] ) * ( x - a[ 0 ] );
	const s0 = side( p0, p1 );
	const s1 = side( p1, p2 );
	const s2 = side( p2, p0 );
	return (
		( s0 >= -EPSILON && s1 >= -EPSILON && s2 >= -EPSILON ) ||
		( s0 <= EPSILON && s1 <= EPSILON && s2 <= EPSILON )
	);
}

function wedgeElement( index: number, masked: boolean ): SVGPathElement {
	const corners = wedgeCorners( index );
	const path = document.createElementNS( SVG_NS, 'path' );
	path.setAttribute(
		'd',
		`M ${ corners
			.map( ( [ x, y ] ) => `${ round( x ) } ${ round( y ) }` )
			.join( ' L ' ) } Z`,
	);
	if ( masked ) {
		path.setAttribute( 'fill', '#fff' );
	} else {
		path.setAttribute( 'fill', WEDGE_SHADES[ index % WEDGE_SHADES.length ] );
		path.setAttribute( 'stroke', SEAM_COLOR );
		path.setAttribute( 'stroke-width', String( SEAM_WIDTH ) );

		path.setAttribute( 'vector-effect', 'non-scaling-stroke' );
		path.setAttribute( 'stroke-linejoin', 'round' );
	}
	return path;
}

export function renderObturator(): WindowRevealRendered {
	const maskId = `os-iris-${ ++uid }`;

	const svg = document.createElementNS( SVG_NS, 'svg' );
	svg.setAttribute( 'viewBox', `0 0 ${ VIEW } ${ VIEW }` );

	svg.setAttribute( 'preserveAspectRatio', 'none' );
	svg.setAttribute( 'aria-hidden', 'true' );
	svg.style.width = '100%';
	svg.style.height = '100%';
	svg.style.display = 'block';

	const defs = document.createElementNS( SVG_NS, 'defs' );
	const mask = document.createElementNS( SVG_NS, 'mask' );
	mask.setAttribute( 'id', maskId );
	const maskGroup = document.createElementNS( SVG_NS, 'g' );

	const group = document.createElementNS( SVG_NS, 'g' );
	group.setAttribute( 'mask', `url(#${ maskId })` );

	const moving: { el: SVGPathElement; index: number }[] = [];
	for ( let i = 0; i < WEDGES; i++ ) {
		const inMask = wedgeElement( i, true );
		const visible = wedgeElement( i, false );
		maskGroup.appendChild( inMask );
		group.appendChild( visible );
		moving.push( { el: inMask, index: i }, { el: visible, index: i } );
	}

	mask.appendChild( maskGroup );
	defs.appendChild( mask );
	svg.appendChild( defs );
	svg.appendChild( group );

	const host = document.createElement( 'div' );
	host.appendChild( svg );

	return {
		element: host,
		play: ( ctx: WindowRevealRenderContext ): Animation[] =>
			moving.map( ( { el, index } ) => {
				const slide = slideVector( index );
				const dx = round( slide.x * WEDGE_SLIDE );
				const dy = round( slide.y * WEDGE_SLIDE );
				return el.animate(
					[
						{ transform: 'translate( 0px, 0px )' },
						{ transform: `translate( ${ dx }px, ${ dy }px )` },
					],
					{
						duration: ctx.duration,
						easing: ctx.easing,
						delay: ctx.delay,

						fill: 'both',
					},
				);
			} ),
	};
}
