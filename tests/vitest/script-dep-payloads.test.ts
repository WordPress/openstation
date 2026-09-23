/**
 * `scriptDeps` travel as handles; each payload rides once in
 * `scriptDepPayloads` (GH#892). The shell must resolve them back
 * before any loader sees them, in order, on the refresh path too.
 */
import { describe, expect, test, vi } from 'vitest';
import { createApplyPayload } from '../../src/menu-refresh-apply';
import type { MenuRefreshDeps } from '../../src/menu-refresh-apply';
import { hydrateScriptDeps } from '../../src/script-dep-payloads';
import type { DesktopConfig } from '../../src/types';

const shared = {
	url: '',
	before: [],
	after: [],
	l10n: [ 'var acmeConfig = {"big":true};' ],
	translations: '',
	handle: 'acme-config',
};
const hooks = {
	url: 'https://example.test/hooks.js',
	before: [],
	after: [],
	l10n: [],
	translations: '',
	handle: 'wp-hooks',
};

describe( 'hydrateScriptDeps', () => {
	test( 'resolves handles to the full payloads, in order', () => {
		const config = {
			scriptDepPayloads: { 'acme-config': shared, 'wp-hooks': hooks },
			serverCommandScripts: [
				{ handle: 'a', scriptDeps: [ 'wp-hooks', 'acme-config' ] },
				{ handle: 'b', scriptDeps: [ 'acme-config' ] },
			],
			serverGames: [ { id: 'g', scriptDeps: [] } ],
		};
		hydrateScriptDeps( config );
		expect( config.serverCommandScripts[ 0 ].scriptDeps ).toEqual( [ hooks, shared ] );
		expect( config.serverCommandScripts[ 1 ].scriptDeps ).toEqual( [ shared ] );
		expect( config.serverGames[ 0 ].scriptDeps ).toEqual( [] );
	} );

	test( 'passes full payloads through and skips unknown handles', () => {
		const config = {
			scriptDepPayloads: { 'wp-hooks': hooks },
			serverWallpapers: [ { id: 'w', scriptDeps: [ shared, 'gone', 'wp-hooks' ] } ],
		};
		hydrateScriptDeps( config );
		expect( config.serverWallpapers[ 0 ].scriptDeps ).toEqual( [ shared, hooks ] );
	} );

	test( 'leaves a payload without the map untouched', () => {
		const config = { serverWidgets: [ { id: 'x', scriptDeps: [ shared ] } ] };
		hydrateScriptDeps( config );
		expect( config.serverWidgets[ 0 ].scriptDeps ).toEqual( [ shared ] );
	} );
} );

describe( 'menu refresh', () => {
	test( 'the command sync receives resolved payloads, not handles', () => {
		const commands = vi.fn().mockResolvedValue( undefined );
		const noop = vi.fn().mockResolvedValue( undefined );
		const deps = new Proxy(
			{
				applyDockItems: vi.fn(),
				desktopArea: document.createElement( 'div' ),
				config: { dockItems: [] } as unknown as DesktopConfig,
				syncServerCommands: commands,
			},
			{ get: ( t, k ) => ( k in t ? t[ k as keyof typeof t ] : noop ) },
		) as unknown as MenuRefreshDeps;

		createApplyPayload( deps )( {
			dockItems: [ { id: 'menu-dashboard', title: 'Dashboard', url: 'index.php' } ],
			scriptDepPayloads: { 'acme-config': shared },
			serverCommandScripts: [ { handle: 'a', scriptUrl: 'a.js', scriptDeps: [ 'acme-config' ] } ],
			serverCommands: [],
		} );

		expect( commands ).toHaveBeenCalled();
		const scripts = commands.mock.calls[ 0 ][ 0 ] as Array< { scriptDeps: unknown } >;
		expect( scripts[ 0 ].scriptDeps ).toEqual( [ shared ] );
	} );
} );
