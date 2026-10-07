import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

type Registry = typeof import( '../../src/modules/registry' );

async function loadRegistry(): Promise<Registry> {
	vi.resetModules();
	return await import( '../../src/modules/registry' );
}

describe( 'modules/registry.ts', () => {
	beforeEach( () => {

		delete ( window as unknown as { wp?: unknown } ).wp;
	} );

	afterEach( () => {
		delete ( window as unknown as { wp?: unknown } ).wp;
	} );

	test( 'registerModule + getModule round-trip', async () => {
		const { registerModule, getModule } = await loadRegistry();
		registerModule( {
			id: 'foo',
			url: 'https://example.com/foo.js',
		} );
		expect( getModule( 'foo' )?.url ).toBe(
			'https://example.com/foo.js'
		);
	} );

	test( 'moduleIds returns ids in registration order', async () => {
		const { registerModule, moduleIds } = await loadRegistry();
		registerModule( { id: 'alpha', url: 'https://x/a.js' } );
		registerModule( { id: 'beta', url: 'https://x/b.js' } );
		registerModule( { id: 'gamma', url: 'https://x/c.js' } );
		expect( moduleIds() ).toEqual( [ 'alpha', 'beta', 'gamma' ] );
	} );

	test( 'late registration replaces an existing id', async () => {
		const { registerModule, getModule } = await loadRegistry();
		registerModule( { id: 'x', url: 'https://old.example/x.js' } );
		registerModule( { id: 'x', url: 'https://new.example/x.js' } );
		expect( getModule( 'x' )?.url ).toBe( 'https://new.example/x.js' );
	} );

	test( 'registerModule silently rejects missing id', async () => {
		const { registerModule, moduleIds } = await loadRegistry();
		registerModule( {
			id: '',
			url: 'https://example.com/empty.js',
		} );
		expect( moduleIds() ).toEqual( [] );
	} );

	test( 'registerModule silently rejects missing url', async () => {
		const { registerModule, moduleIds } = await loadRegistry();
		registerModule( { id: 'urlless', url: '' } );
		expect( moduleIds() ).toEqual( [] );
	} );

	test( 'loadModules with empty array resolves immediately', async () => {
		const { loadModules } = await loadRegistry();
		await expect( loadModules( [] ) ).resolves.toBeUndefined();
	} );

	test( 'loadModules with an isReady check skips the actual fetch', async () => {
		const { registerModule, loadModules } = await loadRegistry();
		registerModule( {
			id: 'pretend-loaded',
			url: 'https://whatever/x.js',
			isReady: () => true,
		} );
		await expect( loadModules( [ 'pretend-loaded' ] ) ).resolves.toBeUndefined();
	} );

	test( 'loadModules throws a readable error listing unknown ids', async () => {
		const { registerModule, loadModules } = await loadRegistry();
		registerModule( {
			id: 'known',
			url: 'https://x/k.js',
			isReady: () => true,
		} );
		await expect(
			loadModules( [ 'known', 'ghost', 'another-ghost' ] ),
		).rejects.toThrow( /ghost.*another-ghost|another-ghost.*ghost/ );
	} );

	test( 'loadModules error message includes the known-modules list for discoverability', async () => {
		const { registerModule, loadModules } = await loadRegistry();
		registerModule( {
			id: 'pixijs',
			url: 'https://x/pixi.js',
			isReady: () => true,
		} );
		await expect( loadModules( [ 'typo' ] ) ).rejects.toThrow( /pixijs/ );
	} );
} );
