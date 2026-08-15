/**
 * Readiness contract for the lazy `shell-overlays[.min].js` loader.
 *
 * The regression these tests exist for: the loader used to decide
 * "is the bundle here?" by asking `customElements.get(
 * 'os-confirm-dialog' )`. That tag is registered by this bundle —
 * and by `window-system`, by feature bundles that import the
 * component directly, and (through one long import chain) by
 * `desktop.min.js` itself. Once any of those beat the loader to it,
 * the check answered "loaded" before a single byte had been fetched,
 * the bundle was never requested, and every tag that nothing else
 * happened to register stayed inert — `<os-context-menu>` above all,
 * which is a right-click that silently opens nothing.
 *
 * `tests/vitest/setup.ts` registers the whole component kit
 * up front, so this file runs in exactly the poisoned state that
 * used to break production.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const URL = 'https://example.test/assets/js/shell-overlays.min.js';

async function freshLoader(): Promise< typeof import( './loader' ) > {
	vi.resetModules();
	return import( './loader' );
}

/** Loosely-typed handle on the boot config the loader reads its URL from. */
function config(): { openStationConfig?: { shellOverlaysBundleUrl?: string } } {
	return window as unknown as {
		openStationConfig?: { shellOverlaysBundleUrl?: string };
	};
}

beforeEach( () => {
	delete window.openStationShellOverlays;
	config().openStationConfig = { shellOverlaysBundleUrl: URL };
	document
		.querySelectorAll( 'script[data-os-shell-overlays="1"]' )
		.forEach( ( el ) => el.remove() );
} );

describe( 'shell-overlays loader readiness', () => {
	it( 'does not treat a registered component tag as a loaded bundle', async () => {
		// Precondition: the setup file registered the canary tag the
		// old implementation sniffed. If this ever stops being true
		// the test below stops proving anything.
		expect( customElements.get( 'os-confirm-dialog' ) ).toBeTruthy();

		const { openWithShellOverlays } = await freshLoader();
		const fn = vi.fn();
		openWithShellOverlays( () => true, fn );

		// The bundle has not announced itself, so the menu must wait
		// for the script rather than construct an element whose class
		// may not exist.
		expect( fn ).not.toHaveBeenCalled();
		expect(
			document.querySelector( 'script[data-os-shell-overlays="1"]' ),
		).toBeTruthy();
	} );

	it( 'runs synchronously once the bundle sets its flag', async () => {
		window.openStationShellOverlays = true;

		const { openWithShellOverlays } = await freshLoader();
		const fn = vi.fn();
		openWithShellOverlays( () => true, fn );

		expect( fn ).toHaveBeenCalledTimes( 1 );
		expect(
			document.querySelector( 'script[data-os-shell-overlays="1"]' ),
		).toBeNull();
	} );

	it( 'keeps the no-URL fast path for test / misconfigured environments', async () => {
		const { openWithShellOverlays } = await freshLoader();
		config().openStationConfig = { shellOverlaysBundleUrl: '' };

		const fn = vi.fn();
		openWithShellOverlays( () => true, fn );
		expect( fn ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'resolves ensureShellOverlaysLoaded when the script sets the flag', async () => {
		const { ensureShellOverlaysLoaded } = await freshLoader();
		const pending = ensureShellOverlaysLoaded( URL );
		const tag = document.querySelector< HTMLScriptElement >(
			'script[data-os-shell-overlays="1"]',
		);
		expect( tag ).toBeTruthy();

		// jsdom never fetches; stand in for the bundle's entry.
		window.openStationShellOverlays = true;
		tag?.dispatchEvent( new Event( 'load' ) );

		await expect( pending ).resolves.toBeUndefined();
	} );

	it( 'rejects when the script loads without setting the flag', async () => {
		const { ensureShellOverlaysLoaded } = await freshLoader();
		const pending = ensureShellOverlaysLoaded( URL );
		const tag = document.querySelector< HTMLScriptElement >(
			'script[data-os-shell-overlays="1"]',
		);
		tag?.dispatchEvent( new Event( 'load' ) );

		await expect( pending ).rejects.toThrow(
			/openStationShellOverlays/,
		);
	} );
} );
