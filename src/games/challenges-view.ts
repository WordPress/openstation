/**
 * Desktop Mode — Challenges view (inside the Games hub window).
 *
 * Lists every challenge involving the current user. Incoming
 * pending rows carry **Accept & Play** / **Decline** actions
 * (accepting routes through the same flow as the notification
 * toast); everything else renders its state + outcome. Repaints
 * live from the shared challenges store as Heartbeat deltas land,
 * and resyncs the full list over REST on mount (the store only
 * holds what arrived this session).
 *
 * @since 0.9.6
 */

// Side-effect imports — register the `<wpd-*>` components this module
// constructs. `defineComponent` is idempotent across bundles.
import '../ui/components/wpd-avatar/wpd-avatar';
import '../ui/components/wpd-button/wpd-button';
import '../ui/components/wpd-empty-state/wpd-empty-state';
import '../ui/components/wpd-relative-time/wpd-relative-time';

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
		| { desktop?: { config?: { currentUserId?: number } } }
		| undefined;
	return Number( wpGlobal?.desktop?.config?.currentUserId ) || 0;
}

function describeRow( row: GameChallengeRow, viewerId: number ): string {
	const incoming = row.recipientId === viewerId;
	const other = incoming ? row.challengerName : row.recipientName;
	const title = gameTitle( row.game );
	const target = String( row.scoreToBeat );

	if ( 'pending' === row.state ) {
		if ( incoming ) {
			return sprintf(
				/* translators: 1: challenger name, 2: game title, 3: score. */
				__( '%1$s challenged you to %2$s — beat %3$s.' ),
				other,
				title,
				target,
			);
		}
		return sprintf(
			/* translators: 1: recipient name, 2: game title, 3: score. */
			__( 'Waiting for %1$s to accept your %2$s challenge (%3$s).' ),
			other,
			title,
			target,
		);
	}
	if ( 'accepted' === row.state ) {
		if ( incoming ) {
			return sprintf(
				/* translators: 1: game title, 2: score. */
				__( 'You accepted — play %1$s and beat %2$s!' ),
				title,
				target,
			);
		}
		return sprintf(
			/* translators: 1: recipient name, 2: game title. */
			__( '%1$s accepted your %2$s challenge and is playing.' ),
			other,
			title,
		);
	}
	if ( 'declined' === row.state ) {
		if ( incoming ) {
			return sprintf(
				/* translators: 1: challenger name, 2: game title. */
				__( 'You declined %1$s’s %2$s challenge.' ),
				other,
				title,
			);
		}
		return sprintf(
			/* translators: 1: recipient name, 2: game title. */
			__( '%1$s declined your %2$s challenge.' ),
			other,
			title,
		);
	}

	// Completed.
	const beaten = 'beaten' === row.result;
	const result = String( row.resultScore ?? 0 );
	if ( incoming ) {
		if ( beaten ) {
			return sprintf(
				/* translators: 1: game title, 2: result score, 3: target score. */
				__( 'You beat the %1$s challenge: %2$s vs %3$s.' ),
				title,
				result,
				target,
			);
		}
		return sprintf(
			/* translators: 1: game title, 2: result score, 3: target score. */
			__( 'You missed the %1$s challenge: %2$s vs %3$s.' ),
			title,
			result,
			target,
		);
	}
	if ( beaten ) {
		return sprintf(
			/* translators: 1: recipient name, 2: result score, 3: target score. */
			__( '%1$s beat your score: %2$s vs %3$s.' ),
			other,
			result,
			target,
		);
	}
	return sprintf(
		/* translators: 1: recipient name, 2: result score, 3: target score. */
		__( '%1$s did not beat your score: %2$s vs %3$s.' ),
		other,
		result,
		target,
	);
}

function buildRow( row: GameChallengeRow, viewerId: number ): HTMLElement {
	const incoming = row.recipientId === viewerId;
	const item = document.createElement( 'li' );
	item.className = `desktop-mode-games__challenge desktop-mode-games__challenge--${ row.state }`;

	const avatar = document.createElement( 'wpd-avatar' );
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
	main.className = 'desktop-mode-games__challenge-main';
	const text = document.createElement( 'p' );
	text.textContent = describeRow( row, viewerId );
	main.appendChild( text );
	const when = document.createElement( 'wpd-relative-time' );
	when.setAttribute( 'datetime', new Date( row.updatedAtMs ).toISOString() );
	main.appendChild( when );
	item.appendChild( main );

	if ( incoming && 'pending' === row.state ) {
		const actions = document.createElement( 'div' );
		actions.className = 'desktop-mode-games__challenge-actions';

		const accept = document.createElement( 'wpd-button' );
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

		const decline = document.createElement( 'wpd-button' );
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

/**
 * Mount the challenges list into its container. Pass `gameId` to
 * restrict the list to one game (the Games hub's per-game detail
 * panel does). Returns a teardown.
 */
export function renderChallengesView(
	container: HTMLElement,
	gameId?: string,
): () => void {
	container.innerHTML = '';
	const list = document.createElement( 'ul' );
	list.className = 'desktop-mode-games__challenge-list';
	container.appendChild( list );

	const viewerId = currentUserId();

	const paint = (): void => {
		list.innerHTML = '';
		const rows = allChallenges().filter(
			( row ) => ! gameId || row.game === gameId,
		);
		if ( rows.length === 0 ) {
			const empty = document.createElement( 'wpd-empty-state' );
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

	// Full REST resync — the shared store only holds rows delivered
	// since this tab loaded; the list view wants history too.
	void fetchChallenges( { box: 'all' } )
		.then( ( { challenges } ) => ingestChallenges( challenges ) )
		.catch( ( err ) => {
			if ( typeof console !== 'undefined' ) {
				console.error(
					'[desktop-mode] challenges resync failed:',
					err,
				);
			}
		} );

	return unsubscribe;
}
