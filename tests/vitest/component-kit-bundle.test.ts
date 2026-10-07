import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OS_COMPONENT_TAGS } from '../../src/ui/components/tags';

const ROOT = resolve( __dirname, '../..' );
const COMPONENTS = resolve( ROOT, 'src/ui/components' );

function definedTags(): Set< string > {
	const found = new Set< string >();
	const walk = ( dir: string ): void => {
		for ( const name of readdirSync( dir ) ) {
			const full = join( dir, name );
			if ( statSync( full ).isDirectory() ) {
				walk( full );
				continue;
			}
			if ( ! name.endsWith( '.ts' ) || name.endsWith( '.test.ts' ) ) {
				continue;
			}
			const source = readFileSync( full, 'utf8' );
			for ( const match of source.matchAll(
				/defineComponent\(\s*'(os-[a-z-]+)'/g,
			) ) {
				found.add( match[ 1 ] );
			}
		}
	};
	walk( COMPONENTS );
	return found;
}

describe( 'component kit bundle', () => {
	test( 'the entry pulls the barrel and announces itself', () => {
		const entry = readFileSync( join( COMPONENTS, 'entry.ts' ), 'utf8' );
		expect( entry ).toMatch( /import '\.\/index'/ );
		expect( entry ).toContain( 'window.openStationComponents = true' );
	} );

	test( 'the build target exists and runs in `npm run build`', () => {
		const vite = readFileSync( join( ROOT, 'vite.config.js' ), 'utf8' );
		expect( vite ).toContain( "entry:    'src/ui/components/entry.ts'" );
		expect( vite ).toContain( "fileBase: 'os-components'" );

		const pkg = JSON.parse(
			readFileSync( join( ROOT, 'package.json' ), 'utf8' ),
		) as { scripts: Record< string, string > };
		expect( pkg.scripts[ 'build:components' ] ).toContain(
			'OPENSTATION_TARGET=components',
		);

		expect( pkg.scripts.build ).toContain( 'npm run build:components' );
	} );

	test( 'PHP ships the bundle URL the loader reads', () => {
		const php = readFileSync(
			join( ROOT, 'includes/render/assets.php' ),
			'utf8',
		);
		expect( php ).toContain( "'componentsBundleUrl'" );
		expect( php ).toContain( "\$lazy_bundle_url( 'os-components' )" );
	} );

	test( 'every tag the kit registers is declared in OS_COMPONENT_TAGS', () => {
		const declared = new Set( OS_COMPONENT_TAGS );
		const undeclared = [ ...definedTags() ].filter(
			( tag ) => ! declared.has( tag ),
		);
		expect(
			undeclared,
			`These components register a tag that is missing from src/ui/components/tags.ts, so wp.os.loadComponents() would call them typos and refuse to fetch: ${ undeclared.join(
				', ',
			) }`,
		).toEqual( [] );
	} );
} );
