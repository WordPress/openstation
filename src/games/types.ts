import type { LazyScriptDependency } from '../types';

export interface GameScoreColumn {

	key: string;

	label: string;

	type?: 'number' | 'time' | 'text';
}

export interface GameScoreSubmission {

	score: number;

	meta?: Record< string, string | number >;
}

export interface GameChallengeContext {

	id: number;

	scoreToBeat: number;

	scoreMeta: Record< string, string | number >;

	challengerName: string;
}

export interface GameLaunchContext {

	windowId: string;

	container: HTMLElement;

	config: Record< string, unknown >;

	challenge?: GameChallengeContext;

	submitScore: ( result: GameScoreSubmission ) => Promise< void >;

	close: () => void;
}

export interface GameDef {

	id: string;

	title: string;

	icon: string;

	description?: string;

	scoreColumns: GameScoreColumn[];

	window?: {
		width?: number;
		height?: number;
		minWidth?: number;
		minHeight?: number;
	};

	render: ( ctx: GameLaunchContext ) => ( () => void ) | void;
}

export interface GameRegistryEntry {
	id: string;
	title: string;
	icon: string;
	description?: string;
	scoreColumns: GameScoreColumn[];

	config: Record< string, unknown >;
	window?: GameDef[ 'window' ];

	render?: GameDef[ 'render' ];

	scriptUrl?: string;
	scriptTranslations?: string;
	scriptL10n?: string[];
	scriptBefore?: string[];
	scriptAfter?: string[];

	scriptDeps?: LazyScriptDependency[];
}

export interface GameScoreRow {

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

export interface GamesGlobals {
	openStationGames?: Record< string, GameDef | undefined >;
}
