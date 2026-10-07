import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join( __dirname, '../..' );
const VARIABLES = readFileSync( join( ROOT, 'assets/css/variables.css' ), 'utf8' );
const DESKTOP = readFileSync( join( ROOT, 'assets/css/desktop.css' ), 'utf8' );
const POST_STATS = readFileSync(
	join( ROOT, 'src/plugins/post-stats-widget/index.ts' ),
	'utf8'
);
const STARTER = readFileSync(
	join( ROOT, 'src/plugins/starter-widget/styles.css' ),
	'utf8'
);
const LEGACY = JSON.parse(
	readFileSync( join( ROOT, 'assets/desktop-themes/legacy/theme.json' ), 'utf8' )
) as { tokens: Record< string, string > };

const CARD_GLASS: [ number, number, number ] = [ 20, 20, 22 ];

function paletteTokens(): Map< string, string > {
	return new Map(
		[ ...VARIABLES.matchAll( /^\s*(--os-[a-z0-9-]+)\s*:\s*([^;]+);/gm ) ].map(
			( m ) => [ m[ 1 ], m[ 2 ].trim() ]
		)
	);
}

const PALETTE = paletteTokens();

function documentedContract(): string[] {
	return [
		'--os-ui-color-text',
		'--os-ui-color-text-subtle',
		'--os-ui-color-border',
		'--os-ui-color-accent',
		'--os-ui-color-surface',
	];
}

function resolve( name: string, table: Map< string, string > ): string {
	let value = table.get( name );
	for ( let hop = 0; hop < 8 && value; hop++ ) {
		const alias = value.match( /^var\(\s*(--[a-z0-9-]+)\s*,\s*(.+)\s*\)$/ );
		if ( ! alias ) {
			return value;
		}
		value = table.has( alias[ 1 ] ) ? table.get( alias[ 1 ] ) : alias[ 2 ].trim();
	}
	return value ?? '';
}

function parseColour( value: string ): [ number, number, number, number ] {
	const hex = value.trim().match( /^#([0-9a-f]{3}|[0-9a-f]{6})$/i );
	if ( hex ) {
		const h =
			hex[ 1 ].length === 3
				? hex[ 1 ]
						.split( '' )
						.map( ( c ) => c + c )
						.join( '' )
				: hex[ 1 ];
		return [
			parseInt( h.slice( 0, 2 ), 16 ),
			parseInt( h.slice( 2, 4 ), 16 ),
			parseInt( h.slice( 4, 6 ), 16 ),
			1,
		];
	}
	const rgb = value.trim().match( /^rgba?\(([^)]+)\)$/i );
	if ( rgb ) {
		const parts = rgb[ 1 ].split( /[\s,/]+/ ).filter( Boolean ).map( Number );
		return [ parts[ 0 ], parts[ 1 ], parts[ 2 ], parts[ 3 ] ?? 1 ];
	}
	throw new Error( `Cannot parse colour: ${ value }` );
}

const channel = ( c: number ): number => {
	const s = c / 255;
	return s <= 0.03928 ? s / 12.92 : ( ( s + 0.055 ) / 1.055 ) ** 2.4;
};

const luminance = ( [ r, g, b ]: [ number, number, number ] ): number =>
	0.2126 * channel( r ) + 0.7152 * channel( g ) + 0.0722 * channel( b );

function contrastOnGlass( value: string ): number {
	const [ r, g, b, a ] = parseColour( value );
	const flat: [ number, number, number ] = [
		a * r + ( 1 - a ) * CARD_GLASS[ 0 ],
		a * g + ( 1 - a ) * CARD_GLASS[ 1 ],
		a * b + ( 1 - a ) * CARD_GLASS[ 2 ],
	];
	const [ hi, lo ] = [ luminance( flat ), luminance( CARD_GLASS ) ].sort(
		( x, y ) => y - x
	);
	return ( hi + 0.05 ) / ( lo + 0.05 );
}

describe( 'the widget card token contract', () => {
	test( 'every documented name is declared in the palette', () => {
		const documented = documentedContract();

		expect( documented.length ).toBe( 5 );

		for ( const name of documented ) {
			expect(
				PALETTE.has( name ),
				`${ name } is documented in the starter widget but declared nowhere, ` +
					`so every consumer falls through to its own light-mode fallback ` +
					`on the card's dark glass. Declare it in assets/css/variables.css.`
			).toBe( true );
		}
	} );

	test( 'every token a bundled widget reads is declared', () => {
		const consumed = new Set(
			[
				...[
					'jazz-quote-widget',
					'post-stats-widget',
					'recent-comments-widget',
					'site-views-widget',
					'starter-widget',
				].flatMap( ( slug ) => [
					...readFileSync(
						join( ROOT, `src/plugins/${ slug }/styles.css` ),
						'utf8'
					).matchAll( /var\(\s*(--os-[a-z0-9-]+)/g ),
				] ),
			].map( ( m ) => m[ 1 ] )
		);

		const undeclared = [ ...consumed ].filter( ( n ) => ! PALETTE.has( n ) );
		expect(
			undeclared,
			`Bundled widgets read these, and nothing declares them: ${ undeclared.join(
				', '
			) }`
		).toEqual( [] );
	} );

	test.each( [ '--os-ui-color-text', '--os-ui-color-text-subtle' ] )(
		'%s clears AA on the card glass under the palette',
		( token ) => {
			expect( contrastOnGlass( resolve( token, PALETTE ) ) ).toBeGreaterThan(
				4.5
			);
		}
	);

	test.each( [ '--os-ui-color-text', '--os-ui-color-text-subtle' ] )(
		'%s clears AA on the card glass under Legacy',
		( token ) => {

			const worn = new Map( [
				...PALETTE,
				...Object.entries( LEGACY.tokens ).map(
					( [ k, v ] ) => [ k, v.trim() ] as [ string, string ]
				),
			] );
			expect( contrastOnGlass( resolve( token, worn ) ) ).toBeGreaterThan( 4.5 );
		}
	);

	test( 'the accent follows the picker rather than the brand', () => {

		expect( PALETTE.get( '--os-ui-color-accent' ) ).toContain(
			'var(--os-ui-accent'
		);
	} );

	test( 'canvas ink follows the tokens too, not a hardcoded value', () => {

		expect( POST_STATS ).not.toMatch( /rgba\(\s*0\s*,\s*0\s*,\s*0/ );
		expect( POST_STATS ).toContain( '--os-ui-color-border' );
		expect( POST_STATS ).toContain( '--os-ui-color-text-subtle' );
	} );

	test( 'the canvas fallbacks are legible on the glass, not the old black', () => {

		const ink = POST_STATS.slice(
			POST_STATS.indexOf( 'const RULE =' ),
			POST_STATS.indexOf( '\n', POST_STATS.indexOf( 'const LABEL =' ) )
		);
		expect( ink ).not.toBe( '' );
		expect( ink ).toContain( '255, 251, 255' );
		expect( ink ).not.toMatch( /0\s*,\s*0\s*,\s*0/ );
	} );

	test( 'the card paints the surface token it publishes', () => {

		const card = DESKTOP.slice(
			DESKTOP.indexOf( '.os-widgets__card {' ),
			DESKTOP.indexOf( '}', DESKTOP.indexOf( '.os-widgets__card {' ) )
		);
		expect( card ).toContain( 'var( --os-ui-color-surface' );
	} );
} );
