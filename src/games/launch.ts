/**
 * OpenStation — Game launcher.
 *
 * `launchGame( id )` is the single path every game opens through:
 * the Games window's launcher tiles, `wp.os.games.launch()`,
 * and the challenge-accept flow all land here. It
 *
 *   1. upgrades a metadata stub to a full def by lazily loading the
 *      game's script (first launch only),
 *   2. suspends the wallpaper (refcounted; the reason is unique per
 *      hosting window) so the game's canvas doesn't compete with
 *      the wallpaper's ticker,
 *   3. opens the native window `os-game-<id>` and hands
 *      the game its {@link GameLaunchContext},
 *   4. tracks the player's active time (paused while minimized) and
 *      flushes it to the play-time endpoint, and
 *   5. guarantees the wallpaper resumes — and the play-time tracker
 *      stops — on EVERY close path: normal close, crash inside
 *      render, failed script load.
 *
 * A finished run also publishes `os/game-score-recorded`
 * on the activity bus so the Games hub's scoreboard (a different
 * window) can refresh itself.
 *
 * Uses the `wp.os` public surface (registerWindow, wallpaper,
 * onWindow, loadVendorScript, activity) rather than direct imports
 * so the behavior is identical whether this module is compiled into
 * the main bundle or the games bundle.
 */

import * as registry from './registry';
import { ensureDeferredStyle } from '../deferred-styles';
import type { DesktopConfig } from '../types';
import { startPlaytimeTracker } from './playtime';
import type { PlaytimeTracker } from './playtime';
import { ingestChallenges } from './challenges-store';
import { completeChallenge, submitScore } from './rest';
import type {
	GameChallengeContext,
	GameDef,
	GameLaunchContext,
	GameRegistryEntry,
	GameScoreSubmission,
	GamesGlobals,
} from './types';

interface DesktopGlobal {
	registerWindow?: ( def: {
		id: string;
		title: string;
		icon: string;
		width?: number;
		height?: number;
		minWidth?: number;
		minHeight?: number;
		// A Promise is a first-class return here, not a convenience:
		// `Window.hydrateNative()` holds the window's loading overlay
		// until it settles, which is what lets a game open its window
		// on the click and fetch its bundle behind the spinner. The
		// shim was narrower than the framework it stands in for.
		render: (
			body: HTMLElement,
		) =>
			| ( () => void )
			| void
			| Promise< ( () => void ) | void >;
	} ) => Promise< unknown >;
	onWindow?: (
		id: string,
		handlers: {
			closed?: () => void;
			minimized?: () => void;
			restored?: () => void;
		},
		options?: { persistent?: boolean },
	) => () => void;
	wallpaper?: {
		suspend: ( reason: string ) => void;
		resume: ( reason: string ) => void;
	};
	loadVendorScript?: (
		url: string,
		extras?: {
			translations?: string;
			l10n?: string[];
			before?: string[];
			after?: string[];
		},
	) => Promise< void >;
	windowManager?: {
		getById: ( id: string ) => GameWindowLike | undefined;
		getByBaseId?: ( baseId: string ) => GameWindowLike | undefined;
		getActiveDesktopId?: () => string;
		switchDesktop?: ( id: string ) => void;
	};
	activity?: {
		publish: ( channel: string, payload?: unknown ) => void;
	};
}

interface GameWindowLike {
	close: () => void;
	config?: { desktopId?: string };
}

function desktopGlobal(): DesktopGlobal {
	return (
		( window.wp as { os?: DesktopGlobal } | undefined )?.os ?? {}
	);
}

const DEFAULT_GAME_WIDTH = 760;
const DEFAULT_GAME_HEIGHT = 560;
const DEFAULT_GAME_MIN_WIDTH = 480;
const DEFAULT_GAME_MIN_HEIGHT = 380;

/**
 * Load a stub entry's script and read the full def the script
 * published on `window.openStationGames[ id ]`. The upgraded entry
 * (server metadata + JS render) replaces the stub in the registry.
 *
 * Exported for the server-sync module's tests; `launchGame` is the
 * production caller.
 */
/**
 * Inject the stylesheets a game window needs.
 *
 * They also ride the Games hub as companion styles, which covers the
 * case where the hub is what opened. It is not the only way in: the
 * challenge toast's "Accept & Play" is built to work with the hub
 * closed, solo mode boots straight to `?openstation_solo=os-game-<id>`,
 * and `wp.os.games.launch()` is documented for plugin authors. Each of
 * those reaches `launchGame()` with no hub window in the tab, and the
 * HUD painted as raw text until the user happened to open the hub
 * afterwards — at which point the already-open game snapped into shape.
 *
 * `ensureDeferredStyle()` is idempotent and reads the same resolved map
 * the hub's companion sheets come from, so this is a no-op once the hub
 * has been open.
 *
 * Exported for its test; `launchGame` is the production caller.
 */
export function ensureGameStyles(): void {
	const handles =
		( window as unknown as { openStationConfig?: DesktopConfig } )
			.openStationConfig?.gameStyleHandles ?? [];
	for ( const handle of handles ) {
		ensureDeferredStyle( handle );
	}
}

export async function ensureGameRender(
	entry: GameRegistryEntry,
): Promise< GameRegistryEntry > {
	if ( typeof entry.render === 'function' ) {
		return entry;
	}
	const loadVendorScript = desktopGlobal().loadVendorScript;
	if ( ! entry.scriptUrl || typeof loadVendorScript !== 'function' ) {
		throw new Error(
			`[openstation] Game "${ entry.id }" has no render callback and no loadable script.`,
		);
	}
	await loadVendorScript( entry.scriptUrl, {
		translations: entry.scriptTranslations,
		l10n: entry.scriptL10n,
		before: entry.scriptBefore,
		after: entry.scriptAfter,
	} );
	const globals = window as unknown as GamesGlobals;
	const def: GameDef | undefined = globals.openStationGames?.[ entry.id ];
	if ( ! def || typeof def.render !== 'function' ) {
		throw new Error(
			`[openstation] No game def on window.openStationGames["${ entry.id }"]. ` +
				"Script loaded but didn't publish a def — check the plugin's global assignment.",
		);
	}
	// Server metadata wins for discovery fields (PHP registers them
	// translatably); the JS def contributes the render callback and
	// any window sizing it declares.
	const upgraded: GameRegistryEntry = {
		...entry,
		render: def.render,
		window: def.window ?? entry.window,
	};
	registry.register( upgraded );
	return upgraded;
}

/**
 * Open a game. Resolves once the hosting window is open. In
 * challenge mode the context carries the score to beat and
 * `submitScore` routes to the challenge-completion endpoint.
 */
export async function launchGame(
	id: string,
	opts: { challenge?: GameChallengeContext } = {},
): Promise< void > {
	const desktop = desktopGlobal();
	// `const` now: the entry is no longer reassigned here, because
	// `ensureGameRender()` moved inside the render callback below and
	// its upgraded copy is consumed there.
	const entry = registry.get( id );
	if ( ! entry ) {
		throw new Error( `[openstation] Unknown game "${ id }".` );
	}
	// The game's stylesheets, before anything paints.
	//
	// These ride the Games hub window as companion styles, which covers
	// the case where the hub is what opened. It is not the only way in:
	// the challenge toast's "Accept & Play" is built to work with the
	// hub closed, solo mode boots straight to
	// `?openstation_solo=os-game-<id>`, and `wp.os.games.launch()` is
	// documented for plugins. Each of those runs this function with no
	// hub window in the tab, and the HUD used to render as raw text
	// until the user happened to open the hub afterwards — at which
	// point the already-open game snapped into shape.
	//
	// `ensureDeferredStyle()` is idempotent and reads the same resolved
	// map the hub's companion sheets come from, so this is a no-op once
	// the hub has been open.
	ensureGameStyles();

	// NOT `await ensureGameRender()` here, deliberately. A game's
	// bundle is heavyweight — the game, its engine, sometimes a
	// dictionary asset — and loading it before `registerWindow()` meant
	// the click produced nothing at all, for seconds, with no window to
	// hang a spinner on. The load now happens inside the render
	// callback below, so the window opens on the click and the window
	// manager's own loading overlay covers the wait.
	//
	// The size comes from the server registration (`window` on
	// `openstation_register_game()`), which is why that argument exists:
	// it is the one part of the def the shell needs BEFORE the def. A
	// game that declares a size only in JS still works — it opens at the
	// framework default the first time, and at its own size afterwards,
	// once `ensureGameRender` has cached the upgraded entry.
	if ( typeof desktop.registerWindow !== 'function' ) {
		throw new Error(
			'[openstation] wp.os.registerWindow is missing — the shell must boot before launching games.',
		);
	}

	const windowId = `os-game-${ id }`;
	const suspendReason = `game:${ windowId }`;

	// Refcounted + reason-scoped, so re-launching an already-open
	// game (registerWindow focuses the existing window without a
	// second `closed` event) must not double-suspend: bail out
	// before suspending when the window is already open — on ANY
	// virtual desktop, since the suspend hold is global.
	const manager = desktop.windowManager;
	const existing =
		manager?.getByBaseId?.( windowId ) ?? manager?.getById( windowId );
	if ( existing ) {
		// `manager.open()` only reuses a window on the ACTIVE desktop
		// (`getByBaseIdOnActiveDesktop`); if the running instance
		// lives on another Space, calling registerWindow from here
		// would mint a blank `os-game-<id>-2` copy with the
		// no-op render below and no suspend wiring. Switch to the
		// instance's desktop first so the focus path is the one that
		// runs.
		const winDesktop = existing.config?.desktopId;
		if (
			winDesktop &&
			manager?.switchDesktop &&
			winDesktop !== manager?.getActiveDesktopId?.()
		) {
			manager.switchDesktop( winDesktop );
		}
		void desktop.registerWindow( {
			id: windowId,
			title: entry.title,
			icon: entry.icon,
			render: () => undefined,
		} );
		return;
	}

	desktop.wallpaper?.suspend( suspendReason );
	let resumed = false;
	const resumeOnce = (): void => {
		if ( resumed ) {
			return;
		}
		resumed = true;
		desktop.wallpaper?.resume( suspendReason );
	};

	// Play-time tracker: created when the window body mounts, paused
	// while the window is minimized, stopped (with a final flush) on
	// every close path.
	let tracker: PlaytimeTracker | null = null;
	const stopTracker = (): void => {
		tracker?.stop();
		tracker = null;
	};

	// `closed` fires on every close path the window manager knows
	// about — ✕ button, closeAll, session teardown — including when
	// the render callback threw after mounting.
	desktop.onWindow?.( windowId, {
		closed: () => {
			stopTracker();
			resumeOnce();
		},
		minimized: () => tracker?.pause(),
		restored: () => tracker?.resume(),
	} );

	// The run finished in THIS window; the Games hub is a different
	// window (and may be a different bundle) holding a leaderboard
	// that just went stale. Announce on the activity bus rather than
	// reaching into the hub. The framework is the transport, the hub
	// owns what it does about it.
	const announce = (
		result: GameScoreSubmission,
		challengeId?: number,
	): void => {
		desktop.activity?.publish( 'os/game-score-recorded', {
			game: id,
			score: result.score,
			meta: result.meta ?? {},
			windowId,
			challengeId,
		} );
	};

	const submit = ( result: GameScoreSubmission ): Promise< void > => {
		if ( opts.challenge ) {
			const challengeId = opts.challenge.id;
			return completeChallenge( challengeId, result, {
				windowId,
			} ).then( ( { challenge } ) => {
				// The completion response is the authoritative updated
				// row, so feed the shared store now rather than
				// waiting for the next Heartbeat delta to carry it.
				ingestChallenges( [ challenge ] );
				announce( result, challengeId );
			} );
		}
		return submitScore( id, result, { windowId } ).then( () =>
			announce( result ),
		);
	};

	try {
		await desktop.registerWindow( {
			id: windowId,
			title: entry.title,
			icon: entry.icon,
			width: entry.window?.width ?? DEFAULT_GAME_WIDTH,
			height: entry.window?.height ?? DEFAULT_GAME_HEIGHT,
			minWidth: entry.window?.minWidth ?? DEFAULT_GAME_MIN_WIDTH,
			minHeight: entry.window?.minHeight ?? DEFAULT_GAME_MIN_HEIGHT,
			render: async ( body: HTMLElement ) => {
				// The window manager holds this window's loading overlay
				// for as long as the render promise is pending, so the
				// bundle fetch reads as a loading window rather than as
				// a frozen desktop. Same shape native windows use for
				// their own lazy bundles (`buildRender` in
				// `src/native-windows.ts`).
				const loaded = await ensureGameRender( entry );
				const render = loaded.render;
				if ( typeof render !== 'function' ) {
					throw new Error(
						`[openstation] Game "${ id }" did not provide a render callback.`,
					);
				}
				const ctx: GameLaunchContext = {
					windowId,
					container: body,
					config: loaded.config ?? {},
					challenge: opts.challenge,
					submitScore: submit,
					close: () => {
						desktop.windowManager?.getById( windowId )?.close();
					},
				};
				tracker = startPlaytimeTracker( id, { windowId } );
				const teardown = render( ctx );
				return () => {
					try {
						teardown?.();
					} finally {
						stopTracker();
						resumeOnce();
					}
				};
			},
		} );
	} catch ( err ) {
		// Window never opened (or render threw before returning its
		// teardown) — the `closed` hook may never fire; resume here.
		stopTracker();
		resumeOnce();
		throw err;
	}
}
