/**
 * The connect screen's built script has to actually run in a page.
 *
 * This pins a bug that shipped. The renderer was compiled by the app's
 * `tsconfig` along with the main process and the preloads, which emit
 * CommonJS — correct for Electron, fatal in a renderer with
 * `nodeIntegration: false`. The file opened with
 * `Object.defineProperty(exports, "__esModule", …)`, `exports` was not
 * defined, the script died on its first statement, the form's submit
 * listener was never attached, and the Connect button silently did
 * nothing forever. No type error, no lint error, no test failure: the
 * only symptom was a button that did not work.
 *
 * So the assertion is on the artefact, not the source. It runs against
 * whatever `npm run build:connect` actually produced.
 */

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
		// A skipped assertion here would be worse than a failing one:
		// the bug this file guards against is invisible until the
		// artefact is inspected.
		expect(
			existsSync( bundle ),
			'app/dist/renderer/connect.js is missing. Run `npm run build:app`.',
		).toBe( true );
	} );

	test( 'has no CommonJS prologue', () => {
		const code = readFileSync( bundle, 'utf8' );

		// `exports` and `require` do not exist in a page with
		// nodeIntegration off. Either one at the top level means the
		// script throws before it binds a single listener.
		expect( code ).not.toMatch( /Object\.defineProperty\(\s*exports\b/ );
		expect( code ).not.toMatch( /^\s*exports\./m );
		expect( code ).not.toMatch( /\brequire\s*\(/ );
	} );

	test( 'has no ES-module syntax either', () => {
		// `type="module"` is not an option: module scripts over
		// `file://` are blocked by CORS. The bundle has to be classic.
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
