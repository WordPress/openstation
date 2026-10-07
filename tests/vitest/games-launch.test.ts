import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import type { GameLaunchContext, GameRegistryEntry } from '../../src/games/types';

type Registry = typeof import( '../../src/games/registry' );
type Launch = typeof import( '../../src/games/launch' );

interface FakeDesktop {
	registerWindow: ReturnType< typeof vi.fn >;
	onWindow: ReturnType< typeof vi.fn >;
	wallpaper: {
		suspend: ReturnType< typeof vi.fn >;
		resume: ReturnType< typeof vi.fn >;
	};
	loadVendorScript: ReturnType< typeof vi.fn >;
	windowManager: {
		getById: ReturnType< typeof vi.fn >;
		getByBaseId?: ReturnType< typeof vi.fn >;
		getActiveDesktopId?: ReturnType< typeof vi.fn >;
		switchDesktop?: ReturnType< typeof vi.fn >;
	};
	activity: { publish: ReturnType< typeof vi.fn > };
	fetch: ReturnType< typeof vi.fn >;
	config: { restUrl: string; restNonce: string };
}

async function loadModules(): Promise< { registry: Registry; launch: Launch } > {
	_resetAllSharedStoresForTests();
	vi.resetModules();
	return {
		registry: await import( '../../src/games/registry' ),
		launch: await import( '../../src/games/launch' ),
	};
}

describe( 'games/launch.ts', () => {
	let fake: FakeDesktop;

	let windowHandlers: { closed?: () => void };

	let capturedTeardown: ( () => void ) | void;

	let capturedCtx: GameLaunchContext | null;

	beforeEach( () => {
		installHooksStub();
		windowHandlers = {};
		capturedTeardown = undefined;
		capturedCtx = null;
		fake = {
			registerWindow: vi.fn().mockImplementation(
				async ( def: {
					render: (
						body: HTMLElement,
					) =>
						| ( () => void )
						| void
						| Promise< ( () => void ) | void >;
				} ) => {

					capturedTeardown = await def.render(
						document.createElement( 'div' ),
					);
					return {};
				},
			),
			onWindow: vi.fn().mockImplementation(
				( _id: string, handlers: { closed?: () => void } ) => {
					windowHandlers = handlers;
					return () => undefined;
				},
			),
			wallpaper: { suspend: vi.fn(), resume: vi.fn() },
			loadVendorScript: vi.fn().mockResolvedValue( undefined ),
			windowManager: { getById: vi.fn().mockReturnValue( undefined ) },
			activity: { publish: vi.fn() },
			fetch: vi.fn().mockResolvedValue(
				new Response( JSON.stringify( { id: 1 } ), { status: 200 } ),
			),
			config: { restUrl: 'https://example.test/wp-json/', restNonce: 'n' },
		};

		(
			window.wp as unknown as { os?: FakeDesktop }
		 ).os = fake;
	} );

	afterEach( () => {
		clearHooksStub();
		delete ( window as { wp?: unknown } ).wp;
	} );

	const registerGame = (
		registry: Registry,
		overrides: Partial< GameRegistryEntry > = {},
	): void => {
		registry.register( {
			id: 'test-game',
			title: 'Test Game',
			icon: 'dashicons-admin-generic',
			scoreColumns: [],
			config: { wordsUrl: 'https://example.test/words.txt' },
			render: ( ctx: GameLaunchContext ) => {
				capturedCtx = ctx;
				return () => undefined;
			},
			...overrides,
		} );
	};

	test( 'launch suspends the wallpaper and close resumes it', async () => {
		const { registry, launch } = await loadModules();
		registerGame( registry );

		await launch.launchGame( 'test-game' );

		expect( fake.wallpaper.suspend ).toHaveBeenCalledWith(
			'game:os-game-test-game',
		);
		expect( fake.wallpaper.resume ).not.toHaveBeenCalled();

		windowHandlers.closed?.();
		expect( fake.wallpaper.resume ).toHaveBeenCalledWith(
			'game:os-game-test-game',
		);
	} );

	test( 'teardown AND closed both firing resume only once', async () => {
		const { registry, launch } = await loadModules();
		registerGame( registry );

		await launch.launchGame( 'test-game' );
		( capturedTeardown as () => void )();
		windowHandlers.closed?.();

		expect( fake.wallpaper.resume ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'a registerWindow failure still resumes the wallpaper', async () => {
		const { registry, launch } = await loadModules();
		registerGame( registry );
		fake.registerWindow.mockRejectedValue( new Error( 'boom' ) );

		await expect( launch.launchGame( 'test-game' ) ).rejects.toThrow( 'boom' );
		expect( fake.wallpaper.resume ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'launching an already-open game does not double-suspend', async () => {
		const { registry, launch } = await loadModules();
		registerGame( registry );
		fake.windowManager.getById.mockReturnValue( { close: vi.fn() } );

		await launch.launchGame( 'test-game' );

		expect( fake.wallpaper.suspend ).not.toHaveBeenCalled();

		expect( fake.registerWindow ).toHaveBeenCalled();
	} );

	test( 'an instance on another virtual desktop switches Spaces first', async () => {
		const { registry, launch } = await loadModules();
		registerGame( registry );

		fake.windowManager.getByBaseId = vi.fn().mockReturnValue( {
			close: vi.fn(),
			config: { desktopId: 'desktop-2' },
		} );
		fake.windowManager.getActiveDesktopId = vi
			.fn()
			.mockReturnValue( 'desktop-1' );
		fake.windowManager.switchDesktop = vi.fn();

		await launch.launchGame( 'test-game' );

		expect( fake.windowManager.switchDesktop ).toHaveBeenCalledWith(
			'desktop-2',
		);
		expect( fake.wallpaper.suspend ).not.toHaveBeenCalled();
		expect( fake.registerWindow ).toHaveBeenCalled();
	} );

	test( 'an instance on the ACTIVE desktop does not switch', async () => {
		const { registry, launch } = await loadModules();
		registerGame( registry );
		fake.windowManager.getByBaseId = vi.fn().mockReturnValue( {
			close: vi.fn(),
			config: { desktopId: 'desktop-1' },
		} );
		fake.windowManager.getActiveDesktopId = vi
			.fn()
			.mockReturnValue( 'desktop-1' );
		fake.windowManager.switchDesktop = vi.fn();

		await launch.launchGame( 'test-game' );

		expect( fake.windowManager.switchDesktop ).not.toHaveBeenCalled();
		expect( fake.registerWindow ).toHaveBeenCalled();
	} );

	test( 'a stub is upgraded by loading its script', async () => {
		const { registry, launch } = await loadModules();
		registerGame( registry, {
			render: undefined,
			scriptUrl: 'https://example.test/game.js',
		} );
		const render = vi.fn();
		fake.loadVendorScript.mockImplementation( () => {
			(
				window as unknown as {
					openStationGames?: Record< string, unknown >;
				}
			 ).openStationGames = {
				'test-game': {
					id: 'test-game',
					title: 'Test Game',
					icon: 'x',
					scoreColumns: [],
					render,
				},
			};
			return Promise.resolve();
		} );

		await launch.launchGame( 'test-game' );

		expect( fake.loadVendorScript ).toHaveBeenCalledWith(
			'https://example.test/game.js',
			expect.anything(),
		);
		expect( render ).toHaveBeenCalled();

		expect( registry.get( 'test-game' )?.render ).toBeDefined();
	} );

	test( 'the window opens BEFORE the game bundle is fetched', async () => {

		const { registry, launch } = await loadModules();
		registerGame( registry, {
			render: undefined,
			scriptUrl: 'https://example.test/game.js',
		} );

		const order: string[] = [];
		fake.registerWindow.mockImplementation(
			async ( def: {
				render: ( body: HTMLElement ) => unknown;
			} ) => {
				order.push( 'window-opened' );
				await def.render( document.createElement( 'div' ) );
				return {};
			},
		);
		fake.loadVendorScript.mockImplementation( () => {
			order.push( 'script-fetched' );
			(
				window as unknown as {
					openStationGames?: Record< string, unknown >;
				}
			 ).openStationGames = {
				'test-game': {
					id: 'test-game',
					title: 'Test Game',
					icon: 'x',
					scoreColumns: [],
					render: vi.fn(),
				},
			};
			return Promise.resolve();
		} );

		await launch.launchGame( 'test-game' );

		expect( order ).toEqual( [ 'window-opened', 'script-fetched' ] );
	} );

	test( 'the window opens at the size the server declared', async () => {

		const { registry, launch } = await loadModules();
		registerGame( registry, {
			render: undefined,
			scriptUrl: 'https://example.test/game.js',
			window: {
				width: 860,
				height: 660,
				minWidth: 600,
				minHeight: 500,
			},
		} );
		fake.loadVendorScript.mockResolvedValue( undefined );

		await launch.launchGame( 'test-game' ).catch( () => undefined );

		expect( fake.registerWindow ).toHaveBeenCalledWith(
			expect.objectContaining( {
				width: 860,
				height: 660,
				minWidth: 600,
				minHeight: 500,
			} ),
		);
	} );

	test( 'the launch context carries config and windowId', async () => {
		const { registry, launch } = await loadModules();
		registerGame( registry );

		await launch.launchGame( 'test-game' );

		expect( capturedCtx?.windowId ).toBe( 'os-game-test-game' );
		expect( capturedCtx?.config ).toEqual( {
			wordsUrl: 'https://example.test/words.txt',
		} );
		expect( capturedCtx?.challenge ).toBeUndefined();
	} );

	test( 'submitScore routes to the leaderboard in free play', async () => {
		const { registry, launch } = await loadModules();
		registerGame( registry );

		await launch.launchGame( 'test-game' );
		await capturedCtx!.submitScore( { score: 42, meta: { wpm: 61 } } );

		const [ url, init ] = fake.fetch.mock.calls[ 0 ] as [ string, RequestInit ];
		expect( url ).toContain( 'desktop-mode/v1/games/test-game/scores' );
		expect( JSON.parse( init.body as string ) ).toEqual( {
			score: 42,
			meta: { wpm: 61 },
		} );
	} );

	test( 'submitScore routes to challenge completion in challenge mode', async () => {
		const { registry, launch } = await loadModules();
		registerGame( registry );

		await launch.launchGame( 'test-game', {
			challenge: {
				id: 7,
				scoreToBeat: 100,
				scoreMeta: {},
				challengerName: 'A',
			},
		} );
		expect( capturedCtx?.challenge?.scoreToBeat ).toBe( 100 );

		await capturedCtx!.submitScore( { score: 120 } );

		const [ url ] = fake.fetch.mock.calls[ 0 ] as [ string ];
		expect( url ).toContain( 'desktop-mode/v1/games/challenges/7/complete' );
	} );

	test( 'a recorded score announces on the activity bus', async () => {
		const { registry, launch } = await loadModules();
		registerGame( registry );

		await launch.launchGame( 'test-game' );
		await capturedCtx!.submitScore( { score: 42, meta: { wpm: 61 } } );

		expect( fake.activity.publish ).toHaveBeenCalledWith(
			'os/game-score-recorded',
			{
				game: 'test-game',
				score: 42,
				meta: { wpm: 61 },
				windowId: 'os-game-test-game',
				challengeId: undefined,
			},
		);
	} );

	test( 'the announcement waits for the REST write to resolve', async () => {
		const { registry, launch } = await loadModules();
		registerGame( registry );
		let settle: ( () => void ) | undefined;
		fake.fetch.mockImplementation(
			() =>
				new Promise< Response >( ( resolve ) => {
					settle = () =>
						resolve(
							new Response( JSON.stringify( { id: 1 } ), {
								status: 200,
							} ),
						);
				} ),
		);

		await launch.launchGame( 'test-game' );
		const pending = capturedCtx!.submitScore( { score: 42 } );

		expect( fake.activity.publish ).not.toHaveBeenCalled();

		settle!();
		await pending;
		expect( fake.activity.publish ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'a failed submit announces nothing', async () => {
		const { registry, launch } = await loadModules();
		registerGame( registry );
		fake.fetch.mockResolvedValue(
			new Response( JSON.stringify( { message: 'nope' } ), {
				status: 500,
			} ),
		);

		await launch.launchGame( 'test-game' );
		await expect(
			capturedCtx!.submitScore( { score: 42 } ),
		).rejects.toThrow( 'nope' );

		expect( fake.activity.publish ).not.toHaveBeenCalled();
	} );

	test( 'challenge completion announces with the challenge id', async () => {
		const { registry, launch } = await loadModules();
		registerGame( registry );
		fake.fetch.mockResolvedValue(
			new Response(
				JSON.stringify( { challenge: { id: 7, game: 'test-game' } } ),
				{ status: 200 },
			),
		);

		await launch.launchGame( 'test-game', {
			challenge: {
				id: 7,
				scoreToBeat: 100,
				scoreMeta: {},
				challengerName: 'A',
			},
		} );
		await capturedCtx!.submitScore( { score: 120 } );

		expect( fake.activity.publish ).toHaveBeenCalledWith(
			'os/game-score-recorded',
			expect.objectContaining( { game: 'test-game', challengeId: 7 } ),
		);
	} );
} );
