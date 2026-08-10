/**
 * Make `npm start` say "OpenStation" in the macOS menu bar.
 *
 * ## Why this is needed at all
 *
 * On macOS the bold title in the menu bar, and the name in the Dock,
 * come from the running **application bundle** — `CFBundleName` in its
 * `Info.plist`. They do not come from `app.setName()`, which is why
 * that call fixes "About OpenStation", "Hide OpenStation" and "Quit
 * OpenStation" (macOS builds those from `app.getName()`) while the
 * title beside them stubbornly reads "Electron".
 *
 * In development there is no OpenStation bundle: `electron .` runs
 * `node_modules/electron/dist/Electron.app`, whose name is, reasonably
 * enough, Electron. A packaged build has no such problem — its bundle
 * is OpenStation.app and every one of those strings is already right.
 *
 * So this is a **development affordance**, not part of the product. It
 * renames the local Electron bundle in `node_modules` and gives it the
 * OpenStation icon, so what you see while developing matches what you
 * ship.
 *
 * ## Why it is safe to write into node_modules
 *
 * It is the one thing that can work, and it is contained: the file
 * belongs to this checkout's own dev dependency, `npm install`
 * regenerates it, and every failure path here is a warning rather than
 * an error. Nothing about the app depends on it having run — skip it
 * and you get an app called Electron, which is exactly the status quo.
 *
 * Idempotent, macOS-only, and never fatal.
 */

import { copyFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = 'OpenStation';
const root = join( dirname( fileURLToPath( import.meta.url ) ), '..' );

if ( 'darwin' !== process.platform ) {
	// Windows and Linux take the name from `app.setName()`, which
	// already runs in `main.ts`. Nothing to do.
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

/**
 * @param  key   Info.plist key.
 * @param  value Value to set.
 * @return Whether the write succeeded.
 */
function setKey( key, value ) {
	try {
		execFileSync( '/usr/libexec/PlistBuddy', [
			'-c',
			`Set :${ key } ${ value }`,
			plist,
		] );
		return true;
	} catch {
		// The key may not exist yet — Electron ships CFBundleName but
		// not always CFBundleDisplayName.
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

console.log(
	changed
		? `[openstation-electron] dev bundle branded as ${ NAME }.`
		: '[openstation-electron] could not brand the dev bundle; the menu bar will say "Electron".',
);
