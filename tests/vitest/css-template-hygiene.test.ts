/**
 * A backtick inside a `css``` template is a parse error.
 *
 * `css``` is a JS template literal, so a backtick anywhere in it —
 * including inside a `/* … *\/` CSS comment — closes the template
 * early. What follows is then parsed as JavaScript, and the error the
 * toolchain reports is "Expected a semicolon or an implicit semicolon
 * after a statement", pointing at prose. It is a five-second fix once
 * you know, and a genuinely baffling one until you do.
 *
 * The build does catch it. This test exists because the build's message
 * does not say what is wrong, and because the habit that causes it —
 * writing `--_drag` or `::before` in backticks, the way every other
 * comment in this codebase correctly does — is a good habit everywhere
 * except here.
 *
 * The scan is textual rather than AST-based on purpose: a file with
 * this defect cannot be parsed, so anything that needed to parse it
 * first would report nothing at all.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve( __dirname, '../..' );
const UI = resolve( ROOT, 'src/ui' );

/** Every `.ts` under `src/ui`, recursively. */
function walk( dir: string ): string[] {
	return readdirSync( dir ).flatMap( ( name ) => {
		const path = join( dir, name );
		if ( statSync( path ).isDirectory() ) {
			return walk( path );
		}
		return path.endsWith( '.ts' ) && ! path.endsWith( '.test.ts' )
			? [ path ]
			: [];
	} );
}

/**
 * Line numbers of backticks that fall inside a `css``` template.
 *
 * Walks the file once, tracking whether we are inside a template that
 * was opened by `css`. The first backtick after that opener closes it,
 * so any backtick found while inside IS the bug — there is no
 * legitimate nested-backtick case, and an escaped one (`\``) is
 * skipped rather than reported.
 */
function offendingLines( src: string ): number[] {
	const out: number[] = [];
	let i = src.indexOf( 'css`' );
	while ( i !== -1 ) {
		// Two kinds of occurrence are prose rather than code, and the
		// parser never sees a template in either:
		//
		//   - a JSDoc block, where this module documents how to USE
		//     css`` in a fenced example;
		//   - a string literal, where `core/css.ts` names css`` in the
		//     TypeError it throws at a bad interpolation.
		const lineStart = src.lastIndexOf( '\n', i ) + 1;
		const before = src.slice( lineStart, i );
		const quoted =
			( before.split( "'" ).length - 1 ) % 2 === 1 ||
			( before.split( '"' ).length - 1 ) % 2 === 1;
		if ( /^\s*(\*|\/\/)/.test( before ) || quoted ) {
			i = src.indexOf( 'css`', i + 1 );
			continue;
		}
		let j = i + 4;
		let closed = false;
		while ( j < src.length ) {
			if ( src[ j ] === '\\' ) {
				j += 2;
				continue;
			}
			if ( src[ j ] === '`' ) {
				// The template's own terminator. Whether it is the
				// intended one is exactly what we cannot know from
				// here — which is the point: to the parser, this is
				// where the template ends either way.
				closed = true;
				break;
			}
			j++;
		}
		if ( ! closed ) {
			break;
		}
		// Is the character run we just closed on plausibly a comment
		// backtick rather than the real terminator? The real one is
		// followed (modulo whitespace) by `;` or `,` or `)`.
		const after = src.slice( j + 1, j + 40 ).trimStart();
		if ( after !== '' && ! /^[;,)\]]/.test( after ) ) {
			out.push( src.slice( 0, j ).split( '\n' ).length );
		}
		i = src.indexOf( 'css`', j + 1 );
	}
	return out;
}

const files = walk( UI );

describe( 'css`` templates contain no backticks', () => {
	test( 'the sweep found files to check', () => {
		// Guards the guard: a move of src/ui would otherwise turn every
		// assertion below into a silent pass.
		expect( files.length ).toBeGreaterThan( 40 );
	} );

	test.each( files.map( ( f ) => [ f.slice( ROOT.length + 1 ), f ] ) )(
		'%s',
		( label, path ) => {
			const lines = offendingLines( readFileSync( path, 'utf8' ) );
			expect(
				lines,
				`${ label } closes a css\`\` template early at line ${ lines.join(
					', '
				) }. A backtick inside the template — usually one quoting a ` +
					'token or a selector in a CSS comment — terminates the ' +
					'JS template literal. Drop the backticks in comments ' +
					'inside css`` and use plain prose or "double quotes".'
			).toEqual( [] );
		}
	);
} );
