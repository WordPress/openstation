import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
	join( __dirname, '../../src/mio/mio.ts' ),
	'utf8',
);

function blurFilterCalls(): string[] {
	return Array.from(
		source.matchAll( /new\s+\w+\.BlurFilter\(\s*\{([\s\S]*?)\}\s*\)/g ),
		( m ) => m[ 1 ],
	);
}

describe( 'Mio glow blending', () => {
	test( 'both blurred layers are still constructed', () => {

		expect( blurFilterCalls() ).toHaveLength( 2 );
	} );

	test( 'every BlurFilter declares an additive blend mode', () => {
		for ( const options of blurFilterCalls() ) {
			expect( options ).toMatch( /blendMode:\s*GLOW_BLEND/ );
		}
		expect( source ).toMatch( /const GLOW_BLEND = 'add'/ );
	} );

	test( 'the layers still ask for additive blending themselves', () => {

		for ( const layer of [ 'halo', 'bloom', 'sheen' ] ) {
			expect( source ).toMatch(
				new RegExp( `${ layer }\\.blendMode = 'add'` ),
			);
		}
	} );
} );
