/** Batch updates must paint each server-confirmed result before moving on. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockViewContext, renderedText } from '../../src/app-runtime/testing';
import type { OsTable } from '../../src/ui/components/os-table/os-table';
import type { AppData, AppState, InstalledPlugin } from './parts/types';
import app from './plugins.os';

function deferred< T >() {
	let resolve!: ( value: T ) => void;
	const promise = new Promise< T >( ( done ) => {
		resolve = done;
	} );
	return { promise, resolve };
}

function plugin( slug: string ): InstalledPlugin {
	return {
		plugin: `${ slug }/${ slug }`, name: `Plugin ${ slug }`, status: 'inactive', version: '1.0',
		openstation_update_available: { available: true, new_version: '2.0', package: 'https://example.test/plugin.zip', slug },
	};
}

function mount( view: 'cards' | 'table' ) {
	const root = document.createElement( 'div' );
	document.body.appendChild( root );
	const replies = [ deferred<Response>(), deferred<Response>() ];
	const refreshes = [ deferred<boolean>(), deferred<boolean>() ];
	const fetch = vi.fn().mockImplementationOnce( () => replies[ 0 ].promise ).mockImplementationOnce( () => replies[ 1 ].promise );
	let read = 0;
	const ctx = mockViewContext<AppState, AppData>( {
		root,
		state: { tab: 'installed', installedView: view, status: '', search: '', browse: 'featured', query: '' },
		data: { installed: [ plugin( 'alpha' ), plugin( 'beta' ) ], error: '' },
		extra: {
			ajaxUrl: 'https://example.test/wp-admin/admin-ajax.php', ajaxNonce: 'nonce', updatesNonce: 'updates',
			caps: { activate: true, delete: true, install: false, upload: false, update: true },
		},
		fetch,
	} );
	ctx.dispatch = vi.fn( async ( action ) => {
		expect( action ).toBe( 'refresh' );
		const index = read++;
		const changed = await refreshes[ index ].promise;
		if ( changed ) {
			ctx.data.installed = ctx.data.installed.map( ( row, i ) => i === index
				? { ...row, version: '2.0', openstation_update_available: { available: false, new_version: '', package: '', slug: '' } }
				: row );
		}
		ctx.repaint();
		return true;
	} );
	ctx.repaint = () => app.render( ctx );
	app.render( ctx );
	const surface = ( slug: string ) => view === 'cards'
		? root.querySelector<HTMLElement>( `[data-plugin-card="${ slug }/${ slug }"]` )!
		: Array.from( root.querySelector( 'os-table' )!.shadowRoot!.querySelectorAll<HTMLElement>( 'tbody tr' ) ).find( ( tr ) => tr.textContent?.includes( `Plugin ${ slug }` ) )!;
	const start = async () => {
		await Promise.resolve();
		if ( view === 'cards' ) {
			root.querySelectorAll( '.os-plugins__pick' ).forEach( ( checkbox ) => checkbox.dispatchEvent( new CustomEvent( 'os-checkbox-change', { detail: { checked: true } } ) ) );
		} else {
			const table = root.querySelector<OsTable<InstalledPlugin>>( 'os-table' )!;
			table.select( 'alpha/alpha' );
			table.select( 'beta/beta' );
		}
		root.querySelector<HTMLElement>( '.os-plugins__selection-actions os-button' )!.click();
		await vi.waitFor( () => expect( fetch ).toHaveBeenCalledTimes( 1 ) );
	};
	return { root, ctx, replies, refreshes, fetch, surface, start };
}

function response( success: boolean ): Response {
	return new Response( JSON.stringify( {
		success, data: success ? { newVersion: 'Version 2.0' } : { errorMessage: 'Download failed.' },
	} ), { status: 200 } );
}

afterEach( () => {
	document.body.replaceChildren();
	vi.restoreAllMocks();
} );

describe.each( [ 'cards', 'table' ] as const )( '%s batch update results', ( view ) => {
	it( 'refreshes and paints each completed row while the next update is still pending', async () => {
		const { root, ctx, replies, refreshes, fetch, surface, start } = mount( view );
		await start();
		replies[ 0 ].resolve( response( true ) );
		await vi.waitFor( () => expect( ctx.dispatch ).toHaveBeenCalledTimes( 1 ) );
		expect( fetch ).toHaveBeenCalledTimes( 1 );
		expect( surface( 'alpha' ).querySelector( '[aria-busy="true"]' ) ).not.toBeNull();
		refreshes[ 0 ].resolve( true );
		await vi.waitFor( () => expect( fetch ).toHaveBeenCalledTimes( 2 ) );
		expect( renderedText( surface( 'alpha' ) ) ).toContain( '2.0' );
		expect( surface( 'alpha' ).querySelector( '[aria-busy="true"]' ) ).toBeNull();
		expect( Array.from( surface( 'alpha' ).querySelectorAll( 'os-button' ) ).some( ( button ) => button.textContent === 'Update' ) ).toBe( false );
		expect( root.querySelector( '[data-filter="update"] strong' )?.textContent ).toBe( '1' );
		expect( surface( 'beta' ).querySelector( '[aria-busy="true"]' ) ).not.toBeNull();
		replies[ 1 ].resolve( response( true ) );
		await vi.waitFor( () => expect( ctx.dispatch ).toHaveBeenCalledTimes( 2 ) );
		refreshes[ 1 ].resolve( true );
		await vi.waitFor( () => expect( renderedText( surface( 'beta' ) ) ).toContain( '2.0' ) );
		await vi.waitFor( () => expect( root.querySelector( '.os-plugins__selection-count' )?.textContent ).toBe( '0 selected' ) );
	} );

	it( 'keeps a failed row retryable and still reconciles the next successful row', async () => {
		const { ctx, replies, refreshes, surface, start } = mount( view );
		await start();
		replies[ 0 ].resolve( response( false ) );
		await vi.waitFor( () => expect( ctx.dispatch ).toHaveBeenCalledTimes( 1 ) );
		refreshes[ 0 ].resolve( false );
		await vi.waitFor( () => expect( surface( 'alpha' ).querySelector( '[aria-busy="true"]' ) ).toBeNull() );
		expect( renderedText( surface( 'alpha' ) ) ).toContain( '1.0' );
		expect( Array.from( surface( 'alpha' ).querySelectorAll( 'os-button' ) ).some( ( button ) => button.textContent === 'Update' ) ).toBe( true );
		replies[ 1 ].resolve( response( true ) );
		await vi.waitFor( () => expect( ctx.dispatch ).toHaveBeenCalledTimes( 2 ) );
		refreshes[ 1 ].resolve( true );
		await vi.waitFor( () => expect( surface( 'beta' ).querySelector( '[aria-busy="true"]' ) ).toBeNull() );
		expect( renderedText( surface( 'beta' ) ) ).toContain( '2.0' );
	} );
} );
