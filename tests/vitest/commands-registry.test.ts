/**
 * Unit tests for the new 0.16.0 command-registry surface:
 *
 *   - `unregisterByOwner( owner )` bulk-evicts every command sharing
 *     the given owner tag. Used by the iframe-command bridge on focus
 *     change / window close, and by the command server-sync on plugin
 *     deactivation.
 *   - `listEagerCommands()` returns only commands flagged `eager`. The
 *     palette renders these on empty input (before the user types `/`);
 *     slash-only commands remain hidden.
 *   - The two surfaces are disjoint: a command flagged `eager` shows
 *     in `listEagerCommands()` but not in `filterCommands( '' )`-style
 *     slash-only flows (asserted indirectly — `eager`-filtered slash
 *     results are produced by the palette, not the registry; we only
 *     check that the eager flag round-trips through the registry).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

type CommandsModule = typeof import( '../../src/commands' );

async function load(): Promise< CommandsModule > {
	vi.resetModules();
	return await import( '../../src/commands' );
}

describe( 'commands.ts — 0.16.0 additions', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
		vi.restoreAllMocks();
	} );

	describe( 'unregisterByOwner', () => {
		test( 'removes every command with a matching owner and returns the count', async () => {
			const { registerCommand, unregisterByOwner, listCommands } = await load();
			registerCommand( { slug: 'a', label: 'A', owner: 'iframe:win-1', run: () => {} } );
			registerCommand( { slug: 'b', label: 'B', owner: 'iframe:win-1', run: () => {} } );
			registerCommand( { slug: 'c', label: 'C', owner: 'iframe:win-2', run: () => {} } );

			const removed = unregisterByOwner( 'iframe:win-1' );

			expect( removed ).toBe( 2 );
			const remaining = listCommands().map( ( c ) => c.slug );
			expect( remaining ).toEqual( [ 'c' ] );
		} );

		test( 'leaves untagged commands alone', async () => {
			const { registerCommand, unregisterByOwner, listCommands } = await load();
			registerCommand( { slug: 'tagged', label: 'T', owner: 'iframe:win-1', run: () => {} } );
			registerCommand( { slug: 'free', label: 'F', run: () => {} } );

			unregisterByOwner( 'iframe:win-1' );

			expect( listCommands().map( ( c ) => c.slug ) ).toEqual( [ 'free' ] );
		} );

		test( 'returns 0 when the owner is empty or matches nothing', async () => {
			const { registerCommand, unregisterByOwner } = await load();
			registerCommand( { slug: 'a', label: 'A', owner: 'iframe:win-1', run: () => {} } );

			expect( unregisterByOwner( '' ) ).toBe( 0 );
			expect( unregisterByOwner( 'iframe:win-99' ) ).toBe( 0 );
		} );

		test( 'notifies subscribers exactly once per call when commands were removed', async () => {
			const { registerCommand, unregisterByOwner, subscribeCommands } = await load();
			registerCommand( { slug: 'a', label: 'A', owner: 'iframe:win-1', run: () => {} } );
			registerCommand( { slug: 'b', label: 'B', owner: 'iframe:win-1', run: () => {} } );

			let calls = 0;
			const unsubscribe = subscribeCommands( () => {
				calls++;
			} );

			unregisterByOwner( 'iframe:win-1' );
			expect( calls ).toBe( 1 );

			// Second call — nothing to remove, must not notify.
			unregisterByOwner( 'iframe:win-1' );
			expect( calls ).toBe( 1 );

			unsubscribe();
		} );
	} );

	describe( 'listEagerCommands', () => {
		test( 'returns only the eager subset', async () => {
			const { registerCommand, listEagerCommands } = await load();
			registerCommand( { slug: 'slash-only', label: 'S', run: () => {} } );
			registerCommand( { slug: 'eager-1', label: 'E1', eager: true, run: () => {} } );
			registerCommand( { slug: 'eager-2', label: 'E2', eager: true, run: () => {} } );
			registerCommand( { slug: 'explicit-false', label: 'X', eager: false, run: () => {} } );

			const slugs = listEagerCommands().map( ( c ) => c.slug );
			expect( slugs ).toEqual( [ 'eager-1', 'eager-2' ] );
		} );

		test( 'returns an empty array when no eager commands are registered', async () => {
			const { registerCommand, listEagerCommands } = await load();
			registerCommand( { slug: 'a', label: 'A', run: () => {} } );
			expect( listEagerCommands() ).toEqual( [] );
		} );
	} );

	describe( 'registerCommand validation', () => {
		test( 'accepts vendor/sub-id slugs (namespacing)', async () => {
			const { registerCommand, listCommands } = await load();
			registerCommand( { slug: 'wpglp/convert', label: 'Convert', run: () => {} } );
			expect( listCommands().map( ( c ) => c.slug ) ).toContain(
				'wpglp/convert',
			);
		} );

		test( 'throws RegistrationError on missing slug', async () => {
			const { registerCommand } = await load();
			expect( () =>
				registerCommand( {
					slug: '',
					label: 'A',
					run: () => {},
				} as never ),
			).toThrow( /Command registration rejected/ );
		} );

		test( 'throws RegistrationError on bad slug characters', async () => {
			const { registerCommand } = await load();
			expect( () =>
				registerCommand( {
					slug: 'has spaces',
					label: 'A',
					run: () => {},
				} as never ),
			).toThrow( /Command registration rejected/ );
		} );

		test( 'throws RegistrationError on missing run function', async () => {
			const { registerCommand } = await load();
			expect( () =>
				registerCommand( {
					slug: 'no-run',
					label: 'A',
				} as never ),
			).toThrow( /Command registration rejected/ );
		} );
	} );
} );
