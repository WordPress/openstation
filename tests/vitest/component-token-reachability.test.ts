import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve( __dirname, '../..' );
const COMPONENTS = resolve( ROOT, 'src/ui/components' );

const THEMED: ReadonlySet< string > = new Set(
	Object.keys(
		(
			JSON.parse(
				readFileSync(
					resolve( ROOT, 'assets/desktop-themes/legacy/theme.json' ),
					'utf8'
				)
			) as { tokens: Record< string, string > }
		).tokens
	)
);

const OPT_OUT: Readonly< Record< string, readonly string[] > > = {
	'os-modal': [
		'--os-ui-fg',
		'--os-ui-fg-muted',
		'--os-ui-border',
		'--os-window-bg',
		'--os-ui-button-bg-hover',
		'--os-ui-surface',
		'--os-ui-surface-elevated',
		'--os-ui-border-strong',
		'--os-ui-hover',

		'--os-ui-notice-color',

		'--os-ui-card-bg',
		'--os-ui-card-fg',
		'--os-ui-card-border',
		'--os-ui-card-border-hover',
	],
};

function bareHostBlock( css: string ): string {
	const start = css.search( /:host\s*\{/ );
	if ( start === -1 ) {
		return '';
	}
	const open = css.indexOf( '{', start );
	const close = css.indexOf( '\n\t}', open );
	return close === -1 ? css.slice( open ) : css.slice( open, close );
}

function declarations( block: string ): Array< [ string, string ] > {
	const clean = block.replace( /\/\*[\s\S]*?\*\//g, '' );
	const out: Array< [ string, string ] > = [];
	const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/g;
	let m: RegExpExecArray | null;
	while ( ( m = re.exec( clean ) ) !== null ) {
		out.push( [ m[ 1 ], m[ 2 ].replace( /\s+/g, ' ' ).trim() ] );
	}
	return out;
}

const files = readdirSync( COMPONENTS, { withFileTypes: true } )
	.filter( ( e ) => e.isDirectory() )
	.flatMap( ( dir ) =>
		readdirSync( resolve( COMPONENTS, dir.name ) )
			.filter( ( f ) => f.endsWith( '.styles.ts' ) )
			.map( ( f ) => [ dir.name, resolve( COMPONENTS, dir.name, f ) ] as const )
	);

describe( 'components do not block themed tokens on :host', () => {
	test( 'the component sweep found styles to check', () => {

		expect( files.length ).toBeGreaterThan( 30 );
		expect( THEMED.size ).toBeGreaterThan( 300 );
	} );

	test( 'a dark-context opt-out covers foreground AND surface', () => {
		const optOut = new Set( OPT_OUT[ 'os-modal' ] );

		for ( const [ fg, surface ] of [
			[ '--os-ui-fg', '--os-ui-surface' ],
			[ '--os-ui-fg-muted', '--os-ui-surface-elevated' ],
			[ '--os-ui-border', '--os-ui-border-strong' ],
			[ '--os-ui-card-fg', '--os-ui-card-bg' ],
			[ '--os-ui-card-border', '--os-ui-card-border-hover' ],
		] as const ) {
			expect(
				optOut.has( fg ) === optOut.has( surface ),
				`os-modal re-points ${
					optOut.has( fg ) ? fg : surface
				} but not ${
					optOut.has( fg ) ? surface : fg
				}. A dark dialog owns both halves of that pair, or the ` +
					'one it left behind is read from a light palette.'
			).toBe( true );
		}

		expect(
			optOut.has( '--os-ui-hover' ),
			'os-modal must own --os-ui-hover: a black wash over a dark row is no wash.'
		).toBe( true );
	} );

	test.each( files )( '%s', ( component, path ) => {
		const allowed = OPT_OUT[ component ] ?? [];
		const blocked = declarations( bareHostBlock( readFileSync( path, 'utf8' ) ) )
			.filter( ( [ token ] ) => THEMED.has( token ) )
			.filter( ( [ token ] ) => ! allowed.includes( token ) )

			.filter( ( [ token, value ] ) => ! value.includes( `var( ${ token },` ) )
			.map( ( [ token ] ) => token );

		expect(
			blocked,
			`${ component } declares ${ blocked.join(
				', '
			) } on :host, which makes ${
				blocked.length === 1 ? 'it' : 'them'
			} unreachable from the palette and from every desktop theme. ` +
				'Read the public token into a private --_alias instead.'
		).toEqual( [] );
	} );
} );
