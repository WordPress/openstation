/**
 * `wp.os.loadComponents()` — the runtime route to the component kit.
 *
 * The contract these pin, in the order a caller meets them: don't
 * fetch what the page already has, do fetch what it doesn't, share
 * one `<script>` between concurrent callers, and say something
 * useful when a tag name isn't a component.
 *
 * `tests/vitest/setup.ts` registers the kit directly, which is
 * convenient here: "already registered" is the default state, so
 * the no-fetch path is the one that needs no arranging and the
 * fetch path is arranged by naming a tag the setup file leaves out.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const URL = 'https://example.test/assets/js/os-components.min.js';

/**
 * A real component the vitest setup leaves unregistered — it only
 * pre-registers the overlay kit. This is the tag a plugin author
 * hits in production too: `<os-switch>` is in the kit and is not on
 * the page.
 */
const UNREGISTERED = 'os-switch';

async function freshLoader(): Promise< typeof import( './loader' ) > {
	vi.resetModules();
	return import( './loader' );
}

function config(): { openStationConfig?: { componentsBundleUrl?: string } } {
	return window as unknown as {
		openStationConfig?: { componentsBundleUrl?: string };
	};
}

function injectedScripts(): HTMLScriptElement[] {
	return Array.from(
		document.querySelectorAll< HTMLScriptElement >(
			'script[data-os-components="1"]',
		),
	);
}

beforeEach( () => {
	delete window.openStationComponents;
	config().openStationConfig = { componentsBundleUrl: URL };
	injectedScripts().forEach( ( el ) => el.remove() );
} );

afterEach( () => {
	vi.restoreAllMocks();
} );

describe( 'loadComponents', () => {
	it( 'resolves without fetching when the tags are already registered', async () => {
		expect( customElements.get( 'os-button' ) ).toBeTruthy();

		const { loadComponents } = await freshLoader();
		await loadComponents( [ 'os-button', 'os-text-field' ] );

		expect( injectedScripts() ).toHaveLength( 0 );
	} );

	it( 'fetches the kit when a requested tag is missing', async () => {
		const { loadComponents } = await freshLoader();
		expect( customElements.get( UNREGISTERED ) ).toBeFalsy();
		const pending = loadComponents( [ 'os-button', UNREGISTERED ] );

		const tag = injectedScripts()[ 0 ];
		expect( tag ).toBeTruthy();
		expect( tag.src ).toBe( URL );

		window.openStationComponents = true;
		tag.dispatchEvent( new Event( 'load' ) );
		await expect( pending ).resolves.toBeUndefined();
	} );

	it( 'shares one script between concurrent callers', async () => {
		const { loadComponents } = await freshLoader();
		const a = loadComponents();
		const b = loadComponents();

		expect( injectedScripts() ).toHaveLength( 1 );

		window.openStationComponents = true;
		injectedScripts()[ 0 ].dispatchEvent( new Event( 'load' ) );
		await Promise.all( [ a, b ] );
	} );

	it( 'skips the fetch entirely once the kit has run', async () => {
		const { loadComponents } = await freshLoader();
		window.openStationComponents = true;

		await loadComponents();
		expect( injectedScripts() ).toHaveLength( 0 );
	} );

	it( 'reports tag names that are not components, and still loads the rest', async () => {
		const error = vi.spyOn( console, 'error' ).mockImplementation( () => {} );
		const { loadComponents } = await freshLoader();

		await loadComponents( [ 'os-button', 'os-buton' ] );

		expect( error ).toHaveBeenCalledTimes( 1 );
		expect( String( error.mock.calls[ 0 ][ 0 ] ) ).toContain( '<os-buton>' );
		// `os-button` was registered, so nothing had to be fetched —
		// a bad name in the list must not drag in the whole kit.
		expect( injectedScripts() ).toHaveLength( 0 );
	} );

	it( 'resolves rather than rejecting when no URL is configured', async () => {
		const { loadComponents } = await freshLoader();
		config().openStationConfig = { componentsBundleUrl: '' };

		// Unit tests and misconfigured deploys land here. Letting the
		// caller render and leaving the missing-import warner to name
		// the tag beats suppressing their UI.
		await expect( loadComponents( [ UNREGISTERED ] ) ).resolves.toBeUndefined();
	} );

	it( 'lets a later call retry after a failed fetch', async () => {
		const { loadComponents } = await freshLoader();
		const first = loadComponents();
		injectedScripts()[ 0 ].dispatchEvent( new Event( 'error' ) );
		await expect( first ).rejects.toThrow( /component kit/ );

		injectedScripts().forEach( ( el ) => el.remove() );
		const second = loadComponents();
		expect( injectedScripts() ).toHaveLength( 1 );

		window.openStationComponents = true;
		injectedScripts()[ 0 ].dispatchEvent( new Event( 'load' ) );
		await expect( second ).resolves.toBeUndefined();
	} );

	it( 'rejects when the bundle loads without setting its flag', async () => {
		const { loadComponents } = await freshLoader();
		const pending = loadComponents();
		injectedScripts()[ 0 ].dispatchEvent( new Event( 'load' ) );

		await expect( pending ).rejects.toThrow( /openStationComponents/ );
	} );
} );
