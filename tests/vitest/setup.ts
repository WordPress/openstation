/**
 * Vitest global setup — runs once per test file before any
 * `describe` / `test` block.
 *
 * Pre-registers every `<wpd-*>` component class that production
 * code loads lazily via the `shell-overlays[.min].js` bundle, so
 * unit tests that exercise menu / dialog / toast call paths see
 * upgraded custom elements without each test needing its own leaf
 * import.
 *
 * Production main bundle does NOT load these — that's the whole
 * point of the lazy split. The setup file is in
 * `tests/vitest/` and only runs under vitest, so esbuild's
 * tree-shake of the production build never sees it.
 *
 * Keep this list in sync with `src/shell-overlays/entry.ts`.
 */
// Mock localStorage if it is undefined (e.g., due to jsdom configuration or Node 26 compatibility issues)
if ( typeof window !== 'undefined' && ! window.localStorage ) {
	const store: Record< string, string > = {};
	Object.defineProperty( window, 'localStorage', {
		value: {
			getItem: ( key: string ) => store[ key ] || null,
			setItem: ( key: string, value: string ) => { store[ key ] = String( value ); },
			removeItem: ( key: string ) => { delete store[ key ]; },
			clear: () => { for ( const k of Object.keys( store ) ) { delete store[ k ]; } },
			key: ( index: number ) => Object.keys( store )[ index ] || null,
			get length() { return Object.keys( store ).length; },
		},
		writable: true,
		configurable: true,
	} );
}

import '../../src/ui/components/wpd-toast/wpd-toast';
import '../../src/ui/components/wpd-confirm-dialog/wpd-confirm-dialog';
import '../../src/ui/components/wpd-context-menu/wpd-context-menu';

/**
 * Pre-register the lazy `window-system[.min].js` factory.
 *
 * Production main bundle loads this via `<script>` injection on the
 * first `manager.open()` call (Stage 11). In jsdom unit tests we
 * don't fetch scripts — instead we import the `Window` class
 * directly and wire the factory by hand so
 * `ensureWindowSystemLoaded( '' )` returns the pre-registered
 * factory on its sync fast path. Tests still have to `await`
 * `manager.open()` / `openNew()` (both async) —
 * the factory just keeps the `await` resolving on the next
 * microtask instead of waiting for a script load that's never
 * going to happen.
 */
import { Window as DesktopWindow } from '../../src/window';
( window as unknown as {
	desktopModeWindowSystem?: { createWindow: ( cfg: unknown ) => unknown };
} ).desktopModeWindowSystem = {
	createWindow: ( cfg: unknown ) =>
		new DesktopWindow( cfg as ConstructorParameters< typeof DesktopWindow >[ 0 ] ),
};
