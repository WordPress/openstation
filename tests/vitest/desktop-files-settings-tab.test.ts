/**
 * Phase-5 OS Settings tab tests. The tab renders into a host
 * element from `registerSettingsTab`'s `render` callback; we
 * exercise that callback directly.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

async function loadAll(): Promise< {
	settings: typeof import( '../../src/settings/registry' );
	openers: typeof import( '../../src/desktop-files/openers' );
	registry: typeof import( '../../src/desktop-files/registry' );
	rest: typeof import( '../../src/desktop-files/rest' );
	tab: typeof import( '../../src/desktop-files/settings-tab' );
} > {
	vi.resetModules();
	return {
		settings: await import( '../../src/settings/registry' ),
		openers: await import( '../../src/desktop-files/openers' ),
		registry: await import( '../../src/desktop-files/registry' ),
		rest: await import( '../../src/desktop-files/rest' ),
		tab: await import( '../../src/desktop-files/settings-tab' ),
	};
}

describe( 'File Associations OS Settings tab', () => {
	beforeEach( () => {
		installHooksStub();
	} );

	afterEach( () => {
		clearHooksStub();
		vi.unstubAllGlobals();
		document.body.innerHTML = '';
	} );

	test( 'registerFileAssociationsTab adds a tab to the registry', async () => {
		const { tab, settings } = await loadAll();
		tab.registerFileAssociationsTab();
		const ids = settings.listSettingsTabs().map( ( t ) => t.id );
		expect( ids ).toContain( 'desktop-mode-file-associations' );
	} );

	test( 'render produces one row per registered file type', async () => {
		const { tab, settings, registry, openers } = await loadAll();
		registry.registerType( { type: 'post', label: 'Post', sort: 10 } );
		registry.registerType( { type: 'user', label: 'User', sort: 20 } );
		openers.registerOpener( {
			id: 'gutenberg',
			label: 'Gutenberg',
			types: [ 'post' ],
			isDefault: true,
			handler: { kind: 'url', url: () => '' },
		} );
		openers.registerOpener( {
			id: 'profile',
			label: 'Profile',
			types: [ 'user' ],
			isDefault: true,
			handler: { kind: 'url', url: () => '' },
		} );
		tab.registerFileAssociationsTab();

		const def = settings
			.listSettingsTabs()
			.find( ( t ) => t.id === 'desktop-mode-file-associations' )!;
		const body = document.createElement( 'div' );
		def.render( body, { isAdmin: true, getOsSettings: () => ( {} as never ), subscribeOsSettings: () => () => undefined } );

		const rows = body.querySelectorAll( '.desktop-mode-file-associations__row' );
		expect( rows.length ).toBe( 2 );
	} );

	test( 'changing the select POSTs the new association', async () => {
		const { tab, settings, registry, openers, rest } = await loadAll();
		registry.registerType( { type: 'post', label: 'Post', sort: 10 } );
		openers.registerOpener( {
			id: 'gutenberg',
			label: 'Gutenberg',
			types: [ 'post' ],
			isDefault: true,
			handler: { kind: 'url', url: () => '' },
		} );
		openers.registerOpener( {
			id: 'classic',
			label: 'Classic',
			types: [ 'post' ],
			handler: { kind: 'url', url: () => '' },
		} );
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		const fetchSpy = vi.fn( async () =>
			new Response( JSON.stringify( { associations: { post: 'classic' } } ), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			} ),
		);
		vi.stubGlobal( 'fetch', fetchSpy );

		tab.registerFileAssociationsTab();
		const def = settings
			.listSettingsTabs()
			.find( ( t ) => t.id === 'desktop-mode-file-associations' )!;
		const body = document.createElement( 'div' );
		def.render( body, { isAdmin: true, getOsSettings: () => ( {} as never ), subscribeOsSettings: () => () => undefined } );

		const select = body.querySelector< HTMLElement >( 'wpd-select' )!;
		select.dispatchEvent(
			new CustomEvent( 'wpd-pick', {
				detail: { value: 'classic' },
				bubbles: true,
			} ),
		);
		// Drain the microtask the optimistic save kicks off.
		await Promise.resolve();
		expect( fetchSpy ).toHaveBeenCalledTimes( 1 );
		const init = fetchSpy.mock.calls[ 0 ][ 1 ] as RequestInit;
		expect( init.method ).toBe( 'PUT' );
		expect( ( init.body as string ) ).toContain( '"post":"classic"' );

		// Optimistic update should have flipped the resolver immediately.
		expect( openers.resolveOpener( 'post' )?.id ).toBe( 'classic' );
	} );

	test( 'shows a hint row when a type has no opener', async () => {
		const { tab, settings, registry } = await loadAll();
		registry.registerType( { type: 'orphan', label: 'Orphan', sort: 10 } );
		tab.registerFileAssociationsTab();
		const def = settings
			.listSettingsTabs()
			.find( ( t ) => t.id === 'desktop-mode-file-associations' )!;
		const body = document.createElement( 'div' );
		def.render( body, { isAdmin: true, getOsSettings: () => ( {} as never ), subscribeOsSettings: () => () => undefined } );
		expect( body.querySelector( '.desktop-mode-file-associations__none' ) ).not.toBeNull();
	} );
} );
