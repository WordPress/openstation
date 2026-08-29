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
	windowSystem: 'assets/js/window-system.js',
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

/**
 * The same check across the shell ↔ `window-system` seam.
 *
 * `window-channels.ts` is compiled into both: `createWindowElement()`
 * marks a window loading from the window-system bundle, while the
 * shell's own callers (`native-windows.ts`' synthetic-iframe readiness
 * signal, `connection/index.ts`' subscriber registration) run in the
 * shell bundle. On module-level `Set`s those two halves kept separate
 * bookkeeping, so `WINDOW_CONTENT_LOADED` never fired and windows sat
 * under the loading overlay forever.
 */
const WINDOW_SYSTEM_SHARED_KEYS = [
	'desktop-mode/window-channels',
	'desktop-mode/admin-link-deps',
] as const;

function read( path: string ): string | null {
	return existsSync( path ) ? readFileSync( path, 'utf8' ) : null;
}

const shell = read( BUNDLES.shell );
const notes = read( BUNDLES.notes );
const windowSystem = read( BUNDLES.windowSystem );
const built = shell !== null && notes !== null && windowSystem !== null;

/**
 * Skipped when the bundles are not built.
 *
 * `assets/js/*.js` is build output and gitignored, and CI's Vitest job
 * deliberately does not build before running tests — so in that job
 * there is genuinely nothing to inspect, and asserting the files exist
 * would fail for a reason that has nothing to do with the code.
 *
 * Skipping here is only safe because the check is ENFORCED somewhere
 * the bundles do exist: the `plugin-check` job builds and then runs
 * this file explicitly. Locally `npm run build && npm run test:js`
 * covers it the same way. Without that second home this would be a
 * vacuous pass, which is exactly how this class of bug travels.
 */
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
} );
