import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import { loadTwoBundleCopies } from './helpers/bundle-seam';

type Connection = typeof import( '../../src/connection' );

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

		shell.registerSyntheticIframe( 'probe', iframe );

		expect( windowSystem.getSyntheticIframe( 'probe' ) ).toBe( iframe );
	} );

	test( 'unregistering in one bundle clears the lookup in the other', async () => {
		const [ windowSystem, shell ] = await loadCopies();
		const iframe = document.createElement( 'iframe' );

		const unregister = shell.registerSyntheticIframe( 'probe', iframe );
		expect( windowSystem.getSyntheticIframe( 'probe' ) ).toBe( iframe );

		unregister();

		expect( windowSystem.getSyntheticIframe( 'probe' ) ).toBeNull();
	} );

	test( 'a window with no synthetic iframe still resolves to null', async () => {
		const [ windowSystem ] = await loadCopies();

		expect( windowSystem.getSyntheticIframe( 'absent' ) ).toBeNull();
	} );

	test( 'a re-registration under the same id supersedes the first, in both bundles', async () => {
		const [ windowSystem, shell ] = await loadCopies();
		const first = document.createElement( 'iframe' );
		const second = document.createElement( 'iframe' );

		const unregisterFirst = shell.registerSyntheticIframe( 'probe', first );
		shell.registerSyntheticIframe( 'probe', second );

		unregisterFirst();

		expect( windowSystem.getSyntheticIframe( 'probe' ) ).toBe( second );
	} );
} );
