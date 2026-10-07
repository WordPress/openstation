import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve( __dirname, '../..' );
const UI = resolve( ROOT, 'src/ui' );

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

function offendingLines( src: string ): number[] {
	const out: number[] = [];
	let i = src.indexOf( 'css`' );
	while ( i !== -1 ) {

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

				closed = true;
				break;
			}
			j++;
		}
		if ( ! closed ) {
			break;
		}

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
