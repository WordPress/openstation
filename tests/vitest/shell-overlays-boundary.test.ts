/**
 * The lazy `shell-overlays` bundle must stay reachable, and stay lazy.
 *
 * The bug this file exists to prevent shipped once and hid for
 * months. `src/shell-overlays/loader.ts` decided whether its bundle
 * was already in the tab by asking
 * `customElements.get( 'os-confirm-dialog' )` — a tag the bundle
 * registers. Then a one-line event-name constant imported from
 * `item-visibility-menu.ts` (a lazy bundle's ENTRY) dragged that
 * entry's whole tree, including the dialog component, into
 * `desktop.min.js`. The tag was now registered at boot, the loader
 * read "already loaded" before fetching anything, and the bundle was
 * never requested on any page.
 *
 * Nothing failed. `<os-context-menu>` — registered by that bundle
 * and by nothing else in the shell — simply stopped upgrading, so
 * right-clicking the wallpaper or a desktop icon appended an inert
 * element and opened no menu. It went unnoticed because
 * `my-wordpress.min.js` was still enqueued on every admin page and
 * happens to import the same component; the moment that bundle went
 * lazy for its own good reasons, the menus went with it.
 *
 * Two invariants, one per failure surface:
 *
 *   1. Readiness is a flag ONLY this bundle sets. Never a component
 *      tag — any tag can arrive from any bundle.
 *   2. The main bundle's reach into the overlay components stays
 *      pinned. Each entry below is weight on every admin page, and
 *      an unreviewed addition is how the leak grew in the first
 *      place.
 */
import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve( __dirname, '../..' );
const MAIN_ENTRY = resolve( ROOT, 'src/desktop.ts' );
const OVERLAYS_ENTRY = resolve( ROOT, 'src/shell-overlays/entry.ts' );
const LOADER = resolve( ROOT, 'src/shell-overlays/loader.ts' );

/** The flag `entry.ts` sets and `loader.ts` polls. */
const READINESS_FLAG = 'openStationShellOverlays';

/**
 * Overlay components the main bundle is knowingly allowed to pull
 * in, with the render site that needs the tag upgraded whether or
 * not the lazy bundle has landed.
 *
 * Adding a name here is a deliberate trade — the component's class
 * and styles ship on every admin page — so it wants the same
 * scrutiny as any other boot-path addition. Removing one is free.
 */
const ALLOWED_IN_MAIN: Readonly< Record< string, string > > = {
	'os-toast': 'share-settings-modal renders toasts inline',
	'os-button': 'share-settings-modal + the wallpaper settings section',
	'os-window-button': 'the notes layer paints its own window chrome',
	'os-save-status': 'the notes layer paints its own save indicator',
};

/**
 * Resolve one relative import specifier to a file on disk, the way
 * Vite would. Bare specifiers are out of scope — nothing in the
 * overlay kit is reached through one.
 */
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

/**
 * Runtime imports of one module. `import type` is skipped — it is
 * erased before the bundler sees it and cannot register a component.
 */
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

/** Every module the bundler would pull into `entry`'s bundle. */
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

/** Component modules the overlays entry side-effect-imports, by tag. */
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
		// `customElements.get( … )` here is the original bug: every
		// tag this bundle registers can also be registered by another
		// bundle, so a tag says nothing about whether THIS bundle
		// loaded. Only the flag does.
		const code = loader.replace( /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '' );
		expect( code ).not.toContain( 'customElements' );
	} );
} );

describe( 'shell-overlays bundle boundary', () => {
	const components = overlayComponents();

	test( 'the overlays entry still owns a component kit', () => {
		// Guards the two tests below against silently passing if the
		// entry is restructured and the import scrape stops matching.
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
