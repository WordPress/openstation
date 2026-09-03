#!/usr/bin/env node
/**
 * Build every app client view — `apps/<dir>/<name>.os.ts` — into
 * `assets/js/apps/<name>[.min].js`.
 *
 * `vite.config.js` discovers the same files and exposes each as the
 * target `app:<name>`; this script just runs Vite once per target in
 * both modes, the way the `build:*` scripts do for the fixed bundles.
 * Adding a new `.os.ts` needs no registration anywhere.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath( new URL( '..', import.meta.url ) );
const appsDir = join( root, 'apps' );

if ( ! existsSync( appsDir ) ) {
	console.log( 'build:apps — no apps directory found.' );
	process.exit( 0 );
}

const names = [];
for ( const dir of readdirSync( appsDir ) ) {
	const full = join( appsDir, dir );
	if ( ! statSync( full ).isDirectory() ) {
		continue;
	}
	for ( const file of readdirSync( full ) ) {
		if ( file.endsWith( '.os.ts' ) ) {
			names.push( file.slice( 0, -'.os.ts'.length ) );
		}
	}
}

if ( names.length === 0 ) {
	console.log( 'build:apps — no apps/*/*.os.ts to build.' );
	process.exit( 0 );
}

for ( const name of names ) {
	for ( const mode of [ 'development', 'production' ] ) {
		const result = spawnSync( 'npx', [ 'vite', 'build', '--mode', mode ], {
			cwd: root,
			stdio: 'inherit',
			env: { ...process.env, OPENSTATION_TARGET: `app:${ name }` },
		} );
		if ( result.status !== 0 ) {
			process.exit( result.status ?? 1 );
		}
	}
}
