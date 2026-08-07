/**
 * OpenStation — Challenges shared store.
 *
 * Holds every challenge row the Heartbeat channel (or a REST
 * resync) has delivered this session, plus the `challengesVersion`
 * high-water mark the client echoes back to the server. Shared
 * across bundles: the main shell bundle ingests heartbeat deltas
 * and fires notifications; the Games hub bundle renders the
 * challenge list from the same rows.
 */

import { createSharedStore } from '../shared-store';
import type { GameChallengeRow } from './types';

export interface ChallengesState {
	/** Rows by challenge id. */
	rows: Map< number, GameChallengeRow >;
	/** Highest `updatedAtMs` seen — echoed on the next heartbeat. */
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

/** The raw shared state (cross-bundle singleton). */
export function challengesState(): ChallengesState {
	return store.state;
}

/**
 * Upsert delivered rows and advance the version high-water mark.
 * Notifies subscribers when anything changed.
 */
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

/** Subscribe to store changes. Returns an unsubscribe. */
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

/** All rows, newest change first. */
export function allChallenges(): GameChallengeRow[] {
	return Array.from( store.state.rows.values() ).sort(
		( a, b ) => b.updatedAtMs - a.updatedAtMs,
	);
}
