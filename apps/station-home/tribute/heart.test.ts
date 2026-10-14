import { describe, expect, it } from 'vitest';
import { createHeartOutline, fitHeartAround, insidePolygon, mapToOutline } from './heart';

describe( 'createHeartOutline', () => {
	const outline = createHeartOutline();

	it( 'is one unit wide and centred on its bounding box', () => {
		const xs = outline.polygon.map( ( p ) => p.x );
		const ys = outline.polygon.map( ( p ) => p.y );
		expect( Math.max( ...xs ) - Math.min( ...xs ) ).toBeCloseTo( 1, 2 );
		expect( Math.max( ...xs ) + Math.min( ...xs ) ).toBeCloseTo( 0, 2 );
		expect( Math.max( ...ys ) + Math.min( ...ys ) ).toBeCloseTo( 0, 2 );
		// Squatter than the classic curve's 0.9: the dip is shallow.
		expect( outline.aspect ).toBeGreaterThan( 0.78 );
		expect( outline.aspect ).toBeLessThan( 0.88 );
	} );

	it( 'is sampled at even steps along the curve', () => {
		const steps = outline.polygon.map( ( p, i ) => {
			const q = outline.polygon[ ( i + 1 ) % outline.polygon.length ];
			return Math.hypot( q.x - p.x, q.y - p.y );
		} );
		expect( Math.max( ...steps ) / Math.min( ...steps ) ).toBeLessThan( 1.05 );
	} );

	it( 'starts at the dip, points down at the tip, and wraps', () => {
		expect( outline.at( 0 ).x ).toBeCloseTo( 0, 3 );
		expect( outline.at( 0.5 ).y ).toBeGreaterThan( 0.4 );
		expect( outline.at( 1.25 ).x ).toBeCloseTo( outline.at( 0.25 ).x, 6 );
	} );

	it( 'has outward normals', () => {
		// Right side faces right, the tip faces down.
		expect( outline.normal( 0.25 ).x ).toBeGreaterThan( 0.5 );
		expect( outline.normal( 0.5 ).y ).toBeGreaterThan( 0.5 );
		for ( const u of [ 0.1, 0.3, 0.6, 0.85 ] ) {
			const p = outline.at( u );
			const n = outline.normal( u );
			expect( insidePolygon( { x: p.x + n.x * 0.02, y: p.y + n.y * 0.02 }, outline.polygon ) ).toBe( false );
			expect( insidePolygon( { x: p.x - n.x * 0.02, y: p.y - n.y * 0.02 }, outline.polygon ) ).toBe( true );
		}
	} );
} );

describe( 'fitHeartAround', () => {
	const outline = createHeartOutline();

	it( 'holds the whole box, and only just', () => {
		const w = 40;
		const h = 20;
		const fit = fitHeartAround( outline, w, h );
		const corners = [
			[ -w / 2, -h / 2 ],
			[ w / 2, -h / 2 ],
			[ -w / 2, h / 2 ],
			[ w / 2, h / 2 ],
			[ 0, -h / 2 ],
		];
		for ( const [ x, y ] of corners ) {
			expect( insidePolygon( { x: x / fit.width, y: ( y + fit.offsetY ) / fit.width }, outline.polygon ) ).toBe( true );
		}
		const smaller = fit.width * 0.97;
		const anyOut = corners.some( ( [ x, y ] ) => ! insidePolygon( { x: x / smaller, y: ( y + fit.offsetY ) / smaller }, outline.polygon ) );
		expect( anyOut ).toBe( true );
	} );

	it( 'grows with the box', () => {
		expect( fitHeartAround( outline, 60, 20 ).width ).toBeGreaterThan( fitHeartAround( outline, 30, 20 ).width );
	} );
} );

describe( 'mapToOutline', () => {
	const outline = createHeartOutline();

	it( 'spreads pixels evenly round the outline', () => {
		const points = [];
		for ( let y = -5; y <= 5; y++ ) {
			for ( let x = -5; x <= 5; x++ ) {
				points.push( { x, y } );
			}
		}
		const slots = mapToOutline( outline, points );
		const us = slots.map( ( s ) => s.u ).sort( ( a, b ) => a - b );
		const gaps = us.map( ( u, i ) => ( i ? u - us[ i - 1 ] : u + 1 - us[ us.length - 1 ] ) );
		expect( Math.max( ...gaps ) ).toBeCloseTo( 1 / points.length, 6 );
		for ( const s of slots ) {
			expect( s.band ).toBeGreaterThanOrEqual( -1 );
			expect( s.band ).toBeLessThanOrEqual( 1 );
		}
	} );

	it( 'keeps each side on its side', () => {
		const slots = mapToOutline( outline, [
			{ x: -4, y: -1 },
			{ x: 4, y: -1 },
			{ x: 0, y: 6 },
		] );
		expect( outline.at( slots[ 0 ].u ).x ).toBeLessThan( 0 );
		expect( outline.at( slots[ 1 ].u ).x ).toBeGreaterThan( 0 );
		expect( outline.at( slots[ 2 ].u ).y ).toBeGreaterThan( 0 );
	} );

	it( 'sends the outermost pixel in a direction to the outer edge', () => {
		const slots = mapToOutline( outline, [
			{ x: 1, y: 0 },
			{ x: 3, y: 0 },
		] );
		expect( slots[ 1 ].band ).toBe( 1 );
		expect( slots[ 0 ].band ).toBe( -1 );
	} );

	it( 'handles no pixels', () => {
		expect( mapToOutline( outline, [] ) ).toEqual( [] );
	} );
} );
