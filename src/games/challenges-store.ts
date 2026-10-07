import { createSharedStore } from '../shared-store';
import type { GameChallengeRow } from './types';

export interface ChallengesState {

	rows: Map< number, GameChallengeRow >;

	version: number;
	listeners: Set< () => void >;
}

const store = createSharedStore< ChallengesState >(
	'desktop-mode/games-challenges',
	() => ( {
		rows: new Map< number, GameChallengeRow >(),
		version: 0,
		listeners: new Set<() => void >(),
	} ),
);

export function challengesState(): ChallengesState {
	return store.state;
}

export function ingestChallenges( rows: GameChallengeRow[] ): void {
	const state = store.state;
	let changed = false;
	for ( const row of rows ) {
		if ( ! row || typeof row.id !== 'number' ) {
			continue;
		}
		const prev = state.rows.get( row.id );
		if ( ! prev || prev.updatedAtMs !== row.updatedAtMs ) {
			state.rows.set( row.id, row );
			changed = true;
		}
		if ( row.updatedAtMs > state.version ) {
			state.version = row.updatedAtMs;
		}
	}
	if ( changed ) {
		notify();
	}
}

export function subscribeChallenges( cb: () => void ): () => void {
	store.state.listeners.add( cb );
	return () => {
		store.state.listeners.delete( cb );
	};
}

function notify(): void {
	for ( const cb of Array.from( store.state.listeners ) ) {
		try {
			cb();
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					'[openstation] challenges store listener threw:',
					err,
				);
			}
		}
	}
}

export function allChallenges(): GameChallengeRow[] {
	return Array.from( store.state.rows.values() ).sort(
		( a, b ) => b.updatedAtMs - a.updatedAtMs,
	);
}
