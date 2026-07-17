/**
 * Desktop Mode — Game launcher.
 *
 * `launchGame( id )` is the single path every game opens through:
 * the Games window's launcher tiles, `wp.desktop.games.launch()`,
 * and the challenge-accept flow all land here. It
 *
 *   1. upgrades a metadata stub to a full def by lazily loading the
 *      game's script (first launch only),
 *   2. suspends the wallpaper (refcounted; the reason is unique per
 *      hosting window) so the game's canvas doesn't compete with
 *      the wallpaper's ticker,
 *   3. opens the native window `desktop-mode-game-<id>` and hands
 *      the game its {@link GameLaunchContext}, and
 *   4. guarantees the wallpaper resumes on EVERY close path —
 *      normal close, crash inside render, failed script load.
 *
 * Uses the `wp.desktop` public surface (registerWindow, wallpaper,
 * onWindow, loadVendorScript) rather than direct imports so the
 * behavior is identical whether this module is compiled into the
 * main bundle or the games bundle.
 *
 * @since 0.9.6
 */

import * as registry from './registry';
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
		render: ( body: HTMLElement ) => ( () => void ) | void;
	} ) => Promise< unknown >;
	onWindow?: (
		id: string,
		handlers: { closed?: () => void },
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
		getById: ( id: string ) => { close: () => void } | undefined;
	};
}

function desktopGlobal(): DesktopGlobal {
	return (
		( window.wp as { desktop?: DesktopGlobal } | undefined )?.desktop ?? {}
	);
}

const DEFAULT_GAME_WIDTH = 760;
const DEFAULT_GAME_HEIGHT = 560;
const DEFAULT_GAME_MIN_WIDTH = 480;
const DEFAULT_GAME_MIN_HEIGHT = 380;

/**
 * Load a stub entry's script and read the full def the script
 * published on `window.desktopModeGames[ id ]`. The upgraded entry
 * (server metadata + JS render) replaces the stub in the registry.
 *
 * Exported for the server-sync module's tests; `launchGame` is the
 * production caller.
 */
export async function ensureGameRender(
	entry: GameRegistryEntry,
): Promise< GameRegistryEntry > {
	if ( typeof entry.render === 'function' ) {
		return entry;
	}
	const loadVendorScript = desktopGlobal().loadVendorScript;
	if ( ! entry.scriptUrl || typeof loadVendorScript !== 'function' ) {
		throw new Error(
			`[desktop-mode] Game "${ entry.id }" has no render callback and no loadable script.`,
		);
	}
	await loadVendorScript( entry.scriptUrl, {
		translations: entry.scriptTranslations,
		l10n: entry.scriptL10n,
		before: entry.scriptBefore,
		after: entry.scriptAfter,
	} );
	const globals = window as unknown as GamesGlobals;
	const def: GameDef | undefined = globals.desktopModeGames?.[ entry.id ];
	if ( ! def || typeof def.render !== 'function' ) {
		throw new Error(
			`[desktop-mode] No game def on window.desktopModeGames["${ entry.id }"]. ` +
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
	let entry = registry.get( id );
	if ( ! entry ) {
		throw new Error( `[desktop-mode] Unknown game "${ id }".` );
	}
	entry = await ensureGameRender( entry );
	const render = entry.render;
	if ( typeof render !== 'function' ) {
		throw new Error(
			`[desktop-mode] Game "${ id }" did not provide a render callback.`,
		);
	}
	if ( typeof desktop.registerWindow !== 'function' ) {
		throw new Error(
			'[desktop-mode] wp.desktop.registerWindow is missing — the shell must boot before launching games.',
		);
	}

	const windowId = `desktop-mode-game-${ id }`;
	const suspendReason = `game:${ windowId }`;

	// Refcounted + reason-scoped, so re-launching an already-open
	// game (registerWindow focuses the existing window without a
	// second `closed` event) must not double-suspend: bail out
	// before suspending when the window is already open.
	if ( desktop.windowManager?.getById( windowId ) ) {
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

	// `closed` fires on every close path the window manager knows
	// about — ✕ button, closeAll, session teardown — including when
	// the render callback threw after mounting.
	desktop.onWindow?.( windowId, { closed: resumeOnce } );

	const submit = ( result: GameScoreSubmission ): Promise< void > => {
		if ( opts.challenge ) {
			return completeChallenge( opts.challenge.id, result, {
				windowId,
			} ).then( () => undefined );
		}
		return submitScore( id, result, { windowId } ).then(
			() => undefined,
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
			render: ( body: HTMLElement ) => {
				const ctx: GameLaunchContext = {
					windowId,
					container: body,
					config: entry.config ?? {},
					challenge: opts.challenge,
					submitScore: submit,
					close: () => {
						desktop.windowManager?.getById( windowId )?.close();
					},
				};
				const teardown = render( ctx );
				return () => {
					try {
						teardown?.();
					} finally {
						resumeOnce();
					}
				};
			},
		} );
	} catch ( err ) {
		// Window never opened (or render threw before returning its
		// teardown) — the `closed` hook may never fire; resume here.
		resumeOnce();
		throw err;
	}
}
