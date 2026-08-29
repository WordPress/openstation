/**
 * The connection bridge's registries across a bundle seam.
 *
 * `src/connection/index.ts` compiles into the shell bundle AND into
 * `window-system.js`. The write side —
 * {@link registerSyntheticIframe}, called from `native-windows.ts`
 * when it synthesises an `iframeContent` window's body iframe — is
 * reachable only from `desktop.ts` / `api/facade.ts`, so it lands in
 * the shell. The read side — {@link getSyntheticIframe}, called from
 * `Window.send()` — rides the lazy `window-system` bundle with the
 * `Window` class.
 *
 * On plain module-level `Map`s the two never met: the shell registered
 * into its copy, `Window.send()` consulted an empty one, resolved no
 * postMessage target, and fell through to `dispatchToNative()` — where
 * a shell-synthesised body has no subscriber, because there is no
 * render callback to have called `windowApi.on()`. Every `send()` to an
 * `iframeContent` window was dropped in silence.
 *
 * See AGENTS.md, "Cross-bundle state — wp.os.createSharedStore".
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import { loadTwoBundleCopies } from './helpers/bundle-seam';

type Connection = typeof import( '../../src/connection' );

/** The window-system copy and the shell copy, in that order. */
const loadCopies = (): Promise< [ Connection, Connection ] > =>
	loadTwoBundleCopies< Connection >(
		() => import( '../../src/connection?bundle-a' ) as Promise< Connection >,
		() => import( '../../src/connection?bundle-b' ) as Promise< Connection >,
	);

describe( 'connection registries across a bundle seam', () => {
	beforeEach( () => {
		_resetAllSharedStoresForTests();
	} );

	afterEach( () => {
		_resetAllSharedStoresForTests();
	} );

	test( 'a synthetic iframe registered in one bundle is visible to the other', async () => {
		const [ windowSystem, shell ] = await loadCopies();
		const iframe = document.createElement( 'iframe' );

		// `native-windows.ts` synthesising an `iframeContent` body —
		// shell bundle.
		shell.registerSyntheticIframe( 'probe', iframe );

		// `Window.send()` resolving its postMessage target —
		// window-system bundle.
		expect( windowSystem.getSyntheticIframe( 'probe' ) ).toBe( iframe );
	} );

	test( 'unregistering in one bundle clears the lookup in the other', async () => {
		const [ windowSystem, shell ] = await loadCopies();
		const iframe = document.createElement( 'iframe' );

		const unregister = shell.registerSyntheticIframe( 'probe', iframe );
		expect( windowSystem.getSyntheticIframe( 'probe' ) ).toBe( iframe );

		// The synthesised render's teardown, on window close.
		unregister();

		expect( windowSystem.getSyntheticIframe( 'probe' ) ).toBeNull();
	} );

	test( 'a window with no synthetic iframe still resolves to null', async () => {
		const [ windowSystem ] = await loadCopies();

		// Pure native windows have neither a `Window.iframe` nor a
		// synthetic one, and must keep falling through to the
		// in-process native dispatch.
		expect( windowSystem.getSyntheticIframe( 'absent' ) ).toBeNull();
	} );

	test( 'a re-registration under the same id supersedes the first, in both bundles', async () => {
		const [ windowSystem, shell ] = await loadCopies();
		const first = document.createElement( 'iframe' );
		const second = document.createElement( 'iframe' );

		const unregisterFirst = shell.registerSyntheticIframe( 'probe', first );
		shell.registerSyntheticIframe( 'probe', second );

		// The superseded registration's teardown must not evict the
		// live iframe — it only clears the entry when the entry is
		// still its own.
		unregisterFirst();

		expect( windowSystem.getSyntheticIframe( 'probe' ) ).toBe( second );
	} );
} );
