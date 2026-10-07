import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname( fileURLToPath( import.meta.url ) );
const from = join( root, '..', 'app', 'src', 'renderer' );
const to = join( root, '..', 'app', 'dist', 'renderer' );

const ASSETS = [ 'connect.html', 'openstation.svg', 'openstation.png' ];

mkdirSync( to, { recursive: true } );
for ( const name of ASSETS ) {
	cpSync( join( from, name ), join( to, name ) );
}

console.log(
	`[openstation-electron] copied ${ ASSETS.length } connect-screen assets into app/dist/renderer/`,
);
