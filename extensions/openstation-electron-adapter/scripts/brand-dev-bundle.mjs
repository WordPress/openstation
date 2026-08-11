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
 * ## The plist edit is not sufficient on its own
 *
 * The menu-bar title reads the plist when the app launches, so that one
 * moves as soon as the key is written. **The Dock does not.**
 * LaunchServices keeps its own database of bundle metadata and answers
 * from that, so a freshly-renamed bundle still hovers as "Electron" —
 * which is what the Dock tooltip was reported as saying after this
 * script claimed to have fixed it.
 *
 * Re-registering the bundle with `lsregister -f` is what invalidates
 * that entry. It is best-effort like everything else here: the binary
 * lives at a private framework path, and a macOS release that moves it
 * costs a warning, not a build.
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

/**
 * Tell LaunchServices the bundle changed.
 *
 * Without this the Dock keeps answering from its cached metadata and
 * the tooltip stays "Electron" however many times the plist is
 * rewritten. See the note at the top of this file.
 *
 * @return Whether the re-registration ran.
 */
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
