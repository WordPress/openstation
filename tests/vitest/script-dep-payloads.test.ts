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

	test( 'passes full payloads through; an unknown handle is dropped and logged', () => {
		// The server resolves every handle it emits into the map
		// (`openstation_compact_script_dep_list()`), so a handle without
		// an entry came from somewhere else. There is nothing to load,
		// but losing a dependency must not be silent.
		const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		const config = {
			scriptDepPayloads: { 'wp-hooks': hooks },
			serverWallpapers: [ { id: 'w', scriptDeps: [ shared, 'gone', 'wp-hooks' ] } ],
		};
		hydrateScriptDeps( config );
		expect( config.serverWallpapers[ 0 ].scriptDeps ).toEqual( [ shared, hooks ] );
		expect( warn ).toHaveBeenCalledTimes( 1 );
		expect( String( warn.mock.calls[ 0 ][ 0 ] ) ).toContain( '"gone"' );
		expect( String( warn.mock.calls[ 0 ][ 0 ] ) ).toContain( 'serverWallpapers' );
		warn.mockRestore();
	} );

	test( 'touches scriptDeps at entry depth only, never a plugin\'s own metadata', () => {
		// A plugin's settings can carry a key that happens to be called
		// `scriptDeps`. Walking into it would resolve its strings away
		// (they are not in the map) and rewrite data that is not ours.
		const foreign = [ 'a', 'b' ];
		const config = {
			scriptDepPayloads: { 'wp-hooks': hooks },
			serverWidgets: [
				{ id: 'x', scriptDeps: [ 'wp-hooks' ], settings: { scriptDeps: foreign } },
			],
		};
		hydrateScriptDeps( config );
		expect( config.serverWidgets[ 0 ].scriptDeps ).toEqual( [ hooks ] );
		expect( config.serverWidgets[ 0 ].settings.scriptDeps ).toBe( foreign );
		expect( foreign ).toEqual( [ 'a', 'b' ] );
	} );

	test( 'an entry list keyed by id is covered the same as a plain list', () => {
		const config = {
			scriptDepPayloads: { 'wp-hooks': hooks },
			serverSettingsTabs: { general: { id: 'general', scriptDeps: [ 'wp-hooks' ] } },
		};
		hydrateScriptDeps( config );
		expect( config.serverSettingsTabs.general.scriptDeps ).toEqual( [ hooks ] );
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

	test( 'the refresh map is merged into config.scriptDepPayloads', () => {
		// After a plugin activates, config.server* holds its handles.
		// Anything that re-hydrates config, or reads the map, must find
		// them there, and handles known at boot must not be lost.
		const noop = vi.fn().mockResolvedValue( undefined );
		const config = {
			dockItems: [],
			scriptDepPayloads: { 'wp-hooks': hooks },
		} as unknown as DesktopConfig;
		const deps = new Proxy(
			{
				applyDockItems: vi.fn(),
				desktopArea: document.createElement( 'div' ),
				config,
			},
			{ get: ( t, k ) => ( k in t ? t[ k as keyof typeof t ] : noop ) },
		) as unknown as MenuRefreshDeps;

		createApplyPayload( deps )( {
			dockItems: [ { id: 'menu-dashboard', title: 'Dashboard', url: 'index.php' } ],
			scriptDepPayloads: { 'acme-config': shared },
			serverCommandScripts: [ { handle: 'a', scriptUrl: 'a.js', scriptDeps: [ 'acme-config' ] } ],
			serverCommands: [],
		} );

		expect( config.scriptDepPayloads ).toEqual( { 'wp-hooks': hooks, 'acme-config': shared } );
	} );
} );
