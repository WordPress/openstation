import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CSS_DIR = resolve( __dirname, '../../assets/css' );

function readCss( file: string ): string {
	return readFileSync( resolve( CSS_DIR, file ), 'utf8' );
}

function ruleBody( css: string, selector: string ): string {
	const at = css.indexOf( selector + ' {' );
	expect( at, `${ selector } not found` ).toBeGreaterThan( -1 );
	const open = css.indexOf( '{', at );
	const close = css.indexOf( '}', open );
	return css.slice( open + 1, close );
}

function flat( text: string ): string {
	return text.replace( /\s+/g, ' ' );
}

const TOOLTIPS: Array< {
	label: string;
	file: string;
	selector: string;

	bgFallback: string;
	fgFallback: string;
} > = [
	{
		label: 'dock tile tooltip',
		file: 'dock.css',
		selector: '.os-dock__tooltip',
		bgFallback: 'var( --os-ui-scrim, rgba( 0, 0, 0, 0.85 ) )',
		fgFallback: 'var( --os-ui-fg-on-accent, #fff )',
	},
	{
		label: 'content-graph satellite tooltip',
		file: 'content-graph.css',
		selector: '.os-content-graph__tooltip',
		bgFallback: 'var( --os-ui-surface-elevated, #1a1f2b )',
		fgFallback: 'var( --os-ui-fg-on-accent, #fff )',
	},
];

describe( 'tooltip tokens', () => {
	test.each( TOOLTIPS )(
		'$label reads the dedicated tokens first',
		( { file, selector, bgFallback, fgFallback } ) => {
			const body = flat( ruleBody( readCss( file ), selector ) );

			expect( body ).toContain(
				`background: var( --os-tooltip-bg, ${ bgFallback } )`
			);
			expect( body ).toContain(
				`color: var( --os-tooltip-fg, ${ fgFallback } )`
			);
		}
	);

	test( 'only variables.css declares them, so one palette owns the look', () => {

		const consumers = [
			...TOOLTIPS.map( ( t ) => t.file ),
			'my-wordpress.css',
		];
		for ( const file of consumers ) {
			const css = readCss( file );

			expect(
				/--os-tooltip-(?:bg|fg)\s*:/.test( css ),
				`${ file } declares a tooltip token`
			).toBe( false );
		}

		const vars = readCss( 'variables.css' );
		expect( vars ).toMatch( /--os-tooltip-bg:\s*#33303a/ );
		expect( vars ).toMatch( /--os-tooltip-fg:\s*#fffbff/ );
	} );

	test( 'variables.css documents both tokens', () => {
		const css = readCss( 'variables.css' );

		expect( css ).toContain( '--os-tooltip-bg' );
		expect( css ).toContain( '--os-tooltip-fg' );
	} );
} );

describe( 'My WordPress hover card tokens', () => {

	const DERIVED: Array< [ string, string ] > = [
		[ '--os-my-wordpress-card-bg', '--os-my-wordpress-bg' ],
		[ '--os-my-wordpress-card-fg', '--os-my-wordpress-fg' ],
		[ '--os-my-wordpress-card-fg-muted', '--os-ui-fg-muted' ],
		[ '--os-my-wordpress-card-border', '--os-ui-border' ],
		[ '--os-my-wordpress-card-thumb-bg', '--os-media-tile-bg' ],
		[ '--os-my-wordpress-card-lock-bg', '--os-ui-badge-danger-bg' ],
	];

	test.each( DERIVED )(
		'%s is derived from %s, so a theme moves it',
		( token, source ) => {
			const vars = flat( readCss( 'variables.css' ) );

			expect( vars ).toMatch(
				new RegExp( `${ token }:\\s*var\\( ?${ source }[,)]` )
			);
		}
	);

	test( 'the card does not read the chip tokens first', () => {
		const body = flat(
			ruleBody( readCss( 'my-wordpress.css' ), '.os-my-wordpress__tooltip' )
		);

		expect( body ).toContain( 'background: var( --os-my-wordpress-card-bg,' );
		expect( body ).toContain( 'color: var( --os-my-wordpress-card-fg,' );

		expect( body ).toContain( '--os-tooltip-bg' );
		expect( body ).toContain( '--os-tooltip-fg' );
	} );

	test( 'the border and the shadow are what lift the card off the window', () => {

		const body = flat(
			ruleBody( readCss( 'my-wordpress.css' ), '.os-my-wordpress__tooltip' )
		);

		expect( body ).toContain( 'var( --os-my-wordpress-card-border,' );
		expect( body ).toContain( 'var( --os-my-wordpress-card-shadow,' );

		const vars = flat( readCss( 'variables.css' ) );
		const bg = vars.match( /--os-my-wordpress-card-bg:\s*var\( ?([^,)]+)/ );
		const border = vars.match(
			/--os-my-wordpress-card-border:\s*var\( ?([^,)]+)/
		);
		expect( bg?.[ 1 ] ).not.toBe( border?.[ 1 ] );
	} );

	test( 'no feature stylesheet declares a card token', () => {

		for ( const file of [ 'my-wordpress.css', 'desktop-files.css' ] ) {
			expect(
				/--os-my-wordpress-card-[a-z-]+\s*:/.test( readCss( file ) ),
				`${ file } declares a card token`
			).toBe( false );
		}
	} );
} );
