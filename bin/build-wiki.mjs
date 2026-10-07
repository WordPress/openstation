#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const DOCS_DIR = path.join( REPO_ROOT, 'docs' );
const BLOB_BASE = 'https://github.com/WordPress/openstation/blob/trunk/';
const EXCLUDED_DIRS = new Set( [ 'plans' ] );

const outDir = process.argv[ 2 ];
if ( ! outDir ) {
	console.error( 'Usage: node bin/build-wiki.mjs <output-dir>' );
	process.exit( 1 );
}

const warnings = [];

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
	const segments = relPath.replace( /\.md$/, '' ).split( '/' );
	if ( segments.length > 1 && segments[ segments.length - 1 ] === 'README' ) {
		segments.pop();
	}
	return segments.join( '-' );
}

function topDirOf( rel ) {
	return rel.includes( '/' ) ? rel.split( '/' )[ 0 ] : null;
}

const sources = [];
const verbatim = [];
for ( const entry of readdirSync( DOCS_DIR, { withFileTypes: true, recursive: true } ) ) {
	if ( ! entry.isFile() ) {
		continue;
	}
	const rel = path.relative( DOCS_DIR, path.join( entry.parentPath, entry.name ) ).split( path.sep ).join( '/' );
	const topDir = topDirOf( rel );
	if ( topDir && EXCLUDED_DIRS.has( topDir ) ) {
		continue;
	}
	if ( entry.name.endsWith( '.md' ) ) {
		sources.push( rel );
	} else if ( topDir ) {
		verbatim.push( rel );
	}
}
sources.sort();
verbatim.sort();

const pageByPath = new Map( sources.map( ( rel ) => [ rel, pageName( rel ) ] ) );
const verbatimSet = new Set( verbatim );

const collisions = new Map();
for ( const [ rel, page ] of pageByPath ) {
	if ( collisions.has( page ) ) {
		console.error( `Wiki page name collision: docs/${ collisions.get( page ) } and docs/${ rel } both map to "${ page }".` );
		process.exit( 1 );
	}
	collisions.set( page, rel );
}

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

function rewriteTarget( srcRel, target ) {
	if ( /^([a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test( target ) ) {
		return null;
	}

	const hashIndex = target.indexOf( '#' );
	const filePart = hashIndex === -1 ? target : target.slice( 0, hashIndex );
	const anchor = hashIndex === -1 ? '' : target.slice( hashIndex );
	if ( ! filePart ) {
		return null;
	}

	const resolved = path.posix
		.normalize( path.posix.join( path.posix.dirname( srcRel ), filePart ) )
		.replace( /\/+$/, '' );

	if ( pageByPath.has( resolved ) ) {
		return pageByPath.get( resolved ) + anchor;
	}

	const dirReadme = resolved === '.' ? 'README.md' : resolved + '/README.md';
	if ( pageByPath.has( dirReadme ) ) {
		return pageByPath.get( dirReadme ) + anchor;
	}

	if ( verbatimSet.has( resolved ) ) {
		return resolved + anchor;
	}

	const repoRel = path.posix.normalize( path.posix.join( 'docs', path.posix.dirname( srcRel ), filePart ) );
	if ( ! repoRel.startsWith( '..' ) && existsSync( path.join( REPO_ROOT, repoRel ) ) ) {
		return BLOB_BASE + repoRel + anchor;
	}

	warnings.push( `docs/${ srcRel }: unresolved relative link "${ target }"` );
	return null;
}

function rewriteContent( srcRel, content ) {
	return content.replace(
		/\]\(\s*([^)\s]+)((?:\s+"[^"]*")?\s*)\)/g,
		( full, target, title ) => {
			const replacement = rewriteTarget( srcRel, target );
			return replacement === null ? full : `](${ replacement }${ title })`;
		}
	);
}

rmSync( outDir, { recursive: true, force: true } );
mkdirSync( outDir, { recursive: true } );

const titles = new Map();
for ( const rel of sources ) {
	const content = readFileSync( path.join( DOCS_DIR, rel ), 'utf8' );
	titles.set( rel, pageTitle( rel, content ) );
	writeFileSync( path.join( outDir, pageByPath.get( rel ) + '.md' ), rewriteContent( rel, content ) );
}

for ( const rel of verbatim ) {
	const dest = path.join( outDir, rel );
	mkdirSync( path.dirname( dest ), { recursive: true } );
	cpSync( path.join( DOCS_DIR, rel ), dest );
}

const guides = [];
const migrations = [];
const nested = [];
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
	} else if ( topDirOf( rel ) ) {
		nested.push( line );
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
	...( nested.length ? [ '**More**', ...nested, '' ] : [] ),
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
