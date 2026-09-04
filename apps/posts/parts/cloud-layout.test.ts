/**
 * Posts app — the Tags cloud's pure layout: the count → size mapping,
 * the per-slug hue and rotation, the spiral packer (plain and
 * cluster-aware) and the persisted positions.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
	computePositionsKey,
	findSpiralSlot,
	fontSizeFor,
	packBoxesWithClusters,
	readPersistedPositions,
	tagHue,
	tagRotation,
	writePersistedPositions,
	type Aabb,
	type PackBox,
} from './cloud-layout';

const box = ( id: number, count: number, w = 80, h = 30 ): PackBox => ( { id, count, width: w, height: h, tx: 0, ty: 0 } );
const overlaps = ( a: Aabb, b: Aabb ) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const aabbOf = ( b: PackBox ): Aabb => ( { x: b.tx - b.width / 2, y: b.ty - b.height / 2, w: b.width, h: b.height } );

afterEach( () => {
	window.localStorage.clear();
} );

describe( 'the size, hue and rotation', () => {
	it( 'maps the count onto 11–28px with a compressed high tail', () => {
		expect( fontSizeFor( 0, 100 ) ).toBe( 11 );
		expect( fontSizeFor( 100, 100 ) ).toBe( 28 );
		expect( fontSizeFor( 25, 100 ) ).toBe( Math.round( 11 + 17 * 0.5 ) );
		// A population max of 0 is read as 1, so a lone tag is full size.
		expect( fontSizeFor( 1, 0 ) ).toBe( 28 );
	} );

	it( 'gives a slug a stable hue in [0, 360) and a tiny stable rotation', () => {
		for ( const slug of [ 'news', 'a', 'very-long-slug-with-many-characters' ] ) {
			const hue = tagHue( slug, 210 );
			expect( hue ).toBeGreaterThanOrEqual( 0 );
			expect( hue ).toBeLessThan( 360 );
			expect( tagHue( slug, 210 ) ).toBe( hue );
			expect( Math.abs( tagRotation( slug ) ) ).toBeLessThanOrEqual( 0.034 );
			expect( tagRotation( slug ) ).toBe( tagRotation( slug ) );
		}
		expect( tagHue( 'news', 0 ) ).not.toBe( tagHue( 'sport', 0 ) );
	} );
} );

describe( 'the spiral packer', () => {
	it( 'takes the anchor when it is free and a clear slot otherwise', () => {
		expect( findSpiralSlot( 80, 30, [] ) ).toEqual( { x: 0, y: 0 } );
		expect( findSpiralSlot( 80, 30, [ { x: 500, y: 500, w: 10, h: 10 } ], 40, 40 ) ).toEqual( { x: 40, y: 40 } );
		const placed: Aabb[] = [ { x: -40, y: -15, w: 80, h: 30 } ];
		const slot = findSpiralSlot( 80, 30, placed );
		const mine: Aabb = { x: slot.x - 40, y: slot.y - 15, w: 80, h: 30 };
		expect( overlaps( mine, placed[ 0 ] ) ).toBe( false );
	} );

	it( 'packs every box without overlap, most popular first at the origin', () => {
		const boxes = [ box( 1, 50 ), box( 2, 40 ), box( 3, 30 ), box( 4, 20 ), box( 5, 10 ) ];
		const placed: Aabb[] = [];
		packBoxesWithClusters( boxes, placed, new Map(), new Map() );
		expect( boxes[ 0 ] ).toMatchObject( { tx: 0, ty: 0 } );
		expect( placed ).toHaveLength( 5 );
		for ( let i = 0; i < boxes.length; i++ ) {
			for ( let j = i + 1; j < boxes.length; j++ ) {
				expect( overlaps( aabbOf( boxes[ i ] ), aabbOf( boxes[ j ] ) ) ).toBe( false );
			}
		}
	} );

	it( 'pulls a box toward its co-occurring siblings and starts a new cluster for a loner', () => {
		const anchor = box( 1, 50 );
		const sibling = box( 2, 40 );
		const loner = box( 3, 40 );
		const cooccurrence = new Map( [ [ 2, [ { id: 1, shared: 9 } ] ] ] );
		packBoxesWithClusters( [ anchor, sibling, loner ], [], new Map(), cooccurrence );
		const dist = ( a: PackBox, b: PackBox ) => Math.hypot( a.tx - b.tx, a.ty - b.ty );
		expect( dist( sibling, anchor ) ).toBeLessThan( dist( loner, anchor ) );
	} );
} );

describe( 'the persisted positions', () => {
	it( 'round-trips through localStorage under a per-site key and drops garbage', () => {
		const key = computePositionsKey();
		expect( key.startsWith( 'os-tagcloud-positions:' ) ).toBe( true );
		expect( key ).toContain( window.location.host );
		writePersistedPositions( key, new Map( [ [ 4, { x: 10, y: -5 } ] ] ) );
		expect( Array.from( readPersistedPositions( key ) ) ).toEqual( [ [ 4, { x: 10, y: -5 } ] ] );
		window.localStorage.setItem( key, JSON.stringify( { 5: { x: 'no', y: 1 }, abc: { x: 1, y: 1 }, 6: { x: 2, y: 3 } } ) );
		expect( Array.from( readPersistedPositions( key ).keys() ) ).toEqual( [ 6 ] );
		window.localStorage.setItem( key, '{not json' );
		expect( readPersistedPositions( key ).size ).toBe( 0 );
	} );
} );
