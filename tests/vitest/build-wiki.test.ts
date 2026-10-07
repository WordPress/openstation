import { describe, expect, test, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve( __dirname, '../..' );
const DOCS = join( ROOT, 'docs' );

let out = '';
let stdout = '';

beforeAll( () => {
	out = mkdtempSync( join( tmpdir(), 'openstation-wiki-' ) );
	stdout = execFileSync( 'node', [ join( ROOT, 'bin/build-wiki.mjs' ), out ], {
		cwd: ROOT,
		encoding: 'utf8',
	} );
} );

describe( 'bin/build-wiki.mjs', () => {
	test( 'builds the whole docs/ tree without refusing a directory', () => {
		expect( stdout ).toMatch( /^Wrote \d+ pages/ );
		expect( existsSync( join( out, 'Home.md' ) ) ).toBe( true );
		expect( existsSync( join( out, 'Examples.md' ) ) ).toBe( true );
		expect( existsSync( join( out, '_Sidebar.md' ) ) ).toBe( true );
		expect( existsSync( join( out, '_Footer.md' ) ) ).toBe( true );
	} );

	test( 'every markdown file outside docs/plans/ becomes a page', () => {
		const pages = new Set( readdirSync( out ).filter( ( f ) => f.endsWith( '.md' ) ) );
		const walk = ( dir: string, rel = '' ): string[] =>
			readdirSync( dir, { withFileTypes: true } ).flatMap( ( e ) => {
				const childRel = rel ? `${ rel }/${ e.name }` : e.name;
				if ( e.isDirectory() ) {
					return e.name === 'plans' && ! rel ? [] : walk( join( dir, e.name ), childRel );
				}
				return e.name.endsWith( '.md' ) ? [ childRel ] : [];
			} );
		const expectedPage = ( rel: string ): string => {
			if ( rel === 'README.md' ) {
				return 'Home.md';
			}
			if ( rel === 'examples/README.md' ) {
				return 'Examples.md';
			}
			if ( rel.startsWith( 'examples/' ) ) {
				return 'example-' + rel.slice( 'examples/'.length );
			}
			const segments = rel.replace( /\.md$/, '' ).split( '/' );
			if ( segments.length > 1 && segments[ segments.length - 1 ] === 'README' ) {
				segments.pop();
			}
			return segments.join( '-' ) + '.md';
		};
		for ( const rel of walk( DOCS ) ) {
			expect( pages.has( expectedPage( rel ) ), `docs/${ rel } → ${ expectedPage( rel ) }` ).toBe( true );
		}
	} );

	test( 'a nested README maps to a dash-joined page and its images travel with it', () => {

		const page = join( out, 'screenshots-native-workspaces.md' );
		expect( existsSync( page ) ).toBe( true );
		const images = readdirSync( join( DOCS, 'screenshots/native-workspaces' ) ).filter( ( f ) => ! f.endsWith( '.md' ) );
		expect( images.length ).toBeGreaterThan( 0 );
		for ( const image of images ) {
			expect( existsSync( join( out, 'screenshots/native-workspaces', image ) ) ).toBe( true );
		}
		expect( readFileSync( join( out, '_Sidebar.md' ), 'utf8' ) ).toContain( '](screenshots-native-workspaces)' );
	} );

	test( 'the data-model page keeps its mermaid diagrams and its chart image resolves', () => {
		const page = readFileSync( join( out, 'data-model.md' ), 'utf8' );
		expect( ( page.match( /```mermaid/g ) ?? [] ).length ).toBeGreaterThanOrEqual( 2 );
		expect( page ).toContain( '](assets/data-model/storage-overview.svg)' );
		expect( existsSync( join( out, 'assets/data-model/storage-overview.svg' ) ) ).toBe( true );

		expect( page ).toContain( '](files-on-desktop)' );
		expect( page ).not.toContain( './files-on-desktop.md' );
	} );

	test( 'planning docs stay out of the wiki', () => {
		expect( readdirSync( out ).some( ( f ) => f.startsWith( 'plans-' ) ) ).toBe( false );
		expect( existsSync( join( out, 'plans' ) ) ).toBe( false );
	} );
} );
