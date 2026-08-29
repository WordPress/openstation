/**
 * What happens when a harvested `core/commands` command is picked.
 *
 * The shell harvester re-publishes the WordPress-wide command set as
 * palette commands, and `action`-classified ones are dispatched by
 * calling the callback the store handed us. Three things about that
 * call are contract, not detail, and all three were once wrong at the
 * same time — which is what made a third-party command that listed,
 * highlighted and picked do nothing at all, with no error and no
 * console line to say why (issue #705):
 *
 *   - the callback receives the palette's REAL `close`, because
 *     WordPress documents the handler as `callback( { close } )` and
 *     commands written to that contract call it;
 *   - a callback that throws surfaces as a command error, because a
 *     swallowed throw is indistinguishable from a command that ran;
 *   - a name that is registered but has no live callback says so,
 *     for the same reason.
 *
 * `runInvoke` is private; the tests reach it the way the publish path
 * does, through a cast. Mounting the React harvester to get at it
 * would test `wp.element` rather than any of the above.
 */

import { describe, expect, test, vi } from 'vitest';

import { ShellCommandHarvester } from '../../src/commands/shell-harvester';
import type { CommandContext } from '../../src/commands';
import type { WindowManager } from '../../src/window-manager';

type StoreCallback = ( args: { close(): void } ) => void;

/** Reach the private invoke factory + its callback cache. */
interface HarvesterInternals {
	runInvoke( name: string ): (
		args: string,
		ctx: CommandContext,
	) => unknown;
	callbackCache: Record< string, StoreCallback >;
}

/**
 * A harvester with nothing mounted — `runInvoke` only reads the
 * callback cache, so the React side is irrelevant here.
 *
 * @param callbacks Callback cache contents, keyed by command name.
 * @return The harvester, typed for its private invoke surface.
 */
function harvesterWith(
	callbacks: Record< string, StoreCallback >,
): HarvesterInternals {
	const harvester = new ShellCommandHarvester( {
		manager: {} as WindowManager,
		adminUrl: 'https://example.test/wp-admin/',
	} );
	const internals = harvester as unknown as HarvesterInternals;
	internals.callbackCache = callbacks;
	return internals;
}

/** A palette context whose `close` records that it was called. */
function contextSpy(): { ctx: CommandContext; close: ReturnType< typeof vi.fn > } {
	const close = vi.fn();
	return {
		close,
		ctx: {
			close,
			openInWindow: vi.fn(),
			confirm: vi.fn( async () => true ),
		},
	};
}

describe( 'shell harvester — invoking a harvested command', () => {
	test( 'passes the palette’s real close to the callback', () => {
		const { ctx, close } = contextSpy();
		const harvester = harvesterWith( {
			'plugin/open-settings': ( args ) => args.close(),
		} );

		harvester.runInvoke( 'plugin/open-settings' )( '', ctx );

		expect( close ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'runs the callback with the arguments WordPress documents', () => {
		const { ctx } = contextSpy();
		const seen: Array< string[] > = [];
		const harvester = harvesterWith( {
			'plugin/probe': ( args ) => {
				seen.push( Object.keys( args ) );
			},
		} );

		harvester.runInvoke( 'plugin/probe' )( '', ctx );

		expect( seen ).toEqual( [ [ 'close' ] ] );
	} );

	test( 'lets a throwing callback surface as a command failure', () => {
		const { ctx, close } = contextSpy();
		const harvester = harvesterWith( {
			'plugin/broken': () => {
				throw new Error( 'sntAbilityRun is not defined' );
			},
		} );

		expect( () => harvester.runInvoke( 'plugin/broken' )( '', ctx ) ).toThrow(
			'sntAbilityRun is not defined',
		);
		// The palette is not dismissed on the way past — a failure the
		// user can read is the whole point, and it renders in the panel.
		expect( close ).not.toHaveBeenCalled();
	} );

	test( 'reports a registered command with no live callback', () => {
		const { ctx, close } = contextSpy();
		const harvester = harvesterWith( {} );

		expect( () => harvester.runInvoke( 'plugin/vanished' )( '', ctx ) ).toThrow(
			/plugin\/vanished/,
		);
		expect( close ).not.toHaveBeenCalled();
	} );
} );
