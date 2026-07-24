/**
 * Unit tests for the window-link renderer registry
 * (`src/window-links/renderer-registry.ts`):
 *
 *   - validation (id shape, reserved `none`, label, mount) with
 *     audible RegistrationError throws
 *   - replace-on-reregister semantics
 *   - owner-based bulk unregistration (server-sync deactivation path)
 *   - the `desktop-mode.window-links.renderers` list filter
 *   - subscriber notifications
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import { HOOKS } from '../../src/hooks';
import { clearHooksStub, installHooksStub, type FakeWpHooks } from './helpers/hooks-stub';

type RegistryModule = typeof import( '../../src/window-links/renderer-registry' );

async function load(): Promise< RegistryModule > {
	vi.resetModules();
	_resetAllSharedStoresForTests();
	return import( '../../src/window-links/renderer-registry' );
}

const def = ( overrides: Record< string, unknown > = {} ) => ( {
	id: 'vendor/lasers',
	label: 'Lasers',
	mount: () => () => {},
	...overrides,
} );

let hooks: FakeWpHooks;

beforeEach( () => {
	hooks = installHooksStub();
} );
afterEach( () => {
	clearHooksStub();
	_resetAllSharedStoresForTests();
	vi.restoreAllMocks();
} );

describe( 'registerWindowLinkRenderer', () => {
	test( 'registers and normalizes the id', async () => {
		const mod = await load();
		mod.registerWindowLinkRenderer(
			def( { id: ' Vendor/Lasers ' } ) as never,
		);

		expect(
			mod.listWindowLinkRenderers().map( ( r ) => r.id ),
		).toEqual( [ 'vendor/lasers' ] );
	} );

	test( 'throws on a malformed def, naming the bad field', async () => {
		const mod = await load();

		expect( () =>
			mod.registerWindowLinkRenderer( def( { id: 'NOT OK' } ) as never ),
		).toThrow( /id/ );
		expect( () =>
			mod.registerWindowLinkRenderer( def( { label: '' } ) as never ),
		).toThrow( /label/ );
		expect( () =>
			mod.registerWindowLinkRenderer(
				def( { mount: undefined } ) as never,
			),
		).toThrow( /mount/ );
	} );

	test( 'rejects the reserved `none` sentinel', async () => {
		const mod = await load();

		expect( () =>
			mod.registerWindowLinkRenderer(
				def( { id: mod.WINDOW_LINK_RENDERER_NONE } ) as never,
			),
		).toThrow( /reserved/ );
	} );

	test( 're-registering the same id replaces the entry', async () => {
		const mod = await load();
		mod.registerWindowLinkRenderer( def() as never );
		mod.registerWindowLinkRenderer(
			def( { label: 'Better Lasers' } ) as never,
		);

		const list = mod.listWindowLinkRenderers();
		expect( list ).toHaveLength( 1 );
		expect( list[ 0 ].label ).toBe( 'Better Lasers' );
	} );
} );

describe( 'unregistration', () => {
	test( 'unregisterWindowLinkRenderer removes by id', async () => {
		const mod = await load();
		mod.registerWindowLinkRenderer( def() as never );

		mod.unregisterWindowLinkRenderer( 'vendor/lasers' );

		expect( mod.listWindowLinkRenderers() ).toEqual( [] );
	} );

	test( 'unregisterWindowLinkRenderersByOwner sweeps by owner tag', async () => {
		const mod = await load();
		mod.registerWindowLinkRenderer(
			def( { id: 'a', owner: 'my-plugin' } ) as never,
		);
		mod.registerWindowLinkRenderer(
			def( { id: 'b', owner: 'my-plugin' } ) as never,
		);
		mod.registerWindowLinkRenderer(
			def( { id: 'c', owner: 'other' } ) as never,
		);

		expect( mod.unregisterWindowLinkRenderersByOwner( 'my-plugin' ) ).toBe( 2 );
		expect(
			mod.listWindowLinkRenderers().map( ( r ) => r.id ),
		).toEqual( [ 'c' ] );
		expect( mod.unregisterWindowLinkRenderersByOwner( '' ) ).toBe( 0 );
	} );
} );

describe( 'list filter + subscription', () => {
	test( 'the renderers filter reshapes the list on every read', async () => {
		const mod = await load();
		mod.registerWindowLinkRenderer( def() as never );
		hooks.addFilter(
			HOOKS.WINDOW_LINK_RENDERERS,
			'vitest/drop-all',
			() => [],
		);

		expect( mod.listWindowLinkRenderers() ).toEqual( [] );
		expect( mod.getWindowLinkRenderer( 'vendor/lasers' ) ).toBeUndefined();
	} );

	test( 'subscribers fire on register and unregister', async () => {
		const mod = await load();
		const cb = vi.fn();
		const off = mod.subscribeWindowLinkRenderers( cb );

		mod.registerWindowLinkRenderer( def() as never );
		mod.unregisterWindowLinkRenderer( 'vendor/lasers' );
		expect( cb ).toHaveBeenCalledTimes( 2 );

		off();
		mod.registerWindowLinkRenderer( def() as never );
		expect( cb ).toHaveBeenCalledTimes( 2 );
	} );
} );
