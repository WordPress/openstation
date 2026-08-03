/**
 * OpenStation — Challenges client (main-bundle side).
 *
 * Lives in the always-on shell bundle — like the recycle-bin badge —
 * because challenge delivery must work even when the Games window
 * has never been opened this session. Wires the Heartbeat bus
 * (`open_station_games_subscribe` out, `open_station_games` in),
 * feeds the shared challenges store, and owns the notification
 * policy:
 *
 *   - Recipient of a fresh `pending` challenge → `notify()`
 *     (browser notification with toast fallback) + a persistent
 *     toast with an **Accept & Play** action. Once per challenge
 *     per session; dismissing leaves it pending in the Games
 *     window's Challenges view (where Decline also lives).
 *   - Challenger whose challenge flipped to `completed` → outcome
 *     notification.
 */

import { heartbeat } from '../heartbeat';
import { __, sprintf } from '../i18n';
import { notify } from '../pwa/notify';
import { showToast } from '../toast';
import {
	allChallenges,
	challengesState,
	ingestChallenges,
	subscribeChallenges,
} from './challenges-store';
import { launchGame } from './launch';
import * as registry from './registry';
import { acceptChallenge } from './rest';
import type { GameChallengeRow } from './types';

/** Display title for a game id, falling back to the slug. */
export function gameTitle( id: string ): string {
	return registry.get( id )?.title || id;
}

export interface GamesChallengesClientDeps {
	/** The viewing user's id (from the shell config). */
	currentUserId: number;
}

/** Once-per-session gates, keyed by challenge id. */
const promptedPending = new Set< number >();
const promptedCompleted = new Set< number >();

/**
 * Accept a challenge and open the game in challenge mode. Exported
 * so the Games window's Challenges view routes through the same
 * flow as the toast action.
 */
export async function acceptAndPlay( row: GameChallengeRow ): Promise< void > {
	const { challenge } = await acceptChallenge( row.id );
	ingestChallenges( [ challenge ] );
	await launchGame( row.game, {
		challenge: {
			id: row.id,
			scoreToBeat: row.scoreToBeat,
			scoreMeta: row.scoreMeta,
			challengerName: row.challengerName,
		},
	} );
}

function promptRecipient( row: GameChallengeRow ): void {
	const message = sprintf(
		/* translators: 1: challenger display name, 2: game title/slug, 3: score. */
		__( '%1$s challenged you to %2$s — beat %3$s!' ),
		row.challengerName,
		gameTitle( row.game ),
		String( row.scoreToBeat ),
	);
	notify( {
		title: __( 'Game challenge' ),
		body: message,
		tag: `os-game-challenge-${ row.id }`,
	} );
	showToast( {
		message,
		persistent: true,
		dismissible: true,
		action: {
			label: __( 'Accept & Play' ),
			onClick: () => {
				void acceptAndPlay( row ).catch( ( err ) => {
					showToast( {
						message:
							err instanceof Error
								? err.message
								: __( 'Could not accept the challenge.' ),
					} );
				} );
			},
		},
	} );
}

function promptChallenger( row: GameChallengeRow ): void {
	let format: string;
	if ( 'beaten' === row.result ) {
		/* translators: 1: recipient display name, 2: their score, 3: the score to beat. */
		format = __( '%1$s beat your score: %2$s vs your %3$s.' );
	} else {
		/* translators: 1: recipient display name, 2: their score, 3: the score to beat. */
		format = __( '%1$s did not beat your score: %2$s vs your %3$s.' );
	}
	const message = sprintf(
		format,
		row.recipientName,
		String( row.resultScore ?? 0 ),
		String( row.scoreToBeat ),
	);
	notify( {
		title: __( 'Challenge finished' ),
		body: message,
		tag: `os-game-challenge-${ row.id }`,
	} );
	showToast( { message } );
}

/**
 * Wire the Heartbeat subscription + notification policy. Call once
 * from shell boot, after `bootHeartbeatBus()`.
 */
export function bootGamesChallenges( deps: GamesChallengesClientDeps ): void {
	const { currentUserId } = deps;
	if ( ! currentUserId ) {
		return;
	}

	heartbeat.contribute( 'open_station_games_subscribe', () => ( {
		challengesVersion: challengesState().version,
	} ) );

	heartbeat.subscribe< {
		challenges?: GameChallengeRow[];
	} >( 'open_station_games', ( payload ) => {
		if ( Array.isArray( payload?.challenges ) ) {
			ingestChallenges( payload.challenges );
		}
	} );

	const scan = (): void => {
		for ( const row of allChallenges() ) {
			if (
				'pending' === row.state &&
				row.recipientId === currentUserId &&
				! promptedPending.has( row.id )
			) {
				promptedPending.add( row.id );
				promptRecipient( row );
			}
			if (
				'completed' === row.state &&
				row.challengerId === currentUserId &&
				! promptedCompleted.has( row.id )
			) {
				promptedCompleted.add( row.id );
				promptChallenger( row );
			}
		}
	};
	subscribeChallenges( scan );
	// Cover rows already in the shared store (a second boot in the
	// same tab, tests) — `subscribe` doesn't replay current state.
	scan();
}

/**
 * Test-only reset of the once-per-session prompt gates.
 *
 * @internal
 */
export function _resetGamesChallengesPromptsForTests(): void {
	promptedPending.clear();
	promptedCompleted.clear();
}
