/**
 * Tests for the title-bar-button registry.
 *
 * Verifies validation rules, predicate filtering, owner-scoped
 * unregistration, and that registry changes notify subscribers
 * exactly once per write.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	registerTitleBarButton,
	unregisterTitleBarButton,
	unregisterTitleBarButtonsByOwner,
	listTitleBarButtons,
	buttonsForWindow,
	subscribeTitleBarButtons,
} from '../../src/title-bar-buttons/registry';
import type { Window as DesktopWindow } from '../../src/window';

function fakeWindow( id: string, overrides: Partial< DesktopWindow > = {} ): DesktopWindow {
	return {
		id,
		config: { id, native: false, url: 'http://example.test/wp-admin/post.php', title: id },
		...overrides,
	} as unknown as DesktopWindow;
}

describe( 'title-bar-buttons registry', () => {
	beforeEach( () => {
		// Drain any state left by earlier tests.
		for ( const def of listTitleBarButtons() ) {
			unregisterTitleBarButton( def.id );
		}
	} );

	afterEach( () => {
		for ( const def of listTitleBarButtons() ) {
			unregisterTitleBarButton( def.id );
		}
	} );

	test( 'registers a button with onClick + returns true', () => {
		const ok = registerTitleBarButton( {
			id: 'a',
			label: 'A',
			icon: 'dashicons-admin-generic',
			match: () => true,
			onClick: () => void 0,
		} );
		expect( ok ).toBe( true );
		expect( listTitleBarButtons() ).toHaveLength( 1 );
	} );

	test( 'accepts the vendor/sub-id namespacing convention', () => {
		// Matches the shape `wp_register_desktop_window( 'wpglp/preview' )`
		// uses; rejecting it here was the trap the developer hit.
		const ok = registerTitleBarButton( {
			id: 'wpglp/version',
			label: 'Version',
			icon: 'dashicons-info',
			match: () => true,
			onClick: () => void 0,
		} );
		expect( ok ).toBe( true );
		expect( listTitleBarButtons().map( ( b ) => b.id ) ).toContain(
			'wpglp/version',
		);
	} );

	test( 'rejects a button missing both onClick and render — returns false', () => {
		const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => void 0 );
		const ok = registerTitleBarButton( {
			id: 'b',
			label: 'B',
			icon: 'dashicons-admin-generic',
			match: () => true,
		} as never );
		expect( ok ).toBe( false );
		expect( listTitleBarButtons() ).toHaveLength( 0 );
		expect( warn ).toHaveBeenCalled();
		warn.mockRestore();
	} );

	test( 'rejects an id with truly invalid characters — returns false', () => {
		const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => void 0 );
		const ok = registerTitleBarButton( {
			id: 'has spaces',
			label: 'X',
			icon: 'i',
			match: () => true,
			onClick: () => void 0,
		} );
		expect( ok ).toBe( false );
		expect( listTitleBarButtons() ).toHaveLength( 0 );
		warn.mockRestore();
	} );

	test( 'predicate filters which windows see the button', () => {
		registerTitleBarButton( {
			id: 'gut',
			label: 'Gutenberg',
			icon: 'i',
			match: ( w ) => w.config.url?.includes( 'post.php' ) ?? false,
			onClick: () => void 0,
		} );
		const gut = fakeWindow( 'edit-post' );
		const other = fakeWindow( 'plugins', {
			config: {
				id: 'plugins',
				native: false,
				url: 'http://example.test/wp-admin/plugins.php',
				title: 'plugins',
			},
		} as unknown as DesktopWindow );

		expect( buttonsForWindow( gut ).left.map( ( b ) => b.id ) ).toEqual( [ 'gut' ] );
		expect( buttonsForWindow( other ).left ).toEqual( [] );
	} );

	test( 'placement + order partition + sort within side', () => {
		registerTitleBarButton( {
			id: 'l1',
			label: 'L1',
			icon: 'i',
			placement: 'left',
			order: 20,
			match: () => true,
			onClick: () => void 0,
		} );
		registerTitleBarButton( {
			id: 'l2',
			label: 'L2',
			icon: 'i',
			placement: 'left',
			order: 10,
			match: () => true,
			onClick: () => void 0,
		} );
		registerTitleBarButton( {
			id: 'r1',
			label: 'R1',
			icon: 'i',
			placement: 'right',
			match: () => true,
			onClick: () => void 0,
		} );
		const w = fakeWindow( 'w' );
		const { left, right } = buttonsForWindow( w );
		expect( left.map( ( b ) => b.id ) ).toEqual( [ 'l2', 'l1' ] );
		expect( right.map( ( b ) => b.id ) ).toEqual( [ 'r1' ] );
	} );

	test( 'unregisterTitleBarButtonsByOwner drops owned + notifies once', () => {
		const cb = vi.fn();
		const off = subscribeTitleBarButtons( cb );

		registerTitleBarButton( {
			id: 'a',
			label: 'A',
			icon: 'i',
			match: () => true,
			onClick: () => void 0,
			owner: 'plugin-x',
		} );
		registerTitleBarButton( {
			id: 'b',
			label: 'B',
			icon: 'i',
			match: () => true,
			onClick: () => void 0,
			owner: 'plugin-x',
		} );
		registerTitleBarButton( {
			id: 'c',
			label: 'C',
			icon: 'i',
			match: () => true,
			onClick: () => void 0,
			owner: 'plugin-y',
		} );
		const before = cb.mock.calls.length;
		const removed = unregisterTitleBarButtonsByOwner( 'plugin-x' );
		expect( removed ).toBe( 2 );
		expect( cb.mock.calls.length ).toBe( before + 1 );
		expect( listTitleBarButtons().map( ( b ) => b.id ) ).toEqual( [ 'c' ] );
		off();
	} );

	test( 'predicate that throws is treated as not-matching', () => {
		registerTitleBarButton( {
			id: 'broken',
			label: 'X',
			icon: 'i',
			match: () => {
				throw new Error( 'boom' );
			},
			onClick: () => void 0,
		} );
		const w = fakeWindow( 'w' );
		expect( buttonsForWindow( w ).left ).toEqual( [] );
	} );
} );
