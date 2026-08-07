/**
 * mio-js — static server for the demo page.
 *
 * `npm run demo` → http://localhost:4321/
 *
 * Node's own http module and nothing else: the demo is two static
 * files, and a dependency to serve them would be larger than the thing
 * being served. Serves the extension directory so `demo/index.html`
 * can reference `../dist/mio.js` directly and you are always looking
 * at the file the build just wrote.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const port = Number( process.env.PORT || 4321 );

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.map': 'application/json; charset=utf-8',
};

const server = createServer( ( req, res ) => {
	const url = new URL( req.url, `http://localhost:${ port }` );
	const requested = decodeURIComponent( url.pathname );
	let file = path.join( root, requested === '/' ? 'demo/index.html' : requested );

	// Never serve outside the extension directory, whatever the
	// request says — `..` segments survive URL parsing.
	if ( ! path.resolve( file ).startsWith( root ) ) {
		res.writeHead( 403 ).end( 'Forbidden' );
		return;
	}
	if ( existsSync( file ) && statSync( file ).isDirectory() ) {
		file = path.join( file, 'index.html' );
	}
	if ( ! existsSync( file ) ) {
		res.writeHead( 404, { 'content-type': 'text/plain' } ).end( 'Not found' );
		return;
	}
	res.writeHead( 200, {
		'content-type': TYPES[ path.extname( file ) ] || 'application/octet-stream',
		// The demo is for looking at a build you just made.
		'cache-control': 'no-store',
	} );
	createReadStream( file ).pipe( res );
} );

server.listen( port, () => {
	process.stdout.write( `mio-js demo → http://localhost:${ port }/\n` );
} );
