/**
 * Copy the connect screen's static assets next to its compiled script.
 *
 * The page's CSP is `script-src 'self'; img-src 'self' data:`, which
 * over `file://` means "the same directory" in practice — so the HTML
 * and the logo have to end up beside the JS rather than reaching back
 * across directories for them.
 *
 * Vite compiles `connect.ts` into `app/dist/renderer/`; everything else
 * in that folder is static and lands here. Three files, one copy loop,
 * no bundler plugin.
 */

import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname( fileURLToPath( import.meta.url ) );
const from = join( root, '..', 'app', 'src', 'renderer' );
const to = join( root, '..', 'app', 'dist', 'renderer' );

const ASSETS = [ 'connect.html', 'openstation.svg', 'openstation-256.png' ];

mkdirSync( to, { recursive: true } );
for ( const name of ASSETS ) {
	cpSync( join( from, name ), join( to, name ) );
}

console.log(
	`[openstation-electron] copied ${ ASSETS.length } connect-screen assets into app/dist/renderer/`,
);
