import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const URL = 'https://example.test/assets/js/os-components.min.js';

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

		expect( injectedScripts() ).toHaveLength( 0 );
	} );

	it( 'resolves rather than rejecting when no URL is configured', async () => {
		const { loadComponents } = await freshLoader();
		config().openStationConfig = { componentsBundleUrl: '' };

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
