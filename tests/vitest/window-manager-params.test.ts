/**
 * Native-window open-time params, and their survival through the
 * session.
 *
 * A native window is addressed by id, and its id is its identity:
 * `desktop-mode-user-edit` is "the profile editor", not "the profile
 * editor for user 12". Anything that varies per open has nowhere else
 * to live — and the shared store the profile window used had no
 * answer for a page reload, so the restored window came back showing
 * whoever was logged in rather than the person the user had open.
 *
 * These tests pin the whole round trip: opening with params, staging
 * them onto a live window, writing them into the snapshot, and
 * dropping values that would take the save down with them.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import { __resetNativeWindowGeometryForTests } from '../../src/window-manager/native-window-geometry';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

function nativeConfig( id: string, extras: Record< string, unknown > = {} ) {
	return {
		id,
		baseId: id,
		native: true,
		url: `#${ id }`,
		title: id,
		icon: 'dashicons-admin-generic',
		render: () => undefined,
		...extras,
	};
}

describe( 'native window params', () => {
	let desktopArea: HTMLElement;
	let manager: WindowManager;

	beforeEach( () => {
		installHooksStub();
		__resetNativeWindowGeometryForTests();
		desktopArea = document.createElement( 'div' );
		Object.defineProperty( desktopArea, 'getBoundingClientRect', {
			value: () =>
				( {
					left: 0,
					top: 0,
					right: 1600,
					bottom: 900,
					width: 1600,
					height: 900,
					x: 0,
					y: 0,
					toJSON: () => ( {} ),
				} ) as DOMRect,
		} );
		document.body.appendChild( desktopArea );
		manager = new WindowManager( desktopArea );
	} );

	afterEach( () => {
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktopArea.remove();
		clearHooksStub();
		__resetNativeWindowGeometryForTests();
	} );

	test( 'params ride the window config', async () => {
		const win = await manager.open(
			nativeConfig( 'desktop-mode-user-edit', {
				params: { userId: 12 },
			} ),
		);

		expect( win.config.params ).toEqual( { userId: 12 } );
	} );

	test( 'reopening with new params retargets the live window', async () => {
		await manager.open(
			nativeConfig( 'desktop-mode-user-edit', {
				params: { userId: 12 },
			} ),
		);
		const again = await manager.open(
			nativeConfig( 'desktop-mode-user-edit', {
				params: { userId: 44 },
			} ),
		);

		// `open()` focuses an existing window rather than rebuilding
		// it, so without this the window keeps showing user 12 — the
		// failure mode that reads as "clicking a second person does
		// nothing".
		expect( again.config.params ).toEqual( { userId: 44 } );
	} );

	test( 'an argument-less reopen leaves the target alone', async () => {
		await manager.open(
			nativeConfig( 'desktop-mode-user-edit', {
				params: { userId: 12 },
			} ),
		);
		// A dock click on an already-open profile window must not wipe
		// whose profile it is.
		const again = await manager.open(
			nativeConfig( 'desktop-mode-user-edit' ),
		);

		expect( again.config.params ).toEqual( { userId: 12 } );
	} );

	test( 'the snapshot carries params for native windows', async () => {
		await manager.open(
			nativeConfig( 'desktop-mode-woo-customer', {
				params: { customerId: 7, customerName: 'Ada' },
			} ),
		);

		const saved = manager
			.snapshot()
			.windows.find( ( w ) => w.id === 'desktop-mode-woo-customer' );

		expect( saved?.params ).toEqual( {
			customerId: 7,
			customerName: 'Ada',
		} );
	} );

	test( 'an iframe window carries no params — its URL already says', async () => {
		await manager.open( {
			id: 'edit-php',
			baseId: 'edit-php',
			url: 'http://example.test/wp-admin/edit.php',
			title: 'Posts',
			icon: 'dashicons-admin-post',
			params: { userId: 12 },
		} );

		const saved = manager
			.snapshot()
			.windows.find( ( w ) => w.id === 'edit-php' );

		expect( saved?.params ).toBeUndefined();
	} );

	test( 'unserializable values are dropped rather than taking the save down', async () => {
		const cyclic: Record< string, unknown > = {};
		cyclic.self = cyclic;

		await manager.open(
			nativeConfig( 'desktop-mode-woo-customer', {
				params: {
					customerId: 7,
					// A plugin's careless value must not cost every
					// other window its geometry.
					node: document.createElement( 'div' ),
					cb: () => undefined,
					cyclic,
					nan: Number.NaN,
				},
			} ),
		);

		const saved = manager
			.snapshot()
			.windows.find( ( w ) => w.id === 'desktop-mode-woo-customer' );

		expect( saved?.params ).toEqual( { customerId: 7 } );
		expect( () => JSON.stringify( manager.snapshot() ) ).not.toThrow();
	} );

	test( 'a window opened with no params writes none', async () => {
		await manager.open( nativeConfig( 'desktop-mode-os-settings' ) );

		const saved = manager
			.snapshot()
			.windows.find( ( w ) => w.id === 'desktop-mode-os-settings' );

		expect( saved?.params ).toBeUndefined();
	} );
} );
