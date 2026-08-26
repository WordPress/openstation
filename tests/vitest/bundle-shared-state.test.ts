/**
 * Cross-bundle state, checked against the BUILT bundles.
 *
 * This is the one class of bug the rest of the suite structurally
 * cannot see. Vitest imports both sides of a seam into a single module
 * graph, so a module-level `Map` looks shared here no matter what — and
 * in the browser it is not: each Vite bundle compiles its own copy.
 *
 * That is what broke pinned notes. `canvas-payloads`,
 * `recycle-bin-payloads`, `tile-payloads` and the Heartbeat bus are
 * compiled into the shell bundle AND into `notes.js`. The notes bundle
 * registered its drop handlers into its own copy of each map while the
 * shell's FilesLayer, Trash tile and shortcut tiles consulted theirs, so
 * tearing a note onto the wallpaper answered "Can't pin here", dropping
 * one on Trash was rejected, and `bootHeartbeatBus()` — which runs in
 * the shell — never pumped the registry the notes bundle had subscribed
 * to, so another user's edits never arrived without a reload.
 *
 * The fix is `createSharedStore`, which keys state on the page rather
 * than on the module. This test asserts the KEY is present in both
 * bundles: if either side ever reverts to module-level state, its key
 * disappears and this fails.
 *
 * See AGENTS.md, "Cross-bundle state — wp.os.createSharedStore".
 */

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const BUNDLES = {
	shell: 'assets/js/desktop.js',
	notes: 'assets/js/notes.js',
} as const;

/**
 * Every shared-store key whose state is reachable from more than one
 * bundle. Each must appear in both, or the two copies are not talking.
 */
const SHARED_KEYS = [
	'desktop-mode/canvas-payload-handlers',
	'desktop-mode/recycle-bin-payload-handlers',
	'desktop-mode/tile-payload-handlers',
	'desktop-mode/heartbeat-bus',
] as const;

function read( path: string ): string | null {
	return existsSync( path ) ? readFileSync( path, 'utf8' ) : null;
}

describe( 'cross-bundle state', () => {
	const shell = read( BUNDLES.shell );
	const notes = read( BUNDLES.notes );

	it( 'has the built bundles to check', () => {
		// A guard rather than a silent skip: if the dev bundles are
		// missing, every assertion below would vacuously pass and the
		// regression would sail through. Run `npm run build`.
		expect( shell, `${ BUNDLES.shell } missing — run npm run build` ).not.toBeNull();
		expect( notes, `${ BUNDLES.notes } missing — run npm run build` ).not.toBeNull();
	} );

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
} );
