import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname( fileURLToPath( import.meta.url ) );
const pluginRoot = path.resolve( scriptsDir, '..' );

const pinnedFiles = Object.freeze( {
	'games/popup-breaker/assets/openstation-adapter.js':
		'12cca60751e7eb72cfb1bad4fac6ebdf2f15e2ff5f562f9509ba00aaf2189e1c',
	'games/popup-breaker/assets/popup-siege-runtime-0.7.0.js':
		'661d27e019841d35af457f3bbacf4f7d85c1d426b2f8b4d19d4a9d2f6511808e',
	'standalone/popup-breaker.css':
		'44d9fad7c1543c3ccc3e2ea9f1a439a94e63951c8ba5a2321eaef1431fcbffe7',
	'games/popup-breaker/assets/images/popup-siege-side-console-0.5.1-source.png':
		'63244315047e5aa134e4ad7c3529114da8cdd17bee848ad0086c65b2bedb7f0b',
	'games/popup-breaker/assets/images/popup-siege-side-console-0.5.1.png':
		'701ea0805f3e0fa54c46b97d217a75abadda9bb8bf43ad752eb2fa1f012d967e',
} );

function sha256( file ) {
	return crypto
		.createHash( 'sha256' )
		.update( fs.readFileSync( file ) )
		.digest( 'hex' );
}

function collectJavaScript( directory ) {
	return fs.readdirSync( directory, { withFileTypes: true } ).flatMap(
		( entry ) => {
			const absolute = path.join( directory, entry.name );
			if ( entry.isDirectory() ) {
				return collectJavaScript( absolute );
			}
			return entry.isFile() && entry.name.endsWith( '.js' )
				? [ absolute ]
				: [];
		}
	);
}

for ( const [ relative, expected ] of Object.entries( pinnedFiles ) ) {
	const absolute = path.join( pluginRoot, relative );
	if ( ! fs.existsSync( absolute ) ) {
		throw new Error( `Missing pinned release file: ${ relative }` );
	}
	const actual = sha256( absolute );
	if ( actual !== expected ) {
		throw new Error(
			`Release hash mismatch for ${ relative }: ${ actual }`
		);
	}
}

const cssLayers = [
	'standalone/popup-breaker-0.2.0.css',
	'standalone/popup-breaker-0.6.0.css',
	'standalone/popup-breaker-0.6.1.css',
	'standalone/popup-breaker-0.7.0.css',
];
for ( const relative of cssLayers ) {
	if ( ! fs.existsSync( path.join( pluginRoot, relative ) ) ) {
		throw new Error( `Missing Popup Siege CSS layer: ${ relative }` );
	}
}

const runtime = fs.readFileSync(
	path.join(
		pluginRoot,
		'games/popup-breaker/assets/popup-siege-runtime-0.7.0.js'
	),
	'utf8'
);
if ( runtime.includes( 'pixi.min.js' ) || runtime.includes( 'pixi.js/dist' ) ) {
	throw new Error( 'Popup Siege must use OpenStation’s shared PixiJS module.' );
}

for ( const file of [
	...collectJavaScript( path.join( pluginRoot, 'sdk' ) ),
	...collectJavaScript(
		path.join( pluginRoot, 'games/popup-breaker/assets' )
	),
] ) {
	execFileSync( process.execPath, [ '--check', file ], {
		stdio: 'inherit',
	} );
}

process.stdout.write(
	`Verified ${ Object.keys( pinnedFiles ).length } pinned artifacts and Popup Siege JavaScript syntax.\n`
);
