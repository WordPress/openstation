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

		'cache-control': 'no-store',
	} );
	createReadStream( file ).pipe( res );
} );

server.listen( port, () => {
	process.stdout.write( `mio-js demo → http://localhost:${ port }/\n` );
} );
