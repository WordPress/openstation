import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const BUNDLES = {
	shell: 'assets/js/desktop.js',
	notes: 'assets/js/notes.js',
	windowSystem: 'assets/js/window-system.js',
	filesOverlays: 'assets/js/files-overlays.js',
	fileDrop: 'assets/js/file-drop.js',
} as const;

const SHARED_KEYS = [
	'desktop-mode/canvas-payload-handlers',
	'desktop-mode/recycle-bin-payload-handlers',
	'desktop-mode/tile-payload-handlers',
	'desktop-mode/heartbeat-bus',
] as const;

const WINDOW_SYSTEM_SHARED_KEYS = [
	'desktop-mode/window-channels',
	'desktop-mode/admin-link-deps',

	'desktop-mode/connection',
] as const;

const FILES_SHARED_KEYS = [ 'desktop-files/rest-deps' ] as const;

function read( path: string ): string | null {
	return existsSync( path ) ? readFileSync( path, 'utf8' ) : null;
}

const shell = read( BUNDLES.shell );
const notes = read( BUNDLES.notes );
const windowSystem = read( BUNDLES.windowSystem );
const filesOverlays = read( BUNDLES.filesOverlays );
const fileDrop = read( BUNDLES.fileDrop );
const built =
	shell !== null &&
	notes !== null &&
	windowSystem !== null &&
	filesOverlays !== null &&
	fileDrop !== null;

describe.skipIf( ! built )( 'cross-bundle state', () => {
	for ( const key of SHARED_KEYS ) {
		it( `"${ key }" is resolved through the shared store in both bundles`, () => {
			expect(
				shell?.includes( key ),
				`${ key } absent from the shell bundle — its state is module-level again, so the notes bundle cannot see it`,
			).toBe( true );
			expect(
				notes?.includes( key ),
				`${ key } absent from the notes bundle — its state is module-level again, so the shell cannot see it`,
			).toBe( true );
		} );
	}

	for ( const key of WINDOW_SYSTEM_SHARED_KEYS ) {
		it( `"${ key }" is resolved through the shared store in the shell and window-system bundles`, () => {
			expect(
				shell?.includes( key ),
				`${ key } absent from the shell bundle — its state is module-level again, so the window-system bundle cannot see it`,
			).toBe( true );
			expect(
				windowSystem?.includes( key ),
				`${ key } absent from the window-system bundle — its state is module-level again, so the shell cannot see it`,
			).toBe( true );
		} );
	}

	for ( const key of FILES_SHARED_KEYS ) {
		it( `"${ key }" is resolved through the shared store in the shell, files-overlays and file-drop bundles`, () => {
			expect(
				shell?.includes( key ),
				`${ key } absent from the shell bundle — its state is module-level again, so the lazy files bundles cannot see the deps it installs`,
			).toBe( true );
			expect(
				filesOverlays?.includes( key ),
				`${ key } absent from the files-overlays bundle — its state is module-level again, so it cannot see the deps the shell installed`,
			).toBe( true );
			expect(
				fileDrop?.includes( key ),
				`${ key } absent from the file-drop bundle — its state is module-level again, so it cannot see the deps the shell installed`,
			).toBe( true );
		} );
	}
} );
