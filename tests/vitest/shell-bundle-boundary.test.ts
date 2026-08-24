/**
 * The shell-bundle diet's boundary.
 *
 * Five features moved out of `desktop[.min].js` into gesture- and
 * presence-gated bundles: the OS-file-drop machinery (`file-drop`),
 * the click-opened desktop-files surfaces (`files-overlays`), pinned
 * notes (`notes`), the dock hover flyout (`dock-constellation`), and
 * the window-link visuals (`window-link-visuals`). Each leaves only
 * a small sentinel / loader / leaf behind.
 *
 * The IIFE build is why this test exists: rollup INLINES dynamic
 * imports in single-chunk output, so a well-meaning
 * `void import( './heavy' )` lands the whole module in the shell
 * bundle anyway — that is exactly how the file-drop machinery, the
 * share modal and the upload dialog were all riding boot despite
 * lazy-looking call sites. The walk below therefore follows dynamic
 * imports too, and holds the main bundle's reach into each split
 * area to a named allowlist. Reintroducing a static OR dynamic
 * import of a split module from shell code fails here with the
 * offending edge named.
 */
import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve( __dirname, '../..' );
const MAIN_ENTRY = resolve( ROOT, 'src/desktop.ts' );

/**
 * Per split area: the directory (relative to `src/`) and the files
 * inside it the shell IS allowed to reach. Everything else in the
 * directory must only be reachable from the split bundle's own
 * entry.
 */
const SPLIT_AREAS: ReadonlyArray< {
	dir: string;
	allowed: readonly string[];
	why: string;
} > = [
	{
		dir: 'os-file-drop',
		allowed: [
			// The sentinel IS the shell-side half of the split.
			'os-file-drop/sentinel.ts',
			// Zero-dependency leaves shared with resident features.
			'os-file-drop/format-bytes.ts',
			'os-file-drop/hooks.ts',
			'os-file-drop/types.ts',
		],
		why: 'loads on the first dragenter that carries files',
	},
	{
		dir: 'notes',
		allowed: [
			'notes/sentinel.ts',
			// Constants + types only; the Note Pad widget shares it.
			'notes/types.ts',
		],
		why: 'presence-gated on hasNotes / first note-creating gesture',
	},
	{
		dir: 'dock-constellation',
		allowed: [
			// Deliberate zero-import leaf — dock-peek stands down
			// while the flyout owns the hover gesture.
			'dock-constellation/active.ts',
		],
		why: 'loads on the first pointer entering a dock rail',
	},
];

/**
 * Individual split FILES inside directories that otherwise stay in
 * the shell.
 */
const SPLIT_FILES: ReadonlyArray< { file: string; why: string } > = [
	{
		file: 'desktop-files/share-settings-modal.ts',
		why: 'files-overlays bundle — opened from share menus',
	},
	{
		file: 'desktop-files/url-dialog.ts',
		why: 'files-overlays bundle — opened from the wallpaper menu',
	},
	{
		file: 'window-links/render-host.ts',
		why: 'window-link-visuals bundle — starts on the first relation group',
	},
	{
		file: 'window-links/geometry.ts',
		why: 'window-link-visuals bundle',
	},
];

function resolveSpecifier( spec: string, from: string ): string | null {
	if ( ! spec.startsWith( '.' ) ) {
		return null;
	}
	const base = resolve( dirname( from ), spec );
	for ( const candidate of [
		`${ base }.ts`,
		join( base, 'index.ts' ),
		base,
	] ) {
		if ( existsSync( candidate ) && statSync( candidate ).isFile() ) {
			return candidate;
		}
	}
	return null;
}

const depsCache = new Map< string, string[] >();

/**
 * Runtime imports of one module — static AND dynamic (`import(…)`),
 * because the IIFE build inlines both. `import type` is erased and
 * skipped.
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
	// Comments off before scanning — several modules narrate their
	// own old `import( '…' )` call sites in prose, and a crude regex
	// walker would read those as real edges.
	source = source
		.replace( /\/\*[\s\S]*?\*\//g, '' )
		.replace( /(^|[^:])\/\/[^\n]*/g, '$1' );
	const out: string[] = [];
	const staticRe =
		/(?:^|\n)\s*import\s+(?:type\s+)?(?:[^'"]*?from\s*)?['"]([^'"]+)['"]/g;
	let match: RegExpExecArray | null;
	while ( ( match = staticRe.exec( source ) ) ) {
		const statement = source.slice(
			match.index,
			match.index + match[ 0 ].length,
		);
		if ( /import\s+type\b/.test( statement ) ) {
			continue;
		}
		const resolved = resolveSpecifier( match[ 1 ], file );
		if ( resolved ) {
			out.push( resolved );
		}
	}
	const dynamicRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
	while ( ( match = dynamicRe.exec( source ) ) ) {
		const resolved = resolveSpecifier( match[ 1 ], file );
		if ( resolved ) {
			out.push( resolved );
		}
	}
	depsCache.set( file, out );
	return out;
}

/** Every file reachable from an entry, with one example import path. */
function reachable( entry: string ): Map< string, string[] > {
	const seen = new Map< string, string[] >();
	const queue: Array< { file: string; path: string[] } > = [
		{ file: entry, path: [] },
	];
	while ( queue.length ) {
		const { file, path } = queue.shift() as {
			file: string;
			path: string[];
		};
		if ( seen.has( file ) ) {
			continue;
		}
		seen.set( file, path );
		for ( const dep of runtimeDeps( file ) ) {
			if ( ! seen.has( dep ) ) {
				queue.push( { file: dep, path: [ ...path, file ] } );
			}
		}
	}
	return seen;
}

function rel( file: string ): string {
	return relative( join( ROOT, 'src' ), file ).replace( /\\/g, '/' );
}

describe( 'shell-bundle boundary', () => {
	const graph = reachable( MAIN_ENTRY );

	test( 'the main bundle reaches only the allowed files of each split area', () => {
		const offenders: string[] = [];
		for ( const [ file, path ] of graph ) {
			const relPath = rel( file );
			for ( const area of SPLIT_AREAS ) {
				if (
					relPath.startsWith( `${ area.dir }/` ) &&
					! area.allowed.includes( relPath )
				) {
					offenders.push(
						`${ relPath } (${ area.why }) via: ${ path
							.map( rel )
							.join( ' → ' ) }`,
					);
				}
			}
			for ( const split of SPLIT_FILES ) {
				if ( relPath === split.file ) {
					offenders.push(
						`${ relPath } (${ split.why }) via: ${ path
							.map( rel )
							.join( ' → ' ) }`,
					);
				}
			}
		}
		expect(
			offenders,
			'These modules belong to gesture-gated bundles; importing them (statically OR dynamically — the IIFE build inlines both) puts them back on every boot:\n' +
				offenders.join( '\n' ),
		).toEqual( [] );
	} );

	test( 'each split bundle entry actually reaches its feature', () => {
		// The inverse guard: a split whose entry stopped importing the
		// feature would ship an empty bundle and a dead sentinel.
		const expectations: Array< [ string, string ] > = [
			[ 'src/os-file-drop/entry.ts', 'os-file-drop/dialog.ts' ],
			[ 'src/desktop-files/overlays-entry.ts', 'desktop-files/share-settings-modal.ts' ],
			[ 'src/notes/entry.ts', 'notes/layer.ts' ],
			[ 'src/dock-constellation/entry.ts', 'dock-constellation/index.ts' ],
			[ 'src/window-links/visuals-entry.ts', 'window-links/render-host.ts' ],
		];
		for ( const [ entry, mustReach ] of expectations ) {
			const bundleGraph = reachable( resolve( ROOT, entry ) );
			const hit = [ ...bundleGraph.keys() ].some(
				( file ) => rel( file ) === mustReach,
			);
			expect( hit, `${ entry } no longer reaches ${ mustReach }` ).toBe(
				true,
			);
		}
	} );
} );
