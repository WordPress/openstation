import * as registry from './registry';
import { ensureDeferredStyle } from '../deferred-styles';
import type { DesktopConfig, LazyScriptDependency } from '../types';
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
			deps?: LazyScriptDependency[];
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

		deps: entry.scriptDeps,
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

	const upgraded: GameRegistryEntry = {
		...entry,
		render: def.render,
		window: def.window ?? entry.window,
	};
	registry.register( upgraded );
	return upgraded;
}

export async function launchGame(
	id: string,
	opts: { challenge?: GameChallengeContext } = {},
): Promise< void > {
	const desktop = desktopGlobal();

	const entry = registry.get( id );
	if ( ! entry ) {
		throw new Error( `[openstation] Unknown game "${ id }".` );
	}

	ensureGameStyles();

	if ( typeof desktop.registerWindow !== 'function' ) {
		throw new Error(
			'[openstation] wp.os.registerWindow is missing — the shell must boot before launching games.',
		);
	}

	const windowId = `os-game-${ id }`;
	const suspendReason = `game:${ windowId }`;

	const manager = desktop.windowManager;
	const existing =
		manager?.getByBaseId?.( windowId ) ?? manager?.getById( windowId );
	if ( existing ) {
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

	let tracker: PlaytimeTracker | null = null;
	const stopTracker = (): void => {
		tracker?.stop();
		tracker = null;
	};

	desktop.onWindow?.( windowId, {
		closed: () => {
			stopTracker();
			resumeOnce();
		},
		minimized: () => tracker?.pause(),
		restored: () => tracker?.resume(),
	} );

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
		stopTracker();
		resumeOnce();
		throw err;
	}
}
