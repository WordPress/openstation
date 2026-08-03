/**
 * OpenStation — Game system types.
 *
 * The contracts between the games framework (registry, launcher,
 * scoreboard, challenges) and individual games. A game ships as its
 * own lazily-loaded bundle that publishes a {@link GameDef} on
 * `window.openStationGames[ id ]`; the framework opens a native
 * window `os-game-<id>` and calls `render( ctx )` inside
 * it.
 */

/**
 * One scoreboard column a game declares. The scoreboard renders a
 * fixed Player column, then these in order, then a Date column.
 * Values come from the flexible `meta` map on each score row (the
 * `score` key maps onto the row's primary sort value).
 *
 * @public
 */
export interface GameScoreColumn {
	/** Slug key into the score row's `meta` map (or `score`). */
	key: string;
	/** Column header label (already translated). */
	label: string;
	/** Display hint. `time` renders seconds as m:ss. Default `number`. */
	type?: 'number' | 'time' | 'text';
}

/**
 * The score payload a game submits when a run finishes.
 *
 * @public
 */
export interface GameScoreSubmission {
	/** Primary leaderboard value. Non-negative integer. */
	score: number;
	/** Flexible per-game fields matching the declared `scoreColumns`. */
	meta?: Record< string, string | number >;
}

/**
 * Challenge context handed to a game launched in challenge mode —
 * the recipient accepted a score-to-beat challenge and is playing
 * their run now.
 *
 * @public
 */
export interface GameChallengeContext {
	/** Challenge row id. */
	id: number;
	/** The challenger's score this run is trying to beat. */
	scoreToBeat: number;
	/** The challenger's score meta (for richer in-game display). */
	scoreMeta: Record< string, string | number >;
	/** The challenger's display name. */
	challengerName: string;
}

/**
 * Everything a game receives when the framework launches it.
 *
 * @public
 */
export interface GameLaunchContext {
	/** The hosting native window's id (`os-game-<id>`). */
	windowId: string;
	/** The window body — the game owns this subtree until teardown. */
	container: HTMLElement;
	/** The server-declared config blob (`open_station_register_game()`'s `config`). */
	config: Record< string, unknown >;
	/** Set when the run is an accepted challenge; absent for free play. */
	challenge?: GameChallengeContext;
	/**
	 * Persist the finished run. Routes to the challenge-completion
	 * endpoint in challenge mode, the leaderboard otherwise. Call
	 * once, on game over — closing the window mid-run submits
	 * nothing.
	 */
	submitScore: ( result: GameScoreSubmission ) => Promise< void >;
	/** Close the hosting window (equivalent to the title-bar ✕). */
	close: () => void;
}

/**
 * A registered game. Published by the game's bundle on
 * `window.openStationGames[ id ]` and/or registered directly via
 * `wp.os.games.register()`.
 *
 * @public
 */
export interface GameDef {
	/** Unique slug. Must match the server registration for scores/challenges to persist. */
	id: string;
	/** Launcher label (already translated). */
	title: string;
	/** Dashicon class, http(s) URL, or `data:` URI. */
	icon: string;
	/** Plain-text launcher-tile description. */
	description?: string;
	/** Scoreboard column declarations, in display order. */
	scoreColumns: GameScoreColumn[];
	/** Hosting window sizing overrides. */
	window?: {
		width?: number;
		height?: number;
		minWidth?: number;
		minHeight?: number;
	};
	/**
	 * Render the game into the window body. Runs once per window
	 * open. Return a teardown that stops loops and releases
	 * resources — it runs on every close path.
	 */
	render: ( ctx: GameLaunchContext ) => ( () => void ) | void;
}

/**
 * A registry entry. Server-sync registers metadata-only STUBS
 * (`render` absent, `scriptUrl` present) so launcher tiles and
 * scoreboard tabs paint without downloading game code; the script
 * loads on first launch and upgrades the stub to a full def.
 *
 * @public
 */
export interface GameRegistryEntry {
	id: string;
	title: string;
	icon: string;
	description?: string;
	scoreColumns: GameScoreColumn[];
	/** Server-declared config blob handed to the launch context. */
	config: Record< string, unknown >;
	window?: GameDef[ 'window' ];
	/** Absent on stubs until the game script loads. */
	render?: GameDef[ 'render' ];
	/** Lazy-load source for stubs (from the server payload). */
	scriptUrl?: string;
	scriptTranslations?: string;
	scriptL10n?: string[];
	scriptBefore?: string[];
	scriptAfter?: string[];
}

/**
 * A shaped leaderboard row as returned by
 * `GET /desktop-mode/v1/games/{game}/scores`.
 *
 * @public
 */
export interface GameScoreRow {
	/** Index signature so the row satisfies `<os-table>`'s generic constraint. */
	[ key: string ]: unknown;
	id: number;
	game: string;
	userId: number;
	userName: string;
	userAvatar: string;
	score: number;
	meta: Record< string, string | number >;
	createdAtMs: number;
}

/**
 * A shaped challenge row as returned by the challenges REST routes
 * and the `open_station_games` Heartbeat channel.
 *
 * @public
 */
export interface GameChallengeRow {
	id: number;
	game: string;
	challengerId: number;
	challengerName: string;
	challengerAvatar: string;
	recipientId: number;
	recipientName: string;
	recipientAvatar: string;
	scoreToBeat: number;
	scoreMeta: Record< string, string | number >;
	state: 'pending' | 'accepted' | 'declined' | 'completed';
	result: 'beaten' | 'not_beaten' | null;
	resultScore: number | null;
	resultMeta: Record< string, string | number >;
	createdAtMs: number;
	updatedAtMs: number;
}

/**
 * The global game bundles publish their defs on. Mirrors
 * `window.openStationWallpapers` for wallpapers.
 */
export interface GamesGlobals {
	openStationGames?: Record< string, GameDef | undefined >;
}
