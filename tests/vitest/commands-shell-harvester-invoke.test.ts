import { afterEach, describe, expect, test, vi } from 'vitest';

import { ShellCommandHarvester } from '../../src/commands/shell-harvester';
import {
	findCommand,
	unregisterByOwner,
	type CommandContext,
} from '../../src/commands';
import type { WindowManager } from '../../src/window-manager';

type StoreCallback = ( args: { close(): void } ) => void;

interface HarvesterInternals {
	runInvoke( name: string ): (
		args: string,
		ctx: CommandContext,
	) => unknown;
	callbackCache: Record< string, StoreCallback >;
}

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

describe( 'shell harvester — running a "Go to" command', () => {
	afterEach( () => {
		unregisterByOwner( 'global' );
		Reflect.deleteProperty( window, '__openStationMenuCommands' );
	} );

	test( 'titles the window with the menu label after a re-harvest', () => {
		const name = 'options-general.php-options-permalink.php';
		Object.assign( window, {
			__openStationMenuCommands: [
				{ label: 'Settings > Permalinks', url: 'options-permalink.php', name },
			],
		} );
		const open = vi.fn();
		const harvester = new ShellCommandHarvester( {
			manager: { open } as unknown as WindowManager,
			adminUrl: 'https://example.test/wp-admin/',
		} ) as unknown as { publish( raw: unknown[] ): void };
		const goTo = { name, label: 'Go to: Settings > Permalinks', callback: () => {} };
		const viewSite = { name: 'core/view-site', label: 'View site', callback: () => {} };

		harvester.publish( [ goTo ] );
		harvester.publish( [ goTo, viewSite ] );
		findCommand( 'global-options-general-php-options-permalink-php' )
			?.run( '', contextSpy().ctx );

		expect( open ).toHaveBeenCalledWith(
			expect.objectContaining( { title: 'Settings > Permalinks' } ),
		);
	} );
} );
