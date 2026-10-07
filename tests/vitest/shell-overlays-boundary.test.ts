import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve( __dirname, '../..' );
const MAIN_ENTRY = resolve( ROOT, 'src/desktop.ts' );
const OVERLAYS_ENTRY = resolve( ROOT, 'src/shell-overlays/entry.ts' );
const LOADER = resolve( ROOT, 'src/shell-overlays/loader.ts' );

const READINESS_FLAG = 'openStationShellOverlays';

const ALLOWED_IN_MAIN: Readonly< Record< string, string > > = {

};

function resolveSpecifier( spec: string, from: string ): string | null {
	if ( ! spec.startsWith( '.' ) ) {
		return null;
	}
	const base = resolve( dirname( from ), spec );
	for ( const candidate of [ `${ base }.ts`, join( base, 'index.ts' ), base ] ) {
		if ( existsSync( candidate ) && statSync( candidate ).isFile() ) {
			return candidate;
		}
	}
	return null;
}

const depsCache = new Map< string, string[] >();

function runtimeDeps( file: string ): string[] {
	const cached = depsCache.get( file );
	if ( cached ) {
		return cached;
	}
	let source = '';
	try {
		source = readFileSync( file, 'utf8' );
	} catch {
		depsCache.set( file, [] );
		return [];
	}
	const out: string[] = [];
	const re =
		/(?:^|\n)\s*import\s+(?:type\s+)?(?:[^'"]*?from\s*)?['"]([^'"]+)['"]/g;
	let match: RegExpExecArray | null;
	while ( ( match = re.exec( source ) ) ) {
		const statement = source.slice( match.index, match.index + match[ 0 ].length );
		if ( /import\s+type\b/.test( statement ) ) {
			continue;
		}
		const resolved = resolveSpecifier( match[ 1 ], file );
		if ( resolved ) {
			out.push( resolved );
		}
	}
	depsCache.set( file, out );
	return out;
}

function reachableFrom( entry: string ): Set< string > {
	const seen = new Set< string >();
	const stack = [ entry ];
	while ( stack.length ) {
		const file = stack.pop() as string;
		if ( seen.has( file ) ) {
			continue;
		}
		seen.add( file );
		stack.push( ...runtimeDeps( file ) );
	}
	return seen;
}

function overlayComponents(): Map< string, string > {
	const source = readFileSync( OVERLAYS_ENTRY, 'utf8' );
	const out = new Map< string, string >();
	for ( const match of source.matchAll(
		/import '(\.\.\/ui\/components\/([a-z-]+)\/[a-z-]+)'/g,
	) ) {
		out.set( match[ 2 ], `${ resolve( dirname( OVERLAYS_ENTRY ), match[ 1 ] ) }.ts` );
	}
	return out;
}

describe( 'shell-overlays readiness', () => {
	test( 'the bundle announces itself with a flag', () => {
		const entry = readFileSync( OVERLAYS_ENTRY, 'utf8' );
		expect( entry ).toContain( `window.${ READINESS_FLAG } = true` );
	} );

	test( 'the loader never infers readiness from a component tag', () => {
		const loader = readFileSync( LOADER, 'utf8' );
		expect( loader ).toContain( READINESS_FLAG );

		const code = loader.replace( /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '' );
		expect( code ).not.toContain( 'customElements' );
	} );
} );

describe( 'shell-overlays bundle boundary', () => {
	const components = overlayComponents();

	test( 'the overlays entry still owns a component kit', () => {

		expect( components.size ).toBeGreaterThan( 5 );
		expect( components.has( 'os-context-menu' ) ).toBe( true );
	} );

	test( 'the main bundle pulls in only the allowlisted overlay components', () => {
		const reachable = reachableFrom( MAIN_ENTRY );
		const leaked: string[] = [];
		for ( const [ tag, file ] of components ) {
			if ( ! reachable.has( file ) || tag in ALLOWED_IN_MAIN ) {
				continue;
			}
			const importers = [ ...reachable ]
				.filter( ( f ) => runtimeDeps( f ).includes( file ) )
				.map( ( f ) => relative( ROOT, f ) );
			leaked.push( `${ tag } (imported by ${ importers.join( ', ' ) })` );
		}
		expect(
			leaked,
			`These components ship in the lazy shell-overlays bundle but are reachable from src/desktop.ts, so their class + styles land on every admin page.\n\n${ leaked
				.map( ( l ) => `  - ${ l }` )
				.join(
					'\n',
				) }\n\nUsually the import is reaching past what it needs: import 'osConfirm' from 'src/os-confirm' rather than the component module, take a constant from a leaf module rather than a lazy bundle's entry. If the main bundle genuinely renders the tag, add it to ALLOWED_IN_MAIN with the render site.`,
		).toEqual( [] );
	} );

	test( 'the allowlist has no stale entries', () => {
		const reachable = reachableFrom( MAIN_ENTRY );
		const stale = Object.keys( ALLOWED_IN_MAIN ).filter( ( tag ) => {
			const file = components.get( tag );
			return ! file || ! reachable.has( file );
		} );
		expect(
			stale,
			`No longer reachable from the main bundle — drop from ALLOWED_IN_MAIN: ${ stale.join(
				', ',
			) }`,
		).toEqual( [] );
	} );
} );
