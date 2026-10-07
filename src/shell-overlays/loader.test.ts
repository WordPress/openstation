import { beforeEach, describe, expect, it, vi } from 'vitest';

const URL = 'https://example.test/assets/js/shell-overlays.min.js';

async function freshLoader(): Promise< typeof import( './loader' ) > {
	vi.resetModules();
	return import( './loader' );
}

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
		expect( customElements.get( 'os-confirm-dialog' ) ).toBeTruthy();

		const { openWithShellOverlays } = await freshLoader();
		const fn = vi.fn();
		openWithShellOverlays( () => true, fn );

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
