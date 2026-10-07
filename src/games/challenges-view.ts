import '../ui/components/os-avatar/os-avatar';
import '../ui/components/os-button/os-button';
import '../ui/components/os-empty-state/os-empty-state';
import '../ui/components/os-relative-time/os-relative-time';

import { __, sprintf } from '../i18n';
import { showToast } from '../toast';
import {
	allChallenges,
	ingestChallenges,
	subscribeChallenges,
} from './challenges-store';
import { acceptAndPlay, gameTitle } from './challenges-client';
import { declineChallenge, fetchChallenges } from './rest';
import type { GameChallengeRow } from './types';

function currentUserId(): number {
	const wpGlobal = window.wp as
		| { os?: { config?: { currentUserId?: number } } }
		| undefined;
	return Number( wpGlobal?.os?.config?.currentUserId ) || 0;
}

function describeRow( row: GameChallengeRow, viewerId: number ): string {
	const incoming = row.recipientId === viewerId;
	const other = incoming ? row.challengerName : row.recipientName;
	const title = gameTitle( row.game );
	const target = String( row.scoreToBeat );

	if ( 'pending' === row.state ) {
		if ( incoming ) {
			return sprintf(

				__( '%1$s challenged you to %2$s — beat %3$s.' ),
				other,
				title,
				target,
			);
		}
		return sprintf(

			__( 'Waiting for %1$s to accept your %2$s challenge (%3$s).' ),
			other,
			title,
			target,
		);
	}
	if ( 'accepted' === row.state ) {
		if ( incoming ) {
			return sprintf(

				__( 'You accepted — play %1$s and beat %2$s!' ),
				title,
				target,
			);
		}
		return sprintf(

			__( '%1$s accepted your %2$s challenge and is playing.' ),
			other,
			title,
		);
	}
	if ( 'declined' === row.state ) {
		if ( incoming ) {
			return sprintf(

				__( 'You declined %1$s’s %2$s challenge.' ),
				other,
				title,
			);
		}
		return sprintf(

			__( '%1$s declined your %2$s challenge.' ),
			other,
			title,
		);
	}

	const beaten = 'beaten' === row.result;
	const result = String( row.resultScore ?? 0 );
	if ( incoming ) {
		if ( beaten ) {
			return sprintf(

				__( 'You beat the %1$s challenge: %2$s vs %3$s.' ),
				title,
				result,
				target,
			);
		}
		return sprintf(

			__( 'You missed the %1$s challenge: %2$s vs %3$s.' ),
			title,
			result,
			target,
		);
	}
	if ( beaten ) {
		return sprintf(

			__( '%1$s beat your score: %2$s vs %3$s.' ),
			other,
			result,
			target,
		);
	}
	return sprintf(

		__( '%1$s did not beat your score: %2$s vs %3$s.' ),
		other,
		result,
		target,
	);
}

function buildRow( row: GameChallengeRow, viewerId: number ): HTMLElement {
	const incoming = row.recipientId === viewerId;
	const item = document.createElement( 'li' );
	item.className = `os-games__challenge os-games__challenge--${ row.state }`;

	const avatar = document.createElement( 'os-avatar' );
	const otherId = incoming ? row.challengerId : row.recipientId;
	avatar.setAttribute(
		'src',
		incoming ? row.challengerAvatar : row.recipientAvatar,
	);
	avatar.setAttribute(
		'name',
		incoming ? row.challengerName : row.recipientName,
	);
	avatar.setAttribute( 'size', 'sm' );
	avatar.setAttribute( 'user-id', String( otherId ) );
	item.appendChild( avatar );

	const main = document.createElement( 'div' );
	main.className = 'os-games__challenge-main';
	const text = document.createElement( 'p' );
	text.textContent = describeRow( row, viewerId );
	main.appendChild( text );
	const when = document.createElement( 'os-relative-time' );
	when.setAttribute( 'datetime', new Date( row.updatedAtMs ).toISOString() );
	main.appendChild( when );
	item.appendChild( main );

	if ( incoming && 'pending' === row.state ) {
		const actions = document.createElement( 'div' );
		actions.className = 'os-games__challenge-actions';

		const accept = document.createElement( 'os-button' );
		accept.setAttribute( 'variant', 'primary' );
		accept.setAttribute( 'size', 'sm' );
		accept.textContent = __( 'Accept & Play' );
		accept.addEventListener( 'click', () => {
			accept.setAttribute( 'disabled', '' );
			void acceptAndPlay( row ).catch( ( err ) => {
				accept.removeAttribute( 'disabled' );
				showToast( {
					message:
						err instanceof Error
							? err.message
							: __( 'Could not accept the challenge.' ),
				} );
			} );
		} );
		actions.appendChild( accept );

		const decline = document.createElement( 'os-button' );
		decline.setAttribute( 'variant', 'ghost' );
		decline.setAttribute( 'size', 'sm' );
		decline.textContent = __( 'Decline' );
		decline.addEventListener( 'click', () => {
			decline.setAttribute( 'disabled', '' );
			void declineChallenge( row.id )
				.then( ( { challenge } ) => ingestChallenges( [ challenge ] ) )
				.catch( ( err ) => {
					decline.removeAttribute( 'disabled' );
					showToast( {
						message:
							err instanceof Error
								? err.message
								: __( 'Could not decline the challenge.' ),
					} );
				} );
		} );
		actions.appendChild( decline );

		item.appendChild( actions );
	}

	return item;
}

export function renderChallengesView(
	container: HTMLElement,
	gameId?: string,
): () => void {
	container.innerHTML = '';
	const list = document.createElement( 'ul' );
	list.className = 'os-games__challenge-list';
	container.appendChild( list );

	const viewerId = currentUserId();

	const paint = (): void => {
		list.innerHTML = '';
		const rows = allChallenges().filter(
			( row ) => ! gameId || row.game === gameId,
		);
		if ( rows.length === 0 ) {
			const empty = document.createElement( 'os-empty-state' );
			empty.setAttribute( 'icon', 'awards' );
			empty.setAttribute( 'heading', __( 'No challenges yet' ) );
			empty.setAttribute(
				'description',
				__(
					'Press Challenge to throw down one of your scores, or pick a row from the scoreboard.',
				),
			);
			list.appendChild( empty );
			return;
		}
		for ( const row of rows ) {
			list.appendChild( buildRow( row, viewerId ) );
		}
	};

	const unsubscribe = subscribeChallenges( paint );
	paint();

	void fetchChallenges( { box: 'all' } )
		.then( ( { challenges } ) => ingestChallenges( challenges ) )
		.catch( ( err ) => {
			if ( typeof console !== 'undefined' ) {
				console.error(
					'[openstation] challenges resync failed:',
					err,
				);
			}
		} );

	return unsubscribe;
}
