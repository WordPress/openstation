/**
 * `<os-histogram>` — data in, SVG + legend out, toggles announced.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { OsHistogram, niceCeil } from './os-histogram';

const SERIES = JSON.stringify( [
	{ key: 'error', label: 'Errors', tone: 'danger' },
	{ key: 'warning', label: 'Warnings', tone: 'warning' },
	{ key: 'info', label: 'Info', tone: 'info' },
] );

async function settle(): Promise< void > {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise( ( r ) => setTimeout( r, 0 ) );
}

async function make( attrs: Record< string, string > ): Promise< OsHistogram > {
	const el = document.createElement( 'os-histogram' ) as OsHistogram;
	for ( const [ k, v ] of Object.entries( attrs ) ) {
		el.setAttribute( k, v );
	}
	document.body.appendChild( el );
	await settle();
	return el;
}

describe( 'os-histogram', () => {
	afterEach( () => {
		document.body.innerHTML = '';
	} );

	it( 'is defined', () => {
		expect( customElements.get( 'os-histogram' ) ).toBe( OsHistogram );
	} );

	it( 'paints one legend chip per series with its total', async () => {
		const el = await make( {
			legend: '',
			series: SERIES,
			columns: JSON.stringify( [ [ 2, 1, 0 ], [ 1, 0, 4 ] ] ),
			start: '0',
			end: '7200',
		} );
		const chips = el.shadowRoot!.querySelectorAll( '.chip' );
		expect( chips ).toHaveLength( 3 );
		expect( Array.from( chips ).map( ( c ) => c.querySelector( '.count' )?.textContent ) ).toEqual( [ '3', '1', '4' ] );
		expect( chips[ 0 ].getAttribute( 'data-tone' ) ).toBe( 'danger' );
	} );

	it( 'draws a stacked segment for every non-zero cell of a visible series', async () => {
		const el = await make( {
			series: SERIES,
			columns: JSON.stringify( [ [ 2, 1, 0 ], [ 1, 0, 4 ] ] ),
			start: '0',
			end: '7200',
		} );
		expect( el.shadowRoot!.querySelectorAll( '.seg' ) ).toHaveLength( 4 );
		el.setAttribute( 'hidden-series', 'info' );
		await settle();
		expect( el.shadowRoot!.querySelectorAll( '.seg' ) ).toHaveLength( 3 );
		expect( el.shadowRoot!.querySelector( '.chip[data-tone="info"]' )?.getAttribute( 'aria-pressed' ) ).toBe( 'false' );
	} );

	it( 'toggles a series on chip click and emits the new hidden set', async () => {
		const el = await make( {
			legend: '',
			series: SERIES,
			columns: JSON.stringify( [ [ 1, 1, 1 ] ] ),
		} );
		const events: Array< { key: string; hidden: string[] } > = [];
		el.addEventListener( 'os-series-toggle', ( ev ) => {
			events.push( ( ev as CustomEvent< { key: string; hidden: string[] } > ).detail );
		} );
		( el.shadowRoot!.querySelectorAll( '.chip' )[ 1 ] as HTMLButtonElement ).click();
		expect( events ).toEqual( [ { key: 'warning', hidden: [ 'warning' ] } ] );
		expect( el.getAttribute( 'hidden-series' ) ).toBe( 'warning' );
		( el.shadowRoot!.querySelectorAll( '.chip' )[ 1 ] as HTMLButtonElement ).click();
		expect( events[ 1 ] ).toEqual( { key: 'warning', hidden: [] } );
		expect( el.hasAttribute( 'hidden-series' ) ).toBe( false );
	} );

	it( 'paints an optional heading on the legend row', async () => {
		const el = await make( {
			legend: '',
			heading: 'Events over time',
			series: SERIES,
			columns: JSON.stringify( [ [ 1, 0, 0 ] ] ),
		} );
		const head = el.shadowRoot!.querySelector( '.head' )!;
		expect( head.querySelector( '.heading' )?.textContent ).toBe( 'Events over time' );
		expect( head.querySelectorAll( '.chip' ) ).toHaveLength( 3 );
		el.removeAttribute( 'heading' );
		await settle();
		expect( el.shadowRoot!.querySelector( '.heading' )?.hasAttribute( 'hidden' ) ).toBe( true );
	} );

	it( 'shows the empty text when every column is zero', async () => {
		const el = await make( {
			series: SERIES,
			columns: JSON.stringify( [ [ 0, 0, 0 ] ] ),
			empty: 'Nothing here',
		} );
		expect( el.shadowRoot!.querySelector( '.empty' )?.textContent ).toBe( 'Nothing here' );
		expect( el.shadowRoot!.querySelector( 'svg' ) ).toBeNull();
	} );

	it( 'survives malformed data attributes', async () => {
		const el = await make( { series: '{not json', columns: '[1,2' } );
		expect( el.shadowRoot!.querySelector( '.empty' ) ).not.toBeNull();
	} );

	it( 'picks nice axis ceilings', () => {
		expect( niceCeil( 3 ) ).toBe( 3 );
		expect( niceCeil( 7 ) ).toBe( 10 );
		expect( niceCeil( 23 ) ).toBe( 50 );
		expect( niceCeil( 120 ) ).toBe( 200 );
	} );
} );
