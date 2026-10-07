import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const bundle = join(
	dirname( fileURLToPath( import.meta.url ) ),
	'..',
	'app',
	'dist',
	'renderer',
	'connect.js',
);

describe( 'the built connect-screen script', () => {
	test( 'exists — `npm run build:connect` produces it', () => {

		expect(
			existsSync( bundle ),
			'app/dist/renderer/connect.js is missing. Run `npm run build:app`.',
		).toBe( true );
	} );

	test( 'has no CommonJS prologue', () => {
		const code = readFileSync( bundle, 'utf8' );

		expect( code ).not.toMatch( /Object\.defineProperty\(\s*exports\b/ );
		expect( code ).not.toMatch( /^\s*exports\./m );
		expect( code ).not.toMatch( /\brequire\s*\(/ );
	} );

	test( 'has no ES-module syntax either', () => {

		const code = readFileSync( bundle, 'utf8' );

		expect( code ).not.toMatch( /^\s*import\s/m );
		expect( code ).not.toMatch( /^\s*export\s/m );
	} );

	test( 'talks to the preload bridge and wires the form', () => {
		const code = readFileSync( bundle, 'utf8' );

		expect( code ).toContain( 'openStationConnect' );
		expect( code ).toContain( 'connect-form' );
		expect( code ).toContain( 'submit' );
	} );
} );
