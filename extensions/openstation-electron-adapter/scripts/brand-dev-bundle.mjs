import { copyFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = 'OpenStation';
const root = join( dirname( fileURLToPath( import.meta.url ) ), '..' );

if ( 'darwin' !== process.platform ) {

	process.exit( 0 );
}

const bundle = join( root, 'node_modules', 'electron', 'dist', 'Electron.app' );
const plist = join( bundle, 'Contents', 'Info.plist' );
const icon = join( bundle, 'Contents', 'Resources', 'electron.icns' );
const ours = join( root, 'build', 'icon.icns' );

if ( ! existsSync( plist ) ) {
	console.warn(
		'[openstation-electron] no local Electron bundle to brand; the menu bar will say "Electron".',
	);
	process.exit( 0 );
}

function setKey( key, value ) {
	try {
		execFileSync( '/usr/libexec/PlistBuddy', [
			'-c',
			`Set :${ key } ${ value }`,
			plist,
		] );
		return true;
	} catch {

		try {
			execFileSync( '/usr/libexec/PlistBuddy', [
				'-c',
				`Add :${ key } string ${ value }`,
				plist,
			] );
			return true;
		} catch {
			return false;
		}
	}
}

let changed = false;
for ( const key of [ 'CFBundleName', 'CFBundleDisplayName' ] ) {
	changed = setKey( key, NAME ) || changed;
}

if ( existsSync( ours ) ) {
	try {
		copyFileSync( ours, icon );
	} catch {
		console.warn( '[openstation-electron] could not replace the dev app icon.' );
	}
}

function reregister() {
	const lsregister =
		'/System/Library/Frameworks/CoreServices.framework/Frameworks/' +
		'LaunchServices.framework/Support/lsregister';
	if ( ! existsSync( lsregister ) ) {
		return false;
	}
	try {
		execFileSync( lsregister, [ '-f', bundle ], { stdio: 'ignore' } );
		return true;
	} catch {
		return false;
	}
}

const registered = changed && reregister();

console.log(
	changed
		? `[openstation-electron] dev bundle branded as ${ NAME }${
			registered
				? '.'
				: '; the Dock tooltip may still say "Electron" until you log out.'
		}`
		: '[openstation-electron] could not brand the dev bundle; the menu bar will say "Electron".',
);
