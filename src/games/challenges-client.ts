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

export function gameTitle( id: string ): string {
	return registry.get( id )?.title || id;
}

export interface GamesChallengesClientDeps {

	currentUserId: number;
}

const promptedPending = new Set< number >();
const promptedCompleted = new Set< number >();

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
		format = __( '%1$s beat your score: %2$s vs your %3$s.' );
	} else {
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

export function bootGamesChallenges( deps: GamesChallengesClientDeps ): void {
	const { currentUserId } = deps;
	if ( ! currentUserId ) {
		return;
	}

	heartbeat.contribute( 'openstation_games_subscribe', () => ( {
		challengesVersion: challengesState().version,
	} ) );

	heartbeat.subscribe< {
		challenges?: GameChallengeRow[];
	} >( 'openstation_games', ( payload ) => {
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

	scan();
}

export function _resetGamesChallengesPromptsForTests(): void {
	promptedPending.clear();
	promptedCompleted.clear();
}
