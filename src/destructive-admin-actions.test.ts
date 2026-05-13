/**
 * Tests for the destructive-admin-action registry.
 *
 * Covers register / unregister / replace / list / match plus the
 * cross-bundle store contract (the registry's whole reason for
 * existence — see file header).
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
	registerDestructiveAdminAction,
	unregisterDestructiveAdminAction,
	listDestructiveAdminActions,
	matchDestructiveAdminAction,
	_resetDestructiveAdminActionsForTests,
	type DestructiveAdminActionEntry,
} from './destructive-admin-actions';

beforeEach( () => {
	_resetDestructiveAdminActionsForTests();
} );

function parse( href: string ): URL {
	return new URL( href, 'http://example.test' );
}

describe( 'destructive-admin-actions: register / unregister', () => {
	test( 'registered predicate matches its URL', () => {
		registerDestructiveAdminAction( {
			id: 'plugin/foo',
			matches: ( _url, parsed ) =>
				parsed.searchParams.get( 'action' ) === 'foo' &&
				parsed.searchParams.has( '_wpnonce' ),
		} );

		const url = 'http://example.test/wp-admin/admin.php?page=p&action=foo&_wpnonce=abc';
		expect( matchDestructiveAdminAction( url, parse( url ) ) ).toBe(
			'plugin/foo',
		);
	} );

	test( 'predicate that returns false leaves the URL unclaimed', () => {
		registerDestructiveAdminAction( {
			id: 'plugin/foo',
			matches: () => false,
		} );

		const url = 'http://example.test/wp-admin/admin.php?action=foo&_wpnonce=abc';
		expect( matchDestructiveAdminAction( url, parse( url ) ) ).toBeNull();
	} );

	test( 'unregister removes the predicate', () => {
		registerDestructiveAdminAction( {
			id: 'plugin/foo',
			matches: () => true,
		} );
		expect( listDestructiveAdminActions() ).toHaveLength( 1 );

		unregisterDestructiveAdminAction( 'plugin/foo' );
		expect( listDestructiveAdminActions() ).toHaveLength( 0 );

		const url = 'http://example.test/wp-admin/admin.php?action=foo';
		expect( matchDestructiveAdminAction( url, parse( url ) ) ).toBeNull();
	} );

	test( 'returned unregister function removes the entry', () => {
		const unregister = registerDestructiveAdminAction( {
			id: 'plugin/foo',
			matches: () => true,
		} );
		expect( listDestructiveAdminActions() ).toHaveLength( 1 );

		unregister();
		expect( listDestructiveAdminActions() ).toHaveLength( 0 );
	} );

	test( 're-registering the same id replaces the prior entry', () => {
		const first = vi.fn().mockReturnValue( false );
		const second = vi.fn().mockReturnValue( true );

		registerDestructiveAdminAction( { id: 'plugin/foo', matches: first } );
		registerDestructiveAdminAction( { id: 'plugin/foo', matches: second } );

		expect( listDestructiveAdminActions() ).toHaveLength( 1 );

		const url = 'http://example.test/wp-admin/admin.php?action=foo';
		expect( matchDestructiveAdminAction( url, parse( url ) ) ).toBe(
			'plugin/foo',
		);
		expect( first ).not.toHaveBeenCalled();
		expect( second ).toHaveBeenCalled();
	} );

	test( 'first registered predicate that claims the URL wins', () => {
		registerDestructiveAdminAction( {
			id: 'plugin/first',
			matches: () => true,
		} );
		registerDestructiveAdminAction( {
			id: 'plugin/second',
			matches: () => true,
		} );

		const url = 'http://example.test/wp-admin/admin.php?action=foo';
		expect( matchDestructiveAdminAction( url, parse( url ) ) ).toBe(
			'plugin/first',
		);
	} );

	test( 'malformed entry returns a no-op unregister, registry unchanged', () => {
		// Missing matches.
		const u1 = registerDestructiveAdminAction(
			{ id: 'plugin/bad' } as unknown as DestructiveAdminActionEntry,
		);
		// Empty id.
		const u2 = registerDestructiveAdminAction( {
			id: '   ',
			matches: () => true,
		} );
		// Non-function matches.
		const u3 = registerDestructiveAdminAction( {
			id: 'plugin/bad-fn',
			matches: 'nope' as unknown as DestructiveAdminActionEntry[ 'matches' ],
		} );

		expect( listDestructiveAdminActions() ).toHaveLength( 0 );
		expect( () => {
			u1();
			u2();
			u3();
		} ).not.toThrow();
	} );

	test( 'throwing predicate is logged but does not abort the walk', () => {
		const consoleSpy = vi
			.spyOn( console, 'warn' )
			.mockImplementation( () => {} );

		registerDestructiveAdminAction( {
			id: 'plugin/throws',
			matches: () => {
				throw new Error( 'boom' );
			},
		} );
		registerDestructiveAdminAction( {
			id: 'plugin/good',
			matches: () => true,
		} );

		const url = 'http://example.test/wp-admin/admin.php?action=foo';
		expect( matchDestructiveAdminAction( url, parse( url ) ) ).toBe(
			'plugin/good',
		);
		expect( consoleSpy ).toHaveBeenCalledWith(
			expect.stringContaining( 'plugin/throws' ),
			expect.any( Error ),
		);
		consoleSpy.mockRestore();
	} );

	test( 'listDestructiveAdminActions returns a defensive copy', () => {
		registerDestructiveAdminAction( {
			id: 'plugin/foo',
			matches: () => true,
		} );
		const snapshot = listDestructiveAdminActions();
		snapshot.length = 0;
		expect( listDestructiveAdminActions() ).toHaveLength( 1 );
	} );

	test( 'walker passes both raw URL string and parsed URL to the predicate', () => {
		const matches = vi.fn().mockReturnValue( true );
		registerDestructiveAdminAction( { id: 'plugin/foo', matches } );

		const raw = 'http://example.test/wp-admin/admin.php?action=foo';
		matchDestructiveAdminAction( raw, parse( raw ) );

		expect( matches ).toHaveBeenCalledTimes( 1 );
		const [ urlArg, parsedArg ] = matches.mock.calls[ 0 ];
		expect( urlArg ).toBe( raw );
		expect( parsedArg ).toBeInstanceOf( URL );
		expect( parsedArg.searchParams.get( 'action' ) ).toBe( 'foo' );
	} );
} );

describe( 'destructive-admin-actions: cross-bundle store', () => {
	// The registry routes through `createSharedStore` so a write
	// from bundle A is visible to bundle B. Vitest collapses both
	// imports into the same module, so we can't simulate the
	// two-bundle path directly — but we CAN pin the slot key, which
	// is the runtime contract that makes the cross-bundle sharing
	// work.
	test( 'state lives on the shared-stores slot under the documented key', () => {
		registerDestructiveAdminAction( {
			id: 'plugin/foo',
			matches: () => true,
		} );
		const slot = (
			window as unknown as {
				__desktopModeSharedStores?: Map< string, unknown >;
			}
		).__desktopModeSharedStores;
		expect( slot ).toBeDefined();
		expect( slot?.has( 'desktop-mode/destructive-admin-actions' ) ).toBe(
			true,
		);
	} );
} );
