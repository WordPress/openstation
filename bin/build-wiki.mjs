#!/usr/bin/env node
/**
 * Transform docs/ into a set of GitHub-wiki pages.
 *
 * A GitHub wiki is a flat page namespace: every page is addressed by its
 * filename alone, directories are ignored, and links must be extension-less
 * page names rather than relative .md paths. This script bridges the gap:
 *
 *   - docs/README.md            -> Home.md (the wiki front page)
 *   - docs/examples/README.md   -> Examples.md
 *   - docs/examples/<name>.md   -> example-<name>.md (prefix keeps the ~70
 *                                  example pages grouped and prevents
 *                                  basename collisions with top-level docs,
 *                                  e.g. desktop-host.md exists in both)
 *   - docs/<name>.md            -> <name>.md
 *   - docs/plans/               -> excluded (internal planning docs)
 *   - docs/assets/              -> copied verbatim; image links keep working
 *
 * Every relative link is rewritten: links between docs become wiki page
 * links (anchors preserved), links that escape docs/ into the source tree
 * become absolute GitHub blob URLs on trunk. A _Sidebar.md and _Footer.md
 * are generated. Unresolvable relative links are reported as warnings but
 * do not fail the build.
 *
 * Usage: node bin/build-wiki.mjs <output-dir>
 *
 * Consumed by .github/workflows/wiki.yml, which pushes the output to the
 * repository's wiki on every docs change on trunk. The wiki is therefore a
 * generated mirror: edits made in the wiki UI are overwritten on the next
 * sync. See docs/DEVELOPMENT.md, "Docs → GitHub wiki".
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const DOCS_DIR = path.join( REPO_ROOT, 'docs' );
const BLOB_BASE = 'https://github.com/WordPress/openstation/blob/trunk/';
const EXCLUDED_DIRS = new Set( [ 'plans', 'assets' ] );

const outDir = process.argv[ 2 ];
if ( ! outDir ) {
	console.error( 'Usage: node bin/build-wiki.mjs <output-dir>' );
	process.exit( 1 );
}

const warnings = [];

/**
 * Map a docs-relative markdown path to its wiki page name (no extension).
 */
function pageName( relPath ) {
	if ( relPath === 'README.md' ) {
		return 'Home';
	}
	if ( relPath === 'examples/README.md' ) {
		return 'Examples';
	}
	if ( relPath.startsWith( 'examples/' ) ) {
		return 'example-' + path.basename( relPath, '.md' );
	}
	return path.basename( relPath, '.md' );
}

// ---------------------------------------------------------------------------
// Collect pages. Only docs/ root and docs/examples/ may contain markdown; a
// new subdirectory must be mapped here deliberately, so fail loudly on one.
// ---------------------------------------------------------------------------

const sources = [];
for ( const entry of readdirSync( DOCS_DIR, { withFileTypes: true, recursive: true } ) ) {
	if ( ! entry.isFile() || ! entry.name.endsWith( '.md' ) ) {
		continue;
	}
	const rel = path.relative( DOCS_DIR, path.join( entry.parentPath, entry.name ) );
	const topDir = rel.includes( path.sep ) ? rel.split( path.sep )[ 0 ] : null;
	if ( topDir && EXCLUDED_DIRS.has( topDir ) ) {
		continue;
	}
	if ( topDir && topDir !== 'examples' ) {
		console.error( `Unexpected markdown location: docs/${ rel }` );
		console.error( 'Teach bin/build-wiki.mjs how this directory maps into the flat wiki namespace.' );
		process.exit( 1 );
	}
	sources.push( rel.split( path.sep ).join( '/' ) );
}
sources.sort();

const pageByPath = new Map( sources.map( ( rel ) => [ rel, pageName( rel ) ] ) );

const collisions = new Map();
for ( const [ rel, page ] of pageByPath ) {
	if ( collisions.has( page ) ) {
		console.error( `Wiki page name collision: docs/${ collisions.get( page ) } and docs/${ rel } both map to "${ page }".` );
		process.exit( 1 );
	}
	collisions.set( page, rel );
}

/**
 * First H1 of a page, stripped of markdown decoration, as its display title.
 */
function pageTitle( rel, content ) {
	const match = content.match( /^#\s+(.+)$/m );
	if ( ! match ) {
		return pageName( rel );
	}
	return match[ 1 ]
		.replace( /\[([^\]]*)\]\([^)]*\)/g, '$1' )
		.replace( /`/g, '' )
		.trim()
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' );
}

// ---------------------------------------------------------------------------
// Link rewriting.
// ---------------------------------------------------------------------------

/**
 * Rewrite one inline-link target found in the given source file.
 *
 * Returns the replacement target, or null to leave it untouched.
 */
function rewriteTarget( srcRel, target ) {
	if ( /^([a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test( target ) ) {
		return null; // Absolute URL, scheme, site-absolute path, or same-page anchor.
	}

	const hashIndex = target.indexOf( '#' );
	const filePart = hashIndex === -1 ? target : target.slice( 0, hashIndex );
	const anchor = hashIndex === -1 ? '' : target.slice( hashIndex );
	if ( ! filePart ) {
		return null;
	}

	// Resolve relative to the source file, then express relative to docs/.
	const resolved = path.posix
		.normalize( path.posix.join( path.posix.dirname( srcRel ), filePart ) )
		.replace( /\/+$/, '' );

	if ( pageByPath.has( resolved ) ) {
		return pageByPath.get( resolved ) + anchor;
	}

	// A link to a directory lands on that directory's README page.
	const dirReadme = resolved === '.' ? 'README.md' : resolved + '/README.md';
	if ( pageByPath.has( dirReadme ) ) {
		return pageByPath.get( dirReadme ) + anchor;
	}

	// Assets travel with the wiki; all pages live at the wiki root, so a
	// root-relative assets/ path is correct from every page.
	if ( resolved.startsWith( 'assets/' ) && existsSync( path.join( DOCS_DIR, resolved ) ) ) {
		return resolved + anchor;
	}

	// Anything else that exists in the repository (source files, excluded
	// docs like plans/) gets an absolute GitHub URL.
	const repoRel = path.posix.normalize( path.posix.join( 'docs', path.posix.dirname( srcRel ), filePart ) );
	if ( ! repoRel.startsWith( '..' ) && existsSync( path.join( REPO_ROOT, repoRel ) ) ) {
		return BLOB_BASE + repoRel + anchor;
	}

	warnings.push( `docs/${ srcRel }: unresolved relative link "${ target }"` );
	return null;
}

/**
 * Rewrite every inline markdown link/image target in a page.
 */
function rewriteContent( srcRel, content ) {
	return content.replace(
		/\]\(\s*([^)\s]+)((?:\s+"[^"]*")?\s*)\)/g,
		( full, target, title ) => {
			const replacement = rewriteTarget( srcRel, target );
			return replacement === null ? full : `](${ replacement }${ title })`;
		}
	);
}

// ---------------------------------------------------------------------------
// Emit.
// ---------------------------------------------------------------------------

rmSync( outDir, { recursive: true, force: true } );
mkdirSync( outDir, { recursive: true } );

const titles = new Map();
for ( const rel of sources ) {
	const content = readFileSync( path.join( DOCS_DIR, rel ), 'utf8' );
	titles.set( rel, pageTitle( rel, content ) );
	writeFileSync( path.join( outDir, pageByPath.get( rel ) + '.md' ), rewriteContent( rel, content ) );
}

const assetsDir = path.join( DOCS_DIR, 'assets' );
if ( existsSync( assetsDir ) ) {
	cpSync( assetsDir, path.join( outDir, 'assets' ), { recursive: true } );
}

// Sidebar: guides, then migration notes, then the examples behind a
// disclosure so seventy-odd entries don't drown the navigation.
const guides = [];
const migrations = [];
const examples = [];
for ( const rel of sources ) {
	const page = pageByPath.get( rel );
	const line = `- [${ titles.get( rel ) }](${ page })`;
	if ( page === 'Home' || page === 'Examples' ) {
		continue;
	} else if ( rel.startsWith( 'examples/' ) ) {
		examples.push( line );
	} else if ( rel.startsWith( 'migration-' ) ) {
		migrations.push( line );
	} else {
		guides.push( line );
	}
}

writeFileSync( path.join( outDir, '_Sidebar.md' ), [
	'**[Home](Home)**',
	'',
	'**Guides**',
	...guides,
	'',
	'**Migration notes**',
	...migrations,
	'',
	'**[Examples](Examples)**',
	'<details><summary>All examples</summary>',
	'',
	...examples,
	'',
	'</details>',
	'',
].join( '\n' ) );

writeFileSync( path.join( outDir, '_Footer.md' ), [
	`This wiki is generated from the [\`docs/\` directory](${ BLOB_BASE }docs) — edits made here are overwritten by the next sync.`,
	`To change a page, open a pull request against \`docs/\`.`,
	'',
].join( '\n' ) );

console.log( `Wrote ${ sources.length } pages (+ _Sidebar.md, _Footer.md) to ${ outDir }` );
if ( warnings.length ) {
	console.log( `\n${ warnings.length } warning(s):` );
	for ( const warning of warnings ) {
		console.log( `  - ${ warning }` );
	}
}
